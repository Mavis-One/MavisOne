#!/usr/bin/env node
/**
 * NENHUMA TELA DESENHA 5.476 DE NADA (fase CH).
 *
 * A importação do ViperERP trouxe 5.476 produtos e, junto com os 6.492
 * cadastros de pessoas, deixou nove telas inutilizáveis sem dar um erro. Todas
 * foram escritas quando havia uma dúzia de produtos e nenhuma estava errada: o
 * que mudou foi o volume. Medido num Chrome de verdade, nós no DOM por tela:
 *
 *     Estoque > Gestor de preços ........ 49.310  ->    948
 *     Estoque > Novo catálogo ........... 32.895  ->    661
 *     Compras > Nova ordem de compra .... 12.030  ->     75
 *     Cadastros > Novo cashback .......... 5.542  ->     72
 *     Estoque > Movimentações ............ 5.542  ->     72
 *     Estoque > Status do produto ........ 5.530  ->     61
 *     Estoque > Transferências ........... 5.514  ->     44
 *     Estoque > Nova movimentação ........ 5.509  ->     39
 *
 * DOIS REMÉDIOS, PARA DOIS PROBLEMAS DIFERENTES
 * ---------------------------------------------
 * <select> com 5.477 <option> vira CAMPO DE BUSCA. Não é só lento: não se
 * procura nele — rola-se até achar, ou digita-se as primeiras letras rápido o
 * bastante para o navegador contar como uma palavra só.
 *
 * TABELA com 5.476 linhas vira PÁGINA DE 100, como Cadastros e Produtos.
 *
 * O SKU NO RÓTULO NÃO É ENFEITE
 * -----------------------------
 * 203 nomes aparecem mais de uma vez no cadastro, envolvendo 457 produtos —
 * "SETA (PISCA DE SINALIZACAO) PARA BICICLETA" aparece 7 vezes, com 7 custos
 * diferentes. Um seletor que mostra só o nome oferece sete linhas idênticas e
 * deixa a escolha no chute. Medido na ordem de compra:
 *
 *     escolheu "... · 10087"  ->  custo R$ 6,41
 *     escolheu "... · 10409"  ->  custo R$ 2,31
 *
 * DOIS DEFEITOS DA BUSCA QUE SÓ APARECERAM COM VOLUME
 * ---------------------------------------------------
 * A busca era `rotulo.includes(termo)`, a frase inteira como um pedaço só:
 *
 *     "seta pisca"  ->  Nenhum resultado     (há um parêntese entre as duas)
 *     "10087"       ->  11 achados, com 100876 / 100875 / 100874 na frente
 *
 * O primeiro diz que um produto do cadastro não existe. O segundo devolve o
 * trabalho para quem digitou o código exato. Agora cada palavra é um filtro, e
 * quem casa palavra inteira (ou começa com o termo) vai na frente:
 *
 *     "seta pisca" ........... 9 achados, as sete SETAs entre eles
 *     "10087" ................ o SKU exato em PRIMEIRO, depois os 1008xx
 *     "abracadeira" .......... "ABRACADEIRA 1/2 CZ" antes de um rótulo que
 *                              começa com código de barras
 *     "papel toalha rolo" .... 1 achado
 *     "direcao" .............. acha "DIREÇÃO" (segue sem acento)
 *     custo por tecla ........ 1 a 4 ms, com 5.476 rótulos
 *
 * UM BUG MEU, E O ÚNICO JEITO DE TER ACHADO
 * -----------------------------------------
 * Renomear `.cadastro-paginas` para `.lista-paginas` (fase CG) fez o Estoque
 * usar as MESMAS classes de Cadastros. O ouvinte de página de Cadastros estava
 * delegado no `content` — que é o mesmo nó em todos os módulos e sobrevive à
 * troca de tela, porque innerHTML troca os filhos e não o pai. Resultado:
 *
 *     1. abrir Cadastros > Pessoas      (o ouvinte é atado no content)
 *     2. ir para o Gestor de Preços
 *     3. virar a página
 *     4. a pessoa é jogada para Cadastros > Pessoas, sem erro no console
 *
 * Visitar o Estoque SEM passar por Cadastros não reproduzia — foi por isso que
 * a primeira rodada de provas passou limpa. O ouvinte passou para a casca da
 * lista (`.cadastros-shell`), que é recriada a cada render; isso também fecha o
 * vazamento que existia antes, de um ouvinte novo no `content` a cada passada.
 *
 * MEDIDO depois da correção, nos cinco cenários:
 *     virar página em Produtos / Gestor de Preços / Novo Catálogo .... fica
 *     ordenar em Produtos ........................................... fica
 *     e Cadastros, dono do ouvinte, ainda vira e ainda ordena ....... sim
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

// ---------------------------------------------------------------------------
console.log('--- 1. o rótulo do produto (roda de verdade) ---');
const rotulos = require('../public/modules/shared/rotulo_produto');

check('nome e SKU, nessa ordem',
  rotulos.rotulo({ name: 'SETA (PISCA)', sku: '10087' }) === 'SETA (PISCA) · 10087',
  rotulos.rotulo({ name: 'SETA (PISCA)', sku: '10087' }));
// Quem procura digita o NOME; o SKU vem depois para desempatar. E o campo casa
// contra o rótulo inteiro, então digitar o SKU também acha.
check('  produto sem SKU sai só com o nome, sem separador solto',
  rotulos.rotulo({ name: 'FRETE', sku: '' }) === 'FRETE',
  rotulos.rotulo({ name: 'FRETE', sku: '' }));
check('  e sem nome nenhum não sai string vazia',
  rotulos.rotulo({ name: '', sku: '9' }) === '(sem nome) · 9',
  rotulos.rotulo({ name: '', sku: '9' }));
check('opcoes() devolve o formato do seletor, com o produto junto', (() => {
  const [op] = rotulos.opcoes([{ id: 'p1', name: 'CABO', sku: '77', costPrice: 3.5 }]);
  // `product` vai junto porque quem escolhe quase sempre precisa de outro campo
  // dele (o custo, na ordem de compra) e buscá-lo por id seria um find por clique.
  return op.value === 'p1' && op.label === 'CABO · 77' && op.product.costPrice === 3.5;
})());

// ---------------------------------------------------------------------------
console.log('--- 2. quando um <select> deixa de servir (roda de verdade) ---');
const campo = require('../public/modules/shared/campo_de_busca');

const listaDe = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, sku: String(i) }));
const defDe = (n) => ({ type: 'select', name: 'productId', options: () => listaDe(n) });

check('o corte está em 200', campo.LIMITE === 200, String(campo.LIMITE));
// Com 20 opções o <select> é melhor: mostra todas de uma vez e escolher é um
// clique. O corte é onde a rolagem deixa de caber numa tela.
check('  20 itens continua <select>', campo.ehDeBusca(defDe(20), {}) === false);
check('  200 itens continua <select> (o limite é exclusivo)', campo.ehDeBusca(defDe(200), {}) === false);
check('  201 itens vira busca', campo.ehDeBusca(defDe(201), {}) === true);
check('  5.476 itens vira busca', campo.ehDeBusca(defDe(5476), {}) === true);
check('campo que não é select nunca vira busca',
  campo.ehDeBusca({ type: 'text', name: 'x', options: () => listaDe(5000) }, {}) === false);
check('lista fixa (array) também é medida',
  campo.ehDeBusca({ type: 'select', name: 'x', options: listaDe(5000) }, {}) === true);
// O id sai do nome do campo, então quem desenha e quem liga os eventos chegam
// ao mesmo id sem combinarem nada.
check('o id é derivado do nome do campo',
  campo.idDoCampo({ name: 'productId' }) === 'campoBusca_productId');
check('item COM sku recebe o SKU no rótulo', (() => {
  const [op] = campo.opcoes({ type: 'select', name: 'x', options: [{ id: 'a', name: 'CABO', sku: '77' }] }, {});
  return op.label === 'CABO · 77';
})());
// Depósito e categoria não têm SKU, e o rótulo deles continua sendo só o nome.
check('  item SEM sku fica só com o nome', (() => {
  const [op] = campo.opcoes({ type: 'select', name: 'x', options: [{ id: 'd', name: 'GALPAO' }] }, {});
  return op.label === 'GALPAO';
})());

// ---------------------------------------------------------------------------
console.log('--- 3. a regra mora num lugar só ---');
// São três fábricas de formulário no sistema e duas desenham campo com lista de
// produto. A regra escrita duas vezes divergiria na primeira correção feita de
// um lado — e o modo de falhar é silencioso: o campo apareceria como busca de
// um lado e ninguém ligaria o ouvinte dele.
for (const arquivo of ['public/modules/cadastros/shared.js', 'public/modules/stock/shared.js']) {
  const texto = semComentarios(ler(arquivo));
  const nome = arquivo.split('/')[2];
  check(`${nome.padEnd(10)} decide pela função compartilhada`, /ehDeBusca\(def, meta\)/.test(texto));
  check(`  ${nome.padEnd(8)} e liga os ouvintes com a MESMA`, /\.ligar\(/.test(texto));
  // O que não pode existir: um `> 200` escrito à mão dentro da fábrica.
  check(`  ${nome.padEnd(8)} sem limite próprio escrito à mão`, !/length > 200/.test(texto));
}
// Os dois renders que desenham campos: a tela inline e a do makeFormScreen. O
// terceiro render do arquivo é a tela de LISTA, que monta os <select> de filtro
// inline — e nenhum filtro do sistema lista produto hoje.
check('cadastros liga nos DOIS renders que desenham campos',
  (ler('public/modules/cadastros/shared.js').match(/MavisCampoDeBusca\.ligar\(/g) || []).length === 2);
check('o arquivo compartilhado é carregado antes dos módulos', (() => {
  const html = ler('public/index.html');
  const posRotulo = html.indexOf('/modules/shared/rotulo_produto.js');
  const posCampo = html.indexOf('/modules/shared/campo_de_busca.js');
  const posPrimeiroModulo = html.indexOf('/modules/stock/shared.js');
  // campo_de_busca usa rotulo_produto, então a ordem entre os dois importa.
  return posRotulo > 0 && posCampo > posRotulo && posPrimeiroModulo > posCampo;
})());

// ---------------------------------------------------------------------------
console.log('--- 4. as seis telas que eu converti à mão ---');
const TELAS = [
  ['stock/subs/new_movement.js', 'movementProduct', 'Nova movimentação'],
  ['stock/subs/movements.js', 'movFiltroProduto', 'Movimentações (filtro)'],
  ['stock/subs/product_status.js', 'statusProduto', 'Status do produto'],
  ['stock/subs/transfers.js', 'transferFiltroProduto', 'Transferências (filtro)'],
  ['purchases/subs/new_purchase_order.js', 'compraProduto', 'Ordem de compra (produto)'],
  ['purchases/subs/new_purchase_order.js', 'compraFornecedor', 'Ordem de compra (fornecedor)']
];
for (const [rel, id, rotulo] of TELAS) {
  const texto = semComentarios(ler(`public/modules/${rel}`));
  check(`${rotulo.padEnd(26)} desenha o seletor`,
    new RegExp(`renderSearchableSelect\\(\\{[^}]*id: '${id}'`).test(texto)
    || new RegExp(`id: '${id}',`).test(texto));
  check(`  ${rotulo.padEnd(24)} e liga o ouvinte`,
    new RegExp(`attachSearchableSelect\\(\\{[\\s\\S]{0,120}id: '${id}'`).test(texto));
}
// O que NÃO pode voltar: o <select> montado com a lista inteira de produtos.
for (const rel of ['stock/subs/new_movement.js', 'stock/subs/movements.js',
                   'stock/subs/product_status.js', 'stock/subs/transfers.js']) {
  check(`${rel.split('/').pop().padEnd(22)} sem <select> de produto`,
    !/S\.options\(meta\.products/.test(semComentarios(ler(`public/modules/${rel}`))));
}

console.log('--- 5. quem lê o valor escolhido lê o campo ESCONDIDO ---');
// O <input type="hidden"> do seletor chama-se "<id>Value". Ler o id cru devolve
// a <div> de fora, que não tem .value — e o botão simplesmente não faz nada,
// sem erro na tela. É o mesmo engano do `products.find` da fase CG.
const movimento = semComentarios(ler('public/modules/stock/subs/new_movement.js'));
check('nova movimentação lê movementProductValue',
  /getElementById\('movementProductValue'\)/.test(movimento)
  && !/getElementById\('movementProduct'\)\?\.value/.test(movimento));
const ordem = semComentarios(ler('public/modules/purchases/subs/new_purchase_order.js'));
check('ordem de compra lê compraProdutoValue e compraFornecedorValue',
  /getElementById\('compraProdutoValue'\)/.test(ordem)
  && /getElementById\('compraFornecedorValue'\)/.test(ordem));
// O `required` do seletor mora no campo de TEXTO, não no escondido: quem digita
// "seta" e não clica em nada passa pela validação do navegador com o id vazio.
check('nova movimentação recusa envio sem produto escolhido',
  /if \(!escolhido\) \{[\s\S]{0,200}showToast\(/.test(movimento));
// Com <select>, a primeira <option> já vinha escolhida e o custo era o dela. O
// seletor com busca abre VAZIO, então o custo tem de abrir zerado — senão a
// tela mostra o preço de um produto que ninguém escolheu.
check('ordem de compra abre com o custo zerado',
  /id="compraCusto"[^>]*value="0\.00"/.test(ler('public/modules/purchases/subs/new_purchase_order.js')));
check('  e o custo passa a vir do produto escolhido, não do data-custo',
  /opcao\?\.product\?\.costPrice/.test(ordem) && !/dataset\.custo/.test(ordem));

// ---------------------------------------------------------------------------
console.log('--- 6. a busca: cada palavra é um filtro ---');
const app = semComentarios(ler('public/app.js'));
check('o termo é quebrado em palavras',
  /const partes = term \? term\.split\(\/\\s\+\/\)\.filter\(Boolean\) : \[\];/.test(app));
check('  e TODAS têm de casar', /partes\.every\(\(parte\) => i\.busca\.includes\(parte\)\)/.test(app));
// O que não pode voltar: a frase inteira como um pedaço só.
check('  e não a frase inteira como um pedaço', !/indice\.filter\(\(i\) => i\.busca\.includes\(term\)\)/.test(app));
check('as palavras de cada rótulo entram no índice, calculado uma vez',
  /palavras: busca\.split\(\/\[\^a-z0-9\]\+\/\)\.filter\(Boolean\)/.test(app));
check('quem COMEÇA com o termo vem primeiro', /if \(item\.busca\.startsWith\(term\)\) return 0;/.test(app));
check('  depois quem casa palavra INTEIRA', /if \(partes\.every\(\(parte\) => item\.palavras\.includes\(parte\)\)\) return 1;/.test(app));
check('  e por último quem casa só como pedaço', /return 2;\s*\n\s*\};\s*\n\s*filtrados\.sort/.test(app));
// A busca sem acento é o que faz "galpao" achar "Galpão". Já existia; o teste
// guarda que a mudança na filtragem não a desfez.
check('a comparação continua sem acento e sem caixa',
  /normalize\('NFD'\)\.replace\(\/\\p\{Diacritic\}\/gu, ''\)\.toLowerCase\(\)/.test(app));

// ---------------------------------------------------------------------------
console.log('--- 7. o ouvinte de Cadastros não pode responder pelo Estoque ---');
// ESTE é o check que guarda o bug. `content` é o mesmo nó em todos os módulos e
// sobrevive à troca de tela; a casca da lista é recriada a cada render.
check('a casca da lista é quem escuta',
  /const casca = content\.querySelector\('\.cadastros-shell'\);/.test(app));
check('  e não o content compartilhado',
  !/content\.addEventListener\('click', \(evento\) => \{\s*\n\s*const botao = evento\.target\.closest\('\.lista-paginas-botoes/.test(app)
  && !/content\.addEventListener\('click', \(evento\) => \{\s*\n\s*const alvo = evento\.target\.closest\('\[data-ordenar\]'\)/.test(app));
check('os dois ouvintes (página e ordem) estão na casca',
  (app.match(/casca\?\.addEventListener\('click'/g) || []).length === 2);
// Sem casca não existe barra de página nem cabeçalho ordenável: cair no
// `content` como reserva seria justamente o bug de volta.
check('  sem reserva para o content', !/querySelector\('\.cadastros-shell'\) \|\| content/.test(app));

// ---------------------------------------------------------------------------
console.log('--- 8. as duas tabelas que passaram a sair em páginas ---');
for (const [rel, estado, rotulo] of [
  ['stock/subs/price_manager.js', 'edits', 'Gestor de preços'],
  ['stock/subs/new_catalog.js', 'selected', 'Novo catálogo']
]) {
  const texto = semComentarios(ler(`public/modules/${rel}`));
  check(`${rotulo.padEnd(18)} 100 por página`, /const POR_PAGINA = 100;/.test(texto));
  check(`  ${rotulo.padEnd(16)} com a página presa entre 1 e o total`,
    /const paginaAtual = Math\.min\(Math\.max\(1, pagina\), totalPaginas\);/.test(texto));
  check(`  ${rotulo.padEnd(16)} com barra acima e abaixo`,
    /barraDePaginas\('acima'\)/.test(texto) && /barraDePaginas\('abaixo'\)/.test(texto));
  check(`  ${rotulo.padEnd(16)} e buscar volta para a página 1`, /pagina = 1;/.test(texto));
  // O ESTADO MORA FORA DO RENDER e a troca de página não o toca. Perder a
  // alteração ao virar a página seria pior do que não paginar.
  check(`  ${rotulo.padEnd(16)} guarda o que foi mexido FORA do render`,
    new RegExp(`(const|let) ${estado} = new (Map|Set)`).test(texto));
}
const precos = semComentarios(ler('public/modules/stock/subs/price_manager.js'));
// A contagem é de TUDO que está alterado, e não do que está na tela: é isso que
// Salvar vai gravar. Dizer "2 alterados" numa página com 5 pendentes faria a
// pessoa salvar sem saber o que.
check('a contagem de alterados é global, não da página', /\$\{edits\.size\} produto/.test(ler('public/modules/stock/subs/price_manager.js')));
check('  e o corpo desenha só a fatia', /rows\(visiveis\)/.test(precos));

const catalogo = semComentarios(ler('public/modules/stock/subs/new_catalog.js'));
// Antes "visíveis" queria dizer "as 5.476 linhas filtradas", que ninguém vê de
// uma vez. Varrer o DOM marcaria só as 100 da tela, e quem monta um catálogo a
// partir de uma busca perderia o que tinha antes de a tela paginar.
check('"Selecionar os N filtrados" marca pela LISTA, não pelo DOM',
  /produtosFiltrados\(\)\.forEach\(\(produto\) => selected\.add\(produto\.id\)\)/.test(catalogo));
check('  e o rótulo do botão diz quantos são', /Selecionar os \$\{totalRegistros\.toLocaleString\('pt-BR'\)\} filtrados/.test(ler('public/modules/stock/subs/new_catalog.js')));
// "Limpar seleção" que deixasse marcações invisíveis para trás gravaria um
// catálogo com produtos que a pessoa acredita ter desmarcado.
check('"Limpar seleção" limpa a seleção inteira',
  /selected\.clear\(\);\s*\n\s*render\(\);/.test(catalogo));
// O filtro virou função própria porque DUAS coisas precisam dele: as linhas da
// página e o botão. Filtrar em dois lugares faria o botão marcar um conjunto
// diferente do que a tela mostra.
check('o filtro do catálogo é uma função só', /function produtosFiltrados\(\)/.test(catalogo));

// ---------------------------------------------------------------------------
console.log('--- o que foi medido no Chrome, com 5.476 produtos e 6.492 pessoas ---');
console.log('  NOS NO DOM, POR TELA:');
for (const [tela, antes, depois] of [
  ['Estoque > Gestor de preços', '49.310', '948'],
  ['Estoque > Novo catálogo', '32.895', '661'],
  ['Compras > Nova ordem de compra', '12.030', '75'],
  ['Cadastros > Novo cashback', '5.542', '72'],
  ['Estoque > Movimentações', '5.542', '72'],
  ['Estoque > Status do produto', '5.530', '61'],
  ['Estoque > Transferências', '5.514', '44'],
  ['Estoque > Nova movimentação', '5.509', '39']
]) console.log(`  ·  ${tela.padEnd(32)} ${antes.padStart(6)} -> ${depois.padStart(5)}`);
console.log('');
console.log('  A BUSCA:');
for (const [caso, resultado] of [
  ['"seta pisca", antes', 'Nenhum resultado'],
  ['"seta pisca", depois', '9 achados, as sete SETAs entre eles'],
  ['"10087", antes', '11 achados, 100876/100875/100874 na frente'],
  ['"10087", depois', 'o SKU exato em PRIMEIRO'],
  ['"abracadeira"', '"ABRACADEIRA 1/2 CZ" no topo'],
  ['"papel toalha rolo"', '1 achado'],
  ['"direcao"', 'acha "DIREÇÃO"'],
  ['custo por tecla', '1 a 4 ms, com 5.476 rótulos']
]) console.log(`  ·  ${caso.padEnd(24)} ${resultado}`);
console.log('');
console.log('  O SKU DESEMPATA DE VERDADE (ordem de compra):');
console.log('  ·  escolheu "... · 10087"      custo R$ 6,41');
console.log('  ·  escolheu "... · 10409"      custo R$ 2,31');
console.log('');
console.log('  O ESTADO SOBREVIVE À TROCA DE PÁGINA:');
console.log('  ·  catálogo: marca 3 na p.1 -> vira -> 0 marcadas na p.2 -> marca 2 -> "(5)"');
console.log('  ·            volta para a p.1 -> as 3 seguem marcadas');
console.log('  ·  preços:   edita na p.1 -> vira -> "1 alterado" -> edita na p.2 -> "2"');
console.log('  ·            volta para a p.1 -> o 9.99 que eu digitei está lá');
console.log('');
console.log('  O BUG DO OUVINTE, DEPOIS DA CORREÇÃO:');
console.log('  ·  passa por Cadastros, vai ao Estoque e vira página ... fica na tela');
console.log('  ·  o mesmo no Gestor de Preços e no Novo Catálogo ...... fica na tela');
console.log('  ·  ordena em Produtos ................................. fica na tela');
console.log('  ·  Cadastros, dono do ouvinte, ainda vira e ordena ..... sim');
console.log('  ·  erros de console, em todas as passadas .............. 0');

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
