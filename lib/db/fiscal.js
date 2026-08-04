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

// Erro 23503 = violação de FK (Postgres). Em vez do erro cru do banco,
// devolve uma mensagem que explica o que precisa ser excluído primeiro.
function assertNoForeignKeyError(error, context, friendlyMessage) {
  if (error && error.code === '23503') {
    const err = new Error(friendlyMessage);
    err.status = 409;
    throw err;
  }
  assertNoError(error, context);
}

async function deleteEmpresa(id) {
  const { error } = await supabase.from('empresa').delete().eq('id', id);
  assertNoForeignKeyError(error, 'deleteEmpresa', 'Não é possível excluir: esta empresa ainda tem estabelecimentos cadastrados. Exclua-os primeiro.');
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
  assertNoForeignKeyError(error, 'deleteEstabelecimento', 'Não é possível excluir: este estabelecimento tem NF-e, séries de numeração ou declarações de importação vinculadas.');
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

function mapRegraFiscalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    ncm: row.ncm,
    origem: row.origem,
    tipoOperacao: row.tipo_operacao,
    ufDestino: row.uf_destino,
    dentroDoEstado: row.dentro_do_estado,
    destinatarioContribuinte: row.destinatario_contribuinte,
    cfop: row.cfop,
    csosn: row.csosn,
    cstIcms: row.cst_icms,
    modalidadeBcIcms: row.modalidade_bc_icms,
    aliquotaIcms: row.aliquota_icms,
    reducaoBcIcms: row.reducao_bc_icms,
    cstIcmsSt: row.cst_icms_st,
    mvaSt: row.mva_st,
    aliquotaIcmsSt: row.aliquota_icms_st,
    cstPis: row.cst_pis,
    aliquotaPis: row.aliquota_pis,
    cstCofins: row.cst_cofins,
    aliquotaCofins: row.aliquota_cofins,
    cstIpi: row.cst_ipi,
    aliquotaIpi: row.aliquota_ipi,
    codigoEnquadramentoIpi: row.codigo_enquadramento_ipi,
    prioridade: row.prioridade,
    vigenciaInicio: row.vigencia_inicio,
    vigenciaFim: row.vigencia_fim,
    observacaoFisco: row.observacao_fisco
  };
}

async function getRegrasFiscais(empresaId) {
  let query = supabase.from('regra_fiscal').select('*').order('prioridade', { ascending: false });
  if (empresaId) query = query.eq('empresa_id', empresaId);
  const { data, error } = await query;
  assertNoError(error, 'getRegrasFiscais');
  return (data || []).map(mapRegraFiscalRow);
}

async function createRegraFiscal(payload) {
  const { data, error } = await supabase.from('regra_fiscal').insert(buildRegraFiscalFields(payload)).select().single();
  assertNoError(error, 'createRegraFiscal');
  return mapRegraFiscalRow(data);
}

async function updateRegraFiscal(id, payload) {
  const { data, error } = await supabase.from('regra_fiscal').update(buildRegraFiscalFields(payload)).eq('id', id).select().single();
  assertNoError(error, 'updateRegraFiscal');
  return mapRegraFiscalRow(data);
}

async function deleteRegraFiscal(id) {
  const { error } = await supabase.from('regra_fiscal').delete().eq('id', id);
  assertNoError(error, 'deleteRegraFiscal');
}

function buildRegraFiscalFields(payload) {
  return {
    empresa_id: payload.empresaId,
    ncm: payload.ncm || null,
    origem: payload.origem === '' || payload.origem === undefined || payload.origem === null ? null : Number(payload.origem),
    tipo_operacao: payload.tipoOperacao,
    uf_destino: payload.ufDestino || null,
    dentro_do_estado: payload.dentroDoEstado === undefined || payload.dentroDoEstado === null ? null : Boolean(payload.dentroDoEstado),
    destinatario_contribuinte: payload.destinatarioContribuinte === undefined || payload.destinatarioContribuinte === null ? null : Boolean(payload.destinatarioContribuinte),
    cfop: payload.cfop,
    csosn: payload.csosn || null,
    cst_icms: payload.cstIcms || null,
    modalidade_bc_icms: payload.modalidadeBcIcms || null,
    aliquota_icms: payload.aliquotaIcms || null,
    reducao_bc_icms: payload.reducaoBcIcms || null,
    cst_icms_st: payload.cstIcmsSt || null,
    mva_st: payload.mvaSt || null,
    aliquota_icms_st: payload.aliquotaIcmsSt || null,
    cst_pis: payload.cstPis || null,
    aliquota_pis: payload.aliquotaPis || null,
    cst_cofins: payload.cstCofins || null,
    aliquota_cofins: payload.aliquotaCofins || null,
    cst_ipi: payload.cstIpi || null,
    aliquota_ipi: payload.aliquotaIpi || null,
    codigo_enquadramento_ipi: payload.codigoEnquadramentoIpi || null,
    prioridade: Number(payload.prioridade || 0),
    vigencia_inicio: payload.vigenciaInicio,
    vigencia_fim: payload.vigenciaFim || null,
    observacao_fisco: payload.observacaoFisco || null
  };
}

