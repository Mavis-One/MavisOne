#!/usr/bin/env node
/**
 * LINHAS ALTERNADAS EM TODA TABELA E LISTAGEM (15/10/2026). Pedido do usuário:
 * "quero que todas as tabelas e listagem de qualquer tipo, cadastro, pedidos,
 * produtos e afins seja feita em ordem sequencial em tons claros e escuros".
 *
 * Provado no navegador (temas claro e escuro): Produtos, Pedidos e Contas a
 * Receber com uma linha sim, outra não no tom da cor do texto do tema (7%); a
 * linha marcada em Contas a Receber continua com a cor de selecionada.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const css = fs.readFileSync(path.join(__dirname, '..', 'public/app.css'), 'utf8');

const listra = ':where(.table, .data-table) > tbody > tr:where(:nth-child(even)) > td { background: rgba(var(--text-rgb), 0.07); }';
check('uma regra só para toda .table e .data-table (as ~90 tabelas do sistema)', css.includes(listra));
check('  no tom da cor do texto do tema: vale no claro e no escuro', /rgba\(var\(--text-rgb\), 0\.07\)/.test(css)
  && (css.match(/--text-rgb:/g) || []).length >= 2);
check('  a linha sob o mouse um pouco mais forte', css.includes(':where(.table, .data-table) > tbody > tr:where(:hover) > td { background: rgba(var(--text-rgb), 0.12); }'));
check('  peso zero (:where) e ANTES das linhas marcadas: selecionada continua vencendo',
  css.indexOf(listra) > 0 && css.indexOf(listra) < css.indexOf('tr.is-selected > td') && css.indexOf(listra) < css.indexOf('tr.is-selecionada > td'));
check('a listagem em cartões (vencimentos do Financeiro) também alterna',
  css.includes('.finance-due-list > .finance-due-item:nth-child(even):not(:hover) { background-image: linear-gradient(rgba(var(--text-rgb), 0.07), rgba(var(--text-rgb), 0.07)); }'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
