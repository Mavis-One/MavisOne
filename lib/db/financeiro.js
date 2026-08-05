const { supabase, createId, assertNoError } = require('./client');

// ----------------------------------------------------------------------------
// Lançamentos financeiros
// ----------------------------------------------------------------------------
function mapFinancialEntryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    dueDate: row.due_date,
    amount: Number(row.amount || 0),
    description: row.description,
    document: row.document || '',
    note: row.note || '',
    category: row.category_id || '',
    costCenter: row.cost_center_id || '',
    bankAccountId: row.bank_account_id || '',
    targetBankAccountId: row.target_bank_account_id || '',
    clientSupplierId: row.client_supplier_id || '',
    clientSupplierName: row.client_supplier_name || '',
    referenceId: row.reference_id || '',
    nfeId: row.nfe_id || '',
    status: row.status,
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getFinancialEntries() {
  const { data, error } = await supabase.from('financial_entries').select('*').order('date', { ascending: false });
  assertNoError(error, 'getFinancialEntries');
  return (data || []).map(mapFinancialEntryRow);
}

async function getFinancialEntryById(id) {
  const { data, error } = await supabase.from('financial_entries').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getFinancialEntryById');
  return mapFinancialEntryRow(data);
}

async function createFinancialEntry(payload) {
  const id = payload.id || createId('fin');
  const now = new Date().toISOString();
  const row = {
    id,
    type: payload.type,
    date: payload.date,
    due_date: payload.dueDate || payload.date,
    amount: Number(payload.amount || 0),
    description: payload.description,
    document: payload.document || '',
    note: payload.note || '',
    category_id: payload.category || null,
    cost_center_id: payload.costCenter || null,
    bank_account_id: payload.bankAccountId || null,
    target_bank_account_id: payload.targetBankAccountId || null,
    client_supplier_id: payload.clientSupplierId || null,
    client_supplier_name: payload.clientSupplierName || '',
    reference_id: payload.referenceId || '',
    nfe_id: payload.nfeId || null,
    status: payload.status || 'pending',
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    created_at: now,
    updated_at: now
  };
  const { error } = await supabase.from('financial_entries').insert(row);
  assertNoError(error, 'createFinancialEntry');
  return getFinancialEntryById(id);
}

async function updateFinancialEntry(id, payload) {
  const row = { updated_at: new Date().toISOString() };
  if (payload.description !== undefined) row.description = payload.description;
  if (payload.amount !== undefined) row.amount = Number(payload.amount || 0);
  if (payload.date !== undefined) row.date = payload.date;
  if (payload.dueDate !== undefined) row.due_date = payload.dueDate;
  if (payload.document !== undefined) row.document = payload.document;
  if (payload.note !== undefined) row.note = payload.note;
  if (payload.category !== undefined) row.category_id = payload.category || null;
  if (payload.costCenter !== undefined) row.cost_center_id = payload.costCenter || null;
  if (payload.bankAccountId !== undefined) row.bank_account_id = payload.bankAccountId || null;
  if (payload.targetBankAccountId !== undefined) row.target_bank_account_id = payload.targetBankAccountId || null;
  if (payload.clientSupplierId !== undefined) row.client_supplier_id = payload.clientSupplierId || null;
  if (payload.clientSupplierName !== undefined) row.client_supplier_name = payload.clientSupplierName;
  if (payload.status !== undefined) row.status = payload.status;
  const { error } = await supabase.from('financial_entries').update(row).eq('id', id);
  assertNoError(error, 'updateFinancialEntry');
  return getFinancialEntryById(id);
}

// ----------------------------------------------------------------------------
// Baixas (pagamentos)
// ----------------------------------------------------------------------------
function mapPaymentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    amount: Number(row.amount || 0),
    date: row.date,
    bankAccountId: row.bank_account_id || '',
    interest: Number(row.interest || 0),
    fine: Number(row.fine || 0),
    discount: Number(row.discount || 0),
    note: row.note || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at
  };
}

async function getFinancialPaymentsByEntry(entryId) {
  const { data, error } = await supabase.from('financial_payments').select('*').eq('entry_id', entryId).order('created_at', { ascending: true });
  assertNoError(error, 'getFinancialPaymentsByEntry');
  return (data || []).map(mapPaymentRow);
}

