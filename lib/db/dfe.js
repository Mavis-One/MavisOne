/**
 * AS NOTAS EMITIDAS CONTRA O NOSSO CNPJ no banco. Tabelas da fase-ar:
 * `nfe_distribuicao` e `dfe_nsu`.
 *
 * A GRAVAÇÃO É UM UPSERT POR (CNPJ, CHAVE), e isso é o desenho, não detalhe:
 * buscar por período e depois pela chave devolve o mesmo documento, e inserir
 * as duas vezes deixaria a tela com a nota duplicada — uma cópia manifestada e
 * outra não. O índice único da migração é quem garante; este arquivo só o usa.
 *
 * DUAS AUSÊNCIAS DELIBERADAS
 * --------------------------
 * 1. Não existe `excluirDocumento`. É registro do que a SEFAZ disse. Uma nota
 *    emitida contra nós por engano ou por fraude é justamente a que não pode
 *    sumir da tela — a resposta a ela é manifestar desconhecimento, que fica
 *    gravado, e não apagar a linha.
 *
 * 2. Não existe função que grave manifestação sem ter ido à SEFAZ. Manifestar é
 *    um evento fiscal com efeito jurídico; marcar a coluna sem o evento faria a
 *    tela mentir sobre algo que a Receita consulta.
 */

const { banco, createId, assertNoError } = require('./client');

// A listagem NÃO traz o XML. Uma nota completa tem de 20 a 200 KB; um `select *`
// numa tela de 15 linhas seriam megabytes por abertura. Mesma decisão de
// lib/db/entrada-nfe.js, pelo mesmo motivo.
const COLUNAS_LISTA = [
  'id', 'cnpj_destinatario', 'empresa_nome', 'nsu', 'chave',
  'emitente_documento', 'emitente_nome', 'data_emissao', 'valor_total',
  'tipo_documento', 'manifestacao_codigo', 'manifestado_em', 'manifestado_por_nome',
  'entrada_id', 'criado_em'
].join(', ');

function mapDocumento(row) {
  if (!row) return null;
  return {
    id: row.id,
    cnpjDestinatario: row.cnpj_destinatario,
    empresaNome: row.empresa_nome || '',
    nsu: row.nsu == null ? null : Number(row.nsu),
    // `character(44)` volta com espaços à direita quando o valor é menor; o
    // trim evita que a chave chegue à tela com rabo invisível e não case numa
    // comparação de string.
    chave: String(row.chave || '').trim(),
    emitenteDocumento: row.emitente_documento || '',
    emitenteNome: row.emitente_nome || '',
    dataEmissao: row.data_emissao,
    valorTotal: Number(row.valor_total || 0),
    tipoDocumento: row.tipo_documento,
    manifestacaoCodigo: row.manifestacao_codigo || '',
    manifestadoEm: row.manifestado_em || null,
    manifestadoPorNome: row.manifestado_por_nome || '',
    entradaId: row.entrada_id || '',
    temXml: row.xml !== undefined ? Boolean(row.xml) : undefined,
    criadoEm: row.criado_em
  };
}

async function listarDocumentos({ cnpj } = {}) {
  let consulta = banco.from('nfe_distribuicao').select(COLUNAS_LISTA);
  if (cnpj) consulta = consulta.eq('cnpj_destinatario', String(cnpj).replace(/\D/g, ''));
  const { data, error } = await consulta.order('nsu', { ascending: false });
  assertNoError(error, 'listarDocumentos');
  return (data || []).map(mapDocumento);
}

async function obterDocumento(id) {
  const { data, error } = await banco.from('nfe_distribuicao').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'obterDocumento');
  return mapDocumento(data);
}

/** O XML sai só aqui, e só quando alguém precisa dele de verdade. */
async function obterXml(id) {
  const { data, error } = await banco.from('nfe_distribuicao').select('xml').eq('id', id).maybeSingle();
  assertNoError(error, 'obterXml');
  return data ? data.xml : null;
}

async function obterPorChave(cnpj, chave) {
  const { data, error } = await banco.from('nfe_distribuicao').select(COLUNAS_LISTA)
    .eq('cnpj_destinatario', String(cnpj).replace(/\D/g, ''))
    .eq('chave', String(chave).replace(/\D/g, ''))
    .maybeSingle();
  assertNoError(error, 'obterPorChave');
  return mapDocumento(data);
}

/**
 * Grava (ou atualiza) um documento vindo da SEFAZ.
 *
 * NUNCA APAGA O XML QUE JÁ SE TINHA. Uma busca por resumo depois de já ter o
 * documento completo devolveria xml nulo, e sobrescrever com nulo perderia a
 * nota inteira — a mesma nota que a SEFAZ só entrega uma vez após a
 * manifestação. Por isso o xml só é escrito quando vem preenchido.
 *
 * E não toca na manifestação: quem manifesta é a rota que foi à SEFAZ.
 */
