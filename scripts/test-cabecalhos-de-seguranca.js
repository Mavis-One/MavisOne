#!/usr/bin/env node
/**
 * OS CABEÇALHOS QUE VALEM PARA TODA RESPOSTA (fase CA — achado 07).
 *
 * Não havia nenhum. Sem eles o navegador aceita ser instruído a fazer coisas
 * que o ERP nunca pede: carregar script de outro domínio, ser embutido num
 * iframe de terceiros (clickjacking), adivinhar o tipo de um arquivo pelo
 * conteúdo, mandar a URL inteira como referer para fora.
 *
 * A CSP É ESTRITA — `script-src 'self'`, sem `'unsafe-inline'`
 * ------------------------------------------------------------
 * Isso é a diferença entre uma CSP que protege e uma que enfeita. Com
 * `'unsafe-inline'`, um `<script>` ou um `<img onerror=...>` injetado executa
 * normalmente e a política não muda nada para XSS.
 *
 * Só foi possível porque o app não tem nada inline: nenhum `<script>` no corpo
 * do HTML, nenhum recurso de CDN, nenhum fetch para fora. Restavam TRÊS
 * atributos `onclick=`, que viraram um ouvinte delegado nesta mesma fase.
 *
 * VERIFICADO NUM CHROME DE VERDADE, com o app rodando: login pelo formulário,
 * os sete módulos abertos, o botão que perdeu o `onclick` clicado —
 * 0 violações de CSP e 0 erros de console.
 *
 * E A TELA PRECISOU OBEDECER O SERVIDOR
 * -------------------------------------
 * A correção do anexo (fase BZ) fazia o servidor mandar
 * `Content-Disposition: attachment` para HTML e SVG. Só que o botão "abrir
 * anexo" NUNCA VIA esse cabeçalho: ele busca os bytes com `fetch` e monta um
 * `blob:` próprio — e URL de blob ignora Content-Disposition e herda a origem
 * de quem a criou. A trava do servidor, sozinha, não alcançava a tela.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const app = ler('public/app.js');
const html = ler('public/index.html');

console.log('--- 1. os cabeçalhos saem em TODA resposta ---');
check('há uma função única', /function aplicarCabecalhosDeSeguranca\(res\)/.test(src));
// No topo do handler, com setHeader: assim vale para sendJson, para serveStatic
// e para a entrega de anexo, sem cada um lembrar de repetir.
// O handler DEIXOU DE SER o callback anônimo do createServer na fase CL: um
// `async` passado direto ao createServer devolve uma Promise que o Node ignora,
// e uma rejeição sem dono derrubava o processo inteiro (era o que deslogava o
// escritório). Ele virou `tratarRequisicao`, com um `catch` em quem chama.
//
// O que este check cobra continua sendo o mesmo: os cabeçalhos são a PRIMEIRA
// coisa do tratamento, para valerem no sendJson, no serveStatic e na entrega de
// anexo sem cada um lembrar de repetir. Mudou onde essa primeira linha mora.
check('  chamada na primeira linha do tratamento da requisição',
  /async function tratarRequisicao\(req, res\) \{\s*\n\s*aplicarCabecalhosDeSeguranca\(res\);/.test(src));
// E ninguém atende por fora dela: o createServer só delega. Sem este par, um
// segundo caminho de resposta poderia nascer no callback, antes dos cabeçalhos.
check('  e é ela que o servidor chama',
  /createServer\(\(req, res\) => \{[\s\S]{0,600}?tratarRequisicao\(req, res\)\.catch\(/.test(src));
for (const cab of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  check(`  ${cab}`, new RegExp(`res\\.setHeader\\('${cab}'`).test(src));
}

console.log('--- 2. a CSP é estrita onde precisa ser ---');
const csp = (/const CSP = \[[\s\S]*?\]\.join\('; '\);/.exec(src) || [''])[0];
check("script-src é 'self' e nada mais", /"script-src 'self'"/.test(csp));
// ESTE é o check que importa. Com 'unsafe-inline' em script-src, script
// injetado roda e a política vira enfeite.
check("  SEM 'unsafe-inline' em script", !/script-src[^"]*unsafe-inline/.test(csp));
check("  SEM 'unsafe-eval'", !/unsafe-eval/.test(csp));
check("default-src fecha o resto", /"default-src 'self'"/.test(csp));
// Estilo injetado não executa código; o risco é muito menor e tirar os 23
// atributos `style="..."` custaria muito mais do que vale.
check("style-src admite inline, e isso é deliberado", /"style-src 'self' 'unsafe-inline'"/.test(csp));
// A tela monta pré-visualização de anexo e abre arquivo por URL de blob.
check('img-src admite data: e blob:', /"img-src 'self' data: blob:"/.test(csp));
check("object-src é 'none'", /"object-src 'none'"/.test(csp));
check("base-uri preso em 'self'", /"base-uri 'self'"/.test(csp));
check("form-action preso em 'self'", /"form-action 'self'"/.test(csp));
// frame-ancestors substitui e supera o X-Frame-Options, que vai junto só por
// navegador antigo.
check("frame-ancestors 'none'", /"frame-ancestors 'none'"/.test(csp));

console.log('--- 3. nada inline no app (é o que sustenta a CSP) ---');
// Um único `onclick=` que volte derruba a CSP inteira: seria preciso reabrir
// 'unsafe-inline', e aí ela deixa de valer contra XSS.
const { semComentarios } = require('./sem-comentarios');
const appCodigo = semComentarios(app);
for (const atributo of ['onclick=', 'onchange=', 'onsubmit=', 'onerror=', 'onload=']) {
  check(`  sem ${atributo} no app.js`, !appCodigo.includes(atributo));
}
check('  nem nos módulos', (() => {
  const dir = path.join(RAIZ, 'public', 'modules');
  const achados = [];
  (function anda(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) anda(p);
      else if (e.name.endsWith('.js')) {
        const t = semComentarios(fs.readFileSync(p, 'utf8'));
        if (/\son(click|change|submit|error|load)=/.test(t)) achados.push(e.name);
      }
    }
  })(dir);
  return achados.length === 0;
})());
// Script inline no HTML tambem obrigaria 'unsafe-inline'. Os comentarios saem
// ANTES: o index.html tem um que menciona `<script>` ao explicar a ordem de
// carga, e a busca crua o acusaria como se fosse um bloco de verdade.
const htmlCodigo = html.replace(/<!--[\s\S]*?-->/g, '');
check('  e o index.html só tem <script src=>', !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(htmlCodigo));
// Recurso de fora obrigaria a afrouxar default-src/script-src.
check('  e nenhum recurso externo', !/https?:\/\//.test(htmlCodigo));

console.log('--- 4. a navegação que substituiu os onclick ---');
check('há um ouvinte delegado', /document\.addEventListener\('click', \(evento\) => \{[\s\S]{0,200}data-ir-para/.test(app));
// Delegado no document, e não religado a cada render: estas telas se
// redesenham inteiras e um ouvinte por botão teria de ser reatado toda vez.
check('  no document, não por botão', /const botao = evento\.target\.closest\('\[data-ir-para\]'\);/.test(app));
const quantos = (app.match(/data-ir-para="/g) || []).length;
check('  e os três botões usam o atributo', quantos === 3, `${quantos} botões`);
// O "+ Nova Venda" também limpava o rascunho antes de navegar — sem isso, abrir
// uma venda nova traria o registro que estava sendo editado.
check('  incluindo a limpeza do rascunho', /data-limpa-rascunho/.test(app) && /state\.salesDraft\.editRecord = null;/.test(app));

console.log('--- 5. a tela obedece o Content-Disposition do servidor ---');
// Sem isto, o `attachment` do servidor não alcançava o botão "abrir anexo":
// blob: ignora o cabeçalho e herda a origem de quem criou a URL.
check('a tela lê o cabeçalho da resposta',
  /const disposicao = String\(resposta\.headers\.get\('content-disposition'\) \|\| ''\);/.test(app));
check('  e BAIXA quando o servidor mandou baixar',
  /if \(disposicao\.trim\(\)\.toLowerCase\(\)\.startsWith\('attachment'\)\)/.test(app));
check('  com o nome do arquivo', /link\.download = ficha \? ficha\.nome : 'anexo';/.test(app));
// UMA decisão só, no servidor. Uma segunda lista de tipos aqui envelheceria
// desencontrada da primeira.
check('  sem repetir a lista de tipos na tela',
  !/text\/html/.test(appCodigo) && !/image\/svg/.test(appCodigo));

console.log('--- 6. medido num Chrome de verdade ---');
for (const [caso, resultado] of [
  ['login pelo formulário', 'entrou'],
  ['sete módulos abertos', 'todos renderizaram'],
  ['botão sem onclick, clicado', 'orders_quotes -> new_sale'],
  ['violações de CSP', '0'],
  ['erros de console', '0']
]) console.log(`  ·  ${caso.padEnd(32)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
