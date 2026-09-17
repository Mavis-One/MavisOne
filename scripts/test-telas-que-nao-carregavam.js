#!/usr/bin/env node
// AS TELAS QUE "NÃO CARREGAVAM DIREITO" — e por que carregavam devagar.
//
// Varredura das 133 telas do catálogo num navegador de verdade, com uma cópia
// dos dados reais (5.475 produtos, 14.864 pedidos, 6.492 pessoas). Nenhuma
// delas dava erro de console ou falha de rede: todas "carregavam". O que
// acontecia era pior de achar, porque não deixa rastro em lugar nenhum.
//
// O QUE A MEDIÇÃO MOSTROU, somando as 133 telas:
//
//   tempo de loadModule ..... 153,1 s  ->  33,0 s
//   nós criados no DOM ...... 233.651  ->  23.315
//   KB baixados ............. 149.613  ->  131.294
//   requisições .............     294  ->     201
//
// E as quatro piores, sozinhas:
//
//   Dashboard Geral ................ 12.625 ms  ->  1.572 ms
//   Relatórios > Estoque ........... 10.131 ms  ->    618 ms
//   Relatórios > por Vendedor .......  8.892 ms ->    640 ms   (9.643 KB -> 529 KB)
//   Relatórios > Vendas ............   7.175 ms ->    657 ms   (9.643 KB -> 529 KB)
//
// AS QUATRO CAUSAS, que este teste guarda uma por uma:
//
//   1. O sino de pendências era perguntado em TODA tela — 134 chamadas numa
//      passada pelo sistema, todas devolvendo o mesmo 1 KB.
//   2. A rota do sino carregava 6.492 pessoas que o painel não lê.
//   3. serializeSalesRecord remontava o diretório de 6.492 cadastros PARA CADA
//      um dos 14.864 pedidos. Era o gargalo de verdade: 6.975 ms dos 7.202 ms
//      do Dashboard.
//   4. Quatro telas despejavam listas inteiras no DOM: 168.170 nós no Relatório
//      por Vendedor, 32.895 na Nova Tabela de Preços, e <select> de 6.493 e
//      5.241 <option> no Novo Lançamento e nos Relatórios.
//
// Roda sem servidor e sem banco: o que ele confere é que as quatro correções
// continuam no código, e as funções puras são exercitadas de verdade.
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK ' : 'XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = semComentarios(ler('server.js'));
const app = semComentarios(ler('public/app.js'));
const appCru = ler('public/app.js');

