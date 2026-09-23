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
  'movement_out_id', 'movement_in_id', 'created_by', 'created_by_name'
];

async function inserirTransferencias(cliente, transferencias) {
  if (!transferencias.length) return;
  const valores = [];
  const grupos = transferencias.map((t, i) => {
    const base = i * COLUNAS_TRANSFERENCIA.length;
    valores.push(
      t.id, t.code, t.batchId || '', t.date, t.productId, t.originDepositId || '',
      t.destinationDepositId || '', t.classId || '', t.classValueId || '', t.quantity,
      t.note || '', t.movementOutId || '', t.movementInId || '', t.createdBy || '', t.createdByName || ''
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
  contarPorDeposito, contarPorCategoria, contarPorValorDeClasse,
  inserirMovimentos, inserirTransferencias,
  apagarMovimento, apagarTransferencia,
  somarNoTotalDoProduto, atualizarCustoDoProduto,
  travarProduto, saldosPorDeposito, naoAlocadoDoProduto,
  mapMovimento, mapTransferencia
};
