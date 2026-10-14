#!/usr/bin/env node
/**
 * O CÓDIGO DO PRODUTO NÃO MUDA (fase EJ, 13/10/2026).
 *
 * Pedido do usuário: "proíba em todo o sistema a modificação dos números de um
 * código de produto". Três camadas, e a que garante é a do banco:
 *   - gatilho products_sku_imutavel recusa trocar o sku de um produto que já
 *     tem um (vale para cadastro, gestor de preços, importação, script);
 *   - as duas rotas que gravam produto respondem com a mensagem clara;
 *   - a tela de edição mostra o SKU só de leitura.
 * Produto sem código ainda recebe o primeiro.
 *
 * Provado no banco local, numa transação desfeita: trocar 9589 -> 9999 é
 * recusado; regravar o mesmo código, mudar outro campo e dar o primeiro código
 * passam; o upsert (insert ... on conflict do update) também é recusado. Pela
 * API, as duas rotas devolvem "O código 9589 deste produto não pode ser
 * alterado." e o produto fica intacto.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. o banco recusa ---');
const migracao = ler('banco/migrations/fase-ej-codigo-do-produto-imutavel.sql');
check('gatilho antes de atualizar o sku', /create trigger products_sku_imutavel\s+before update of sku on products/.test(migracao));
check('  mesmo código passa', /if new\.sku is not distinct from old\.sku then\s+return new;/.test(migracao));
check('  produto sem código recebe o primeiro', /if coalesce\(btrim\(old\.sku\), ''\) = '' then\s+return new;/.test(migracao));
check('  o resto é recusado', /raise exception 'O codigo \(SKU\) % do produto nao pode ser alterado\.'/.test(migracao));
check('e o SQL de recriar do zero já tem o gatilho', /products_sku_imutavel/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

console.log('\n--- 2. o servidor diz o porquê ---');
const servidor = ler('server.js');
check('cadastro de produto recusa trocar o código',
  /if \(skuGravado && skuGravado !== sku\) \{\s+return sendJson\(res, \{ error: `O código \$\{skuGravado\} deste produto não pode ser alterado\.` \}, 400\);/.test(servidor));
check('  e grava o código como está no banco', /sku: skuGravado \? existing\.sku : sku,/.test(servidor));
check('a rota antiga também', /deste produto não pode ser alterado\.` \}, 400\);[\s\S]{0,400}sku: anterior && String\(anterior\.sku \|\| ''\)\.trim\(\) \? anterior\.sku : body\.sku,/.test(servidor));

console.log('\n--- 3. a tela ---');
const tela = ler('public/modules/stock/subs/new_product.js');
check('editando, o SKU é só de leitura', /current && String\(current\.sku \|\| ''\)\.trim\(\)[\s\S]{0,200}<input name="sku" readonly/.test(tela));
check('  e produto novo continua com o campo livre e obrigatório', /<label>SKU<input name="sku" required value=/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
