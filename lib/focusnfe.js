// Cliente para a API da Focus NFe (https://doc.focusnfe.com.br).
// Autenticação: HTTP Basic Auth com o token da empresa como usuário e senha em branco.
const FOCUS_NFE_BASE_URLS = {
  homologacao: 'https://homologacao.focusnfe.com.br/v2',
  producao: 'https://api.focusnfe.com.br/v2'
};

function getAmbiente() {
  const raw = String(process.env.FOCUS_NFE_AMBIENTE || 'homologacao').toLowerCase();
  return FOCUS_NFE_BASE_URLS[raw] ? raw : 'homologacao';
}

function getToken() {
  return String(process.env.FOCUS_NFE_TOKEN || '').trim();
}

function isConfigured() {
  return Boolean(getToken());
}

async function focusRequest(method, path, body) {
  if (!isConfigured()) {
    const err = new Error('Focus NFe não está configurado. Defina FOCUS_NFE_TOKEN no arquivo .env.');
    err.status = 501;
    throw err;
  }

  const ambiente = getAmbiente();
  const url = `${FOCUS_NFE_BASE_URLS[ambiente]}${path}`;
  const auth = Buffer.from(`${getToken()}:`).toString('base64');
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

// Chamada leve só pra validar que o token configurado é aceito pela Focus NFe.
async function checkStatus() {
  const ambiente = getAmbiente();
  if (!isConfigured()) {
    return { configured: false, ambiente, connected: false, message: 'Token não configurado.' };
  }
  try {
    await focusRequest('GET', '/empresas');
    return { configured: true, ambiente, connected: true, message: 'Conectado com sucesso.' };
  } catch (error) {
    return { configured: true, ambiente, connected: false, message: error.message, status: error.status };
  }
}

async function listarEmpresas() {
  const { data } = await focusRequest('GET', '/empresas');
  return data;
}

async function emitirNfe(ref, payload) {
  const { data, status } = await focusRequest('POST', `/nfe?ref=${encodeURIComponent(ref)}`, payload);
  return { ...data, httpStatus: status };
}

async function consultarNfe(ref) {
  const { data } = await focusRequest('GET', `/nfe/${encodeURIComponent(ref)}`);
  return data;
}

async function cancelarNfe(ref, justificativa) {
  const { data } = await focusRequest('DELETE', `/nfe/${encodeURIComponent(ref)}`, { justificativa });
  return data;
}

module.exports = {
  isConfigured,
  getAmbiente,
  checkStatus,
  listarEmpresas,
  emitirNfe,
  consultarNfe,
  cancelarNfe
};