async function createFinancialPayment(payload) {
  const row = {
    id: createId('pay'),
    entry_id: payload.entryId,
    amount: Number(payload.amount || 0),
    date: payload.date,
    bank_account_id: payload.bankAccountId || null,
    interest: Number(payload.interest || 0),
    fine: Number(payload.fine || 0),
    discount: Number(payload.discount || 0),
    note: payload.note || '',
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    created_at: new Date().toISOString()
  };
  const { error } = await supabase.from('financial_payments').insert(row);
  assertNoError(error, 'createFinancialPayment');
  return mapPaymentRow(row);
}

async function deleteFinancialPayment(id) {
  const { error } = await supabase.from('financial_payments').delete().eq('id', id);
  assertNoError(error, 'deleteFinancialPayment');
}

// ----------------------------------------------------------------------------
// Plano de contas / centro de custo / contas bancárias
// ----------------------------------------------------------------------------
function mapNamedRow(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function getFinancialCategories() {
  const { data, error } = await supabase.from('financial_categories').select('*').order('name', { ascending: true });
  assertNoError(error, 'getFinancialCategories');
  return (data || []).map((row) => ({ ...mapNamedRow(row), type: row.type }));
}

async function createFinancialCategory(payload) {
  const row = { id: createId('cat'), name: payload.name, type: payload.type || 'ambos', created_at: new Date().toISOString() };
  const { error } = await supabase.from('financial_categories').insert(row);
  assertNoError(error, 'createFinancialCategory');
  return { ...mapNamedRow(row), type: row.type };
}

async function getCostCenters() {
  const { data, error } = await supabase.from('cost_centers').select('*').order('name', { ascending: true });
  assertNoError(error, 'getCostCenters');
  return (data || []).map(mapNamedRow);
}

async function createCostCenter(payload) {
  const row = { id: createId('cc'), name: payload.name, created_at: new Date().toISOString() };
  const { error } = await supabase.from('cost_centers').insert(row);
  assertNoError(error, 'createCostCenter');
  return mapNamedRow(row);
}

// Colunas provider/connectionId/etc. (Fase E — Open Finance) ficam vazias pra
// conta manual, que é o único fluxo que existe até uma conexão de verdade
// existir — ver lib/openfinance/.
function mapBankAccountRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    bank: row.bank || '',
    agency: row.agency || '',
    number: row.number || '',
    createdAt: row.created_at,
    estabelecimentoId: row.estabelecimento_id || '',
    connectionId: row.connection_id || '',
    provider: row.provider || '',
    providerAccountId: row.provider_account_id || '',
    accountType: row.account_type || '',
    currency: row.currency || 'BRL',
    currentBalance: row.current_balance === null || row.current_balance === undefined ? null : Number(row.current_balance),
    availableBalance: row.available_balance === null || row.available_balance === undefined ? null : Number(row.available_balance),
    status: row.status || '',
    lastSyncAt: row.last_sync_at || ''
  };
}

async function getBankAccounts() {
  const { data, error } = await supabase.from('bank_accounts').select('*').order('name', { ascending: true });
  assertNoError(error, 'getBankAccounts');
  return (data || []).map(mapBankAccountRow);
}

async function getBankAccountById(id) {
  const { data, error } = await supabase.from('bank_accounts').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getBankAccountById');
  return mapBankAccountRow(data);
}

async function createBankAccount(payload) {
  const row = {
    id: createId('bank'),
    name: payload.name,
    bank: payload.bank || '',
    agency: payload.agency || '',
    number: payload.number || '',
    created_at: new Date().toISOString()
  };
  if (payload.estabelecimentoId) row.estabelecimento_id = payload.estabelecimentoId;
  if (payload.connectionId) row.connection_id = payload.connectionId;
  if (payload.provider) row.provider = payload.provider;
  if (payload.providerAccountId) row.provider_account_id = payload.providerAccountId;
  if (payload.accountType) row.account_type = payload.accountType;
  if (payload.currency) row.currency = payload.currency;
  if (payload.status) row.status = payload.status;
  const { error } = await supabase.from('bank_accounts').insert(row);
  assertNoError(error, 'createBankAccount');
  return mapBankAccountRow(row);
}

// Usado pela sincronização (Fase 3) pra atualizar saldo/status sem recriar a
// conta — nunca mexe em name/bank/agency/number (dados que só o usuário edita).
async function updateBankAccount(id, payload) {
  const row = {};
  if (payload.currentBalance !== undefined) row.current_balance = payload.currentBalance === null ? null : Number(payload.currentBalance);
  if (payload.availableBalance !== undefined) row.available_balance = payload.availableBalance === null ? null : Number(payload.availableBalance);
  if (payload.status !== undefined) row.status = payload.status || null;
  if (payload.lastSyncAt !== undefined) row.last_sync_at = payload.lastSyncAt;
  const { error } = await supabase.from('bank_accounts').update(row).eq('id', id);
  assertNoError(error, 'updateBankAccount');
  return getBankAccountById(id);
}

