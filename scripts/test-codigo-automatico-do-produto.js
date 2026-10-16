#!/usr/bin/env node
/**
 * O CÓDIGO DO PRODUTO NOVO SAI DA SEQUÊNCIA (16/10/2026). Pedido do usuário:
 * "verifique os códigos dos produtos para gerar códigos automáticos de acordo
 * com a sequência".
 *
 * No banco local, em 16/10/2026: 5.821 códigos numéricos, a sequência do
 * Viper indo até 101297 e dois soltos acima (108442 e 902534). O próximo saiu
 * 101298 — e não 902535, que é o que "o maior + 1" daria.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const { proximoCodigo, umPorVez } = require('../lib/codigo-do-produto');
const entradaNfe = require('../lib/entradaNfe');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const faixa = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => String(de + i));

console.log('--- 1. a regra da sequência ---');
const catalogo = [...faixa(1, 120), ...faixa(101250, 101297), '108442', '902534', 'BR-0026', '9913-2', 'SEMCOD-001', ''];
check('segue a sequência, sem pular para os códigos soltos', proximoCodigo(catalogo) === '101298', proximoCodigo(catalogo));
check('código com letra não conta', proximoCodigo(['ABC-9', ...faixa(10, 20)]) === '21', proximoCodigo(['ABC-9', ...faixa(10, 20)]));
check('pula o que já existe quando alcança um solto', proximoCodigo([...faixa(108430, 108441), '108442', '108443']) === '108444',
  proximoCodigo([...faixa(108430, 108441), '108442', '108443']));
check('  inclusive com zero à esquerda', proximoCodigo([...faixa(10, 20), '021']) === '22', proximoCodigo([...faixa(10, 20), '021']));
check('catálogo sem sequência: o maior + 1', proximoCodigo(['5', '900']) === '901', proximoCodigo(['5', '900']));
check('catálogo vazio: 1', proximoCodigo([]) === '1', proximoCodigo([]));
check('furo no meio da sequência não é reaproveitado', proximoCodigo([...faixa(100, 150), ...faixa(160, 200)]) === '201');

(async () => {
  console.log('\n--- 2. um código por vez ---');
  const ordem = [];
  const devagar = (nome, ms) => () => new Promise((r) => setTimeout(() => { ordem.push(nome); r(nome); }, ms));
  const falha = () => Promise.reject(new Error('falhou'));
  const resultados = await Promise.allSettled([umPorVez(devagar('a', 30)), umPorVez(falha), umPorVez(devagar('b', 1))]);
  check('cada um espera o anterior terminar', ordem.join(',') === 'a,b', ordem.join(','));
  check('  e o erro de um não trava a fila', resultados[1].status === 'rejected' && resultados[2].value === 'b');

  console.log('\n--- 3. o servidor ---');
  const servidor = ler('server.js');
  check('rota do próximo código, antes da rota por id',
    servidor.indexOf("pathname === '/api/stock/products/proximo-codigo' && req.method === 'GET'") > 0
    && servidor.indexOf("pathname === '/api/stock/products/proximo-codigo'") < servidor.indexOf("if (/^\\/api\\/stock\\/products\\/[^/]+$/.test(pathname) && req.method === 'GET')"));
  check('  com a permissão do Estoque', /proximo-codigo' && req\.method === 'GET'\) \{\s*try \{\s*const user = await getCurrentUser\(req\);\s*if \(!userCanStock\(user\)\)/.test(servidor));
  check('sem código, ou com o sugerido, o código sai da sequência',
    /const codigoAutomatico = !skuGravado && \(!sku \|\| body\.codigoAutomatico === true\);/.test(servidor));
  check('  e só o digitado à mão é conferido contra repetição',
    /if \(!skuGravado && !codigoAutomatico\) \{\s*const duplicated = /.test(servidor));
  check('  lido e gravado na mesma vez da fila',
    /const product = codigoAutomatico \? await codigoDoProduto\.umPorVez\(gravarProduto\) : await gravarProduto\(\);/.test(servidor));
  check('não sobrou "Informe o SKU"', !/Informe o SKU do produto/.test(servidor));
  check('o banco lê o código de todos os produtos', /async function proximoCodigoDeProduto\(\) \{\s*const \{ data, error \} = await banco\.from\('products'\)\.select\('sku'\);/.test(ler('lib/db/estoque.js')));

  console.log('\n--- 4. as telas ---');
  const tela = ler('public/modules/stock/subs/new_product.js');
  check('Novo Produto já abre com o próximo código', /codigoSugerido = String\(\(await api\('\/api\/stock\/products\/proximo-codigo'\)\)\.codigo \|\| ''\);/.test(tela));
  check('  e avisa o servidor quando ninguém mudou o sugerido',
    /codigoAutomatico: codigoLivre && Boolean\(codigoSugerido\) && String\(formData\.get\('sku'\) \|\| ''\)\.trim\(\) === codigoSugerido,/.test(tela));
  check('  e o aviso mostra o código que ficou', /`Produto \$\{salvo\?\.product\?\.sku \|\| ''\} criado\.`/.test(tela));
  const atalhos = ler('public/modules/shared/atalhos.js');
  check('o atalho Novo Produto deixa o código em branco', /\{ name: 'sku', label: 'Código', placeholder: 'Automático', linha: 1 \}/.test(atalhos));
  const entrada = ler('public/modules/purchases/subs/entrada_nfe.js');
  check('a entrada de nota cadastra com o código da sequência e o do fornecedor em C.Fabricante',
    /sku: '',\s*codigoFabricante: s\.sku \|\| '',/.test(entrada) && !/Este item não tem código no XML/.test(entrada));

  console.log('\n--- 5. a próxima nota acha o produto pelo C.Fabricante ---');
  const produtos = [{ id: 'p1', name: 'OUTRO', sku: '101298', codigoFabricante: 'ADASIN1009' }];
  const vinculo = entradaNfe.vincularItem({ codigo: 'adasin1009', descricao: 'TUBO' }, produtos, {});
  check('cProd igual ao C.Fabricante', vinculo && vinculo.produtoId === 'p1' && vinculo.por === 'codigo', JSON.stringify(vinculo));
  const peloSku = entradaNfe.vincularItem({ codigo: '101298', descricao: 'TUBO' }, [...produtos, { id: 'p2', name: 'X', sku: 'Z', codigoFabricante: '101298' }], {});
  check('  o código do produto ainda vem antes', peloSku && peloSku.produtoId === 'p1', JSON.stringify(peloSku));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
