#!/usr/bin/env node
/**
 * TIPO DE PESSOA PELO DOCUMENTO (15/10/2026). Pedido do usuário: "nessa tela
 * o botão tipo de pessoa deve reconhecer automaticamente" (Cadastro de
 * pessoas › Identificação).
 *
 * Provado no navegador, digitando dígito a dígito: CNPJ 46546764000188 ->
 * "46.546.764/0001-88", Pessoa jurídica, lupa da consulta ligada; trocar à mão
 * para física com o CNPJ no campo volta para jurídica; CPF 52998224725 ->
 * "529.982.247-25", Pessoa física; campo vazio deixa escolher à mão.
 * Antes, com "Pessoa física" escolhida, a máscara cortava em 11 dígitos e um
 * CNPJ nem cabia no campo.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
global.window = {};
require('../public/modules/shared/documento.js');
const D = window.MavisDocumento;

check('o tipo sai dos dígitos: mais de 11 é jurídica, até 11 é física',
  /const tipoPeloDocumento = \(\) => \{[\s\S]{0,200}return n > 11 \? 'pessoa-juridica' : 'pessoa-fisica';/.test(app));
check('a máscara segue os dígitos, não o select', app.includes("bindDocumentMask(peopleDocumentInput, () => '');"));
check('  e assim o CNPJ cabe inteiro (a máscara sem tipo não corta em 11)', D.mascarar('46546764000188', '') === '46.546.764/0001-88' && D.mascarar('52998224725', '') === '529.982.247-25');
check('digitar no documento troca o tipo', /peopleDocumentInput\?\.addEventListener\('input', \(\) => \{\s*alinharTipoAoDocumento\(\);/.test(app));
check('escolher à mão contra o documento volta ao certo', /peopleTypeSelect\?\.addEventListener\('change', \(\) => \{\s*alinharTipoAoDocumento\(\);/.test(app));
check('  e não corta mais o documento ao trocar o tipo', !app.includes('peopleDocumentInput.value = maskDocumentValue(peopleDocumentInput.value, peopleTypeSelect.value);'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
