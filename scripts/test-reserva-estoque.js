#!/usr/bin/env node
// RESERVA DE ESTOQUE — DESLIGADA (13/10/2026).
//
// O sistema reservava: pedido aberto (Pedido, Não Faturado, Pré-Faturado)
// "segurava" a mercadoria, e o disponível da venda era o saldo menos o que
// outros pedidos já tinham prometido. O usuário viu a Eleven com saldo 5 e
// disponível 4 e pediu: "remova a questão de reservas dentre o sistema".
//
// Agora nenhum status reserva (reservaEstoque em shared/sales_status.js
// responde "não"), e quem confere estoque é só o FATURAMENTO
// (transitionOrderStockEffect) e a NF-e do pedido. Este teste garante que a
// reserva não volta por um caminho esquecido.
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
const stockCore = require(path.join(RAIZ, 'lib/stock-core.js'));

console.log('\n--- nenhum status reserva ---');
const reservam = S.CATALOGO.filter((item) => S.reservaEstoque(item.value)).map((item) => item.value);
check('nenhum status do catálogo reserva', reservam.length === 0, reservam.join(', '));
check('nem o "pedido" de sempre', !S.reservaEstoque('pedido') && !S.reservaEstoque('pedido-nao-faturado') && !S.reservaEstoque('pedido-pre-faturado'));

console.log('\n--- a conta das reservas sai vazia ---');
const pedidos = [
  { id: 'o1', code: 1, status: 'pedido', items: [{ productId: 'p1', quantity: 6 }] },
  { id: 'o2', code: 2, status: 'pedido-pre-faturado', items: [{ productId: 'p1', quantity: 2, classValueId: 'preto' }] }
];
const r = R.calcularReservas(pedidos);
check('pedido aberto não reserva nada', r.porChave.size === 0 && r.porProduto.size === 0);
check('o disponível é o saldo', R.disponivel(10, r, 'p1') === 10);
// O exemplo do usuário: "ayla 500W 5 unidades se eu fizer dois pedidos, o
// estoque deve se manter em 5 até o momento da confirmação de faturamento".
const doisPedidosDeAyla = R.calcularReservas([
  { id: 'a1', code: 10, status: 'pedido', items: [{ productId: 'ayla', quantity: 2 }] },
  { id: 'a2', code: 11, status: 'pedido-nao-faturado', items: [{ productId: 'ayla', quantity: 3 }] }
]);
check('Ayla 500W: 5 em estoque e dois pedidos abertos -> continua 5', R.disponivel(5, doisPedidosDeAyla, 'ayla') === 5);

console.log('\n--- o produto ---');
const produto = stockCore.serializeProduct({ id: 'p1', name: 'X', stockQuantity: 5 }, { deposits: [], stockMovements: [] }, r);
check('reservado zero e disponível igual ao saldo', produto.reserved === 0 && produto.available === 5, `${produto.reserved} / ${produto.available}`);

console.log('\n--- o que dependia da reserva saiu ---');
check('o cartão "Reservado" saiu do painel de Estoque', !/estoque-reservado/.test(ler('lib/painel-modulos.js')));
check('o relatório "Estoque Disponível e Reservado" saiu', !/key: 'estoque-disponivel'/.test(ler('lib/relatorios/estoque.js')));
const app = ler('public/app.js');
check('a venda não mostra número reservado', !/sales-item-reservado/.test(app) && !/Parte do estoque já está reservada/.test(app));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
