// Acesso a dados do módulo Open Finance (tabelas da Fase E em banco/schema.sql).
// Mesmo padrão de lib/db/fiscal.js: mapXRow() traduz snake_case -> camelCase,
// credenciais de conexão ficam cifradas em repouso (lib/secrets.js) com
// chave própria (OPEN_FINANCE_ENCRYPTION_KEY, independente da Focus NFe).
const { banco, assertNoError } = require('./client');
const { encryptToBytea, decryptFromBytea } = require('../secrets');

const CREDENTIALS_KEY_ENV_VAR = 'OPEN_FINANCE_ENCRYPTION_KEY';

// ----------------------------------------------------------------------------
// Instituições financeiras (catálogo de bancos por provider)
// ----------------------------------------------------------------------------
function mapInstitutionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    providerInstitutionId: row.provider_institution_id,
    name: row.name,
    imageUrl: row.image_url,
    type: row.type,
    createdAt: row.created_at
  };
}

async function getInstitutions(provider) {
  let query = banco.from('financial_institutions').select('*').order('name', { ascending: true });
  if (provider) query = query.eq('provider', provider);
  const { data, error } = await query;
  assertNoError(error, 'getInstitutions');
  return (data || []).map(mapInstitutionRow);
}

// Cache local do catálogo de instituições que o provider devolve — chamado
// depois de uma consulta ao provider real (Fase 6), nunca inventa dado.
async function upsertInstitution(payload) {
  const { data, error } = await banco.from('financial_institutions').upsert({
    provider: payload.provider,
    provider_institution_id: payload.providerInstitutionId,
    name: payload.name,
    image_url: payload.imageUrl || null,
    type: payload.type || null
  }, { onConflict: 'provider,provider_institution_id' }).select().single();
  assertNoError(error, 'upsertInstitution');
  return mapInstitutionRow(data);
}

// ----------------------------------------------------------------------------
// Conexões (vínculo estabelecimento <-> banco via um provider)
// ----------------------------------------------------------------------------
function mapConnectionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    estabelecimentoId: row.estabelecimento_id,
    provider: row.provider,
    providerConnectionId: row.provider_connection_id,
    institutionId: row.institution_id,
    status: row.status,
    credentialsConfigured: Boolean(row.credentials_encrypted),
    errorMessage: row.error_message,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getConnections(estabelecimentoId) {
  let query = banco.from('open_finance_connections').select('*').order('created_at', { ascending: false });
  if (estabelecimentoId) query = query.eq('estabelecimento_id', estabelecimentoId);
  const { data, error } = await query;
  assertNoError(error, 'getConnections');
  return (data || []).map(mapConnectionRow);
}

async function getConnectionById(id) {
  const { data, error } = await banco.from('open_finance_connections').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getConnectionById');
  return mapConnectionRow(data);
}

async function createConnection(payload) {
  const fields = {
    estabelecimento_id: payload.estabelecimentoId,
    provider: payload.provider,
    provider_connection_id: payload.providerConnectionId || null,
    institution_id: payload.institutionId || null,
    status: payload.status || 'pending'
  };
  if (payload.credentials) {
    fields.credentials_encrypted = encryptToBytea(JSON.stringify(payload.credentials), CREDENTIALS_KEY_ENV_VAR);
  }
  const { data, error } = await banco.from('open_finance_connections').insert(fields).select().single();
  assertNoError(error, 'createConnection');
  return mapConnectionRow(data);
}

async function updateConnection(id, payload) {
  const fields = { updated_at: new Date().toISOString() };
  if (payload.providerConnectionId !== undefined) fields.provider_connection_id = payload.providerConnectionId || null;
  if (payload.institutionId !== undefined) fields.institution_id = payload.institutionId || null;
  if (payload.status !== undefined) fields.status = payload.status;
  if (payload.errorMessage !== undefined) fields.error_message = payload.errorMessage || null;
  if (payload.lastSyncAt !== undefined) fields.last_sync_at = payload.lastSyncAt;
  if (payload.credentials !== undefined) {
    fields.credentials_encrypted = payload.credentials ? encryptToBytea(JSON.stringify(payload.credentials), CREDENTIALS_KEY_ENV_VAR) : null;
  }
  const { data, error } = await banco.from('open_finance_connections').update(fields).eq('id', id).select().single();
  assertNoError(error, 'updateConnection');
  return mapConnectionRow(data);
}

