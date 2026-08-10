// Promover alguém a administrador pela tela funciona de verdade?
//
// A tela Configurações > Papéis e Permissões grava o papel em `user_roles` e
// NÃO mexe na coluna antiga `users.role`. Várias rotas decidiam admin na mão
// com `requester.role !== 'admin'` — então o promovido levava "Permissão
// negada" ao abrir Auditoria ou gerenciar usuários. A promoção parecia ter
// funcionado e não tinha: o pior tipo de falha, porque ninguém vai investigar
// o que a tela diz que deu certo.
//
// O teste usa um usuário DESCARTÁVEL, criado e apagado aqui. Nenhuma conta de
// verdade é promovida em momento nenhum — e se o teste morrer no meio, o que
// sobra é um usuário 'zz-teste-admin-papel' que a última seção apaga e que a
// mensagem final ensina a remover na mão.
//
// Precisa do servidor na porta 3999:
//     PORT=3999 npm start   (num terminal)   npm run admin-papel   (noutro)
require('dotenv').config();
const http = require('http');
const db = require('../db');
const rbac = require('../lib/db/rbac');
const { supabase } = require('../lib/db/client');

const PORTA = 3999;
const LOGIN = 'zz-teste-admin-papel';
const SENHA = 'zz' + Math.random().toString(36).slice(2, 12) + 'A1!';

const ESPERA_MAX_MS = 90 * 1000;

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// O servidor é outro processo: mudar o papel aqui invalida o cache DESTE
// processo, não o dele. O cache de permissões dura 60s, então esperar é parte
// do teste — e esperar até a condição valer, não um tempo fixo torcendo para
// dar. Sem isto o teste acusa "não permitiu" quando o servidor só ainda não
// tinha relido os papéis.
async function ateQue(condicao) {
  const limite = Date.now() + ESPERA_MAX_MS;
  let ultimo = null;
  while (Date.now() < limite) {
    ultimo = await condicao();
    if (ultimo.ok) return ultimo;
    process.stdout.write('.');
    await dormir(3000);
  }
  return { ...ultimo, ok: false, estourou: true };
}

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
const entrar = () => pedir('POST', '/api/login', { corpo: { username: LOGIN, password: SENHA } });

let userId = null;
let apagado = false;
async function apagar() {
  if (apagado || !userId) return;
  apagado = true;
  try { await rbac.definirPapeisDoUsuario(userId, [], null); } catch (_) { /* segue e apaga o usuário */ }
  try { await supabase.from('user_permissions').delete().eq('user_id', userId); } catch (_) { /* idem */ }
  await db.deleteUser(userId);
  const { data } = await supabase.from('users').select('id').eq('username', LOGIN).maybeSingle();
  check('usuário descartável removido', !data, data ? 'AINDA EXISTE' : 'removido');
}

(async () => {
  try {
    console.log('\n--- cria um usuário comum (role = user) ---');
    const criado = await db.createUser({
      username: LOGIN, password: SENHA, name: 'Teste Admin por Papel',
      role: 'user', allowedModules: []
    });
    userId = criado.id;
    check('criado com role = user', criado.role === 'user', `role='${criado.role}'`);

    const login = await entrar();
    check('consegue entrar', login.status === 200, `HTTP ${login.status}`);
    const token = login.json?.token;
    if (!token) throw new Error('sem token, não há o que testar');

    console.log('\n--- como usuário comum, Auditoria é fechada ---');
    const antes = await pedir('GET', '/api/audit', { token });
    check('GET /api/audit nega (403)', antes.status === 403, `HTTP ${antes.status}`);
    const usuariosAntes = await pedir('GET', '/api/users', { token });
    check('GET /api/users nega (403)', usuariosAntes.status === 403, `HTTP ${usuariosAntes.status}`);

    console.log('\n--- promove a admin SÓ pelo papel novo (user_roles) ---');
    await rbac.definirPapeisDoUsuario(userId, ['admin'], null);
    const { data: linha } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
    check('a coluna antiga users.role continua "user"', linha?.role === 'user', `role='${linha?.role}'`);
    const acesso = await rbac.carregarAcessoDoUsuario(userId);
    check('o papel admin está em user_roles', (acesso?.roles || []).includes('admin'), (acesso?.roles || []).join(', '));

    console.log('\n--- e agora a promoção tem que valer nas rotas ---');
    // Estes são OS checks. Antes da correção davam 403 para sempre: as rotas
    // liam `requester.role`, que continua 'user', e ignoravam o papel novo.
    process.stdout.write('  aguardando o cache do servidor virar ');
    const depois = await ateQue(async () => {
      const r = await pedir('GET', '/api/audit', { token });
      return { ok: r.status === 200, status: r.status };
    });
    process.stdout.write('\n');
    check('GET /api/audit passa a permitir', depois.ok,
      depois.estourou ? `continuou HTTP ${depois.status} por ${ESPERA_MAX_MS / 1000}s` : 'HTTP 200');
    const usuariosDepois = await pedir('GET', '/api/users', { token });
    check('GET /api/users passa a permitir', usuariosDepois.status === 200, `HTTP ${usuariosDepois.status}`);

    console.log('\n--- tirar o papel volta a fechar ---');
    await rbac.definirPapeisDoUsuario(userId, [], null);
    process.stdout.write('  aguardando o cache do servidor virar ');
    const semPapel = await ateQue(async () => {
      const r = await pedir('GET', '/api/audit', { token });
      return { ok: r.status === 403, status: r.status };
    });
    process.stdout.write('\n');
    check('GET /api/audit nega de novo', semPapel.ok,
      semPapel.estourou ? `continuou HTTP ${semPapel.status}` : 'HTTP 403');
  } catch (erro) {
    check('teste correu até o fim', false, erro.message);
  } finally {
    console.log('\n--- limpando ---');
    await apagar();
  }

  if (falhas) console.log(`\n  Se a limpeza falhou, apague o usuário "${LOGIN}" em Configurações > Usuários.`);
  console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
