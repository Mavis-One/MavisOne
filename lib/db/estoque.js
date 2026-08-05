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
    origem: row.origem === null || row.origem === undefined ? null : Number(row.origem)
  };
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
    sale_price: Number(payload.salePrice || 0)
  };
  const { error } = await supabase.from('products').upsert(row);
  assertNoError(error, 'upsertProduct');
  return mapProductRow(row);
}

// Erro 23503 = violação de FK (Postgres). No schema atual, quem tem FK real
// pra products(id) é di_adicao (Declaração de Importação, raro na prática) —
// sales/purchases também têm a FK no schema, mas essas tabelas ainda não
// recebem dados de verdade (Vendas/Compras seguem no arquivo local por
// enquanto). Isso passa a valer pra elas também assim que migrarem pro
// Supabase, sem precisar mexer aqui de novo.
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
}

module.exports = { getProducts, getProductById, upsertProduct, deleteProduct };
