// Busca Avançada de Pedidos e Orçamentos.
//
// Passo 4 do módulo Vendas. O que este teste guarda:
//
//   1. o catálogo de filtros é UM só. O estado inicial, a leitura da URL, a
//      escrita na URL e o formulário liam listas separadas — bastava esquecer
//      uma para o filtro funcionar na tela e sumir no F5;
//   2. cliente e servidor concordam sobre os nomes de "Filtrar Por": um
//      "dateField" que o servidor não conhece cai em silêncio na data de
//      cadastro, e a tela responde outra pergunta sem avisar;
//   3. o atalho de período vai para a URL pelo NOME, não pelas datas de hoje;
//   4. campo sem dado por trás aparece desligado com o motivo, em vez de
//      filtrar sempre por "nada encontrado".
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// Comentário citando um trecho não é o trecho: sem tirar os comentários, este
// arquivo já se deu por satisfeito duas vezes lendo a própria explicação.
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const appSrc = ler('public/app.js');
const appLimpo = semComentarios(appSrc);
const serverSrc = ler('server.js');
const serverLimpo = semComentarios(serverSrc);

console.log('--- o catálogo de filtros é um só ---');
const catalogo = appSrc.slice(appSrc.indexOf('const SALES_FILTROS = ['), appSrc.indexOf('const salesFiltrosVazios'));
const chaves = [...catalogo.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
check('o catálogo existe', chaves.length > 0, `${chaves.length} filtros`);
// Os campos do briefing que têm dado por trás, mais os que a tela já tinha.
['search', 'type', 'status', 'companyId', 'sellerId', 'clientSupplierId',
  'nfeNumero', 'customerPoCode', 'carrierId', 'clientStatus', 'category',
  'saleOrigin', 'clientContact', 'valorDe', 'valorAte',
  'periodo', 'dateField', 'dateFrom', 'dateTo'].forEach((c) => {
  check(`  filtro ${c}`, chaves.includes(c));
});
// Estado inicial, leitura da URL, limpeza e submit: os quatro pelo catálogo.
check('o estado inicial sai do catálogo', /ordersFilters = salesFiltrosVazios\(\)/.test(appLimpo));
check('a URL é lida pelo catálogo', /filtros: SALES_FILTROS\.reduce/.test(appLimpo));
check('"Limpar filtros" usa o catálogo', /Object\.assign\(filters, salesFiltrosVazios\(\)\)/.test(appLimpo));
check('e o submit também', /SALES_FILTROS\.forEach\(\(chave\) => \{[\s\S]{0,200}formData\.has\(chave\)/.test(appLimpo));

console.log('\n--- cliente e servidor concordam sobre o "Filtrar Por" ---');
const doServidor = new Set([...serverSrc.slice(
  serverSrc.indexOf('const CAMPOS_DE_DATA = {'),
  serverSrc.indexOf('function filterSalesRecords')
).matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]));
const doCliente = [...appSrc.slice(
  appSrc.indexOf('const SALES_CAMPOS_DE_DATA = ['),
  appSrc.indexOf('const SALES_PERIODOS')
).matchAll(/chave: '([a-zA-Z]+)'/g)].map((m) => m[1]);
console.log(`    servidor aceita: ${[...doServidor].sort().join(', ')}`);
const semServidor = doCliente.filter((c) => !doServidor.has(c));
// Nome que o servidor não conhece cai no padrão (data de cadastro) SEM ERRO:
// a tela diz "Data de Envio" e devolve os cadastrados no período.
check('nenhuma opção do "Filtrar Por" é desconhecida do servidor', semServidor.length === 0,
  semServidor.length ? 'SEM SUPORTE: ' + semServidor.join(', ') : 'ok');
check('as quatro datas do briefing estão lá', doCliente.length === 4, doCliente.join(', '));
// updatedAt vem com hora; comparar '2026-08-22T13:40:00Z' com '2026-08-22'
// esconderia o registro no próprio dia em que ele foi alterado.
check('as datas são cortadas em AAAA-MM-DD antes de comparar',
  (serverSrc.slice(serverSrc.indexOf('const CAMPOS_DE_DATA = {'), serverSrc.indexOf('function filterSalesRecords'))
    .match(/\.slice\(0, 10\)/g) || []).length === 4);

console.log('\n--- período: a URL guarda o nome, não as datas ---');
check('existe a conversão de período em datas', /function salesPeriodoEmDatas/.test(appLimpo));
const periodos = [...appSrc.slice(appSrc.indexOf('const SALES_PERIODOS = ['), appSrc.indexOf('function salesPeriodoEmDatas'))
  .matchAll(/chave: '([a-zA-Z0-9]+)'/g)].map((m) => m[1]);
['hoje', '7dias', '30dias', 'mes', 'mespassado', 'personalizado'].forEach((p) => {
  check(`  período ${p}`, periodos.includes(p));
});
// toISOString() no Brasil (UTC-3) devolve o dia seguinte depois das 21h, e
// "Hoje" passaria a mostrar amanhã ao anoitecer.
const conv = appSrc.slice(appSrc.indexOf('function salesPeriodoEmDatas'), appSrc.indexOf('function salesPeriodoEmDatas') + 1800);
check('a data é montada em horário local, não com toISOString', /getFullYear\(\)/.test(conv) && !/toISOString/.test(conv));
// "Últimos 7 dias" tem de incluir hoje: 6 para trás + hoje = 7.
check('"últimos 7 dias" inclui hoje', /'7dias'[\s\S]{0,120}diasAtras\(6\)/.test(conv));
check('"mês passado" fecha no último dia do mês', /hoje\.getMonth\(\), 0/.test(conv));
// O servidor não sabe o fuso de quem olha: mandar "hoje" seria pedir para ele
// adivinhar.
check('o servidor recebe datas, não o nome do atalho', /if \(key === 'periodo'\) return;/.test(appLimpo));
check('e a URL guarda o nome do atalho', /salesEscreverUrl\(filters, \{ page, limit, sort, dir \}\)/.test(appLimpo));
// Trocar de atalho não pode carregar as datas do "Personalizado" anterior.
check('atalho limpa as datas digitadas antes', /filters\.periodo !== 'personalizado'\) \{[\s\S]{0,120}filters\.dateFrom = ''/.test(appLimpo));

console.log('\n--- o servidor filtra sobre registros já serializados ---');
const rota = serverSrc.slice(serverSrc.indexOf("if (view === 'orders_quotes')"), serverSrc.indexOf("if (view === 'nfes')"));
const posSerializa = rota.indexOf('combined.map((record) => serializeSalesRecord');
const posFiltra = rota.indexOf('filterSalesRecords(serializados');
const posOrdena = rota.indexOf('ordenarSalesRecords(');
const posFatia = rota.indexOf('.slice(start, start + limit)');
// Número da NF-e, transportadora e data de faturamento só existem depois de
// serializar — filtrar antes é filtrar por campo que ainda não há.
check('serializa antes de filtrar', posSerializa > -1 && posFiltra > posSerializa);
check('filtra antes de ordenar', posOrdena > posFiltra);
check('e fatia por último', posFatia > posOrdena);
check('o filtro recebe os serializados', /function filterSalesRecords\(registros, query\)/.test(serverLimpo));

console.log('\n--- os filtros novos existem no servidor ---');
const filtro = serverSrc.slice(serverSrc.indexOf('function filterSalesRecords'), serverSrc.indexOf('function buildSalesDashboardSummary'));
['carrierId', 'category', 'saleOrigin'].forEach((c) => {
  check(`  ${c} compara por igualdade`, new RegExp(`filtroExato\\('${c}'`).test(filtro));
});
['nfeNumero', 'customerPoCode', 'clientContact', 'clientStatus'].forEach((c) => {
  check(`  ${c} compara por trecho`, new RegExp(`filtroTexto\\('${c}'`).test(filtro));
});
// Uma caixa só para as três notas, como pede o briefing.
check('a busca por número cobre NF-e, NFC-e e NFS-e',
  /nfeNumero[\s\S]{0,200}paymentInfo && r\.paymentInfo\.nfeNumber[\s\S]{0,120}nfseNumber/.test(filtro));
check('a faixa de valor existe', /valorDe[\s\S]{0,400}valorAte/.test(filtro));
// Trocar De por Até em silêncio faria a tela responder outra pergunta.
check('"De" maior que "Até" devolve vazio, não se conserta sozinho',
  !/valorDe > valorAte|\[valorDe, valorAte\] =/.test(filtro));
// Pedido nunca enviado não pertence a "enviados em agosto".
check('registro sem a data escolhida fica de fora', /return d && d >= dateFrom/.test(filtro) && /return d && d <= dateTo/.test(filtro));

console.log('\n--- a lista recebe as opções de transportadora e categoria ---');
check('o meta manda as transportadoras', /carriers: getCarriersDirectory\(data\)/.test(rota));
check('e as categorias', /productCategories: \(data\.productCategories \|\| \[\]\)/.test(rota));

console.log('\n--- campo sem dado por trás não finge que filtra ---');
// Habilitado sobre dado que ninguém consegue preencher devolveria "nenhum
// resultado" para toda busca, e a lista pareceria vazia por outro motivo.
check('Atributo aparece desligado', /Atributo <span class="muted">\(em breve\)<\/span>/.test(appSrc));
check('e com o motivo à vista', /Os atributos do pedido entram no cadastro/.test(appSrc));
['Impresso', 'Impresso Danfe', 'Via API', 'Ordem de Produção'].forEach((t) => {
  check(`  marcador ${t} desligado com motivo`, new RegExp(`\\['${t}', '`).test(appSrc));
});
check('lista vazia se explica em vez de virar select oco', /nenhuma cadastrada/.test(appSrc));

console.log('\n--- uma lista só de origens de venda ---');
// Em duas cópias, filtrar por "Balcão" deixaria de achar as vendas de balcão
// no dia em que uma das listas mudasse.
check('ORIGENS_VENDA é declarada uma vez só',
  (appLimpo.match(/const ORIGENS_VENDA = \[/g) || []).length === 1);
check('e é global, não local do cadastro', /^const ORIGENS_VENDA = \[/m.test(appLimpo));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
