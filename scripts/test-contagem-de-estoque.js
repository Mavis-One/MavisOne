// A CONTAGEM DE ESTOQUE — sem banco e sem servidor.
//
// O QUE ESTA FASE RESOLVEU, medido no banco em 23/09/2026:
//
//     5.475 produtos cadastrados
//         0 depósitos
//         0 movimentos de estoque
//         0 unidades somando o catálogo inteiro
//
// O sistema sabia movimentar estoque (venda, compra, transferência, produção,
// nota de entrada) e não sabia COMEÇAR a ter estoque: saldo inicial só existia
// na CRIAÇÃO do produto — `if (!existing && initialQuantity > 0)` —, e para os
// 5.475 já importados esse `if` nunca é verdadeiro.
//
// A tela atende os DOIS pedidos do raio-X porque eles são o mesmo mecanismo:
//   VM-EST-08 (P0) carga do estoque inicial  = contagem contra saldo zero
//   VM-EST-04 (P1) inventário cíclico        = contagem contra o saldo atual
//
// O QUE ESTE TESTE PROTEGE (e por que cada coisa)
// -----------------------------------------------
// 1. O AJUSTE É `contado − saldo`. Se alguém trocar por "somar o contado", a
//    contagem vira entrada e recontar o mesmo galpão DOBRA o estoque. É o erro
//    mais fácil de cometer e o mais caro: aparece como sobra de inventário.
// 2. O FECHAMENTO PASSA POR commitStockMovements. É lá que moram a travagem dos
//    produtos em ordem fixa (contra deadlock), a numeração pela sequence e a
//    soma transacional do total. Um INSERT próprio funcionaria hoje e perderia
//    toda guarda que alguém acrescentar lá amanhã.
// 3. A CONFERÊNCIA É DO RESULTADO, não do ponto de partida. O gancho
//    `tambemNaTransacao` roda DEPOIS de os movimentos entrarem — a primeira
//    versão deste código comparava contra o saldo ANTERIOR e teria falhado
//    sempre, porque o saldo lido já é o ajustado.
// 4. ZERO É UMA CONTAGEM VÁLIDA. Um campo que só aceita > 0 não registra perda
//    total, que é o que a contagem existe para achar.
// 5. O CUSTO DO AJUSTE É O DO PRODUTO, não 0. Os movimentos automáticos do
//    sistema gravam unitCost 0 e para uma venda tanto faz; na carga inicial é o
//    movimento que dá entrada no acervo inteiro, e com 0 o Painel de Estoque
//    diria "R$ 0,00 parado" com o galpão cheio.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
function check(titulo, condicao, detalhe) {
  console.log(`  ${condicao ? 'OK  ' : 'XX  '} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!condicao) falhas++;
}

const MIGRACAO = 'banco/migrations/fase-cu-contagem-de-estoque.sql';
const sql = ler(MIGRACAO);
const sqlSemComentario = sql.replace(/--.*$/gm, '');
const dbModulo = ler('lib/db/contagem-estoque.js');
const servidor = semComentarios(ler('server.js'));
const telaLista = ler('public/modules/stock/subs/counts.js');
const telaFolha = ler('public/modules/stock/subs/new_count.js');
const app = ler('public/app.js');
const html = ler('public/index.html');

// ---------------------------------------------------------------------------
console.log('--- 1. a migração ---');
check('cria stock_counts', /create table if not exists stock_counts/.test(sqlSemComentario));
check('cria stock_count_items', /create table if not exists stock_count_items/.test(sqlSemComentario));
check('e a sequence do código', /create sequence if not exists stock_counts_code_seq/.test(sqlSemComentario));

check('depósito é OBRIGATÓRIO na contagem',
  /deposit_id text not null check \(btrim\(deposit_id\) <> ''\)/.test(sqlSemComentario),
  'conta-se um LUGAR; o balde "nao alocado" nao e um lugar');
check('status é fechado em três valores',
  /check \(status in \('aberta', 'fechada', 'cancelada'\)\)/.test(sqlSemComentario));

// ZERO É PERMITIDO. `> 0` aqui seria o defeito: a contagem que encontra a perda
// total é justamente a que lê zero na prateleira.
check('counted_quantity aceita ZERO', /counted_quantity numeric\(18, 4\) not null check \(counted_quantity >= 0\)/.test(sqlSemComentario),
  '>= 0, nao > 0');
check('e não aceita negativo', !/counted_quantity[^;]*check \(counted_quantity > 0\)/.test(sqlSemComentario));

check('o item tem FK para a contagem, com cascade',
  /count_id text not null references stock_counts \(id\) on delete cascade/.test(sqlSemComentario),
  'o item e PARTE do documento; o historico do ajuste mora em stock_movements');

check('o mesmo produto/cor não entra duas vezes',
  /create unique index if not exists idx_count_items_unico\s+on stock_count_items \(count_id, product_id, class_value_id\)/.test(sqlSemComentario),
  'recontar ATUALIZA; duas linhas aplicariam dois ajustes');

check('expected_quantity existe e é gravado',
  /expected_quantity numeric\(18, 4\) not null default 0/.test(sqlSemComentario),
  'sem ele a divergencia desaparece depois do fechamento');
check('e o `adjustment` também', /adjustment numeric\(18, 4\) not null default 0/.test(sqlSemComentario));

console.log('\n--- 2. RLS nas duas tabelas (o test-rls cobra, este explica) ---');
check('stock_counts', /alter table if exists stock_counts enable row level security/.test(sqlSemComentario));
check('stock_count_items', /alter table if exists stock_count_items enable row level security/.test(sqlSemComentario));

console.log('\n--- 3. a migração explica as decisões ---');
check('diz que os dois VM são o mesmo documento',
  /VM-EST-08/.test(sql) && /VM-EST-04/.test(sql));
check('explica por que não há delete', /cancelada.*EXISTE E.*delete.*NÃO|POR QUE `cancelada`/s.test(sql));
check('e prova que nenhum saldo pode ficar negativo',
  /POR CONSTRUÇÃO/.test(sql) && /INVARIANTE/.test(sql));

// ---------------------------------------------------------------------------
console.log('\n--- 4. o módulo de banco não abre transação por conta própria ---');
// As funções de fechamento recebem o `cliente` de quem chamou. Se uma delas
// abrisse a sua, o fechamento aconteceria FORA da transação dos movimentos — e
// um processo morto no meio deixaria o ajuste aplicado numa contagem que
// continua se oferecendo para ser fechada, dobrando o saldo no segundo clique.
for (const fn of ['travarParaFechar', 'atualizarFechamento', 'marcarItensFechados', 'saldosDoDeposito']) {
  const corpo = dbModulo.slice(dbModulo.indexOf(`function ${fn}(`));
  const assinatura = corpo.slice(0, corpo.indexOf(')') + 1);
  check(`${fn} recebe o cliente da transação`, /\(cliente/.test(assinatura), assinatura.trim());
}
check('e nenhuma delas chama emTransacao', !/emTransacao/.test(dbModulo));

check('saldosDoDeposito é UMA consulta, não uma por par',
  /product_id = any\(\$2\)/.test(dbModulo) && /group by product_id, class_value_id/.test(dbModulo),
  'milhares de idas ao banco com a trava na mao seriam milhares de latencias');

check('recontar é um upsert', /on conflict \(count_id, product_id, class_value_id\) do update set/.test(dbModulo));
check('e regrava o expected_quantity', /expected_quantity = excluded\.expected_quantity/.test(dbModulo),
  'ao recontar, a divergencia e contra o saldo de AGORA');

check('a listagem agrega no banco', /left join lateral/.test(dbModulo));
check('e "divergente" é contado <> esperado',
  /counted_quantity <> i\.expected_quantity/.test(dbModulo),
  'e nao `adjustment <> 0`, que so existe depois do fechamento');

check('cancelar só alcança contagem aberta',
  /set status = 'cancelada'[\s\S]{0,120}where id = \$1 and status = 'aberta'/.test(dbModulo));

// ---------------------------------------------------------------------------
console.log('\n--- 5. as rotas ---');
const ROTAS = [
  ["pathname === '/api/stock/counts' && req.method === 'GET'", 'listar'],
  ["pathname === '/api/stock/counts' && req.method === 'POST'", 'abrir'],
  ['/^\\/api\\/stock\\/counts\\/[^/]+$/.test(pathname)', 'ler uma'],
  ['/^\\/api\\/stock\\/counts\\/[^/]+\\/items$/.test(pathname)', 'contar item'],
  ['/^\\/api\\/stock\\/counts\\/[^/]+\\/items\\/[^/]+$/.test(pathname)', 'remover item'],
  ['/^\\/api\\/stock\\/counts\\/[^/]+\\/close$/.test(pathname)', 'fechar'],
  ['/^\\/api\\/stock\\/counts\\/[^/]+\\/cancel$/.test(pathname)', 'cancelar']
];
for (const [agulha, nome] of ROTAS) {
  check(`rota de ${nome}`, servidor.includes(agulha), agulha.slice(0, 48));
}

// Toda rota do módulo é fechada por permissão. Uma rota nova sem a guarda é
// aberta a qualquer usuário autenticado, incluindo quem não tem Estoque.
const inicioContagem = servidor.indexOf("pathname === '/api/stock/counts' && req.method === 'GET'");
const fimContagem = servidor.indexOf("pathname === '/api/stock/price-manager'");
const blocoContagem = servidor.slice(inicioContagem, fimContagem);
const guardas = (blocoContagem.match(/if \(!userCanStock\(user\)\) return sendJson/g) || []).length;
check('as 7 rotas checam userCanStock', guardas === 7, `${guardas} guarda(s)`);

console.log('\n--- 6. o ajuste é `contado − saldo` ---');
check('a subtração está escrita assim',
  /const delta = item\.countedQuantity - saldo;/.test(blocoContagem),
  'somar o contado dobraria o estoque a cada recontagem');
check('delta > 0 é entrada e delta < 0 é saída',
  /type: delta > 0 \? 'entrada' : 'saida'/.test(blocoContagem));
check('a quantidade do movimento é o módulo do delta',
  /quantity: Math\.abs\(delta\)/.test(blocoContagem));
check('delta zero NÃO gera movimento',
  /if \(delta === 0\) \{[\s\S]{0,140}continue;/.test(blocoContagem),
  'um razao com 5.475 linhas de "ajuste de 0" seria ilegivel');

console.log('\n--- 7. o custo do ajuste é o do produto ---');
check('unitCost vem de product.costPrice',
  /unitCost: stockCore\.toNumber\(product\.costPrice\)/.test(blocoContagem),
  'com 0, a carga inicial nasceria com valor de estoque zerado');
check('origin é "contagem"', /origin: 'contagem'/.test(blocoContagem));
check('e o movimento aponta para a folha',
  /referenceType: 'stock_count'/.test(blocoContagem) && /referenceId: contagem\.id/.test(blocoContagem));

console.log('\n--- 8. o fechamento passa pelo ponto único ---');
check('chama commitStockMovements', /await commitStockMovements\(data, movimentos, productsById, \{/.test(blocoContagem));
check('e grava o fechamento no MESMO instante', /tambemNaTransacao: async \(cliente\) =>/.test(blocoContagem));
check('travando a folha antes', /contagemDb\.travarParaFechar\(cliente, id\)/.test(blocoContagem),
  'dois cliques em Fechar aplicariam o ajuste em dobro');
check('e recusando se ela já não está aberta',
  /travada\.status !== 'aberta'/.test(blocoContagem));
check('não há INSERT direto no razão nesta rota',
  !/inserirMovimentos/.test(blocoContagem),
  'quem grava saldo continua com um dono so');

// O PONTO QUE JÁ ERROU UMA VEZ. `tambemNaTransacao` roda DEPOIS de
// inserirMovimentos + somarNoTotalDoProduto, então o saldo lido no gancho já é
// o ajustado. A primeira versão comparava contra o saldo anterior e falharia
// em todo fechamento. A comparação certa é com o CONTADO.
console.log('\n--- 9. a conferência é do RESULTADO ---');
check('compara o saldo lido com o CONTADO',
  /Math\.abs\(resultado - item\.countedQuantity\) > 0\.00005/.test(blocoContagem),
  'o gancho roda DEPOIS dos movimentos: o saldo lido ja e o ajustado');
check('e usa epsilon, não !==',
  !/resultado !== item\.countedQuantity/.test(blocoContagem),
  'a aritmetica do delta acontece em JS, onde 0,1 + 0,2 nao e 0,3');
check('a mensagem manda recarregar', /Recarregue a contagem e feche de novo/.test(blocoContagem));

console.log('\n--- 10. as recusas que evitam saldo errado ---');
check('uma contagem aberta por depósito',
  /abertasNoDeposito\(depositId\)/.test(blocoContagem) && /Já existe uma contagem aberta em/.test(blocoContagem),
  'duas folhas abertas no mesmo galpao ajustam contra o mesmo saldo esperado');
check('zero é aceito explicitamente',
  /zero é uma contagem válida/.test(blocoContagem));
check('mas vazio é recusado antes de virar número',
  /countedRaw === ''[\s\S]{0,90}return sendJson/.test(blocoContagem),
  'toNumber com default transformaria erro de digitacao em baixa de estoque');
check('negativo é recusado', /counted < 0/.test(blocoContagem));
check('contar inteiro E por cor é recusado',
  /conflitaComOutraForma\(id, productId, Boolean\(classValueId\)\)/.test(blocoContagem));
check('folha fechada não aceita item',
  /não aceita mais itens/.test(blocoContagem));
check('e não fecha sem nenhum item',
  /não tem nenhum item/.test(blocoContagem));
check('produto excluído impede o fechamento e é nomeado',
  /semProduto\.length/.test(blocoContagem) && /não existem mais no cadastro/.test(blocoContagem));

console.log('\n--- 11. a guarda de exclusão de depósito viu a contagem ---');
const guardaDeposito = servidor.slice(servidor.indexOf('async function depositoEmUso'));
const corpoGuarda = guardaDeposito.slice(0, guardaDeposito.indexOf('\n}'));
check('depositoEmUso conta as contagens',
  /contagemDb\.contarPorDeposito\(id\)/.test(corpoGuarda),
  'a fechada ja era pega pelas movimentacoes; a ABERTA nao gerou nada');
// Os dois trechos separados, e não a frase inteira: a mensagem é montada num
// template literal com `${contagens}` no meio, e uma regex de frase corrida não
// atravessa a interpolação. Foi assim que este check falhou na primeira versão,
// com a mensagem já certa no código.
check('e diz isso ao usuário',
  /'Existe 1 contagem'/.test(corpoGuarda) && /de estoque neste depósito/.test(corpoGuarda));
check('no singular e no plural', /contagens\b/.test(corpoGuarda) && /Existe 1 contagem/.test(corpoGuarda));

console.log('\n--- 12. o ajuste não aparece como "Manual" ---');
const movimentos = semComentarios(ler('public/modules/stock/subs/movements.js'));
check('a lista de origens conhece "contagem"', /contagem: \['Contagem'/.test(movimentos),
  'rotulo errado manda procurar quem "lancou na mao" o que o sistema gerou');

console.log('\n--- 13. as telas ---');
check('counts está registrada', /MavisSubscreenRegistry\.stock\.counts = /.test(telaLista));
check('new_count está registrada', /MavisSubscreenRegistry\.stock\.new_count = /.test(telaFolha));
check('as duas entraram no index.html',
  html.includes('stock/subs/counts.js') && html.includes('stock/subs/new_count.js'));
check('depois do shared.js, que define MavisStock',
  html.indexOf('stock/shared.js') < html.indexOf('stock/subs/counts.js'),
  'a fabrica e chamada no topo do arquivo, quando o <script> carrega');
check('e as duas no menu',
  /key: 'counts', label: 'Contagens de Estoque'/.test(app)
  && /key: 'new_count', label: 'Nova Contagem de Estoque'/.test(app));

const folhaSemComentario = semComentarios(telaFolha);
check('a folha é gravada item a item no servidor',
  /\/items`, \{\s*method: 'POST'/.test(folhaSemComentario),
  'montar no navegador perderia a contagem num F5 -- e do papel ela nao volta');
check('o campo de quantidade aceita zero', /min="0"/.test(folhaSemComentario));
check('e NÃO tem min de 0,001', !/name="countedQuantity"[^>]*min="0\.001"/.test(folhaSemComentario));
check('o cancelamento pede MOTIVO', /promptModal\(\{/.test(folhaSemComentario));
check('e não usa window.prompt', !/window\.prompt|[^.]\bprompt\(/.test(folhaSemComentario));
check('o seletor de produto usa onSelect (não onChange)',
  /onSelect: async \(valor\)/.test(folhaSemComentario) && !/onChange:/.test(folhaSemComentario),
  'onChange seria aceito em silencio e nunca chamado');

// A tela aberta compara com o saldo de AGORA; a fechada, com o saldo de quando
// se contou. Trocar isso faria a folha fechada provar que o sistema sempre
// esteve certo — o saldo passou a ser o contado.
check('a folha aberta compara com o saldo atual e a fechada com o da contagem',
  /aberta \? Number\(item\.saldoAtual \|\| 0\) : Number\(item\.expectedQuantity \|\| 0\)/.test(folhaSemComentario));

const listaSemComentario = semComentarios(telaLista);
check('a lista mede acuracidade só sobre as FECHADAS',
  /fechadas\.reduce/.test(listaSemComentario) && /itensFechados/.test(listaSemComentario),
  'incluir as abertas faria o numero oscilar enquanto alguem digita no galpao');
check('e avisa quando não há depósito cadastrado',
  /Nenhum depósito cadastrado/.test(telaLista));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
