#!/usr/bin/env node
/**
 * CONTAS A PAGAR E CONTAS A RECEBER EM TELAS PRÓPRIAS (14/10/2026).
 *
 * Pedido do usuário: "separe em duas telas financeiras os lançamentos, contas
 * a pagar e contas a receber". As duas são a lista de Lançamentos com o tipo
 * fixo (despesa / receita), cada uma com o seu estado; Lançamentos continua
 * como a visão geral, a única com as transferências entre contas.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. as três telas saem da mesma lista ---');
const tela = ler('public/modules/finance/subs/lancamentos.js');
const contexto = { window: { MavisSubscreenRegistry: {} } };
vm.createContext(contexto);
vm.runInContext(tela, contexto);
const registradas = contexto.window.MavisSubscreenRegistry.finance || {};
check('Lançamentos, Contas a Pagar e Contas a Receber registradas',
  ['lancamentos', 'contas_a_pagar', 'contas_a_receber'].every((k) => typeof registradas[k] === 'function'));
check('contas a pagar = despesa, a receber = receita, Lançamentos sem tipo fixo',
  /contas_a_pagar: \{ titulo: 'Contas a Pagar', tipoFixo: 'despesa'/.test(tela)
  && /contas_a_receber: \{ titulo: 'Contas a Receber', tipoFixo: 'receita'/.test(tela)
  && /lancamentos: \{ titulo: 'Lançamentos', tipoFixo: ''/.test(tela));
check('o tipo vai sempre na consulta (e não é um filtro que se limpa)', /if \(tipoFixo\) params\.set\('type', tipoFixo\);/.test(tela));
check('  e o seletor de tipo some nas duas telas', /\$\{tipoFixo \? '' : `<label class="cadastro-field">\s*<span>Tipo<\/span>/.test(tela));
check('cada tela guarda o seu estado (filtros, página, seleção)', /state\.financeListas\[telaChave\] \|\| \(state\.financeListas\[telaChave\] = \{/.test(tela));
check('a resposta só pinta na tela que pediu', /state\.activeSub === telaChave;/.test(tela));

console.log('\n--- 2. menu e navegação ---');
const app = ler('public/app.js');
const iPagar = app.indexOf("{ key: 'contas_a_pagar', label: 'Contas a Pagar'");
const iReceber = app.indexOf("{ key: 'contas_a_receber', label: 'Contas a Receber'");
const iLanc = app.indexOf("{ key: 'lancamentos', label: 'Lançamentos'");
check('no menu do Financeiro, antes de Lançamentos', iPagar > 0 && iReceber > iPagar && iLanc > iReceber);
check('o módulo conhece as duas telas', /const FINANCE_SUB_KEYS = \['dashboard', 'contas_a_pagar', 'contas_a_receber', 'lancamentos',/.test(ler('public/modules/finance/index.js')));
const novo = ler('public/modules/finance/subs/novo_lancamento.js');
check('o novo lançamento nasce no tipo da tela', /let formType = editEntry \? String\(editEntry\.type\)\.toUpperCase\(\) : \(rascunhoInicial\?\.formType \|\| tipoSugerido \|\| 'DESPESA'\);/.test(novo)
  && /state\.financeNovoTipo = tipoFixo \? tipoFixo\.toUpperCase\(\) : null;/.test(tela));
check('  e salvo volta para a tela de onde veio', /state\.activeSub = state\.financeListaDeOrigem \|\| 'lancamentos';/.test(novo));
check('o login zera o estado das três', /state\.financeListas = null;/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
