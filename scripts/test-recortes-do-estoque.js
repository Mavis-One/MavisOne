#!/usr/bin/env node
/**
 * CADA TELA PEDE SÓ O QUE LÊ, E CADA ROTA DE UM PRODUTO CARREGA SÓ ELE
 * (fase de desempenho — Estoque, Compras, PCP e Contratos).
 *
 * O QUE MUDOU, E O QUE PODE DAR ERRADO DEPOIS
 * -------------------------------------------
 * 1. Os metas ganharam um recorte opcional: `/api/stock/meta?produtos=0`,
 *    `/api/pcp/meta?produtos=0` e `/api/contracts/meta?diretorio=0`. Quem
 *    dispensa não recebe o catálogo (782 KB, 440 KB) nem o diretório (1,6 MB).
 *    O padrão continua sendo MANDAR.
 *
 *    O risco é o de sempre neste desenho: uma tela que dispensou passa a ler
 *    `meta.products` e renderiza o seletor VAZIO, sem erro nenhum — e "nenhum
 *    produto cadastrado" é do tipo de mensagem em que a pessoa acredita. É o
 *    que a seção 1 pega, olhando cada tela que dispensa.
 *
 * 2. Status do Produto, a quebra por cor e as escritas de Estoque passaram a
 *    carregar SÓ os produtos que tocam e o razão deles
 *    (loadStockContextDosProdutos). O risco: alguém, numa dessas rotas, usar
 *    `data.stockMovements` para total ou para outro produto. A seção 2 prende
 *    quais rotas usam o recorte; o porquê de cada uma está no bloco da função.
 *
 * Sem banco: é leitura de fonte, como test-carregamento-de-telas.js.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = ler('server.js');
function pedacoDaRota(assinatura) {
  const inicio = servidor.indexOf(assinatura);
  if (inicio < 0) return '';
  const resto = servidor.slice(inicio + assinatura.length);
  // Até o próximo `if (` do nível das rotas: as de DELETE abrem com regex, e
  // não com `pathname ===` — cortar só no próximo `if (pathname` engoliria a
  // rota vizinha.
  const fim = resto.search(/\n {2}if \(/);
  return assinatura + (fim < 0 ? resto : resto.slice(0, fim));
}

// ---------------------------------------------------------------------------
console.log('\n--- 1a. Estoque: quem dispensa o catálogo não o lê ---');
// `meta.products`, `meta?.products` e `(meta && meta.products)` — as três
// grafias que existem no código das telas.
const LE_PRODUTOS = /\bmeta\s*(?:\?\.|\.|&&\s*meta\.)\s*products\b/;
const DIR_ESTOQUE = path.join(RAIZ, 'public/modules/stock/subs');
const dispensam = [];
const pedem = [];
for (const f of fs.readdirSync(DIR_ESTOQUE).filter((x) => x.endsWith('.js'))) {
  const fonte = ler(`public/modules/stock/subs/${f}`);
  const dispensa = /loadMeta\(api, showToast, \{ produtos: false \}\)/.test(fonte) || /\bsemProdutos: true\b/.test(fonte);
  const pede = /S\.loadMeta\(api, showToast\)/.test(fonte) || /\bneedsMeta: true\b/.test(fonte);
  if (!dispensa && !pede) continue;
  (dispensa ? dispensam : pedem).push({ f, le: LE_PRODUTOS.test(fonte) });
}
const erradas = dispensam.filter((t) => t.le).map((t) => t.f);
check('telas que dispensam existem', dispensam.length >= 6, dispensam.map((t) => t.f).join(', '));
check('  e nenhuma delas lê meta.products', erradas.length === 0,
  erradas.length ? 'RENDERIZARIA VAZIA: ' + erradas.join(', ') : `${dispensam.length} conferidas`);
// O outro lado é desperdício, não defeito — mas foi exatamente o que esta
// mudança corrigiu, e voltar a ele é silencioso.
const aToa = pedem.filter((t) => !t.le).map((t) => t.f);
check('  e quem pede o catálogo o lê', aToa.length === 0,
  aToa.length ? 'pagando 782 KB sem usar: ' + aToa.join(', ') : `${pedem.length} telas`);

const shared = ler('public/modules/stock/shared.js');
check('o padrão do loadMeta é MANDAR o catálogo', /Stock\.loadMeta = async function loadMeta\(api, showToast, \{ produtos = true \} = \{\}\)/.test(shared));
check('  e as fábricas repassam `semProdutos`',
  (shared.match(/Stock\.loadMeta\(api, showToast, \{ produtos: !config\.semProdutos \}\)/g) || []).length === 2);

const rotaMeta = pedacoDaRota("pathname === '/api/stock/meta' && req.method === 'GET'");
check('a rota lê `produtos=0`', /const querProdutos = url\.searchParams\.get\('produtos'\) !== '0';/.test(rotaMeta));
check('  sem o contexto inteiro (razão, pessoas, select *)', !/loadStockContext\(/.test(rotaMeta) && !/syncCadastroData/.test(rotaMeta));
check('  com o produto em cinco colunas, na ordem de getProducts',
  /querProdutos \? db\.getProductsResumidos\('id, name, sku, cost_price, sale_price'\) : \[\]/.test(rotaMeta));

// ---------------------------------------------------------------------------
console.log('\n--- 1b. PCP e Contratos: o mesmo, nos metas genéricos ---');
const pcp = ler('public/modules/pcp/subs/pcp.js');
const contratos = ler('public/modules/contracts/subs/contratos.js');
// Cada tela é um `R.<chave> = C.make...({ ...base` até a próxima tela.
function telas(fonte) {
  const partes = fonte.split(/\n {2}R\.(?=[a-z_]+ = )/).slice(1);
  return partes.map((p) => ({ chave: p.match(/^([a-z_]+)/)[1], corpo: p }));
}
const pcpTelas = telas(pcp);
const pcpErradas = pcpTelas.filter((t) => /\.\.\.baseSemProdutos/.test(t.corpo) && /meta\.products/.test(t.corpo)).map((t) => t.chave);
const pcpAToa = pcpTelas.filter((t) => /\.\.\.base,/.test(t.corpo) && !/meta\.products|nomeProduto/.test(t.corpo)).map((t) => t.chave);
check('PCP: telas sem produto dispensam o catálogo', pcpTelas.filter((t) => /\.\.\.baseSemProdutos/.test(t.corpo)).length === 6,
  pcpTelas.filter((t) => /\.\.\.baseSemProdutos/.test(t.corpo)).map((t) => t.chave).join(', '));
check('  e nenhuma delas lê meta.products', pcpErradas.length === 0, pcpErradas.join(', ') || 'nenhuma');
check('  e quem mantém o catálogo o lê', pcpAToa.length === 0, pcpAToa.join(', ') || 'nenhuma');
check('  `baseSemProdutos` é o meta com produtos=0', /const baseSemProdutos = \{ \.\.\.base, metaEndpoint: '\/api\/pcp\/meta\?produtos=0' \};/.test(pcp));

const ctTelas = telas(contratos);
const ctErradas = ctTelas.filter((t) => /\.\.\.baseSemDiretorio/.test(t.corpo) && /meta\.directory/.test(t.corpo)).map((t) => t.chave);
const ctAToa = ctTelas.filter((t) => /\.\.\.base,/.test(t.corpo) && !/meta\.directory/.test(t.corpo)).map((t) => t.chave);
check('Contratos: telas sem o campo Cadastro dispensam o diretório', ctErradas.length === 0, ctErradas.join(', ') || 'nenhuma lê');
check('  e só quem lê o diretório o pede', ctAToa.length === 0, ctAToa.join(', ') || 'só novo_contrato');
check('  Vencimentos (que não é fábrica) também dispensa',
  /api\('\/api\/contracts\/meta\?diretorio=0'\)/.test(contratos) && !/api\('\/api\/contracts\/meta'\)/.test(contratos));

const metaGenerico = servidor.slice(servidor.indexOf("if (nomeRecurso === 'meta') {"), servidor.indexOf('const recurso = `${modulo}/${nomeRecurso}`;'));
check('o servidor do PCP lê `produtos=0` e manda id e nome',
  /url\.searchParams\.get\('produtos'\) !== '0'/.test(metaGenerico) && /db\.getProductsResumidos\('id, name'\)/.test(metaGenerico)
  && !/db\.getProducts\(\)/.test(metaGenerico));
// O campo Cadastro do Novo Contrato vira busca pelo NOME (campo_de_busca.js) e
// grava o id. Os outros nove campos do diretório não tinham leitor.
check('o de Contratos lê `diretorio=0` e manda id e nome',
  /url\.searchParams\.get\('diretorio'\) !== '0'/.test(metaGenerico)
  && /getCadastroDirectory\(dados\)\.map\(\(c\) => \(\{ id: c\.id, name: c\.name \}\)\)/.test(metaGenerico));

// ---------------------------------------------------------------------------
console.log('\n--- 2. rotas de UM produto carregam só ele ---');
const contexto = (() => {
  const i = servidor.indexOf('async function loadStockContextDosProdutos(');
  return i < 0 ? '' : servidor.slice(i, servidor.indexOf('\n}\n', i));
})();
check('existe o contexto de poucos produtos', contexto.length > 200);
check('  com o razão só deles', /razaoEstoque\.listarMovimentosDosProdutos\(idsDeProduto\)/.test(contexto)
  && /razaoEstoque\.listarTransferenciasDosProdutos\(idsDeProduto\)/.test(contexto));
// A bandeira: sem ela, um sincronizarRazao chamado depois trocaria o recorte
// pela lista inteira e jogaria fora o que a rota já empilhou.
check('  e a bandeira do razão ligada', /data\.__razaoCarregado = true;/.test(contexto)
  && /data\.__movimentosPendentes = \[\]/.test(contexto));
check('  sem ler pessoas', !/syncCadastroData|getPeople/.test(contexto));

const ROTAS_DO_RECORTE = [
  ["/^\\/api\\/stock\\/products\\/[^/]+$/.test(pathname) && req.method === 'GET'", 'Status do Produto', /loadStockContextDosProdutos\(\[id\], \{ comReservas: true \}\)/],
  ["pathname === '/api/stock/products' && req.method === 'POST'", 'cadastro de produto', /loadStockContextDosProdutos\(\[body\.id\], \{ comSkus: true \}\)/],
  ["pathname === '/api/stock/movements' && req.method === 'POST'", 'movimentação', /loadStockContextDosProdutos\(\[body\.productId\]\)/],
  ["pathname === '/api/stock/transfers' && req.method === 'POST'", 'transferência', /loadStockContextDosProdutos\(idsDosItens\)/],
  ["pathname === '/api/stock/transfers/receive' && req.method === 'POST'", 'conferência da carga', /loadStockContextDosProdutos\(\s*await razaoEstoque\.produtosDaCarga\(body\.batchId\)\)/]
];
for (const [assinatura, nome, uso] of ROTAS_DO_RECORTE) {
  const trecho = pedacoDaRota(assinatura);
  check(`${nome}: só os produtos dela`, uso.test(trecho) && !/loadStockContext\(/.test(trecho), `${trecho.length} chars`);
}
// A quebra por cor de um produto (chamada a cada item com cor na tela de venda).
const rotaClasses = servidor.slice(servidor.indexOf('if (/^\\/api\\/stock\\/products\\/[^/]+\\/classes$/.test(pathname)) {'));
check('a quebra por cor lê o razão do produto, não o de todos',
  /loadStockContextDosProdutos\(\[productId\]\)/.test(rotaClasses.slice(0, 3000))
  && !/sincronizarRazao\(dadosDoSaldo\)/.test(rotaClasses.slice(0, 3000)));

// O SKU repetido é conferido contra o catálogo inteiro, com a MESMA regra.
const cadastro = pedacoDaRota("pathname === '/api/stock/products' && req.method === 'POST'");
check('o cadastro confere o SKU contra o catálogo inteiro',
  /comSkus \? db\.getProductsResumidos\('id, sku'\) : null/.test(contexto)
  && /products\.some\(\(p\) => p\.id !== body\.id && String\(p\.sku \|\| ''\)\.toLowerCase\(\) === sku\.toLowerCase\(\)\)/.test(cadastro));

// As listas de movimentações e transferências: razão inteiro, produto só rótulo.
for (const [assinatura, nome] of [
  ["pathname === '/api/stock/movements' && req.method === 'GET'", 'lista de movimentações'],
  ["pathname === '/api/stock/transfers' && req.method === 'GET'", 'lista de transferências']
]) {
  const trecho = pedacoDaRota(assinatura);
  check(`${nome}: produto só como rótulo`, /loadStockContextDeRotulos\(\)/.test(trecho) && !/loadStockContext\(/.test(trecho));
}
const rotulos = servidor.slice(servidor.indexOf('async function loadStockContextDeRotulos('));
check('  com TODOS os produtos (inclusive os só fiscais), em três colunas',
  /db\.getProductsResumidos\('id, name, sku', \{ incluirEscriturais: true \}\)/.test(rotulos.slice(0, 800)));

// ---------------------------------------------------------------------------
console.log('\n--- 3. a lista resumida sai na ordem de getProducts ---');
const estoqueDb = ler('lib/db/estoque.js');
const resumidos = estoqueDb.slice(estoqueDb.indexOf('async function getProductsResumidos('), estoqueDb.indexOf('async function getProductsPorIds('));
// Sem WHERE e com o mesmo `order by name`: com o filtro do item só fiscal num
// WHERE, os 457 produtos de nome repetido mudavam de ordem (medido). O filtro
// fica em JS, como em getProducts.
check('order by name, sem filtro no SQL',
  /\.order\('name', \{ ascending: true \}\);/.test(resumidos) && !/\.(eq|neq|not|in|is)\(/.test(resumidos));
check('  e o filtro em JS, igual ao de getProducts',
  /return incluirEscriturais \? lista : lista\.filter\(\(p\) => !p\.escritural\);/.test(resumidos));
check('  com a coluna de que o filtro depende', /select\(`\$\{colunas\}, tipo_produto_fiscal`\)/.test(resumidos));

// ---------------------------------------------------------------------------
console.log('\n--- 4. Fiscal › Grupos Tributários conta sem baixar a lista ---');
const grupos = ler('public/modules/fiscal/subs/grupos_tributarios.js');
check('o total sem grupo pede uma linha', /api\('\/api\/stock\/products\?grupoTributario=sem&limit=1'\)/.test(grupos));
check('  e lê só o total', /Number\(res\.total \|\| 0\)/.test(grupos));
const lista = pedacoDaRota("pathname === '/api/stock/products' && req.method === 'GET'");
check('  que a rota calcula ANTES de fatiar a página',
  /products: ordenada\.slice\(inicio, inicio \+ limit\),[\s\S]{0,200}total: ordenada\.length,/.test(lista));

// ---------------------------------------------------------------------------
console.log('\n--- 5. Os comentários apontam para coisas que existem ---');
// Os blocos de comentário deste recorte prometem garantias "em tal teste" e
// "em tal função". Quem vai atrás precisa achar: nome que não existe é uma
// garantia que ninguém confere (a revisão achou dois assim). server.js fica de
// fora da varredura: é de todos os blocos, e um nome velho lá não é deste.
for (const rel of ['public/modules/stock/shared.js', 'lib/db/estoque-razao.js']) {
  const fonte = ler(rel);
  const citados = new Set([...fonte.matchAll(/\b(test-[a-z0-9-]+\.js)\b/g)].map((m) => m[1]));
  for (const citado of citados) {
    check(`${rel} cita ${citado}, que existe`, fs.existsSync(path.join(RAIZ, 'scripts', citado)));
  }
}
for (const nome of new Set(ler('lib/db/estoque-razao.js').match(/\bloadStockContext\w*/g) || [])) {
  check(`estoque-razao.js cita ${nome}, que existe em server.js`,
    new RegExp(`async function ${nome}\\(`).test(servidor));
}

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