// ----------------------------------------------------------------------------
// Extrato Open Finance / Conciliação
// ----------------------------------------------------------------------------
function mapBankTransactionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankAccountId: row.bank_account_id || '',
    date: row.date,
    description: row.description,
    amount: Number(row.amount || 0),
    type: row.type,
    status: row.status,
    matchedEntryId: row.matched_entry_id || '',
    matchedPaymentId: row.matched_payment_id || '',
    source: row.source || 'manual',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    provider: row.provider || '',
    providerTransactionId: row.provider_transaction_id || '',
    processingDate: row.processing_date || '',
    direction: row.direction || '',
    category: row.category || '',
    subcategory: row.subcategory || '',
    merchantName: row.merchant_name || '',
    merchantDocument: row.merchant_document || '',
    counterpartyName: row.counterparty_name || '',
    counterpartyDocument: row.counterparty_document || '',
    paymentMethod: row.payment_method || '',
    pixKey: row.pix_key || '',
    pixEndToEndId: row.pix_end_to_end_id || '',
    pixType: row.pix_type || '',
    documentNumber: row.document_number || '',
    originalData: row.original_data || null
  };
}

async function getBankTransactions() {
  const { data, error } = await supabase.from('bank_transactions').select('*').order('date', { ascending: false });
  assertNoError(error, 'getBankTransactions');
  return (data || []).map(mapBankTransactionRow);
}

async function getBankTransactionById(id) {
  const { data, error } = await supabase.from('bank_transactions').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getBankTransactionById');
  return mapBankTransactionRow(data);
}

async function createBankTransaction(payload) {
  const row = {
    id: createId('btx'),
    bank_account_id: payload.bankAccountId || null,
    date: payload.date,
    description: payload.description,
    amount: Math.abs(Number(payload.amount || 0)),
    type: payload.type === 'saida' ? 'saida' : 'entrada',
    status: 'nao_conciliado',
    matched_entry_id: null,
    matched_payment_id: null,
    source: payload.source || 'manual',
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    created_at: new Date().toISOString()
  };
  // Campos só preenchidos por uma sincronização de verdade (Fase 3) — entrada
  // manual (Extrato/CSV) nunca passa isso, então o resto fica null por padrão.
  if (payload.provider) row.provider = payload.provider;
  if (payload.providerTransactionId) row.provider_transaction_id = payload.providerTransactionId;
  if (payload.processingDate) row.processing_date = payload.processingDate;
  if (payload.direction) row.direction = payload.direction;
  if (payload.category) row.category = payload.category;
  if (payload.subcategory) row.subcategory = payload.subcategory;
  if (payload.merchantName) row.merchant_name = payload.merchantName;
  if (payload.merchantDocument) row.merchant_document = payload.merchantDocument;
  if (payload.counterpartyName) row.counterparty_name = payload.counterpartyName;
  if (payload.counterpartyDocument) row.counterparty_document = payload.counterpartyDocument;
  if (payload.paymentMethod) row.payment_method = payload.paymentMethod;
  if (payload.pixKey) row.pix_key = payload.pixKey;
  if (payload.pixEndToEndId) row.pix_end_to_end_id = payload.pixEndToEndId;
  if (payload.pixType) row.pix_type = payload.pixType;
  if (payload.documentNumber) row.document_number = payload.documentNumber;
  if (payload.originalData) row.original_data = payload.originalData;
  const { error } = await supabase.from('bank_transactions').insert(row);
  assertNoError(error, 'createBankTransaction');
  return mapBankTransactionRow(row);
}

async function updateBankTransaction(id, payload) {
  const row = {};
  if (payload.status !== undefined) row.status = payload.status;
  if (payload.matchedEntryId !== undefined) row.matched_entry_id = payload.matchedEntryId || null;
  if (payload.matchedPaymentId !== undefined) row.matched_payment_id = payload.matchedPaymentId || null;
  const { error } = await supabase.from('bank_transactions').update(row).eq('id', id);
  assertNoError(error, 'updateBankTransaction');
  return getBankTransactionById(id);
}

