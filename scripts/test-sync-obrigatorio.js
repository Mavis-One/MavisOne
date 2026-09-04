#!/usr/bin/env node
/**
 * NENHUMA ROTA CONSOME COLEÇÃO DO POSTGRES SEM SINCRONIZAR (fase BC).
 *
 * A CLASSE DE BUG QUE ISTO PEGA
 * ------------------------------
 * O sistema está migrando coleções do data/db.json para o Postgres. O Set
 * NAO_PERSISTIR (server.js) lista as que já foram: `saveData` as remove antes
 * de gravar, e `loadData` as devolve VAZIAS. Quem quiser lê-las precisa chamar
 * antes o `sync*Data` correspondente.
 *
 * Quem esquece não recebe erro. Recebe uma lista vazia — e responde HTTP 200
 * com o total zerado, o select sem opção, o filtro sem resultado, a validação
 * que sempre aprova. Foi assim que, ao mesmo tempo:
 *
 *   - o dashboard do Financeiro mostrava R$ 0,00 enquanto a lista de
 *     lançamentos, na mesma sessão, mostrava os títulos;
 *   - `/api/cadastros/meta` devolvia directory: 0, deposits: 0, users: 0, e
 *     cadastrar um contato para um cliente REAL dava 404;
 *   - um depósito com movimentação no razão foi EXCLUÍDO com success: true.
 *
 * COMO ELE MEDE
 * -------------
 * Fecho transitivo: para cada rota, segue as funções que ela chama e junta o
 * que essas funções consomem. É preciso ir além do corpo da rota porque os bugs
 * reais estavam nos helpers — buildFinanceDashboardSummary, directory,
 * serializeSalesRecord — e não no `if` da rota.
 *
 * TRÊS REGRAS PARA NÃO ACUSAR INOCENTE:
 *
 * 1. INFRAESTRUTURA NÃO CONTA. loadData/saveData/normalizeData tocam TODAS as
 *    coleções para normalizar, não para responder pergunta de negócio. Segui-las
 *    faz 83 rotas parecerem culpadas, e aí ninguém olha o relatório.
 *
 * 2. SÓ CONTA LEITURA QUE CONSOME. `data.X` sozinho pode ser atribuição;
 *    filter/find/some/map/reduce/length é o código perguntando algo a uma lista
 *    que chegou vazia.
 *
 * 3. NOME REPETIDO NÃO É SEGUIDO. `build`, `serialize` e `inUse` existem uma vez
 *    por coleção em cadastros-core e stock-core. Atribuir as leituras da
 *    primeira a todas as outras produz falso positivo. Ambíguo não conta: perde
 *    alcance, ganha confiança.
 *
 * A LINHA DE BASE
 * ---------------
 * PENDENTES lista o que ficou aberto, com o motivo de cada um. Não é
 * tolerância: é o registro do que se sabe e ainda não se corrigiu. Rota NOVA
 * fora da lista quebra o teste — que é o ponto.
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

// ---------------------------------------------------------------------------
// O que fica aberto, e por quê.
// ---------------------------------------------------------------------------
// Chave: "rota|coleção". Valor: por que ainda não foi corrigido.
const PENDENTES = {
  // VAZIA desde a fase BD. Era aqui que morava a família do saldo por
  // cor/depósito: catorze leituras do razão em rotas que nunca o carregavam.
  //
  // O que aquilo causava, reproduzido num banco de prova antes de mexer: com 10
  // unidades Brancas no razão, um pedido de 1 Branca era recusado com
  // "Estoque insuficiente (disponível: 0)", o mesmo pedido SEM cor passava, e a
  // mesma baixa passava pela tela de Estoque > Movimentações. Item sem cor
  // escapava porque projeta contra products.stock_quantity, que vem do banco.
  //
  // Deixar vazia é deliberado: uma entrada nova aqui precisa vir com o motivo
  // escrito e com a decisão de quem podia decidir, nunca como atalho para o
  // teste passar.
};

// ---------------------------------------------------------------------------
const src = ler('server.js');
const linhas = src.split('\n');

const POPULA = {
  syncCadastroData: ['people', 'cnpjs', 'deposits'],
  syncSalesData: ['orders', 'quotes', 'importLogs'],
  syncPurchasesData: ['purchases'],
  syncNfeData: ['nfes', 'nfe'],
  syncFinanceData: ['finance', 'financialPayments', 'financialCategories', 'costCenters', 'bankAccounts'],
  // loadStockContext chama syncCadastroData por dentro (server.js), então quem
  // o chama já tem pessoas, cnpjs e depósitos além do razão.
  loadStockContext: ['stockMovements', 'stockTransfers', 'people', 'cnpjs', 'deposits'],
  // Fase BD: o razão sozinho, para quem já tem o próprio `data` na mão e não
  // pode trocar por outro (Vendas, Compras, Fiscal, os painéis).
  sincronizarRazao: ['stockMovements', 'stockTransfers']
};
const SYNC_DE = {};
Object.entries(POPULA).forEach(([fn, cols]) => cols.forEach((c) => { (SYNC_DE[c] = SYNC_DE[c] || []).push(fn); }));

// Helpers auto-suficientes: sincronizam por dentro, ou vão ao banco quando a
// memória falha. Quem os chama não precisa ter sincronizado antes.
const RESOLVE_SOZINHO = {
  numeroDaNotaDoPedido: ['nfes', 'nfe'],
  // Fase BD: passou a carregar o razão também, porque quem chama grava a
  // entrada com o MESMO `data` e confere saldo por cor em cima dele.
  conferirEntradaDeNfe: ['people', 'cnpjs', 'deposits', 'stockMovements', 'stockTransfers']
};

const INFRA = new Set([
  'loadData', 'saveData', 'normalizeData', 'ensureCadastroCollections',
  'syncCadastroData', 'syncSalesData', 'syncPurchasesData', 'syncNfeData',
  'syncFinanceData', 'loadStockContext', 'ensureStockCollections', 'sincronizarRazao'
]);

const ARQUIVOS = [
  'server.js', 'lib/cadastros-core.js', 'lib/stock-core.js', 'lib/atencao.js',
  'lib/kpis.js', 'lib/relatorios-vendas.js', 'lib/painel-pessoal-vendas.js'
];

const blocoSet = /const NAO_PERSISTIR = new Set\(\[([\s\S]*?)\]\)/.exec(src);
check('achei o Set NAO_PERSISTIR', Boolean(blocoSet));
const VIGIADAS = [...blocoSet[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)]
  .map((m) => m[1])
  // products/settings nunca são lidos de `data`; equipments tem camada própria.
  .filter((c) => !['products', 'settings', '__movimentosPendentes', 'equipments'].includes(c));
check('  com coleções para vigiar', VIGIADAS.length > 8, `${VIGIADAS.length}`);

const CONSOME = (c) => new RegExp(
  `(?:data|dados)\\.${c}\\s*(?:\\|\\|\\s*\\[\\]\\s*\\))?\\s*\\.(?:filter|find|findIndex|some|every|map|reduce|forEach|slice|sort|length|includes)`
  + `|\\((?:data|dados)\\.${c}\\s*\\|\\|\\s*\\[\\]\\)\\s*\\.`
  + `|of\\s+\\((?:data|dados)\\.${c}`
  + `|of\\s+(?:data|dados)\\.${c}\\b`
);

const FUNCOES = new Map();
const AMBIGUOS = new Set();
for (const rel of ARQUIVOS) {
  const ls = ler(rel).split('\n');
  const aberturas = [];
  ls.forEach((l, i) => {
    let m = /^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/.exec(l);
    if (m) { aberturas.push({ nome: m[1], i }); return; }
    m = /^ {2,4}(?:async )?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/.exec(l);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) {
      aberturas.push({ nome: m[1], i });
    }
  });
  aberturas.forEach((a, k) => {
    if (FUNCOES.has(a.nome)) { AMBIGUOS.add(a.nome); return; }
    const fim = k + 1 < aberturas.length ? aberturas[k + 1].i : ls.length;
    const corpo = ls.slice(a.i, fim).join('\n');
    const proprios = new Set();
    Object.entries(POPULA).forEach(([fn, cols]) => {
      if (corpo.includes(`${fn}(`)) cols.forEach((c) => proprios.add(c));
    });
    (RESOLVE_SOZINHO[a.nome] || []).forEach((c) => proprios.add(c));
    FUNCOES.set(a.nome, {
      proprios,
      leituras: VIGIADAS.filter((c) => CONSOME(c).test(corpo) && !proprios.has(c)),
      chamadas: [...new Set([
        ...[...corpo.matchAll(/(?:^|[^.\w])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
        ...[...corpo.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
      ])].filter((c) => !INFRA.has(c) && c !== a.nome)
    });
  });
}
check('mapeei as funções', FUNCOES.size > 100, `${FUNCOES.size} (${AMBIGUOS.size} nome(s) ambíguo(s) ignorado(s))`);

const cache = new Map();
function leiturasDe(nome, vistos = new Set()) {
  if (cache.has(nome)) return cache.get(nome);
  if (vistos.has(nome) || INFRA.has(nome) || AMBIGUOS.has(nome)) return [];
  vistos.add(nome);
  const f = FUNCOES.get(nome);
  if (!f) return [];
  const total = new Set(f.leituras);
  const via = new Map(f.leituras.map((c) => [c, nome]));
  for (const c of f.chamadas) {
    if (!FUNCOES.has(c) || AMBIGUOS.has(c)) continue;
    for (const x of leiturasDe(c, vistos)) {
      if (f.proprios.has(x.col)) continue;
      if (!total.has(x.col)) { total.add(x.col); via.set(x.col, x.via); }
    }
  }
  const saida = [...total].map((c) => ({ col: c, via: via.get(c) }));
  if (vistos.size === 1) cache.set(nome, saida);
  return saida;
}

const inicios = [];
linhas.forEach((l, i) => {
  if (/^ {2}(?:const \w+Match = pathname\.match|if \(pathname)/.test(l)) inicios.push(i);
});
function rotulo(i) {
  for (let k = i; k < Math.min(i + 4, linhas.length); k += 1) {
    const m = /'(\/api\/[^']*)'|\\\/api\\\/([a-z-]+)/.exec(linhas[k]);
    if (m) {
      const met = /'(GET|POST|PUT|DELETE|PATCH)'/.exec(linhas[k]);
      return ((m[1] || `/api/${m[2]}`) + ' ' + (met ? met[1] : '')).trim();
    }
  }
  return linhas[i].trim().slice(0, 60);
}

const achados = [];
for (let n = 0; n < inicios.length; n += 1) {
  const de = inicios[n];
  const ate = n + 1 < inicios.length ? inicios[n + 1] : linhas.length;
  const corpo = linhas.slice(de, ate).join('\n');
  if (!/req\.method|pathname/.test(corpo)) continue;

  const achadas = new Map();
  VIGIADAS.filter((c) => CONSOME(c).test(corpo)).forEach((c) => achadas.set(c, '(na própria rota)'));
  const chamadas = [...new Set([
    ...[...corpo.matchAll(/(?:^|[^.\w])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
    ...[...corpo.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
  ])].filter((c) => !INFRA.has(c));
  for (const c of chamadas) {
    if (!FUNCOES.has(c) || AMBIGUOS.has(c)) continue;
    for (const { col, via } of leiturasDe(c)) if (!achadas.has(col)) achadas.set(col, via);
  }

  const resolvidas = new Set();
  Object.entries(RESOLVE_SOZINHO).forEach(([fn, cols]) => {
    if (corpo.includes(`${fn}(`)) cols.forEach((c) => resolvidas.add(c));
  });

  [...achadas.entries()].forEach(([c, via]) => {
    if (resolvidas.has(c)) return;
    const syncs = SYNC_DE[c] || [];
    if (syncs.some((fn) => new RegExp(`${fn}\\(`).test(corpo))) return;
    achados.push({ linha: de + 1, rota: rotulo(de), col: c, via });
  });
}

console.log(`\n--- ${achados.length} leitura(s) sem sync ---`);
const novos = achados.filter((a) => !PENDENTES[`${a.rota}|${a.col}`]);
const conhecidos = achados.filter((a) => PENDENTES[`${a.rota}|${a.col}`]);

conhecidos.forEach((a) => console.log(`  (conhecido) ${a.rota} · ${a.col} — ${PENDENTES[`${a.rota}|${a.col}`]}`));
novos.forEach((a) => console.log(`  NOVO server.js:${a.linha}  ${a.rota} lê ${a.col} via ${a.via}`));

check('nenhuma leitura sem sync FORA da linha de base', novos.length === 0,
  novos.length ? `${novos.length} nova(s)` : `${conhecidos.length} conhecida(s), 0 nova(s)`);

// A linha de base não pode envelhecer em silêncio: entrada que já foi corrigida
// e continua listada faz o próximo leitor achar que o problema existe.
const usadas = new Set(conhecidos.map((a) => `${a.rota}|${a.col}`));
const obsoletas = Object.keys(PENDENTES).filter((k) => !usadas.has(k));
check('a linha de base não tem entrada obsoleta', obsoletas.length === 0,
  obsoletas.length ? `já corrigido(s), remova de PENDENTES: ${obsoletas.join(' ; ')}` : `${usadas.size} em uso`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
