// Sessão única por usuário: entrar numa máquina derruba a outra.
//
// Simula dois computadores com o MESMO usuário e confere as três coisas que
// importam:
//   1. a máquina antiga realmente perde o acesso (não basta "parecer" logada);
//   2. ela descobre POR QUE caiu, e não um "Erro inesperado" a cada clique;
//   3. a máquina nova continua funcionando normalmente.
//
// Precisa do servidor na porta 3999 e de SENHA_TESTE no .env:
//     npm start   (num terminal)      npm run sessao   (noutro)
require('dotenv').config();
const http = require('http');

const PORTA = 3999;
const USUARIO = process.env.USUARIO_TESTE || 'teste';
const SENHA = process.env.SENHA_TESTE || '';

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

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

const entrar = () => pedir('POST', '/api/login', { corpo: { username: USUARIO, password: SENHA } });

(async () => {
  if (!SENHA) {
    console.log('  (defina SENHA_TESTE no .env para rodar este teste)');
    process.exit(0);
  }

  console.log('\n--- máquina A entra ---');
  const a = await entrar();
  if (a.status !== 200) { console.log(`  (login recusou: ${a.status})`); process.exit(1); }
  const tokenA = a.json.token;
  check('A autenticada', Boolean(tokenA));
  check('A consegue usar o sistema', (await pedir('GET', '/api/me', { token: tokenA })).status === 200);

  console.log('\n--- a sessão vence na virada do dia ---');
  // O cálculo em si está coberto por test-sessao-expira.js (sem servidor).
  // Aqui só se confere o contrato do login: o servidor DIZ quando a sessão
  // morre, e é por esse instante que a tela agenda a própria saída.
  const vence = a.json?.sessaoExpiraEm;
  check('login devolve sessaoExpiraEm', typeof vence === 'number', String(vence));
  if (typeof vence === 'number') {
    const d = new Date(vence);
    check('é meia-noite cravada', d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0, d.toLocaleString('pt-BR'));
    check('está no futuro', vence > Date.now(), `faltam ${Math.round((vence - Date.now()) / 60000)} min`);
    check('e dentro das próximas 24h', vence - Date.now() <= 24 * 60 * 60 * 1000);
  }
  const eu = await pedir('GET', '/api/me', { token: tokenA });
  check('/api/me também devolve (F5 reagenda a saída)', typeof eu.json?.sessaoExpiraEm === 'number', String(eu.json?.sessaoExpiraEm));

  console.log('\n--- máquina B entra com o MESMO usuário ---');
  const b = await entrar();
  const tokenB = b.json?.token;
  check('B autenticada', Boolean(tokenB));
  check('B recebeu token diferente de A', tokenA !== tokenB);

  console.log('\n--- A tem que cair, e saber por quê ---');
  const depois = await pedir('GET', '/api/me', { token: tokenA });
  check('A perdeu o acesso (401)', depois.status === 401, `${depois.status}`);
  check('A recebe o MOTIVO, não um erro genérico', depois.json?.motivo === 'outro-dispositivo', depois.json?.motivo || '(sem motivo)');
  check('a mensagem explica em português', /outro dispositivo/i.test(depois.json?.error || ''), (depois.json?.error || '').slice(0, 60));

  // O motivo tem que valer para QUALQUER rota, não só /api/me — a tela pode
  // estar em qualquer lugar quando a derrubada acontece.
  const outra = await pedir('GET', '/api/fleet/vehicles', { token: tokenA });
  check('o mesmo motivo vale em outra rota', outra.json?.motivo === 'outro-dispositivo', `${outra.status} ${outra.json?.motivo || ''}`);

  console.log('\n--- B continua trabalhando ---');
  check('B segue autenticada', (await pedir('GET', '/api/me', { token: tokenB })).status === 200);

  console.log('\n--- token inventado NÃO recebe esse motivo ---');
  // Só quem foi derrubado ganha a explicação. Um token qualquer é apenas
  // inválido — dizer "você foi derrubado" a um desconhecido entregaria a
  // informação de que aquele token um dia existiu.
  const falso = await pedir('GET', '/api/me', { token: 'token-que-nunca-existiu' });
  check('token desconhecido dá 401 sem motivo', falso.status === 401 && !falso.json?.motivo, falso.json?.motivo || 'sem motivo');

  console.log('\n--- entrar de novo em A derruba B ---');
  const a2 = await entrar();
  check('A entrou de novo', a2.status === 200);
  check('agora é B que cai', (await pedir('GET', '/api/me', { token: tokenB })).json?.motivo === 'outro-dispositivo');
  check('a sessão nova de A funciona', (await pedir('GET', '/api/me', { token: a2.json.token })).status === 200);

  console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
