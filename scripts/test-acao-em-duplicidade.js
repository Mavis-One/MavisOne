#!/usr/bin/env node
/**
 * AÇÃO EM DUPLICIDADE BLOQUEADA (15/10/2026). Pedido do usuário: "reforce e
 * bloqueie qualquer tipo de função de ação em duplicidade".
 *
 * Três travas na tela (public/app.js) e uma no servidor, todas centrais:
 *   - api(): a mesma gravação em andamento, ou até 2 s depois, não é reenviada;
 *   - o mesmo botão em menos de 0,4 s é um clique só (data-repetir libera);
 *   - o mesmo formulário em menos de 0,4 s é um envio só;
 *   - servidor: mesma sessão + endereço + corpo, em andamento ou há menos de
 *     3 s, devolve a resposta da primeira sem executar de novo.
 *
 * Provado: 3 POST idênticos simultâneos criaram 1 categoria (as outras com
 * X-Gravacao-Repetida: 1); a mesma logo depois também voltou repetida; corpo
 * diferente executou; depois de 3,3 s executou de novo. No navegador: 2 PUT
 * idênticos juntos + 1 logo depois = 1 ida ao servidor; clique duplo real em
 * 80 ms = 1 execução; com data-repetir = 2; Enter duplo = 1 envio.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = ler('public/app.js');
const servidor = ler('server.js');

console.log('--- tela ---');
check('api() passa pela guarda; quem fala com o servidor é apiDireto',
  app.includes('async function api(path, options = {}) {') && app.includes('async function apiDireto(path, options = {}, jaRepetiu = false) {')
  && app.includes('return apiDireto(path, options, true);'));
check('  só gravação (GET não entra), em andamento ou até 2 s depois de dar certo',
  app.includes("if (metodo === 'GET' || metodo === 'HEAD') return '';") && app.includes('const GRAVACAO_REPETIDA_MS = 2000;')
  && app.includes('if (emAndamento) return emAndamento;'));
check('clique duplo no mesmo botão é um só (0,4 s), na captura', /document\.addEventListener\('click', \(evento\) => \{[\s\S]{0,400}evento\.stopImmediatePropagation\(\);[\s\S]{0,120}\}, true\);/.test(app)
  && app.includes('const JANELA_DO_CLIQUE_DUPLO_MS = 400;'));
check('  data-repetir libera (mover item ▲▼)', app.includes("alvo.hasAttribute('data-repetir')") && (app.match(/sales-mover-item" data-repetir/g) || []).length === 2);
check('formulário enviado duas vezes é um envio só', /document\.addEventListener\('submit', \(evento\) => \{[\s\S]{0,300}form\.__ultimoEnvio/.test(app));

console.log('\n--- servidor ---');
check('toda escrita com sessão em /api/ passa pela guarda, antes das rotas',
  servidor.includes("if (sessaoRecebida && pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {")
  && servidor.indexOf('if (await guardaDeGravacaoRepetida(req, res, url)) return;') < servidor.indexOf("if (pathname === '/api/login' && req.method === 'POST') {"));
check('  chave: sessão + método + endereço + corpo', /update\(String\(req\.headers\['x-auth-token'\] \|\| ''\)\)[\s\S]{0,200}update\(url\.pathname \+ url\.search\)[\s\S]{0,60}update\(corpo\)/.test(servidor));
check('  repetida devolve a resposta da primeira, marcada', servidor.includes("res.setHeader('X-Gravacao-Repetida', '1');"));
check('  erro não fica guardado (tentar de novo vale)', servidor.includes('if (!registro.resposta || registro.resposta.status >= 400) {'));
check('  janela de 3 s depois de terminar', servidor.includes('const GRAVACAO_REPETIDA_JANELA_MS = 3000;'));
check('o corpo é lido uma vez; readBody usa o já lido com o limite de cada rota',
  servidor.includes("if (typeof req.__corpoPreLido === 'string') {") && servidor.includes("if (Buffer.byteLength(corpo, 'utf8') > limiteBytes) {"));
check('sendJson avisa a guarda do que respondeu', servidor.includes("if (typeof res.__capturarJson === 'function') res.__capturarJson(payload, statusCode);"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
