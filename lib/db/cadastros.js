const { banco, createId, assertNoError } = require('./client');

// "people" e "cnpjs" têm dezenas de campos opcionais no formulário de Cadastros
// (endereço de cobrança/entrega, dados bancários, whatsapp, papéis, etc.).
// Só os campos abaixo viram coluna própria (o que hoje é filtrado/buscado);
// o resto é preservado inteiro em "extra" (jsonb), sem precisar enumerar tudo.
const PEOPLE_CORE_FIELDS = ['id', 'code', 'type', 'name', 'tradeName', 'document', 'email', 'phone', 'status', 'city', 'state', 'zipCode', 'createdAt'];
const CNPJ_CORE_FIELDS = ['id', 'code', 'type', 'name', 'tradeName', 'document', 'email', 'phone', 'status', 'registrationStatus', 'city', 'state', 'createdAt'];

function splitCoreAndExtra(payload, coreFields) {
  const core = {};
  const extra = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (coreFields.includes(key)) {
      core[key] = value;
    } else {
      extra[key] = value;
    }
  });
  return { core, extra };
}

function mapPersonRow(row) {
  if (!row) return null;
  return {
    ...(row.extra || {}),
    id: row.id,
    code: row.code,
    type: row.type,
    name: row.name,
    tradeName: row.trade_name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    status: row.status,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    createdAt: row.created_at
  };
}

function mapCnpjRow(row) {
  if (!row) return null;
  return {
    ...(row.extra || {}),
    id: row.id,
    code: row.code,
    type: row.type,
    name: row.name,
    tradeName: row.trade_name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    status: row.status,
    registrationStatus: row.registration_status,
    city: row.city,
    state: row.state,
    createdAt: row.created_at
  };
}

async function getNextCadastroCode() {
  const { data, error } = await banco.rpc('next_cadastro_code');
  assertNoError(error, 'getNextCadastroCode');
  return data;
}

async function getPeople() {
  const { data, error } = await banco.from('people').select('*').order('created_at', { ascending: false });
  assertNoError(error, 'getPeople');
  return (data || []).map(mapPersonRow);
}

async function getPersonById(id) {
  const { data, error } = await banco.from('people').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getPersonById');
  return mapPersonRow(data);
}

async function createPerson(payload) {
  const id = payload.id || createId('pes');
  const code = payload.code || await getNextCadastroCode();
  const { core, extra } = splitCoreAndExtra({ ...payload, id, code }, PEOPLE_CORE_FIELDS);
  const row = {
    id: core.id,
    code: core.code,
    type: core.type || 'pessoa-fisica',
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    city: core.city || '',
    state: core.state || '',
    zip_code: core.zipCode || '',
    extra
  };
  const { error } = await banco.from('people').insert(row);
  assertNoError(error, 'createPerson');
  return getPersonById(id);
}

async function updatePerson(id, payload) {
  const current = await getPersonById(id);
  if (!current) return null;
  const merged = { ...current, ...payload, id, code: current.code };
  const { core, extra } = splitCoreAndExtra(merged, PEOPLE_CORE_FIELDS);
  const row = {
    type: core.type,
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    city: core.city || '',
    state: core.state || '',
    zip_code: core.zipCode || '',
    extra
  };
  const { error } = await banco.from('people').update(row).eq('id', id);
  assertNoError(error, 'updatePerson');
  return getPersonById(id);
}

async function deletePerson(id) {
  const { error } = await banco.from('people').delete().eq('id', id);
  assertNoError(error, 'deletePerson');
}

async function getCnpjs() {
  const { data, error } = await banco.from('cnpjs').select('*').order('created_at', { ascending: false });
  assertNoError(error, 'getCnpjs');
  return (data || []).map(mapCnpjRow);
}

async function getCnpjById(id) {
  const { data, error } = await banco.from('cnpjs').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getCnpjById');
  return mapCnpjRow(data);
}

async function createCnpj(payload) {
  const id = payload.id || createId('cnpj');
  const code = payload.code || await getNextCadastroCode();
  const { core, extra } = splitCoreAndExtra({ ...payload, id, code }, CNPJ_CORE_FIELDS);
  const row = {
    id: core.id,
    code: core.code,
    type: 'pessoa-juridica',
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    registration_status: core.registrationStatus || '',
    city: core.city || '',
    state: core.state || '',
    extra
  };
  const { error } = await banco.from('cnpjs').insert(row);
  assertNoError(error, 'createCnpj');
  return getCnpjById(id);
}

async function updateCnpj(id, payload) {
  const current = await getCnpjById(id);
  if (!current) return null;
  const merged = { ...current, ...payload, id, code: current.code };
  const { core, extra } = splitCoreAndExtra(merged, CNPJ_CORE_FIELDS);
  const row = {
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    registration_status: core.registrationStatus || '',
    city: core.city || '',
    state: core.state || '',
    extra
  };
  const { error } = await banco.from('cnpjs').update(row).eq('id', id);
  assertNoError(error, 'updateCnpj');
  return getCnpjById(id);
}

async function deleteCnpj(id) {
  const { error } = await banco.from('cnpjs').delete().eq('id', id);
  assertNoError(error, 'deleteCnpj');
}

function mapDepositRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    address: row.address,
    city: row.city,
    state: row.state,
    manager: row.manager,
    notes: row.notes,
    createdAt: row.created_at
  };
}

async function getDeposits() {
  const { data, error } = await banco.from('deposits').select('*').order('created_at', { ascending: false });
  assertNoError(error, 'getDeposits');
  return (data || []).map(mapDepositRow);
}

async function createDeposit(payload) {
  const row = {
    id: createId('dep'),
    name: payload.name,
    code: payload.code || '',
    status: payload.status || 'ativo',
    address: payload.address || '',
    city: payload.city || '',
    state: payload.state || '',
    manager: payload.manager || '',
    notes: payload.notes || ''
  };
  const { error } = await banco.from('deposits').insert(row);
  assertNoError(error, 'createDeposit');
  return mapDepositRow(row);
}

async function updateDeposit(id, payload) {
  const row = {
    name: payload.name,
    code: payload.code || '',
    status: payload.status || 'ativo',
    address: payload.address || '',
    city: payload.city || '',
    state: payload.state || '',
    manager: payload.manager || '',
    notes: payload.notes || ''
  };
  const { data, error } = await banco.from('deposits').update(row).eq('id', id).select().maybeSingle();
  assertNoError(error, 'updateDeposit');
  return mapDepositRow(data);
}

async function deleteDeposit(id) {
  const { error } = await banco.from('deposits').delete().eq('id', id);
  assertNoError(error, 'deleteDeposit');
}

module.exports = {
  getPeople, getPersonById, createPerson, updatePerson, deletePerson,
  getCnpjs, getCnpjById, createCnpj, updateCnpj, deleteCnpj,
  getDeposits, createDeposit, updateDeposit, deleteDeposit,
  getNextCadastroCode
};
