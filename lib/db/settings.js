const { supabase, createId, assertNoError } = require('./client');

function mapSettingsRow(row) {
  if (!row) return { companyName: 'MavisONE', currency: 'BRL', taxRate: 0 };
  return {
    companyName: row.company_name,
    currency: row.currency,
    taxRate: Number(row.tax_rate || 0)
  };
}

async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  assertNoError(error, 'getSettings');
  return mapSettingsRow(data);
}

async function updateSettings(payload) {
  const { error } = await supabase.from('settings').upsert({
    id: 1,
    company_name: payload.companyName,
    currency: payload.currency,
    tax_rate: Number(payload.taxRate || 0)
  });
  assertNoError(error, 'updateSettings');
  return getSettings();
}

function mapAuditLogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    action: row.action,
    targetId: row.target_id,
    targetUsername: row.target_username,
    byId: row.by_id,
    byName: row.by_name,
    at: row.at,
    details: row.details || null
  };
}

async function addAuditLog({ action, targetId, targetUsername, byId, byName, details }) {
  const row = {
    id: createId('audit'),
    action,
    target_id: targetId,
    target_username: targetUsername,
    by_id: byId,
    by_name: byName,
    at: new Date().toISOString(),
    details: details || null
  };
  const { error } = await supabase.from('audit_logs').insert(row);
  assertNoError(error, 'addAuditLog');
  return mapAuditLogRow(row);
}

async function getAuditLogs({ limit = 50, offset = 0 } = {}) {
  const { data, error, count } = await supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('at', { ascending: false })
    .range(offset, offset + limit - 1);
  assertNoError(error, 'getAuditLogs');
  return { auditLogs: (data || []).map(mapAuditLogRow), total: count || 0 };
}

module.exports = { getSettings, updateSettings, addAuditLog, getAuditLogs };
