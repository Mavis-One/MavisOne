// O QUE FAZ AS TELAS ABRIREM — e o que voltaria a fazê-las demorar.
//
// Três consertos medidos, cada um com uma armadilha própria:
//
//   1. OS ESTÁTICOS. `public/index.html` carrega 142 `<script>` mais o CSS e o
//      logo. Servidos com `Cache-Control: no-cache`, eram 144 requisições a
//      CADA abertura — todas devolvendo 304, todas custando uma ida e volta.
//      Em localhost isso some (53 ms); num VPS a 50 ms de ping são ~1,2 s de
//      rede antes de a primeira tela pedir o primeiro dado. Com o carimbo de
//      versão na URL, sobra UMA: o index.html.
//
//   2. O `meta` DA LISTA DE VENDAS. 435 KB de listas de filtro (429 só do
//      diretório de 6.492 pessoas) ao lado de uma página de 15 registros — a
//      cada paginação, ordenação e mudança de filtro.
//
//   3. O `select *` ONDE SÓ SE CONTA OU SÓ SE MOSTRA A PÁGINA. Três lugares:
//      a reserva de estoque lia as ~60 colunas de 14.864 pedidos para usar
//      quatro; os relatórios liam o mesmo para somar; e a lista de Vendas lia
//      27,3 MB para mostrar 15 registros.
//
// SEM BANCO E SEM SERVIDOR: este teste lê fonte e exercita as funções puras.
// O comportamento HTTP foi provado à parte, contra a base real.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');
const versao = require('../lib/versao-dos-estaticos');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = semComentarios(ler('server.js'));
const app = semComentarios(ler('public/app.js'));
const PUBLICO = path.join(RAIZ, 'public');

console.log('--- 1. o carimbo de versão dos estáticos ---');
const html = ler('public/index.html');
const carimbado = versao.carimbarHtml(html, PUBLICO);

