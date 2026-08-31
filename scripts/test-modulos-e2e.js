// Fluxo real dos módulos novos pelas rotas HTTP, autenticado.
//
// Diferente do npm run modulos, que fala direto com a camada de banco, este
// exercita o MESMO caminho que as telas: login, cabeçalho de autorização,
// portão de permissão, roteamento e serialização JSON. É onde aparecem os
// erros que a camada de baixo não pega — rota não registrada, permissão
// negada, campo que some no meio do caminho.
//
// Precisa do servidor rodando na porta 3999 e de SENHA_TESTE no .env.
//     npm start  (num terminal)     npm run e2e  (noutro)
// Sem SENHA_TESTE ele avisa e sai sem falhar, em vez de adivinhar credencial.
require('dotenv').config();
const http = require('http');
const { banco } = require('../lib/db/client');

const PORTA = 3999;
let token = '';
let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

function pedir(metodo, caminho, corpo) {
  return new Promise((resolve) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      host: 'localhost', port: PORTA, path: caminho, method: metodo,
      headers: {
        'Content-Type': 'application/json',
        // O servidor lê a sessão de x-auth-token, não de Authorization: Bearer
        // (ver getCurrentUser no server.js). Mandar o cabeçalho errado dava
        // login OK seguido de 401 em tudo.
        ...(token ? { 'x-auth-token': token } : {}),
        ...(dados ? { 'Content-Length': Buffer.byteLength(dados) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch (_) { /* resposta não-JSON */ }
        resolve({ status: res.statusCode, json, texto: b.slice(0, 120) });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, texto: 'sem conexão' }));
    if (dados) req.write(dados);
    req.end();
  });
}

const criados = [];

(async () => {
  try {
    console.log('\n--- 0. login ---');
    // Usuario dedicado ao teste, nao um admin: assim o e2e exercita o caminho
    // de quem tem permissao concedida, que e onde os furos aparecem. Admin
    // passa por cima de tudo e esconderia justamente esses furos.
    const usuario = process.env.USUARIO_TESTE || 'teste';
    const login = await pedir('POST', '/api/login', { username: usuario, password: process.env.SENHA_TESTE || '' });
    if (login.status !== 200) {
      console.log(`  (login recusou: ${login.status} — defina SENHA_TESTE no .env para rodar o e2e)`);
      console.log('  As rotas já foram validadas pela camada de banco (npm run modulos).');
      process.exit(0);
    }
    token = login.json.token;
    check('autenticado', Boolean(token));

    console.log('\n--- 1. apoio dos formulários ---');
    for (const mod of ['fleet', 'hr', 'pcp', 'contracts']) {
      const r = await pedir('GET', `/api/${mod}/meta`);
      check(`/api/${mod}/meta responde`, r.status === 200, `${r.status}`);
    }

    console.log('\n--- 2. criar veículo pela rota ---');
    const v = await pedir('POST', '/api/fleet/vehicles', { plate: 'ZZE2E01', description: 'ZZ e2e', status: 'ativo', odometer: '' });
    check('POST cria (201)', v.status === 201, `${v.status} ${v.texto}`);
    const veiculoId = v.json?.vehicle?.id;
    if (veiculoId) criados.push(['fleet_vehicles', veiculoId]);
    check('odômetro vazio virou o padrão 0', Number(v.json?.vehicle?.odometer) === 0, String(v.json?.vehicle?.odometer));

    const lista = await pedir('GET', '/api/fleet/vehicles');
    check('GET lista traz o criado', (lista.json?.vehicles || []).some((x) => x.id === veiculoId));
    check('meta de Frota já enxerga o veículo', ((await pedir('GET', '/api/fleet/meta')).json?.vehicles || []).some((x) => x.id === veiculoId));

    console.log('\n--- 3. o erro do banco chega legível na tela ---');
    const dup = await pedir('POST', '/api/fleet/vehicles', { plate: 'zze2e01' });
    check('placa repetida devolve 400', dup.status === 400, `${dup.status}`);
    check('mensagem explica o motivo', /duplicate|unique|idx_fleet_plate/i.test(dup.json?.error || ''), (dup.json?.error || '').slice(0, 70));

    console.log('\n--- 4. editar e excluir ---');
    const put = await pedir('PUT', `/api/fleet/vehicles/${veiculoId}`, { odometer: 1234 });
    check('PUT aplica', Number(put.json?.vehicle?.odometer) === 1234, String(put.json?.vehicle?.odometer));
    check('PUT parcial preserva a placa', put.json?.vehicle?.plate === 'ZZE2E01', put.json?.vehicle?.plate);
    // O usuário do teste tem papel "usuario", que por decisão da Fase S opera
    // mas NÃO exclui: apagar um veículo some com o histórico de manutenções e
    // abastecimentos dele (cascade), e isso é coisa de gerente ou admin.
    // Este check vale mais que um DELETE bem-sucedido: prova que o portão de
    // permissão está de pé no caminho real, com token e tudo.
    const del = await pedir('DELETE', `/api/fleet/vehicles/${veiculoId}`);
    check('usuário comum é BARRADO ao excluir (403)', del.status === 403, `${del.status}`);
    check('e o veículo continua lá', ((await pedir('GET', '/api/fleet/vehicles')).json?.vehicles || []).some((x) => x.id === veiculoId));

    console.log('\n--- 5. recurso inexistente ---');
    const nada = await pedir('GET', '/api/fleet/inventado');
    check('404 em recurso desconhecido', nada.status === 404, `${nada.status}`);

    console.log('\n--- 6. CRM: token nunca volta para a tela ---');
    const crm = await pedir('GET', '/api/crm/connection');
    check('conexão responde', crm.status === 200, `${crm.status}`);
    check('resposta NÃO traz o token', !('apiToken' in (crm.json?.connection || {})) && !JSON.stringify(crm.json).includes('api_token'), JSON.stringify(crm.json?.connection || {}).slice(0, 80));
    check('diz apenas SE existe token', 'temToken' in (crm.json?.connection || {}));
  } catch (e) {
    falhas++;
    console.log('  XX  ERRO:', e.message);
  } finally {
    for (const [tabela, id] of criados) await banco.from(tabela).delete().eq('id', id);
    console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
    process.exit(falhas === 0 ? 0 : 1);
  }
})();
