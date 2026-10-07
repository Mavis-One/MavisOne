/**
 * AS CARGAS ENXUTAS DAS TELAS ESPECIAIS DE RELATÓRIOS.
 *
 * Síntese Financeira, Valor em Estoque, Pedidos e Vendas por Vendedor não
 * passam pelo motor do catálogo (lib/relatorios): elas reaproveitam as contas
 * em JavaScript que já existiam no servidor. O que estava caro não era a conta,
 * era a LEITURA — `select *` das tabelas inteiras, para contas que leem cinco
 * ou seis campos de cada linha. Medido com os dados reais (06/10/2026,
 * diag/relatorios/carregadores.log, mediana de cinco):
 *
 *   lançamentos, select * + baixas (syncFinanceData) .... 690 ms
 *   lançamentos, as 5 colunas que a Síntese lê ............  85 ms
 *   pedidos + orçamentos, select * (syncSalesData) ....... 357 ms
 *   pedidos + orçamentos, as colunas do Relatório ........ 169 ms
 *
 * POR QUE UM ARQUIVO PRÓPRIO, e não mais uma função em lib/db/financeiro.js,
 * estoque.js ou vendas-compras.js: cada recorte aqui existe para UMA tela de
 * relatório, e o contrato dele é "os campos que aquela conta lê". Quem mexer na
 * conta acha o recorte do lado; quem mexer no cadastro de lançamento não
 * precisa saber que esta tela existe.
 *
 * A REGRA DE CADA RECORTE: os campos devolvidos têm os MESMOS nomes e a MESMA
 * conversão do mapeador completo da tabela (mapFinancialEntryRow,
 * mapProductRow, mapOrderQuoteRow). A conta que os lê não sabe que recebeu
 * menos, e não pode saber — ela é a mesma função das outras telas. O que falta
 * no objeto é campo que a conta não lê; se um dia passar a ler, o número sai
 * errado em silêncio, e é por isso que o comentário de cada carga lista quem lê
 * o quê, e scripts/test-relatorios-desempenho.js confere os nomes.
 *
 * NADA AQUI É CACHE: cada chamada vai ao banco. Ficou mais barato ler, não
 * deixou de ler.
 */

const { consultar } = require('./db/conexao');
const { mapOrderQuoteRow } = require('./db/vendas-compras');

/**
 * Os lançamentos da Síntese Financeira (e do arquivo dela).
 *
 * Quem lê, e o quê (server.js): `buildFinanceChartSeries` e
 * `contasDoFinanceiro` leem `type`, `status`, `amount`, `date` e `dueDate`
 * — por `classifyFinanceEntry`, `isFinanceEntryRealized`,
 * `isFinanceEntryCancelled`, `financeEntryDueDate` e `sumFinanceAmount`.
 * Nenhuma lê baixa (`financial_payments`): "realizado" ali é o status `paid`.
 *
 * A ORDEM só decide a ordem das SOMAS em ponto flutuante. A de antes era
 * `order by date desc`, que não desempata lançamentos do mesmo dia (768 dias
 * com mais de um), e o Postgres ordena os 27 mil em disco: duas leituras
 * seguidas já vinham em ordens diferentes, e a soma mudava na nona casa
 * decimal. `id` desempata — a soma passa a sair igual a cada chamada. Em
 * centavos, que é o que a tela e o arquivo mostram, nada muda.
 */
async function lancamentosDaSintese() {
  const { rows } = await consultar(
    'select type, status, amount, date, due_date from financial_entries order by date desc, id'
  );
  return rows.map((row) => ({
    type: row.type,
    date: row.date,
    dueDate: row.due_date,
    amount: Number(row.amount || 0),
    status: row.status
  }));
}

/**
 * Os produtos do Valor em Estoque (e do arquivo dele).
 *
 * Quem lê, e o quê: a base de estoque dos relatórios (server.js) lê `id`,
 * `name`, `sku`, `stockQuantity` e `costPrice`; o filtro do escritural lê
 * `tipo_produto_fiscal`, exatamente como `getProducts()` faz — item escritural
 * só existe para compor documento fiscal e nunca é mercadoria.
 *
 * A ORDEM POR NOME TEM DE FICAR, e é a MESMA cláusula de `getProducts()`: a
 * tela e o arquivo ordenam por valor com `sort` (estável), e o empate de valor
 * — milhares de produtos sem saldo valem zero — cai na ordem em que os
 * produtos chegaram. Os 218 nomes repetidos deste banco ficam na ordem em que
 * o Postgres os ordena hoje (varredura da tabela + quicksort, a mesma nas duas
 * consultas): conferido, o arquivo do Valor em Estoque sai idêntico byte a
 * byte ao de antes, e duas chamadas seguidas do servidor de antes também saem
 * iguais entre si. Desempatar por `id` mudaria a posição de ~280 linhas de
 * mesmo nome no arquivo; fica registrado como pendência, não feito aqui.
 */
