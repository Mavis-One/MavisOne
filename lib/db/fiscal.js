const { supabase, assertNoError } = require('./client');
const { encryptToBytea, decryptFromBytea } = require('../secrets');
// Só a validação de formato do token — o require é do módulo inteiro, mas
// lib/focusnfe.js não carrega este arquivo no topo (só dentro de
// forEstabelecimento), então não há ciclo na carga.
const { assertTokenValido } = require('../focusnfe');

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
  // Três estados, não dois: gravar um token novo, apagar o que existe, ou não
  // mexer. Sem o "apagar" explícito, um token digitado errado só podia ser
  // sobrescrito — nunca havia como voltar o estabelecimento para "sem token",
  // que é o que se quer ao parar de emitir por ele. O apagar tem precedência:
  // a tela desabilita o campo de token quando ele está marcado, então os dois
  // nunca chegam juntos daqui, e se chegarem o pedido destrutivo é o explícito.
  if (payload.removerFocusToken) {
    fields.focus_token_cifrado = null;
    fields.focus_cadastrado_em = null;
  } else if (payload.focusToken) {
    fields.focus_token_cifrado = encryptToBytea(assertTokenValido(payload.focusToken));
    fields.focus_cadastrado_em = new Date().toISOString();
  }
  return fields;
}

// As triggers do schema fiscal (ex.: estabelecimento_valida_cnpj_raiz) já
// escrevem a mensagem pronta pra quem está cadastrando — P0001 é o "raise
// exception" do plpgsql. Passar pelo assertNoError prefixaria com o nome da
// função interna ("createEstabelecimento: ..."), escondendo o que importa.
// 23505 é a outra recusa esperada nesta tela: cnpj é unique.
function assertEstabelecimentoValido(error, context) {
  if (error && error.code === 'P0001') {
    const err = new Error(error.message);
    err.status = 409;
    throw err;
  }
  if (error && error.code === '23505') {
    const err = new Error('Já existe um estabelecimento cadastrado com este CNPJ.');
    err.status = 409;
    throw err;
  }
  assertNoError(error, context);
}

async function createEstabelecimento(payload) {
  const { data, error } = await supabase.from('estabelecimento').insert(buildEstabelecimentoFields(payload)).select().single();
  assertEstabelecimentoValido(error, 'createEstabelecimento');
  return mapEstabelecimentoRow(data);
}

async function updateEstabelecimento(id, payload) {
  const fields = buildEstabelecimentoFields(payload);
  if (payload.ativo !== undefined) fields.ativo = Boolean(payload.ativo);
  const { data, error } = await supabase.from('estabelecimento').update(fields).eq('id', id).select().single();
  assertEstabelecimentoValido(error, 'updateEstabelecimento');
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
    // DIFAL (EC 87/2015) — só usados em venda interestadual para não
    // contribuinte, e só no regime normal: o Simples é dispensado.
    aliquotaInternaUfDestino: row.aliquota_interna_uf_destino,
    aliquotaFcpUfDestino: row.aliquota_fcp_uf_destino,
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
    // IBS/CBS — Reforma Tributária (LC 214/2025).
    cstIbsCbs: row.cst_ibs_cbs,
    classTrib: row.class_trib,
    // O IBS vai SEPARADO por competência: a Focus pede pIBSUF e pIBSMun, e
    // estado e município legislam a alíquota deles de forma independente.
    // `aliquotaIbs` é o total da fase-z, mantido só por compatibilidade — o
    // payload usa os dois de baixo (ver fase-ad).
    aliquotaIbs: row.aliquota_ibs,
    aliquotaIbsUf: row.aliquota_ibs_uf,
    aliquotaIbsMun: row.aliquota_ibs_mun,
    aliquotaCbs: row.aliquota_cbs,
    prioridade: row.prioridade,
    vigenciaInicio: row.vigencia_inicio,
    vigenciaFim: row.vigencia_fim,
    observacaoFisco: row.observacao_fisco
  };
}

