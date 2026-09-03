#!/usr/bin/env node
/**
 * OS <script> DO index.html CARREGAM NA ORDEM SEM QUEBRAR.
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * A fase AS criou as telas de Categorias de Vendas usando as fábricas
 * `MavisStock.makeListScreen` / `makeFormScreen`. Elas são chamadas NO TOPO do
 * arquivo, no momento em que o <script> carrega — e o arquivo que define
 * `window.MavisStock` vinha DEPOIS delas no index.html.
 *
 * Resultado: as telas morriam com "Cannot read properties of undefined (reading
 * 'makeListScreen')" antes de se registrarem, o item do menu abria numa tela que
 * não existia, e nada disso aparecia em lugar nenhum além do console do
 * navegador. Passou por dois commits, um teste de fonte e uma verificação
 * contra a API — porque nenhum deles CARREGA a página.
 *
 * É a classe de erro que ordem de <script> produz: silenciosa, e invisível para
 * quem confere lendo o código, porque cada arquivo isolado está certo. O que
 * está errado é a ordem entre eles.
 *
 * O QUE ELE FAZ
 * -------------
 * Lê os <script src> do index.html, na ordem, e executa cada um num contexto
 * com um `window` e um `document` de mentira. Não renderiza nada e não precisa:
 * o que se mede é o TOPO de cada arquivo — as registradoras, as fábricas e as
 * constantes, que é onde a dependência de ordem mora.
 *
 * O DOM DE MENTIRA É PROPOSITALMENTE BURRO. Ele responde o suficiente para os
 * arquivos carregarem; se um dia algum precisar de mais, o certo é ensinar o
 * boneco, não afrouxar o teste — a falha aqui é sempre a mesma pergunta: "este
 * arquivo consegue carregar onde ele está?".
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const PUBLICO = path.join(RAIZ, 'public');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
const arquivos = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

console.log(`--- ${arquivos.length} scripts, na ordem do index.html ---`);
check('a página carrega scripts', arquivos.length > 20, `${arquivos.length}`);

// ---------------------------------------------------------------------------
// O boneco: um DOM que responde e não faz nada.
// ---------------------------------------------------------------------------
function elementoFalso() {
  const el = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {}, click() {}, insertAdjacentHTML() {}
  };
  return el;
}

function documentoFalso() {
  const doc = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => elementoFalso(),
    createTextNode: () => ({}),
    addEventListener() {}, removeEventListener() {},
    body: elementoFalso(),
    head: elementoFalso(),
    documentElement: elementoFalso(),
    readyState: 'complete',
    cookie: ''
  };
  return doc;
}

const armazem = () => ({ getItem: () => null, setItem() {}, removeItem() {}, clear() {} });

const janela = {};
const contexto = vm.createContext({
  window: janela,
  document: documentoFalso(),
  console: { log() {}, warn() {}, error() {}, info() {} },
  localStorage: armazem(),
  sessionStorage: armazem(),
  fetch: () => Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
  location: { pathname: '/', search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost' },
  history: { pushState() {}, replaceState() {} },
  alert() {}, confirm: () => false, prompt: () => null,
  // O campos.js observa o DOM para religar máscaras em conteúdo que a tela
  // troca. O boneco só precisa existir e aceitar observe/disconnect.
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  URL, URLSearchParams, Intl, Date, Math, JSON,
  atob: (t) => Buffer.from(t, 'base64').toString('binary'),
  btoa: (t) => Buffer.from(t, 'binary').toString('base64')
});
contexto.globalThis = contexto;
contexto.self = contexto;
Object.assign(janela, contexto);

// ---------------------------------------------------------------------------
// Carrega tudo, na ordem.
// ---------------------------------------------------------------------------
// O app.js fica de fora: ele não só define, ele ARRANCA a aplicação (bootstrap
// no fim do arquivo) e sairia procurando sessão, rota e servidor. O que este
// teste mede é a ordem entre os módulos, e o app.js é sempre o último.
const APP = '/app.js';
const quebrados = [];

for (const rel of arquivos) {
  if (rel === APP) continue;
  const abs = path.join(PUBLICO, rel.replace(/^\//, ''));
  if (!fs.existsSync(abs)) {
    quebrados.push({ rel, erro: 'arquivo não existe' });
    continue;
  }
  try {
    vm.runInContext(fs.readFileSync(abs, 'utf8'), contexto, { filename: rel });
  } catch (erro) {
    quebrados.push({ rel, erro: erro.message });
  }
}

quebrados.forEach(({ rel, erro }) => console.log(`  XX  ${rel}\n        ${erro}`));
check('todos carregam sem erro', quebrados.length === 0,
  quebrados.length ? `${quebrados.length} quebrado(s)` : `${arquivos.length - 1} arquivos`);

check('o app.js é o último da página', arquivos[arquivos.length - 1] === APP,
  arquivos[arquivos.length - 1]);

// ---------------------------------------------------------------------------
// E as telas que dependem da ordem chegaram mesmo a se registrar.
// ---------------------------------------------------------------------------
// Carregar sem erro não é o bastante: um `try/catch` mal posto engoliria a
// falha e o registro continuaria faltando. O que interessa é o resultado.
console.log('\n--- as telas registradas ---');
const registro = (janela.MavisSubscreenRegistry || {});
const esperadas = {
  sales: ['sales_categories', 'new_sales_category', 'sales_origins', 'new_sales_origin'],
  purchases: ['purchase_quotes', 'purchase_orders', 'new_purchase_order'],
  fiscal: ['notas_contra_cnpj']
};
Object.entries(esperadas).forEach(([modulo, telas]) => {
  telas.forEach((tela) => {
    check(`${modulo}.${tela} registrou`, typeof (registro[modulo] || {})[tela] === 'function');
  });
});

check('as fábricas do MavisStock existem',
  typeof (janela.MavisStock || {}).makeListScreen === 'function'
  && typeof (janela.MavisStock || {}).makeFormScreen === 'function');

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
