// O portão central alcança mesmo o Open Finance?
//
// A regra de permissão dizia '/api/openfinance', mas a rota é
// '/api/open-finance'. O prefixo não casava com nada, então o Open Finance
// passava direto: sem checagem de ação e — o que mais importa — SEM respeitar
// um NEGAR explícito. Um teste de string não prova isso; só uma negação de
// verdade contra o servidor rodando.
//
// A prova é feita TIRANDO permissão, nunca dando: se este teste morrer no meio,
// o pior estado possível é um usuário de teste com uma negação sobrando — e a
// mensagem final ensina a desfazer na tela.
//
// A negação é gravada pela camada de banco (lib/db/rbac.js) em vez da API de
// administração, para o teste não precisar da senha de nenhum admin. O preço é
// esperar: o servidor é outro processo, e o cache de permissões dele só vira
// sozinho (TTL de 60s). O teste aguarda essa virada em vez de supor.
//
// Precisa do servidor na porta 3999 e de SENHA_TESTE no .env:
//     PORT=3999 npm start   (num terminal)   npm run gate   (noutro)
require('dotenv').config();
const http = require('http');
const rbac = require('../lib/db/rbac');
const { banco } = require('../lib/db/client');

const PORTA = 3999;
const USUARIO = process.env.USUARIO_TESTE || 'teste';
const SENHA = process.env.SENHA_TESTE || '';
const ESPERA_MAX_MS = 90 * 1000;

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function pedir(metodo, caminho, { token, corpo } = {}) {
  return new Promise((resolve) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      host: 'localhost', port: PORTA, path: caminho, method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-auth-token': token } : {}),
        ...(dados ? { 'Content-Length': Buffer.byteLength(dados) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch (_) { /* não-JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    if (dados) req.write(dados);
    req.end();
  });
}

// Espera o servidor enxergar a mudança, em vez de dormir um tempo fixo torcendo.
async function ateQue(descricao, condicao) {
  const limite = Date.now() + ESPERA_MAX_MS;
  let ultimo = null;
  while (Date.now() < limite) {
    ultimo = await condicao();
    if (ultimo.ok) return ultimo;
    process.stdout.write('.');
    await dormir(3000);
  }
  process.stdout.write('\n');
  return { ...ultimo, ok: false, estourou: true };
}

(async () => {
  if (!SENHA) {
    console.log('  (defina SENHA_TESTE no .env para rodar este teste)');
    process.exit(0);
  }

  const login = await pedir('POST', '/api/login', { corpo: { username: USUARIO, password: SENHA } });
  if (login.status !== 200) { console.log(`  (login recusou: ${login.status})`); process.exit(1); }
  const token = login.json.token;

  const { data: linha } = await banco.from('users').select('id').eq('username', USUARIO).maybeSingle();
  if (!linha) { console.log(`  (usuário "${USUARIO}" não existe)`); process.exit(1); }
  const userId = linha.id;

  const { data: originais } = await banco
    .from('user_permissions').select('permission_slug,effect').eq('user_id', userId);
  const excecoesOriginais = (originais || []).map((e) => ({ permission_slug: e.permission_slug, effect: e.effect }));
  console.log(`\n  exceções originais de "${USUARIO}": ${excecoesOriginais.length}`);

  let restaurado = false;
  const restaurar = async () => {
    if (restaurado) return;
    restaurado = true;
    await rbac.definirPermissoesDoUsuario(userId, excecoesOriginais);
    const { data: agora } = await banco
      .from('user_permissions').select('permission_slug,effect').eq('user_id', userId);
    const sobrou = (agora || []).some((e) => e.effect === 'NEGAR' && e.permission_slug === 'finance.ler');
    check('estado original devolvido, sem negação sobrando', !sobrou, `${(agora || []).length} exceção(ões)`);
  };

  try {
    console.log('\n--- antes: o usuário lê o Open Finance ---');
    const antes = await pedir('GET', '/api/open-finance/status', { token });
    check('GET /api/open-finance/status responde', antes.status === 200, `HTTP ${antes.status}`);
    if (antes.status !== 200) throw new Error('sem linha de base não há o que provar');

    console.log('\n--- nega finance.ler para esse usuário ---');
    await rbac.definirPermissoesDoUsuario(userId, [
      ...excecoesOriginais.filter((e) => e.permission_slug !== 'finance.ler'),
      { permission_slug: 'finance.ler', effect: 'NEGAR' }
    ]);
    const { data: conf } = await banco
      .from('user_permissions').select('permission_slug,effect').eq('user_id', userId);
    check('negação gravada', (conf || []).some((e) => e.permission_slug === 'finance.ler' && e.effect === 'NEGAR'));

    console.log('\n--- a negação tem que alcançar o Open Finance ---');
    process.stdout.write('  aguardando o cache do servidor virar ');
    // Este é O check. Com o prefixo errado ele ficava 200 para sempre: a rota
    // nem chegava a ser avaliada pelo portão, e a negação valia só para
    // /api/finance.
    const r = await ateQue('403 no open-finance', async () => {
      const resp = await pedir('GET', '/api/open-finance/status', { token });
      return { ok: resp.status === 403, status: resp.status };
    });
    if (!r.estourou) process.stdout.write('\n');
    check('Open Finance passou a barrar (403)', r.ok, r.estourou ? `continuou HTTP ${r.status} por ${ESPERA_MAX_MS / 1000}s` : 'HTTP 403');

    const financeiro = await pedir('GET', '/api/finance/entries', { token });
    check('Financeiro comum barra igual (mesma negação)', financeiro.status === 403, `HTTP ${financeiro.status}`);

    console.log('\n--- e a tentativa negada entrou na trilha de auditoria ---');
    const { data: trilha } = await banco
      .from('access_logs').select('action,result').eq('user_id', userId)
      .eq('result', 'NEGADO').order('created_at', { ascending: false }).limit(20);
    const temRegistro = (trilha || []).some((l) => String(l.action || '').startsWith('finance.'));
    check('negação registrada na auditoria', temRegistro, temRegistro ? '' : 'nenhum finance.* NEGADO');
  } catch (erro) {
    check('teste correu até o fim', false, erro.message);
  } finally {
    console.log('\n--- devolvendo o acesso ---');
    await restaurar();
  }

  console.log('\n--- e o acesso volta ---');
  process.stdout.write('  aguardando o cache do servidor virar ');
  const volta = await ateQue('200 de novo', async () => {
    const resp = await pedir('GET', '/api/open-finance/status', { token });
    return { ok: resp.status === 200, status: resp.status };
  });
  if (!volta.estourou) process.stdout.write('\n');
  check('Open Finance responde de novo', volta.ok, volta.estourou ? `travou em HTTP ${volta.status}` : 'HTTP 200');

  if (falhas) {
    console.log('\n  Se a restauração falhou, abra Configurações > Papéis e Permissões,');
    console.log(`  usuário "${USUARIO}", e deixe ${excecoesOriginais.length} exceção(ões) — sem NEGAR em finance.ler.`);
  }
  console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
