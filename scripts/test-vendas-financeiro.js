#!/usr/bin/env node
// Contas a receber geradas por um pedido faturado (lib/vendas-financeiro.js).
//
// É dinheiro: o que este teste protege é a soma. Um pedido de R$ 1.000 tem que
// gerar exatamente R$ 1.000 a receber — em uma parcela ou em cinco.
const { parcelasDoPedido } = require('../lib/vendas-financeiro');

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };
const soma = (ps) => Math.round(ps.reduce((s, p) => s + p.amount, 0) * 100) / 100;
const pedido = (over = {}) => ({ code: 1234, date: '2026-08-06', totalAmount: 1000, payments: [], ...over });

console.log('\n--- sem linhas de pagamento: parcela única ---');
const unica = parcelasDoPedido(pedido());
check('gera uma parcela', unica.length === 1);
check('no valor total', unica[0].amount === 1000);
check('vence na data do pedido', unica[0].dueDate === '2026-08-06');
check('descrição identifica o pedido', unica[0].description === 'Pedido 1234', unica[0].description);

console.log('\n--- validade do orçamento vira vencimento quando existe ---');
const comVencimento = parcelasDoPedido(pedido({ dueDate: '2026-09-06' }));
check('usa dueDate', comVencimento[0].dueDate === '2026-09-06');

console.log('\n--- com as linhas da aba Pagamentos ---');
const parcelado = parcelasDoPedido(pedido({
  payments: [
    { methodName: 'Boleto', dueDate: '2026-09-06', amount: 600 },
    { methodName: 'PIX', dueDate: '2026-10-06', amount: 400 }
  ]
}));
check('uma conta a receber por linha', parcelado.length === 2);
check('a soma bate com o total', soma(parcelado) === 1000, String(soma(parcelado)));
check('vencimentos preservados', parcelado[0].dueDate === '2026-09-06' && parcelado[1].dueDate === '2026-10-06');
check('descrição numera e nomeia a forma', parcelado[0].description === 'Pedido 1234 · Parcela 1/2 · Boleto', parcelado[0].description);

console.log('\n--- linhas zeradas ou vazias não viram conta a receber ---');
const comZeros = parcelasDoPedido(pedido({
  payments: [{ methodName: 'Boleto', amount: 1000 }, { methodName: 'PIX', amount: 0 }, { amount: null }]
}));
check('ignora as linhas sem valor', comZeros.length === 1, `${comZeros.length} parcela(s)`);
check('total preservado', soma(comZeros) === 1000);

console.log('\n--- arredondamento: 1000 em 3x ---');
const tresVezes = parcelasDoPedido(pedido({
  payments: [{ amount: 333.33 }, { amount: 333.33 }, { amount: 333.33 }]
}));
check('continuam 3 parcelas (não vira linha de diferença)', tresVezes.length === 3, `${tresVezes.length}`);
check('o centavo entra na última', tresVezes[2].amount === 333.34, String(tresVezes[2].amount));
check('a soma fecha exatamente', soma(tresVezes) === 1000, String(soma(tresVezes)));

console.log('\n--- pagamentos que não cobrem o pedido ---');
const faltando = parcelasDoPedido(pedido({ payments: [{ methodName: 'PIX', amount: 400 }] }));
check('a diferença vira uma linha, não some', faltando.length === 2, `${faltando.length} parcela(s)`);
check('valor da diferença certo', faltando[1].amount === 600, String(faltando[1].amount));
check('a linha diz o que é', /Diferença/.test(faltando[1].description), faltando[1].description);
check('a soma fecha com o pedido', soma(faltando) === 1000);

console.log('\n--- pagamentos acima do total ---');
const sobrando = parcelasDoPedido(pedido({ payments: [{ amount: 1200 }] }));
check('a diferença negativa aparece', sobrando.length === 2 && sobrando[1].amount === -200, String(sobrando[1]?.amount));
check('a soma volta ao total do pedido', soma(sobrando) === 1000);

console.log('\n--- pedido sem valor não gera nada ---');
check('total zero', parcelasDoPedido(pedido({ totalAmount: 0 })).length === 0);
check('total negativo', parcelasDoPedido(pedido({ totalAmount: -50 })).length === 0);
check('registro vazio', parcelasDoPedido(null).length === 0);
check('pagamentos preenchidos mas total zero', parcelasDoPedido(pedido({ totalAmount: 0, payments: [{ amount: 500 }] })).length === 0);

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
process.exit(falhas === 0 ? 0 : 1);
