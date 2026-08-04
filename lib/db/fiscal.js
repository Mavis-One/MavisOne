const { supabase, assertNoError } = require('./client');
const { encryptToBytea, decryptFromBytea } = require('../secrets');

function mapEmpresaRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    grupoEconomicoId: row.grupo_economico_id,
    cnpjRaiz: row.cnpj_raiz,
    razaoSocial: row.razao_social,
    regimeTributario: row.regime_tributario,
    crt: row.crt,
    aliquotaCreditoIcmsSn: row.aliquota_credito_icms_sn,
    aliquotaSnVigencia: row.aliquota_sn_vigencia,
    opcaoTransferenciaTributada: row.opcao_transferencia_tributada,
    eImportadora: row.e_importadora,
    ativo: row.ativo,
    criadoEm: row.criado_em
  };
}

// Nunca devolve o token descriptografado pro front — só se está configurado.
function mapEstabelecimentoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    cnpj: row.cnpj,
    ordem: row.ordem,
    tipo: row.tipo,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    email: row.email,
    telefone: row.telefone,
    inscricaoEstadual: row.inscricao_estadual,
    inscricaoEstadualSt: row.inscricao_estadual_st,
    inscricaoMunicipal: row.inscricao_municipal,
    cnaePrincipal: row.cnae_principal,
    logradouro: row.logradouro,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    codigoMunicipio: row.codigo_municipio,
    municipio: row.municipio,
    uf: row.uf,
    cep: row.cep,
    focusTokenConfigured: Boolean(row.focus_token_cifrado),
    focusAmbiente: row.focus_ambiente,
    focusCadastradoEm: row.focus_cadastrado_em,
    emiteNfe: row.emite_nfe,
    emiteNfce: row.emite_nfce,
    ativo: row.ativo,
    criadoEm: row.criado_em
  };
}

function mapCertificadoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    tipo: row.tipo,
    titularCnpj: row.titular_cnpj,
    validoDe: row.valido_de,
    validoAte: row.valido_ate,
    enviadoFocusEm: row.enviado_focus_em,
    substituidoPorId: row.substituido_por_id,
    criadoEm: row.criado_em
  };
}

async function getEmpresas() {
  const { data, error } = await supabase.from('empresa').select('*').order('razao_social', { ascending: true });
  assertNoError(error, 'getEmpresas');
  return (data || []).map(mapEmpresaRow);
}

async function getEmpresaById(id) {
  const { data, error } = await supabase.from('empresa').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getEmpresaById');
  return mapEmpresaRow(data);
}

async function createEmpresa(payload) {
  const { data, error } = await supabase.from('empresa').insert({
    cnpj_raiz: payload.cnpjRaiz,
    razao_social: payload.razaoSocial,
    regime_tributario: payload.regimeTributario,
    crt: payload.crt,
    aliquota_credito_icms_sn: payload.aliquotaCreditoIcmsSn || null,
    aliquota_sn_vigencia: payload.aliquotaSnVigencia || null,
    opcao_transferencia_tributada: Boolean(payload.opcaoTransferenciaTributada),
    e_importadora: Boolean(payload.eImportadora)
  }).select().single();
  assertNoError(error, 'createEmpresa');
  return mapEmpresaRow(data);
}

async function updateEmpresa(id, payload) {
  const { data, error } = await supabase.from('empresa').update({
    razao_social: payload.razaoSocial,
    regime_tributario: payload.regimeTributario,
    crt: payload.crt,
    aliquota_credito_icms_sn: payload.aliquotaCreditoIcmsSn || null,
    aliquota_sn_vigencia: payload.aliquotaSnVigencia || null,
    opcao_transferencia_tributada: Boolean(payload.opcaoTransferenciaTributada),
    e_importadora: Boolean(payload.eImportadora),
    ativo: payload.ativo !== undefined ? Boolean(payload.ativo) : undefined
  }).eq('id', id).select().single();
  assertNoError(error, 'updateEmpresa');
  return mapEmpresaRow(data);
}

async function deleteEmpresa(id) {
  const { error } = await supabase.from('empresa').delete().eq('id', id);
  assertNoError(error, 'deleteEmpresa');
}

async function getEstabelecimentos(empresaId) {
  let query = supabase.from('estabelecimento').select('*').order('ordem', { ascending: true });
  if (empresaId) query = query.eq('empresa_id', empresaId);
  const { data, error } = await query;
  assertNoError(error, 'getEstabelecimentos');
  return (data || []).map(mapEstabelecimentoRow);
}

