/**
 * INVENTÁRIOS (fase EG) — o retrato do estoque de uma empresa numa data.
 *
 * Este arquivo LÊ o razão (stock_movements) e GRAVA o documento do inventário;
 * não mexe em saldo nenhum. Quem decide o que entra (empresa, depósitos,
 * valoração) é a rota em server.js; o custo médio é calculado em
 * lib/custo-medio.js. Ver banco/migrations/fase-eg-inventarios.sql.
 */
const { consultar, emTransacao } = require('./conexao');
const { proximoCodigo } = require('./estoque-razao');

const VALORACOES = ['custo_medio', 'custo_cadastro'];
const MOTIVOS = ['01', '02', '03', '04', '05', '06'];
const SALDO = "case when m.type = 'saida' then -m.quantity else m.quantity end";

function instante(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return valor ? String(valor) : '';
}

function mapInventario(row) {
  return {
    id: row.id,
    code: row.code,
    companyId: row.company_id,
    companyName: row.company_name || '',
    companyDocument: row.company_document || '',
    // A data vem como texto do próprio SELECT (to_char): Date do driver
    // passaria pelo fuso e podia voltar um dia antes.
    dataReferencia: row.data_ref,
    ano: Number(String(row.data_ref || '').slice(0, 4)) || null,
    valoracao: row.valoracao,
    motivo: row.motivo,
    depositos: Array.isArray(row.depositos) ? row.depositos : [],
    itens: Number(row.itens || 0),
    quantidadeTotal: Number(row.quantidade_total || 0),
    valorTotal: Number(row.valor_total || 0),
    note: row.note || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: instante(row.created_at)
  };
}

function mapItem(row) {
  return {
    productId: row.product_id,
    sku: row.sku || '',
    productName: row.product_name || '',
    ncm: row.ncm || '',
    unidade: row.unidade || '',
    quantidade: Number(row.quantidade),
    custoUnitario: Number(row.custo_unitario),
    valor: Number(row.valor),
    origemCusto: row.origem_custo
  };
}

const COLUNAS = "i.*, to_char(i.data_referencia, 'YYYY-MM-DD') as data_ref";

async function listar({ companyId = '', ano = null } = {}) {
  const filtros = [];
  const parametros = [];
  if (companyId) {
    parametros.push(companyId);
    filtros.push(`i.company_id = $${parametros.length}`);
  }
  if (ano) {
    parametros.push(Number(ano));
    filtros.push(`extract(year from i.data_referencia) = $${parametros.length}`);
  }
  const onde = filtros.length ? `where ${filtros.join(' and ')}` : '';
  const { rows } = await consultar(
    `select ${COLUNAS} from inventarios i ${onde} order by i.data_referencia desc, i.created_at desc`,
    parametros
  );
  return rows.map(mapInventario);
}

async function buscar(id) {
  const { rows } = await consultar(`select ${COLUNAS} from inventarios i where i.id = $1`, [String(id || '')]);
  return rows[0] ? mapInventario(rows[0]) : null;
}

async function itensDoInventario(id) {
  const { rows } = await consultar(
    'select * from inventario_itens where inventario_id = $1 order by product_name, sku, id',
    [String(id || '')]
  );
  return rows.map(mapItem);
}

/** O mesmo inventário (empresa, data, valoração) já gerado — para não duplicar. */
async function existente({ companyId, dataReferencia, valoracao }) {
  const { rows } = await consultar(
    `select ${COLUNAS} from inventarios i
      where i.company_id = $1 and i.data_referencia = $2::date and i.valoracao = $3
      limit 1`,
    [companyId, dataReferencia, valoracao]
  );
  return rows[0] ? mapInventario(rows[0]) : null;
}

/**
 * Saldo por produto nos depósitos, no fim do dia `data` (inclusive). Só o que
 * não é zero; negativo vem também, e quem chama separa.
 */
