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
    // Fase H — com `??` e não `||` no booleano: charge_freight_to_buyer false
    // é uma escolha do usuário, não "vazio". Se a coluna ainda não existe
    // (migração não aplicada), cai no padrão true.
    freightFixed: Boolean(row.freight_fixed),
    chargeFreightToBuyer: row.charge_freight_to_buyer ?? true,
    generalExpenses: Number(row.general_expenses || 0),
    assemblyFee: Number(row.assembly_fee || 0),
    servicesAmount: Number(row.services_amount || 0),
    sellerCommissionPercent: Number(row.seller_commission_percent || 0),
    agentCommissionPercent: Number(row.agent_commission_percent || 0),
    discountTotal: Number(row.discount_total || 0),
    sellerCommission: Number(row.seller_commission || 0),
    agentCommission: Number(row.agent_commission || 0),
    totalWeight: Number(row.total_weight || 0),
    // Fase I — "Informações Gerais". Mesma lógica de ausência de coluna: se a
    // migração não rodou, `row.x` é undefined e cai no padrão vazio/zero.
    registrationTime: row.registration_time || '',
    clientStatus: row.client_status || '',
    clientContact: row.client_contact || '',
    customerPoCode: row.customer_po_code || '',
    recipientEmail: row.recipient_email || '',
    billingRecipientEmail: row.billing_recipient_email || '',
    commercialRecipientEmail: row.commercial_recipient_email || '',
    approvalDate: row.approval_date || '',
    relatedOrderCode: Number(row.related_order_code || 0),
    revisionNumber: Number(row.revision_number || 0),
    generateServiceOrder: Boolean(row.generate_service_order),
    updatedByName: row.updated_by_name || '',
    // Fase J — cabeçalho da aba Dados.
    saleOrigin: row.sale_origin || 'Venda Direta',
    category: row.category || '',
    priceTable: row.price_table || '',
    // Fase K — abas Pagamentos, Entrega e Termos. Os objetos vêm como jsonb;
    // o servidor normaliza campo a campo antes de mandar para a tela.
    paymentInfo: row.payment_info || {},
    payments: Array.isArray(row.payments) ? row.payments : [],
    delivery: row.delivery || {},
    salesTerms: row.sales_terms || '',
    note: row.note || '',
    status: row.status,
    stockApplied: Boolean(row.stock_applied),
    financeApplied: Boolean(row.finance_applied),
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
    amount: Number(payload.totalAmount || 0),
    ...buildFaseHRow(payload),
    ...buildFaseIRow(payload),
    ...buildFaseJRow(payload),
    ...buildFaseKRow(payload),
    ...buildFaseORow(payload)
  };
}

// Colunas da Fase H do schema.sql. Ficam separadas porque, se a migração ainda
// não tiver sido rodada no Supabase, elas são removidas e a gravação segue com
// o resto — ver withColunasNovasFallback.
const COLUNAS_FASE_H = [
  'freight_fixed', 'charge_freight_to_buyer', 'general_expenses', 'assembly_fee',
  'services_amount', 'seller_commission_percent', 'agent_commission_percent',
  'discount_total', 'seller_commission', 'agent_commission', 'total_weight'
];

function buildFaseHRow(payload) {
  return {
    freight_fixed: Boolean(payload.freightFixed),
    charge_freight_to_buyer: payload.chargeFreightToBuyer !== false,
    general_expenses: Number(payload.generalExpenses || 0),
    assembly_fee: Number(payload.assemblyFee || 0),
    services_amount: Number(payload.servicesAmount || 0),
    seller_commission_percent: Number(payload.sellerCommissionPercent || 0),
    agent_commission_percent: Number(payload.agentCommissionPercent || 0),
    discount_total: Number(payload.discountTotal || 0),
    seller_commission: Number(payload.sellerCommission || 0),
    agent_commission: Number(payload.agentCommission || 0),
    total_weight: Number(payload.totalWeight || 0)
  };
}

// Colunas da Fase I do schema.sql — a seção "Informações Gerais" do formulário.
// Separadas pelo mesmo motivo das da Fase H (ver acima).
const COLUNAS_FASE_I = [
  'registration_time', 'client_status', 'client_contact', 'customer_po_code',
  'recipient_email', 'billing_recipient_email', 'commercial_recipient_email',
  'approval_date', 'related_order_code', 'revision_number',
  'generate_service_order', 'updated_by_name'
];

function buildFaseIRow(payload) {
  return {
    registration_time: payload.registrationTime || '',
    client_status: payload.clientStatus || '',
    client_contact: payload.clientContact || '',
    customer_po_code: payload.customerPoCode || '',
    recipient_email: payload.recipientEmail || '',
    billing_recipient_email: payload.billingRecipientEmail || '',
    commercial_recipient_email: payload.commercialRecipientEmail || '',
    // Coluna `date`: string vazia quebraria o cast no Postgres, então vira null.
    approval_date: payload.approvalDate || null,
    related_order_code: Number(payload.relatedOrderCode || 0),
    revision_number: Number(payload.revisionNumber || 0),
    generate_service_order: Boolean(payload.generateServiceOrder),
    updated_by_name: payload.updatedByName || ''
  };
}

