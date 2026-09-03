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

/** Trava a linha do produto até o fim da transação. Ver o uso em server.js. */
async function travarProduto(cliente, produtoId) {
  await cliente.query('select id from products where id = $1 for update', [produtoId]);
}

module.exports = {
  listarMovimentos, listarTransferencias, contarPorDeposito, proximoCodigo,
  inserirMovimentos, inserirTransferencias,
  apagarMovimento, apagarTransferencia,
  somarNoTotalDoProduto, travarProduto,
  mapMovimento, mapTransferencia
};
