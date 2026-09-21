const { banco, assertNoError } = require('./client');
// SQL cru para o acervo fiscal (fase CN): são junções entre `nfe` e
// `nfe_arquivos` e contagens condicionais, que o construtor de consultas não
// expressa — e aqui o que se quer é exatamente uma ida ao banco por pergunta.
const { consultar } = require('./conexao');
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
    // Fase AO: o texto que nasce no campo de observacoes da nota deste CNPJ.
    // Vazio = usa o padrao do sistema, que e' como era antes desta coluna.
    observacaoPadraoNfe: row.observacao_padrao_nfe || '',
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
  const { data, error } = await banco.from('empresa').select('*').order('razao_social', { ascending: true });
  assertNoError(error, 'getEmpresas');
  return (data || []).map(mapEmpresaRow);
}

async function getEmpresaById(id) {
  const { data, error } = await banco.from('empresa').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getEmpresaById');
  return mapEmpresaRow(data);
}

async function createEmpresa(payload) {
  const { data, error } = await banco.from('empresa').insert({
    cnpj_raiz: payload.cnpjRaiz,
    razao_social: payload.razaoSocial,
    observacao_padrao_nfe: payload.observacaoPadraoNfe || null,
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
  const { data, error } = await banco.from('empresa').update({
    razao_social: payload.razaoSocial,
    observacao_padrao_nfe: payload.observacaoPadraoNfe || null,
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
  const { error } = await banco.from('empresa').delete().eq('id', id);
  assertNoForeignKeyError(error, 'deleteEmpresa', 'Não é possível excluir: esta empresa ainda tem estabelecimentos cadastrados. Exclua-os primeiro.');
}

async function getEstabelecimentos(empresaId) {
  let query = banco.from('estabelecimento').select('*').order('ordem', { ascending: true });
  if (empresaId) query = query.eq('empresa_id', empresaId);
  const { data, error } = await query;
  assertNoError(error, 'getEstabelecimentos');
  return (data || []).map(mapEstabelecimentoRow);
}

async function getEstabelecimentoById(id) {
  const { data, error } = await banco.from('estabelecimento').select('*').eq('id', id).maybeSingle();
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
  const { data, error } = await banco.from('estabelecimento').insert(buildEstabelecimentoFields(payload)).select().single();
  assertEstabelecimentoValido(error, 'createEstabelecimento');
  return mapEstabelecimentoRow(data);
}

async function updateEstabelecimento(id, payload) {
  const fields = buildEstabelecimentoFields(payload);
  if (payload.ativo !== undefined) fields.ativo = Boolean(payload.ativo);
  const { data, error } = await banco.from('estabelecimento').update(fields).eq('id', id).select().single();
  assertEstabelecimentoValido(error, 'updateEstabelecimento');
  return mapEstabelecimentoRow(data);
}

async function deleteEstabelecimento(id) {
  const { error } = await banco.from('estabelecimento').delete().eq('id', id);
  assertNoForeignKeyError(error, 'deleteEstabelecimento', 'Não é possível excluir: este estabelecimento tem NF-e, séries de numeração ou declarações de importação vinculadas.');
}

/**
 * Grava SÓ o token da Focus e o ambiente dele (fase CH — o importador).
 *
 * POR QUE NÃO USA updateEstabelecimento
 * -------------------------------------
 * Porque `buildEstabelecimentoFields` monta a linha INTEIRA a partir do
 * payload: CNPJ, ordem, IE, CNAE, endereço. Passar por ele com só o token
 * gravaria `null` em cima de uma dúzia de colunas obrigatórias — o importador
 * apagaria o cadastro que veio importar. Aqui se escreve o que se pediu, e
 * nada mais.
 *
 * O AMBIENTE VIAJA JUNTO, e é obrigatório: no estabelecimento existe um token
 * só, e é `focus_ambiente` que diz para qual URL ele serve. Gravar um token de
 * produção deixando o ambiente em homologação mandaria esse token para a URL
 * de homologação, e a Focus responderia 403 — erro de autenticação para um
 * problema que é de configuração. Os dois campos são a mesma decisão.
 */
async function salvarTokenFocusDoEstabelecimento(id, { token, ambiente }) {
  const amb = String(ambiente || '').toLowerCase() === 'producao' ? 'producao' : 'homologacao';
  const fields = {
    focus_token_cifrado: encryptToBytea(assertTokenValido(token)),
    focus_ambiente: amb,
    focus_cadastrado_em: new Date().toISOString()
  };
  const { data, error } = await banco.from('estabelecimento').update(fields).eq('id', id).select().single();
  assertNoError(error, 'salvarTokenFocusDoEstabelecimento');
  return mapEstabelecimentoRow(data);
}

// Uso interno (lib/focusnfe.js) — nunca expor via rota HTTP direta.
async function getEstabelecimentoFocusCredentials(id) {
  const { data, error } = await banco.from('estabelecimento').select('focus_token_cifrado, focus_ambiente').eq('id', id).maybeSingle();
  assertNoError(error, 'getEstabelecimentoFocusCredentials');
  if (!data || !data.focus_token_cifrado) return null;
  return { token: decryptFromBytea(data.focus_token_cifrado), ambiente: data.focus_ambiente };
}

async function getCertificados(empresaId) {
  let query = banco.from('certificado_digital').select('*').order('valido_ate', { ascending: false });
  if (empresaId) query = query.eq('empresa_id', empresaId);
  const { data, error } = await query;
  assertNoError(error, 'getCertificados');
  return (data || []).map(mapCertificadoRow);
}

async function createCertificado(payload) {
  const { data, error } = await banco.from('certificado_digital').insert({
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
  const { error } = await banco.from('certificado_digital').delete().eq('id', id);
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
    // Benefício fiscal: exigido pela SEFAZ em CST com benefício (40, 41, 50).
    // Sem ele a nota isenta é recusada com "930 — CST com beneficio fiscal e
    // nao informado o codigo de beneficio fiscal".
    codigoBeneficioFiscal: row.codigo_beneficio_fiscal,
    icmsMotivoDesoneracao: row.icms_motivo_desoneracao,
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
// "Estes CFOPs geram financeiro?" — devolve { '5405': true, '1202': false }.
//
// Só os códigos pedidos, e não a tabela inteira: isto roda na autorização de
// cada nota, e trazer 88 linhas para conferir uma é desperdício por nota.
//
// Coluna ausente (fase-ae ainda não rodou) devolve objeto vazio, e quem chama
// trata como "não sei" — o que NÃO pode acontecer é a ausência da coluna ser
// lida como "nenhum CFOP gera", que faria todo recebível sumir em silêncio.
async function getCfopsPorCodigo(codigos) {
  const lista = [...new Set((codigos || []).map((c) => String(c).replace(/\D/g, '')).filter(Boolean))];
  if (!lista.length) return {};
  const { data, error } = await banco.from('cfop').select('codigo, gera_financeiro').in('codigo', lista);
  if (error) {
    if (/does not exist|Could not find|schema cache/i.test(error.message || '')) return {};
    assertNoError(error, 'getCfopsPorCodigo');
  }
  const mapa = {};
  (data || []).forEach((linha) => { mapa[String(linha.codigo)] = linha.gera_financeiro === true; });
  return mapa;
}

async function getTabelasFiscais() {
  const consultar = async (tabela, ordem) => {
    const { data, error } = await banco.from(tabela).select('*').order(ordem, { ascending: true });
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
  let query = banco.from('regra_fiscal').select('*').order('prioridade', { ascending: false });
  if (empresaId) query = query.eq('empresa_id', empresaId);
  const { data, error } = await query;
  assertNoError(error, 'getRegrasFiscais');
  return (data || []).map(mapRegraFiscalRow);
}

async function createRegraFiscal(payload) {
  const { data, error } = await banco.from('regra_fiscal').insert(buildRegraFiscalFields(payload)).select().single();
  assertNoError(error, 'createRegraFiscal');
  return mapRegraFiscalRow(data);
}

/**
 * De qual chave do payload vem cada coluna.
 *
 * Existe para o UPDATE PARCIAL abaixo poder distinguir "o cliente nao mandou
 * este campo" de "o cliente mandou apagar este campo" — distincao que
 * buildRegraFiscalFields, sozinho, perde: ele converte chave ausente em `null`
 * explicito, e null e um valor, nao uma omissao.
 *
 * Um teste confere que TODA coluna produzida por buildRegraFiscalFields tem
 * entrada aqui. Coluna nova sem entrada voltaria a ser zerada em silencio, que
 * e exatamente o defeito que isto conserta.
 */
const CHAVE_DA_COLUNA_REGRA = {
  empresa_id: 'empresaId',
  ncm: 'ncm',
  origem: 'origem',
  tipo_operacao: 'tipoOperacao',
  uf_destino: 'ufDestino',
  dentro_do_estado: 'dentroDoEstado',
  destinatario_contribuinte: 'destinatarioContribuinte',
  cfop: 'cfop',
  csosn: 'csosn',
  cst_icms: 'cstIcms',
  modalidade_bc_icms: 'modalidadeBcIcms',
  aliquota_icms: 'aliquotaIcms',
  reducao_bc_icms: 'reducaoBcIcms',
  aliquota_interna_uf_destino: 'aliquotaInternaUfDestino',
  aliquota_fcp_uf_destino: 'aliquotaFcpUfDestino',
  cst_icms_st: 'cstIcmsSt',
  mva_st: 'mvaSt',
  aliquota_icms_st: 'aliquotaIcmsSt',
  cst_pis: 'cstPis',
  aliquota_pis: 'aliquotaPis',
  cst_cofins: 'cstCofins',
  aliquota_cofins: 'aliquotaCofins',
  cst_ipi: 'cstIpi',
  aliquota_ipi: 'aliquotaIpi',
  codigo_enquadramento_ipi: 'codigoEnquadramentoIpi',
  codigo_beneficio_fiscal: 'codigoBeneficioFiscal',
  icms_motivo_desoneracao: 'icmsMotivoDesoneracao',
  cst_ibs_cbs: 'cstIbsCbs',
  class_trib: 'classTrib',
  aliquota_ibs: 'aliquotaIbs',
  aliquota_ibs_uf: 'aliquotaIbsUf',
  aliquota_ibs_mun: 'aliquotaIbsMun',
  aliquota_cbs: 'aliquotaCbs',
  prioridade: 'prioridade',
  vigencia_inicio: 'vigenciaInicio',
  vigencia_fim: 'vigenciaFim',
  observacao_fisco: 'observacaoFisco',
};

/**
 * O UPDATE DE REGRA FISCAL E PARCIAL (fase BJ).
 *
 * Existem DOIS formularios gravando na mesma tabela pela mesma rota
 * (PUT /api/fiscal/regras/:id): o de FISCAL > REGRAS FISCAIS, que manda 36
 * campos, e o de CONFIGURACOES > EMPRESA, que manda 20. Como o update era
 * TOTAL, cada "Salvar" feito pela tela de Configuracoes zerava as 17 colunas
 * que so a tela grande conhece — inclusive sem o usuario ter mudado nada.
 *
 * Tres delas (origem, dentro_do_estado, destinatario_contribuinte) sao
 * criterios de casamento em resolverRegraFiscal. Zeradas, a regra nao fica so
 * incompleta: ela vira CORINGA e passa a ser aplicada a operacoes que nunca
 * foram dela — uma regra de venda interna para contribuinte passa a valer
 * tambem para consumidor final de outro estado, com a aliquota errada.
 *
 * O INSERT continua usando o build completo, para os defaults de coluna e os
 * NOT NULL valerem numa regra nova.
 *
 * Apagar de proposito continua funcionando: `'mvaSt' in payload` e verdadeiro
 * quando o valor e null, entao quem manda null explicitamente limpa a coluna.
 */
function buildRegraFiscalUpdate(payload) {
  const completo = buildRegraFiscalFields(payload);
  const parcial = {};
  for (const [coluna, valor] of Object.entries(completo)) {
    const chave = CHAVE_DA_COLUNA_REGRA[coluna];
    if (chave && Object.prototype.hasOwnProperty.call(payload, chave)) parcial[coluna] = valor;
  }
  return parcial;
}

async function updateRegraFiscal(id, payload) {
  const { data, error } = await banco.from('regra_fiscal').update(buildRegraFiscalUpdate(payload)).eq('id', id).select().single();
  assertNoError(error, 'updateRegraFiscal');
  return mapRegraFiscalRow(data);
}

async function deleteRegraFiscal(id) {
  const { error } = await banco.from('regra_fiscal').delete().eq('id', id);
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
    codigo_beneficio_fiscal: textoOuNulo(payload.codigoBeneficioFiscal),
    icms_motivo_desoneracao: textoOuNulo(payload.icmsMotivoDesoneracao),
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
  const { data: rows, error } = await banco.from('regra_fiscal')
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
  let query = banco.from('nfe').select('*').order('criado_em', { ascending: false });
  if (estabelecimentoId) query = query.eq('estabelecimento_id', estabelecimentoId);
  const { data, error } = await query;
  assertNoError(error, 'getNfeRecords');
  return (data || []).map(mapNfeRow);
}

async function getNfeByReferencia(referencia) {
  const { data, error } = await banco.from('nfe').select('*').eq('referencia', referencia).maybeSingle();
  assertNoError(error, 'getNfeByReferencia');
  return mapNfeRow(data);
}

async function getNfeById(id) {
  const { data, error } = await banco.from('nfe').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getNfeById');
  return mapNfeRow(data);
}

async function createNfeRascunho(payload) {
  const { data, error } = await banco.from('nfe').insert({
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
  const { data, error } = await banco.from('nfe').update({
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
  const { data, error } = await banco.from('nfe_eventos').insert({
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
  const { data, error } = await banco.from('nfe_eventos').select('*').eq('nfe_id', nfeId).order('criado_em', { ascending: false });
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
  let query = banco
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

// Quais NF-e fiscais saíram de um pedido. É o que sustenta a regra "um pedido,
// uma nota": sem consultar, a emissão fiscal deixava faturar o mesmo pedido
// duas vezes e ficar com dois documentos na SEFAZ.
async function getNfesPorPedido(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return [];
  const { data, error } = await banco.from('nfe').select('*').eq('order_id', id);
  assertNoError(error, 'getNfesPorPedido');
  return (data || []).map(mapNfeRow);
}

// ---------------------------------------------------------------------------
// O ACERVO FISCAL DO PERÍODO (fase CN)
//
// O contador gera a EFD a partir dos XML. Este sistema já guarda o XML de toda
// nota autorizada (baixado da Focus) e o de toda entrada (extraído do arquivo
// que o fornecedor mandou) — o que não existia era como TIRAR tudo de uma vez,
// nem como saber se o acervo está completo.
//
// POR QUE SABER SE ESTÁ COMPLETO IMPORTA: o download do XML de saída é melhor
// esforço (ver baixarEGuardarArquivosNfe em server.js) e roda uma vez, no
// instante em que a nota passa a AUTORIZADO. A Focus gera o arquivo de forma
// assíncrona, então uma tentativa imediata pode chegar antes do arquivo existir
// — e não há retentativa. O resultado é acervo com buraco, e buraco em acervo
// fiscal só aparece quando alguém pede o arquivo daquele mês.
//
// CANCELADA ENTRA, e isso não é descuido: nota cancelada existiu para a SEFAZ e
// é escriturada (com o código de situação dela). Deixar de fora produziria um
// acervo que não fecha com a numeração — e este sistema não apaga documento
// fiscal, só cancela.
// ---------------------------------------------------------------------------
const STATUS_ESCRITURAVEIS = ['AUTORIZADO', 'CANCELADO'];

function janelaDoPeriodo(de, ate) {
  // `data_emissao` é timestamptz e o período vem como data: o fim precisa do dia
  // inteiro, senão a última nota do mês fica de fora por causa da hora.
  return [`${String(de).slice(0, 10)}`, `${String(ate).slice(0, 10)}`];
}

/** Quantas notas do período existem, e de quantas já temos o XML guardado. */
async function resumoDoAcervo({ estabelecimentoId, cnpj, de, ate }) {
  const [d, a] = janelaDoPeriodo(de, ate);
  const { rows: saidas } = await consultar(
    `select count(*)::int as total,
            count(arq.nfe_id)::int as com_xml
       from nfe n
       left join nfe_arquivos arq on arq.nfe_id = n.id and arq.tipo = 'xml'
      where n.estabelecimento_id = $1
        and n.status = any($2)
        and n.data_emissao >= $3::date
        and n.data_emissao < ($4::date + interval '1 day')`,
    [estabelecimentoId, STATUS_ESCRITURAVEIS, d, a]
  );
  // Entrada não tem estabelecimento_id: o vínculo é o CNPJ do destinatário, que
  // é como a nota do fornecedor identifica para quem ela foi.
  const { rows: entradas } = await consultar(
    `select count(*)::int as total,
            count(*) filter (where xml is not null and length(xml) > 0)::int as com_xml
       from nfe_entrada
      where replace(replace(replace(destinatario_documento, '.', ''), '/', ''), '-', '') = $1
        and data_emissao >= $2::date
        and data_emissao <= $3::date`,
    [String(cnpj || '').replace(/\D/g, ''), d, a]
  );
  return {
    saidas: { total: saidas[0].total, comXml: saidas[0].com_xml, semXml: saidas[0].total - saidas[0].com_xml },
    entradas: { total: entradas[0].total, comXml: entradas[0].com_xml, semXml: entradas[0].total - entradas[0].com_xml }
  };
}

/** As notas do período que ainda não têm XML guardado — para buscar de novo. */
async function notasSemXml({ estabelecimentoId, de, ate }) {
  const [d, a] = janelaDoPeriodo(de, ate);
  const { rows } = await consultar(
    `select n.id, n.numero, n.serie, n.chave_acesso, n.url_xml, n.url_danfe, n.status
       from nfe n
       left join nfe_arquivos arq on arq.nfe_id = n.id and arq.tipo = 'xml'
      where n.estabelecimento_id = $1
        and n.status = any($2)
        and n.data_emissao >= $3::date
        and n.data_emissao < ($4::date + interval '1 day')
        and arq.nfe_id is null
      order by n.numero`,
    [estabelecimentoId, STATUS_ESCRITURAVEIS, d, a]
  );
  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    serie: r.serie,
    chaveAcesso: (r.chave_acesso || '').trim(),
    urlXml: r.url_xml,
    urlDanfe: r.url_danfe,
    status: r.status
  }));
}

/**
 * Os XML do período, prontos para virar arquivo.
 *
 * Saída e entrada vêm de lugares diferentes — `nfe_arquivos.conteudo` (bytea,
 * baixado da Focus) e `nfe_entrada.xml` (texto, o arquivo do fornecedor) — e
 * saem normalizados no mesmo formato para quem monta o zip não precisar saber
 * disso.
 */
async function xmlDoAcervo({ estabelecimentoId, cnpj, de, ate }) {
  const [d, a] = janelaDoPeriodo(de, ate);
  const { rows: saidas } = await consultar(
    `select n.numero, n.serie, n.chave_acesso, n.status, n.data_emissao, arq.conteudo
       from nfe n
       join nfe_arquivos arq on arq.nfe_id = n.id and arq.tipo = 'xml'
      where n.estabelecimento_id = $1
        and n.status = any($2)
        and n.data_emissao >= $3::date
        and n.data_emissao < ($4::date + interval '1 day')
      order by n.numero`,
    [estabelecimentoId, STATUS_ESCRITURAVEIS, d, a]
  );
  const { rows: entradas } = await consultar(
    `select numero, serie, chave, emitente_nome, data_emissao, xml
       from nfe_entrada
      where replace(replace(replace(destinatario_documento, '.', ''), '/', ''), '-', '') = $1
        and data_emissao >= $2::date
        and data_emissao <= $3::date
        and xml is not null and length(xml) > 0
      order by data_emissao, numero`,
    [String(cnpj || '').replace(/\D/g, ''), d, a]
  );
  return {
    saidas: saidas.map((r) => ({
      chave: (r.chave_acesso || '').trim(),
      numero: r.numero,
      serie: r.serie,
      status: r.status,
      dataEmissao: r.data_emissao,
      // `conteudo` é bytea e chega como '\x3c3f...' — o mesmo desembrulho de
      // mapNfeArquivoRow.
      xml: r.conteudo ? Buffer.from(String(r.conteudo).replace(/^\\x/, ''), 'hex') : null
    })).filter((n) => n.xml && n.xml.length),
    entradas: entradas.map((r) => ({
      chave: (r.chave || '').trim(),
      numero: r.numero,
      serie: r.serie,
      emitente: r.emitente_nome || '',
      dataEmissao: r.data_emissao,
      xml: Buffer.from(String(r.xml), 'utf8')
    }))
  };
}

async function createNfeArquivo(payload) {
  const { data, error } = await banco.from('nfe_arquivos').upsert({
    nfe_id: payload.nfeId,
    tipo: payload.tipo,
    conteudo: bufferToByteaLiteral(payload.conteudo),
    baixado_em: new Date().toISOString()
  }, { onConflict: 'nfe_id,tipo' }).select().single();
  assertNoError(error, 'createNfeArquivo');
  return mapNfeArquivoRow(data);
}

async function getNfeArquivo(nfeId, tipo) {
  const { data, error } = await banco.from('nfe_arquivos').select('*').eq('nfe_id', nfeId).eq('tipo', tipo).maybeSingle();
  assertNoError(error, 'getNfeArquivo');
  return mapNfeArquivoRow(data);
}

module.exports = {
  // Exportados para o teste: ver scripts/test-regra-fiscal-parcial.js.
  buildRegraFiscalFields,
  buildRegraFiscalUpdate,
  CHAVE_DA_COLUNA_REGRA,
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
  salvarTokenFocusDoEstabelecimento,
  getEstabelecimentoFocusCredentials,
  getCertificados,
  createCertificado,
  deleteCertificado,
  getTabelasFiscais,
  getCfopsPorCodigo,
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
  getNfesPorPedido,
  createNfeArquivo,
  // Fase CN — o acervo de XML do período, para o contador. Ver o bloco deles.
  resumoDoAcervo,
  notasSemXml,
  xmlDoAcervo,
  getNfeArquivo
};
