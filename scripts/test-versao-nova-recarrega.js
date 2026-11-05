#!/usr/bin/env node
/**
 * A ABA ABERTA DURANTE O DEPLOY RECARREGA SOZINHA (05/11/2026).
 *
 * O print do usuário ("ainda não corrigiu"): o filtro dos relatórios ainda com
 * o rótulo "Filial" e a lista em "[object Object]", depois do conserto
 * publicado. O rótulo "Filial" só existe no catalogo.js de antes de fc54cd1 —
 * era a aba aberta antes do deploy, rodando o JavaScript velho contra o
 * servidor novo. O sistema é uma página só e trocar de tela não recarrega nada.
 *
 * Agora a página guarda a versão com que abriu (<meta name="mavis-versao">,
 * o hash do index.html carimbado), toda resposta JSON diz a de agora
 * (X-Versao-Sistema), e a troca de tela com versão nova recarrega a página.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const versao = require('../lib/versao-dos-estaticos');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

console.log('--- 1. a versão do sistema ---');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-versao-'));
const html = '<!DOCTYPE html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n  </head>\n  <body><script src="/a.js"></script></body>\n</html>\n';
fs.writeFileSync(path.join(pasta, 'index.html'), html);
fs.writeFileSync(path.join(pasta, 'a.js'), 'console.log(1);');
versao.esquecer();
const pagina1 = versao.paginaComVersao(html, pasta);
const meta1 = (pagina1.match(/<meta name="mavis-versao" content="([^"]+)" \/>/) || [])[1] || '';
check('a página leva a versão no <head>', meta1.length === 12 && pagina1.indexOf('mavis-versao') < pagina1.indexOf('</head>'), meta1);
check('  e continua carimbada', /src="\/a\.js\?v=[A-Za-z0-9_-]{8}"/.test(pagina1));
check('a API diz a mesma versão que a página', versao.versaoDoSistema(pasta) === meta1);
check('  mesma tela, mesma versão', versao.paginaComVersao(html, pasta) === pagina1);

// Muda um script: muda o carimbo dele, muda o index.html carimbado, muda a versão.
const antes = Date.now();
fs.writeFileSync(path.join(pasta, 'a.js'), 'console.log(2); // outro tamanho');
check('mudou um script e a versão guardada vale meio minuto', versao.versaoDoSistema(pasta, antes + 1000) === meta1);
const depois = versao.versaoDoSistema(pasta, antes + 31 * 1000);
check('  passado o meio minuto, a versão é outra', depois && depois !== meta1, `${meta1} -> ${depois}`);
versao.esquecer();
check('  (o deploy reinicia o servidor: começa já com a nova)', versao.versaoDoSistema(pasta) === depois);
const pagina2 = versao.paginaComVersao(html, pasta);
check('  e a página aberta agora traz a nova', pagina2.includes(`content="${depois}"`));
check('sem index.html, sem versão (e sem cabeçalho)', versao.versaoDoSistema(path.join(pasta, 'nao-existe')) === '');
fs.rmSync(pasta, { recursive: true, force: true });

console.log('\n--- 2. o servidor ---');
const servidor = ler('server.js');
check('o index.html sai com a versão', /transformar: \(html\) => versaoEstatica\.paginaComVersao\(html\.toString\('utf8'\), PUBLIC_DIR\)/.test(servidor));
const sendJson = servidor.slice(servidor.indexOf('function sendJson('), servidor.indexOf('function sendJson(') + 5000);
check('todo JSON leva X-Versao-Sistema (também o 304)',
  /const versaoDoSistema = versaoEstatica\.versaoDoSistema\(PUBLIC_DIR\);\s*if \(versaoDoSistema\) res\.setHeader\('X-Versao-Sistema', versaoDoSistema\);/.test(sendJson)
  && sendJson.indexOf("'X-Versao-Sistema'") < sendJson.indexOf('writeHead(304'));

console.log('\n--- 3. a tela ---');
const app = ler('public/app.js');
check('a resposta é conferida logo depois do fetch',
  /const response = await fetch\(path, \{ \.\.\.options, headers \}\);\s*conferirVersaoDoSistema\(response\.headers\.get\('X-Versao-Sistema'\)\);/.test(app));
check('a troca de tela recarrega depois de gravar o endereço da tela nova',
  /gravarTelaNoEndereco\(moduleName, state\.activeSub\);[\s\S]{0,200}if \(recarregarSeVersaoNova\(moduleName, state\.activeSub\)\) return;/.test(app));
check('o aviso tem estilo', /\.aviso-versao-nova \{/.test(ler('public/app.css')));

// O bloco da tela, rodando com um navegador de mentira.
const ini = app.indexOf("const VERSAO_DA_PAGINA = ");
const fim = app.indexOf('async function apiDireto(');
const bloco = app.slice(ini, fim);
function navegador(versaoDaPagina) {
  const guardado = new Map();
  const corpo = [];
  const nav = {
    recarregou: 0,
    corpo,
    sessionStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null), setItem: (k, v) => guardado.set(k, String(v)) },
    location: { reload: () => { nav.recarregou += 1; } }
  };
  const elemento = () => {
    const el = { attrs: {}, setAttribute: (k, v) => { el.attrs[k] = v; }, querySelector: () => ({ addEventListener: (t, f) => { el.clique = f; } }) };
    return el;
  };
  const documento = {
    querySelector: (sel) => (sel === 'meta[name="mavis-versao"]' && versaoDaPagina ? { content: versaoDaPagina } : null),
    getElementById: (id) => corpo.find((e) => e.id === id) || null,
    createElement: elemento,
    body: { appendChild: (e) => corpo.push(e) }
  };
  // eslint-disable-next-line no-new-func
  const f = new Function('window', 'document', `${bloco}; return { conferirVersaoDoSistema, recarregarSeVersaoNova };`);
  return Object.assign(nav, f(nav, documento));
}

const a = navegador('VERSAO-VELHA');
a.recarregarSeVersaoNova('reports', 'catalogo');
a.conferirVersaoDoSistema('VERSAO-VELHA');
check('mesma versão: nada acontece', a.recarregarSeVersaoNova('sales', 'list') === false && a.recarregou === 0 && a.corpo.length === 0);
a.conferirVersaoDoSistema('VERSAO-NOVA');
check('versão nova: aparece o aviso', a.corpo.length === 1 && a.corpo[0].id === 'avisoVersaoNova' && /O sistema foi atualizado/.test(a.corpo[0].innerHTML));
a.conferirVersaoDoSistema('VERSAO-NOVA');
check('  uma vez só', a.corpo.length === 1);
check('  redesenhar a mesma tela não recarrega', a.recarregarSeVersaoNova('sales', 'list') === false && a.recarregou === 0);
check('  trocar de tela recarrega', a.recarregarSeVersaoNova('reports', 'catalogo') === true && a.recarregou === 1);

const b = navegador('V1');
b.recarregarSeVersaoNova('sales', 'new_sale');
b.conferirVersaoDoSistema('V2');
check('sair do pedido não recarrega (o digitado ficaria pelo caminho)', b.recarregarSeVersaoNova('reports', 'catalogo') === false && b.recarregou === 0);
check('  a troca seguinte recarrega', b.recarregarSeVersaoNova('finance', 'lancamentos') === true && b.recarregou === 1);
b.recarregarSeVersaoNova('finance', 'edicao_titulo');
check('  sair da edição de título também não', b.recarregarSeVersaoNova('dashboard', '') === false);
check('a página recarregada ainda velha não entra em laço', b.recarregarSeVersaoNova('reports', 'catalogo') === false && b.recarregou === 1);
b.corpo[0].clique();
check('  o botão "Recarregar agora" recarrega mesmo assim', b.recarregou === 2);

const c = navegador('');
c.recarregarSeVersaoNova('reports', 'catalogo');
c.conferirVersaoDoSistema('QUALQUER');
check('página sem versão (index.html de antes): não faz nada', c.corpo.length === 0 && c.recarregarSeVersaoNova('sales', 'list') === false);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
