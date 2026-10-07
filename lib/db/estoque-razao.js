/**
 * O RAZÃO DE ESTOQUE, EM SQL (fase AP).
 *
 * Antes, `data.stockMovements` era um array dentro de data/db.json: o arquivo
 * inteiro era relido e reescrito a cada operação, sem transação, e duas
 * requisições concorrentes se sobrescreviam em silêncio.
 *
 * POR QUE A LEITURA CONTINUA TRAZENDO O RAZÃO INTEIRO
 * ---------------------------------------------------
 * `listarMovimentos()` devolve todas as linhas, e quem calcula saldo continua
 * sendo lib/stock-core.js, em memória, exatamente como antes. Isso é escolha,
 * não preguiça: as funções de saldo (depositBalance, classValueBalance,
 * classBalances, productBalances) são o miolo do módulo e estão cobertas por
 * teste; reescrevê-las em SQL na MESMA mudança que troca o armazenamento seria
 * trocar duas coisas ao mesmo tempo e não saber qual delas errou o saldo.
 *
 * O que muda de verdade nesta fase é o lado que estava quebrado: a ESCRITA, que
 * passa a ser transacional, e a durabilidade, que passa a ser do Postgres.
 *
 * QUANDO ISSO DEIXA DE SERVIR
 * Hoje são 23 linhas. Some agregação em SQL quando o razão passar de algumas
 * dezenas de milhares — o sinal é o Painel de Estoque começar a demorar. Os
 * índices por (product_id, deposit_id) e (product_id, class_value_id) já estão
 * lá esperando esse dia.
 */
const { consultar } = require('./conexao');

/** A linha do banco na forma que o resto do sistema sempre usou. */
function mapMovimento(row) {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    // A coluna é `date`, e o driver devolve Date. O sistema inteiro compara
    // como string 'YYYY-MM-DD' (inclusive os filtros de período), então a
    // conversão acontece aqui, num lugar só.
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || ''),
    productId: row.product_id,
    productName: row.product_name || '',
    depositId: row.deposit_id || '',
    classId: row.class_id || '',
    classValueId: row.class_value_id || '',
    // numeric volta como string no driver do Postgres (para não perder precisão
    // em valores grandes). Aqui vira número porque é assim que o razão sempre
    // foi somado — e stock-core.js faz aritmética direta com estes campos.
    quantity: Number(row.quantity),
    unitCost: Number(row.unit_cost),
    categoryId: row.category_id || '',
    document: row.document || '',
    note: row.note || '',
    transferId: row.transfer_id || '',
    origin: row.origin || '',
    motivo: row.motivo || '',
    referenceType: row.reference_type || '',
    referenceId: row.reference_id || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')
  };
}

function mapTransferencia(row) {
  return {
    id: row.id,
    code: row.code,
    batchId: row.batch_id || '',
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || ''),
    productId: row.product_id,
    originDepositId: row.origin_deposit_id || '',
    destinationDepositId: row.destination_deposit_id || '',
    classId: row.class_id || '',
    classValueId: row.class_value_id || '',
    quantity: Number(row.quantity),
    note: row.note || '',
    movementOutId: row.movement_out_id || '',
    movementInId: row.movement_in_id || '',
    // Fase CZ — as duas pernas do trânsito, o estado e o que já foi conferido.
    movementTransitInId: row.movement_transit_in_id || '',
    movementTransitOutId: row.movement_transit_out_id || '',
    status: row.status || 'recebida',
    receivedQuantity: Number(row.received_quantity || 0),
    sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : (row.sent_at ? String(row.sent_at) : ''),
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : (row.received_at ? String(row.received_at) : ''),
    receivedBy: row.received_by || '',
    receivedByName: row.received_by_name || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')
  };
}

async function listarMovimentos() {
  const { rows } = await consultar('select * from stock_movements order by created_at asc, code asc');
  return rows.map(mapMovimento);
}