// Uso interno (lib/openfinance/*) — nunca expor via rota HTTP direta.
async function getConnectionCredentials(id) {
  const { data, error } = await banco.from('open_finance_connections').select('credentials_encrypted').eq('id', id).maybeSingle();
  assertNoError(error, 'getConnectionCredentials');
  if (!data || !data.credentials_encrypted) return null;
  const raw = decryptFromBytea(data.credentials_encrypted, CREDENTIALS_KEY_ENV_VAR);
  return raw ? JSON.parse(raw) : null;
}

// ----------------------------------------------------------------------------
// Histórico de saldo — só insere, nunca sobrescreve.
// ----------------------------------------------------------------------------
function mapAccountBalanceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    currentBalance: Number(row.current_balance || 0),
    availableBalance: row.available_balance === null || row.available_balance === undefined ? null : Number(row.available_balance),
    capturedAt: row.captured_at
  };
}

async function recordAccountBalance(payload) {
  const { data, error } = await banco.from('account_balances').insert({
    account_id: payload.accountId,
    current_balance: Number(payload.currentBalance || 0),
    available_balance: payload.availableBalance === undefined || payload.availableBalance === null ? null : Number(payload.availableBalance)
  }).select().single();
  assertNoError(error, 'recordAccountBalance');
  return mapAccountBalanceRow(data);
}

async function getAccountBalanceHistory(accountId, limit) {
  const { data, error } = await banco.from('account_balances')
    .select('*')
    .eq('account_id', accountId)
    .order('captured_at', { ascending: false })
    .limit(limit || 90);
  assertNoError(error, 'getAccountBalanceHistory');
  return (data || []).map(mapAccountBalanceRow);
}

// ----------------------------------------------------------------------------
// Cartões e transações de cartão
// ----------------------------------------------------------------------------
function mapCardRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connection_id,
    providerCardId: row.provider_card_id,
    brand: row.brand,
    last4: row.last4,
    type: row.type,
    createdAt: row.created_at
  };
}

async function getCardsByConnection(connectionId) {
  const { data, error } = await banco.from('bank_cards').select('*').eq('connection_id', connectionId).order('created_at', { ascending: true });
  assertNoError(error, 'getCardsByConnection');
  return (data || []).map(mapCardRow);
}

async function upsertCard(payload) {
  const { data, error } = await banco.from('bank_cards').upsert({
    connection_id: payload.connectionId,
    provider_card_id: payload.providerCardId,
    brand: payload.brand || null,
    last4: payload.last4 || null,
    type: payload.type || null
  }, { onConflict: 'connection_id,provider_card_id' }).select().single();
  assertNoError(error, 'upsertCard');
  return mapCardRow(data);
}

function mapCardTransactionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    cardId: row.card_id,
    providerTransactionId: row.provider_transaction_id,
    amount: Number(row.amount || 0),
    currency: row.currency,
    description: row.description,
    date: row.date,
    installments: row.installments,
    originalData: row.original_data,
    createdAt: row.created_at
  };
}

async function getCardTransactions(cardId) {
  const { data, error } = await banco.from('card_transactions').select('*').eq('card_id', cardId).order('date', { ascending: false });
  assertNoError(error, 'getCardTransactions');
  return (data || []).map(mapCardTransactionRow);
}

