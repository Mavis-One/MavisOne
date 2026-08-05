// OpenFinanceService — ponto único de acesso a qualquer provider de Open
// Finance. Nenhum outro módulo deve importar lib/openfinance/providers/*
// diretamente; sempre passar pelas funções abaixo, pra poder trocar de
// agregador (OPEN_FINANCE_PROVIDER no .env) sem tocar em rotas ou telas —
// mesmo papel que lib/focusnfe.js cumpre pro Fiscal.
const { assertImplementsProvider } = require('./provider');

const PROVIDERS = {
  pluggy: () => require('./providers/pluggy'),
  polp: () => require('./providers/polp'),
  celcoin: () => require('./providers/celcoin')
};

function getActiveProviderName() {
  const raw = String(process.env.OPEN_FINANCE_PROVIDER || '').trim().toLowerCase();
  return PROVIDERS[raw] ? raw : null;
}

function isConfigured() {
  return Boolean(getActiveProviderName());
}

// Resolve um provider por nome explícito (usado pelo webhook, que recebe o
// provider na própria URL — /api/open-finance/webhooks/:provider — e por
// isso não pode depender de qual provider está "ativo" no momento).
function resolveProvider(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!PROVIDERS[key]) return null;
  const provider = PROVIDERS[key]();
  assertImplementsProvider(provider, key);
  return provider;
}

function getProviderByName(name) {
  const provider = resolveProvider(name);
  if (!provider) {
    const err = new Error(`Provider de Open Finance desconhecido: "${name}".`);
    err.status = 400;
    throw err;
  }
  return provider;
}

// Resolve sempre o provider ativo (OPEN_FINANCE_PROVIDER) na hora da
// chamada — nunca guarda uma referência antiga — pra refletir mudança de
// env em tempo de execução (ex.: troca de provider em teste).
function getProvider() {
  const name = getActiveProviderName();
  if (!name) {
    const err = new Error('Nenhum provider de Open Finance configurado — defina OPEN_FINANCE_PROVIDER no .env (pluggy, polp ou celcoin).');
    err.status = 501;
    throw err;
  }
  return resolveProvider(name);
}

async function healthCheck() {
  const name = getActiveProviderName();
  if (!name) {
    return {
      configured: false,
      provider: null,
      connected: false,
      message: 'Nenhum provider de Open Finance configurado (OPEN_FINANCE_PROVIDER no .env).'
    };
  }
  return getProvider().healthCheck();
}

// Métodos do contrato expostos 1:1, sempre delegando ao provider ativo.
function createConnection(...args) { return getProvider().createConnection(...args); }
function getConnection(...args) { return getProvider().getConnection(...args); }
function disconnectConnection(...args) { return getProvider().disconnectConnection(...args); }
function getAccounts(...args) { return getProvider().getAccounts(...args); }
function getAccount(...args) { return getProvider().getAccount(...args); }
function getBalance(...args) { return getProvider().getBalance(...args); }
function getTransactions(...args) { return getProvider().getTransactions(...args); }
function syncTransactions(...args) { return getProvider().syncTransactions(...args); }
function getCards(...args) { return getProvider().getCards(...args); }
function getCardTransactions(...args) { return getProvider().getCardTransactions(...args); }
function handleWebhook(...args) { return getProvider().handleWebhook(...args); }
function getInstitutions(...args) { return getProvider().getInstitutions(...args); }

module.exports = {
  getActiveProviderName,
  isConfigured,
  getProviderByName,
  healthCheck,
  createConnection,
  getConnection,
  disconnectConnection,
  getAccounts,
  getAccount,
  getBalance,
  getTransactions,
  syncTransactions,
  getCards,
  getCardTransactions,
  handleWebhook,
  getInstitutions
};
