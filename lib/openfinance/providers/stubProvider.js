// Fábrica de provider "esqueleto": implementa o contrato inteiro de
// lib/openfinance/provider.js, mas sem nenhuma integração real ainda — cada
// método lança um erro claro até o provider ganhar credenciais e endpoints
// confirmados. Mesmo caminho que lib/focusnfe.js percorreu nesta base de
// código: primeiro o contrato/forma, depois a chamada real quando houver
// credencial de teste pra validar contra a API de verdade.
function createConfigurationError(providerName, envVarsNecessarias) {
  const err = new Error(
    `Provider de Open Finance "${providerName}" não está configurado — configure ${envVarsNecessarias.join(', ')} no .env e implemente a chamada real em lib/openfinance/providers/${providerName}.js.`
  );
  err.status = 501;
  return err;
}

function createStubProvider(providerName, envVarsNecessarias) {
  const throwNotConfigured = () => {
    throw createConfigurationError(providerName, envVarsNecessarias);
  };

  return {
    async createConnection() { return throwNotConfigured(); },
    async getConnection() { return throwNotConfigured(); },
    async disconnectConnection() { return throwNotConfigured(); },
    async getAccounts() { return throwNotConfigured(); },
    async getAccount() { return throwNotConfigured(); },
    async getBalance() { return throwNotConfigured(); },
    async getTransactions() { return throwNotConfigured(); },
    async syncTransactions() { return throwNotConfigured(); },
    async getCards() { return throwNotConfigured(); },
    async getCardTransactions() { return throwNotConfigured(); },
    async handleWebhook() { return throwNotConfigured(); },
    async getInstitutions() { return throwNotConfigured(); },
    async healthCheck() {
      return {
        configured: false,
        provider: providerName,
        connected: false,
        message: `Credenciais não configuradas (${envVarsNecessarias.join(', ')}).`
      };
    }
  };
}

module.exports = { createStubProvider, createConfigurationError };
