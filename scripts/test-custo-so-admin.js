#!/usr/bin/env node
/**
 * O CUSTO DO PRODUTO SÓ PARA ADMINISTRADOR (14/10/2026).
 *
 * Pedido urgente do usuário: "nenhum usuário comum pode ter acesso ao preço de
 * custo de um produto conforme pesquisam". Bloqueio no servidor
 * (lib/custo-oculto.js + sendJson), não só na tela.
 *
 * Provado no banco local com um usuário comum de teste (apagado depois):
 *   produtos, estoque e meta de vendas: 0 campos de custo (admin: milhares)
 *   inventário, Valor em Estoque e exportação de estoque: 403
 *   relatórios: sem custo, margem, lucro, valor em estoque e último preço
 *     (na tela e no CSV)
 *   ordenar por custo vira ordem por nome
 *   gestor de preços e cadastro com custo R$ 1,00: custo continuou 1.435,13
 *   telas: sem coluna, cartão ou campo de custo
 */
const fs = require('fs');
const path = require('path');
const C = require('../lib/custo-oculto');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. o filtro ---');
const filtrado = C.semCusto({ products: [{ id: 1, name: 'A', costPrice: 10, salePrice: 20, margin: 50 }], totais: { custo: 5, produtos: 2 }, costCenter: 'x' });
check('tira custo e margem do produto, em qualquer profundidade', !('costPrice' in filtrado.products[0]) && !('margin' in filtrado.products[0]) && filtrado.products[0].salePrice === 20);
check('  e dos totais', !('custo' in filtrado.totais) && filtrado.totais.produtos === 2);
check('centro de custo não é custo de produto', filtrado.costCenter === 'x');
const rel = C.relatorioSemCusto({
  colunas: [{ campo: 'produto' }, { campo: 'saldo' }, { campo: 'custo' }, { campo: 'lucro' }, { campo: 'valor' }],
  linhas: [{ produto: 'A', saldo: 2, custo: 10, lucro: 5, valor: 20 }], totais: ['saldo', 'custo', 'valor']
});
check('relatório: colunas de custo e lucro saem', rel.colunas.map((c) => c.campo).join(',') === 'produto,saldo');
check('  e o "valor" (saldo × custo) quando havia custo', !('valor' in rel.linhas[0]) && rel.totais.join(',') === 'saldo');
const venda = C.relatorioSemCusto({ colunas: [{ campo: 'cliente' }, { campo: 'valor' }], linhas: [{ cliente: 'X', valor: 9 }], totais: ['valor'] });
check('  sem coluna de custo, o "valor" (de venda) fica', venda.colunas.length === 2 && venda.linhas[0].valor === 9);
['valorEmEstoque', 'ultimoPreco', 'margemPercentual', 'custoUnitario', 'stockValue'].forEach((campo) => {
  check(`"${campo}" é tratado como custo`, C.CAMPOS_DE_CUSTO.has(campo));
});

console.log('\n--- 2. o servidor ---');
const servidor = ler('server.js');
check('marca a resposta de quem não é administrador', servidor.includes('if (usuarioDaVez && !(await ehAdmin(usuarioDaVez))) {') && servidor.includes('res.__ocultarCusto = true;'));
check('toda resposta JSON passa pelo filtro', servidor.includes('if (res.__ocultarCusto && statusCode < 400) payload = custoOculto.semCusto(payload);'));
check('inventário, Valor em Estoque e a exportação dele fechados',
  servidor.includes("if (pathname.startsWith('/api/stock/inventories') || pathname === '/api/reports/estoque/export'")
  && servidor.includes("'Esta tela é calculada pelo custo dos produtos: só administrador.'"));
check('relatórios sem custo na tela e no CSV (catálogo e personalizados)',
  (servidor.match(/custoOculto\.relatorioSemCusto\(/g) || []).length >= 2);
check('ordenar por custo ou margem vira ordem por nome', servidor.includes("res.__ocultarCusto && ['costPrice', 'margin'].includes(ordemPedida) ? 'name' : ordemPedida"));
check('o comum não altera o custo: cadastro, gestor de preços e rota antiga',
  servidor.includes('costPrice: res.__ocultarCusto && existing ? stockCore.toNumber(existing.costPrice) : stockCore.toNumber(body.costPrice),')
  && servidor.includes('const costPrice = res.__ocultarCusto ? stockCore.toNumber(product.costPrice) : stockCore.toNumber(update.costPrice, product.costPrice);')
  && servidor.includes('costPrice: res.__ocultarCusto && anterior ? Number(anterior.costPrice || 0) : Number(body.costPrice || 0),'));

console.log('\n--- 3. as telas ---');
const admin = "typeof usuarioEhAdmin === 'function' && usuarioEhAdmin()";
check('lista de produtos: sem coluna nem cartão de custo e margem', ler('public/modules/stock/subs/products.js').includes(admin));
check('cadastro do produto: sem o campo Custo', ler('public/modules/stock/subs/new_product.js').includes(admin));
check('gestor de preços: sem Custo e Margem', ler('public/modules/stock/subs/price_manager.js').includes(admin));
check('tabela de preços e situação do produto', ler('public/modules/stock/subs/new_price_table.js').includes(admin) && ler('public/modules/stock/subs/product_status.js').includes(admin));
check('painel inicial não quebra sem o valor do estoque', ler('public/app.js').includes("dashboardPermissions.stock && typeof data.stockValue === 'number'"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