/**
 * O RAZÃO SÓ DOS PRODUTOS PEDIDOS — para quem pergunta por um produto (ou
 * pelos poucos de uma gravação) e não pelo estoque inteiro.
 *
 * Quem usa: o Status do Produto (/api/stock/products/:id), a quebra por cor de
 * /api/stock/products/:id/classes e o contexto das escritas de Estoque
 * (loadStockContextDosProdutos, em server.js). Todos faziam `listarMovimentos()`
 * — o razão de TODOS os produtos — para perguntar sobre um: ~9,4 ms por 1.000
 * movimentos, a 750–900 movimentos novos por mês, em cada clique.
 *
 * É O MESMO NÚMERO. As funções de saldo de lib/stock-core.js filtram tudo por
 * productId; entregar só as linhas desses produtos torna o filtro um no-op. E a
 * ORDEM é a mesma de listarMovimentos (`created_at, code`): dentro de um
 * produto, a ordem decide a de `classBalances().valores` (primeira aparição) e
 * a das somas em ponto flutuante. O par (created_at, code) é único na prática
 * (o código sai da sequence); onde não fosse, nem a lista inteira teria ordem
 * definida para empate.
 *
 * Usa o índice idx_stock_mov_produto_deposito (product_id, deposit_id). Lista
 * vazia não vai ao banco.
 */
