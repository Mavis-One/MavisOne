#!/usr/bin/env node
/**
 * BANCOS CONECTADOS — SINCRONIZAÇÃO, WEBHOOK E TELA (fase EI).
 *
 *   node scripts/test-open-finance-sync.js
 *
 * Não precisa do servidor no ar: a parte 1 chama syncConnection com o banco e
 * o provider trocados por dublês, a parte 2 usa o Postgres local (cria UMA
 * conexão de teste e apaga no fim) e a parte 3 lê o código-fonte.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. QUE CONEXÃO DESCONECTADA NÃO SINCRONIZA. Antes, uma tela velha (outra aba,
 *    outro usuário) ou um webhook do provider sincronizava e gravava
 *    'connected' por cima do 'disconnected': a conexão voltava sozinha. A
 *    recusa tem de vir ANTES de qualquer gravação — o catch de syncConnection
 *    regravaria status 'error'.
 *
 * 2. QUE A SINCRONIZAÇÃO MANUAL TEM AUTOR NA AUDITORIA. Criar e desconectar
 *    gravavam quem fez; sincronizar não. O webhook segue sem autor, que é a
 *    verdade: não há usuário por trás dele.
 *
 * 3. QUE O WEBHOOK ACHA A CONEXÃO PELO ID DO PROVIDER. O provider nunca soube o
 *    nosso UUID. O webhook procurava pelo id local com o id dele e, antes
 *    disso, tentava gravá-lo numa coluna uuid com FK: o insert falhava e o
 *    evento se perdia.
 *
 * 4. QUE A TELA NÃO MOSTRA UUID CRU, RECARREGA A LISTA NA FALHA, CORTA A
 *    MENSAGEM DE ERRO E MOSTRA A AUDITORIA EM PORTUGUÊS COM O DETALHE.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { consultar, fecharPool } = require('../lib/db/conexao');
const openFinanceDb = require('../lib/db/openfinance');
const service = require('../lib/openfinance/service');
const { syncConnection } = require('../lib/openfinance/sync');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (n, c, d) => { console.log(`  ${c ? 'OK ' : 'XX '} ${n}${d !== undefined ? ' -> ' + d : ''}`); if (!c) falhas++; };

// ---------------------------------------------------------------------------
// Dublês: troca as funções nos próprios objetos dos módulos — sync.js chama
// `openFinanceDb.x(...)` e `service.x(...)` pelo objeto, então enxerga a troca.
// ---------------------------------------------------------------------------
const originaisDb = {};
const originaisService = {};
function dublar(alvo, guarda, nome, fn) {
  if (!(nome in guarda)) guarda[nome] = alvo[nome];
  alvo[nome] = fn;
}
function restaurarDubles() {
  for (const [nome, fn] of Object.entries(originaisDb)) openFinanceDb[nome] = fn;
  for (const [nome, fn] of Object.entries(originaisService)) service[nome] = fn;
}

function montarCenario({ status, providerFalha }) {
  const registro = { updates: [], auditorias: [], chamadasProvider: 0 };
  dublar(openFinanceDb, originaisDb, 'getConnectionById', async (id) => ({ id, estabelecimentoId: 'estab-1', provider: 'pluggy', status }));
  dublar(openFinanceDb, originaisDb, 'getConnectionCredentials', async () => null);
  dublar(openFinanceDb, originaisDb, 'updateConnection', async (id, payload) => { registro.updates.push(payload); return { id, ...payload }; });
  dublar(openFinanceDb, originaisDb, 'recordAuditLog', async (payload) => { registro.auditorias.push(payload); return payload; });
  dublar(service, originaisService, 'getAccounts', async () => {
    registro.chamadasProvider += 1;
    if (providerFalha) throw new Error('credencial expirada');
    return [{ providerAccountId: 'pa-1' }];
  });
  dublar(service, originaisService, 'getBalance', async () => ({ currentBalance: 10, availableBalance: 10 }));
  dublar(service, originaisService, 'getTransactions', async () => [{ providerTransactionId: 'tx-1' }]);
  const deps = {
    getExistingAccounts: async () => [],
    persistAccount: async () => ({ id: 'local-1' }),
    updateAccount: async () => {},
    recordBalance: async () => {},
    getExistingTransactions: async () => [],
    persistTransaction: async () => {}
  };
  return { registro, deps };
}

async function parte1() {
  console.log('\n--- 1. syncConnection: desconectada não sincroniza; autor na auditoria ---');

  {
    const { registro, deps } = montarCenario({ status: 'disconnected' });
    let erro = null;
    try { await syncConnection('c-1', deps, { byId: 'u-1', byName: 'Fulano' }); } catch (e) { erro = e; }
    check('desconectada: recusa com 409', erro && erro.status === 409, erro && `${erro.status} ${erro.message}`);
    check('desconectada: provider nem é chamado', registro.chamadasProvider === 0);
    check('desconectada: status NÃO é regravado', registro.updates.length === 0, JSON.stringify(registro.updates));
    check('desconectada: nada vai para a auditoria', registro.auditorias.length === 0);
  }

  {
    const { registro, deps } = montarCenario({ status: 'connected' });
    const r = await syncConnection('c-1', deps, { byId: 'u-1', byName: 'Fulano' });
    const a = registro.auditorias[0] || {};
    check('sucesso: devolve as contagens', r.contasCriadas === 1 && r.transacoesCriadas === 1, JSON.stringify(r));
    check('sucesso: SYNC_COMPLETED com autor', a.action === 'SYNC_COMPLETED' && a.byId === 'u-1' && a.byName === 'Fulano', JSON.stringify(a));
    check('sucesso: grava connected', registro.updates.some((u) => u.status === 'connected'));
  }

  {
    const { registro, deps } = montarCenario({ status: 'error', providerFalha: true });
    let erro = null;
    try { await syncConnection('c-1', deps, { byId: 'u-1', byName: 'Fulano' }); } catch (e) { erro = e; }
    const a = registro.auditorias[0] || {};
    check('falha: relança o erro do provider', erro && erro.message === 'credencial expirada');
    check('falha: SYNC_FAILED com autor e o erro no detalhe',
      a.action === 'SYNC_FAILED' && a.byId === 'u-1' && a.details && a.details.error === 'credencial expirada', JSON.stringify(a));
    check('falha: grava status error com a mensagem',
      registro.updates.some((u) => u.status === 'error' && u.errorMessage === 'credencial expirada'));
  }

  {
    // Webhook: sem autor. A auditoria fica sem autor em vez de quebrar.
    const { registro, deps } = montarCenario({ status: 'connected' });
    await syncConnection('c-1', deps);
    const a = registro.auditorias[0] || {};
    check('sem autor (webhook): byId/byName nulos', a.byId === null && a.byName === null, JSON.stringify(a));
    const r2 = montarCenario({ status: 'connected' });
    await syncConnection('c-1', r2.deps, null);
    check('autor null não quebra', (r2.registro.auditorias[0] || {}).byId === null);
  }

  restaurarDubles();
}

async function parte2() {
  console.log('\n--- 2. getConnectionByProviderId no Postgres local ---');
  const estab = await consultar('select id from estabelecimento order by ordem limit 1');
  const estabelecimentoId = estab.rows && estab.rows[0] && estab.rows[0].id;
  if (!estabelecimentoId) {
    console.log('  (sem estabelecimento cadastrado no banco local — parte 2 pulada)');
    return;
  }
  const idProvider = `zz-teste-ei-${crypto.randomBytes(4).toString('hex')}`;
  const idEvento = `${idProvider}-evt`;
  let idLocal = null;
  try {
    const criado = await consultar(
      "insert into open_finance_connections (estabelecimento_id, provider, provider_connection_id, status) values ($1, 'pluggy', $2, 'connected') returning id",
      [estabelecimentoId, idProvider]
    );
    idLocal = criado.rows[0].id;

    const achada = await openFinanceDb.getConnectionByProviderId('pluggy', idProvider);
    check('acha pela dupla provider + id do provider', achada && achada.id === idLocal, achada && achada.id);
    const caixa = await openFinanceDb.getConnectionByProviderId('PLUGGY', idProvider);
    check('nome do provider em maiúsculas na URL também acha', caixa && caixa.id === idLocal);
    check('outro provider com o mesmo id: não acha', (await openFinanceDb.getConnectionByProviderId('polp', idProvider)) === null);
    check('id do provider desconhecido: não acha', (await openFinanceDb.getConnectionByProviderId('pluggy', `${idProvider}-x`)) === null);
    check('sem id: devolve null sem consultar', (await openFinanceDb.getConnectionByProviderId('pluggy', null)) === null);
    check('o UUID local NÃO serve como id do provider', (await openFinanceDb.getConnectionByProviderId('pluggy', idLocal)) === null);

    // O caminho que quebrava: com o id LOCAL traduzido, o evento é gravado.
    const evento = await openFinanceDb.recordWebhookEvent({ provider: 'pluggy', connectionId: idLocal, providerEventId: idEvento, payload: { itemId: idProvider } });
    check('evento do webhook gravado com o id local', evento && evento.connectionId === idLocal);
  } finally {
    await consultar('delete from open_finance_webhook_events where provider_event_id = $1', [idEvento]);
    if (idLocal) {
      await consultar('delete from open_finance_audit_logs where connection_id = $1', [idLocal]);
      await consultar('delete from open_finance_connections where id = $1', [idLocal]);
    }
    console.log('  (conexão e evento de teste removidos)');
  }
}

function parte3() {
  console.log('\n--- 3. servidor e tela ---');
  const server = ler('server.js');

  const iniWebhook = server.indexOf("/^\\/api\\/open-finance\\/webhooks\\/[^/]+$/");
  const fimWebhook = server.indexOf("'Erro ao processar webhook'", iniWebhook);
  const webhook = iniWebhook >= 0 && fimWebhook > iniWebhook ? server.slice(iniWebhook, fimWebhook) : '';
  check('achou o bloco do webhook', webhook.length > 0);
  const posTraducao = webhook.indexOf('getConnectionByProviderId(');
  const posGravacao = webhook.indexOf('recordWebhookEvent(');
  check('webhook traduz o id do provider ANTES de gravar o evento', posTraducao >= 0 && posGravacao > posTraducao);
  check('webhook não usa mais o id cru do corpo como id local', !/const connectionId = body\.connectionId/.test(webhook));

  check('rota de sync passa o autor', /syncOpenFinanceConnection\(id, \{ byId: user\.id, byName: user\.name \}\)/.test(server));
  check('lista de conexões leva o nome do estabelecimento', /estabelecimentoNome: nomePorEstabelecimento\.get\(/.test(server));

  const tela = ler('public/modules/finance/subs/bancos_conectados.js');
  check('rótulo nunca devolve o UUID cru', !/\(found\.nomeFantasia \|\| found\.razaoSocial\) : id/.test(tela) && tela.includes('(estabelecimento indisponível)'));
  check('rótulo usa primeiro o nome vindo do servidor', tela.includes('conexao.estabelecimentoNome'));
  const catchSync = tela.slice(tela.indexOf("'Erro ao sincronizar.'"), tela.indexOf("'Erro ao sincronizar.'") + 600);
  check('falha na sincronização recarrega a lista', /loadConnections\(\)/.test(catchSync));
  check('mensagem de erro da conexão cortada com title', /texto-cortado[^"]*muted" style="margin-top:4px" title="\$\{escapeHtml\(c\.errorMessage\)\}"/.test(tela));
  check('flex das ações fica dentro da célula, não no <td>', !tela.includes('<td class="finance-extrato-actions"'));
  // A causa certa para cada caso (fase EI): a flag só liga no catch da
  // leitura, e o modal escolhe a mensagem por ela.
  check('flag da leitura que falhou só liga no catch', /catch \(error\) \{[^}]*leituraEstabelecimentosFalhou = true;/.test(tela));
  check('modal Conectar escolhe a mensagem pela flag', tela.includes('escapeHtml(openFinanceMensagemSemEstabelecimento(leituraEstabelecimentosFalhou))'));
  check('modal não culpa mais a permissão sempre', !tela.includes('Nenhum estabelecimento disponível (requer Fiscal &gt; Visualizar)'));

  // Os ajudantes da auditoria rodam de verdade, num contexto isolado.
  const contexto = { window: {} };
  vm.createContext(contexto);
  vm.runInContext(tela, contexto);
  const detalhe = contexto.openFinanceAuditDetail;
  check('ajudante da auditoria carregou', typeof detalhe === 'function');
  if (typeof detalhe === 'function') {
    check('detalhe: erro da sincronização', detalhe({ details: { error: 'credencial expirada' } }) === 'credencial expirada');
    check('detalhe: aviso do provider', detalhe({ details: { avisoProvider: 'timeout' } }) === 'Aviso do provider: timeout');
    check('detalhe: contagens', detalhe({ details: { contasCriadas: 1, contasAtualizadas: 2, transacoesCriadas: 3 } })
      === '1 conta(s) nova(s), 2 atualizada(s), 3 transação(ões) nova(s)');
    check('detalhe: JSON em texto também', detalhe({ details: '{"error":"x"}' }) === 'x');
    check('detalhe: vazio quando não há', detalhe({ details: null }) === '' && detalhe({}) === '');
  }
  const rotulos = vm.runInContext('OPEN_FINANCE_AUDIT_ACTION_LABELS', contexto);
  check('rótulo em português para SYNC_FAILED', rotulos && rotulos.SYNC_FAILED === 'Falha na sincronização');

  const semEstab = contexto.openFinanceMensagemSemEstabelecimento;
  check('ajudante da mensagem sem estabelecimento carregou', typeof semEstab === 'function');
  if (typeof semEstab === 'function') {
    check('leitura que falhou aponta a permissão Fiscal', /Fiscal › Visualizar/.test(semEstab(true)));
    check('lista vazia de verdade NÃO culpa a permissão', !/Visualizar|permiss/i.test(semEstab(false)));
    check('lista vazia de verdade diz onde cadastrar', /Configurações › Empresa/.test(semEstab(false)));
  }
}

(async () => {
  await parte1();
  await parte2();
  parte3();
})()
  .catch((e) => { console.error(e); falhas++; })
  .finally(async () => {
    restaurarDubles();
    console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
    await fecharPool();
    process.exit(falhas ? 1 : 0);
  });
