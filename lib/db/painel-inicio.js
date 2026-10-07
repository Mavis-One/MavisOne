/**
 * OS RECORTES DO INÍCIO — o Dashboard Geral e o sino (dashboard-e-sino, 07/10/2026).
 *
 * As três rotas do Início (/api/dashboard, /api/dashboard/charts e
 * /api/dashboard/atencao) liam TABELAS INTEIRAS para devolver de 0 a 4 KB:
 * os 27.362 lançamentos com as 25.709 baixas, os 14.864 pedidos, o `select *`
 * dos 5.560 produtos, o razão de estoque e as NF-e com o jsonb da Focus. Medido
 * com os dados reais, quase todo o tempo ficava no driver convertendo linha que
 * a rota jogava fora (`paraIso` sozinho: 171 ms por chamada do painel).
 *
 * Cada função daqui traz SÓ as linhas e as colunas que alguma conta da rota pode
 * usar, e o JS das regras continua decidindo (lib/kpis.js, lib/atencao.js, os
 * construtores de série em server.js). Por isso cada uma é de UMA rota: quem
 * lista, edita ou concilia continua nos carregadores de sempre, que trazem tudo.
 * NÃO USE NADA DAQUI PARA MOSTRAR REGISTRO — os campos que faltam voltam vazios
 * do mapper.
 *
 * Os mappers são os de sempre (mapFinancialEntryRow, mapOrderQuoteRow,
 * mapProductRow, mapNfeRow): um campo não muda de forma por ter vindo daqui.
 *
 * ORDEM COM DESEMPATE. As somas em ponto flutuante dos cartões dependem da
 * ordem em que as linhas chegam. Os carregadores de sempre ordenam por uma
 * coluna que EMPATA — `date desc` nos lançamentos (768 datas repetidas), `code
 * desc` nos pedidos (14 códigos repetidos e 6 nulos), `name` nos produtos (269
 * nomes repetidos) — e o Postgres devolve os empates em ordem livre: medido,
 * duas leituras seguidas de getFinancialEntries trocam 18.757 das 27.362
 * posições, e o cartão "A pagar" saía 3.036.803,5100000035 numa chamada e
 * ...004 na outra. Aqui a ordem é a MESMA coluna dos de sempre e o `id` como
 * desempate: a mesma sequência que eles já podiam devolver, só que sempre a
 * mesma. Os centavos nunca mudaram; o último bit do double deixa de mudar.
 */
const { banco, assertNoError } = require('./client');
const { consultar } = require('./conexao');
const { mapFinancialEntryRow } = require('./financeiro');
const { mapOrderQuoteRow, COLUNAS_DE_AGREGADO_PEDIDO } = require('./vendas-compras');
const { mapProductRow } = require('./estoque');
const { mapNfeRow } = require('./fiscal');

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------

/**
 * OS LANÇAMENTOS QUE O DASHBOARD GERAL PODE SOMAR — /api/dashboard.
 *
 * A rota lê `data.finance` em dois lugares, e os dois recusam o pago:
 *
 *   pendingReconciliation ...... status !== 'paid' (comparação exata)
 *   cartões A receber / A pagar  emAberto(): pending, pendente, parcial
 *
 * `is distinct from 'paid'` é o complemento EXATO de `status === 'paid'`: o
 * `=` do Postgres é binário numa collation determinística, e o nulo entra, como
 * entra no JS. Medido em 06/10/2026: 1.698 das 27.362 linhas, 17 ms contra os
 * 470 ms do syncFinanceData (que também lê as 25.709 baixas, que a rota não lê).
 *
 * Cinco colunas e nenhuma timestamptz: type (classifyFinanceEntry), date e
 * due_date (vencimento), amount e status. `id` só entra no ORDER BY.
 */
async function getLancamentosNaoPagos() {
  const { rows } = await consultar(
    `select type, date, due_date, amount, status from financial_entries
      where status is distinct from 'paid'
      order by date desc, id`);
  return rows.map(mapFinancialEntryRow);
}

