#!/usr/bin/env node
// O CAMPO NUNCA PASSA DA COLUNA DELE.
//
// Varredura de 10/10/2026 (Chrome headless, 227 telas e formulários, a 1400 px
// e a 390 px): um <select> nasce com a largura da opção mais comprida, e item
// de grade/flex nasce com min-width:auto, que respeita essa largura. Na regra
// fiscal o CFOP passava 976 px da coluna e encostava no CSOSN, que encostava
// no CST; o mesmo acontecia no Plano de Contas do Lançamento, no Estabelecimento
// da NF-e, na Atividade do SPED, no Regime da empresa fiscal — 13 telas no
// computador, 24 no celular.
//
// O conserto é um ponto só do app.css; este teste guarda as três peças e a
// armadilha que a primeira tentativa caiu:
//   - minmax(0, 1fr) no RÓTULO resolve a grade mas quebra a linha flexível:
//     o filtro do PCP > Qualidade encolhia até sobrar só a seta.
//
// SEM BANCO, SEM NAVEGADOR: lê o CSS.
'use strict';
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const regra = (seletor) => {
  const esc = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  // O mesmo seletor pode aparecer em mais de um bloco: junta todos.
  const blocos = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]);
  return blocos.length ? blocos.join(' ') : null;
};

console.log('\n--- 1. o campo dentro do rótulo cede para a coluna ---');
const dentro = regra('label > input, label > select, label > textarea, label > .searchable-select');
check('label > input/select/textarea/busca têm min-width: 0', /min-width:\s*0/.test(dentro || ''), dentro);
const celula = regra('.row > *, .form-grid > *');
check('o rótulo cede para a célula da .row/.form-grid', /min-width:\s*0/.test(celula || ''), celula);
check('input/select/textarea nunca mais largos que o pai', /max-width:\s*100%/.test(regra('input, select, textarea') || ''));
check('texto longo do select termina em reticências', /text-overflow:\s*ellipsis/.test(regra('select') || ''));

console.log('\n--- 2. o select com botão "+" ao lado (Plano de Contas, Conta bancária) ---');
check('.finance-inline-select cede', /min-width:\s*0/.test(regra('.finance-inline-select') || ''));
check('.finance-inline-select select cede', /min-width:\s*0/.test(regra('.finance-inline-select select') || ''));

console.log('\n--- 3. a armadilha ---');
check('o rótulo NÃO usa coluna minmax(0, 1fr) (encolhe filtro em linha flexível)',
  !/(^|\})\s*label\s*\{[^}]*grid-template-columns:\s*minmax\(0/m.test(css));
const vao = /\.row\s*\{[^}]*gap:\s*(\d+)px/.exec(css);
check('o vão entre campos vizinhos continua 22 px', vao && Number(vao[1]) === 22, vao && vao[1]);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
