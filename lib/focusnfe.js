// Cliente para a API da Focus NFe (https://doc.focusnfe.com.br).
// Autenticação: HTTP Basic Auth com o token da empresa como usuário e senha em branco.
//
// Cada estabelecimento pode ter seu próprio token (guardado criptografado em
// estabelecimento.focus_token_cifrado — ver lib/db/fiscal.js). As funções
// aceitam um "credentials" opcional {token, ambiente}; quando omitido, cai
// pro token único global do .env (usado hoje só pelo painel de status em
// Configurações, antes de existir qualquer estabelecimento cadastrado).
const FOCUS_NFE_BASE_URLS = {
  homologacao: 'https://homologacao.focusnfe.com.br/v2',
  producao: 'https://api.focusnfe.com.br/v2'
};

// Trava de ambiente.
//
// Enquanto ela estiver ligada, NENHUMA chamada sai para a URL de produção —
// nem por um estabelecimento salvo como "producao", nem pelo .env. Uma nota
// autorizada em produção não tem desfazer: ela existe para a SEFAZ, entra na
// apuração e só pode ser cancelada (dentro do prazo) ou virar denúncia de
// espontaneidade. Por isso o padrão é FECHADO: se a variável não existir, o
// sistema assume homologação. Ir para produção tem que ser um ato explícito
// (FOCUS_NFE_SOMENTE_HOMOLOGACAO=0), nunca um esquecimento de configuração.
const DESLIGA_TRAVA = new Set(['0', 'false', 'off', 'nao', 'não']);

function somenteHomologacao() {
  const raw = String(process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO ?? '').trim().toLowerCase();
  return !DESLIGA_TRAVA.has(raw);
}

// Separa o que foi PEDIDO do que vai ser USADO. Sem essa distinção, um
// estabelecimento marcado como produção seria rebaixado em silêncio e o
// usuário acharia que emitiu de verdade.
function ambienteEfetivo(raw) {
  const bruto = String(raw || 'homologacao').toLowerCase();
  const pedido = FOCUS_NFE_BASE_URLS[bruto] ? bruto : 'homologacao';
  const travado = somenteHomologacao();
  const efetivo = travado ? 'homologacao' : pedido;
  return { pedido, efetivo, travado, bloqueado: pedido !== efetivo };
}

function normalizeAmbiente(raw) {
  return ambienteEfetivo(raw).efetivo;
}

function envCredentials() {
  return {
    token: String(process.env.FOCUS_NFE_TOKEN || '').trim(),
    ambiente: normalizeAmbiente(process.env.FOCUS_NFE_AMBIENTE)
  };
}

function isConfigured() {
  return Boolean(envCredentials().token);
}

function getAmbiente() {
  return envCredentials().ambiente;
}

// Recusa em vez de rebaixar. Rebaixar produção para homologação mandaria um
// token de produção para a URL de homologação, e a Focus responderia 403 —
// um erro de autenticação para um problema que é de configuração. Melhor
// parar aqui, com o motivo escrito.
function assertAmbientePermitido(ambienteBruto) {
  const info = ambienteEfetivo(ambienteBruto);
  if (info.bloqueado) {
    const err = new Error(
      'Este estabelecimento está marcado como Produção, mas o sistema está travado em homologação. ' +
      'Enquanto FOCUS_NFE_SOMENTE_HOMOLOGACAO estiver ligada, nenhuma nota sai com valor fiscal: ' +
      'troque o ambiente do estabelecimento para Homologação e use o token de homologação da Focus NFe.'
    );
    err.status = 409;
    throw err;
  }
  return info.efetivo;
}