// Colunas da Fase J do schema.sql — o cabeçalho da aba "Dados" do formulário.
const COLUNAS_FASE_J = ['sale_origin', 'category', 'price_table'];

function buildFaseJRow(payload) {
  return {
    sale_origin: payload.saleOrigin || 'Venda Direta',
    category: payload.category || '',
    price_table: payload.priceTable || ''
  };
}

// Colunas da Fase K do schema.sql — abas Pagamentos, Entrega e Termos.
const COLUNAS_FASE_K = ['payment_info', 'payments', 'delivery', 'sales_terms'];

// Fase O — marca se o pedido já gerou as contas a receber. Irmã de
// stock_applied: é ela que impede faturar duas vezes gerar cobrança dobrada.
const COLUNAS_FASE_O = ['finance_applied'];

function buildFaseORow(payload) {
  return { finance_applied: Boolean(payload.financeApplied) };
}

function buildFaseKRow(payload) {
  return {
    payment_info: payload.paymentInfo || {},
    payments: payload.payments || [],
    delivery: payload.delivery || {},
    sales_terms: payload.salesTerms || ''
  };
}

// Da migração mais nova para a mais antiga. Na falha por coluna inexistente,
// tira UMA fase por vez: quem já rodou a Fase H não perde os campos dela só
// porque ainda não rodou a Fase I.
const FASES_OPCIONAIS = [
  { nome: 'Fase O', colunas: COLUNAS_FASE_O, perda: 'A marca de que o pedido já gerou contas a receber' },
  { nome: 'Fase K', colunas: COLUNAS_FASE_K, perda: 'As abas Pagamentos, Entrega e Termos e Condições' },
  { nome: 'Fase J', colunas: COLUNAS_FASE_J, perda: 'Origem da venda, categoria e tabela de preços' },
  { nome: 'Fase I', colunas: COLUNAS_FASE_I, perda: 'Os campos de "Informações Gerais" (datas, contatos e e-mails)' },
  { nome: 'Fase H', colunas: COLUNAS_FASE_H, perda: 'Descontos combinados, frete, despesas e comissões' }
];
const fasesAvisadas = new Set();

// Se a migração ainda não foi aplicada, o PostgREST responde PGRST204/42703
// ("column not found"). Em vez de derrubar a gravação inteira — o usuário
// perderia o pedido que acabou de digitar — repete sem as colunas novas e
// avisa uma vez no log. Assim que o SQL for rodado, volta ao normal sozinho,
// sem precisar reiniciar.
function ehErroDeColunaInexistente(error) {
  if (!error) return false;
  return error.code === 'PGRST204'
    || error.code === '42703'
    || /column .* does not exist|Could not find the '.*' column/i.test(error.message || '');
}

async function withColunasNovasFallback(row, executar, contexto) {
  let resultado = await executar(row);
  const reduzido = { ...row };
  for (const fase of FASES_OPCIONAIS) {
    if (!ehErroDeColunaInexistente(resultado.error)) break;
    if (!fasesAvisadas.has(fase.nome)) {
      fasesAvisadas.add(fase.nome);
      console.warn(
        `[${contexto}] Colunas da ${fase.nome} ausentes no Supabase — gravando sem elas.\n` +
        `  ${fase.perda} NÃO serão persistidos até a migração ser aplicada.\n` +
        `  Rode o bloco "${fase.nome}" de supabase/schema.sql no SQL Editor do Supabase.`
      );
    }
    fase.colunas.forEach((coluna) => delete reduzido[coluna]);
    resultado = await executar(reduzido);
  }
  return resultado;
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
  const { data, error } = await withColunasNovasFallback(row, (r) => supabase.from('orders').insert(r).select().single(), 'createOrder');
  assertNoError(error, 'createOrder');
  return mapOrderQuoteRow(data);
}

async function updateOrder(id, payload) {
  const row = buildOrderQuoteRow('order', payload);
  const { data, error } = await withColunasNovasFallback(row, (r) => supabase.from('orders').update(r).eq('id', id).select().single(), 'updateOrder');
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
  const { data, error } = await withColunasNovasFallback(row, (r) => supabase.from('quotes').insert(r).select().single(), 'createQuote');
  assertNoError(error, 'createQuote');
  return mapOrderQuoteRow(data);
}

async function updateQuote(id, payload) {
  const row = buildOrderQuoteRow('quote', payload);
  const { data, error } = await withColunasNovasFallback(row, (r) => supabase.from('quotes').update(r).eq('id', id).select().single(), 'updateQuote');
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
  getImportLogs, addImportLog,
  // Exportados para teste (scripts/test-sales-record-fields.js): são as peças
  // puras que decidem se um campo do formulário sobrevive ao salvar/reabrir.
  buildOrderQuoteRow, mapOrderQuoteRow, withColunasNovasFallback, FASES_OPCIONAIS
};