async function produtosDoValorEmEstoque() {
  const { rows } = await consultar(
    'select id, name, sku, stock_quantity, cost_price, tipo_produto_fiscal from products order by name asc'
  );
  return rows
    // `getProducts()` filtra pelo campo `escritural` do mapeador, que é
    // `tipo_produto_fiscal === 'ESCRITURAL'` — e NULL não é escritural.
    .filter((row) => row.tipo_produto_fiscal !== 'ESCRITURAL')
    .map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      stockQuantity: Number(row.stock_quantity || 0),
      costPrice: Number(row.cost_price || 0)
    }));
}

/**
 * Pedidos e orçamentos do Relatório de Vendas (Pedidos e Vendas por Vendedor).
 *
 * Quem lê, e o quê: lib/relatorios-vendas.js lê do registro serializado
 * `id, code, type, date, status, sellerId, sellerName, clientSupplierId,
 * customer, clientSupplierName, discountAmount, discountPercent, items`; o
 * `serializeSalesRecord` do servidor os monta a partir das colunas abaixo e do
 * cadastro (nome do cliente e do vendedor). `total_amount`/`amount` vêm porque o
 * serializador calcula `amount` com eles — o relatório não o usa (ele soma os
 * itens), mas um registro serializado com `amount` errado seria uma armadilha
 * para quem usar estes registros amanhã.
 *
 * Sai `select *` (~60 colunas: pagamento, entrega, anexos, observação,
 * e-mails, comissões...) e sai `import_logs`, que o relatório nunca leu.
 *
 * A ORDEM É A DE `getOrders()`/`getQuotes()` — código decrescente — porque ela
 * importa: o agrupamento por vendedor leva as 10 PRIMEIRAS linhas de cada um
 * na ordem de chegada, e o empate da ordenação da tabela cai nela.
 *
 * `code` NÃO É ÚNICO (14 pedidos repetem número e 6 não têm), e o desempate
 * de hoje não está escrito em lugar nenhum: `getOrders()` pede só
 * `order by code desc`, o Postgres responde pelo índice `idx_orders_code`, e
 * os empatados saem na ordem da posição física da linha (`ctid`). O `ctid`
 * aqui ESCREVE esse desempate, para o recorte sair na mesma ordem do
 * `select *` — conferido: o JSON e o CSV do relatório saem idênticos byte a
 * byte aos de antes, em 11 combinações de filtro e ordem, admin e vendedor;
 * e `order by code desc, id` mudaria a ordem dos 6 pedidos sem número.
 * A posição física muda quando o pedido é editado, então a ordem desses
 * empates muda junto — exatamente como hoje na lista de Vendas. Fixar por
 * `id` é decisão de produto (pendência registrada), não desta troca.
 */
const COLUNAS_DO_RELATORIO_DE_VENDAS = [
  'id', 'code', 'type', 'date', 'status', 'seller_id',
  'client_supplier_id', 'client_supplier_name', 'customer',
  'discount_amount', 'discount_percent', 'items', 'total_amount', 'amount'
].join(', ');

async function vendasDoRelatorio() {
  const [orders, quotes] = await Promise.all([
    consultar(`select ${COLUNAS_DO_RELATORIO_DE_VENDAS} from orders order by code desc, ctid`),
    consultar(`select ${COLUNAS_DO_RELATORIO_DE_VENDAS} from quotes order by code desc, ctid`)
  ]);
  return {
    orders: orders.rows.map(mapOrderQuoteRow),
    quotes: quotes.rows.map(mapOrderQuoteRow)
  };
}

module.exports = {
  lancamentosDaSintese,
  produtosDoValorEmEstoque,
  vendasDoRelatorio,
  COLUNAS_DO_RELATORIO_DE_VENDAS
};
