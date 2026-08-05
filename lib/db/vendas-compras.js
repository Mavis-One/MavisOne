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
    supplierId: row.supplier_id || '',
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

async function getPurchaseById(id) {
  const { data, error } = await supabase.from('purchases').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getPurchaseById');
  return mapPurchaseRow(data);
}

async function createPurchase(payload) {
  const id = payload.id || createId('purchase');
  const row = {
    id,
    date: payload.date,
    supplier_id: payload.supplierId || null,
    supplier: payload.supplier,
    product_id: payload.productId,
    quantity: Number(payload.quantity || 0),
    cost_price: Number(payload.costPrice || 0),
    total: Number(payload.total || 0),
    status: payload.status || 'pendente'
  };
  const { data, error } = await supabase.from('purchases').insert(row).select().single();
  assertNoError(error, 'createPurchase');
  return mapPurchaseRow(data);
}

// PUT /api/purchases/:id hoje só muda status (pendente -> recebida/cancelada)
// — não existe edição dos demais campos da compra depois de criada. Update
// parcial (só grava as colunas presentes no payload) em vez de reconstruir a
// linha inteira, já que os outros usos previsíveis (corrigir fornecedor,
// por exemplo) também seriam parciais.
async function updatePurchase(id, payload) {
  const row = {};
  if (payload.status !== undefined) row.status = payload.status;
  if (payload.supplierId !== undefined) row.supplier_id = payload.supplierId || null;
  if (payload.supplier !== undefined) row.supplier = payload.supplier;
  if (payload.quantity !== undefined) row.quantity = Number(payload.quantity || 0);
  if (payload.costPrice !== undefined) row.cost_price = Number(payload.costPrice || 0);
  if (payload.total !== undefined) row.total = Number(payload.total || 0);
  const { data, error } = await supabase.from('purchases').update(row).eq('id', id).select().single();
  assertNoError(error, 'updatePurchase');
  return mapPurchaseRow(data);
}

// Pedido/orçamento de verdade (múltiplos itens, cliente/empresa/vendedor/
// depósito vinculados a Cadastro, desconto, frete) — não o modelo antigo de
// item único que a tabela tinha na Fase A. "customer"/"amount" continuam
// sendo escritas (redundante com clientSupplierName/totalAmount) só pra
// satisfazer a constraint not null antiga sem precisar alterá-la.
function mapOrderQuoteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    code: row.code,
    clientSupplierId: row.client_supplier_id || '',
    clientSupplierName: row.client_supplier_name || row.customer || '',
    companyId: row.company_id || '',
    sellerId: row.seller_id || '',
    depositId: row.deposit_id || '',
    date: row.date,
    dueDate: row.due_date || '',
    items: Array.isArray(row.items) ? row.items : [],
    discountAmount: Number(row.discount_amount || 0),
    discountPercent: Number(row.discount_percent || 0),
    freight: Number(row.freight || 0),
    itemsTotal: Number(row.items_total || 0),
    totalAmount: Number(row.total_amount ?? row.amount ?? 0),
    note: row.note || '',
    status: row.status,
    stockApplied: Boolean(row.stock_applied),
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildOrderQuoteRow(type, payload) {
  return {
    type,
    code: payload.code || null,
    client_supplier_id: payload.clientSupplierId || null,
    client_supplier_name: payload.clientSupplierName || '',
    company_id: payload.companyId || null,
    seller_id: payload.sellerId || null,
    deposit_id: payload.depositId || null,
    date: payload.date,
    due_date: payload.dueDate || null,
    items: payload.items || [],
    discount_amount: Number(payload.discountAmount || 0),
    discount_percent: Number(payload.discountPercent || 0),
    freight: Number(payload.freight || 0),
    items_total: Number(payload.itemsTotal || 0),
    total_amount: Number(payload.totalAmount || 0),
    note: payload.note || '',
    status: payload.status,
    stock_applied: Boolean(payload.stockApplied),
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    updated_at: new Date().toISOString(),
    // colunas antigas (Fase A), mantidas só por compatibilidade/constraint:
    customer: payload.clientSupplierName || payload.customer || '-',
    amount: Number(payload.totalAmount || 0)
  };
}

async function getOrders() {
  const { data, error } = await supabase.from('orders').select('*').order('code', { ascending: false });
  assertNoError(error, 'getOrders');
  return (data || []).map(mapOrderQuoteRow);
}

async function getOrderById(id) {
  const { data, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getOrderById');
  return mapOrderQuoteRow(data);
}

async function createOrder(payload) {
  const id = payload.id || createId('ord');
  const row = { id, ...buildOrderQuoteRow('order', payload), created_at: payload.createdAt || new Date().toISOString() };
  const { data, error } = await supabase.from('orders').insert(row).select().single();
  assertNoError(error, 'createOrder');
  return mapOrderQuoteRow(data);
}

async function updateOrder(id, payload) {
  const row = buildOrderQuoteRow('order', payload);
  const { data, error } = await supabase.from('orders').update(row).eq('id', id).select().single();
  assertNoError(error, 'updateOrder');
  return mapOrderQuoteRow(data);
}

async function deleteOrder(id) {
  const { error } = await supabase.from('orders').delete().eq('id', id);
  assertNoError(error, 'deleteOrder');
}

async function getQuotes() {
  const { data, error } = await supabase.from('quotes').select('*').order('code', { ascending: false });
  assertNoError(error, 'getQuotes');
  return (data || []).map(mapOrderQuoteRow);
}

async function getQuoteById(id) {
  const { data, error } = await supabase.from('quotes').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getQuoteById');
  return mapOrderQuoteRow(data);
}

async function createQuote(payload) {
  const id = payload.id || createId('qte');
  const row = { id, ...buildOrderQuoteRow('quote', payload), created_at: payload.createdAt || new Date().toISOString() };
  const { data, error } = await supabase.from('quotes').insert(row).select().single();
  assertNoError(error, 'createQuote');
  return mapOrderQuoteRow(data);
}

async function updateQuote(id, payload) {
  const row = buildOrderQuoteRow('quote', payload);
  const { data, error } = await supabase.from('quotes').update(row).eq('id', id).select().single();
  assertNoError(error, 'updateQuote');
  return mapOrderQuoteRow(data);
}

async function deleteQuote(id) {
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  assertNoError(error, 'deleteQuote');
}

// getNextSalesCode(data) hoje incrementa um contador no arquivo local
// (data.nextSalesCode). Pra manter um único código sequencial compartilhado
// entre orders e quotes sem outra sequence do Postgres só pra isso, calcula
// o maior código já usado nas duas tabelas + 1 — as duas ficam raramente
// grandes o bastante pra isso pesar, e evita criar mais uma peça de infra.
async function getNextSalesCode() {
  const [{ data: lastOrder }, { data: lastQuote }] = await Promise.all([
    supabase.from('orders').select('code').order('code', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('quotes').select('code').order('code', { ascending: false }).limit(1).maybeSingle()
  ]);
  const maior = Math.max(Number(lastOrder?.code) || 0, Number(lastQuote?.code) || 0, 1000);
  return maior + 1;
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
  getPurchases, getPurchaseById, createPurchase, updatePurchase,
  getOrders, getOrderById, createOrder, updateOrder, deleteOrder,
  getQuotes, getQuoteById, createQuote, updateQuote, deleteQuote,
  getNextSalesCode,
  getImportLogs, addImportLog
};
