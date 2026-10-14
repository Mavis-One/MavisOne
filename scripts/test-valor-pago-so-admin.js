#!/usr/bin/env node
/**
 * O VALOR PAGO NAS COMPRAS SÓ PARA ADMINISTRADOR (14/10/2026).
 *
 * Continuação do bloqueio do custo (test-custo-so-admin.js): o usuário pediu
 * para esconder também o valor pago em Compras e nas movimentações de estoque,
 * porque ali o preço pago é o próprio custo.
 *
 * Provado no banco local com um usuário comum de teste (apagado depois):
 *   ordem de compra, histórico e /api/purchases: nenhum valor
 *   movimentações e ficha do produto: sem custo unitário/total
 *     (a contagem `total` da lista continua)
 *   XML da nota de entrada: 403
 *   o comum mudou a quantidade da ordem: custo 12,34, frete, despesas e
 *     desconto continuaram os gravados
 *   telas: sem coluna Total/Custo, sem frete e total na edição; console limpo
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
// Os dois em fila, como no sendJson: o custo sai por semCusto, o resto aqui.
const comoNoServidor = (payload) => C.semValorPago(C.semCusto(payload));
const doc = comoNoServidor({
  documentos: [{
    id: 'd1', code: 7, items: [{ productId: 'p1', quantity: 2, unitCost: 10, total: 20 }],
    itemsTotal: 20, freight: 5, otherExpenses: 1, discountAmount: 0, totalAmount: 26
  }],
  total: 1
});
const d = doc.documentos[0];
check('tira o valor pago do documento e do item', !('itemsTotal' in d) && !('totalAmount' in d) && !('freight' in d)
  && !('unitCost' in d.items[0]) && !('total' in d.items[0]));
check('  e deixa quantidade, número e a contagem do topo', d.items[0].quantity === 2 && d.code === 7 && doc.total === 1);
const conferencia = comoNoServidor({
  nota: {
    numero: '123', totais: { produtos: 100, nota: 110, icms: 12 },
    duplicatas: [{ numero: '001', vencimento: '2026-11-01', valor: 110 }]
  },
  itens: [{ numero: 1, quantidade: 3, valorUnitario: 33.33, valorTotal: 100, icms: { cst: '00', base: 100, aliquota: 12, valor: 12 } }],
  produtos: [{ id: 'p1', name: 'A' }]
});
check('nota de entrada: totais, duplicatas e unitário saem',
  Object.keys(conferencia.nota.totais).length === 0 && !('valor' in conferencia.nota.duplicatas[0])
  && !('valorUnitario' in conferencia.itens[0]) && !('valorTotal' in conferencia.itens[0]));
check('  o grupo do ICMS fica (CST e alíquota), sem base e valor',
  conferencia.itens[0].icms.cst === '00' && conferencia.itens[0].icms.aliquota === 12 && !('base' in conferencia.itens[0].icms) && !('valor' in conferencia.itens[0].icms));
check('  a lista de produtos do seletor fica (só número sai)', Array.isArray(conferencia.produtos) && conferencia.produtos.length === 1);
check('custo da movimentação é custo em toda resposta', C.CAMPOS_DE_CUSTO.has('unitCost') && C.CAMPOS_DE_CUSTO.has('totalCost'));

console.log('\n--- 2. o servidor ---');
const servidor = ler('server.js');
check('respostas de Compras passam pelo filtro do valor pago',
  servidor.includes("if (pathname.startsWith('/api/purchases')) res.__ocultarValorPago = true;")
  && servidor.includes('if (res.__ocultarValorPago && statusCode < 400) payload = custoOculto.semValorPago(payload);'));
check('o XML da nota de entrada fica só para administrador',
  servidor.includes("'O XML da nota traz o valor pago: só administrador.'"));
check('o comum edita a ordem sem zerar custo, frete, despesas e desconto',
  servidor.includes("return { ...item, unitCost: anterior ? anterior.unitCost : 0 };")
  && servidor.includes("for (const campo of ['freight', 'otherExpenses', 'discountAmount']) {"));

console.log('\n--- 3. as telas ---');
const VE = "typeof usuarioEhAdmin === 'function' && usuarioEhAdmin()";
[
  'public/modules/purchases/subs/new_purchase_order.js',
  'public/modules/purchases/subs/purchase_documents.js',
  'public/modules/purchases/subs/purchase_history.js',
  'public/modules/purchases/subs/suppliers.js',
  'public/modules/purchases/subs/entrada_nfe.js',
  'public/modules/stock/subs/movements.js'
].forEach((arquivo) => check(`${path.basename(arquivo)} pergunta se é administrador`, ler(arquivo).includes(VE)));
const ordem = ler('public/modules/purchases/subs/new_purchase_order.js');
check('na edição do comum, frete e despesas não vão (o servidor mantém)',
  ordem.includes("freight: document.getElementById('compraFrete') ? numeroDoCampo('compraFrete') : undefined,"));
const fornecedores = ler('public/modules/purchases/subs/suppliers.js');
check('fornecedores: a variável nasce antes da linha vazia que a usa',
  fornecedores.indexOf('const veValores') < fornecedores.indexOf('const vazia'));
const movimentos = ler('public/modules/stock/subs/movements.js');
check('movimentações: coluna e detalhe de custo só para administrador',
  movimentos.includes("${veCusto ? '<th>Custo unit.</th>' : ''}") && movimentos.includes("${veCusto ? detailItem('Custo total'"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
