#!/usr/bin/env node
/**
 * TODO TÍTULO DE PEDIDO NASCE EM ABERTO (17/10/2026). Pedido do usuário: "os
 * títulos de pedidos aprovados devem ficar em aberto todos eles, por motivos
 * de conciliação!".
 *
 * Histórico: desde a fase AU a venda em dinheiro, PIX ou débito nascia
 * quitada, com baixa automática na conta da forma. Em 16/10/2026 essa baixa
 * passou a esperar a confirmação na Edição de Título (ou a autorização da
 * nota). Agora não há baixa automática nenhuma: quem baixa é a conciliação.
 * O cancelamento continua desfazendo baixa automática de título antigo.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const servidor = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'));
const ini = servidor.indexOf('async function transitionOrderFinanceEffect(');
const efeito = servidor.slice(ini, servidor.indexOf('\n}\n', ini));
const criacao = efeito.slice(efeito.indexOf('for (const parcela of parcelas)'));

console.log('--- 1. o título do pedido nasce em aberto ---');
check('status sempre pendente', /status: 'pending',/.test(criacao) && !/'paid'/.test(criacao));
check('  e nenhuma baixa na criação', !/createFinancialPayment/.test(criacao));
check('  com o líquido e a taxa guardados para a conciliação', /feeAmount: parcela\.feeAmount,\s*netAmount: parcela\.netAmount,/.test(criacao));

console.log('\n--- 2. nada dá baixa sozinho depois ---');
check('salvar na Edição de Título não dá baixa',
  !/confirmarAVista|aVistaAguardando/.test(servidor));
check('a autorização da nota não dá baixa', !/quitarAVistaPendentes/.test(servidor));
check('nem existe mais a baixa da venda à vista', !/baixaDaVendaAVista|adiarAVista/.test(servidor));

console.log('\n--- 3. o que continua ---');
check('cancelar o pedido ainda desfaz a baixa automática de título antigo',
  /const automaticas = baixas\.filter\(\(baixa\) => baixa\.origem === 'automatica'\);/.test(efeito));
check('a conciliação baixa com a taxa do cartão', /discount: taxaDoCartao,/.test(servidor));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
