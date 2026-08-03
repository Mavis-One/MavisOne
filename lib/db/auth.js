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
    theme: row.theme
  };
}

async function authenticateUser(username, password) {
  const { data, error } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
  assertNoError(error, 'authenticateUser');
  if (!data || !bcrypt.compareSync(password, data.password_hash)) {
    return null;
  }
  return mapUserRow(data);
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
    theme: 'light'
  });
  assertNoError(error, 'createUser');
  return getUserById(id);
}

async function deleteUser(id) {
  const { error } = await supabase.from('users').delete().eq('id', id);
  assertNoError(error, 'deleteUser');
}

async function updateUserTheme(id, theme) {
  const { error } = await supabase.from('users').update({ theme }).eq('id', id);
  assertNoError(error, 'updateUserTheme');
}

module.exports = { authenticateUser, getUserById, getUsers, createUser, deleteUser, updateUserTheme };
