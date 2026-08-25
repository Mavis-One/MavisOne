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
    // Fase AL -- qual VENDEDOR do Cadastros este usuario e'. E o que decide
    // de quem sao as "minhas vendas" no Relatorio de Vendas. Vazio quando nao
    // ha vinculo (ou quando a coluna ainda nao existe): nesse caso o usuario
    // comum nao ve venda nenhuma, nunca todas.
    sellerId: row.seller_id || '',
    fiscalPermissions: row.fiscal_permissions || [],
    theme: row.theme,
    dashboardPins: row.dashboard_pins || [],
    // Preferencias de tela (fase-ag). Objeto vazio quando a coluna ainda nao
    // existe: a tela cai no padrao em vez de quebrar.
    preferences: row.preferences && typeof row.preferences === 'object' ? row.preferences : {},
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
    ...(payload.sellerId ? { seller_id: payload.sellerId } : {}),
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
  // `undefined` (campo ausente) NAO e' o mesmo que '' (desvincular): sem esta
  // distincao, qualquer salvamento vindo de uma tela sem o campo apagaria o
  // vinculo, e o vendedor deixaria de ver as proprias vendas sem ninguem ter
  // pedido isso.
  if (payload.sellerId !== undefined) {
    updates.seller_id = String(payload.sellerId || '').trim() || null;
  }
  if (payload.password) {
    updates.password_hash = bcrypt.hashSync(payload.password, 10);
  }
  const { error } = await supabase.from('users').update(updates).eq('id', id);
  // Sem a fase-AL a coluna seller_id nao existe, e o PostgREST recusa o UPDATE
  // inteiro por causa dela -- ou seja, mexer em NOME de usuario passaria a
  // falhar por causa de um campo que a pessoa nem viu. Diz o que fazer em vez
  // de devolver "erro ao atualizar usuario".
  if (error && /seller_id/.test(error.message || "")) {
    const err = new Error("A coluna do vinculo com o vendedor ainda nao existe no banco. Rode supabase/migrations/fase-al-usuario-vendedor.sql no SQL Editor do Supabase.");
    err.status = 503;
    throw err;
  }
  assertNoError(error, 'updateUser');
  return getUserById(id);
}

async function updateUserTheme(id, theme) {
  const { error } = await supabase.from('users').update({ theme }).eq('id', id);
  assertNoError(error, 'updateUserTheme');
}

// Grava a preferencia de UMA tela, preservando as demais. Mandar o objeto
// inteiro do cliente deixaria uma tela apagar a preferencia de outra.
//
// Coluna ausente (fase-ag nao rodada) NAO e erro: a tela continua funcionando
// no padrao, e quem quiser guardar roda a migracao. Quebrar o login inteiro por
// causa de uma preferencia de coluna seria trocar um incomodo por um bloqueio.
async function updateUserPreference(id, tela, valor) {
  const { data: atual, error: erroLeitura } = await supabase.from('users').select('preferences').eq('id', id).maybeSingle();
  if (erroLeitura && /does not exist|Could not find|schema cache/i.test(erroLeitura.message || '')) return null;
  assertNoError(erroLeitura, 'updateUserPreference (leitura)');
  const preferences = { ...(atual?.preferences || {}), [tela]: valor };
  const { error } = await supabase.from('users').update({ preferences }).eq('id', id);
  if (error && /does not exist|Could not find|schema cache/i.test(error.message || '')) return null;
  assertNoError(error, 'updateUserPreference');
  return preferences;
}

async function updateUserDashboardPins(id, dashboardPins) {
  const { error } = await supabase.from('users').update({ dashboard_pins: dashboardPins }).eq('id', id);
  assertNoError(error, 'updateUserDashboardPins');
}

module.exports = {
  authenticateUser, getUserById, getUsers, createUser, deleteUser, updateUser,
  updateUserTheme, updateUserDashboardPins, updateUserPreference, registrarLogin, definirUsuarioAtivo
};
