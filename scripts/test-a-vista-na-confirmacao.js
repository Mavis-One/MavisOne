#!/usr/bin/env node
/**
 * O TÍTULO À VISTA DA APROVAÇÃO ESPERA A CONFIRMAÇÃO (16/10/2026). Pedido do
 * usuário: "verifique o pq os lançamentos já são feitos diretamente antes de
 * eu fazer a aprovação de lançamento de título na edição de títulos"; escolhido:
 * a baixa sai ao confirmar na Edição de Título, e, sem confirmação, quando a
 * nota é autorizada.
 *
 * Dinheiro, PIX e débito (formaPagamento.quitaNaHora) nasciam recebidos, com a
 * baixa automática na conta da forma — desde 16/10 isso acontecia já na
 * aprovação, antes da Edição de Título. Provado no servidor local com um
 * pedido de teste (R$ 50 dinheiro + R$ 30 boleto): aprovar deixou os dois em
 * aberto; salvar o boleto o manteve em aberto; salvar o dinheiro com o "CAIXA
 * DINHEIRO BY BLUMENAU" o recebeu, com a baixa de R$ 50 nesse caixa; cancelar
 * o pedido cancelou os dois e tirou a baixa. Tudo apagado depois.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const servidor = semComentarios(src);

function corpoDe(nome) {
  const marca = [`\nfunction ${nome}(`, `\nasync function ${nome}(`].find((m) => src.includes(m));
  if (!marca) throw new Error(`server.js não tem a função ${nome}`);
  const ini = src.indexOf(marca);
  return src.slice(ini, src.indexOf('\n}', ini + 1) + 2);
}

console.log('--- 1. na aprovação o à vista nasce em aberto ---');
check('o efeito financeiro recebe adiarAVista',
  /async function transitionOrderFinanceEffect\(data, \{ record, wasApplied, willApply, user, adiarAVista = false \}\)/.test(servidor)
  && /status: parcela\.quitaNaHora && !adiarAVista \? 'paid' : 'pending',/.test(servidor)
  && /if \(parcela\.quitaNaHora && !adiarAVista\) \{\s*await baixaDaVendaAVista\(/.test(servidor));
check('  e adia na aprovação (troca de status e pedido que já nasce aprovado)',
  /record: updated, wasApplied: eraFaturado, willApply: vaiGerarFinanceiro, user,\s*adiarAVista: statusNovo === 'pedido-pre-faturado'/.test(servidor)
  && /transitionOrderFinanceEffect\(data, \{ record, wasApplied: false, willApply: true, user, adiarAVista: status === 'pedido-pre-faturado' \}\)/.test(servidor));
check('salvar na Edição de Título confirma (na conta escolhida)',
  /await db\.updateFinancialEntry\(entry\.id, entry\);\s*if \(vinculadoAoPedido && aVistaAguardando\(data, entry\)\) await confirmarAVista\(data, entry, user\);/.test(servidor));
check('faturar dá a baixa no que ninguém confirmou',
  /if \(vaiGerarFinanceiro && salesStatus\.geraFinanceiro\(statusNovo\)\) \{\s*efeitoFinanceiro\.quitadas = Number\(efeitoFinanceiro\.quitadas \|\| 0\) \+ await quitarAVistaPendentes\(data, updated, user\);/.test(servidor));

console.log('\n--- 2. as funções, rodando ---');
const pagamentosGravados = [];
const titulosGravados = [];
const db = {
  createFinancialPayment: async (p) => { pagamentosGravados.push(p); return { id: `pay-${pagamentosGravados.length}`, ...p }; },
  updateFinancialEntry: async (id, campos) => { titulosGravados.push({ id, ...campos }); }
};
const formaPagamento = require('../public/modules/shared/forma_pagamento');
const getFinanceEntryPayments = (data, id) => (data.financialPayments || []).filter((p) => p.entryId === id);
const F = new Function('db', 'formaPagamento', 'getFinanceEntryPayments',
  ['baixaDaVendaAVista', 'aVistaAguardando', 'confirmarAVista', 'quitarAVistaPendentes'].map(corpoDe).join('\n')
  + '\nreturn { aVistaAguardando, quitarAVistaPendentes };')(db, formaPagamento, getFinanceEntryPayments);

(async () => {
  const data = {
    paymentMethods: [{ id: 'din', type: 'dinheiro' }, { id: 'deb', type: 'cartao-debito' }, { id: 'bol', type: 'boleto' }],
    financialPayments: [{ entryId: 'f-ja', amount: 10 }],
    finance: [
      { id: 'f-din', referenceId: 'ped', type: 'RECEITA', status: 'pending', paymentMethodId: 'din', amount: 50, date: '2026-10-16', bankAccountId: 'caixa' },
      { id: 'f-deb', referenceId: 'ped', type: 'RECEITA', status: 'pending', paymentMethodId: 'deb', amount: 100, netAmount: 98, feeAmount: 2, feePercent: 2, date: '2026-10-16', bankAccountId: 'banco' },
      { id: 'f-bol', referenceId: 'ped', type: 'RECEITA', status: 'pending', paymentMethodId: 'bol', amount: 30, date: '2026-10-16' },
      { id: 'f-ja', referenceId: 'ped', type: 'RECEITA', status: 'pending', paymentMethodId: 'din', amount: 20, date: '2026-10-16' },
      { id: 'f-outro', referenceId: 'outro', type: 'RECEITA', status: 'pending', paymentMethodId: 'din', amount: 5, date: '2026-10-16' }
    ]
  };
  check('à vista em aberto e sem baixa espera confirmação', F.aVistaAguardando(data, data.finance[0]) && F.aVistaAguardando(data, data.finance[1]));
  check('  boleto não; nem o que já tem baixa', !F.aVistaAguardando(data, data.finance[2]) && !F.aVistaAguardando(data, data.finance[3]));
  const quitadas = await F.quitarAVistaPendentes(data, { id: 'ped' }, { id: 'u', name: 'U' });
  check('faturar quita só o à vista do pedido que esperava', quitadas === 2 && data.finance[0].status === 'paid' && data.finance[1].status === 'paid'
    && data.finance[2].status === 'pending' && data.finance[4].status === 'pending', quitadas);
  const doDebito = pagamentosGravados.find((p) => p.entryId === 'f-deb');
  check('  a baixa do débito entra pelo líquido, com a taxa no desconto, na conta do título',
    doDebito && doDebito.amount === 98 && doDebito.discount === 2 && doDebito.bankAccountId === 'banco' && doDebito.origem === 'automatica', JSON.stringify(doDebito));
  const doDinheiro = pagamentosGravados.find((p) => p.entryId === 'f-din');
  check('  e a do dinheiro pelo valor, no caixa escolhido, na data da venda',
    doDinheiro && doDinheiro.amount === 50 && doDinheiro.bankAccountId === 'caixa' && doDinheiro.date === '2026-10-16', JSON.stringify(doDinheiro));
  check('  e o título fica recebido no banco', titulosGravados.filter((t) => t.status === 'paid').length === 2);

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
