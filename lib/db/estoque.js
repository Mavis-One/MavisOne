const { supabase, createId, assertNoError } = require('./client');

function mapProductRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    stockQuantity: Number(row.stock_quantity || 0),
    costPrice: Number(row.cost_price || 0),
    salePrice: Number(row.sale_price || 0)
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

module.exports = { getProducts, getProductById, upsertProduct };