// Idempotente: a mesma provider_transaction_id pro mesmo card_id nunca duplica.
async function upsertCardTransaction(payload) {
  const { data, error } = await banco.from('card_transactions').upsert({
    card_id: payload.cardId,
    provider_transaction_id: payload.providerTransactionId || null,
    amount: Number(payload.amount || 0),
    currency: payload.currency || 'BRL',
    description: payload.description || null,
    date: payload.date,
    installments: payload.installments === undefined || payload.installments === null ? null : Number(payload.installments),
    original_data: payload.originalData || null
  }, { onConflict: 'card_id,provider_transaction_id' }).select().single();
  assertNoError(error, 'upsertCardTransaction');
  return mapCardTransactionRow(data);
}

// ----------------------------------------------------------------------------
// Eventos de webhook — gravado antes de qualquer processamento.
// ----------------------------------------------------------------------------
function mapWebhookEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    connectionId: row.connection_id,
    providerEventId: row.provider_event_id,
    payload: row.payload,
    processed: row.processed,
    error: row.error,
    receivedAt: row.received_at
  };
}

// Idempotente por (provider, provider_event_id): providers de webhook
// costumam reenviar o mesmo evento se não recebem um 2xx rápido o
// suficiente. Em vez de deixar a violação da unique constraint virar erro
// genérico, reconhece a duplicata e devolve o evento já gravado (que já
// pode estar com processed=true — quem chama decide se pula o reprocessamento).
async function recordWebhookEvent(payload) {
  const { data, error } = await banco.from('open_finance_webhook_events').insert({
    provider: payload.provider,
    connection_id: payload.connectionId || null,
    provider_event_id: payload.providerEventId || null,
    payload: payload.payload,
    processed: false
  }).select().single();

  if (error && error.code === '23505' && payload.providerEventId) {
    const { data: existente, error: buscaError } = await banco.from('open_finance_webhook_events')
      .select('*')
      .eq('provider', payload.provider)
      .eq('provider_event_id', payload.providerEventId)
      .maybeSingle();
    assertNoError(buscaError, 'recordWebhookEvent (busca duplicata)');
    return mapWebhookEventRow(existente);
  }
  assertNoError(error, 'recordWebhookEvent');
  return mapWebhookEventRow(data);
}

async function markWebhookEventProcessed(id, error) {
  const { data, error: dbError } = await banco.from('open_finance_webhook_events').update({
    processed: !error,
    error: error || null
  }).eq('id', id).select().single();
  assertNoError(dbError, 'markWebhookEventProcessed');
  return mapWebhookEventRow(data);
}

// ----------------------------------------------------------------------------
// Auditoria específica do Open Finance
// ----------------------------------------------------------------------------
function mapAuditLogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connection_id,
    estabelecimentoId: row.estabelecimento_id,
    action: row.action,
    byId: row.by_id,
    byName: row.by_name,
    details: row.details,
    createdAt: row.created_at
  };
}

async function recordAuditLog(payload) {
  const { data, error } = await banco.from('open_finance_audit_logs').insert({
    connection_id: payload.connectionId || null,
    estabelecimento_id: payload.estabelecimentoId || null,
    action: payload.action,
    by_id: payload.byId || null,
    by_name: payload.byName || null,
    details: payload.details || null
  }).select().single();
  assertNoError(error, 'recordAuditLog');
  return mapAuditLogRow(data);
}

async function getAuditLogs({ connectionId, limit } = {}) {
  let query = banco.from('open_finance_audit_logs').select('*').order('created_at', { ascending: false }).limit(limit || 200);
  if (connectionId) query = query.eq('connection_id', connectionId);
  const { data, error } = await query;
  assertNoError(error, 'getAuditLogs');
  return (data || []).map(mapAuditLogRow);
}

module.exports = {
  getInstitutions,
  upsertInstitution,
  getConnections,
  getConnectionById,
  createConnection,
  updateConnection,
  getConnectionCredentials,
  recordAccountBalance,
  getAccountBalanceHistory,
  getCardsByConnection,
  upsertCard,
  getCardTransactions,
  upsertCardTransaction,
  recordWebhookEvent,
  markWebhookEventProcessed,
  recordAuditLog,
  getAuditLogs
};
