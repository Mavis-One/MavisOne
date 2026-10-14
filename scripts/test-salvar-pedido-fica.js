#!/usr/bin/env node
/**
 * SALVAR O PEDIDO NÃO SAI DA TELA (14/10/2026).
 *
 * Pedido do usuário: "toda vez que eu salvo algum pedido o mesmo sai da tela
 * ao invés de apenas recarregar a página". Era de propósito: o Salvar limpava
 * o pedido aberto e mandava para a lista. Agora recarrega o próprio pedido —
 * relido do servidor — na aba em que a pessoa estava.
 *
 * Provado no navegador (pedido 15524 local, restaurado depois): salvo na aba
 * Pagamentos, a tela continuou no pedido 15524 e na aba Pagamentos, com o
 * aviso "Pedido atualizado com sucesso".
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
const ini = app.indexOf('// SALVAR NÃO SAI DO PEDIDO');
const bloco = app.slice(ini, ini + 1500);

check('o bloco do salvar foi encontrado', ini > 0);
check('guarda o que a gravação devolveu (novo e edição)',
  app.includes("salvo = await api(`/api/sales/records/${editRecord.id}`, { method: 'PUT'") && app.includes("salvo = await api('/api/sales/records', { method: 'POST'"));
check('relê o pedido do servidor', bloco.includes('const relido = await api(`/api/sales/records/${encodeURIComponent(gravado.id)}`);'));
check('e continua nele, na mesma aba', bloco.includes('state.salesDraft.editRecord = recarregado;') && bloco.includes("state.activeSub = 'new_sale';")
  && bloco.includes('state.salesDraft.abaAoReabrir = abaAtiva;'));
check('a aba é retomada ao redesenhar', app.includes("let abaAtiva = state.salesDraft.abaAoReabrir || 'dados';"));
check('só volta à lista se a gravação não devolveu o pedido', bloco.includes("state.activeSub = 'orders_quotes';"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