async function focusRequest(method, path, body, credentials) {
  const creds = credentials || envCredentials();
  if (!creds.token) {
    const err = new Error('Focus NFe não está configurado — falta o token (FOCUS_NFE_TOKEN no .env ou token do estabelecimento).');
    err.status = 501;
    throw err;
  }

  const ambiente = assertAmbientePermitido(creds.ambiente);
  const url = `${FOCUS_NFE_BASE_URLS[ambiente]}${path}`;
  const auth = Buffer.from(`${creds.token}:`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Tempo de resposta excedido ao comunicar com a Focus NFe.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok && response.status !== 202) {
    const message = payload.mensagem || payload.erro || payload.message || 'Erro ao comunicar com a Focus NFe.';
    const err = new Error(message);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return { status: response.status, data: payload, ambiente };
}

// Chamada leve só pra validar que um token é aceito pela Focus NFe.
//
// Usa /hooks, e NÃO /empresas: /empresas é endpoint de conta parceira
// (revenda) e responde 404 para o token comum de uma empresa. Testado contra
// a homologação: token válido devolve 200 com a lista de webhooks, token
// inválido devolve 401 "permissao_negada". Um health check que dá "Falhou"
// para um token bom é pior do que não ter health check — manda procurar
// defeito onde não tem.
async function checkStatus(credentials) {
  const creds = credentials || envCredentials();
  const info = ambienteEfetivo(creds.ambiente);
  const base = {
    ambiente: info.efetivo,
    ambienteSolicitado: info.pedido,
    travadoEmHomologacao: info.travado
  };
  if (!creds.token) {
    return { ...base, configured: false, connected: false, message: 'Token não configurado.' };
  }
  try {
    await focusRequest('GET', '/hooks', undefined, creds);
    return {
      ...base,
      configured: true,
      connected: true,
      message: info.travado
        ? 'Conectado em homologação — notas emitidas aqui NÃO têm valor fiscal.'
        : 'Conectado com sucesso.'
    };
  } catch (error) {
    // 401 é a única resposta que acusa o token; qualquer outra coisa é rede,
    // instabilidade da Focus ou ambiente errado. Dizer "token inválido" para
    // um timeout faz o usuário trocar uma credencial que estava certa.
    const message = error.status === 401
      ? `Token recusado pela Focus NFe (ambiente de ${info.efetivo}). Confira se o token é deste ambiente.`
      : error.message;
    return { ...base, configured: true, connected: false, message, status: error.status };
  }
}

// ATENÇÃO: exige token de conta PARCEIRA (revenda). Com o token comum de uma
// empresa a Focus responde 404 — não é sinal de token inválido. Não use isso
// como teste de conexão (ver checkStatus).
async function listarEmpresas(credentials) {
  const { data } = await focusRequest('GET', '/empresas', undefined, credentials);
  return data;
}

async function emitirNfe(ref, payload, credentials) {
  const { data, status } = await focusRequest('POST', `/nfe?ref=${encodeURIComponent(ref)}`, payload, credentials);
  return { ...data, httpStatus: status };
}

async function consultarNfe(ref, credentials) {
  const { data } = await focusRequest('GET', `/nfe/${encodeURIComponent(ref)}`, undefined, credentials);
  return data;
}

async function cancelarNfe(ref, justificativa, credentials) {
  const { data } = await focusRequest('DELETE', `/nfe/${encodeURIComponent(ref)}`, { justificativa }, credentials);
  return data;
}

async function emitirCartaCorrecao(ref, correcao, credentials) {
  const { data } = await focusRequest('POST', `/nfe/${encodeURIComponent(ref)}/carta_correcao`, { correcao }, credentials);
  return data;
}

// Cadastra na Focus NFe a URL que ela deve chamar quando o status de uma NF-e
// mudar de forma assíncrona (POST /api/fiscal/webhooks/focus neste servidor).
async function criarWebhook({ event, cnpj, url, secret, secretHeader }, credentials) {
  const { data } = await focusRequest('POST', '/hooks', {
    event,
    url,
    cnpj,
    authorization: secret,
    authorization_header: secretHeader
  }, credentials);
  return data;
}

async function listarWebhooks(credentials) {
  const { data } = await focusRequest('GET', '/hooks', undefined, credentials);
  return data;
}

async function excluirWebhook(id, credentials) {
  const { data } = await focusRequest('DELETE', `/hooks/${encodeURIComponent(id)}`, undefined, credentials);
  return data;
}

// Baixa o conteúdo bruto de um arquivo hospedado pela Focus (XML ou DANFE),
// a partir do caminho relativo que ela devolve em caminho_xml_nota_fiscal /
// caminho_danfe. Usado pra guardar uma cópia local, em vez de depender do
// link da Focus continuar disponível pra sempre.
async function baixarArquivo(caminho, credentials) {
  const creds = credentials || envCredentials();
  if (!creds.token) {
    const err = new Error('Focus NFe não está configurado — falta o token.');
    err.status = 501;
    throw err;
  }
  const ambiente = assertAmbientePermitido(creds.ambiente);
  const rootUrl = FOCUS_NFE_BASE_URLS[ambiente].replace(/\/v2$/, '');
  const url = /^https?:\/\//.test(caminho) ? caminho : `${rootUrl}${caminho}`;
  const auth = Buffer.from(`${creds.token}:`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Tempo de resposta excedido ao baixar arquivo da Focus NFe.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const err = new Error(`Não foi possível baixar o arquivo (status ${response.status}).`);
    err.status = response.status;
    throw err;
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function inutilizarNumeracao({ cnpj, serie, numeroInicial, numeroFinal, justificativa }, credentials) {
  const { data } = await focusRequest('POST', '/nfe/inutilizacao', {
    cnpj,
    serie: String(serie),
    numero_inicial: String(numeroInicial),
    numero_final: String(numeroFinal),
    justificativa
  }, credentials);
  return data;
}

// Cliente já vinculado ao token de um estabelecimento específico — usar isso
// (em vez das funções soltas acima) em qualquer fluxo real de emissão.
async function forEstabelecimento(estabelecimentoId) {
  const { getEstabelecimentoFocusCredentials } = require('./db/fiscal');
  let creds = await getEstabelecimentoFocusCredentials(estabelecimentoId);

  // Sem token próprio, cai no token global do .env — mas SÓ com a trava de
  // homologação ligada. Em produção o token é quem identifica o emitente para
  // a Focus: um token global emitindo por um estabelecimento que não é o dele
  // sairia com o CNPJ errado na nota, e nota autorizada não tem desfazer. Em
  // teste, esse mesmo atalho evita recadastrar o token em cada filial.
  if (!creds && somenteHomologacao()) {
    const global = envCredentials();
    if (global.token) creds = { token: global.token, ambiente: 'homologacao' };
  }

  if (!creds) {
    const err = new Error(
      somenteHomologacao()
        ? 'Este estabelecimento não tem token da Focus NFe configurado, e também não há FOCUS_NFE_TOKEN no .env para usar como padrão de teste.'
        : 'Este estabelecimento não tem token da Focus NFe configurado. Em produção cada estabelecimento precisa do token próprio — é ele que identifica o emitente para a Focus.'
    );
    err.status = 400;
    throw err;
  }
  return {
    checkStatus: () => checkStatus(creds),
    listarEmpresas: () => listarEmpresas(creds),
    emitirNfe: (ref, payload) => emitirNfe(ref, payload, creds),
    consultarNfe: (ref) => consultarNfe(ref, creds),
    cancelarNfe: (ref, justificativa) => cancelarNfe(ref, justificativa, creds),
    emitirCartaCorrecao: (ref, correcao) => emitirCartaCorrecao(ref, correcao, creds),
    inutilizarNumeracao: (dados) => inutilizarNumeracao(dados, creds),
    criarWebhook: (dados) => criarWebhook(dados, creds),
    listarWebhooks: () => listarWebhooks(creds),
    excluirWebhook: (id) => excluirWebhook(id, creds),
    baixarArquivo: (caminho) => baixarArquivo(caminho, creds)
  };
}

module.exports = {
  isConfigured,
  getAmbiente,
  somenteHomologacao,
  ambienteEfetivo,
  checkStatus,
  listarEmpresas,
  emitirNfe,
  consultarNfe,
  cancelarNfe,
  emitirCartaCorrecao,
  inutilizarNumeracao,
  criarWebhook,
  listarWebhooks,
  excluirWebhook,
  baixarArquivo,
  forEstabelecimento
};
