// O QUE FAZ AS TELAS ABRIREM — e o que voltaria a fazê-las demorar.
//
// Seis consertos medidos, cada um com uma armadilha própria:
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
//   4. O CATÁLOGO INTEIRO PARA QUEM NÃO O USA. `/api/purchases` serve as SETE
//      telas de Compras, porque o roteador do módulo a chama antes de saber
//      qual subtela abrir: 2.545 KB de produtos mais 1.476 KB de diretório, e
//      UMA das sete usa os dois. Quem abria o Painel para ver quatro números
//      pagava 4 MB. Com o recorte e a condição: 1.022 KB para aquela tela, e
//      nada para as outras seis.
//
//   5. A LISTA DE PRODUTOS FATIADA NO NAVEGADOR. Mostrava 100 por página depois
//      de baixar 5.475: 3.713 KB crus, 257 KB no fio. A página passou a vir do
//      servidor — 69 KB crus, 6 KB no fio, 54x — e para isso a ORDEM teve de
//      virar um módulo compartilhado, porque agora ela decide quem cai em qual
//      página. Foi ali que apareceu um comparador indiferente: dois valores
//      vazios devolviam 0 antes do desempate, e a ordem passava a depender da
//      ordem de entrada da lista.
//
//   6. O PAINEL TRABALHAVA ANTES DE SABER QUEM PERGUNTA. Duas ondas de banco em
//      fila com `getCurrentUser` no meio, porque a segunda dependia das
//      permissões — e a sessão custa UM milissegundo. Perguntada primeiro, tudo
//      cabe numa onda (250 ms -> 202 ms de banco). E requisição SEM sessão
//      pagava a primeira onda inteira antes de levar 401: 202 ms de banco que
//      qualquer um sem token podia gastar. Agora o 401 custa 15 ms.
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