// Escolhe a regra mais específica pra um item: cada critério (ncm, origem,
// uf_destino, dentro_do_estado, destinatario_contribuinte) só entra na
// comparação se a regra tiver ele preenchido — NULL funciona como coringa.
// Desempate: mais critérios batendo > maior "prioridade" > vigência mais recente.
async function resolverRegraFiscal({ empresaId, ncm, origem, tipoOperacao, ufDestino, dentroDoEstado, destinatarioContribuinte, data }) {
  const referencia = data || new Date().toISOString().slice(0, 10);
  const { data: rows, error } = await supabase.from('regra_fiscal')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('tipo_operacao', tipoOperacao)
    .lte('vigencia_inicio', referencia);
  assertNoError(error, 'resolverRegraFiscal');

  const candidatas = (rows || []).filter((row) => {
    if (row.vigencia_fim && row.vigencia_fim < referencia) return false;
    if (row.ncm && row.ncm !== ncm) return false;
    if (row.origem !== null && row.origem !== undefined && Number(row.origem) !== Number(origem)) return false;
    if (row.uf_destino && row.uf_destino !== ufDestino) return false;
    if (row.dentro_do_estado !== null && row.dentro_do_estado !== undefined && Boolean(row.dentro_do_estado) !== Boolean(dentroDoEstado)) return false;
    if (row.destinatario_contribuinte !== null && row.destinatario_contribuinte !== undefined && Boolean(row.destinatario_contribuinte) !== Boolean(destinatarioContribuinte)) return false;
    return true;
  });

  if (!candidatas.length) return null;

  function especificidade(row) {
    return [row.ncm, row.origem, row.uf_destino, row.dentro_do_estado, row.destinatario_contribuinte]
      .filter((v) => v !== null && v !== undefined).length;
  }

  candidatas.sort((a, b) => {
    const diffEspecificidade = especificidade(b) - especificidade(a);
    if (diffEspecificidade !== 0) return diffEspecificidade;
    const diffPrioridade = (b.prioridade || 0) - (a.prioridade || 0);
    if (diffPrioridade !== 0) return diffPrioridade;
    return (b.vigencia_inicio || '').localeCompare(a.vigencia_inicio || '');
  });

  return mapRegraFiscalRow(candidatas[0]);
}

function mapNfeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    estabelecimentoId: row.estabelecimento_id,
    referencia: row.referencia,
    modelo: row.modelo,
    serie: row.serie,
    numero: row.numero,
    chaveAcesso: row.chave_acesso,
    naturezaOperacao: row.natureza_operacao,
    tipoDocumento: row.tipo_documento,
    finalidadeEmissao: row.finalidade_emissao,
    status: row.status,
    mensagemSefaz: row.mensagem_sefaz,
    protocolo: row.protocolo,
    valorTotal: row.valor_total,
    dataEmissao: row.data_emissao,
    autorizadoEm: row.autorizado_em,
    urlXml: row.url_xml,
    urlDanfe: row.url_danfe,
    respostaFocus: row.resposta_focus,
    criadoEm: row.criado_em
  };
}

async function getNfeRecords(estabelecimentoId) {
  let query = supabase.from('nfe').select('*').order('criado_em', { ascending: false });
  if (estabelecimentoId) query = query.eq('estabelecimento_id', estabelecimentoId);
  const { data, error } = await query;
  assertNoError(error, 'getNfeRecords');
  return (data || []).map(mapNfeRow);
}

async function getNfeById(id) {
  const { data, error } = await supabase.from('nfe').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getNfeById');
  return mapNfeRow(data);
}

async function createNfeRascunho(payload) {
  const { data, error } = await supabase.from('nfe').insert({
    estabelecimento_id: payload.estabelecimentoId,
    referencia: payload.referencia,
    modelo: payload.modelo || 55,
    natureza_operacao: payload.naturezaOperacao,
    tipo_documento: payload.tipoDocumento,
    finalidade_emissao: payload.finalidadeEmissao,
    status: 'RASCUNHO',
    valor_total: payload.valorTotal,
    data_emissao: payload.dataEmissao,
    payload_enviado: payload.payloadEnviado
  }).select().single();
  assertNoError(error, 'createNfeRascunho');
  return mapNfeRow(data);
}

async function updateNfeAposResposta(id, result) {
  const { data, error } = await supabase.from('nfe').update({
    status: result.status,
    serie: result.serie,
    numero: result.numero,
    chave_acesso: result.chaveAcesso,
    mensagem_sefaz: result.mensagemSefaz,
    protocolo: result.protocolo,
    url_xml: result.urlXml,
    url_danfe: result.urlDanfe,
    resposta_focus: result.respostaFocus,
    autorizado_em: result.autorizadoEm || null
  }).eq('id', id).select().single();
  assertNoError(error, 'updateNfeAposResposta');
  return mapNfeRow(data);
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
  deleteCertificado,
  getRegrasFiscais,
  createRegraFiscal,
  updateRegraFiscal,
  deleteRegraFiscal,
  resolverRegraFiscal,
  getNfeRecords,
  getNfeById,
  createNfeRascunho,
  updateNfeAposResposta
};
