#!/usr/bin/env node
/**
 * DUPLO CLIQUE NA LINHA ABRE O PEDIDO (13/10/2026, pedido do usuário).
 *
 * Na lista de Pedidos e Orçamentos, o duplo clique em qualquer lugar da linha
 * abre o registro — o mesmo caminho do lápis. Na caixa de seleção e nos botões
 * da linha, não: lá cada clique já faz o seu. Provado no navegador (banco
 * local): duplo clique na célula abriu "Editar Pedido #039438"; na caixa, a
 * lista ficou.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

check('a linha leva o id do registro', /<tr class="\$\{draft\.selecionados\.includes\(record\.id\) \? 'is-selecionada' : ''\}" data-abrir-registro="\$\{escapeHtml\(record\.id\)\}">/.test(app));
check('o duplo clique abre pelo mesmo caminho do lápis',
  /linha\.addEventListener\('dblclick'[\s\S]{0,400}abrirRegistroDaLista\(linha\.dataset\.abrirRegistro\)/.test(app)
  && /btn\.addEventListener\('click', \(\) => abrirRegistroDaLista\(btn\.dataset\.id\)\)/.test(app));
check('  menos na caixa de seleção e nos botões', /if \(evento\.target\.closest\('input, button, a, select, label'\)\) return;/.test(app));
check('abrir é editar o registro da página', /const abrirRegistroDaLista = \(id\) => \{\s*const record = records\.find\(\(entry\) => entry\.id === id\);\s*if \(!record\) return;\s*state\.salesDraft\.editRecord = record;/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
