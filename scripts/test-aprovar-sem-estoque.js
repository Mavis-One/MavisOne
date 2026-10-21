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
  /await recusarAprovacaoSemEstoque\(\{ \.\.\.current, \.\.\.updated, items: items \|\| updated\.items \|\| current\.items \}\);/.test(efeitos));
const recusa = (server.match(/async function recusarAprovacaoSemEstoque\(pedido\) \{[\s\S]*?\n\}/) || [''])[0];
check('recusa com 400 e diz o que falta', /const faltando = await itensSemEstoqueParaFaturar\(pedido\);/.test(recusa)
  && /`Sem estoque para aprovar: \$\{faltando\.map/.test(recusa) && /erro\.status = 400;\s*throw erro;/.test(recusa));
const posConferencia = efeitos.indexOf('recusarAprovacaoSemEstoque(');
check('antes de mexer em estoque e de gravar o pedido', posConferencia > 0
  && posConferencia < efeitos.indexOf('transitionOrderStockEffect(') && posConferencia < efeitos.indexOf('db.updateOrder('));

// O PEDIDO QUE JÁ NASCE APROVADO (21/10/2026, pedido do usuário: "pedidos não
// podem ser aprovados com produtos sem estoque"). O POST não passava por
// aplicarEfeitosDeStatus: um pedido criado em Pré-Faturado nascia aprovado,
// com títulos, sem conferir nada. Provado na 3099: POST em Pré-Faturado com
// um produto zerado → 400 "Sem estoque para aprovar: "CAPA DE MURO 19CM"
// (disponível 0, necessário 1)"; o mesmo pedido como "Pedido" grava.
const criar = server.slice(server.indexOf("pathname === '/api/sales/records' && req.method === 'POST'"));
const posNoPost = criar.indexOf("if (type === 'order' && status === 'pedido-pre-faturado') await recusarAprovacaoSemEstoque(record);");
check('o pedido que já nasce aprovado (POST) confere do mesmo jeito', posNoPost > 0
  && posNoPost < criar.indexOf('await db.createOrder(record)') && posNoPost < criar.indexOf('transitionOrderFinanceEffect('));

console.log('\n--- e a emissão continua conferindo ---');
check('NF-e: prepararNfeParaTransmitir', /const faltando = pedido \? await itensSemEstoqueParaFaturar\(pedido\) : \[\];/.test(server));
check('NFC-e: a emissão do pedido', /const faltando = await itensSemEstoqueParaFaturar\(pedido\);\s*if \(faltando\.length\) \{\s*recusar\(`Sem estoque para faturar/.test(server));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
