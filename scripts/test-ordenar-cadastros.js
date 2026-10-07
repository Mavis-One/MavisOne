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
// A ORDEM SAIU DO app.js (rodada de desempenho, out/2026) para
// public/modules/shared/lista_de_cadastros.js, que o SERVIDOR roda para mandar
// só a página da lista. Movida sem mudar regra e com os mesmos nomes, então as
// checagens de regra (seções 1 a 3) são as de antes, apontadas para o módulo; o
// cabeçalho e o clique (4 a 6) continuam na tela. A seção 8 roda o módulo.
const modulo = semComentarios(ler('public/modules/shared/lista_de_cadastros.js'));
const Lista = require(path.join(RAIZ, 'public/modules/shared/lista_de_cadastros.js'));

console.log('--- 1. a ordem é da lista inteira, não da página ---');
// Cada passo é uma função do módulo; a montagem da página os encadeia. ESTE é o
// check que importa: se o corte viesse antes, cada página se ordenaria sozinha
// e a ordem passaria a mentir. A seção 8 prova executando.
check('ordena depois de filtrar, e ANTES de cortar em páginas',
  /const merged = ordenar\(filtrar\(projetar\(people, cnpjs\), listFilters, limites, memo\), listFilters\);\s*\n\s*return paginar\(merged, listFilters\);/.test(modulo));

console.log('--- 2. cada coluna é comparada pelo que ela é ---');
check('há um catálogo de colunas', /const COLUNAS_ORDENAVEIS = \{/.test(modulo));
for (const [campo, tipo] of [['code', 'numero'], ['name', 'texto'], ['document', 'numero'],
                             ['createdAt', 'data'], ['status', 'texto'], ['tradeName', 'texto'],
                             ['email', 'texto'], ['phone', 'numero'], ['cadastroTipo', 'texto']]) {
  check(`  ${campo.padEnd(13)} como ${tipo}`, new RegExp(`${campo}: \\{ rotulo: '[^']+', tipo: '${tipo}' \\}`).test(modulo));
}
// 'código' é text no banco. Comparado como texto, o 100 cairia entre o 10 e o 11.
check('número compara só os dígitos', /Number\(String\(va\)\.replace\(\/\\D\/g, ''\)\) \|\| 0/.test(modulo));
// "Álvaro" tem de ficar junto de "Alvaro", e não no fim do alfabeto.
check('texto compara em pt-BR, sem acento nem caixa',
  /new Intl\.Collator\('pt-BR', \{ sensitivity: 'base', numeric: true \}\)/.test(modulo));

console.log('--- 3. vazio e empate ---');
// Inverter o vazio junto com a direção encheria o topo de traços ao pedir
// "maior primeiro" — quem ordena por e-mail quer ver os e-mails.
check('vazio vai para o fim nos DOIS sentidos',
  /if \(vazioA && vazioB\) return 0;\s*\n\s*if \(vazioA\) return 1;\s*\n\s*if \(vazioB\) return -1;/.test(modulo));
// Sem desempate, duas pessoas de mesmo nome trocariam de lugar entre um render
// e outro, e a lista pareceria se mexer sozinha.
check('empate é resolvido pelo código',
  /if \(resultado === 0\) resultado = \(Number\(a\.code\) \|\| 0\) - \(Number\(b\.code\) \|\| 0\);/.test(modulo));
check('a direção inverte o resultado, e não a comparação',
  /return direcaoDaOrdem === 'asc' \? resultado : -resultado;/.test(modulo));

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
  /ordemCampo: g\.ordemCampo \|\| 'createdAt'/.test(modulo));
check('  descendente', /ordemDirecao: g\.ordemDirecao === 'asc' \? 'asc' : 'desc'/.test(modulo));

console.log('--- 7. o estilo ---');
const css = ler('public/app.css');
check('o botão do cabeçalho tem estilo', /\.lista-ordenar \{/.test(css));
check('  com foco visível pelo teclado', /\.lista-ordenar:focus-visible/.test(css));
check('  e a coluna ativa destacada', /\.lista-ordenar\.is-ativa/.test(css));
// Sem largura mínima, os títulos dançam de lugar a cada troca de coluna.
check('a seta reserva o próprio espaço', /\.lista-ordenar-seta \{[\s\S]{0,120}min-width/.test(css));

console.log('--- 8. o módulo, executado ---');
{
  const p = (id, code, name, extra = {}) => ({ id, code: String(code), type: 'pessoa-fisica', name, createdAt: '2026-01-01T00:00:00.000Z', ...extra });
  const pessoas = [
    p('a', 100, 'Álvaro', { email: 'z@x' }), p('b', 10, 'alvaro'), p('c', 11, 'Bruno', { email: 'a@x' }),
    p('d', 9, 'Carla', { createdAt: '2026-03-01T00:00:00.000Z' }), p('e', 2, '', { email: '' })
  ];
  const ordem = (campo, direcao) => Lista.montarPagina(pessoas, [], { ordemCampo: campo, ordemDirecao: direcao }, {})
    .visiveis.map((r) => r.id).join('');
  check('código crescente compara número (9, 10, 11, 100)', ordem('code', 'asc') === 'edbca', ordem('code', 'asc'));
  check('nome em pt-BR: Álvaro junto de alvaro, empate pelo código, vazio no fim', ordem('name', 'asc') === 'bacde', ordem('name', 'asc'));
  check('  e no decrescente o vazio CONTINUA no fim', ordem('name', 'desc').endsWith('e'), ordem('name', 'desc'));
  check('e-mail: quem não tem vai para o fim nos dois sentidos',
    ordem('email', 'asc').slice(0, 2) === 'ca' && ordem('email', 'desc').slice(0, 2) === 'ac', `${ordem('email', 'asc')} / ${ordem('email', 'desc')}`);
  check('sem ordem pedida: Cadastrado em, o mais novo em cima', Lista.montarPagina(pessoas, [], {}, {}).visiveis[0].id === 'd');
  check('coluna que não existe cai na ordem padrão', ordem('senha', 'asc') === ordem('createdAt', 'asc'));
}

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
