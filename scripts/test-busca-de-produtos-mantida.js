#!/usr/bin/env node
/**
 * A BUSCA DE PRODUTOS FICA ATÉ TROCAR DE MÓDULO (15/10/2026). Pedido do
 * usuário: "quando eu pesquisar um produto, independente da minha ação
 * referente a classe ou ao produto em si, apenas se eu trocar de modulo eu
 * quero perder minha busca".
 *
 * Provado no navegador (Cadastros › Produtos, banco local): buscar
 * "autopropelido", abrir a edição e voltar, abrir o Status do Produto (que pula
 * para o Estoque) e voltar pelo navegador — a busca e a lista filtrada voltam;
 * Financeiro e de novo Cadastros › Produtos pelo menu — a lista abre do zero.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const tela = ler('public/modules/stock/subs/products.js');
const app = ler('public/app.js');

check('filtros, página e ordem voltam do que ficou guardado',
  tela.includes('const buscaGuardada = state.buscasDasTelas.produtos || {};')
  && tela.includes('Object.assign(filters, buscaGuardada.filters || {});')
  && tela.includes('let pagina = buscaGuardada.pagina || 1;')
  && tela.includes("const ordem = { campo: 'name', direcao: 'asc', ...(buscaGuardada.ordem || {}) };"));
check('  e são guardados a cada desenho da lista', /async function render\(\) \{\s*guardarBusca\(\);/.test(tela));
check('só o menu esvazia: trocar de módulo', /function trocarDeModulo\(destino\) \{\s*if \(destino !== state\.activeModule\) state\.buscasDasTelas = \{\};\s*\}/.test(app));
check('  os três cliques de módulo do menu e o logo chamam a troca', (app.match(/trocarDeModulo\(/g) || []).length === 5);
check('  e o loadModule não esvazia (abrir, salvar e voltar mantêm)', !/async function loadModule[\s\S]{0,1500}buscasDasTelas/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