async function listarMovimentosDosProdutos(produtoIds) {
  const ids = [...new Set((produtoIds || []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await consultar(
    'select * from stock_movements where product_id = any($1) order by created_at asc, code asc', [ids]);
  return rows.map(mapMovimento);
}

/** Irmã de listarMovimentosDosProdutos: as transferências desses produtos (idx_stock_transf_produto). */
async function listarTransferenciasDosProdutos(produtoIds) {
  const ids = [...new Set((produtoIds || []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await consultar(
    'select * from stock_transfers where product_id = any($1) order by created_at asc, code asc', [ids]);
  return rows.map(mapTransferencia);
}

/**
 * Os produtos de uma CARGA (fase CZ), para a conferência carregar só o razão
 * deles. Toda linha da carga tem um destes produtos, então as transferências
 * desses produtos contêm a carga inteira.
 */
async function produtosDaCarga(batchId) {
  const carga = String(batchId || '').trim();
  // Sem carga não há o que procurar — e `batch_id = ''` casaria com todo o
  // histórico de antes da fase BO, que não tem lote.
  if (!carga) return [];
  const { rows } = await consultar(
    'select distinct product_id from stock_transfers where batch_id = $1', [carga]);
  return rows.map((r) => r.product_id);
}

/**
 * Quantos movimentos existem neste deposito (fase BB).
 *
 * CONTAGEM, e nao `listarMovimentos().filter()`. A pergunta e' "da para excluir
 * este deposito?", e trazer o razao inteiro para a memoria para responder "tem
 * algum?" e' desperdicio que cresce com o historico — justamente o que nao pode
 * cair no caminho de uma exclusao.
 *
 * Existe porque a guarda que fazia isso lia `data.stockMovements`, que virou
 * vazio quando o razao saiu do db.json: ela respondia "ninguem usa" sempre, e
 * um deposito com movimento foi excluido com `success: true`.
 */
/**
 * Quantos movimentos usam esta categoria. Irma de contarPorDeposito, e pelo
 * mesmo motivo: a guarda de exclusao precisa saber se ha algum, nao carregar o
 * razao inteiro na memoria para descobrir.
 */
async function contarPorCategoria(categoriaId) {
  const { rows } = await consultar(
    'select count(*)::int as n from stock_movements where category_id = $1',
    [String(categoriaId || '')]
  );
  return rows[0].n;
}

/** Quantos movimentos usam este valor de classe (uma cor, por exemplo). */
async function contarPorValorDeClasse(classValueId) {
  const { rows } = await consultar(
    'select count(*)::int as n from stock_movements where class_value_id = $1',
    [String(classValueId || '')]
  );
  return rows[0].n;
}

async function contarPorDeposito(depositoId) {
  const { rows } = await consultar(
    'select count(*)::int as n from stock_movements where deposit_id = $1',
    [String(depositoId || '')]
  );
  return rows[0].n;
}

async function listarTransferencias() {
  const { rows } = await consultar('select * from stock_transfers order by created_at asc, code asc');
  return rows.map(mapTransferencia);
}

/**
 * O PRÓXIMO CÓDIGO VEM DA SEQUENCE, não de max+1 no Node.
 *
 * O cálculo antigo lia a lista inteira, pegava o maior número e somava 1 — o
 * que reusava código depois de um DELETE e, com duas requisições ao mesmo
 * tempo, gerava o mesmo MOV-0024 duas vezes. Sequence não repete e não volta
 * atrás nem com rollback (e isso é uma qualidade aqui: buraco na numeração é
 * pista de que algo falhou; número repetido esconde).
 *
 * Recebe o cliente da transação porque o código precisa ser reservado DENTRO
 * dela — pedir por fora abriria janela para outra requisição pegar o mesmo.
 */
async function proximoCodigo(cliente, sequencia, prefixo) {
  const { rows } = await cliente.query(`select nextval('${sequencia}') as n`);
  return `${prefixo}-${String(rows[0].n).padStart(4, '0')}`;
}

const COLUNAS_MOVIMENTO = [
  'id', 'code', 'type', 'date', 'product_id', 'product_name', 'deposit_id',
  'class_id', 'class_value_id', 'quantity', 'unit_cost', 'category_id',
  'document', 'note', 'transfer_id', 'origin', 'motivo', 'reference_type',
  'reference_id', 'created_by', 'created_by_name'
];

function valoresDoMovimento(m) {
  return [
    m.id, m.code, m.type, m.date, m.productId, m.productName || '', m.depositId || '',
    m.classId || '', m.classValueId || '', m.quantity, m.unitCost || 0, m.categoryId || '',
    m.document || '', m.note || '', m.transferId || '', m.origin || '', m.motivo || '',
    m.referenceType || '', m.referenceId || '', m.createdBy || '', m.createdByName || ''
  ];
}

/**
 * Insere N movimentos num comando só, DENTRO da transação de quem chamou.
 *
 * Um INSERT multi-linha e não um laço de INSERTs: uma transferência de 200
 * itens gera 400 movimentos, e 400 idas ao banco custam 400 latências e abrem
 * 400 janelas para a transação ser interrompida no meio.
 */
async function inserirMovimentos(cliente, movimentos) {
  if (!movimentos.length) return;
  const valores = [];
  const grupos = movimentos.map((m, i) => {
    const base = i * COLUNAS_MOVIMENTO.length;
    valores.push(...valoresDoMovimento(m));
    return `(${COLUNAS_MOVIMENTO.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  await cliente.query(
    `insert into stock_movements (${COLUNAS_MOVIMENTO.join(', ')}) values ${grupos.join(', ')}`,
    valores
  );
}

const COLUNAS_TRANSFERENCIA = [
  'id', 'code', 'batch_id', 'date', 'product_id', 'origin_deposit_id',
  'destination_deposit_id', 'class_id', 'class_value_id', 'quantity', 'note',
  'movement_out_id', 'movement_in_id', 'created_by', 'created_by_name',
  // Fase CZ. `status` e `received_quantity` entram no INSERT porque o envio
  // nasce 'enviada' com zero conferido -- o default da coluna ('recebida') vale
  // para o HISTORICO instantaneo, nao para o envio novo.
  'status', 'received_quantity', 'sent_at',
  'movement_transit_in_id', 'movement_transit_out_id'
];

async function inserirTransferencias(cliente, transferencias) {
  if (!transferencias.length) return;
  const valores = [];
  const grupos = transferencias.map((t, i) => {
    const base = i * COLUNAS_TRANSFERENCIA.length;
    valores.push(
      t.id, t.code, t.batchId || '', t.date, t.productId, t.originDepositId || '',
      t.destinationDepositId || '', t.classId || '', t.classValueId || '', t.quantity,
      t.note || '', t.movementOutId || '', t.movementInId || '', t.createdBy || '', t.createdByName || '',
      // Fase CZ. 'recebida' quando quem chama nao diz nada: e' o que mantem a
      // transferencia instantanea (a de dentro do mesmo galpao) funcionando
      // igual, sem carga pendente que ninguem vai conferir.
      t.status || 'recebida',
      Number(t.receivedQuantity ?? t.quantity),
      t.sentAt || new Date().toISOString(),
      t.movementTransitInId || '', t.movementTransitOutId || ''
    );
    return `(${COLUNAS_TRANSFERENCIA.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  await cliente.query(
    `insert into stock_transfers (${COLUNAS_TRANSFERENCIA.join(', ')}) values ${grupos.join(', ')}`,
    valores
  );
}

async function apagarMovimento(cliente, id) {
  await cliente.query('delete from stock_movements where id = $1', [id]);
}

/**
 * As linhas de uma CARGA, travadas para conferir (fase CZ).
 *
 * `for update`, e pelo lote inteiro: duas pessoas conferindo a mesma carga no
 * balcão ao mesmo tempo é o caso comum, não o raro. Sem a trava, as duas leem
 * "faltam 10", cada uma recebe 10, e o balde de trânsito vai a -10 — que a
 * guarda do commitStockMovements recusaria, mas só depois de a primeira metade
 * da segunda conferência já estar gravada.
 *
 * Ordenado por id para a ordem de travamento ser sempre a mesma: é a mesma
 * razão pela qual commitStockMovements ordena os locks de produto.
 */
async function travarLoteParaConferir(cliente, batchId) {
  const { rows } = await cliente.query(
    'select * from stock_transfers where batch_id = $1 order by id for update',
    [String(batchId || '')]
  );
  return rows.map(mapTransferencia);
}

/**
 * Grava o que foi conferido numa linha.
 *
 * `received_quantity` ACUMULA (soma, não substitui): a caixa que faltou pode
 * chegar no dia seguinte e ser recebida numa segunda conferência. O status só
 * vira 'recebida' quando o acumulado alcança o enviado — enquanto falta, a
 * carga continua aparecendo na lista de pendentes, que é a pressão para alguém
 * resolver.
 *
 * `received_at` e o conferente são os da ÚLTIMA conferência. Guardar o histórico
 * de cada parcial pediria uma tabela filha, e a pergunta que a operação faz é
 * "chegou tudo?", não "em quantas vezes chegou".
 */
async function registrarRecebimento(cliente, { transferId, quantidade, movementTransitOutId, movementInId, user }) {
  const { rows } = await cliente.query(
    `update stock_transfers
        set received_quantity = received_quantity + $2,
            status = case when received_quantity + $2 >= quantity then 'recebida' else 'enviada' end,
            received_at = now(),
            received_by = $3,
            received_by_name = $4,
            movement_transit_out_id = case when $5 = '' then movement_transit_out_id else $5 end,
            movement_in_id = case when $6 = '' then movement_in_id else $6 end
      where id = $1
      returning *`,
    [transferId, Number(quantidade), String(user?.id || ''), String(user?.name || ''),
      String(movementTransitOutId || ''), String(movementInId || '')]
  );
  return rows[0] ? mapTransferencia(rows[0]) : null;
}

/** O estorno de uma transferência: os dois movimentos e o registro, juntos. */
async function apagarTransferencia(cliente, transferId) {
  await cliente.query('delete from stock_movements where transfer_id = $1', [transferId]);
  await cliente.query('delete from stock_transfers where id = $1', [transferId]);
}

/**
 * SOMA, NÃO ATRIBUI — e a diferença é uma corrida perdida.
 *
 * O código antigo lia products.stock_quantity, somava o delta no Node e gravava
 * o total absoluto. Entre a leitura e a gravação cabia outra requisição inteira:
 * as duas liam 100, as duas gravavam 105, e 5 unidades desapareciam sem erro.
 *
 * `stock_quantity + $1` deixa a soma com o Postgres, que serializa o UPDATE da
 * mesma linha. E vai na MESMA transação dos movimentos: ou o razão e o total
 * mudam juntos, ou nenhum dos dois muda.
 */
async function somarNoTotalDoProduto(cliente, produtoId, delta) {
  await cliente.query(
    'update products set stock_quantity = coalesce(stock_quantity, 0) + $1 where id = $2',
    [delta, produtoId]
  );
}

/**
 * O CUSTO DO PRODUTO, GRAVADO DENTRO DA TRANSAÇÃO DE QUEM CHAMOU.
 *
 * Existe porque `db.atualizarCusto` não aceita cliente: ela usa o atalho de
 * consulta e abre a própria conexão. A entrada de NF-e a chamava no laço dos
 * itens, ANTES de `commitStockMovements` — e o `catch` daquela rota, que desfaz
 * a nota inteira para a chave de acesso não ficar queimada, não desfazia o
 * custo.
 *
 * O que sobrava de um fechamento que falhasse: nenhuma nota, nenhum movimento,
 * e o custo de cada item já sobrescrito pelo vUnCom. Silencioso nas duas
 * pontas — a tela mostra o erro da ordem, e nada diz que o custo se mexeu.
 *
 * A janela é estreita (as duas recusas da ordem vinculada são conferidas antes
 * de qualquer gravação, na fase BH), mas não é vazia: sobra a corrida entre
 * aquela conferência e o commit, e sobra qualquer erro de banco.
 *
 * MORA AQUI porque este módulo já é o lugar das gravações em `products` que
 * precisam do cliente da transação — `somarNoTotalDoProduto` é a irmã dela, e
 * pelo mesmo motivo: ou muda junto com o razão, ou não muda.
 */
async function atualizarCustoDoProduto(cliente, produtoId, custo) {
  await cliente.query(
    'update products set cost_price = $1 where id = $2',
    [Number(custo || 0), produtoId]
  );
}

/** Trava a linha do produto até o fim da transação. Ver o uso em server.js. */
async function travarProduto(cliente, produtoId) {
  await cliente.query('select id from products where id = $1 for update', [produtoId]);
}

/**
 * SALDO ATUAL POR PRODUTO + DEPÓSITO (+ COR), LIDO DENTRO DA TRANSAÇÃO.
 *
 * Serve à guarda que recusa deixar um depósito negativo. Lê do BANCO, e não de
 * `data.stockMovements` em memória, por dois motivos:
 *
 *   1. a memória é a foto do início da requisição — entre ela e a gravação cabe
 *      outra venda do mesmo produto; e
 *   2. chamada depois de `travarProduto`, esta consulta vê o razão já estável,
 *      então o saldo que ela devolve é o que vale no instante da gravação.
 *
 * Ler em memória faria a guarda passar por duas vendas simultâneas que, somadas,
 * estouram o depósito — exatamente a corrida que a sequence do código de venda
 * já teve de resolver por outro motivo.
 *
 * `pares` é uma lista de { produtoId, depositoId, classValueId }. `classValueId`
 * vazio quer dizer "o depósito inteiro, somando todas as cores".
 *
 * Devolve um Map com a chave `produtoId|depositoId|classValueId`.
 */
async function saldosPorDeposito(cliente, pares) {
  const saldos = new Map();
  if (!pares.length) return saldos;
  for (const { produtoId, depositoId, classValueId } of pares) {
    const filtroCor = classValueId ? 'and class_value_id = $3' : '';
    const parametros = classValueId
      ? [produtoId, depositoId, classValueId]
      : [produtoId, depositoId];
    const { rows } = await cliente.query(
      `select coalesce(sum(case when type = 'saida' then -quantity else quantity end), 0) as saldo
         from stock_movements
        where product_id = $1 and deposit_id = $2 ${filtroCor}`,
      parametros
    );
    saldos.set(`${produtoId}|${depositoId}|${classValueId || ''}`, Number(rows[0].saldo));
  }
  return saldos;
}

/**
 * SALDO NAO ALOCADO de um produto, lido DENTRO da transacao.
 *
 * "Nao alocado" e' o que existe no cadastro do produto e nao esta em deposito
 * nenhum: total do produto MENOS a soma dos depositos de verdade. E' o balde
 * onde caem os movimentos sem deposito.
 *
 * Ele TAMBEM nao pode ficar negativo. Uma saida sem deposito que o estoure
 * produz um estado incoerente sem nenhum numero negativo aparecer na tela: o
 * produto diz "1 em estoque" enquanto um galpao sozinho guarda 2. Medido antes
 * desta guarda existir, com o produto 10000:
 *
 *     FILIAL 006 (GALPAO) = 2     ·     total do produto = 1
 *
 * Nao e' contado por `sum` sobre deposit_id = '' de proposito: `unallocated` e'
 * DERIVADO (total - alocado), como productBalances o calcula. Somar o razao do
 * deposito vazio daria outro numero para produto cujo saldo entrou por
 * importacao, sem movimento nenhum.
 */
async function naoAlocadoDoProduto(cliente, produtoId) {
  const { rows } = await cliente.query(
    `select coalesce(p.stock_quantity, 0) - coalesce((
         select sum(case when m.type = 'saida' then -m.quantity else m.quantity end)
           from stock_movements m
          where m.product_id = p.id and m.deposit_id <> ''
       ), 0) as nao_alocado
       from products p
      where p.id = $1`,
    [produtoId]
  );
  return rows.length ? Number(rows[0].nao_alocado) : 0;
}

module.exports = {
  listarMovimentos, listarTransferencias, proximoCodigo,
  // O razão só de alguns produtos: Status do Produto e escritas de Estoque.
  listarMovimentosDosProdutos, listarTransferenciasDosProdutos, produtosDaCarga,
  contarPorDeposito, contarPorCategoria, contarPorValorDeClasse,
  inserirMovimentos, inserirTransferencias,
  apagarMovimento, apagarTransferencia,
  // Fase CZ — trânsito e conferência na chegada.
  travarLoteParaConferir, registrarRecebimento,
  somarNoTotalDoProduto, atualizarCustoDoProduto,
  travarProduto, saldosPorDeposito, naoAlocadoDoProduto,
  mapMovimento, mapTransferencia
};
