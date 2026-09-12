#!/usr/bin/env node
/**
 * A LISTA DE PRODUTOS: PÁGINAS DE 100 E CABEÇALHO QUE ORDENA (fase CG).
 *
 * A tela desenhava TODAS as linhas de uma vez, e ordenava só pelo nome, no
 * servidor. Com os 5.476 produtos da importação do ViperERP, medido num Chrome
 * de verdade:
 *
 *     antes:   120.534 nós no DOM   ·   3.335 ms só para desenhar
 *     depois:    2.314 nós no DOM   ·   100 linhas por página, 55 páginas
 *
 * É a mesma mudança já feita em Cadastros > Pessoas (fase CF), e por isso os
 * estilos deixaram de se chamar `.cadastro-paginas` / `.cadastro-ordenar` e
 * passaram a `.lista-paginas` / `.lista-ordenar`: virar página é o MESMO
 * controle nas duas telas, e duas folhas de estilo para o mesmo botão são duas
 * chances de ele ficar diferente de um lado para o outro sem ninguém decidir.
 *
 * O QUE ESTA TELA TEM QUE A DE CADASTROS NÃO TEM
 * ----------------------------------------------
 * Custo, Venda, Margem e Saldo JÁ CHEGAM como número do servidor. Cadastros
 * arranca os dígitos do texto para comparar ('código' é text no banco), e
 * repetir isso aqui destruiria o negativo e a casa decimal: uma margem de
 * -100,0% viraria 1000, e R$ 1.234,56 viraria 123456. Medido no navegador:
 *
 *     Custo decrescente ....... R$ 245.712,39 · R$ 219.990,00 · R$ 84.253,27
 *     Margem crescente ........ -100,0% no topo (o negativo é o menor de todos)
 *
 * E a Situação ordena por URGÊNCIA, não por alfabeto. Alfabético daria
 * 'abaixo-minimo', 'acima-maximo', 'normal', 'zerado' — o que não responde a
 * pergunta que leva alguém a clicar nessa coluna, que é "o que precisa de mim
 * primeiro?".
 *
 * A UNIDADE QUE A IMPORTAÇÃO DESMASCAROU
 * --------------------------------------
 * serializeProduct lia a unidade SÓ do db.json. Quem passa pela tela de
 * cadastro grava nos dois lugares (coluna e meta), então os dois concordavam e
 * ninguém via problema. Quem NÃO passa pela tela são os produtos importados
 * direto no banco: têm a coluna preenchida e meta nenhuma.
 *
 *     no banco, depois da importação:  34 unidades distintas
 *     na tela, antes desta correção:   {"UN": 5476}
 *
 * 1.795 produtos exibindo a unidade errada, sem erro nenhum no console.
 *
 * MEDIDO no navegador, com os 5.476:
 *     abre em ................. Mostrando 1–100 de 5.476 · Página 1 de 55
 *     coluna ativa ............ "Produto ▲" (o que o servidor já fazia)
 *     entre páginas ........... "ABRACADEIRA PVC CINZA 1" -> "ABRACADEIRA PVC CINZA 1/2"
 *     última página ........... 55, com 76 linhas (54 × 100 + 76 = 5.476)
 *     SKU crescente ........... 1 2 3 4 5 8 9 010 10 11 12 13
 *     filtrar na página 55 .... volta para "Página 1 de 3", mantendo "Produto ▲"
 *     erros de console ........ 0
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const tela = ler('public/modules/stock/subs/products.js');
const codigo = semComentarios(tela);

// ---------------------------------------------------------------------------
console.log('--- 1. a unidade do produto importado (roda de verdade) ---');
// Este bloco EXECUTA serializeProduct, não procura texto: é o único jeito de
// provar que a unidade certa sai do outro lado.
const stockCore = require('../lib/stock-core');
const vazio = { deposits: [], stockMovements: [], productCategories: [], productMeta: {} };

const importado = stockCore.serializeProduct(
  { id: 'p1', name: 'PARAFUSO', sku: '583', stockQuantity: 0, costPrice: 11.1, salePrice: 0, unidadeComercial: 'CT' },
  vazio
);
check('produto importado (só coluna, meta nenhuma) mostra a unidade da coluna',
  importado.unit === 'CT', importado.unit);

const comMeta = stockCore.serializeProduct(
  { id: 'p2', name: 'CABO', sku: '9', stockQuantity: 0, costPrice: 1, salePrice: 2, unidadeComercial: 'CT' },
  { ...vazio, productMeta: { p2: { unit: 'PC' } } }
);
// Meta ganha da coluna: é o que a tela de cadastro edita, e quem editou pela
// tela acabou de dizer o que quer.
check('  e com meta gravada, a meta é quem manda', comMeta.unit === 'PC', comMeta.unit);

const semNenhum = stockCore.serializeProduct(
  { id: 'p3', name: 'SEM UNIDADE', sku: '0', stockQuantity: 0, costPrice: 0, salePrice: 0 },
  vazio
);
check('  e sem nenhum dos dois, sobra UN', semNenhum.unit === 'UN', semNenhum.unit);
// A unidade tributável tinha o mesmo furo, com um degrau a mais.
check('a unidade tributável também cai na coluna',
  stockCore.serializeProduct(
    { id: 'p4', name: 'X', sku: '1', stockQuantity: 0, costPrice: 0, salePrice: 0, unidadeComercial: 'KG' },
    vazio
  ).unidadeTributavel === 'KG');

// ---------------------------------------------------------------------------
console.log('--- 2. a ordem é da lista inteira, não da página ---');
const posOrdenar = codigo.indexOf('const todos = ordenar(await fetchProducts());');
const posCorte = codigo.indexOf('const visiveis = todos.slice(');
check('ordena a lista que veio do servidor', posOrdenar > 0);
// ESTE é o check que importa. Se o corte viesse antes, cada página se ordenaria
// sozinha: a página 2 começaria de novo no "A" e quem clicasse em "Custo"
// procurando o mais caro acharia o mais caro DAQUELE PEDAÇO.
check('  e corta em páginas DEPOIS', posCorte > posOrdenar,
  `ordena na linha ${codigo.slice(0, posOrdenar).split('\n').length}, corta na ${codigo.slice(0, posCorte).split('\n').length}`);
check('são 100 por página', /const POR_PAGINA = 100;/.test(codigo));
check('  e a página fica presa entre 1 e o total',
  /const paginaAtual = Math\.min\(Math\.max\(1, pagina\), totalPaginas\);/.test(codigo));

// ---------------------------------------------------------------------------
console.log('--- 3. cada coluna é comparada pelo que ela é ---');
check('há um catálogo de colunas', /const COLUNAS_ORDENAVEIS = \{/.test(codigo));
for (const [campo, tipo] of [['name', 'texto'], ['sku', 'texto'], ['categoryName', 'texto'],
                             ['unit', 'texto'], ['costPrice', 'numero'], ['salePrice', 'numero'],
                             ['margin', 'numero'], ['stockQuantity', 'numero'],
                             ['situation', 'alerta'], ['status', 'texto']]) {
  check(`  ${campo.padEnd(14)} como ${tipo}`,
    new RegExp(`${campo}: \\{ rotulo: '[^']+', tipo: '${tipo}' \\}`).test(codigo));
}
// O que NÃO pode aparecer: o replace(/\D/g,'') que Cadastros usa. Aqui ele
// destruiria o sinal e a vírgula — -100,0% de margem viraria 1000.
check('número NÃO arranca os dígitos (destruiria negativo e decimal)',
  /resultado = Number\(va\) - Number\(vb\);/.test(codigo) && !/replace\(\/\\D\/g, ''\)/.test(codigo));
// "Álvaro" tem de ficar junto de "Alvaro"; e numeric:true é o que põe o SKU
// 100 depois do 99 sem eu ter de adivinhar se o SKU é número ou texto.
check('texto compara em pt-BR, sem acento nem caixa, e ciente de número',
  /new Intl\.Collator\('pt-BR', \{ sensitivity: 'base', numeric: true \}\)/.test(codigo));
check('a Situação ordena por urgência, não por alfabeto',
  /const URGENCIA = \{ zerado: 0, 'abaixo-minimo': 1, 'acima-maximo': 2, normal: 3 \};/.test(codigo));

// ---------------------------------------------------------------------------
console.log('--- 4. vazio e empate ---');
// Inverter o vazio junto com a direção encheria o topo de traços ao pedir
// "maior primeiro". Pesa aqui: a importação entrou sem categoria nenhuma.
check('vazio vai para o fim nos DOIS sentidos',
  /if \(vazioA && vazioB\) return 0;\s*\n\s*if \(vazioA\) return 1;\s*\n\s*if \(vazioB\) return -1;/.test(codigo));
// Sem desempate, dois produtos de mesmo custo trocariam de lugar entre um
// render e outro, e a lista pareceria se mexer sozinha.
check('empate é resolvido pelo nome, e depois pelo id',
  /if \(resultado === 0\) resultado = comparadorDePtBr\.compare\(String\(a\.name \|\| ''\), String\(b\.name \|\| ''\)\);/.test(codigo)
  && /if \(resultado === 0\) resultado = String\(a\.id\)\.localeCompare\(String\(b\.id\)\);/.test(codigo));
check('a direção inverte o resultado, e não a comparação',
  /return ordem\.direcao === 'asc' \? resultado : -resultado;/.test(codigo));

// ---------------------------------------------------------------------------
console.log('--- 5. o cabeçalho ---');
check('cada coluna é um button', /<button type="button" class="lista-ordenar/.test(tela));
check('  com aria-sort para o leitor de tela',
  /aria-sort="\$\{ativa \? \(ordem\.direcao === 'asc' \? 'ascending' : 'descending'\) : 'none'\}"/.test(tela));
check('  e a seta indicando a direção', /ordem\.direcao === 'asc' \? '▲' : '▼'/.test(tela));
check('o title diz o que o PRÓXIMO clique fará',
  /Ordenar por \$\{S\.escape\(def\.rotulo\)\} em ordem \$\{proxima\}/.test(tela));
check('Ações não ordena', /\}\)\.join\(''\)\}\s*\n\s*<th>Ações<\/th>/.test(tela));

// ---------------------------------------------------------------------------
console.log('--- 6. a barra de páginas ---');
check('existe uma barra', /const barraDePaginas = \(posicao\) =>/.test(codigo));
// Duas barras: com 100 linhas, ter só a de baixo obrigaria a rolar a tela
// inteira para virar a página.
check('  desenhada ACIMA e ABAIXO da tabela',
  /\$\{barraDePaginas\('acima'\)\}/.test(tela) && /\$\{barraDePaginas\('abaixo'\)\}/.test(tela));
check('diz quantos está mostrando de quantos',
  /Mostrando <strong>\$\{primeiroDaPagina \+ 1\}/.test(tela));
check('  e em qual página de quantas', /Página \$\{paginaAtual\} de \$\{totalPaginas\}/.test(tela));
for (const [rotulo, alvo] of [['primeira', 'data-pagina="1"'], ['última', 'data-pagina="${totalPaginas}"'],
                              ['anterior', 'data-pagina="${paginaAtual - 1}"'], ['próxima', 'data-pagina="${paginaAtual + 1}"']]) {
  check(`  botão ${rotulo}`, tela.includes(alvo));
}
check('as pontas desligam nas pontas',
  (tela.match(/\$\{paginaAtual === 1 \? 'disabled' : ''\}/g) || []).length === 2
  && (tela.match(/\$\{paginaAtual === totalPaginas \? 'disabled' : ''\}/g) || []).length === 2);

// ---------------------------------------------------------------------------
console.log('--- 7. a tabela desenha SÓ a página, mas os totais são de tudo ---');
check('as linhas saem de `visiveis`', /: visiveis\.map\(\(product\) => `/.test(tela));
check('  e a condição de "tem linha" também', /\$\{visiveis\.length === 0/.test(tela));
// O que NÃO pode voltar: o map sobre a lista inteira.
check('  e nada mais desenha a lista inteira', !/\$\{products\.map\(\(product\) => `/.test(tela));
// Somar só a página diria "Valor a custo: R$ 40 mil" de uma lista de R$ 2
// milhões — um número errado em cima de uma tabela certa.
check('os totais somam a LISTA INTEIRA, não a página', /\$\{totalsPanel\(todos\)\}/.test(tela));

// ---------------------------------------------------------------------------
console.log('--- 8. o comportamento do clique ---');
check('virar página lê o botão da barra', /content\.querySelectorAll\('\.lista-paginas-botoes \[data-pagina\]'\)/.test(codigo));
check('  ignorando botão desligado', /if \(btn\.disabled\) return;/.test(codigo));
check('  e subindo a tela ao virar', /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\);/.test(codigo));
check('ordenar lê o cabeçalho', /content\.querySelectorAll\('\[data-ordenar\]'\)/.test(codigo));
check('  mesma coluna inverte', /ordem\.direcao = ordem\.direcao === 'asc' \? 'desc' : 'asc';/.test(codigo));
// Herdar a direção da coluna anterior faria a lista aparecer ao contrário do
// que a pessoa acabou de pedir, sem ela ter pedido.
check('  coluna nova começa crescente', /ordem\.campo = campo;\s*\n\s*ordem\.direcao = 'asc';/.test(codigo));
// Ordenar muda a lista inteira: a página em que a pessoa estava deixou de
// querer dizer o que queria.
check('  e ordenar volta para a página 1', /pagina = 1;\s*\n\s*render\(\);/.test(codigo));
// Filtrar na página 40 e continuar na 40 mostraria "Nenhum produto encontrado"
// — e a pessoa concluiria que o filtro não achou nada.
check('Filtrar volta para a página 1',
  /Object\.keys\(filters\)\.forEach\(\(key\) => \{ filters\[key\] = formData\.get\(key\) \|\| ''; \}\);\s*\n\s*pagina = 1;/.test(codigo));
check('  e Limpar também',
  /Object\.keys\(filters\)\.forEach\(\(key\) => \{ filters\[key\] = ''; \}\);\s*\n\s*pagina = 1;/.test(codigo));
// "Limpar" é sobre os filtros do formulário. A ordem foi escolhida no cabeçalho
// da tabela e a pessoa não pediu para desfazê-la.
check('  sem limpar a ordem junto', !/ordem\.campo = 'name';\s*\n\s*ordem\.direcao = 'asc';\s*\n\s*render/.test(codigo));

// ---------------------------------------------------------------------------
console.log('--- 9. o excluir não pode ler a variável que sumiu ---');
// `products` deixou de existir no escopo do render quando virou `todos`. Ficou
// um `products.find` para trás: ReferenceError no clique, botão sem fazer nada
// e o erro só no console. É o mesmo tipo de engano que o navegador pegou na
// fase CF; foi por isso que rodei o clique de excluir lá também.
check('excluir procura em `todos`', /const product = todos\.find\(\(p\) => p\.id === btn\.dataset\.delete\);/.test(codigo));
check('  e não sobrou nenhum `products.` solto no render',
  !/const product = products\.find/.test(codigo));

// ---------------------------------------------------------------------------
console.log('--- 10. o estilo é o mesmo das duas telas ---');
const css = ler('public/app.css');
check('a barra tem estilo', /\.lista-paginas \{/.test(css));
check('  com a de cima e a de baixo diferenciadas',
  /\.lista-paginas-acima/.test(css) && /\.lista-paginas-abaixo/.test(css));
check('  e botão desligado não some', /\.lista-paginas-botoes button\[disabled\]/.test(css));
check('o botão do cabeçalho tem estilo', /\.lista-ordenar \{/.test(css));
check('  com foco visível pelo teclado', /\.lista-ordenar:focus-visible/.test(css));
check('  e a coluna ativa destacada', /\.lista-ordenar\.is-ativa/.test(css));
// Se sobrasse um `.cadastro-paginas` em qualquer lugar, uma das duas telas
// estaria apontando para um estilo que não existe mais — e o botão voltaria a
// parecer um <button> cru, sem ninguém notar até abrir a tela.
const sobrou = ['public/app.css', 'public/app.js', 'public/modules/stock/subs/products.js']
  .filter((f) => /cadastro-paginas|cadastro-ordenar/.test(ler(f)));
check('nenhum arquivo ficou apontando para o nome antigo', sobrou.length === 0, sobrou.join(', ') || 'nenhum');

// ---------------------------------------------------------------------------
console.log('--- o que foi medido no Chrome, com os 5.476 ---');
for (const [caso, resultado] of [
  ['antes: nós no DOM', '120.534'],
  ['depois: nós no DOM', '2.314  (98,1% a menos)'],
  ['antes: só para desenhar', '3.335 ms'],
  ['a lista abre em', 'Mostrando 1–100 de 5.476 · Página 1 de 55'],
  ['coluna ativa ao abrir', 'Produto ▲ (o que o servidor já fazia)'],
  ['último da página 1', '"ABRACADEIRA PVC CINZA 1"'],
  ['primeiro da página 2', '"ABRACADEIRA PVC CINZA 1/2"  ← a sequência continua'],
  ['última página', '55, com 76 linhas (54 × 100 + 76)'],
  ['Custo decrescente', 'R$ 245.712,39 · R$ 219.990,00 · R$ 84.253,27'],
  ['Margem crescente', '-100,0% no topo (o negativo é o menor)'],
  ['Situação crescente', 'Zerado primeiro (urgência, não alfabeto)'],
  ['SKU crescente', '1 2 3 4 5 8 9 010 10 11 12 13'],
  ['filtrar na página 55', 'volta para Página 1 de 3, mantendo Produto ▲'],
  ['unidade na tela, antes', '{"UN": 5476}  — e 34 no banco'],
  ['unidade na tela, depois', 'UN 29 · PC 64 · KG 3 · LT 1 · KIT 1 · JG 1 · CT 1'],
  ['erros de console', '0']
]) console.log(`  ·  ${caso.padEnd(26)} ${resultado}`);

// Uma coisa que o navegador NÃO conseguiu mostrar, e que seria desonesto
// afirmar: a regra do "vazio por último" na coluna Categoria. A importação
// entrou sem categoria NENHUMA, então as 5.476 linhas estão vazias nessa coluna
// e os dois sentidos mostram traço no topo — o que é o comportamento certo, mas
// não distingue nada. A mesma regra foi medida na tela de Cadastros (fase CF),
// na coluna Fantasia, onde havia mistura: nenhum "-" no topo nos dois sentidos.
console.log('');
console.log('  !  "vazio por último" NÃO foi demonstrável nesta tela: a importação');
console.log('     entrou sem categoria nenhuma, então a coluna Categoria está 100%');
console.log('     vazia e os dois sentidos mostram traço no topo. A regra é a mesma');
console.log('     medida em Cadastros > Fantasia, onde havia mistura.');

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
