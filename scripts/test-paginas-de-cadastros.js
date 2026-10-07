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
// O FILTRO, A ORDEM E O CORTE SAÍRAM DO app.js (rodada de desempenho, out/2026)
// para public/modules/shared/lista_de_cadastros.js, que o SERVIDOR roda para
// mandar só a página (/api/cadastros/lista) — a tela baixava as 6.492 pessoas a
// cada clique para mostrar 100. O código foi MOVIDO sem mudar regra, com os
// mesmos nomes (`listFilters`, `merged`), então as checagens das seções 1 e 2
// são as de antes, apontadas para o módulo. A seção 7 roda o módulo de verdade.
const modulo = semComentarios(ler('public/modules/shared/lista_de_cadastros.js'));
const Lista = require(path.join(RAIZ, 'public/modules/shared/lista_de_cadastros.js'));

console.log('--- 1. o corte ---');
check('são 100 por página', /const POR_PAGINA = 100;/.test(modulo));
check('  e o total de páginas arredonda para cima',
  /const totalPaginas = Math\.max\(1, Math\.ceil\(totalRegistros \/ POR_PAGINA\)\);/.test(modulo));
// A página fica presa entre 1 e o total: um filtro que encolhe a lista enquanto
// a pessoa está na página 40 não pode deixá-la olhando para o vazio.
check('a página fica presa entre 1 e o total',
  /const paginaAtual = Math\.min\(Math\.max\(1, listFilters\.pagina\), totalPaginas\);/.test(modulo));
check('  e a fatia sai da página atual',
  /merged\.slice\(primeiroDaPagina, primeiroDaPagina \+ POR_PAGINA\)/.test(modulo));

console.log('--- 2. corta DEPOIS de filtrar e ordenar ---');
// Se o slice viesse antes do filter, a página 1 seria "a primeira centena do
// banco, filtrada" — e uma busca com 12 resultados espalhados voltaria vazia.
// No módulo, cada passo é uma função; a ORDEM em que rodam é a da montagem
// da página. A seção 7 prova o mesmo executando.
check('o filtro vem antes do corte, e a ordenação também',
  /const merged = ordenar\(filtrar\(projetar\(people, cnpjs\), listFilters, limites, memo\), listFilters\);\s*\n\s*return paginar\(merged, listFilters\);/.test(modulo));
check('  e a tela não corta nem filtra mais por conta própria',
  !/merged\.slice\(/.test(appCodigo) && !/merged\.sort\(/.test(appCodigo) && !/\.some\(\(field\) => normalize\(field\)/.test(appCodigo));

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
// O clique é DELEGADO, e não um ouvinte por botão: as barras são duas e se
// redesenham inteiras a cada virada, então um ouvinte por botão teria de ser
// reatado toda vez.
//
// MAS DELEGADO NA CASCA DESTA LISTA, e não no `content`. Estava no `content` e
// isso virou bug de verdade na fase CH: `content` é o mesmo nó em todos os
// módulos e sobrevive à troca de tela (innerHTML troca os filhos, não o pai).
// Quando o Estoque passou a usar as mesmas classes `.lista-*`, virar a página no
// Gestor de Preços casava este seletor, este ouvinte rodava, e a pessoa era
// jogada para Cadastros > Pessoas — sem erro no console.
//
// A intenção do check é a mesma de antes; o alvo mudou porque o alvo ERA o bug.
check('o clique é delegado na casca da lista',
  /const casca = content\.querySelector\('\.cadastros-shell'\);/.test(appCodigo)
  && /casca\?\.addEventListener\('click', \(evento\) => \{[\s\S]{0,160}lista-paginas-botoes \[data-pagina\]/.test(appCodigo));
check('  e NÃO no content, que é compartilhado entre os módulos',
  !/content\.addEventListener\('click'[\s\S]{0,80}lista-paginas-botoes/.test(appCodigo));
check('  ignorando botão desligado', /if \(!botao \|\| botao\.disabled\) return;/.test(appCodigo));
check('  e subindo a tela ao virar', /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\);/.test(appCodigo));
// Buscar na página 40 e continuar na 40 mostraria "Nenhum registro" — e a
// pessoa concluiria que a busca não achou nada.
const aplicar = appCodigo.slice(appCodigo.indexOf('const applyUnifiedFilters = () => {'));
check('Buscar volta para a página 1', /pagina: 1/.test(aplicar.slice(0, 2200)));
const limpar = appCodigo.slice(appCodigo.indexOf("getElementById('cadastroFilterClearBtn')"));
check('  e Limpar filtros também', /pagina: 1/.test(limpar.slice(0, 1600)));
check('a página mora junto dos filtros no estado',
  /pagina: Number\(g\.pagina\) \|\| 1/.test(modulo)
  && /const listFilters = Lista\.normalizarFiltros\(state\.cadastroDraft\.listFilters\);/.test(appCodigo));

console.log('--- 6. o estilo existe ---');
const css = ler('public/app.css');
check('a barra tem estilo', /\.lista-paginas \{/.test(css));
check('  com a de cima e a de baixo diferenciadas',
  /\.lista-paginas-acima/.test(css) && /\.lista-paginas-abaixo/.test(css));
// Botão desligado continua ocupando o lugar: a barra não pode dançar ao chegar
// na primeira ou na última página.
check('  e botão desligado não some', /\.lista-paginas-botoes button\[disabled\]/.test(css));

console.log('--- 7. o módulo, executado ---');
{
  // 250 cadastros: códigos 1..250, nomes repetidos de 10 em 10, metade inativa.
  const pessoas = Array.from({ length: 250 }, (_, i) => ({
    id: `p${i + 1}`, code: String(i + 1), type: 'pessoa-fisica', name: `Nome ${(i % 10) + 1}`,
    status: i % 2 ? 'inativo' : 'ativo', roles: ['Cliente'], createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString()
  }));
  const pagina = (filtros) => Lista.montarPagina(pessoas, [], filtros, { inicio: '', fim: '' });
  const p1 = pagina({});
  check('página 1: 100 linhas, a mais nova em cima', p1.visiveis.length === 100 && p1.visiveis[0].code === '250', p1.visiveis[0].code);
  check('  3 páginas para 250', p1.totalPaginas === 3 && p1.totalRegistros === 250);
  const p3 = pagina({ pagina: 3 });
  check('última página com o resto (50)', p3.visiveis.length === 50 && p3.primeiroDaPagina === 200);
  const p99 = pagina({ pagina: 99 });
  check('página além do fim fica presa na última', p99.paginaAtual === 3 && p99.visiveis.length === 50);
  const p0 = pagina({ pagina: -4 });
  check('  e abaixo de 1, na primeira', p0.paginaAtual === 1);
  // Cortar ANTES de filtrar daria só os ativos da 1ª centena (50), e não 100.
  const ativos = pagina({ status: 'ativo' });
  check('o corte é DEPOIS do filtro', ativos.totalRegistros === 125 && ativos.visiveis.length === 100,
    `${ativos.totalRegistros} / ${ativos.visiveis.length}`);
  // Ordenar só a página faria a página 2 recomeçar do menor código.
  const porCodigo2 = pagina({ ordemCampo: 'code', ordemDirecao: 'asc', pagina: 2 });
  check('a ordem é da lista inteira: página 2 por código começa no 101', porCodigo2.visiveis[0].code === '101', porCodigo2.visiveis[0].code);
  const vazio = pagina({ query: 'não existe ninguém assim' });
  check('nada encontrado: 0 registros, página 1 de 1', vazio.totalRegistros === 0 && vazio.totalPaginas === 1 && vazio.paginaAtual === 1);
}

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