const refs = (texto) => [...texto.matchAll(/\b(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
const antes = refs(html);
const depois = refs(carimbado);
check('o index.html tem muitos arquivos', antes.length > 100, `${antes.length} referências`);
const semCarimbo = depois.filter((u) => !/\?v=[A-Za-z0-9_-]{8}$/.test(u));
check('todas saem carimbadas', semCarimbo.length === 0,
  semCarimbo.length ? semCarimbo.slice(0, 3).join(', ') : `${depois.length} carimbadas`);
// Carimbo é do CONTEÚDO: dois arquivos diferentes não podem sair com o mesmo.
const carimbos = new Set(depois.map((u) => u.slice(u.indexOf('?v=') + 3)));
check('  e arquivos diferentes têm carimbos diferentes', carimbos.size > antes.length * 0.9,
  `${carimbos.size} carimbos distintos para ${depois.length} arquivos`);

// A ARMADILHA DO CARIMBO: ele tem de ser inerte para tudo que não é arquivo
// local deste servidor. Carimbar uma URL externa a quebraria; carimbar duas
// vezes produziria `?v=a?v=b`.
const casos = [
  ['<script src="https://cdn.exemplo/x.js"></script>', 'URL externa fica intacta'],
  ['<script src="//cdn.exemplo/x.js"></script>', 'URL sem esquema fica intacta'],
  ['<img src="data:image/png;base64,AAAA" />', 'data: fica intacto'],
  ['<script src="/app.js?v=jaTem"></script>', 'quem já tem query não recebe outro'],
  ['<script src="/nao/existe/mesmo.js"></script>', 'arquivo ausente continua 404, sem carimbo'],
  ['<script src="/../.env"></script>', 'caminho para fora da pasta não é carimbado']
];
for (const [entrada, nome] of casos) {
  check(`  ${nome}`, versao.carimbarHtml(entrada, PUBLICO) === entrada,
    versao.carimbarHtml(entrada, PUBLICO));
}
// E o caso positivo, para os negativos acima não passarem por a função não
// fazer nada.
const um = versao.carimbarHtml('<script src="/app.js"></script>', PUBLICO);
check('  mas o arquivo que existe RECEBE', /src="\/app\.js\?v=[A-Za-z0-9_-]{8}"/.test(um), um);
check("  e com aspas simples também", /src='\/app\.js\?v=/.test(versao.carimbarHtml("<script src='/app.js'></script>", PUBLICO)));

console.log('\n--- e o carimbo acompanha o arquivo ---');
const appJs = path.join(PUBLICO, 'app.js');
const v1 = versao.versaoDe(appJs);
check('versaoDe devolve um carimbo', /^[A-Za-z0-9_-]{8}$/.test(v1), v1);
check('  o mesmo arquivo dá o mesmo carimbo', versao.versaoDe(appJs) === v1);
check('  e depois de esquecer o cache, ainda o mesmo', (versao.esquecer(), versao.versaoDe(appJs)) === v1,
  'o carimbo é do conteúdo, não da hora da leitura');
check('arquivo que não existe devolve vazio', versao.versaoDe(path.join(PUBLICO, 'nao-existe.js')) === '');
// Pasta não é arquivo: sem isto, `href="/"` entraria no carimbo.
check('  pasta também devolve vazio', versao.versaoDe(PUBLICO) === '');

console.log('\n--- o um ano de validade só sai com o carimbo CERTO ---');
check('versaoConfere aceita o carimbo atual', versao.versaoConfere(appJs, v1) === true);
check('  recusa carimbo de outro conteúdo', versao.versaoConfere(appJs, 'zzzzzzzz') === false);
check('  recusa carimbo vazio', versao.versaoConfere(appJs, '') === false);
// Este é o que importa: endereço com hash velho recebe o conteúdo de hoje, mas
// NÃO um ano de validade gravado sobre um endereço que já não corresponde.
check('  e recusa quando o arquivo nem existe', versao.versaoConfere(path.join(PUBLICO, 'x.js'), v1) === false);

console.log('\n--- o servidor usa isso ---');
check('serveStatic aceita uma transformação', /function serveStatic\(res, filePath, req, opcoes = \{\}\)/.test(servidor));
// O ETag tem de ser do que SAI: do contrário um deploy que muda só um módulo
// deixaria o index.html respondendo 304 com os endereços antigos dentro.
const corpoServe = servidor.slice(servidor.indexOf('function serveStatic'), servidor.indexOf('const CACHE_IMUTAVEL') + 4000);
const posTransforma = corpoServe.indexOf('opcoes.transformar(bruto)');
const posEtag = corpoServe.indexOf("createHash('sha1').update(content)");
check('  e transforma ANTES de calcular o ETag',
  posTransforma > -1 && posEtag > posTransforma, `transforma ${posTransforma}, etag ${posEtag}`);
check('o index.html é servido carimbado',
  /transformar: \(html\) => versaoEstatica\.carimbarHtml\(html\.toString\('utf8'\), PUBLIC_DIR\)/.test(servidor));
check('o um ano só sai com o carimbo conferido',
  /versaoEstatica\.versaoConfere\(filePath, pedido\) \? CACHE_IMUTAVEL : 'no-cache'/.test(servidor));
check('  e um ano é um ano, com immutable',
  /const CACHE_IMUTAVEL = 'public, max-age=31536000, immutable'/.test(servidor));

console.log('\n--- 2. as listas do filtro de Vendas não vão em toda página ---');
check('o servidor omite o meta quando pedem meta=0',
  /const querMeta = url\.searchParams\.get\('meta'\) !== '0';/.test(servidor));
// A CHAVE SOME, em vez de vir vazia: a tela tem de distinguir "você já tem" de
// "não há nenhum cliente cadastrado".
check('  e a chave SOME da resposta, em vez de vir vazia',
  /meta: !querMeta \? undefined :/.test(servidor));
check('a tela guarda as listas por um minuto',
  /const SALES_META_VALIDADE_MS = 60000;/.test(app));
// Pedir para omitir sem ter o que reaproveitar desenharia a Busca Avançada com
// os selects vazios.
check('  e só pede meta=0 com o cache NA MÃO',
  /const metaFresca = salesMetaEmCache\s*\n?\s*&& \(Date\.now\(\) - salesMetaBuscadaEm\) < SALES_META_VALIDADE_MS;\s*\n\s*if \(metaFresca\) params\.set\('meta', '0'\);/.test(app));
check('  e guarda o que chegou', /if \(data\.meta\) \{\s*\n\s*salesMetaEmCache = data\.meta;/.test(app));
// Cadastrou um cliente e foi filtrar por ele: não deveria esperar o minuto.
check('mexer no cadastro joga as listas fora',
  /if \(String\(path\)\.startsWith\('\/api\/cadastros\/'\)\) esquecerSalesMeta\(\);/.test(app));
// Num lugar só, como o sino: são sete telas que gravam cadastro.
const esquecimentos = (app.match(/esquecerSalesMeta\(\)/g) || []).length;
check('  num lugar só (a função e a chamada)', esquecimentos === 2, `${esquecimentos} ocorrência(s)`);
// Salvar um PEDIDO não muda a lista de clientes: jogar 435 KB fora a cada
// pedido salvo desfaria o que o cache existe para fazer.
check('  e salvar pedido NÃO joga fora', !/'\/api\/sales\/'\) esquecerSalesMeta/.test(app));

console.log('\n--- 3. ninguém lê 60 colunas para usar quatro ---');
const vendasDb = semComentarios(ler('lib/db/vendas-compras.js'));
check('existe o recorte da reserva', /const COLUNAS_DE_RESERVA = 'id, code, status, items';/.test(vendasDb));
check('  e é ele que a reserva usa',
  /async function getOrdersParaReservas\(\) \{[\s\S]{0,200}select\(COLUNAS_DE_RESERVA\)/.test(vendasDb));
// O ponto em que isso pagava: TODA tela de Estoque passa por loadStockContext.
check('loadStockContext usa o recorte, e não getOrders',
  /db\.getOrdersParaReservas\(\)/.test(servidor));
const usosDeGetOrders = (servidor.match(/calcularReservas\(await db\.getOrders\(\)\)/g) || []).length;
check('  e nenhuma reserva sobrou lendo select *', usosDeGetOrders === 0,
  usosDeGetOrders ? `${usosDeGetOrders} ainda lê(em)` : 'nenhuma');

check('a lista de Vendas tem o carregamento em dois passos',
  /async function getChavesDeOrdenacao\(\)/.test(vendasDb) && /async function getVendasPorIds\(/.test(vendasDb));
// `where id = any(...)` não promete ordem: sem reordenar, a lista sairia
// embaralhada DENTRO da própria página.
check('  e a página é remontada NA ORDEM, não na que o banco devolveu',
  /const porId = new Map\(\[\.\.\.cheios\.orders, \.\.\.cheios\.quotes\]\.map\(\(r\) => \[r\.id, r\]\)\);/.test(servidor)
  && /registros: daPagina\.map\(\(r\) => porId\.get\(r\.id\)\)\.filter\(Boolean\)/.test(servidor));
// A ordem é decidida em JS, pela MESMA função dos dois caminhos. Um `order by`
// no SQL seria uma segunda ordenação, que concordaria até o dia em que não.
check('  sem um "order by" paralelo no SQL das chaves',
  !/getChavesDeOrdenacao[\s\S]{0,400}\.order\(/.test(vendasDb));

console.log('\n--- e o que sobrou de select * está lá porque precisa ---');
// Não é para zerar: a Busca Avançada filtra por campos de TODOS os registros, e
// o Relatório de Vendas explode cada pedido em uma linha por item. Nos dois, as
// colunas são o que a tela relata, não desperdício. O que este check guarda é
// que os carregadores enxutos continuam existindo e nomeados.
for (const nome of ['getOrdersParaAgregado', 'getOrdersResumidos', 'getOrdersParaReservas', 'getChavesDeOrdenacao']) {
  check(`  ${nome} existe`, new RegExp(`async function ${nome}\\(`).test(vendasDb));
}
check('e contarImportLogs conta sem carregar',
  /count: 'exact', head: true[\s\S]{0,80}contarImportLogs/.test(vendasDb)
  || /async function contarImportLogs\(\)[\s\S]{0,200}count: 'exact', head: true/.test(vendasDb));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
