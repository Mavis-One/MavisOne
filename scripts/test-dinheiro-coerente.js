#!/usr/bin/env node
/**
 * O DINHEIRO NÃO SE PERDE NEM TROCA DE SINAL (fase BQ).
 *
 * Quatro defeitos em que o número gravado deixava de ser o número certo. Todos
 * reproduzidos num banco de prova, com `git stash` para medir o antes.
 *
 * 1. DUPLICAR EM LOTE GRAVAVA A CÓPIA COM TOTAL R$ 0,00.
 *
 *    A cópia é montada a partir do registro SERIALIZADO, e o serializer publica
 *    o total no campo `amount` — não em `totalAmount`, que é o nome que o
 *    montador da linha lê. O spread trazia `totalAmount: undefined`.
 *
 *      antes  pedido 1001: itens 4770, total 4293
 *             cópia 1002: itens 4770, total 0, cliente VAZIO
 *      depois cópia 1002: itens 4770, total 4293, cliente "Cliente Teste"
 *
 *    Os totais são RECALCULADOS, não traduzidos: é a mesma conta que a criação
 *    e a edição fazem, então a cópia nasce coerente com os próprios itens.
 *
 * 2. PAGAMENTOS MAIORES QUE O PEDIDO VIRAVAM UMA CONTA A RECEBER NEGATIVA.
 *
 *    A diferença entre o total e a soma das parcelas virava uma linha extra —
 *    inclusive quando negativa. Um título de -R$ 100,00 SUBTRAI do total a
 *    receber do período em vez de somar, e ninguém procura um valor com o sinal
 *    trocado: o painel fechava menor que a soma das parcelas visíveis.
 *
 *    Recusar, e não aparar: se as linhas somam mais que o pedido, uma das duas
 *    coisas está errada, e aparar em silêncio escolheria qual sem perguntar.
 *
 * 3. A NF-e SAÍA PELO VALOR BRUTO DOS ITENS.
 *
 *    Só os itens viajavam do pedido para a tela de emissão, e ela somava as
 *    linhas. Um pedido de R$ 1.000,00 com 10% de desconto virava uma conta a
 *    receber de R$ 900,00 e uma NF-e de R$ 1.000,00 — a nota sai por um valor
 *    que a venda não teve, e o fiscal nunca fecha com o financeiro.
 *
 *    O servidor já sabia receber desconto/frete/despesas: era a tela que não os
 *    mandava.
 *
 * 4. DESCONTO DE COMPRA SEM TETO gerava conta a PAGAR negativa, que diminui o
 *    total a pagar do período. Vendas já tinha o teto; Compras, não.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const corpoDe = (nome) => {
  const m = new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n\\}`).exec(src);
  return m ? m[0] : '';
};

console.log('--- 1. a cópia nasce com o total certo ---');
const duplicar = corpoDe('duplicarSalesRecord');
check('duplicarSalesRecord existe', duplicar.length > 0);
check('  recalcula os totais em vez de copiar o campo',
  /const totaisDaCopia = computeSalesTotals\(serializado\.items \|\| \[\], serializado\);/.test(duplicar));
check('  e grava pelo mesmo montador da criação',
  /\.\.\.salesFinanceFields\(serializado, totaisDaCopia\),/.test(duplicar));
// O serializer chama o cliente de `customer`; a gravação lê clientSupplierName.
check('  o nome do cliente também é traduzido',
  /clientSupplierName: serializado\.clientSupplierName \|\| serializado\.customer \|\| '',/.test(duplicar));

console.log('--- 2. pagamento a mais é recusado, não vira título negativo ---');
const { parcelasDoPedido } = require('../lib/vendas-financeiro');
const pedido = { id: 'o1', code: 1001, date: '2026-09-04', dueDate: '2026-10-04', totalAmount: 900 };
const exato = parcelasDoPedido({ ...pedido, payments: [{ amount: 900 }] }, new Map(), {});
check('pagamento exato gera uma parcela só', exato.length === 1 && exato[0].amount === 900);
// A dívida que não pode sumir: pagaram menos, o resto continua a receber.
const aMenos = parcelasDoPedido({ ...pedido, payments: [{ amount: 800 }] }, new Map(), {});
check('pagamento a MENOS ainda gera a diferença', aMenos.length === 2 && aMenos[1].amount === 100);
check('  e ela nunca nasce quitada', aMenos[1].quitaNaHora === false);
let recusou = '';
try {
  parcelasDoPedido({ ...pedido, payments: [{ amount: 1000 }] }, new Map(), {});
} catch (erro) {
  recusou = erro.message;
}
check('pagamento a MAIS é recusado', Boolean(recusou), recusou.slice(0, 60) + '...');
check('  dizendo os dois números', /1000\.00/.test(recusou) && /900\.00/.test(recusou));
// Um centavo de diferença é arredondamento de parcela (1000/3), não erro de
// digitação: continua indo na última parcela em vez de virar linha ou recusa.
const centavo = parcelasDoPedido({ ...pedido, totalAmount: 900.02, payments: [{ amount: 900 }] }, new Map(), {});
check('e um centavo continua sendo ajuste, não recusa', centavo.length === 1);

console.log('--- 3. a NF-e sai pelo valor da venda ---');
const appSrc = ler('public/app.js');
const telaSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('o pedido leva desconto, frete e despesas para a emissão',
  /desconto: totaisDaNota\.descontoTotal \|\| 0,/.test(appSrc)
  && /frete: totaisDaNota\.freteCobrado \|\| 0,/.test(appSrc)
  && /outrasDespesas: \(totaisDaNota\.despesasGerais \|\| 0\) \+ \(totaisDaNota\.taxaMontagem \|\| 0\)/.test(appSrc));
// freteCobrado já vem zero quando o frete é por conta do emitente: esse não
// entra no valor da nota.
check('  usando o cálculo, não remontando do formulário', /const totaisDaNota = computeTotals\(\);/.test(appSrc));
check('a tela guarda os três valores', /const desconto = doPedido \? Number\(doPedido\.desconto \|\| 0\) : 0;/.test(telaSrc));
check('  o total exibido passa a ser o da nota',
  /return Math\.round\(\(totalDosItens\(\) \+ frete \+ outrasDespesas - desconto\) \* 100\) \/ 100;/.test(telaSrc));
check('  e o corpo enviado os leva', /\.\.\.\(desconto \? \{ desconto \} : \{\}\),/.test(telaSrc));
check('  com a modalidade de frete junto', /\.\.\.\(frete \? \{ frete, modalidadeFrete: 0 \} : \{\}\),/.test(telaSrc));

// A prova de que os dois lados fecham: itens - desconto + frete + despesas tem
// de dar exatamente o total do pedido.
const totais = require('../public/modules/shared/sales_totals');
const t = totais.computeSalesTotals({
  items: [{ quantity: 1, unitPrice: 1000, total: 1000 }],
  discountPercent: 10, freight: 50, chargeFreightToBuyer: true, generalExpenses: 20
});
const naNota = 1000 - t.descontoTotal + t.freteCobrado + (t.despesasGerais + t.taxaMontagem);
check('o valor da nota bate com o total do pedido', naNota === t.totalAmount, `${naNota} = ${t.totalAmount}`);
const semFrete = totais.computeSalesTotals({
  items: [{ quantity: 1, unitPrice: 1000, total: 1000 }],
  discountPercent: 10, freight: 50, chargeFreightToBuyer: false
});
check('  e frete por conta do emitente não entra', semFrete.freteCobrado === 0 && semFrete.totalAmount === 900);

console.log('--- 4. desconto de compra tem teto ---');
const compras = require('../public/modules/shared/purchase_totals');
const doc = { items: [{ productId: 'p1', quantity: 2, unitCost: 50 }], freight: 10, otherExpenses: 0 };
check('desconto normal passa inteiro', compras.calcular({ ...doc, discountAmount: 30 }).totalAmount === 80);
check('desconto maior que a nota é aparado', compras.calcular({ ...doc, discountAmount: 500 }).totalAmount === 0);
check('  e nunca deixa o total negativo', compras.calcular({ ...doc, discountAmount: 500 }).discountAmount === 110);
check('desconto negativo vira zero', compras.calcular({ ...doc, discountAmount: -20 }).totalAmount === 110);
// A flag sobe para a tela poder avisar em vez de mudar o número em silêncio.
check('o aparo é sinalizado', compras.calcular({ ...doc, discountAmount: 500 }).descontoAparado === true);
check('  e não é sinalizado quando não houve', compras.calcular({ ...doc, discountAmount: 30 }).descontoAparado === false);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
