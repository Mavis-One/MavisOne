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

function normalizeAmbiente(raw) {
  const value = String(raw || 'homologacao').toLowerCase();
  return FOCUS_NFE_BASE_URLS[value] ? value : 'homologacao';
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

async function focusRequest(method, path, body, credentials) {
  const creds = credentials || envCredentials();
  if (!creds.token) {
    const err = new Error('Focus NFe não está configurado — falta o token (FOCUS_NFE_TOKEN no .env ou token do estabelecimento).');
    err.status = 501;
    throw err;
  }

  const ambiente = normalizeAmbiente(creds.ambiente);
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
async function checkStatus(credentials) {
  const creds = credentials || envCredentials();
  const ambiente = normalizeAmbiente(creds.ambiente);
  if (!creds.token) {
    return { configured: false, ambiente, connected: false, message: 'Token não configurado.' };
  }
  try {
    await focusRequest('GET', '/empresas', undefined, creds);
    return { configured: true, ambiente, connected: true, message: 'Conectado com sucesso.' };
  } catch (error) {
    return { configured: true, ambiente, connected: false, message: error.message, status: error.status };
  }
}

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

// Cliente já vinculado ao token de um estabelecimento específico — usar isso
// (em vez das funções soltas acima) em qualquer fluxo real de emissão.
async function forEstabelecimento(estabelecimentoId) {
  const { getEstabelecimentoFocusCredentials } = require('./db/fiscal');
  const creds = await getEstabelecimentoFocusCredentials(estabelecimentoId);
  if (!creds) {
    const err = new Error('Este estabelecimento não tem token da Focus NFe configurado.');
    err.status = 400;
    throw err;
  }
  return {
    checkStatus: () => checkStatus(creds),
    listarEmpresas: () => listarEmpresas(creds),
    emitirNfe: (ref, payload) => emitirNfe(ref, payload, creds),
    consultarNfe: (ref) => consultarNfe(ref, creds),
    cancelarNfe: (ref, justificativa) => cancelarNfe(ref, justificativa, creds)
  };
}

module.exports = {
  isConfigured,
  getAmbiente,
  checkStatus,
  listarEmpresas,
  emitirNfe,
  consultarNfe,
  cancelarNfe,
  forEstabelecimento
};
