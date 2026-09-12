#!/usr/bin/env node
/**
 * ORDENAR A LISTA DE CADASTROS PELO CABEÇALHO (fase CF).
 *
 * O QUE DECIDE SE ISTO SERVE PARA ALGUMA COISA
 * --------------------------------------------
 * A ordem vale sobre a LISTA INTEIRA, e não sobre a página visível. Ordenar só
 * as 100 linhas da tela reembaralharia cada página por conta própria: a página
 * 2 começaria de novo no "A", e o maior valor da lista poderia estar em
 * qualquer página. A pessoa clicaria em "Código" esperando achar o maior e
 * encontraria o maior DAQUELE PEDAÇO.
 *
 * Por isso o `sort` fica depois do filtro e ANTES do corte em páginas.
 *
 * MEDIDO num Chrome de verdade, com os 6.492 cadastros importados:
 *
 *   abre sem clique nenhum ...... "Cadastrado em ▼" (o comportamento de sempre)
 *   clica em Nome ............... ▲, começa em "(CDL) CAMARA DE DIRIGENTES..."
 *   ENTRE PÁGINAS:
 *     último da página 1 ........ "A. MICHELSON E FILHOS LTDA"
 *     primeiro da página 2 ...... "AARON GONCALVES PAULUS"
 *     a sequência CONTINUA — a ordem é da lista inteira
 *   clica de novo ............... ▼, começa em "ZUTTEL FIBRA LTDA", e volta
 *                                 para a página 1
 *   Código crescente ............ 01, 02, ... 09, 10, 11, 12
 *                                 (texto puro colocaria o 100 entre 10 e 11)
 *   Fantasia, nos dois sentidos . nenhum "-" no topo
 *   busca depois de ordenar ..... mantém "Nome / Razão social ▲"
 *   erros de console ............ 0
 *
 * UM ERRO MEU NO CAMINHO, que só o navegador pegou: o ouvinte de clique lia
 * `campoDaOrdem`, declarada DENTRO de renderUnifiedList, e ele mora fora dela.
 * Dava ReferenceError a cada clique — a lista não reordenava e nada aparecia na
 * tela, só no console. Passou a ler de `listFilters`, que é o estado de verdade.
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

console.log('--- 1. a ordem é da lista inteira, não da página ---');
const posFiltro = appCodigo.indexOf('.some((field) => normalize(field).includes(query));');
const posSort = appCodigo.indexOf('merged.sort((a, b) => {');
const posCorte = appCodigo.indexOf('const visiveis = merged.slice(');
check('ordena depois de filtrar', posSort > posFiltro && posFiltro > 0);
// ESTE é o check que importa. Se o corte viesse antes, cada página se ordenaria
// sozinha e a ordem passaria a mentir.
check('  e ANTES de cortar em páginas', posCorte > posSort, `sort na ${appCodigo.slice(0, posSort).split('\n').length}, corte na ${appCodigo.slice(0, posCorte).split('\n').length}`);

console.log('--- 2. cada coluna é comparada pelo que ela é ---');
check('há um catálogo de colunas', /const COLUNAS_ORDENAVEIS = \{/.test(appCodigo));
for (const [campo, tipo] of [['code', 'numero'], ['name', 'texto'], ['document', 'numero'],
                             ['createdAt', 'data'], ['status', 'texto'], ['tradeName', 'texto'],
                             ['email', 'texto'], ['phone', 'numero'], ['cadastroTipo', 'texto']]) {
  check(`  ${campo.padEnd(13)} como ${tipo}`, new RegExp(`${campo}: \\{ rotulo: '[^']+', tipo: '${tipo}' \\}`).test(appCodigo));
}
// 'código' é text no banco. Comparado como texto, o 100 cairia entre o 10 e o 11.
check('número compara só os dígitos', /Number\(String\(va\)\.replace\(\/\\D\/g, ''\)\) \|\| 0/.test(appCodigo));
// "Álvaro" tem de ficar junto de "Alvaro", e não no fim do alfabeto.
check('texto compara em pt-BR, sem acento nem caixa',
  /new Intl\.Collator\('pt-BR', \{ sensitivity: 'base', numeric: true \}\)/.test(appCodigo));

console.log('--- 3. vazio e empate ---');
// Inverter o vazio junto com a direção encheria o topo de traços ao pedir
// "maior primeiro" — quem ordena por e-mail quer ver os e-mails.
check('vazio vai para o fim nos DOIS sentidos',
  /if \(vazioA && vazioB\) return 0;\s*\n\s*if \(vazioA\) return 1;\s*\n\s*if \(vazioB\) return -1;/.test(appCodigo));
// Sem desempate, duas pessoas de mesmo nome trocariam de lugar entre um render
// e outro, e a lista pareceria se mexer sozinha.
check('empate é resolvido pelo código',
  /if \(resultado === 0\) resultado = \(Number\(a\.code\) \|\| 0\) - \(Number\(b\.code\) \|\| 0\);/.test(appCodigo));
check('a direção inverte o resultado, e não a comparação',
  /return direcaoDaOrdem === 'asc' \? resultado : -resultado;/.test(appCodigo));

console.log('--- 4. o cabeçalho ---');
// <button> de verdade: chega pelo teclado e é anunciado como botão. Um <th> com
// addEventListener pareceria clicável só para quem usa mouse.
check('cada coluna é um button', /<button type="button" class="lista-ordenar/.test(app));
check('  com aria-sort para o leitor de tela', /aria-sort="\$\{ativa \? \(direcaoDaOrdem === 'asc' \? 'ascending' : 'descending'\) : 'none'\}"/.test(app));
check('  e a seta indicando a direção', /direcaoDaOrdem === 'asc' \? '▲' : '▼'/.test(app));
// O título diz o que o PRÓXIMO clique faz, não o que já está feito.
check('o title diz o que o próximo clique fará', /Ordenar por \$\{escapeHtml\(def\.rotulo\)\} em ordem \$\{proxima\}/.test(app));
check('Ações não ordena', /\}\)\.join\(''\)\}\s*\n\s*<th>Ações<\/th>/.test(app));

console.log('--- 5. o comportamento do clique ---');
check('o clique é delegado', /const alvo = evento\.target\.closest\('\[data-ordenar\]'\);/.test(appCodigo));
// Lê do ESTADO, e não das variáveis do renderizador: elas são declaradas dentro
// de renderUnifiedList e este ouvinte mora fora — era ReferenceError a cada
// clique, e o navegador foi quem pegou.
check('  lendo do estado, não do renderizador',
  /const mesmaColuna = campo === listFilters\.ordemCampo;/.test(appCodigo)
  && !/const mesmaColuna = campo === campoDaOrdem;/.test(appCodigo));
check('mesma coluna inverte', /listFilters\.ordemDirecao === 'asc' \? 'desc' : 'asc'/.test(appCodigo));
// Herdar a direção da coluna anterior faria a lista aparecer ao contrário do
// que a pessoa acabou de pedir, sem ela ter pedido.
check('  coluna nova começa crescente', /: \(campo === 'createdAt' \? 'desc' : 'asc'\)/.test(appCodigo));
check('  menos data, que começa pelo mais recente', /campo === 'createdAt' \? 'desc'/.test(appCodigo));
check('ordenar volta para a página 1', /ordemCampo: campo, ordemDirecao: direcao, pagina: 1/.test(appCodigo));

console.log('--- 6. a ordem sobrevive aos filtros ---');
// Este objeto é montado do zero a partir do formulário, que não tem campo de
// ordenação: sem carregar os dois, buscar desfaria um clique que a pessoa deu
// há um segundo e não pediu para desfazer.
const aplicar = appCodigo.slice(appCodigo.indexOf('const applyUnifiedFilters = () => {'));
check('Buscar mantém a ordem',
  /ordemCampo: listFilters\.ordemCampo,\s*\n\s*ordemDirecao: listFilters\.ordemDirecao/.test(aplicar.slice(0, 2600)));
const limpar = appCodigo.slice(appCodigo.indexOf("getElementById('cadastroFilterClearBtn')"));
check('  e Limpar filtros também', /ordemCampo: listFilters\.ordemCampo/.test(limpar.slice(0, 2000)));
check('o padrão continua sendo o de sempre',
  /ordemCampo: state\.cadastroDraft\.listFilters\?\.ordemCampo \|\| 'createdAt'/.test(appCodigo));
check('  descendente', /ordemDirecao: state\.cadastroDraft\.listFilters\?\.ordemDirecao === 'asc' \? 'asc' : 'desc'/.test(appCodigo));

console.log('--- 7. o estilo ---');
const css = ler('public/app.css');
check('o botão do cabeçalho tem estilo', /\.lista-ordenar \{/.test(css));
check('  com foco visível pelo teclado', /\.lista-ordenar:focus-visible/.test(css));
check('  e a coluna ativa destacada', /\.lista-ordenar\.is-ativa/.test(css));
// Sem largura mínima, os títulos dançam de lugar a cada troca de coluna.
check('a seta reserva o próprio espaço', /\.lista-ordenar-seta \{[\s\S]{0,120}min-width/.test(css));

console.log('--- o que foi medido no Chrome, com os 6.492 ---');
for (const [caso, resultado] of [
  ['abre sem clique nenhum', 'Cadastrado em ▼ (como sempre foi)'],
  ['clica em Nome', '▲, de "(CDL) CAMARA DE DIRIGENTES..."'],
  ['último da página 1', '"A. MICHELSON E FILHOS LTDA"'],
  ['primeiro da página 2', '"AARON GONCALVES PAULUS"  ← a sequência continua'],
  ['clica de novo', '▼, de "ZUTTEL FIBRA LTDA", volta à página 1'],
  ['Código crescente', '01 02 03 ... 09 10 11 12'],
  ['Fantasia, nos dois sentidos', 'nenhum "-" no topo'],
  ['buscar depois de ordenar', 'mantém Nome ▲, 879 de 6.492'],
  ['erros de console', '0']
]) console.log(`  ·  ${caso.padEnd(30)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
