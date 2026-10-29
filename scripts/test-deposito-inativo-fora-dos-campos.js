// DEPÓSITO INATIVO FORA DOS CAMPOS (29/10/2026).
//
// Pedido do usuário, com o print da lista de Depósitos ("DEPOSITO INATIVO",
// DEP-0011, inativo): "quero que quando um depósito estiver em inativo ele não
// apareça para seleção dentre campos". Todo campo de depósito oferece só os
// ativos — e o que o registro já tem, mesmo inativo, para a edição não trocar
// nem apagar o depósito gravado. Provado no navegador (porta 3099) nas 11 telas
// abaixo, com o "Depósito Matriz - Montados" (inativo) do banco local.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- a regra (public/app.js) ---');
const app = ler('public/app.js');
const ini = app.indexOf('function depositosParaEscolha(');
// eslint-disable-next-line no-new-func
const depositosParaEscolha = new Function(`${app.slice(ini, app.indexOf('\n}\n', ini) + 2)}; return depositosParaEscolha;`)();
const lista = [{ id: 'a', status: 'ativo' }, { id: 'i', status: 'inativo' }, { id: 'I', status: 'INATIVO' }, { id: 's' }];
const ids = (l) => l.map((d) => d.id).join(',');
check('só os ativos (sem situação conta como ativo)', ids(depositosParaEscolha(lista)) === 'a,s', ids(depositosParaEscolha(lista)));
check('  e o que o registro já tem, mesmo inativo', ids(depositosParaEscolha(lista, 'i')) === 'a,i,s');
check('  lista ausente não quebra', depositosParaEscolha(undefined).length === 0);

console.log('\n--- os campos ---');
const usa = (arquivo, trecho) => ler(arquivo).includes(trecho);
const CAMPOS = [
  ['Estoque › Nova movimentação', 'public/modules/stock/subs/new_movement.js', "S.options(depositosParaEscolha(meta.deposits), '', { empty: 'Selecione' })"],
  ['Estoque › Nova transferência (origem)', 'public/modules/stock/subs/new_transfer.js', 'id="transferOrigem" required>${S.options(depositosParaEscolha(meta.deposits)'],
  ['Estoque › Nova transferência (destino)', 'public/modules/stock/subs/new_transfer.js', '<select name="destinationDepositId" required>${S.options(depositosParaEscolha(meta.deposits)'],
  ['Estoque › Nova contagem', 'public/modules/stock/subs/new_count.js', "S.options(depositosParaEscolha(meta.deposits), '', { empty: 'Selecione' })"],
  ['Estoque › Produto (novo)', 'public/modules/stock/subs/new_product.js', "S.options(depositosParaEscolha(meta.deposits), '', { empty: 'Nenhum' })"],
  ['Estoque › Produto (edição mantém o gravado)', 'public/modules/stock/subs/new_product.js', 'S.options(depositosParaEscolha(meta.deposits, current.defaultDepositId), current.defaultDepositId'],
  ['Estoque › filtro de Movimentações', 'public/modules/stock/subs/movements.js', 'S.options(depositosParaEscolha(meta.deposits, filters.depositId), filters.depositId'],
  ['Estoque › filtro de Contagens', 'public/modules/stock/subs/counts.js', 'S.options(depositosParaEscolha(meta.deposits, filters.depositId), filters.depositId'],
  ['Estoque › filtro de Produtos', 'public/modules/stock/subs/products.js', 'S.options(depositosParaEscolha(meta.deposits, filters.depositId), filters.depositId'],
  ['Estoque › filtro de Transferências', 'public/modules/stock/subs/transfers.js', 'S.options(depositosParaEscolha(meta.deposits, filters.depositId), filters.depositId'],
  ['Compras › Entrada manual', 'public/modules/purchases/subs/entrada_nfe_manual.js', '${depositosParaEscolha(data.deposits, nota.depositoId).map('],
  ['Compras › Pedido de compra', 'public/modules/purchases/subs/new_purchase_order.js', '${depositosParaEscolha(data.deposits, documento.depositId).map('],
  ['Cadastros › Equipamento', 'public/modules/cadastros/subs/novo_equipamento.js', "options: (meta, atual) => (meta.deposits || []).filter((d) => String(d.status || 'ativo').toLowerCase() !== 'inativo' || (atual && d.id === atual)) }"]
];
CAMPOS.forEach(([nome, arquivo, trecho]) => check(nome, usa(arquivo, trecho)));
check('  o campo do cadastro passa o valor gravado às opções', usa('public/modules/cadastros/shared.js', 'const list = busca.lista(def, meta, val);')
  && usa('public/modules/shared/campo_de_busca.js', "return typeof def.options === 'function' ? def.options(meta, atual) : (def.options || []);"));
check('Vendas › pedido (já era assim desde a fase ER)', /String\(d\.status \|\| 'ativo'\)\.toLowerCase\(\) !== 'inativo' \|\| d\.id === atual/.test(app));
check('nenhum campo de depósito do Estoque lê a lista inteira', !/S\.options\(meta\.deposits,/.test(
  ['new_movement', 'new_transfer', 'new_count', 'new_product', 'movements', 'counts', 'products', 'transfers'].map((s) => ler(`public/modules/stock/subs/${s}.js`)).join('\n')));

console.log('\n--- o servidor ---');
const servidor = ler('server.js');
check('Entrada de NF-e pelo XML: só os ativos', /depositos: \(data\.deposits \|\| \[\]\)\s*\.filter\(\(d\) => String\(d\.status \|\| 'ativo'\)\.toLowerCase\(\) !== 'inativo'\)/.test(servidor));
check('filtro dos Relatórios: só os ativos', servidor.includes(`consultarBanco("select id, name from deposits where coalesce(status, 'ativo') <> 'inativo' order by name")`));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
