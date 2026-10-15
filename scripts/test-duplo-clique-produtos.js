#!/usr/bin/env node
/**
 * DUPLO CLIQUE NA LISTA DE PRODUTOS ABRE O PRODUTO (15/10/2026). Pedido do
 * usuário: "adicione o double click nos produtos". O mesmo que o lápis, como na
 * lista de Pedidos (app.js, tr[data-abrir-registro]).
 *
 * Provado no navegador (servidor local, clique duplo de mouse de verdade pelo
 * protocolo do Chrome): no nome, abriu Estoque › produto com o nome no
 * formulário; no botão "estoque por depósito" da mesma linha, só fez o que o
 * botão faz e não abriu a edição.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const tela = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'public/modules/stock/subs/products.js'), 'utf8'));

check('cada linha sabe qual produto abre', /<tr data-abrir-produto="\$\{S\.escape\(product\.id\)\}">/.test(tela));
check('duplo clique abre a edição, como o lápis',
  /tr\[data-abrir-produto\]'\)\.forEach\(\(linha\) => \{\s*linha\.addEventListener\('dblclick', \(evento\) => \{[\s\S]{0,300}state\.stockEditProductId = linha\.dataset\.abrirProduto;\s*state\.activeSub = 'new_product';\s*loadModule\('stock'\);/.test(tela));
check('  menos nos botões e campos da linha', /addEventListener\('dblclick', \(evento\) => \{\s*if \(evento\.target\.closest\('input, button, a, select, label'\)\) return;/.test(tela));
check('  e não deixa o texto selecionado pelo duplo clique', /selecao\.removeAllRanges\(\)/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
