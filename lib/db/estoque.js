const { supabase, createId, assertNoError } = require('./client');

function mapProductRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    stockQuantity: Number(row.stock_quantity || 0),
    costPrice: Number(row.cost_price || 0),
    salePrice: Number(row.sale_price || 0),
    ncm: row.ncm || '',
    cest: row.cest || '',
    unidadeComercial: row.unidade_comercial || '',
    unidadeTributavel: row.unidade_tributavel || '',
    ean: row.ean || '',
    origem: row.origem === null || row.origem === undefined ? null : Number(row.origem),
    numeroFci: row.numero_fci || ''
  };
}

// Colunas fiscais do produto (Fase C do schema). Ficam separadas porque só
// entram na gravação quando o chamador realmente mandou o campo: `upsertProduct`
// é chamado também pela baixa de estoque de um pedido, que passa o produto
// inteiro sem intenção de mexer em NCM — e por quem só mexe em preço.
//
// `undefined` = não mandou, não escreve. Isso importa: escrever `null` por
// omissão apagaria o NCM do produto na primeira venda faturada, e a emissão
// seguinte pararia com "Nenhuma regra fiscal encontrada".
const COLUNAS_FISCAIS = {
  ncm: 'ncm',
  cest: 'cest',
  unidadeComercial: 'unidade_comercial',
  unidadeTributavel: 'unidade_tributavel',
  ean: 'ean',
  origem: 'origem',
  numeroFci: 'numero_fci'
};

function camposFiscaisDoProduto(payload) {
  const row = {};
  for (const [chave, coluna] of Object.entries(COLUNAS_FISCAIS)) {
    if (payload[chave] === undefined) continue;
    const valor = payload[chave];
    if (chave === 'origem') {
      row[coluna] = valor === '' || valor === null ? null : Number(valor);
      continue;
    }
    const texto = String(valor ?? '').trim();
    row[coluna] = texto === '' ? null : texto;
  }
  return row;
}

async function getProducts() {
  const { data, error } = await supabase.from('products').select('*').order('name', { ascending: true });
  assertNoError(error, 'getProducts');
  return (data || []).map(mapProductRow);
}

async function getProductById(id) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getProductById');
  return mapProductRow(data);
}

async function upsertProduct(payload) {
  const id = payload.id || createId('prod');
  const row = {
    id,
    name: payload.name,
    sku: payload.sku,
    stock_quantity: Number(payload.stockQuantity || 0),
    cost_price: Number(payload.costPrice || 0),
    sale_price: Number(payload.salePrice || 0),
    ...camposFiscaisDoProduto(payload)
  };
  const { error } = await supabase.from('products').upsert(row);
  assertNoError(error, 'upsertProduct');
  return mapProductRow(row);
}

// Erro 23503 = violação de FK (Postgres). No schema atual, quem tem FK real
// pra products(id) é di_adicao (Declaração de Importação, raro na prática),
// além de sales/purchases — estas últimas já recebem dados de verdade desde a
// migração de Vendas/Compras pro Supabase.
function assertNoForeignKeyError(error, context, friendlyMessage) {
  if (error && error.code === '23503') {
    const err = new Error(friendlyMessage);
    err.status = 409;
    throw err;
  }
  assertNoError(error, context);
}

async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  assertNoForeignKeyError(error, 'deleteProduct', 'Não é possível excluir: este produto está vinculado a notas fiscais emitidas.');
  return true;
}

// Só o saldo — usado pelas movimentações de estoque, que não devem tocar em
// nome/SKU/preços do produto.
async function updateProductStock(id, stockQuantity) {
  const { error } = await supabase
    .from('products')
    .update({ stock_quantity: Number(stockQuantity || 0) })
    .eq('id', id);
  assertNoError(error, 'updateProductStock');
  return true;
}

module.exports = { getProducts, getProductById, upsertProduct, deleteProduct, updateProductStock };
