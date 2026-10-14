#!/usr/bin/env node
/**
 * A TELA NO ENDEREÇO (14/10/2026). Pedido do usuário: "quero poder utilizar o
 * voltar dos navegadores! e quero poder abrir novas guias diretamente do
 * sistema".
 *
 * Provado no navegador (servidor local):
 *   - Dashboard -> Vendas -> Pedidos e Orçamentos sem recarregar a página; o
 *     endereço foi /#/dashboard, /#/sales, /#/sales/orders_quotes;
 *   - Voltar, Voltar, Avançar do navegador: Vendas, Dashboard, Vendas;
 *   - Ctrl+clique em Financeiro: a guia atual ficou em Vendas;
 *   - o "<" do sistema volta pelo mesmo histórico;
 *   - filtrar a lista de vendas: /?search=teste#/sales/orders_quotes (a tela
 *     continua no endereço);
 *   - abrir /#/finance/nfe_emitidas direto: NF-e Emitidas; /#/naoexiste/x cai
 *     no Dashboard;
 *   - guia NOVA independente (sem herdar o sessionStorage) no link de
 *     Pedidos e Orçamentos: entrou sem login, na tela do link, e a guia
 *     original não se mexeu;
 *   - o alfinete do bloco continua por cima do link; o resto do bloco é link.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = ler('public/app.js');
const css = ler('public/app.css');
const workspace = ler('public/modules/shared/module_workspace.js');
const dashboard = ler('public/modules/dashboard/index.js');
const atalhos = ler('public/modules/shared/atalhos.js');

console.log('--- o endereço segue a tela ---');
check('troca de tela empilha no histórico', app.includes("window.history.pushState({ mavisPasso: passo + 1 }, '', alvo);"));
check('  e o loadModule grava a cada abertura', app.includes('  gravarTelaNoEndereco(moduleName, state.activeSub);\n'));
check('Voltar/Avançar do navegador abrem a tela do endereço', app.includes("window.addEventListener('popstate', () => {"));
check('o "<" do sistema usa o mesmo histórico', /if \(temTelaAnteriorNoHistorico\(\)\) \{\s*window\.history\.back\(\);/.test(app));
check('abertura (F5, guia nova) e login vão à tela do endereço',
  app.includes('if (!aplicarTelaDoEndereco()) restoreLastRoute();') && app.includes('await loadModule(state.activeModule);\n      await abertura;'));
check('módulo inexistente ou sem permissão cai no Dashboard',
  app.includes("const existe = doEndereco.module === 'dashboard' || Object.prototype.hasOwnProperty.call(moduleLabels, doEndereco.module);"));
check('os filtros da lista de vendas mantêm a tela no endereço', app.includes("+ window.location.hash);"));

console.log('\n--- menus e blocos são links ---');
check('Ctrl/Shift/Cmd+clique fica com o navegador (nova guia)', /evento\.ctrlKey \|\| evento\.metaKey \|\| evento\.shiftKey \|\| evento\.altKey \|\| evento\.button !== 0\) \{\s*evento\.stopPropagation\(\);/.test(app));
check('  e o clique simples não recarrega', /evento\.preventDefault\(\);\s*\}, true\);/.test(app));
check('barra lateral: módulos e telas', app.includes('<a class="nav-item nav-open-item') && app.includes('<a class="sub-item sub-open-item'));
check('área de trabalho: blocos e mais usadas', workspace.includes('<a class="workspace-tile-link" ${linkDoBloco(moduleName, item.key)}') && workspace.includes('<a class="workspace-atalho" ${linkDoBloco('));
check('Dashboard: favoritos', dashboard.includes('<a class="dashboard-module-title" ${linkDoFavorito(') && dashboard.includes('<a class="dashboard-tab-open" ${linkDoFavorito('));
check('Atalhos: "ir para"', atalhos.includes('<a class="atalho-item atalho-item-ir"'));
check('link sem cara de link, alfinete por cima', css.includes(':where(a[data-tela-link]) { color: inherit; text-decoration: none; }')
  && css.includes('.workspace-tile .workspace-fixar { z-index: 2; }'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