async function gravarDocumento({ cnpjDestinatario, empresaNome, documento }) {
  const cnpj = String(cnpjDestinatario || '').replace(/\D/g, '');
  const existente = await obterPorChave(cnpj, documento.chave);

  const campos = {
    cnpj_destinatario: cnpj,
    empresa_nome: empresaNome || '',
    nsu: documento.nsu || 0,
    chave: documento.chave,
    emitente_documento: documento.emitenteDocumento || '',
    emitente_nome: documento.emitenteNome || '',
    data_emissao: documento.dataEmissao || null,
    valor_total: Number(documento.valorTotal || 0),
    resumo: documento.bruto || {},
    atualizado_em: new Date().toISOString()
  };
  // Só promove para 'completo'; nunca rebaixa. Ver o cabeçalho.
  if (documento.xml) {
    campos.xml = documento.xml;
    campos.tipo_documento = 'completo';
  } else if (!existente) {
    campos.tipo_documento = 'resumo';
  }

  if (existente) {
    const { error } = await banco.from('nfe_distribuicao').update(campos).eq('id', existente.id);
    assertNoError(error, 'gravarDocumento.update');
    return { id: existente.id, novo: false };
  }
  const id = createId('dfe');
  const { error } = await banco.from('nfe_distribuicao').insert({ id, ...campos });
  assertNoError(error, 'gravarDocumento.insert');
  return { id, novo: true };
}

/** Registra a manifestação DEPOIS que a SEFAZ aceitou o evento. */
async function registrarManifestacao(id, { codigo, usuarioId, usuarioNome }) {
  const { error } = await banco.from('nfe_distribuicao').update({
    manifestacao_codigo: codigo,
    manifestado_em: new Date().toISOString(),
    manifestado_por: usuarioId || null,
    manifestado_por_nome: usuarioNome || '',
    atualizado_em: new Date().toISOString()
  }).eq('id', id);
  assertNoError(error, 'registrarManifestacao');
  return obterDocumento(id);
}

/** Guarda o XML completo que a SEFAZ liberou após a manifestação. */
async function guardarXml(id, xml) {
  const { error } = await banco.from('nfe_distribuicao').update({
    xml, tipo_documento: 'completo', atualizado_em: new Date().toISOString()
  }).eq('id', id);
  assertNoError(error, 'guardarXml');
}

/** Liga o documento à entrada que ele virou. É o que impede lançar duas vezes. */
async function ligarEntrada(id, entradaId) {
  const { error } = await banco.from('nfe_distribuicao').update({
    entrada_id: entradaId, atualizado_em: new Date().toISOString()
  }).eq('id', id);
  assertNoError(error, 'ligarEntrada');
  return obterDocumento(id);
}

// --------------------------------------------------------------------------
// O ponteiro de NSU, por CNPJ
// --------------------------------------------------------------------------
async function obterNsu(cnpj) {
  const limpo = String(cnpj || '').replace(/\D/g, '');
  const { data, error } = await banco.from('dfe_nsu').select('*').eq('cnpj', limpo).maybeSingle();
  assertNoError(error, 'obterNsu');
  if (!data) return { cnpj: limpo, ultimoNsu: 0, maxNsu: 0, sincronizadoEm: null };
  return {
    cnpj: data.cnpj,
    ultimoNsu: Number(data.ultimo_nsu || 0),
    maxNsu: Number(data.max_nsu || 0),
    sincronizadoEm: data.sincronizado_em
  };
}

/**
 * Avança o ponteiro — e SÓ AVANÇA.
 *
 * `Math.max` com o valor guardado, e não atribuição direta: uma busca por chave
 * específica ou por um NSU antigo devolve documentos de trás, e gravar o NSU
 * deles rebaixaria o ponteiro. A próxima sincronização rebaixaria tudo de novo,
 * duplicando trabalho e — pior — dando a impressão de que havia notas novas.
 */
async function avancarNsu(cnpj, { ultimoNsu, maxNsu }) {
  const limpo = String(cnpj || '').replace(/\D/g, '');
  const atual = await obterNsu(limpo);
  const linha = {
    cnpj: limpo,
    ultimo_nsu: Math.max(atual.ultimoNsu, Number(ultimoNsu || 0)),
    max_nsu: Math.max(atual.maxNsu, Number(maxNsu || 0)),
    sincronizado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  };
  const { error } = await banco.from('dfe_nsu').upsert(linha);
  assertNoError(error, 'avancarNsu');
  return { cnpj: limpo, ultimoNsu: linha.ultimo_nsu, maxNsu: linha.max_nsu, sincronizadoEm: linha.sincronizado_em };
}

module.exports = {
  listarDocumentos, obterDocumento, obterXml, obterPorChave,
  gravarDocumento, registrarManifestacao, guardarXml, ligarEntrada,
  obterNsu, avancarNsu
};
