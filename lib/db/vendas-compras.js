const { supabase, createId, assertNoError } = require('./client');

function mapSaleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    customer: row.customer,
    productId: row.product_id,
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unit_price || 0),
    total: Number(row.total || 0),
    status: row.status
  };
}

async function getSales() {
  const { data, error } = await supabase.from('sales').select('*').order('date', { ascending: false });
  assertNoError(error, 'getSales');
  return (data || []).map(mapSaleRow);
}

async function createSale(payload) {
  const id = createId('sale');
  const row = {
    id,
    date: payload.date,
    customer: payload.customer,
    product_id: payload.productId,
    quantity: Number(payload.quantity || 0),
    unit_price: Number(payload.unitPrice || 0),
    total: Number(payload.total || 0),
    status: payload.status || 'faturado'
  };
  const { error } = await supabase.from('sales').insert(row);
  assertNoError(error, 'createSale');
  return mapSaleRow(row);
}

function mapPurchaseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    supplier: row.supplier,
    productId: row.product_id,
    quantity: Number(row.quantity || 0),
    costPrice: Number(row.cost_price || 0),
    total: Number(row.total || 0),
    status: row.status
  };
}

async function getPurchases() {
  const { data, error } = await supabase.from('purchases').select('*').order('date', { ascending: false });
  assertNoError(error, 'getPurchases');
  return (data || []).map(mapPurchaseRow);
}

async function createPurchase(payload) {
  const id = createId('purchase');
  const row = {
    id,
    date: payload.date,
    supplier: payload.supplier,
    product_id: payload.productId,
    quantity: Number(payload.quantity || 0),
    cost_price: Number(payload.costPrice || 0),
    total: Number(payload.total || 0),
    status: payload.status || 'pendente'
  };
  const { error } = await supabase.from('purchases').insert(row);
  assertNoError(error, 'createPurchase');
  return mapPurchaseRow(row);
}

function mapOrderQuoteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    customer: row.customer,
    date: row.date,
    amount: Number(row.amount || 0),
    status: row.status,
    note: row.note || ''
  };
}

async function getOrders() {
  const { data, error } = await supabase.from('orders').select('*').order('date', { ascending: false });
  assertNoError(error, 'getOrders');
  return (data || []).map(mapOrderQuoteRow);
}

async function createOrder(payload) {
  const id = createId('ord');
  const row = { id, type: 'order', customer: payload.customer, date: payload.date, amount: Number(payload.amount || 0), status: payload.status || 'pendente', note: payload.note || '' };
  const { error } = await supabase.from('orders').insert(row);
  assertNoError(error, 'createOrder');
  return mapOrderQuoteRow(row);
}

async function getQuotes() {
  const { data, error } = await supabase.from('quotes').select('*').order('date', { ascending: false });
  assertNoError(error, 'getQuotes');
  return (data || []).map(mapOrderQuoteRow);
}

async function createQuote(payload) {
  const id = createId('qte');
  const row = { id, type: 'quote', customer: payload.customer, date: payload.date, amount: Number(payload.amount || 0), status: payload.status || 'em aberto', note: payload.note || '' };
  const { error } = await supabase.from('quotes').insert(row);
  assertNoError(error, 'createQuote');
  return mapOrderQuoteRow(row);
}

function mapImportLogRow(row) {
  if (!row) return null;
  return { id: row.id, type: row.type, source: row.source, count: row.count, createdAt: row.created_at };
}

async function getImportLogs() {
  const { data, error } = await supabase.from('import_logs').select('*').order('created_at', { ascending: false });
  assertNoError(error, 'getImportLogs');
  return (data || []).map(mapImportLogRow);
}

async function addImportLog(payload) {
  const row = { id: createId('import'), type: payload.type, source: payload.source || 'manual', count: payload.count || 0, created_at: new Date().toISOString() };
  const { error } = await supabase.from('import_logs').insert(row);
  assertNoError(error, 'addImportLog');
  return mapImportLogRow(row);
}

module.exports = {
  getSales, createSale,
  getPurchases, createPurchase,
  getOrders, createOrder,
  getQuotes, createQuote,
  getImportLogs, addImportLog
};