async function getEstabelecimentoById(id) {
  const { data, error } = await supabase.from('estabelecimento').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getEstabelecimentoById');
  return mapEstabelecimentoRow(data);
}

function buildEstabelecimentoFields(payload) {
  const fields = {
    empresa_id: payload.empresaId,
    cnpj: payload.cnpj,
    ordem: payload.ordem,
    tipo: payload.tipo,
    razao_social: payload.razaoSocial,
    nome_fantasia: payload.nomeFantasia || null,
    email: payload.email || null,
    telefone: payload.telefone || null,
    inscricao_estadual: payload.inscricaoEstadual,
    inscricao_estadual_st: payload.inscricaoEstadualSt || null,
    inscricao_municipal: payload.inscricaoMunicipal || null,
    cnae_principal: payload.cnaePrincipal,
    logradouro: payload.logradouro,
    numero: payload.numero,
    complemento: payload.complemento || null,
    bairro: payload.bairro,
    codigo_municipio: payload.codigoMunicipio,
    municipio: payload.municipio,
    uf: payload.uf,
    cep: payload.cep,
    focus_ambiente: payload.focusAmbiente || 'homologacao',
    emite_nfe: payload.emiteNfe !== undefined ? Boolean(payload.emiteNfe) : true,
    emite_nfce: Boolean(payload.emiteNfce)
  };
  if (payload.focusToken) {
    fields.focus_token_cifrado = encryptToBytea(payload.focusToken);
    fields.focus_cadastrado_em = new Date().toISOString();
  }
  return fields;
}

async function createEstabelecimento(payload) {
  const { data, error } = await supabase.from('estabelecimento').insert(buildEstabelecimentoFields(payload)).select().single();
  assertNoError(error, 'createEstabelecimento');
  return mapEstabelecimentoRow(data);
}

async function updateEstabelecimento(id, payload) {
  const fields = buildEstabelecimentoFields(payload);
  if (payload.ativo !== undefined) fields.ativo = Boolean(payload.ativo);
  const { data, error } = await supabase.from('estabelecimento').update(fields).eq('id', id).select().single();
  assertNoError(error, 'updateEstabelecimento');
  return mapEstabelecimentoRow(data);
}

async function deleteEstabelecimento(id) {
  const { error } = await supabase.from('estabelecimento').delete().eq('id', id);
  assertNoError(error, 'deleteEstabelecimento');
}

// Uso interno (lib/focusnfe.js) — nunca expor via rota HTTP direta.
async function getEstabelecimentoFocusCredentials(id) {
  const { data, error } = await supabase.from('estabelecimento').select('focus_token_cifrado, focus_ambiente').eq('id', id).maybeSingle();
  assertNoError(error, 'getEstabelecimentoFocusCredentials');
  if (!data || !data.focus_token_cifrado) return null;
  return { token: decryptFromBytea(data.focus_token_cifrado), ambiente: data.focus_ambiente };
}

async function getCertificados(empresaId) {
  let query = supabase.from('certificado_digital').select('*').order('valido_ate', { ascending: false });
  if (empresaId) query = query.eq('empresa_id', empresaId);
  const { data, error } = await query;
  assertNoError(error, 'getCertificados');
  return (data || []).map(mapCertificadoRow);
}

async function createCertificado(payload) {
  const { data, error } = await supabase.from('certificado_digital').insert({
    empresa_id: payload.empresaId,
    tipo: payload.tipo || 'A1',
    titular_cnpj: payload.titularCnpj,
    valido_de: payload.validoDe,
    valido_ate: payload.validoAte,
    enviado_focus_em: payload.enviadoFocusEm || null
  }).select().single();
  assertNoError(error, 'createCertificado');
  return mapCertificadoRow(data);
}

async function deleteCertificado(id) {
  const { error } = await supabase.from('certificado_digital').delete().eq('id', id);
  assertNoError(error, 'deleteCertificado');
}

module.exports = {
  getEmpresas,
  getEmpresaById,
  createEmpresa,
  updateEmpresa,
  deleteEmpresa,
  getEstabelecimentos,
  getEstabelecimentoById,
  createEstabelecimento,
  updateEstabelecimento,
  deleteEstabelecimento,
  getEstabelecimentoFocusCredentials,
  getCertificados,
  createCertificado,
  deleteCertificado
};
