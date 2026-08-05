// Contrato que todo provider de Open Finance precisa implementar.
//
// Nenhum outro módulo deve importar um provider diretamente (nem
// providers/pluggy.js, nem polp.js, nem celcoin.js) — sempre passar por
// lib/openfinance/service.js, que escolhe o provider ativo por
// OPEN_FINANCE_PROVIDER (.env) e expõe essa mesma interface pro resto do ERP.
// Isso é o que garante trocar de agregador sem tocar em rotas/telas.
//
// Todo método retorna dados já normalizados no formato abaixo (não no
// formato bruto de cada provider) — é responsabilidade do adapter de cada
// provider converter.
//
//  Connection   { id, provider, status: 'connected'|'pending'|'error'|'disconnected', institutionId, institutionName, createdAt, updatedAt, errorMessage }
//  Account      { id, connectionId, providerAccountId, type: 'checking'|'savings'|'credit', name, currency, currentBalance, availableBalance, updatedAt }
//  Balance      { accountId, currentBalance, availableBalance, capturedAt }
//  Transaction  { id, providerTransactionId, accountId, amount, currency, direction: 'in'|'out', description, date, processingDate, category, merchantName, merchantDocument, counterpartyName, counterpartyDocument, paymentMethod, pixKey, pixEndToEndId, pixType, documentNumber, raw }
//  Card         { id, connectionId, providerCardId, brand, last4, type: 'credit'|'debit' }
//  CardTransaction { id, cardId, amount, currency, description, date, installments, raw }
//  Institution  { id, name, imageUrl, type }
//
// Métodos que recebem `connection` recebem o registro salvo em
// open_finance_connections (já com credenciais decodificadas via
// lib/secrets.js quando aplicável) — cada provider decide o que fazer com
// connection.credentials.
const REQUIRED_METHODS = [
  'createConnection',
  'getConnection',
  'disconnectConnection',
  'getAccounts',
  'getAccount',
  'getBalance',
  'getTransactions',
  'syncTransactions',
  'getCards',
  'getCardTransactions',
  'handleWebhook',
  'getInstitutions',
  'healthCheck'
];

function assertImplementsProvider(provider, name) {
  const faltando = REQUIRED_METHODS.filter((method) => typeof provider[method] !== 'function');
  if (faltando.length) {
    throw new Error(`Provider de Open Finance "${name}" não implementa: ${faltando.join(', ')}`);
  }
}

module.exports = { REQUIRED_METHODS, assertImplementsProvider };
