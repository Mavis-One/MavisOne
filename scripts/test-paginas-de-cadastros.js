#!/usr/bin/env node
/**
 * A LISTA DE CADASTROS SAI EM PÁGINAS DE 100 (fase CF).
 *
 * A tela desenhava TODAS as linhas de uma vez. Com os 6.492 cadastros da
 * importação do ViperERP, medido num Chrome de verdade:
 *
 *     antes:   129.959 nós no DOM   ·   589 ms só para desenhar
 *     depois:    2.045 nós no DOM   ·   100 linhas por página, 65 páginas
 *
 * Funcionava — e ia piorando a cada cadastro novo, sem nunca dar erro. É o tipo
 * de problema que não aparece em teste nenhum enquanto o banco é pequeno, e que
 * chegou de uma vez porque o volume veio por importação em vez de subir aos
 * poucos.
 *
 * O CORTE É DEPOIS DO FILTRO E DA ORDENAÇÃO
 * -----------------------------------------
 * A página 1 tem de ser a primeira centena do que a pessoa PEDIU. Cortar antes
 * de filtrar daria "a primeira centena do banco, filtrada em seguida" — que com
 * um filtro de 12 resultados espalhados mostraria uma lista quase vazia.
 *
 * MEDIDO no navegador, com os 6.492:
 *     página 1 -> 2 -> 3      100 linhas cada, códigos 6492, 6390, 6292
 *     última (»»)             página 65, 92 linhas  (64 × 100 + 92 = 6.492)
 *     anterior / primeira     voltam para 64 e 1
 *     buscar "SAL INFINITY" estando na página 65 -> "Mostrando 1–12 de 12"
 *     0 erros de console
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

const app = ler('public/app.js');
const appCodigo = semComentarios(app);

console.log('--- 1. o corte ---');
check('são 100 por página', /const POR_PAGINA = 100;/.test(appCodigo));
check('  e o total de páginas arredonda para cima',
  /const totalPaginas = Math\.max\(1, Math\.ceil\(totalRegistros \/ POR_PAGINA\)\);/.test(appCodigo));
// A página fica presa entre 1 e o total: um filtro que encolhe a lista enquanto
// a pessoa está na página 40 não pode deixá-la olhando para o vazio.
check('a página fica presa entre 1 e o total',
  /const paginaAtual = Math\.min\(Math\.max\(1, listFilters\.pagina\), totalPaginas\);/.test(appCodigo));
check('  e a fatia sai da página atual',
  /merged\.slice\(primeiroDaPagina, primeiroDaPagina \+ POR_PAGINA\)/.test(appCodigo));

console.log('--- 2. corta DEPOIS de filtrar e ordenar ---');
// Se o slice viesse antes do filter, a página 1 seria "a primeira centena do
// banco, filtrada" — e uma busca com 12 resultados espalhados voltaria vazia.
const posFilter = appCodigo.indexOf('.some((field) => normalize(field).includes(query));');
// A ordenação deixou de ser a linha fixa por `createdAt` e passou a ser o
// `merged.sort` escolhido pelo cabeçalho (fase CF). A INTENÇÃO desta checagem é
// a mesma: o corte tem de vir depois de ordenar, senão cada página se ordenaria
// sozinha. Só o alvo mudou.
const posSort = appCodigo.indexOf('merged.sort((a, b) => {', posFilter);
const posSlice = appCodigo.indexOf('const visiveis = merged.slice(');
check('o filtro vem antes do corte', posFilter > 0 && posSlice > posFilter);
check('  e a ordenação também', posSort > 0 && posSlice > posSort);

console.log('--- 3. a tabela desenha SÓ a página ---');
check('as linhas saem de `visiveis`', /\$\{visiveis\.map\(\(row\) => `/.test(appCodigo));
// O que NÃO pode voltar: o `merged.map` que desenhava as 6.492.
check('  e não mais de `merged`', !/\$\{merged\.map\(\(row\) => `/.test(appCodigo));
check('a condição de "tem linha" também olha a página', /\$\{visiveis\.length \? `/.test(appCodigo));

console.log('--- 4. a barra de páginas ---');
check('existe uma barra', /const barraDePaginas = \(posicao\) =>/.test(appCodigo));
// Duas barras: com 100 linhas, ter só a de baixo obrigaria a rolar a tela
// inteira para virar a página.
check('  desenhada ACIMA e ABAIXO da tabela',
  /\$\{barraDePaginas\('acima'\)\}/.test(appCodigo) && /\$\{barraDePaginas\('abaixo'\)\}/.test(appCodigo));
check('diz quantos está mostrando de quantos', /Mostrando <strong>\$\{primeiroDaPagina \+ 1\}/.test(app));
check('  e em qual página de quantas', /Página \$\{paginaAtual\} de \$\{totalPaginas\}/.test(app));
// Primeira/anterior/próxima/última, e as pontas desligadas nas pontas.
for (const [rotulo, alvo] of [['primeira', 'data-pagina="1"'], ['última', 'data-pagina="${totalPaginas}"'],
                              ['anterior', 'data-pagina="${paginaAtual - 1}"'], ['próxima', 'data-pagina="${paginaAtual + 1}"']]) {
  check(`  botão ${rotulo}`, app.includes(alvo));
}
check('as pontas desligam nas pontas',
  (app.match(/\$\{paginaAtual === 1 \? 'disabled' : ''\}/g) || []).length === 2
  && (app.match(/\$\{paginaAtual === totalPaginas \? 'disabled' : ''\}/g) || []).length === 2);
// Com uma página só, a lista não precisa de botão nenhum — mas o "Mostrando X
// de Y" continua, porque ele responde "quantos são?".
check('com uma página só, some a botoeira mas fica a contagem',
  /\$\{totalPaginas > 1 \? `/.test(app));

console.log('--- 5. virar página, e voltar para a 1 ---');
check('o clique é delegado no content', /content\.addEventListener\('click', \(evento\) => \{[\s\S]{0,160}lista-paginas-botoes \[data-pagina\]/.test(appCodigo));
check('  ignorando botão desligado', /if \(!botao \|\| botao\.disabled\) return;/.test(appCodigo));
check('  e subindo a tela ao virar', /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\);/.test(appCodigo));
// Buscar na página 40 e continuar na 40 mostraria "Nenhum registro" — e a
// pessoa concluiria que a busca não achou nada.
const aplicar = appCodigo.slice(appCodigo.indexOf('const applyUnifiedFilters = () => {'));
check('Buscar volta para a página 1', /pagina: 1/.test(aplicar.slice(0, 2200)));
const limpar = appCodigo.slice(appCodigo.indexOf("getElementById('cadastroFilterClearBtn')"));
check('  e Limpar filtros também', /pagina: 1/.test(limpar.slice(0, 1600)));
check('a página mora junto dos filtros no estado',
  /pagina: Number\(state\.cadastroDraft\.listFilters\?\.pagina\) \|\| 1/.test(appCodigo));

console.log('--- 6. o estilo existe ---');
const css = ler('public/app.css');
check('a barra tem estilo', /\.lista-paginas \{/.test(css));
check('  com a de cima e a de baixo diferenciadas',
  /\.lista-paginas-acima/.test(css) && /\.lista-paginas-abaixo/.test(css));
// Botão desligado continua ocupando o lugar: a barra não pode dançar ao chegar
// na primeira ou na última página.
check('  e botão desligado não some', /\.lista-paginas-botoes button\[disabled\]/.test(css));

console.log('--- o que foi medido no Chrome, com os 6.492 ---');
for (const [caso, resultado] of [
  ['antes: nós no DOM', '129.959'],
  ['depois: nós no DOM', '2.045  (98,4% a menos)'],
  ['antes: só para desenhar', '589 ms'],
  ['a lista abre em', 'Mostrando 1–100 de 6.492 · Página 1 de 65'],
  ['página 1 → 2 → 3', '100 linhas cada, códigos 6492, 6390, 6292'],
  ['última página', '65, com 92 linhas (64 × 100 + 92)'],
  ['buscar estando na página 65', 'volta para Mostrando 1–12 de 12'],
  ['erros de console', '0']
]) console.log(`  ·  ${caso.padEnd(32)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
