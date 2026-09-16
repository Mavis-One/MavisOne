#!/usr/bin/env node
/**
 * O QUE A IMPORTAÇÃO DO HISTÓRICO DE VENDAS DEIXOU PARA TRÁS (fase CI).
 *
 * O arquivo do ViperERP gravou 14.942 documentos direto em orders/quotes:
 * 14.864 pedidos e 78 orçamentos, com 19.587 linhas de item, 19.585 delas
 * ligadas a produto pelo SKU. Ele fez o trabalho dele. Duas coisas ficaram.
 *
 * 1. A NUMERAÇÃO PASSOU A MENTIR
 * -----------------------------
 * `sales_code_seq` é a fonte do número do pedido, e nextval não sabe de nada
 * que entre na tabela sem passar por ela. Medido logo depois da importação:
 *
 *     sequence ..................... 1
 *     maior code em orders ......... 15.525
 *     maior code em quotes ......... 15.517
 *     nextval devolveria ........... 1
 *     e o pedido 1 existe .......... LUIS ANTONIO DOS SANTOS, 11/06/2024
 *
 * Não há unique em orders.code nem em quotes.code, então o banco aceitaria o
 * duplicado calado. É o mesmo estrago que a migração da fase BR descreveu com
 * todas as letras: "a lista mostrando dois documentos com o mesmo numero, a
 * busca por numero devolvendo dois, e o cliente recebendo duas notas que citam
 * 'Pedido 1042'".
 *
 * A migração da fase BR faz o setval — mas ela roda ANTES de qualquer
 * importação. Consertar só o banco de hoje deixaria o próximo arquivo de
 * histórico cair no mesmo buraco. Então a garantia foi para onde o número é
 * ENTREGUE: se o código que saiu da sequence já existe, ela salta para depois
 * do maior de orders e quotes e o número é tirado de novo.
 *
 * MEDIDO, chamando a função de verdade depois da importação:
 *     sequence antes ............... 1
 *     devolveu ..................... 2  (que já existe)
 *     saltou para .................. 15.525
 *     código entregue .............. 15.526
 *     a chamada seguinte ........... 15.527, sem reparo nenhum
 *
 * 2. A LISTA DE VENDAS MANDAVA A TABELA INTEIRA JUNTO
 * --------------------------------------------------
 * A rota pagina no servidor (15 por página) e, ao lado da página, mandava
 * `orders: data.orders` e `quotes: data.quotes` COMPLETOS. A tela usa os dois
 * para uma coisa só: o número dentro de quatro cartões de contagem.
 *
 *     antes:  29.426 KB   (orders 27.772 · meta 1.482 · quotes 137 · records 35)
 *     depois:  1.517 KB   (meta 1.482 · records 35)
 *
 * 99,9% do peso existia para a tela escrever "14.864" num cartão.
 *
 * O QUE EU NÃO CONSERTEI, E POR QUE
 * ---------------------------------
 * Sobrou o tempo: a resposta caiu 95% e o relógio quase não mudou — 6,2 s
 * antes, 5,5 s depois. Medido por peça:
 *
 *     as consultas ao Postgres ..... ~730 ms  (pessoas 264, pedidos 401, ...)
 *     o resto (~4,8 s) ............. serializar 14.942 registros e montar JSON
 *     memória por requisição ....... 37.256 KB para devolver 15 linhas
 *
 * Consertar isso é empurrar filtro, ordem e corte para o SQL — e a Busca
 * Avançada filtra por campos que só existem DEPOIS de serializar (o número da
 * NF-e, a transportadora, a data de faturamento moram dentro de grupos). O
 * próprio comentário da rota diz isso. É uma reescrita da lista de Vendas, não
 * um ajuste, e não é o que foi pedido — está medido e relatado, não começado.
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
console.log('--- 1. a numeração se conserta sozinha ---');
const vendasDb = semComentarios(ler('lib/db/vendas-compras.js'));

check('o número sai da sequence', /select nextval\('sales_code_seq'\)::int as code/.test(vendasDb));
// ESTE é o check que guarda o bug: sem a conferência, o número sai da sequence
// e vai embora sem ninguém perguntar se ele já está em uso.
check('  e é conferido contra as DUAS tabelas antes de sair',
  /from orders where code = \$1 union all select 1 from quotes where code = \$1/.test(vendasDb));
// Pedido e orçamento compartilham a numeração: o mesmo documento troca de tipo
// ao ser aprovado, e conferir só uma tabela deixaria metade do buraco aberto.
check('  em orders E em quotes, porque a numeração é compartilhada',
  /orders where code/.test(vendasDb) && /quotes where code/.test(vendasDb));
check('o reparo salta para depois do maior das duas',
  /setval\('sales_code_seq', greatest\(/.test(vendasDb)
  && /coalesce\(\(select max\(code\) from orders\), 0\)/.test(vendasDb)
  && /coalesce\(\(select max\(code\) from quotes\), 0\)/.test(vendasDb));
check('  e tira o número de novo depois de saltar',
  /\), true\) as ajustada, nextval\('sales_code_seq'\)::int as code/.test(vendasDb));
// Reparo silencioso esconderia que uma importação passou por fora. O log é o
// que permite descobrir isso lendo o console em vez de auditando a tabela.
check('o reparo deixa rastro no log', /sales_code_seq estava atras dos dados/.test(ler('lib/db/vendas-compras.js')));
// A queda para banco sem a migração da fase BR continua existindo: ela é o que
// permite gravar (com a janela antiga) em vez de não gravar nada.
check('a queda para banco sem a sequence continua lá',
  /sales_code_seq nao existe — rode banco\/migrations\/fase-br/.test(ler('lib/db/vendas-compras.js')));
// O comentário acima da função descrevia um contador no db.json e um max+1 —
// duas coisas que deixaram de existir há duas fases. Comentário errado é pior
// que comentário nenhum: é por ele que alguém começa a caçar um bug.
check('o comentário obsoleto da função foi corrigido',
  !/getNextSalesCode\(data\) hoje incrementa um contador no arquivo local/.test(ler('lib/db/vendas-compras.js')));

// ---------------------------------------------------------------------------
// O PISO DE 16000 (fase CG)
// ---------------------------------------------------------------------------
// A numeração própria começa em 16000: abaixo disso é o histórico importado
// (1 a 15.525). O perigo não é o piso em si — é a migração que o instala.
console.log('\n--- 1b. o piso de 16000 não pode rebaixar a numeração ---');
const migracaoCg = ler('banco/migrations/fase-cg-numeracao-de-venda-a-partir-de-16000.sql');
// Um `setval(..., 15999)` fixo, rodado num banco que já passou do 16.010,
// REEMITIRIA números já gravados — e não há unique em orders.code nem em
// quotes.code para barrar. Migração roda mais de uma vez por natureza.
check('o setval é embrulhado em greatest', /setval\(\s*\n?\s*'sales_code_seq',\s*\n?\s*greatest\(/.test(migracaoCg));
check('  considera onde a sequence já está', /select last_value from sales_code_seq/.test(migracaoCg));
check('  e o maior código das DUAS tabelas', /max\(code\) from orders/.test(migracaoCg) && /max\(code\) from quotes/.test(migracaoCg));
check('  com 15999 + is_called para o próximo ser 16000', /15999/.test(migracaoCg) && /\),\s*\n?\s*true\s*\n?\s*\);/.test(migracaoCg));

// A queda (banco sem a sequence) precisa dizer o MESMO que a sequence. Com o
// piso antigo de 1000 ela numeraria 15.526 e cruzaria a faixa do histórico.
const vendasSrc = ler('lib/db/vendas-compras.js');
check('a queda usa o mesmo piso, e não o 1000 de antes',
  /const PRIMEIRO_NUMERO_DE_VENDA = 16000;/.test(vendasSrc)
  && /PRIMEIRO_NUMERO_DE_VENDA - 1\)/.test(vendasSrc));
check('  e o 1000 saiu do Math.max', !/Number\(lastQuote\?\.code\) \|\| 0, 1000\)/.test(vendasSrc));

// ---------------------------------------------------------------------------
console.log('--- 2. a lista de vendas não manda a tabela inteira ---');
const servidor = semComentarios(ler('server.js'));
const rota = servidor.slice(servidor.indexOf("if (pathname === '/api/sales/records' && req.method === 'GET')"));
const viewOrdersQuotes = rota.slice(0, rota.indexOf("if (view === 'nfes')"));

check('a resposta manda CONTAGEM', /contagens: \{/.test(viewOrdersQuotes));
for (const campo of ['orders', 'quotes', 'nfes', 'importLogs']) {
  check(`  ${campo.padEnd(11)} como número`,
    new RegExp(`${campo}: \\(data\\.${campo} \\|\\| \\[\\]\\)\\.length`).test(viewOrdersQuotes));
}
// O que NÃO pode voltar: os quatro arrays ao lado de uma página de 15.
check('e NÃO manda mais as listas completas',
  !/^\s*orders: data\.orders,$/m.test(viewOrdersQuotes)
  && !/^\s*quotes: data\.quotes,$/m.test(viewOrdersQuotes));
// As outras views existem justamente para quem precisa da lista, e elas não
// podem ter sido levadas na mudança.
check('as outras views continuam entregando a lista',
  /if \(view === 'nfes'\) \{\s*\n\s*return sendJson\(res, \{ nfes: data\.nfes \}\);/.test(rota)
  && /if \(view === 'import_logs'\) \{\s*\n\s*return sendJson\(res, \{ importLogs: data\.importLogs \}\);/.test(rota));

console.log('--- 3. a tela lê a contagem ---');
const app = ler('public/app.js');
for (const [campo, rotulo] of [['orders', 'Pedidos'], ['quotes', 'Orçamentos'],
                               ['nfes', 'NF-e'], ['importLogs', 'Importações']]) {
  check(`  cartão ${rotulo.padEnd(11)} lê data.contagens.${campo}`,
    new RegExp(`label: '${rotulo}', value: contagemFormatada\\(data\\.contagens\\?\\.${campo}\\)`).test(app));
}
// O que NÃO pode voltar: ler .length de uma lista que não vem mais. Se voltasse,
// os quatro cartões mostrariam 0 sem nenhum erro na tela.
check('e nenhum cartão lê mais .length de lista que não vem',
  !/value: String\(data\.orders\?\.length \|\| 0\)/.test(app)
  && !/value: String\(data\.quotes\?\.length \|\| 0\)/.test(app));
// "14864" num cartão se conta dígito por dígito; "14.864" se lê de relance.
check('a contagem sai com separador de milhar',
  /function contagemFormatada\(valor\) \{/.test(app)
  && /return Number\(valor\)\.toLocaleString\('pt-BR'\);/.test(app));
// Mostrar "0" quando o campo não veio seria AFIRMAR que não há nenhum. O travessão
// diz "não sei", que é a verdade.
check('  e campo ausente vira travessão, não zero',
  /if \(valor === null \|\| valor === undefined\) return '—';/.test(app));

console.log('--- 4. o plural da tela de logs ---');
// Dizia "0 importaçãoões registradas": o sufixo era colado na palavra inteira
// em vez de substituir o "ão". Aparecia em toda visita à tela.
check('não diz mais "importaçãoões"',
  !/importação\$\{data\.importLogs\.length === 1 \? '' : 'ões'\}/.test(app));
check('  e o plural troca a terminação', /importa\$\{data\.importLogs\.length === 1 \? 'ção' : 'ções'\}/.test(app));

// ---------------------------------------------------------------------------
console.log('--- o que a importação trouxe, medido no banco ---');
for (const [caso, resultado] of [
  ['registros no arquivo', '14.942'],
  ['pedidos', '14.864'],
  ['orçamentos', '78'],
  ['linhas de item', '19.587'],
  ['  ligadas a produto pelo SKU', '19.585  (1 sem SKU no relatório)'],
  ['clientes vinculados', '11.544 de 14.864'],
  ['vendedores identificados', '4.745'],
  ['lançamentos financeiros criados', '0  — o histórico não vira conta a receber'],
  ['movimentações de estoque criadas', '0  — a mercadoria já saiu no Viper']
]) console.log(`  ·  ${caso.padEnd(32)} ${resultado}`);

console.log('');
console.log('  A NUMERAÇÃO, ANTES E DEPOIS:');
for (const [caso, resultado] of [
  ['sequence depois da importação', '1'],
  ['maior code em orders', '15.525'],
  ['nextval devolvia', '1 — e o pedido 1 existe'],
  ['depois do reparo, entregou', '15.526'],
  ['a chamada seguinte', '15.527, sem reparo']
]) console.log(`  ·  ${caso.padEnd(32)} ${resultado}`);

console.log('');
console.log('  A RESPOSTA DA LISTA DE VENDAS:');
for (const [caso, resultado] of [
  ['antes', '29.426 KB em 6.184 ms'],
  ['depois', '1.517 KB em 5.518 ms'],
  ['a página que a tela usa', '35 KB (15 registros de 14.942)'],
  ['os cartões, na tela', 'Pedidos 14.864 · Orçamentos 78'],
  ['erros de console', '0']
]) console.log(`  ·  ${caso.padEnd(32)} ${resultado}`);

// O que fica em aberto, dito com número em vez de adjetivo.
console.log('');
console.log('  !  O TEMPO NÃO FOI RESOLVIDO. A resposta caiu 95% e o relógio quase');
console.log('     não mudou: o custo é serializar 14.942 registros por requisição');
console.log('     (~4,8 s) sobre 37.256 KB carregados do Postgres para devolver 15');
console.log('     linhas. As consultas em si custam ~730 ms. Resolver é empurrar');
console.log('     filtro, ordem e corte para o SQL — mas a Busca Avançada filtra');
console.log('     por campos que só existem depois de serializar. É reescrever a');
console.log('     lista de Vendas, não ajustá-la. Medido e relatado, não começado.');

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
