#!/usr/bin/env node
/**
 * O PEDIDO: O CHASSI DO ITEM VAI SOZINHO PARA AS OBSERVAÇÕES, E O QUADRO DOS
 * PAGAMENTOS SOBE NA ABA PAGAMENTOS (15/10/2026). Pedidos do usuário: "pegue
 * o chassi que aparece logo após o produto ser adicionado e puxe ele
 * automaticamente nas observações/termos e condições já para não ter a
 * necessidade de copiar e colar" e "pagamentos (informação para NF-e e NFC-e)
 * fique em cima dos demais campos".
 *
 * Provado no navegador (Nova Venda, nada salvo): "CHASSI:" -> "CHASSI: ABC123"
 * ao digitar no item; com um segundo item, "CHASSI: ABC123, XYZ9"; removendo o
 * primeiro, "CHASSI: XYZ9"; com a linha reescrita à mão, trocar o chassi do
 * item não a apagou. Na aba Pagamentos, o quadro veio antes de "Plano de
 * Conta - Receita".
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const appBruto = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
const app = semComentarios(appBruto);

console.log('\n--- o chassi nas observações ---');
check('junta os chassis dos itens, sem repetir', /const chassisDosItens = \(\) => \[\.\.\.new Set\(items\.map\(\(i\) => String\(i\.chassi \|\| ''\)\.trim\(\)\)\.filter\(Boolean\)\)\]\.join\(', '\);/.test(app));
check('escreve na linha CHASSI: do texto padrão, ou a cria no topo',
  /formState\.note = TP\.comChassi\(texto, novo\);\s*else if \(novo\) formState\.note = `CHASSI: \$\{novo\}\\n\$\{texto\}`;/.test(app));
check('  e não apaga o que foi escrito à mão na linha',
  /if \(escritoNoTexto && escritoNoTexto !== chassiAutomatico\) \{\s*chassiAutomatico = novo;\s*return;/.test(app));
check('ao mudar o chassi do item', /\.chassi = limpo;\s*syncFormState\(\);\s*levarChassiParaObservacoes\(\);\s*renderForm\(\);/.test(app));
check('  e ao remover um item', /items\.splice\(Number\(btn\.dataset\.index\), 1\);\s*syncFormState\(\);\s*levarChassiParaObservacoes\(\);\s*renderForm\(\);/.test(app));

console.log('\n--- a aba Pagamentos ---');
const painel = appBruto.slice(appBruto.indexOf('data-aba="pagamentos"'), appBruto.indexOf('<!-- /aba Pagamentos -->'));
check('o quadro dos pagamentos vem antes dos demais campos',
  painel.indexOf('Pagamentos (Informação para NF-e/NFC-e)') > 0
  && painel.indexOf('Pagamentos (Informação para NF-e/NFC-e)') < painel.indexOf('Plano de Conta - Receita')
  && painel.indexOf('Plano de Conta - Receita') < painel.indexOf('Ignorar Limite de Crédito'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