async function saldosNaData(depositoIds, data) {
  if (!depositoIds.length) return [];
  const { rows } = await consultar(
    `select m.product_id, sum(${SALDO}) as saldo, max(m.product_name) as nome_no_razao
       from stock_movements m
      where m.date <= $1::date and m.deposit_id = any($2::text[])
      group by m.product_id
     having sum(${SALDO}) <> 0`,
    [data, depositoIds]
  );
  return rows.map((r) => ({ productId: r.product_id, saldo: Number(r.saldo), nomeNoRazao: r.nome_no_razao || '' }));
}

/**
 * O razão INTEIRO dos produtos até a data — todos os depósitos, de todas as
 * empresas: o custo médio é do produto (ver lib/custo-medio.js). Em ordem
 * cronológica; dentro do dia, pela ordem em que foi lançado.
 */
async function movimentosAteAData(produtoIds, data) {
  if (!produtoIds.length) return [];
  const { rows } = await consultar(
    `select m.product_id, m.type, m.quantity, m.unit_cost, m.transfer_id
       from stock_movements m
      where m.date <= $1::date and m.product_id = any($2::text[])
      order by m.product_id, m.date, m.created_at, m.code`,
    [data, produtoIds]
  );
  return rows.map((r) => ({
    productId: r.product_id, type: r.type, quantity: Number(r.quantity),
    unitCost: Number(r.unit_cost), transferId: r.transfer_id || ''
  }));
}

/** O que o inventário grava de cada produto, do cadastro de hoje. */
async function dadosDosProdutos(produtoIds) {
  if (!produtoIds.length) return new Map();
  const { rows } = await consultar(
    `select id, coalesce(sku, '') as sku, coalesce(name, '') as name, coalesce(btrim(ncm), '') as ncm,
            coalesce(unidade_comercial, '') as unidade, coalesce(cost_price, 0) as cost_price
       from products where id = any($1::text[])`,
    [produtoIds]
  );
  return new Map(rows.map((r) => [r.id, {
    sku: r.sku, name: r.name, ncm: r.ncm, unidade: r.unidade, costPrice: Number(r.cost_price)
  }]));
}

/** Cabeçalho e itens na MESMA transação: inventário pela metade não existe. */
async function criar(inventario, itens) {
  return emTransacao(async (cliente) => {
    const code = await proximoCodigo(cliente, 'inventarios_code_seq', 'INV');
    await cliente.query(
      `insert into inventarios (id, code, company_id, company_name, company_document, data_referencia,
                                valoracao, motivo, depositos, itens, quantidade_total, valor_total,
                                note, created_by, created_by_name)
       values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)`,
      [
        inventario.id, code, inventario.companyId, inventario.companyName, inventario.companyDocument,
        inventario.dataReferencia, inventario.valoracao, inventario.motivo,
        JSON.stringify(inventario.depositos || []), itens.length,
        inventario.quantidadeTotal, inventario.valorTotal, inventario.note || '',
        inventario.createdBy || '', inventario.createdByName || ''
      ]
    );
    if (itens.length) {
      // Um INSERT só, por unnest: 1.027 itens (o tamanho do inventário do
      // Viper) seriam 1.027 idas ao banco dentro da transação.
      await cliente.query(
        `insert into inventario_itens (inventario_id, product_id, sku, product_name, ncm, unidade,
                                       quantidade, custo_unitario, valor, origem_custo)
         select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                                  $7::numeric[], $8::numeric[], $9::numeric[], $10::text[])`,
        [
          inventario.id,
          itens.map((i) => i.productId), itens.map((i) => i.sku), itens.map((i) => i.productName),
          itens.map((i) => i.ncm), itens.map((i) => i.unidade), itens.map((i) => i.quantidade),
          itens.map((i) => i.custoUnitario), itens.map((i) => i.valor), itens.map((i) => i.origemCusto)
        ]
      );
    }
    return code;
  });
}

async function apagar(id) {
  const { rowCount } = await consultar('delete from inventarios where id = $1', [String(id || '')]);
  return rowCount > 0;
}

module.exports = {
  VALORACOES, MOTIVOS,
  listar, buscar, itensDoInventario, existente,
  saldosNaData, movimentosAteAData, dadosDosProdutos,
  criar, apagar
};
