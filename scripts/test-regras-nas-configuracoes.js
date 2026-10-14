#!/usr/bin/env node
/**
 * REGRAS FISCAIS DENTRO DAS CONFIGURAÇÕES (14/10/2026).
 *
 * Pedido do usuário: "faça uma tela nas configurações sobre regras fiscais".
 * É a mesma tela de Fiscal › Regras Fiscais, delegada — não uma cópia (ver
 * settings/subs/regras_fiscais.js). Provado no navegador: Configurações ›
 * Regras Fiscais abre com a empresa, a lista, o simulador e "+ Nova regra".
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const tela = ler('public/modules/settings/subs/regras_fiscais.js');
check('delega para a tela do Fiscal (uma tela só)', tela.includes('window.MavisSubscreenRegistry.fiscal && window.MavisSubscreenRegistry.fiscal.regras') && tela.includes('await tela(ctx);'));
check('  e explica se a do Fiscal faltar', tela.includes("typeof tela !== 'function'") && tela.includes('fiscal/subs/regras.js'));
check('o Fiscal continua registrando a tela', ler('public/modules/fiscal/subs/regras.js').includes('window.MavisSubscreenRegistry.fiscal.regras = desenhar;'));
check('no menu de Configurações', ler('public/app.js').includes("{ key: 'regras_fiscais', label: 'Regras Fiscais'"));
check('o módulo de Configurações aceita a tela', ler('public/modules/settings/index.js').includes("'regras_fiscais'"));
const html = ler('public/index.html');
check('carrega depois da tela do Fiscal', html.indexOf('settings/subs/regras_fiscais.js') > html.indexOf('fiscal/subs/regras.js') && html.indexOf('fiscal/subs/regras.js') > 0);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
