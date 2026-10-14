#!/usr/bin/env node
/**
 * NFC-e EMITIDAS, NO MÓDULO DE VENDAS (14/10/2026).
 *
 * Pedido do usuário: "faça uma tela de NFC-e emitidas, para registro de todos
 * os cupons que foram emitidos, coloque o botão de ações em cima dessa tela
 * igual à das NF-e emitidas e deixe ela no módulo de vendas". É a lista de
 * NF-e Emitidas com o modelo fixo em 65 (finance/subs/nfe_emitidas.js): as
 * mesmas ações, filtros e página guardados à parte, sem "+ Nova".
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

console.log('--- 1. a tela ---');
const tela = ler('public/modules/finance/subs/nfe_emitidas.js');
const contexto = { window: { MavisSubscreenRegistry: {} } };
vm.createContext(contexto);
vm.runInContext(tela, contexto);
const registradas = contexto.window.MavisSubscreenRegistry.finance || {};
check('NF-e Emitidas e NFC-e Emitidas registradas', typeof registradas.nfe_emitidas === 'function' && typeof registradas.nfce_emitidas === 'function');
check('NFC-e com o modelo 65 fixo, cupom/cupons, sem "+ Nova"',
  /nfce_emitidas: \{ titulo: 'NFC-e Emitidas', modeloFixo: '65', estado: 'nfceLista', singular: 'cupom', plural: 'cupons', novo: false \}/.test(tela));
check('o modelo vai sempre na consulta', /if \(tela\.modeloFixo\) params\.set\('modelo', tela\.modeloFixo\);/.test(tela));
check('  e o filtro de modelo some', /\$\{tela\.modeloFixo \? '' : `<label class="cadastro-field">\s*<span>Modelo<\/span>/.test(tela));
check('filtros, página e ordem guardados à parte', /state\[estado\('Filtros'\)\]/.test(tela) && /state\[estado\('PorPagina'\)\]/.test(tela) && /state\[estado\('Ordem'\)\]/.test(tela)
  && !/state\.nfeListaFiltros/.test(tela));
check('o mesmo painel de ações em cima da lista', /<div id="nfeActionsPanel" class="nfe-actions-panel" hidden><\/div>/.test(tela));
check('  falando em cupom e DANFCe na tela de NFC-e', /nomeDoDocumento: tela\.modeloFixo === '65' \? 'NFC-e' : 'NF-e',/.test(tela));
global.window = {};
global.window.MavisNfeActions = undefined;
(0, eval)(ler('public/modules/finance/nfe_actions.js'));
const A = global.window.MavisNfeActions;
const painel = (nome) => {
  const caixa = { innerHTML: '', hidden: true, querySelectorAll: () => [] };
  A.render(caixa, { nomeDoDocumento: nome, selecionadas: [{ id: '1', modelo: 65, status: 'autorizada', origem: 'fiscal' }], nfe: { id: '1', modelo: 65, status: 'autorizada', origem: 'fiscal' }, escapeHtml: (s) => String(s), showToast() {} });
  return caixa.innerHTML;
};
const cupom = painel('NFC-e');
check('"1 cupom selecionado", "Cancelar NFC-e", "Baixar DANFCe"', /1 cupom selecionado/.test(cupom) && /Cancelar NFC-e/.test(cupom) && /Baixar DANFCe/.test(cupom) && !/Cancelar NF-e</.test(cupom));
check('  e a tela de NF-e continua falando em NF-e', /1 NF-e selecionada/.test(painel('NF-e')) && /Cancelar NF-e/.test(painel('NF-e')));

console.log('\n--- 2. no módulo de Vendas ---');
const app = ler('public/app.js');
const iNfe = app.indexOf("{ key: 'nfes', label: 'NF-e Emitidas'");
const iNfce = app.indexOf("{ key: 'nfces', label: 'NFC-e Emitidas'");
check('no menu de Vendas, logo depois de NF-e Emitidas', iNfe > 0 && iNfce > iNfe && iNfce - iNfe < 400);
check('Vendas abre a tela do Financeiro com o modelo 65', /const chaveDaTela = sub === 'nfces' \? 'nfce_emitidas' : 'nfe_emitidas';/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