// Tabelas fiscais de referência (Fase Q). São códigos oficiais, iguais para
// todo mundo: uma consulta só, sem filtro por empresa.
//
// Devolve listas vazias se a migração ainda não rodou — a tela cai no campo de
// texto livre que já existia, em vez de quebrar.
async function getTabelasFiscais() {
  const consultar = async (tabela, ordem) => {
    const { data, error } = await supabase.from(tabela).select('*').order(ordem, { ascending: true });
    if (error) {
      if (/does not exist|Could not find|schema cache/i.test(error.message || '')) return null;
      assertNoError(error, `getTabelasFiscais/${tabela}`);
    }
    return data || [];
  };

  const [cfop, cstIcms, csosn, cstPisCofins, cstIpi, origem, cstIbsCbs, classTrib] = await Promise.all([
    consultar('cfop', 'codigo'),
    consultar('cst_icms', 'codigo'),
    consultar('csosn', 'codigo'),
    consultar('cst_pis_cofins', 'codigo'),
    consultar('cst_ipi', 'codigo'),
    consultar('origem_mercadoria', 'codigo'),
    // IBS/CBS (LC 214/2025). Se a Fase Z ainda não rodou, vêm nulos e a tela
    // cai no campo de texto livre — igual às outras tabelas.
    consultar('cst_ibs_cbs', 'codigo'),
    consultar('classificacao_tributaria', 'codigo')
  ]);

  return {
    disponivel: cfop !== null,
    cfop: (cfop || []).filter((linha) => linha.ativo !== false),
    cstIcms: cstIcms || [],
    csosn: csosn || [],
    cstPisCofins: cstPisCofins || [],
    cstIpi: cstIpi || [],
    origemMercadoria: origem || [],
    cstIbsCbs: cstIbsCbs || [],
    // A tabela oficial tem centenas de códigos e esta carga é parcial. A tela
    // precisa saber disso para continuar aceitando digitação manual em vez de
    // sugerir que a lista é exaustiva.
    classificacaoTributaria: classTrib || [],
    classificacaoTributariaParcial: true
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

// Número que aceita ZERO. `valor || null` transformaria alíquota 0 em NULL, e
// 0% não é "não preenchido": é o que uma regra de CST 40 (isento) ou 41 (não
// tributado) precisa gravar. Só vazio/ausente vira NULL.
function numeroOuNulo(valor) {
  if (valor === '' || valor === undefined || valor === null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(valor) {
  const t = String(valor ?? '').trim();
  return t === '' ? null : t;
}

function buildRegraFiscalFields(payload) {
  return {
    empresa_id: payload.empresaId,
    ncm: textoOuNulo(payload.ncm),
    origem: numeroOuNulo(payload.origem),
    tipo_operacao: payload.tipoOperacao,
    uf_destino: textoOuNulo(payload.ufDestino),
    dentro_do_estado: payload.dentroDoEstado === undefined || payload.dentroDoEstado === null || payload.dentroDoEstado === '' ? null : Boolean(payload.dentroDoEstado),
    destinatario_contribuinte: payload.destinatarioContribuinte === undefined || payload.destinatarioContribuinte === null || payload.destinatarioContribuinte === '' ? null : Boolean(payload.destinatarioContribuinte),
    cfop: payload.cfop,
    csosn: textoOuNulo(payload.csosn),
    cst_icms: textoOuNulo(payload.cstIcms),
    modalidade_bc_icms: numeroOuNulo(payload.modalidadeBcIcms),
    aliquota_icms: numeroOuNulo(payload.aliquotaIcms),
    reducao_bc_icms: numeroOuNulo(payload.reducaoBcIcms),
    aliquota_interna_uf_destino: numeroOuNulo(payload.aliquotaInternaUfDestino),
    aliquota_fcp_uf_destino: numeroOuNulo(payload.aliquotaFcpUfDestino),
    cst_icms_st: textoOuNulo(payload.cstIcmsSt),
    mva_st: numeroOuNulo(payload.mvaSt),
    aliquota_icms_st: numeroOuNulo(payload.aliquotaIcmsSt),
    cst_pis: textoOuNulo(payload.cstPis),
    aliquota_pis: numeroOuNulo(payload.aliquotaPis),
    cst_cofins: textoOuNulo(payload.cstCofins),
    aliquota_cofins: numeroOuNulo(payload.aliquotaCofins),
    cst_ipi: textoOuNulo(payload.cstIpi),
    aliquota_ipi: numeroOuNulo(payload.aliquotaIpi),
    codigo_enquadramento_ipi: textoOuNulo(payload.codigoEnquadramentoIpi),
    cst_ibs_cbs: textoOuNulo(payload.cstIbsCbs),
    class_trib: textoOuNulo(payload.classTrib),
    // numeroOuNulo, e não `|| null`: alíquota 0 é valor legítimo aqui (CST 400
    // isenção, 410 imunidade) e não pode virar "não preenchido".
    aliquota_ibs: numeroOuNulo(payload.aliquotaIbs),
    aliquota_ibs_uf: numeroOuNulo(payload.aliquotaIbsUf),
    aliquota_ibs_mun: numeroOuNulo(payload.aliquotaIbsMun),
    aliquota_cbs: numeroOuNulo(payload.aliquotaCbs),
    prioridade: Number(payload.prioridade || 0),
    vigencia_inicio: payload.vigenciaInicio,
    vigencia_fim: textoOuNulo(payload.vigenciaFim),
    observacao_fisco: textoOuNulo(payload.observacaoFisco)
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
    // Guardados como coluna, e não lidos de payload_enviado: em homologação o
    // nome enviado à SEFAZ é o texto fixo que ela exige, não o do cliente.
    destinatarioNome: row.destinatario_nome || '',
    destinatarioDocumento: row.destinatario_documento || '',
    orderId: row.order_id || '',
    condicaoPagamento: row.condicao_pagamento || null,
    tipoOperacaoFiscal: row.tipo_operacao_fiscal || 'VENDA',
    // Valor FISCAL, não comercial: nunca some ao faturamento.
    valorIcmsComplementar: Number(row.valor_icms_complementar || 0),
    nfeOriginalChave: row.nfe_original_chave || '',
    status: row.status,
    mensagemSefaz: row.mensagem_sefaz,
    protocolo: row.protocolo,
    valorTotal: row.valor_total,
    dataEmissao: row.data_emissao,
    autorizadoEm: row.autorizado_em,
    urlXml: row.url_xml,
    urlDanfe: row.url_danfe,
    payloadEnviado: row.payload_enviado,
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

async function getNfeByReferencia(referencia) {
  const { data, error } = await supabase.from('nfe').select('*').eq('referencia', referencia).maybeSingle();
  assertNoError(error, 'getNfeByReferencia');
  return mapNfeRow(data);
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
    destinatario_nome: payload.destinatarioNome || null,
    destinatario_documento: payload.destinatarioDocumento || null,
    order_id: payload.orderId || null,
    condicao_pagamento: payload.condicaoPagamento || null,
    tipo_operacao_fiscal: payload.tipoOperacaoFiscal || null,
    valor_icms_complementar: Number(payload.valorIcmsComplementar || 0),
    nfe_original_chave: payload.nfeOriginalChave || null,
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

function mapNfeEventoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    nfeId: row.nfe_id,
    estabelecimentoId: row.estabelecimento_id,
    tipo: row.tipo,
    payloadEnviado: row.payload_enviado,
    respostaFocus: row.resposta_focus,
    status: row.status,
    criadoEm: row.criado_em
  };
}

async function createNfeEvento(payload) {
  const { data, error } = await supabase.from('nfe_eventos').insert({
    nfe_id: payload.nfeId || null,
    estabelecimento_id: payload.estabelecimentoId,
    tipo: payload.tipo,
    payload_enviado: payload.payloadEnviado || null,
    resposta_focus: payload.respostaFocus || null,
    status: payload.status || null
  }).select().single();
  assertNoError(error, 'createNfeEvento');
  return mapNfeEventoRow(data);
}

async function getNfeEventos(nfeId) {
  const { data, error } = await supabase.from('nfe_eventos').select('*').eq('nfe_id', nfeId).order('criado_em', { ascending: false });
  assertNoError(error, 'getNfeEventos');
  return (data || []).map(mapNfeEventoRow);
}

/**
 * Eventos do estabelecimento, e NÃO de uma nota.
 *
 * getNfeEventos() filtra por nfe_id — e inutilização de numeração tem nfe_id
 * NULO de propósito: ela queima uma faixa de números que nunca virou nota.
 * Por isso a inutilização, mesmo já sendo gravada há tempo, não aparecia em
 * lugar nenhum: não havia como listá-la.
 *
 * A nota vem embutida (`nfe(...)`) numa consulta só; CCE e cancelamento
 * apontam para uma, inutilização vem com null — e a tela trata isso.
 */
async function getEventosFiscais({ estabelecimentoId, tipo, limite = 200 } = {}) {
  let query = supabase
    .from('nfe_eventos')
    .select('*, nfe(referencia, numero, serie, chave_acesso, status)')
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (estabelecimentoId) query = query.eq('estabelecimento_id', estabelecimentoId);
  if (tipo) query = query.eq('tipo', tipo);
  const { data, error } = await query;
  assertNoError(error, 'getEventosFiscais');
  return (data || []).map((row) => ({
    ...mapNfeEventoRow(row),
    nfe: row.nfe
      ? {
        referencia: row.nfe.referencia,
        numero: row.nfe.numero,
        serie: row.nfe.serie,
        chaveAcesso: row.nfe.chave_acesso,
        status: row.nfe.status
      }
      : null
  }));
}

// Não usa criptografia (lib/secrets.js) — XML/DANFE não são segredo, só
// arquivo binário/texto guardado como bytea puro.
function bufferToByteaLiteral(buffer) {
  return `\\x${buffer.toString('hex')}`;
}

function mapNfeArquivoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    nfeId: row.nfe_id,
    tipo: row.tipo,
    conteudo: row.conteudo ? Buffer.from(String(row.conteudo).replace(/^\\x/, ''), 'hex') : null,
    baixadoEm: row.baixado_em
  };
}

async function createNfeArquivo(payload) {
  const { data, error } = await supabase.from('nfe_arquivos').upsert({
    nfe_id: payload.nfeId,
    tipo: payload.tipo,
    conteudo: bufferToByteaLiteral(payload.conteudo),
    baixado_em: new Date().toISOString()
  }, { onConflict: 'nfe_id,tipo' }).select().single();
  assertNoError(error, 'createNfeArquivo');
  return mapNfeArquivoRow(data);
}

async function getNfeArquivo(nfeId, tipo) {
  const { data, error } = await supabase.from('nfe_arquivos').select('*').eq('nfe_id', nfeId).eq('tipo', tipo).maybeSingle();
  assertNoError(error, 'getNfeArquivo');
  return mapNfeArquivoRow(data);
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
  getTabelasFiscais,
  getRegrasFiscais,
  createRegraFiscal,
  updateRegraFiscal,
  deleteRegraFiscal,
  resolverRegraFiscal,
  getNfeRecords,
  getNfeById,
  getNfeByReferencia,
  createNfeRascunho,
  updateNfeAposResposta,
  createNfeEvento,
  getNfeEventos,
  getEventosFiscais,
  createNfeArquivo,
  getNfeArquivo
};