/**
 * O FLUXO FINANCEIRO DO INÍCIO: só o realizado, só na janela do gráfico —
 * /api/dashboard/charts.
 *
 * buildFinanceChartSeries (server.js) soma lançamento com
 * `String(status).toLowerCase() === 'paid'` e `date` dentro de um balde; fora
 * disso a linha não entra em conta nenhuma. `lower(... collate "C")` mexe só em
 * ASCII — e nenhuma letra fora do ASCII vira p, a, i ou d no toLowerCase() do
 * JS (o único caso de não-ASCII que vira ASCII é o sinal Kelvin, que vira k).
 *
 * UM DIA DE FOLGA de cada lado: o gráfico recalcula os baldes lá dentro, e a
 * folga cobre a virada do dia entre a conta da rota e a dele.
 */
async function getLancamentosPagosEntre(de, ate) {
  const { rows } = await consultar(
    `select type, date, amount, status from financial_entries
      where lower(status collate "C") = 'paid'
        and date >= ($1::date - 1) and date <= ($2::date + 1)
      order by date desc, id`, [de, ate]);
  return rows.map(mapFinancialEntryRow);
}

/**
 * O QUE O SINO PODE CONTAR (lib/atencao.js), e mais nada — /api/dashboard/atencao.
 *
 * É um SUPERCONJUNTO das duas regras de lançamento — contasVencidas
 * (vencimento < hoje) e contasAVencer (hoje..hoje+7, a partir da meia-noite
 * LOCAL convertida para UTC) —, para quem chama passar `limite` = hoje + 8, que
 * cobre qualquer fuso. Quem decide o que entra continua sendo lib/atencao.js;
 * isto só não traz o que ela recusaria de qualquer jeito:
 *
 *   emAberto ............. pending/pendente/parcial (lower() só em ASCII)
 *   e.dueDate && ... ..... vencimento preenchido
 *   lancamentoImportado .. id que começa com o prefixo da importação (`left` e
 *                          não LIKE: sem curinga, é o startsWith do JS)
 *
 * `id` e `reference_id` vêm porque montarAtencao os lê (importado? de pedido
 * importado?). Medido: 27.362 lançamentos -> 0 neste banco (todos importados),
 * em ~10 ms.
 */
async function getLancamentosDoSino(limite, { prefixoImportado }) {
  const { rows } = await consultar(
    `select id, type, date, due_date, amount, status, reference_id from financial_entries
      where lower(status collate "C") in ('pending', 'pendente', 'parcial')
        and due_date is not null and due_date <= $1::date
        and left(id, char_length($2)) <> $2
      order by date desc, id`, [limite, prefixoImportado]);
  return rows.map(mapFinancialEntryRow);
}

// ---------------------------------------------------------------------------
// Pedidos e orçamentos
// ---------------------------------------------------------------------------

/**
 * O que /api/dashboard e /api/dashboard/charts leem de cada pedido: `date`,
 * `status`, `category` (filial e movimentação interna), `sellerId` (escopo) e
 * `totalAmount ?? amount`. Nada de id, code, type, nfe_id e created_at — e o
 * created_at (timestamptz) é a coluna mais cara para o driver converter.
 * Medido: 82 ms -> 48 ms nos 14.864 pedidos.
 *
 * `totalAmount` sai do mapper SEMPRE como número (`Number(total_amount ?? amount
 * ?? 0)`), então o valor do pedido é o mesmo que serializeSalesRecord
 * devolveria — o fallback para a soma dos itens é inalcançável para qualquer
 * linha que passe pelo mapper (ver o cabeçalho de getOrdersParaAgregado).
 *
 * Pelo construtor, e não SQL cru, de propósito: as duas rotas pedem a MESMA
 * consulta na abertura, e uma carona em consulta idêntica em voo (se o núcleo
 * a tiver) as junta sem código aqui.
 */
const COLUNAS_DO_PAINEL = 'date, status, category, seller_id, total_amount, amount';

async function getOrdersParaPainel() {
  const { data, error } = await banco.from('orders').select(COLUNAS_DO_PAINEL)
    .order('code', { ascending: false }).order('id', { ascending: true });
  assertNoError(error, 'getOrdersParaPainel');
  return (data || []).map(mapOrderQuoteRow);
}

