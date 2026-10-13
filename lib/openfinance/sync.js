// OpenFinanceSyncService — sincroniza uma conexão (contas, saldos,
// transações) chamando o provider ativo (lib/openfinance/service.js) e
// gravando o resultado. Roda in-process, de forma assíncrona, mas com a
// MESMA forma que teria como job de fila (o "job" é syncConnection) — nota
// de escopo já registrada no plano: trocar por fila de verdade (Bull/Redis)
// depois não muda quem chama isso.
//
// IMPORTANTE sobre onde os dados realmente vivem: open_finance_connections e
// as tabelas novas (Fase E) já são Supabase de verdade (lib/db/openfinance.js).
// Mas bank_accounts/bank_transactions HOJE ainda são servidas pelo arquivo
// local (data/db.json, via loadData/saveData dentro de server.js) — a versão
// Supabase dessas duas tabelas existe (lib/db/financeiro.js) mas nenhuma rota
// usa ela ainda (ver comentário no topo de db.js). Por isso a persistência de
// conta/transação entra por injeção de dependência (deps.persistAccount etc.)
// em vez deste módulo chamar lib/db/financeiro.js direto — quem chama
// syncConnection (server.js) decide onde isso é gravado de verdade, sem este
// módulo precisar saber se é JSON local ou Supabase.
const service = require('./service');
const openFinanceDb = require('../db/openfinance');

// Decide o que fazer com cada conta vinda do provider, comparando com as
// contas locais já vinculadas a essa conexão (existingAccounts precisa vir
// já filtrado por connectionId — quem chama decide de onde essa lista vem).
function computeAccountSync(existingAccounts, providerAccounts) {
  const byProviderId = new Map((existingAccounts || []).map((acc) => [acc.providerAccountId, acc]));
  const toCreate = [];
  const toUpdate = [];
  for (const account of providerAccounts || []) {
    const existing = byProviderId.get(account.providerAccountId);
    if (existing) {
      toUpdate.push({ localId: existing.id, account });
    } else {
      toCreate.push(account);
    }
  }
  return { toCreate, toUpdate };
}

// Transações são imutáveis depois de importadas — só cria a que ainda não
// existe (por providerTransactionId). Nunca atualiza uma já gravada.
function computeTransactionSync(existingTransactions, providerTransactions) {
  const knownIds = new Set((existingTransactions || []).map((tx) => tx.providerTransactionId).filter(Boolean));
  return (providerTransactions || []).filter((tx) => !knownIds.has(tx.providerTransactionId));
}

// Junta a conexão com as credenciais decifradas, no formato que o contrato
// de lib/openfinance/provider.js espera receber em cada chamada ao provider.
async function loadConnectionWithCredentials(connectionId) {
  const connection = await openFinanceDb.getConnectionById(connectionId);
  if (!connection) {
    const err = new Error(`Conexão ${connectionId} não encontrada.`);
    err.status = 404;
    throw err;
  }
  const credentials = await openFinanceDb.getConnectionCredentials(connectionId);
  return { ...connection, credentials };
}

// deps = {
//   getExistingAccounts(connectionId) -> conta[] já filtradas por essa conexão,
//   persistAccount({connectionId, estabelecimentoId, account}) -> conta local criada (com .id),
//   updateAccount(localId, account) -> void,
//   recordBalance(localId, balance) -> void,
//   getExistingTransactions(localAccountId) -> transação[] já filtradas por essa conta,
//   persistTransaction(localAccountId, tx) -> void
// }
// autor = { byId, byName } de quem pediu a sincronização (fase EI). Vem vazio
// quando quem dispara é o webhook — não há usuário por trás —, e aí a
// auditoria fica sem autor, que é a verdade. Antes a sincronização manual
// também ficava sem autor, e não dava para saber quem tinha apertado o botão.
async function syncConnection(connectionId, deps, autor = {}) {
  const connection = await loadConnectionWithCredentials(connectionId);

  // Conexão desconectada não sincroniza (fase EI). Sem esta trava, uma tela
  // aberta antes do "Desconectar" (outra aba, outro usuário) ou um webhook do
  // provider — que pode continuar mandando eventos quando a revogação do lado
  // dele falhou — sincronizava e gravava 'connected' (ou 'error') por cima do
  // 'disconnected', ressuscitando a conexão sem ninguém ter reconectado. Fica
  // ANTES do try de propósito: o catch abaixo regravaria status 'error'.
  if (connection.status === 'disconnected') {
    const err = new Error('Conexão desconectada — reconecte antes de sincronizar.');
    err.status = 409;
    throw err;
  }

  try {
    const providerAccounts = await service.getAccounts(connection);
    const existingAccounts = await deps.getExistingAccounts(connectionId);
    const { toCreate, toUpdate } = computeAccountSync(existingAccounts, providerAccounts);

    const localAccountsByProviderId = new Map(existingAccounts.map((acc) => [acc.providerAccountId, acc]));
    for (const account of toCreate) {
      const created = await deps.persistAccount({ connectionId, estabelecimentoId: connection.estabelecimentoId, account });
      localAccountsByProviderId.set(account.providerAccountId, created);
    }
    for (const { localId, account } of toUpdate) {
      await deps.updateAccount(localId, account);
    }

    let transacoesCriadas = 0;
    for (const account of providerAccounts) {
      const local = localAccountsByProviderId.get(account.providerAccountId);
      if (!local) continue;

      const balance = await service.getBalance(connection, account.providerAccountId);
      await deps.recordBalance(local.id, balance);
      await deps.updateAccount(local.id, {
        ...account,
        currentBalance: balance.currentBalance,
        availableBalance: balance.availableBalance
      });

      const providerTransactions = await service.getTransactions(connection, account.providerAccountId);
      const existingTransactions = await deps.getExistingTransactions(local.id);
      const novas = computeTransactionSync(existingTransactions, providerTransactions);
      for (const tx of novas) {
        await deps.persistTransaction(local.id, tx);
        transacoesCriadas += 1;
      }
    }

    await openFinanceDb.updateConnection(connectionId, {
      status: 'connected',
      errorMessage: null,
      lastSyncAt: new Date().toISOString()
    });
    await openFinanceDb.recordAuditLog({
      connectionId,
      estabelecimentoId: connection.estabelecimentoId,
      action: 'SYNC_COMPLETED',
      byId: (autor && autor.byId) || null,
      byName: (autor && autor.byName) || null,
      details: { contasCriadas: toCreate.length, contasAtualizadas: toUpdate.length, transacoesCriadas }
    });

    return { contasCriadas: toCreate.length, contasAtualizadas: toUpdate.length, transacoesCriadas };
  } catch (error) {
    await openFinanceDb.updateConnection(connectionId, { status: 'error', errorMessage: error.message });
    await openFinanceDb.recordAuditLog({
      connectionId,
      estabelecimentoId: connection.estabelecimentoId,
      action: 'SYNC_FAILED',
      byId: (autor && autor.byId) || null,
      byName: (autor && autor.byName) || null,
      details: { error: error.message }
    });
    throw error;
  }
}

module.exports = { computeAccountSync, computeTransactionSync, syncConnection };
