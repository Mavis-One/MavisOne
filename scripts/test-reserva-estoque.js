#!/usr/bin/env node
// Reserva de estoque — a ponte entre "prometido" e "baixado".
//
// O BURACO QUE ESTE TESTE PROTEGE
// -------------------------------
// Estoque só se mexia no faturamento. Até lá o pedido não segurava nada: dois
// vendedores prometiam as mesmas 10 unidades, os dois pedidos salvavam sem uma
// palavra, e o segundo faturamento era recusado — depois de o cliente ter
// ouvido "sim". A tela até avisava "saldo insuficiente", mas comparava contra o
// saldo FÍSICO, que estava lá mesmo: fisicamente as 10 existiam, só já tinham
// dono.
//
// DERIVADA, NÃO GRAVADA
// ---------------------
// Não existe tabela de reservas, pelo mesmo motivo de não existir tabela de
// saldo por depósito nem por cor: seria um número atualizado por outro caminho,
// livre para discordar dos pedidos que ele resume. Um pedido cancelado direto
// no banco deixaria a reserva presa para sempre.
//
// Roda sem banco e sem rede.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) {
    console.log(`  OK  ${nome}`);
  } else {
    falhas += 1;
    console.log(`  XX  ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
};

const R = require(path.join(RAIZ, 'lib/reservas.js'));
const S = require(path.join(RAIZ, 'public/modules/shared/sales_status.js'));
const serverSrc = ler('server.js');
const appSrc = ler('public/app.js');

console.log('--- quem reserva, e por quê ---');
// A regra é derivada dos três campos que já definem cada status. Uma lista
// própria faria um status novo nascer sem reserva e ninguém notar.
check('pedido reserva', S.reservaEstoque('pedido'));
check('pedido não faturado reserva', S.reservaEstoque('pedido-nao-faturado'));
check('pedido pré-faturado reserva', S.reservaEstoque('pedido-pre-faturado'));
// Orçamento é proposta, não compromisso.
check('orçamento não reserva', !S.reservaEstoque('orcamento'));
check('nem orçamento aprovado', !S.reservaEstoque('orcamento-aprovado'));
// Quem já baixou virou movimento: o saldo já caiu, reservar seria contar duas vezes.
check('faturado não reserva', !S.reservaEstoque('pedido-faturado'));
check('aprovado sem faturamento não reserva', !S.reservaEstoque('pedido-aprovado-sem-faturamento'));
check('parcialmente faturado não reserva', !S.reservaEstoque('pedido-parcialmente-faturado'));
// Cancelado deixou de ser promessa.
check('cancelado não reserva', !S.reservaEstoque('pedido-cancelado'));
// Todo status que reserva é pedido, não baixou e não está cancelado — a regra
// vale para o catálogo inteiro, inclusive para status que vierem depois.
const coerente = S.CATALOGO.every((item) => S.reservaEstoque(item.value)
  === (item.tipo === 'order' && !item.baixaEstoque && !item.cancelado));
check('a regra vale para todo o catálogo', coerente);

console.log('\n--- a soma das reservas ---');
const pedidos = [
  { id: 'o1', code: 1, status: 'pedido', items: [{ productId: 'p1', quantity: 6, classValueId: 'preto' }] },
  { id: 'o2', code: 2, status: 'pedido-pre-faturado', items: [{ productId: 'p1', quantity: 2, classValueId: 'preto' }] },
  { id: 'o3', code: 3, status: 'pedido-faturado', items: [{ productId: 'p1', quantity: 5, classValueId: 'preto' }] },
  { id: 'o4', code: 4, status: 'pedido-cancelado', items: [{ productId: 'p1', quantity: 9, classValueId: 'preto' }] },
  { id: 'o5', code: 5, status: 'orcamento', items: [{ productId: 'p1', quantity: 7, classValueId: 'preto' }] },
  { id: 'o6', code: 6, status: 'pedido', items: [{ productId: 'p1', quantity: 3, classValueId: 'branco' }] }
];
const reservas = R.calcularReservas(pedidos);
check('soma só o que reserva', R.reservado(reservas, 'p1', 'preto') === 8);
// Cor diferente é reserva diferente: prometer preto não tira do branco.
check('a cor separa a reserva', R.reservado(reservas, 'p1', 'branco') === 3);
check('sem cor, soma o produto todo', R.reservado(reservas, 'p1') === 11);
check('produto sem pedido não reserva nada', R.reservado(reservas, 'p9') === 0);
// "8 reservados" sem dizer onde não dá o que fazer a quem precisa liberar.
check('dá para saber quem reservou', R.quemReservou(reservas, 'p1', 'preto').map((p) => p.code).join(',') === '1,2');

console.log('\n--- editar o próprio pedido não pode ser bloqueado por ele mesmo ---');
// Sem isto, subir de 6 para 7 compararia 7 contra um saldo do qual as 6 já
// tinham sido descontadas — o pedido travaria a própria edição.
const semO1 = R.calcularReservas(pedidos, { ignorarPedidoId: 'o1' });
check('a própria reserva sai da conta', R.reservado(semO1, 'p1', 'preto') === 2);
check('e a dos outros permanece', R.reservado(semO1, 'p1', 'branco') === 3);

console.log('\n--- disponível pode ser negativo, de propósito ---');
check('saldo 10, reservado 8 -> livre 2', R.disponivel(10, reservas, 'p1', 'preto') === 2);
// Promessa acima do saldo é um fato (baixa manual depois do pedido, ou pedido
// anterior à reserva existir). Cortar em zero esconderia o rombo de quem
// precisa vê-lo para resolver.
check('saldo 5, reservado 8 -> livre -3', R.disponivel(5, reservas, 'p1', 'preto') === -3);
check('sem reservas calculadas, devolve o saldo', R.disponivel(10, null, 'p1', 'preto') === 10);

console.log('\n--- entra nas telas que decidem ---');
// A venda comparava contra o saldo FÍSICO — era ali que a unidade era prometida
// duas vezes.
check('o alerta da venda mede o disponível', /const livre = disponivelDoItem\(item\);/.test(appSrc));
check('a coluna deixou de se chamar Saldo', /<th>Disponível<\/th>/.test(appSrc));
check('e mostra o físico junto quando há reserva', /de \$\{salesFormatQty\(saldo\)\}<\/span>/.test(appSrc));
check('o meta da venda manda as reservas', /reservas = Object\.fromEntries\(calculadas\.porChave\)/.test(serverSrc));
// Um pedido já faturado não está na conta de reservas; descontá-lo daria
// crédito duas vezes pela mesma mercadoria.
check('só desconta o próprio se o status salvo reservava', /editRecord && SalesStatus\.reservaEstoque\(editRecord\.status\)/.test(appSrc));
check('a lista de produtos mostra a reserva', /reservaDoProduto\(product\)/.test(ler('public/modules/stock/subs/products.js')));
check('a saída de estoque avisa', /deste produto estão reservados em pedidos abertos/.test(ler('public/modules/stock/subs/new_movement.js')));

console.log('\n--- null não é zero ---');
// Zero afirma "nada reservado"; null diz "não foi calculado". A rota que não
// paga a consulta não pode alegar o contrário para a tela.
const stockCore = require(path.join(RAIZ, 'lib/stock-core.js'));
const semReserva = stockCore.serializeProduct({ id: 'p1', name: 'X', stockQuantity: 10 }, { deposits: [], stockMovements: [] });
check('sem reservas, reserved é null', semReserva.reserved === null);
check('e available também', semReserva.available === null);
const comReserva = stockCore.serializeProduct({ id: 'p1', name: 'X', stockQuantity: 10 }, { deposits: [], stockMovements: [] }, reservas);
check('com reservas, reserved é o número', comReserva.reserved === 11);
check('e available desconta', comReserva.available === -1);
check('a tela não desenha linha quando é null', /if \(product\.reserved === null \|\| product\.reserved === undefined\) return '';/.test(ler('public/modules/stock/subs/products.js')));

console.log('\n--- custo consciente ---');
// Ler os pedidos é uma consulta a mais. Registrar movimentação não precisa
// saber o que está prometido, e cobrar a consulta ali seria custo sem uso.
check('a leitura de pedidos é opcional', /async function loadStockContext\(\{ comReservas = false \} = \{\}\)/.test(serverSrc));
check('a lista de produtos pede as reservas', /loadStockContext\(\{ comReservas: true \}\)/.test(serverSrc));
// Falha ao ler pedidos não pode derrubar a tela de Estoque.
check('falha nas reservas não derruba o Estoque', /catch \(erroReservas\) \{\s*\n(\s*\/\/[^\n]*\n)*\s*reservas = null;/.test(serverSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