async function getQuotesParaPainel() {
  const { data, error } = await banco.from('quotes').select(COLUNAS_DO_PAINEL)
    .order('code', { ascending: false }).order('id', { ascending: true });
  assertNoError(error, 'getQuotesParaPainel');
  return (data || []).map(mapOrderQuoteRow);
}

/**
 * OS PEDIDOS QUE O SINO PODE OLHAR (lib/atencao.js).
 *
 *   (a) nascidos aqui e sem nota: superconjunto de pedidosSemNota (o status e a
 *       tolerância de um dia continuam no JS);
 *   (b) `referencias`: os pedidos que os lançamentos do sino citam em
 *       reference_id, para montarAtencao saber quais títulos são de pedido
 *       importado. Vêm DEPOIS dos lançamentos, e não de uma subconsulta: numa
 *       consulta separada, um título novo gravado entre as duas leituras
 *       poderia chegar sem o pedido dele, e ser contado como próprio.
 *
 * As colunas do agregado (COLUNAS_DE_AGREGADO_PEDIDO traz nfe_id, code, date,
 * created_at, total_amount e status, que pedidosSemNota lê). O piso vem de
 * lib/atencao.js, que é dona da regra. Duas metades com UNION para cada uma usar
 * o seu índice (code; chave primária).
 */
async function getPedidosDoSino(referencias, { primeiroNumero }) {
  const { rows } = await consultar(
    `select ${COLUNAS_DE_AGREGADO_PEDIDO} from orders
      where code >= $1 and coalesce(nfe_id, '') = ''
     union
     select ${COLUNAS_DE_AGREGADO_PEDIDO} from orders
      where id = any($2::text[])
     order by code desc, id`, [primeiroNumero, referencias]);
  return rows.map(mapOrderQuoteRow);
}

// ---------------------------------------------------------------------------
// Produtos e NF-e
// ---------------------------------------------------------------------------

/**
 * O CARTÃO DE ESTOQUE DO DASHBOARD GERAL: quantidade, custo e o que decide
 * escritural. Mesmo filtro de getProducts (escritural fica de fora — não é
 * mercadoria e não entra na valorização) e a mesma ordem (nome), com o `id`
 * de desempate. Medido: 42 ms -> 18 ms nos 5.560 produtos.
 */
async function getProductsParaValor() {
  const { data, error } = await banco.from('products')
    .select('id, stock_quantity, cost_price, tipo_produto_fiscal')
    .order('name', { ascending: true }).order('id', { ascending: true });
  assertNoError(error, 'getProductsParaValor');
  return (data || []).map(mapProductRow).filter((p) => !p.escritural);
}

/**
 * Só estes produtos, com o saldo e o que decide escritural — o sino, que só
 * pode acusar quem declarou mínimo (stockCore.idsComMinimo). Mesmo filtro de
 * getProducts.
 */
async function getProductsPorIds(ids) {
  if (!ids || !ids.length) return [];
  const { data, error } = await banco.from('products')
    .select('id, stock_quantity, tipo_produto_fiscal')
    .in('id', ids)
    .order('name', { ascending: true }).order('id', { ascending: true });
  assertNoError(error, 'getProductsPorIds');
  return (data || []).map(mapProductRow).filter((p) => !p.escritural);
}

/**
 * O QUE O SINO LÊ DE CADA NF-e (lib/atencao.js: nfeComErro, nfeTravada) —
 * status, dataEmissao e criadoEm —, sem payload_enviado e resposta_focus (jsonb),
 * que são o grosso da linha. Todas as notas, como getNfeRecords: o filtro de
 * status continua no JS.
 */
async function getNfeParaAtencao() {
  const { data, error } = await banco.from('nfe').select('id, status, data_emissao, criado_em')
    .order('criado_em', { ascending: false }).order('id', { ascending: true });
  assertNoError(error, 'getNfeParaAtencao');
  return (data || []).map(mapNfeRow);
}

module.exports = {
  getLancamentosNaoPagos, getLancamentosPagosEntre, getLancamentosDoSino,
  getOrdersParaPainel, getQuotesParaPainel, getPedidosDoSino,
  getProductsParaValor, getProductsPorIds,
  getNfeParaAtencao,
  // Para o teste: as colunas que cartões e gráfico leem.
  COLUNAS_DO_PAINEL
};
