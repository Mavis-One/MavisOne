#!/usr/bin/env node
/**
 * APROVAR O PEDIDO CONFERE O ESTOQUE (16/10/2026). Pedido do usuário: "vamos
 * refazer o bloqueio de emissão, quero que o sistema bloqueie na aprovação do
 * pedido ao invés de permitir gerar a NF com estoque zerado".
 *
 * Aprovar leva o pedido a Pré-Faturado, e só dali saem a NF-e e a NFC-e
 * (aprovadoParaEmitir em sales_record_actions.js). A conferência fica em
 * aplicarEfeitosDeStatus — o ponto por onde passam o "Aprovar Pedido" (PUT do
 * pedido) e o "Aprovar" das Mais Ações (lote) — e usa a conta do faturamento
 * (itensSemEstoqueParaFaturar: depósito do pedido, cor, categoria que não mexe
 * em estoque). A emissão continua conferindo: sem reserva, o saldo pode sair
 * entre aprovar e emitir.
 *
 * Provado contra o servidor (rota do lote, pedido de teste apagado no fim):
 * produto com saldo em outras lojas e 0 no Depósito Electric → recusado com
 * "Sem estoque para aprovar: ... em Depósito Electric (disponível 0,
 * necessário 1)", e o pedido continuou "Pedido"; trocado por um com saldo →
 * Pré-Faturado, sem movimento de estoque.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const server = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'));
const efeitos = (server.match(/async function aplicarEfeitosDeStatus\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];

console.log('\n--- a aprovação ---');
check('a conferência mora em aplicarEfeitosDeStatus (PUT e lote passam por ela)', efeitos.length > 0
  && /mudarStatusSalesRecord[\s\S]*?aplicarEfeitosDeStatus\(\{/.test(server)
  && (server.match(/await aplicarEfeitosDeStatus\(\{/g) || []).length === 2);
check('só ao ENTRAR em Pré-Faturado (pedido)', /if \(tipoNovo === 'order' && statusNovo === 'pedido-pre-faturado'\s*&& salesStatus\.normalizar\(current\.status, undefined\) !== 'pedido-pre-faturado'\) \{/.test(efeitos));
check('com a conta do faturamento, sobre os itens e o depósito que vão ser gravados',
  /const faltando = await itensSemEstoqueParaFaturar\(\{ \.\.\.current, \.\.\.updated, items: items \|\| updated\.items \|\| current\.items \}\);/.test(efeitos));
check('recusa com 400 e diz o que falta', /`Sem estoque para aprovar: \$\{faltando\.map/.test(efeitos) && /erro\.status = 400;\s*throw erro;/.test(efeitos));
const posConferencia = efeitos.indexOf('Sem estoque para aprovar');
check('antes de mexer em estoque e de gravar o pedido', posConferencia > 0
  && posConferencia < efeitos.indexOf('transitionOrderStockEffect(') && posConferencia < efeitos.indexOf('db.updateOrder('));

console.log('\n--- e a emissão continua conferindo ---');
check('NF-e: prepararNfeParaTransmitir', /const faltando = pedido \? await itensSemEstoqueParaFaturar\(pedido\) : \[\];/.test(server));
check('NFC-e: a emissão do pedido', /const faltando = await itensSemEstoqueParaFaturar\(pedido\);\s*if \(faltando\.length\) \{\s*recusar\(`Sem estoque para faturar/.test(server));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
