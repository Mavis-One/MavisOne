#!/usr/bin/env node
// TUDO O QUE O USUÁRIO DIGITA OU INCLUI FICA EM MAIÚSCULA (12/10/2026).
//
// Guarda as duas metades do pedido: o texto do cadastro vira maiúscula (com
// acento, sem pular o cursor, e também o que entra sem digitação, como o
// endereço do CEP), e o que NÃO pode virar fica de fora — senha e usuário
// (o login compara exatamente), e-mail, URL/link, tokens, busca e filtro.
//
// SEM NAVEGADOR: o módulo roda de verdade sobre campos falsos.
'use strict';
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');

global.window = {};
require('../public/modules/shared/maiusculas.js');
const M = window.MavisMaiusculas;

/** Um campo falso com o que o módulo lê. */
function campo({ tag = 'INPUT', type = 'text', name = '', id = '', placeholder = '', dentroDe = [], valor = '', classes = [], readOnly = false } = {}) {
  return {
    tagName: tag, name, id, value: valor, disabled: false, readOnly,
    getAttribute: (a) => ({ type, placeholder, autocomplete: null })[a] ?? null,
    closest: (sel) => (dentroDe.some((d) => sel.includes(d)) ? {} : null),
    classList: { contains: (c) => classes.includes(c) }
  };
}

console.log('\n--- 1. o que vira maiúscula ---');
for (const nome of ['name', 'tradeName', 'street', 'neighborhood', 'city', 'addressComplement', 'notes', 'description', 'observacao', 'sku', 'customerPoCode']) {
  check(`  ${nome}`, M.elegivel(campo({ name: nome })));
}
check('  textarea de observações', M.elegivel(campo({ tag: 'TEXTAREA', name: 'notes' })));
check('  campo sem type (texto por padrão)', M.elegivel(campo({ type: '', name: 'nome' })));
const c = campo({ name: 'name', valor: 'joão da silva ção' });
M.converter(c);
check('converte com acento, no padrão pt-BR', c.value === 'JOÃO DA SILVA ÇÃO', c.value);

console.log('\n--- 2. o que NÃO vira (e quebraria se virasse) ---');
const fora = [
  ['senha', campo({ type: 'password', name: 'password' })],
  ['usuário do login', campo({ name: 'username' })],
  ['qualquer campo do formulário de login', campo({ name: 'x', dentroDe: ['#loginForm'] })],
  ['e-mail (type email)', campo({ type: 'email', name: 'email' })],
  ['e-mail em campo de texto', campo({ name: 'billingRecipientEmail' })],
  ['e-mails secundários', campo({ name: 'secondaryEmails' })],
  ['link do mapa', campo({ name: 'mapLink' })],
  ['URL em camelCase', campo({ name: 'logoUrl' })],
  ['token da Focus', campo({ name: 'focusToken' })],
  ['CSC', campo({ name: 'cscProducao' })],
  ['senha do certificado', campo({ name: 'senhaCertificado' })],
  ['busca', campo({ type: 'search', name: 'q' })],
  ['busca por nome', campo({ name: 'search' })],
  ['busca pelo placeholder', campo({ name: 'x', placeholder: 'Buscar produto...' })],
  ['campo de busca do seletor', campo({ name: 'x', classes: ['searchable-select-input'] })],
  ['filtro da lista', campo({ name: 'x', classes: ['workspace-filter'] })],
  ['número', campo({ type: 'number', name: 'qtd' })],
  ['data', campo({ type: 'date', name: 'data' })],
  ['saída explícita data-sem-maiuscula', campo({ name: 'nome', dentroDe: ['[data-sem-maiuscula]'] })],
  ['somente leitura', campo({ name: 'nome', readOnly: true })]
];
for (const [rotulo, el] of fora) check(`  ${rotulo}`, !M.elegivel(el));

console.log('\n--- 3. onde e quando ---');
const src = fs.readFileSync(path.join(RAIZ, 'public/modules/shared/maiusculas.js'), 'utf8');
check('converte ao digitar, mas não no meio de um acento (composição)', /if \(evento\.isComposing\) return;/.test(src) && /'compositionend'/.test(src));
check('converte antes de salvar: submit e clique na fase de CAPTURA', /addEventListener\('submit', [^\n]*, true\)/.test(src) && /addEventListener\('click', [\s\S]{0,300}\}, true\);/.test(src));
check('e ao sair do campo (blur, captura)', /addEventListener\('blur', [\s\S]{0,120}\}, true\);/.test(src));
check('preserva o cursor', /setSelectionRange\(inicio, fim\)/.test(src));
const html = fs.readFileSync(path.join(RAIZ, 'public/index.html'), 'utf8');
const posModulo = html.indexOf('/modules/shared/maiusculas.js');
check('carregado em todas as telas, antes do app.js', posModulo > 0 && posModulo < html.indexOf('src="/app.js'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