console.log('\n--- 4. Compras nao manda o catalogo para quem nao o usa (fase DG) ---');
// /api/purchases serve as SETE telas de Compras, porque o roteador do modulo a
// chama antes de saber qual subtela abrir. Medido: 2.545 KB de produtos +
// 1.476 KB de diretorio, e UMA das sete usa os dois. 4.026 KB -> 1.022 KB com o
// recorte (3,9x), e 0 KB para as seis que nao usam.
const indiceCompras = ler('public/modules/purchases/index.js');
check('a rota corta o produto para os quatro campos da tela',
  /products: products\.map\(\(p\) => \(\{\s*\n?\s*id: p\.id, name: p\.name, sku: p\.sku, costPrice: p\.costPrice/.test(servidor));
// O mesmo corte da fase CJ, e pelo mesmo motivo: e um seletor, nao um cadastro.
check('  e o diretorio para id e name',
  /getCadastroDirectory\(data\)\.map\(\(c\) => \(\{ id: c\.id, name: c\.name \}\)\)/.test(servidor));
check('e `formulario=0` e a tela dizendo que nao precisa',
  /const querFormulario = url\.searchParams\.get\('formulario'\) !== '0';/.test(servidor));
// A SUBTELA E RESOLVIDA ANTES DA REQUISICAO. Resolvida depois, a requisicao ja
// teria saido sem saber para quem -- e foi assim que esta rota carregava 4 MB
// para o Painel. Mesma licao da lista de Vendas.
const posEfetiva = indiceCompras.indexOf('const efetiva =');
const posFetch = indiceCompras.indexOf("await api(`/api/purchases");
check('a subtela e resolvida ANTES do pedido', posEfetiva > -1 && posFetch > posEfetiva,
  `resolve ${posEfetiva}, pede ${posFetch}`);

// E O GUARDA QUE IMPORTA: a lista tem de bater com o uso real.
//
// A lista e de quem NAO precisa, e nao de quem precisa -- as duas dao a mesma
// resposta hoje e diferem no dia em que alguem criar a oitava subtela. Com a
// lista de quem precisa, a nova nao estaria nela e o seletor de produto
// apareceria VAZIO; "nenhum produto cadastrado" e do tipo de erro em que a
// pessoa acredita. Com esta, a subtela nova paga o que se pagava antes.
//
// Mas se uma tela JA LISTADA passar a ler data.products, ela renderiza vazia e
// nada quebra para avisar. E isso que este check pega.
const bloco = (indiceCompras.match(/PURCHASES_SEM_CATALOGO = new Set\(\[([\s\S]*?)\]\)/) || ['', ''])[1];
const listadas = [...bloco.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
check('a lista existe e tem telas', listadas.length > 3, listadas.join(', '));
const DIR_SUBS = path.join(RAIZ, 'public/modules/purchases/subs');
const usamCatalogo = fs.readdirSync(DIR_SUBS)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => /data\.products|data\.directory/.test(fs.readFileSync(path.join(DIR_SUBS, f), 'utf8')))
  .map((f) => f.replace(/\.js$/, ''));
const errados = listadas.filter((n) => usamCatalogo.includes(n));
check('  nenhuma tela listada le data.products/directory', errados.length === 0,
  errados.length ? 'RENDERIZARIA VAZIA: ' + errados.join(', ') : `${listadas.length} conferidas`);
// O outro lado nao e defeito, e desperdicio: tela que nao usa e nao esta
// listada paga o catalogo a toa.
const subs = fs.readdirSync(DIR_SUBS).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
const desperdicio = subs.filter((n) => !usamCatalogo.includes(n) && !listadas.includes(n));
check('  e nenhuma paga o catalogo a toa', desperdicio.length === 0,
  desperdicio.length ? 'pagando sem usar: ' + desperdicio.join(', ') : `${subs.length} telas`);

console.log('\n--- 5. Estoque manda a PAGINA, e a ordem tem um dono so (fase DG) ---');
// A lista de Produtos baixava os 5.475 e fatiava no navegador: 3.713 KB crus
// (257 KB no fio) para mostrar 100 linhas. Com a pagina vindo do servidor:
// 69 KB crus, 6 KB no fio -- 54x.
//
// Para o servidor mandar so a pagina ele precisa ORDENAR, e a ordem e' de quem
// desenha a tela, com quatro decisoes que nao se adivinham: vazio sempre no
// fim (nos dois sentidos), urgencia da Situacao, colacao pt-BR com
// numeric:true, e desempate estavel. Escritas nos dois lados, elas
// concordariam ate o dia em que alguem corrigisse um lado so.
const ordemProdutos = require('../public/modules/shared/ordem_de_produtos');
const fonteOrdem = ler('public/modules/shared/ordem_de_produtos.js');
const telaProdutos = ler('public/modules/stock/subs/products.js');

check('o modulo de ordem carrega por require', typeof ordemProdutos.ordenar === 'function');
check('  com as 10 colunas da tela', Object.keys(ordemProdutos.COLUNAS).length === 10,
  Object.keys(ordemProdutos.COLUNAS).join(', '));
check('o servidor usa o modulo, e nao um sort proprio',
  /const ordemDeProdutos = require\('\.\/public\/modules\/shared\/ordem_de_produtos'\);/.test(servidor)
  && /ordemDeProdutos\.ordenar\(/.test(servidor));
// A tela NAO pode ter as definicoes de volta: duas verdades sobre a ordem e um
// produto aparecendo em duas paginas.
check('a tela le as colunas do modulo',
  /const COLUNAS_ORDENAVEIS = ORDEM\.COLUNAS;/.test(telaProdutos));
check('  e nao tem collator proprio', !/new Intl\.Collator/.test(telaProdutos),
  'o unico Intl.Collator mora no modulo compartilhado');
check('  nem tabela de urgencia propria', !/const URGENCIA =/.test(telaProdutos));
check('e o script esta no index.html', /modules\/shared\/ordem_de_produtos\.js/.test(ler('public/index.html')),
  'sem isto window.MavisOrdemDeProdutos e undefined e a tela quebra');

console.log('\n--- e a ordem e TOTAL: sem isso, um produto cai em duas paginas ---');
// O DEFEITO QUE A PROVA PEGOU. O comparador vinha do navegador com
// `if (vazioA && vazioB) return 0;`, que PULA o desempate. `sort` e estavel,
// entao a ordem passava a ser a ordem de ENTRADA da lista.
//
// No navegador nao aparecia: a entrada era sempre a mesma lista do servidor.
// Com a pagina vindo do servidor, apareceu -- ordenando por Categoria, onde os
// 5.475 produtos desta base estao TODOS sem categoria, a pagina 1 do servidor
// nao batia com a pagina 1 da referencia (18 de 20 combinacoes passavam).
//
// O estrago nao e a ordem ser "outra": e ela poder MUDAR entre duas
// requisicoes, e ai um produto aparece em duas paginas e outro em nenhuma.
check('o comparador nao devolve 0 cru quando os dois estao vazios',
  !/if \(vazioA && vazioB\) return 0;/.test(fonteOrdem));
// O EFEITO, e nao a grafia: dois produtos indistinguiveis no campo pedido tem
// de sair sempre na mesma ordem, e ela nao pode depender de como entraram.
const A = { id: 'a', name: 'Zebra', categoryName: '' };
const B = { id: 'b', name: 'Abelha', categoryName: '' };
const numaOrdem = ordemProdutos.ordenar([A, B], 'categoryName', 'asc').map((x) => x.id).join('');
const naOutra = ordemProdutos.ordenar([B, A], 'categoryName', 'asc').map((x) => x.id).join('');
check('  e a ordem nao depende da entrada', numaOrdem === naOutra, `${numaOrdem} e ${naOutra}`);
// O vazio no fim vale nos DOIS sentidos -- e por isso aquelas duas saidas nao
// passam pela inversao da direcao.
const comVazio = [{ id: '1', name: 'A', sku: 'X' }, { id: '2', name: 'B', sku: '' }];
const asc = ordemProdutos.ordenar(comVazio, 'sku', 'asc').map((x) => x.id).join('');
const desc = ordemProdutos.ordenar(comVazio, 'sku', 'desc').map((x) => x.id).join('');
check('  e o vazio fica no fim em asc E em desc', asc === '12' && desc === '12', `asc ${asc}, desc ${desc}`);
// numeric:true -- 'Cabo 9' antes de 'Cabo 10', que e' o que uma comparacao de
// texto pura erraria.
const numerico = ordemProdutos.ordenar(
  [{ id: '1', name: 'Cabo 10' }, { id: '2', name: 'Cabo 9' }], 'name', 'asc'
).map((x) => x.name).join(' | ');
check('  e numero dentro do texto compara como numero', numerico === 'Cabo 9 | Cabo 10', numerico);
// A urgencia da Situacao: zerado antes de normal, que o alfabeto inverteria.
const urg = ordemProdutos.ordenar(
  [{ id: '1', name: 'A', situation: 'normal' }, { id: '2', name: 'B', situation: 'zerado' }], 'situation', 'asc'
).map((x) => x.situation).join(' | ');
check('  e a Situacao ordena por urgencia, nao por alfabeto', urg === 'zerado | normal', urg);

console.log('\n--- e paginar e OPCIONAL: quem classifica em lote recebe tudo ---');
// A tela de Grupos Tributarios pede ?grupoTributario=sem e ?search=... para
// classificar em lote. Paginar por padrao a quebraria em silencio: ela
// classificaria os 100 primeiros e diria que acabou.
check('a pagina so sai quando pedida',
  /const querPagina = url\.searchParams\.has\('page'\) \|\| url\.searchParams\.has\('limit'\);/.test(servidor));
check('  e a tela de produtos pede', /params\.set\('page', String\(pagina\)\);/.test(telaProdutos));
check('  enquanto Grupos Tributarios nao',
  !/grupoTributario=sem[^']*page=/.test(ler('public/modules/fiscal/subs/grupos_tributarios.js')));
// Os quatro cartoes somam a SELECAO. Somando a pagina, "Unidades em estoque"
// mudaria ao virar a pagina e ninguem entenderia por que.
check('os totais dos cartoes vem do servidor',
  /totais = res\.totais \|\| null;/.test(telaProdutos)
  && /const totais = \{\s*\n\s*produtos: list\.length,/.test(servidor));
check('  e a tela nao os soma da pagina',
  !/products\.reduce\(\(sum, p\) => sum \+ Number\(p\.stockQuantity/.test(telaProdutos));

console.log('\n--- 6. o Painel pergunta QUEM antes de trabalhar (fase DH) ---');
// Eram DUAS ondas de banco em fila, com getCurrentUser no meio -- e a segunda
// so podia comecar depois de saber as permissoes. Medido:
//
//     onda 1 (getPeople, 6.492 pessoas) ......... 133 ms
//     getCurrentUser ............................   1 ms
//     onda 2 (getOrdersParaAgregado, 14.864) .... 117 ms
//
// A sessao custa UM milissegundo. Perguntada primeiro, as permissoes ja estao
// na mao e tudo cabe numa onda.
//
// E CONSERTA UMA COISA PIOR QUE LENTIDAO: requisicao sem sessao valida pagava a
// onda 1 inteira e SO ENTAO recebia 401. Qualquer um sem token podia gastar o
// banco do sistema. Medido depois: 401 em 15 ms.
const rotaPainel = servidor.slice(
  servidor.indexOf("if (pathname === '/api/dashboard') {"),
  // O FIM DA ROTA E' o `if` seguinte, e nao o de /charts: entre os dois mora
  // /api/dashboard/atencao, que tem onda propria. Recortando ate /charts, o
  // check de "uma onda so" contava a onda do sino e acusava duas.
  servidor.indexOf("if (pathname === '/api/dashboard/atencao'")
);
check('a rota do Painel foi encontrada', rotaPainel.length > 800, `${rotaPainel.length} caracteres`);
const posUser = rotaPainel.indexOf('await getCurrentUser(req)');
const posOnda = rotaPainel.indexOf('await Promise.all([');
const posLoad = rotaPainel.indexOf('loadData()');
check('pergunta o usuario ANTES de qualquer ida ao banco',
  posUser > -1 && posOnda > posUser, `usuario ${posUser}, onda ${posOnda}`);
check('  e antes de ler o db.json', posLoad > posUser, `loadData ${posLoad}`);
check('  e recusa antes de sincronizar',
  rotaPainel.indexOf("error: 'Não autenticado'") < posOnda,
  'sem token nao gasta banco');
// UMA onda, e nao duas: em fila, a rota paga a soma.
const ondas = (rotaPainel.match(/await Promise\.all\(\[/g) || []).length;
check('e as cargas saem numa onda so', ondas === 1, `${ondas} onda(s)`);
// As condicionadas por permissao CONTINUAM condicionadas: quem nao ve Estoque
// nao deve pagar os 5.475 produtos so porque a onda foi unificada.
// dashboard-e-sino (07/10/2026): os recortes do Inicio (produtos para o valor,
// pedidos em seis colunas, lancamentos nao pagos) -- condicionados do MESMO
// jeito, e o financeiro passou a ser condicionado tambem: sem Financeiro nenhum
// cartao le lancamento, e a rota carregava os 27.362 de qualquer forma.
check('  sem perder as condicoes de permissao',
  /canStock \? painelInicioDb\.getProductsParaValor\(\) : Promise\.resolve\(\[\]\)/.test(rotaPainel)
  && /canSales \? syncSalesDataParaPainel\(data\) : null/.test(rotaPainel)
  && /canPurchases \? syncPurchasesData\(data\) : null/.test(rotaPainel)
  && /canFinance \? syncLancamentosDoPainel\(data\) : null/.test(rotaPainel));
// O razao, as NF-e e o financeiro inteiro saíram: so serializeProduct e
// serializeSalesRecord os liam, e o cartao le quatro campos do produto e dois
// numeros de venda. Nenhum campo da resposta tem saldo por deposito.
check('  e sem o razao, as NF-e e o financeiro inteiro, que a resposta nao le',
  !/sincronizarRazao\(data\)/.test(rotaPainel) && !/syncNfeData\(data\)/.test(rotaPainel) && !/syncFinanceData\(data\)/.test(rotaPainel));

// O GRAFICO TAMBEM PERGUNTA O USUARIO PRIMEIRO (dashboard-e-sino). Carregava os
// 27.362 lancamentos com as baixas ANTES de saber quem pergunta -- quem nao tem
// Financeiro pagava a carga inteira, e requisicao sem sessao tambem -- e o sync
// de vendas ia em fila atras dele.
const rotaGrafico = servidor.slice(
  servidor.indexOf("if (pathname === '/api/dashboard/charts'"),
  servidor.indexOf('\n  if (pathname', servidor.indexOf("if (pathname === '/api/dashboard/charts'") + 10)
);
const gUser = rotaGrafico.indexOf('await getCurrentUser(req)');
const gOnda = rotaGrafico.indexOf('await Promise.all([');
check('o grafico do Inicio pergunta o usuario antes de ir ao banco',
  gUser > -1 && gOnda > gUser && rotaGrafico.indexOf('loadData()') > gUser, `usuario ${gUser}, onda ${gOnda}`);
check('  e carrega numa onda so, condicionada por permissao',
  (rotaGrafico.match(/await Promise\.all\(\[/g) || []).length === 1
  && /canFinance\s*\n?\s*\? syncLancamentosDoGrafico\(data, /.test(rotaGrafico)
  && /canSales \? syncSalesDataParaPainel\(data\) : null/.test(rotaGrafico)
  && !/syncFinanceData\(data\)/.test(rotaGrafico) && !/await syncSalesDataParaAgregado/.test(rotaGrafico));
// O cadastro INTEIRO fica, e isso e' decisao registrada da fase CM: enxuga-lo
// funcionava por acidente, e o guarda de sync apontou na hora.
check('  e o cadastro continua inteiro (decisao da fase CM)',
  /syncCadastroData\(data\)/.test(rotaPainel),
  'trocar por um sync de depositos fazia a rota LER people sem sincronizar');

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
