#!/usr/bin/env node
/**
 * ALTERAÇÃO EM MASSA DOS IMPOSTOS NA EMISSÃO (14/10/2026). Pedido do usuário:
 * "faça um botão para alteração em massa de dados fiscais e impostos" — na
 * emissão da NF-e (escolha do usuário entre produtos, emissão e regras).
 *
 * Provado no navegador (nota de 3 itens, nada emitido): ICMS 12%, CST PIS 49 e
 * CST IBS/CBS 200 nos itens 1 e 2 (o 3 desmarcado): os dois mudaram e a prévia
 * recalculou (ICMS do item 1 R$ 1.198,80), o cClassTrib foi junto (200002), o
 * item 3 ficou igual; "Usar o da regra nos marcados" voltou tudo (17%, sem
 * marca de editado).
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const tela = fs.readFileSync(path.join(__dirname, '..', 'public/modules/finance/subs/emitir_nfe_focus.js'), 'utf8');

check('botão na aba Impostos, ao lado do Recalcular', tela.includes('<button type="button" class="secondary" data-fiscal-massa>Alterar em massa</button>'));
check('os campos da aba, menos base/valor e o ST retido',
  tela.includes('.filter((g) => !g.soComStRetido)') && tela.includes('.filter(([campo]) => !CAMPOS_CALCULADOS.includes(campo))'));
check('CST em lista, com "manter" no vazio', tela.includes(".replace('>—</option>', '>— manter —</option>')"));
check('o cClassTrib segue o CST do IBS/CBS escolhido na janela', tela.includes("if (e.target.dataset.massaCampo !== 'cstIbsCbs') return;"));
check('só os itens marcados, só os campos preenchidos', tela.includes(".filter(([, v]) => v !== '')") && tela.includes('lista.forEach((i) => {'));
check('  o CST do IBS/CBS antes do cClassTrib', tela.includes(".sort(([a], [b]) => (a === 'classTrib') - (b === 'classTrib'))"));
check('uma regra só para gravar o campo (item e massa)',
  tela.includes('function gravarCampoFiscal(item, linhaPrevia, campo, bruto) {')
  && tela.includes('gravarCampoFiscal(item, previa && previa.itens ? previa.itens[indice] : null, campo, evento.target.value);')
  && tela.includes('preenchidos.forEach(([campo, valor]) => gravarCampoFiscal(item, linha, campo, valor));'));
check('"Usar o da regra" nos marcados', tela.includes("lista.forEach((i) => { if (itens[i]) itens[i].fiscal = {}; });"));
check('aplicar refaz a prévia', /fechar\(\);\s*showToast\(`\$\{preenchidos\.length\} campo\(s\) aplicado\(s\)[^\n]*\n\s*carregarPrevia\(\);/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