// ----------------------------------------------------------------------------
// NF-e + itens
// Sem transação multi-tabela nativa no cliente supabase-js: se a inserção dos
// itens falhar depois da NF-e já ter sido gravada, a NF-e é removida (ação
// compensatória) para não deixar um registro "órfão" sem itens.
// ----------------------------------------------------------------------------
function mapNfeRow(row, items) {
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    series: row.series,
    date: row.date,
    status: row.status,
    key: row.key || '',
    amount: Number(row.amount || 0),
    customer: row.customer,
    clientSupplierId: row.client_supplier_id || '',
    clientDocument: row.client_document || '',
    clientAddress: row.client_address || '',
    clientCity: row.client_city || '',
    clientState: row.client_state || '',
    clientStateRegistration: row.client_state_registration || '',
    taxNotes: row.tax_notes || '',
    paymentType: row.payment_type,
    installmentsCount: row.installments_count,
    installmentIntervalDays: row.installment_interval_days,
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (items || []).map(mapNfeItemRow)
  };
}

function mapNfeItemRow(row) {
  return {
    id: row.id,
    code: row.code || '',
    description: row.description,
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unit_price || 0),
    total: Number(row.total || 0),
    cfop: row.cfop || '',
    ncm: row.ncm || ''
  };
}

async function getNfeById(id) {
  const { data: nfeRow, error: nfeError } = await supabase.from('nfes').select('*').eq('id', id).maybeSingle();
  assertNoError(nfeError, 'getNfeById');
  if (!nfeRow) return null;
  const { data: items, error: itemsError } = await supabase.from('nfe_items').select('*').eq('nfe_id', id);
  assertNoError(itemsError, 'getNfeById(items)');
  return mapNfeRow(nfeRow, items);
}

async function getNfes() {
  const { data, error } = await supabase.from('nfes').select('*').order('date', { ascending: false });
  assertNoError(error, 'getNfes');
  const nfes = await Promise.all((data || []).map((row) => getNfeById(row.id)));
  return nfes;
}

async function createNfe(payload, items) {
  const id = createId('nfe');
  const now = new Date().toISOString();
  const row = {
    id,
    number: payload.number,
    series: payload.series || '1',
    date: payload.date,
    status: payload.status || 'autorizada',
    key: payload.key || '',
    amount: Number(payload.amount || 0),
    customer: payload.customer,
    client_supplier_id: payload.clientSupplierId || null,
    client_document: payload.clientDocument || '',
    client_address: payload.clientAddress || '',
    client_city: payload.clientCity || '',
    client_state: payload.clientState || '',
    client_state_registration: payload.clientStateRegistration || '',
    tax_notes: payload.taxNotes || '',
    payment_type: payload.paymentType || 'avista',
    installments_count: payload.installmentsCount || 1,
    installment_interval_days: payload.installmentIntervalDays || 30,
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    created_at: now,
    updated_at: now
  };
  const { error: nfeError } = await supabase.from('nfes').insert(row);
  assertNoError(nfeError, 'createNfe');

  const itemRows = (items || []).map((item) => ({
    id: createId('nfeitem'),
    nfe_id: id,
    code: item.code || '',
    description: item.description,
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unitPrice || 0),
    total: Number(item.total || 0),
    cfop: item.cfop || '',
    ncm: item.ncm || ''
  }));

  if (itemRows.length) {
    const { error: itemsError } = await supabase.from('nfe_items').insert(itemRows);
    if (itemsError) {
      await supabase.from('nfes').delete().eq('id', id);
      assertNoError(itemsError, 'createNfe(items)');
    }
  }

  return getNfeById(id);
}

async function updateNfe(id, payload) {
  const row = { updated_at: new Date().toISOString() };
  if (payload.status !== undefined) row.status = payload.status;
  const { error } = await supabase.from('nfes').update(row).eq('id', id);
  assertNoError(error, 'updateNfe');
  return getNfeById(id);
}

module.exports = {
  getFinancialEntries, getFinancialEntryById, createFinancialEntry, updateFinancialEntry,
  getFinancialPaymentsByEntry, createFinancialPayment, deleteFinancialPayment,
  getFinancialCategories, createFinancialCategory,
  getCostCenters, createCostCenter,
  getBankAccounts, getBankAccountById, createBankAccount, updateBankAccount,
  getBankTransactions, getBankTransactionById, createBankTransaction, updateBankTransaction,
  getNfes, getNfeById, createNfe, updateNfe
};
