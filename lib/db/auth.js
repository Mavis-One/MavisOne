const bcrypt = require('bcryptjs');
const { supabase, createId, assertNoError } = require('./client');

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    allowedModules: row.allowed_modules || [],
    fiscalPermissions: row.fiscal_permissions || [],
    theme: row.theme,
    dashboardPins: row.dashboard_pins || [],
    // Fase L. `?? true` e não `|| true`: se a coluna existir e valer false, o
    // usuário está bloqueado de verdade; se ainda não existir (migração
    // pendente), ninguém fica trancado para fora.
    active: row.active ?? true,
    lastLoginAt: row.last_login_at || null
  };
}

// Devolve o usuário mesmo bloqueado — quem chama decide o que dizer. Login
// bloqueado e senha errada precisam de tratamento diferente: um vira aviso de
// conta suspensa na tela, o outro não pode revelar que o usuário existe.
async function authenticateUser(username, password) {
  const { data, error } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
  assertNoError(error, 'authenticateUser');
  if (!data || !bcrypt.compareSync(password, data.password_hash)) {
    return null;
  }
  return mapUserRow(data);
}

// Coluna da Fase L: se a migração ainda não rodou, a gravação falha e é
// ignorada — registrar o último login não pode impedir o login.
async function registrarLogin(id) {
  const { error } = await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', id);
  if (error) console.warn('[login] não foi possível gravar o último acesso:', error.message);
}

async function definirUsuarioAtivo(id, ativo) {
  const { error } = await supabase.from('users').update({ active: Boolean(ativo) }).eq('id', id);
  assertNoError(error, 'definirUsuarioAtivo');
  return getUserById(id);
}

async function getUserById(id) {
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getUserById');
  return mapUserRow(data);
}

async function getUsers() {
  const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true });
  assertNoError(error, 'getUsers');
  return (data || []).map(mapUserRow);
}

async function createUser(payload) {
  const id = payload.id || createId('user');
  const passwordHash = bcrypt.hashSync(payload.password, 10);
  const { error } = await supabase.from('users').insert({
    id,
    username: payload.username,
    password_hash: passwordHash,
    name: payload.name,
    role: payload.role || 'user',
    allowed_modules: payload.allowedModules || ['dashboard'],
    fiscal_permissions: payload.fiscalPermissions || [],
    theme: 'light',
    dashboard_pins: payload.dashboardPins || []
  });
  assertNoError(error, 'createUser');
  return getUserById(id);
}

async function deleteUser(id) {
  const { error } = await supabase.from('users').delete().eq('id', id);
  assertNoError(error, 'deleteUser');
}

async function updateUser(id, payload) {
  const updates = {
    name: payload.name,
    role: payload.role,
    allowed_modules: payload.allowedModules || []
  };
  if (payload.fiscalPermissions !== undefined) {
    updates.fiscal_permissions = payload.fiscalPermissions || [];
  }
  if (payload.password) {
    updates.password_hash = bcrypt.hashSync(payload.password, 10);
  }
  const { error } = await supabase.from('users').update(updates).eq('id', id);
  assertNoError(error, 'updateUser');
  return getUserById(id);
}

async function updateUserTheme(id, theme) {
  const { error } = await supabase.from('users').update({ theme }).eq('id', id);
  assertNoError(error, 'updateUserTheme');
}

async function updateUserDashboardPins(id, dashboardPins) {
  const { error } = await supabase.from('users').update({ dashboard_pins: dashboardPins }).eq('id', id);
  assertNoError(error, 'updateUserDashboardPins');
}

module.exports = {
  authenticateUser, getUserById, getUsers, createUser, deleteUser, updateUser,
  updateUserTheme, updateUserDashboardPins, registrarLogin, definirUsuarioAtivo
};