// ===========================================================================
console.log('\n--- 1. o sino não é perguntado a cada tela ---');
// ===========================================================================
// Ele responde "o que está pendente na base inteira", e essa resposta não muda
// porque alguém abriu outra tela. Mas ele vive no renderApp, então mudava.
check('há uma porta única para a rota do sino',
  /async function buscarAtencao\(\{ forcar = false \} = \{\}\) \{/.test(app));
check('  e ela reaproveita a resposta recente',
  /const fresco = ultimoPainelAtencao && \(Date\.now\(\) - atencaoBuscadaEm\) < ATENCAO_VALIDADE_MS;/.test(app)
  && /if \(!forcar && fresco\) return ultimoPainelAtencao;/.test(app));
// O Dashboard chamava TRÊS vezes na mesma navegação, porque renderApp roda mais
// de uma vez numa navegação. As três saíam e se atropelavam.
check('  e uma chamada em voo atende quem pedir no meio dela',
  /if \(atencaoEmVoo\) return atencaoEmVoo;/.test(app)
  && /\.finally\(\(\) => \{ atencaoEmVoo = null; \}\)/.test(app));
// Sem isto, um erro de rede silenciaria o sino por um minuto.
check('  a marca de tempo só é gravada no sucesso',
  /atencaoBuscadaEm = Date\.now\(\);[\s\S]{0,120}return painel;/.test(app));
// Só quem desenha o sino e quem abre o painel falam com a rota — e os dois pela
// porta única.
check('ninguém mais chama a rota direto',
  (app.match(/api\('\/api\/dashboard\/atencao'\)/g) || []).length === 1);
check('  o sino da barra lê pela porta', /const painel = await buscarAtencao\(\);/.test(app));
// Abrir o painel é a pessoa OLHANDO a lista: pendência resolvida há um minuto
// não pode continuar listada.
check('  e abrir o painel força uma busca nova',
  /const painel = await buscarAtencao\(\{ forcar: true \}\);/.test(app));

console.log('\n--- 1b. mas escrever envelhece o sino na hora ---');
// Faturar um pedido e ver o sino contando o pedido antigo por um minuto seria
// pior do que a lentidão: é justamente nesse instante que a pessoa olha.
check('qualquer método que não seja GET invalida o cache',
  /if \(options\.method && options\.method\.toUpperCase\(\) !== 'GET'\) \{[\s\S]{0,60}atencaoBuscadaEm = 0;/.test(app));
// Mora no `api`, que é o único caminho até o servidor — em cada tela que grava
// seria um lugar a mais para alguém esquecer.
const corpoApi = app.slice(app.indexOf('async function api(path, options = {})'));
check('  e isso mora dentro do api(), não em cada tela',
  corpoApi.indexOf('atencaoBuscadaEm = 0;') > 0
  && corpoApi.indexOf('atencaoBuscadaEm = 0;') < corpoApi.indexOf('function ', 10));

// ===========================================================================
console.log('\n--- 2. a rota do sino não carrega o que não usa ---');
// ===========================================================================
const rota = servidor.slice(
  servidor.indexOf("if (pathname === '/api/dashboard/atencao'"),
  servidor.indexOf("if (pathname === '/api/dashboard/charts'")
);
check('achei a rota do painel de pendências', rota.length > 400, `${rota.length} caracteres`);
// montarAtencao recebe lançamentos, notas, pedidos e produtos — e mais nada.
// syncCadastroData traz as 6.492 pessoas, os CNPJs e os depósitos.
check('ela NÃO chama syncCadastroData', !/syncCadastroData/.test(rota));
// Os syncs correm juntos: o tempo da rota era o do mais lento, que era o inútil.
// O que importa é os dois estarem DENTRO do mesmo Promise.all — em fila, o
// tempo da rota voltaria a ser a soma. Recorta o bloco e olha dentro dele, em
// vez de contar caracteres entre as chamadas: na fase CM entrou um comentário
// no meio e a distância mudou, o que não muda nada sobre o paralelismo.
//
// Aceita `syncSalesDataParaAgregado` porque é o que esta rota passou a usar na
// fase CM: o painel soma e conta, e as ~60 colunas de cada pedido custavam
// 323 ms contra 49 ms do recorte.
const blocoParalelo = (/await Promise\.all\(\[[\s\S]*?\]\);/.exec(rota) || [''])[0];
check('  e os que sobraram continuam correndo juntos',
  /syncSalesData(ParaAgregado)?\(data\)/.test(blocoParalelo) && /sincronizarRazao\(data\)/.test(blocoParalelo),
  blocoParalelo ? `${blocoParalelo.length} caracteres no bloco` : 'bloco não encontrado');
// estoqueAbaixoDoMinimo lê exatamente um campo: `situation`.
check('o produto entra só com a situação',
  /\{ situation: stockCore\.productSituation\(data, p\) \}/.test(rota));
check('  e não serializado inteiro', !/serializeProduct/.test(rota));
// productBalances monta a quebra por depósito e por isso lê `data.deposits` —
// ler coleção que a rota não sincroniza é o defeito que o test-sync-obrigatorio
// vigia, e ele pegou esta linha na primeira versão desta correção.
const stockCore = semComentarios(ler('lib/stock-core.js'));
check('productSituation não passa por productBalances',
  /function productSituation\(data, product\) \{[\s\S]{0,200}productStockSituation\(productMeta\(data, product\.id\), toNumber\(product\.stockQuantity\)\)/.test(stockCore));
check('  e é exportada', /\n  productSituation,/.test(stockCore));

// O número que ela devolve tem de ser o MESMO que productBalances chamava
// `total` — senão o sino passa a contar outra coisa.
const core = require('../lib/stock-core');
const produtoDeTeste = { id: 'p1', stockQuantity: 0, costPrice: 1, salePrice: 2 };
const dadosDeTeste = { productMeta: { p1: { minStock: 0 } }, deposits: [], stockMovements: [] };
check('o total usado é o mesmo de productBalances',
  core.productBalances(dadosDeTeste, produtoDeTeste).total === 0
  && core.productSituation(dadosDeTeste, produtoDeTeste) === 'zerado');
const comSaldo = { ...produtoDeTeste, stockQuantity: 3 };
check('  e o mínimo continua contando',
  core.productSituation({ ...dadosDeTeste, productMeta: { p1: { minStock: 5 } } }, comSaldo) === 'abaixo-minimo'
  && core.productSituation({ ...dadosDeTeste, productMeta: { p1: { minStock: 1 } } }, comSaldo) === 'normal');

// ===========================================================================
console.log('\n--- 3. o diretório de cadastros é montado UMA vez ---');
// ===========================================================================
// Este era o gargalo de verdade. serializeSalesRecord roda uma vez por pedido e
// chamava `getCadastroDirectory(data).find(...)`: 14.864 × 6.492 objetos
// criados e varridos. Medido dentro de buildSalesDashboardSummary:
//
//   filtrar visíveis (14.864) ...... 25 ms
//   serializeSalesRecord ........ 6.975 ms
//   bySeller ....................... 16 ms
check('há um índice do cadastro', /const CACHE_DIRETORIO = new WeakMap\(\);/.test(servidor)
  && /function indiceDoCadastro\(data\)/.test(servidor));
// A CHAVE É A IDENTIDADE DOS ARRAYS, e não o objeto `data`: syncCadastroData
// ATRIBUI arrays novos, então uma segunda sincronização na mesma requisição
// troca a referência. Guardar só por `data` devolveria o diretório velho — e
// nome errado num pedido é erro que ninguém vê.
check('  a chave é a identidade dos arrays, não o objeto data',
  /if \(guardado && guardado\.people === data\.people && guardado\.cnpjs === data\.cnpjs\) return guardado;/.test(servidor));
check('  com índice por id', /porId: new Map\(lista\.map\(\(e\) => \[e\.id, e\]\)\)/.test(servidor));
// getSellersDirectory refiltrava as 6.492 pessoas, e também era chamado por pedido.
check('  e os vendedores saem da mesma passada',
  /vendedores: \(data\.people \|\| \[\]\)[\s\S]{0,200}includes\('Vendedor'\)/.test(servidor)
  && /function getSellersDirectory\(data\) \{[\s\S]{0,200}return indiceDoCadastro\(data\)\.vendedores;/.test(servidor));
check('serializeSalesRecord usa o índice',
  /const found = acharNoCadastro\(data, record\.clientSupplierId\);/.test(servidor));
// Um `.find()` sobre 6.492 dentro de um laço de 14.864 é o mesmo problema por
// outro caminho — nenhuma função chamada por registro pode fazer isso.
['serializeSalesRecord', 'resolveFinanceCounterparty', 'resolveFinanceCounterpartyDocument'].forEach((fn) => {
  const inicio = servidor.indexOf(`function ${fn}(`);
  const corpo = servidor.slice(inicio, inicio + 2500);
  check(`  ${fn} não varre o diretório`, inicio > 0 && !/getCadastroDirectory\(data\)\.find/.test(corpo));
});
// Não é o gargalo hoje (29 vendedores, 16 ms), mas a conta cresce com o
// cadastro e a troca é de graça.
check('o dashboard agrupa os pedidos por vendedor uma vez',
  /const pedidosPorVendedor = new Map\(\);/.test(servidor)
  && /const sellerOrders = pedidosPorVendedor\.get\(seller\.id\) \|\| \[\];/.test(servidor));

// ===========================================================================
console.log('\n--- 4. Relatório por Vendedor: 168.170 nós no DOM ---');
// ===========================================================================
const relLib = require('../lib/relatorios-vendas');
const relLibSrc = semComentarios(ler('lib/relatorios-vendas.js'));
check('o agrupamento recorta as linhas de detalhe',
  /const LINHAS_POR_VENDEDOR = \d+;/.test(relLibSrc)
  && /linhas: grupo\.linhas\.slice\(0, Math\.max\(0, linhasPorVendedor\)\)/.test(relLibSrc));
check('  e diz quantas existem de verdade', /linhasNoTotal: grupo\.linhas\.length/.test(relLibSrc));

// OS INDICADORES SAEM DE TODAS AS LINHAS. Contar o faturamento de uma amostra
// seria mentir no número — é o recorte do DETALHE, não da conta.
const linhasFalsas = Array.from({ length: 25 }, (_, i) => ({
  vendedorId: 'v1', vendedorNome: 'Ana', pedidoId: `p${i}`, pedidoCodigo: i + 1,
  clienteId: `c${i % 4}`, clienteNome: `Cliente ${i % 4}`, produtoId: 'x', produtoNome: 'X',
  quantidade: 2, valorTotal: 10, data: '2026-09-01', status: 'pedido-faturado'
}));
const grupos = relLib.agruparPorVendedor(linhasFalsas, { linhasPorVendedor: 10 });
check('o faturamento conta as 25, e não as 10 mostradas',
  grupos[0].indicadores.faturamento === 250, `R$ ${grupos[0].indicadores.faturamento}`);
check('  os pedidos também', grupos[0].indicadores.pedidos === 25, String(grupos[0].indicadores.pedidos));
check('  e os clientes também', grupos[0].indicadores.clientes === 4, String(grupos[0].indicadores.clientes));
check('a tabela recebe só a amostra', grupos[0].linhas.length === 10, String(grupos[0].linhas.length));
check('  com o total ao lado', grupos[0].linhasNoTotal === 25, String(grupos[0].linhasNoTotal));
// Lista curta não é recortada, e aí a tela não mostra aviso nenhum.
const curto = relLib.agruparPorVendedor(linhasFalsas.slice(0, 3), { linhasPorVendedor: 10 });
check('lista curta sai inteira', curto[0].linhas.length === 3 && curto[0].linhasNoTotal === 3);

const tela = semComentarios(ler('public/modules/reports/subs/relatorios.js'));
// Tabela cortada em silêncio é pior do que tabela grande: quem soma as linhas
// na mão acha que o relatório está errado.
check('a tela DIZ que recortou',
  /const escondidas = Math\.max\(0, noTotal - grupo\.linhas\.length\);/.test(tela)
  && /Mostrando \$\{grupo\.linhas\.length\} de \$\{noTotal\.toLocaleString\('pt-BR'\)\} itens/.test(tela));
// `details open` em todos os vendedores era o que montava as 17.890 linhas de
// uma vez. Com um só vendedor (ele vendo o próprio relatório) abrir é o certo.
check('  e os blocos vêm fechados quando há mais de um vendedor',
  /const aberto = grupos\.length === 1 \? ' open' : '';/.test(tela));
// O botão filtrava por vendedor vazio, ou seja, não filtrava nada — e "Sem
// vendedor" é o grupo MAIOR desta base (12.236 itens dos pedidos importados).
check('o atalho de filtro só aparece quando há vendedor para filtrar',
  /\$\{grupo\.vendedorId[\s\S]{0,300}data-rel-vendedor="\$\{escapeHtml\(grupo\.vendedorId\)\}"[\s\S]{0,400}: 'de vendas sem vendedor atribuído/.test(tela));

// ===========================================================================
console.log('\n--- 5. os <select> que viraram campo de busca ---');
// ===========================================================================
// A regra de QUANDO trocar é uma só no sistema (shared/campo_de_busca.js), e
// quem desenha e quem liga o ouvinte têm de ler a MESMA lista — senão o campo
// aparece como busca e ninguém liga o evento dele, ou o contrário.
check('o limite dos filtros vem da fonte única',
  /const REL_LIMITE_LISTA = \(window\.MavisCampoDeBusca && window\.MavisCampoDeBusca\.LIMITE\) \|\| 200;/.test(tela));
check('  e há uma lista só para os três filtros de lista',
  /function relFiltrosDeLista\(rel\)/.test(tela)
  && /deBusca: \(d\.lista \|\| \[\]\)\.length > REL_LIMITE_LISTA/.test(tela));
['vendedorId', 'clienteId', 'produtoId'].forEach((campo) => {
  check(`  ${campo} desenhado pela lista`, new RegExp(`\\$\\{campoPor\\('${campo}'\\)\\}`).test(tela));
  check(`    e sem <select> escrito à mão`, !new RegExp(`<select data-rel-filtro="${campo}"`).test(tela));
});
// O valor mora num <input type="hidden">, e escrever nele por código NÃO
// dispara 'change': sem onSelect o filtro seria escolhido na tela e ignorado
// na consulta.
check('o campo de busca avisa a escolha pelo onSelect',
  /attachSearchableSelect\(\{[\s\S]{0,200}onSelect: \(valor\) => \{[\s\S]{0,80}f\[d\.campo\] = valor \|\| '';/.test(tela));
// E apagar o texto tem de apagar o filtro: o campo zera o hidden ao digitar,
// mas não chama onSelect — só escolher chama.
check('  e apagar o texto apaga o filtro',
  /if \(escondido && !escondido\.value && f\[d\.campo\]\) \{[\s\S]{0,80}f\[d\.campo\] = '';/.test(tela));

const lancamento = semComentarios(ler('public/modules/finance/subs/novo_lancamento.js'));
// Era um par "digite aqui / escolha ali" que reconstruía 6.493 <option> A CADA
// TECLA, e escolher exigia um segundo gesto num campo que não dizia estar
// ligado ao de cima.
check('Novo Lançamento: o cliente é um campo de busca',
  /renderSearchableSelect\(\{[\s\S]{0,200}name: 'clientSupplierId',[\s\S]{0,200}options: opcoesDoDiretorio\(\)/.test(lancamento));
check('  sem <select> do diretório', !/<select name="clientSupplierId"/.test(lancamento));
check('  e sem o par de campos antigo',
  !/financePartySearch/.test(lancamento) && !/financePartySelect/.test(lancamento));
// 6.492 pessoas têm nomes repetidos: o código no rótulo é o que distingue, e é
// como o cadastro é chamado no dia a dia ("o 6443").
check('  o rótulo leva o código do cadastro',
  /label: c\.code \? `\$\{c\.name\} \(\$\{c\.code\}\)` : c\.name/.test(lancamento));

// ===========================================================================
console.log('\n--- 6. Nova Tabela de Preços: 32.895 nós e 5.484 campos ---');
// ===========================================================================
const tabelaDePrecos = semComentarios(ler('public/modules/stock/subs/new_price_table.js'));
check('a lista de produtos é paginada', /const POR_PAGINA = 100;/.test(tabelaDePrecos)
  && /filtrados\.slice\(primeiroDaPagina, primeiroDaPagina \+ POR_PAGINA\)/.test(tabelaDePrecos));
// O tipo Markup não usa a lista. Ela era montada e escondida — custa o mesmo ao
// navegador e não serve a ninguém.
check('  e o tipo Markup não monta lista nenhuma',
  /const daLista = type === 'fixo';/.test(tabelaDePrecos)
  && /\$\{daLista \? itemRows\(visiveis\) : ''\}/.test(tabelaDePrecos));
// Perder o preço digitado ao virar a página seria pior do que não paginar.
check('virar a página guarda o que foi digitado',
  /captureItemInputs\(\);[\s\S]{0,120}pagina = Number\(botao\.dataset\.pagina\)/.test(tabelaDePrecos));
check('  e a tela lembra quantos preços já há', /produto\$\{itemPrices\.size === 1 \? '' : 's'\} com preço informado/.test(tabelaDePrecos));
// Buscar na página 30 e continuar na 30 mostraria "Nenhum produto encontrado".
check('buscar volta para a primeira página',
  /itemSearch = event\.target\.value;[\s\S]{0,200}pagina = 1;/.test(tabelaDePrecos));
// Sem isto a pessoa perde o cursor a cada letra digitada.
check('  e o foco volta para o campo de busca',
  /input\?\.setSelectionRange\(input\.value\.length, input\.value\.length\)/.test(tabelaDePrecos));

// ===========================================================================
console.log('\n--- 7. Fornecedores: cabeçalho de tabela e nada mais ---');
// ===========================================================================
// A tela inteira tinha 37 letras e 9 nós: o título e os três cabeçalhos. Tabela
// com cabeçalho e nenhuma linha, sem uma palavra, é indistinguível de uma tela
// que falhou ao carregar.
const fornecedores = semComentarios(ler('public/modules/purchases/subs/suppliers.js'));
check('a tela vazia explica que está vazia',
  /suppliers\.length[\s\S]{0,200}: vazia/.test(fornecedores)
  && /Nenhuma compra registrada ainda/.test(fornecedores));
// E o nome dela prometia o cadastro de fornecedores, que mora em outro lugar.
check('  e diz onde fica o cadastro de fornecedores',
  /Cadastros &rsaquo; Pessoas/.test(fornecedores));
check('  a descrição no menu não promete mais o cadastro',
  /De quem já se comprou, com o total acumulado de cada um\./.test(app)
  && !/Fornecedores cadastrados e seus dados/.test(semComentarios(appCru)));

// ===========================================================================
console.log('\n--- 8. o campo travado que era um <select> ---');
// ===========================================================================
// <select> não aceita readonly, e por isso o cliente de um lançamento vinculado
// era `disabled`. Virando campo de busca, a travação passou a ser `readonly` —
// e vem NO HTML, não de um `input.readOnly = true` depois do render: se
// dependesse de mais código rodar, uma falha no meio devolveria campo editável.
check('renderSearchableSelect aceita readonly',
  /function renderSearchableSelect\(\{ id, name, options, selectedValue, placeholder, required, readonly \}\)/.test(app)
  && /\$\{readonly \? 'readonly tabindex="-1"' : ''\}/.test(app));
// Abrir a lista inteira para não poder escolher nada é só frustração.
check('  e esconde a lupa quando está travado',
  /\$\{readonly \? '' : `<button type="button" class="searchable-select-lupa"/.test(app));
// Travar o campo não pode apagar de quem é o lançamento.
check('  o valor travado continua indo no envio',
  /<input type="hidden" name="\$\{name\}" id="\$\{id\}Value"/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
