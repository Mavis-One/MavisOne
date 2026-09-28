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
// A ordem saiu da tela na fase DG: o servidor manda so a pagina, e as regras
// viraram um modulo que os dois leem. Estes dois fontes entram por isso.
const servidor = semComentarios(ler('server.js'));
const fonteOrdem = semComentarios(ler('public/modules/shared/ordem_de_produtos.js'));

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
console.log('--- 2. a ordem e da lista inteira, nao da pagina ---');
// A ORDEM MUDOU DE CASA NA FASE DG, e o que este bloco guarda nao mudou.
//
// A tela baixava os 5.475 produtos e fatiava no navegador: 3.713 KB crus para
// mostrar 100 linhas. Agora o SERVIDOR manda so a pagina -- 69 KB crus, 6 KB no
// fio -- e para isso ele precisa ordenar. As regras viraram
// public/modules/shared/ordem_de_produtos.js, que os DOIS leem: a tela por
// window.MavisOrdemDeProdutos e o server.js por require.
//
// Entao os checks abaixo passaram a EXERCITAR o modulo em vez de casar com a
// grafia do fonte da tela. E melhor assim: um deles chegou a fixar um defeito
// (ver o bloco 4).
const ORDEM = require('../public/modules/shared/ordem_de_produtos');

check('a ordem mora num modulo compartilhado', typeof ORDEM.ordenar === 'function');
check('  e a tela le as colunas dele', /const COLUNAS_ORDENAVEIS = ORDEM\.COLUNAS;/.test(codigo));
check('  e o servidor tambem o usa', /ordemDeProdutos\.ordenar\(/.test(servidor));
// ESTE e o check que importa. O servidor tem de ORDENAR a selecao inteira e
// ENTAO fatiar. Fatiando antes, cada pagina se ordenaria sozinha: a pagina 2
// comecaria de novo no "A" e quem clicasse em "Custo" procurando o mais caro
// acharia o mais caro DAQUELE PEDACO.
const rotaProdutos = servidor.slice(
  servidor.indexOf("if (pathname === '/api/stock/products' && req.method === 'GET')"),
  servidor.indexOf('// Status do Produto')
);
const posOrdena = rotaProdutos.indexOf('ordemDeProdutos.ordenar(');
const posFatia = rotaProdutos.indexOf('ordenada.slice(inicio');
check('o servidor ordena a selecao inteira e ENTAO fatia',
  posOrdena > -1 && posFatia > posOrdena, `ordena ${posOrdena}, fatia ${posFatia}`);
check('sao 100 por pagina', /const POR_PAGINA = 100;/.test(codigo));
check('  e a tela manda a pagina e a ordem ao servidor',
  /params\.set\('page', String\(pagina\)\);/.test(codigo)
  && /params\.set\('sort', ordem\.campo\);/.test(codigo));
check('  e a pagina fica presa entre 1 e o total',
  /const paginaAtual = Math\.min\(Math\.max\(1, pagina\), totalPaginas\);/.test(codigo));

// ---------------------------------------------------------------------------
console.log('--- 3. cada coluna e comparada pelo que ela e ---');
check('ha um catalogo de colunas', Object.keys(ORDEM.COLUNAS).length === 10,
  Object.keys(ORDEM.COLUNAS).join(', '));
for (const [campo, tipo] of [['name', 'texto'], ['sku', 'texto'], ['categoryName', 'texto'],
                             ['unit', 'texto'], ['costPrice', 'numero'], ['salePrice', 'numero'],
                             ['margin', 'numero'], ['stockQuantity', 'numero'],
                             ['situation', 'alerta'], ['status', 'texto']]) {
  check(`  ${campo.padEnd(14)} como ${tipo}`, (ORDEM.COLUNAS[campo] || {}).tipo === tipo,
    (ORDEM.COLUNAS[campo] || {}).tipo);
}
// O EFEITO, e nao a grafia. O que NAO pode acontecer e o que Cadastros faz com
// 'codigo' (arrancar os digitos): aqui isso destruiria o sinal e a virgula.
const porMargem = ORDEM.ordenar([
  { id: '1', name: 'A', margin: -100.5 },
  { id: '2', name: 'B', margin: 12.75 },
  { id: '3', name: 'C', margin: 2.5 }
], 'margin', 'asc').map((x) => x.margin).join(' ');
check('numero compara como numero, com negativo e decimal', porMargem === '-100.5 2.5 12.75', porMargem);
// "Alvaro" tem de ficar junto de "Álvaro"; e numeric:true e o que poe o SKU 100
// depois do 99 sem eu ter de adivinhar se o SKU e numero ou texto.
const comAcento = ORDEM.ordenar([
  { id: '1', name: 'Alvaro' }, { id: '2', name: 'Álvaro' }, { id: '3', name: 'Bruno' }
], 'name', 'asc').map((x) => x.name).join(' ');
check('texto compara em pt-BR, sem acento nem caixa', /^(Alvaro Álvaro|Álvaro Alvaro) Bruno$/.test(comAcento), comAcento);
const skuNumerico = ORDEM.ordenar([
  { id: '1', name: 'A', sku: '100' }, { id: '2', name: 'B', sku: '99' }
], 'sku', 'asc').map((x) => x.sku).join(' ');
check('  e ciente de numero dentro do texto', skuNumerico === '99 100', skuNumerico);
const urgencia = ORDEM.ordenar([
  { id: '1', name: 'A', situation: 'normal' },
  { id: '2', name: 'B', situation: 'zerado' },
  { id: '3', name: 'C', situation: 'abaixo-minimo' }
], 'situation', 'asc').map((x) => x.situation).join(' ');
check('a Situacao ordena por urgencia, nao por alfabeto',
  urgencia === 'zerado abaixo-minimo normal', urgencia);

// ---------------------------------------------------------------------------
console.log('--- 4. vazio e empate ---');
// Inverter o vazio junto com a direcao encheria o topo de tracos ao pedir
// "maior primeiro". Pesa aqui: a importacao entrou sem categoria nenhuma, nos
// 5.475 produtos.
const umVazio = [{ id: '1', name: 'A', sku: 'X' }, { id: '2', name: 'B', sku: '' }];
check('vazio vai para o fim nos DOIS sentidos',
  ORDEM.ordenar(umVazio, 'sku', 'asc').map((x) => x.id).join('') === '12'
  && ORDEM.ordenar(umVazio, 'sku', 'desc').map((x) => x.id).join('') === '12');

// ESTE CHECK FIXAVA UM DEFEITO, e foi a fase DG que o descobriu.
//
// Ele exigia, pela grafia, a linha `if (vazioA && vazioB) return 0;`. Esse
// `return 0` PULA o desempate de baixo, e `Array.prototype.sort` e estavel --
// entao a ordem entre dois vazios passava a ser a ordem de ENTRADA da lista.
//
// No navegador nunca apareceu: a entrada era sempre a mesma lista do servidor.
// Com a pagina vindo do servidor, apareceu na hora -- ordenando por Categoria,
// onde TODOS os 5.475 estao vazios, a pagina 1 do servidor nao batia com a
// pagina 1 da referencia (18 de 20 combinacoes passavam).
//
// O estrago nao e a ordem ser "outra": e ela poder MUDAR entre duas
// requisicoes, e ai um produto aparece em duas paginas e outro em nenhuma.
const doisVazios = [{ id: 'a', name: 'Zebra', sku: '' }, { id: 'b', name: 'Abelha', sku: '' }];
check('  e dois vazios NAO empatam em "tanto faz"',
  ORDEM.ordenar(doisVazios, 'sku', 'asc').map((x) => x.id).join('')
  === ORDEM.ordenar(doisVazios.slice().reverse(), 'sku', 'asc').map((x) => x.id).join(''),
  'a ordem nao pode depender de como a lista entrou');

// Sem desempate, dois produtos de mesmo custo trocariam de lugar entre um
// render e outro, e a lista pareceria se mexer sozinha.
const mesmoCusto = [
  { id: 'z', name: 'Bruno', costPrice: 10 },
  { id: 'a', name: 'Bruno', costPrice: 10 },
  { id: 'm', name: 'Ana', costPrice: 10 }
];
const desempatado = ORDEM.ordenar(mesmoCusto, 'costPrice', 'asc').map((x) => x.id).join('');
check('empate e resolvido pelo nome, e depois pelo id', desempatado === 'maz', desempatado);
check('  e nao depende da ordem de entrada',
  ORDEM.ordenar(mesmoCusto.slice().reverse(), 'costPrice', 'asc').map((x) => x.id).join('') === desempatado);
// A direcao inverte o RESULTADO, e nao a comparacao -- e por isso as saidas do
// vazio ficam fora dela (ver o primeiro check deste bloco).
check('a direcao inverte o resultado, e nao a comparacao',
  /return direcao === 'asc' \? resultado : -resultado;/.test(fonteOrdem));

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
//
// FASE DG: a lista inteira ja nao esta no navegador, entao os quatro cartoes
// nao tem o que somar aqui -- a soma vem PRONTA do servidor, contada antes de
// fatiar. O check virou o contrario: garantir que a tela NAO soma nada.
check('os cartoes leem os totais do servidor', /const t = totais \|\| \{\};/.test(codigo));
check('  e a tela nao soma a pagina',
  !/products\.reduce\(\(sum, p\) => sum \+ Number\(p\.stockQuantity/.test(codigo)
  && !/visiveis\.reduce\(/.test(codigo));
check('  e o servidor conta ANTES de fatiar',
  servidor.indexOf('const totais = {') < servidor.indexOf('ordenada.slice(inicio'));

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
//
// E ACONTECEU DE NOVO na fase DG: `todos` virou `visiveis` quando a pagina
// passou a vir do servidor, e este check pegou. E o certo: o botao de excluir
// so existe em linha que esta na tela, entao procurar na pagina basta -- e a
// lista inteira nao esta mais aqui para procurar.
check('excluir procura em `visiveis`', /const product = visiveis\.find\(\(p\) => p\.id === btn\.dataset\.delete\);/.test(codigo));
check('  e não sobrou nenhum `products.` nem `todos.` solto no render',
  !/const product = products\.find/.test(codigo) && !/\btodos\.(find|slice|map|length)/.test(codigo));

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
//
// A checagem é sobre o CÓDIGO, sem comentários: os comentários que explicam o
// rename citam o nome antigo de propósito ("`.cadastro-paginas` passou a
// `.lista-paginas`"), e contá-los faria este check falhar justamente por causa
// da documentação que ele deveria incentivar. Cai no mesmo engano da fase AE,
// quando um docblock meu foi contado como um ponto não tratado.
const sobrou = ['public/app.css', 'public/app.js', 'public/modules/stock/subs/products.js']
  .filter((f) => /cadastro-paginas|cadastro-ordenar/.test(semComentarios(ler(f))));
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
