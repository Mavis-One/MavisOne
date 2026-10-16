#!/usr/bin/env node
/**
 * CADASTRO DE PRODUTO: O MODELO, AO LADO DA MARCA (16/10/2026). Pedido do
 * usuário: "um campo para adicionar a marca/modelo no cadastro de produtos".
 *
 * A Marca já existia (fase EP, guardada em productMeta.brand). O Modelo entra
 * do mesmo jeito: campo de texto com sugestão dos modelos já usados (digitar
 * um novo é criá-lo), gravado em productMeta.model e devolvido no produto.
 *
 * Provado no navegador: a linha mostra Grupo, Marca e Modelo; marca e modelo
 * gravados, reabertos com os valores e o modelo sugerido na lista (produto
 * restaurado depois).
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const stockCore = require(path.join(RAIZ, 'lib/stock-core'));

console.log('\n--- gravar e devolver ---');
const novo = stockCore.buildProductMeta({ brand: ' MAVIS ', model: ' FLAME 500 ' }, {});
check('grava o modelo, sem espaços nas pontas', novo.model === 'FLAME 500' && novo.brand === 'MAVIS');
check('editar sem mandar o modelo mantém o que havia', stockCore.buildProductMeta({ name: 'x' }, { model: 'FLAME 500' }).model === 'FLAME 500');
check('mandar vazio limpa', stockCore.buildProductMeta({ model: '' }, { model: 'FLAME 500' }).model === '');
const data = { productMeta: { p1: { brand: 'MAVIS', model: 'FLAME 500' } }, deposits: [], stockMovements: [], productCategories: [] };
const serializado = stockCore.serializeProduct({ id: 'p1', name: 'X', costPrice: 0, salePrice: 0 }, data);
check('o produto volta com marca e modelo', serializado.model === 'FLAME 500' && serializado.brand === 'MAVIS', JSON.stringify({ b: serializado.brand, m: serializado.model }));

console.log('\n--- a tela ---');
const tela = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/modules/stock/subs/new_product.js'), 'utf8'));
check('campo "Modelo do Produto" logo depois da Marca', /<label>Marca do Produto[\s\S]{0,250}<\/label>\s*<label>Modelo do Produto\s*<input name="model" list="produtoModelos" value="\$\{value\('model'\)\}"/.test(tela));
check('com a sugestão dos modelos usados', /<datalist id="produtoModelos">\$\{\(meta\.modelos \|\| \[\]\)/.test(tela));
check('e vai no envio', /brand: formData\.get\('brand'\),\s*model: formData\.get\('model'\),/.test(tela));
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
check('o servidor manda a lista de modelos', /modelos: \[\.\.\.new Set\(Object\.values\(data\.productMeta \|\| \{\}\)\s*\.map\(\(m\) => String\(\(m && m\.model\) \|\| ''\)\.trim\(\)\)/.test(server));
const css = fs.readFileSync(path.join(RAIZ, 'public/app.css'), 'utf8');
check('a linha ganhou uma coluna', /\.produto-linha-grupo \{ grid-template-columns: minmax\(0, 2fr\) minmax\(0, 2fr\) minmax\(0, 2fr\) auto auto auto;/.test(css));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
