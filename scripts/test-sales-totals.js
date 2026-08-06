#!/usr/bin/env node
// Regras de desconto, frete e soma dos totais de Pedido/Orçamento.
// Mesmo módulo que o navegador usa — se este teste passa, a tela e o servidor
// concordam por construção.
const { computeSalesTotals } = require('../public/modules/shared/sales_totals');

let falhas = 0;
const check = (nome, obtido, esperado) => {
  const ok = obtido === esperado;
  console.log(`${ok ? '  OK ' : '  XX '} ${nome} -> ${obtido}${ok ? '' : ` (esperado ${esperado})`}`);
  if (!ok) falhas++;
};
const itens = (...vals) => vals.map(([q, p]) => ({ quantity: q, unitPrice: p }));

console.log('--- base: 2 x R$ 500 + 1 x R$ 390 = R$ 1.390 ---');
const base = { items: itens([2, 500], [1, 390]) };
check('valor dos produtos', computeSalesTotals(base).valorProdutos, 1390);
check('total sem desconto nem frete', computeSalesTotals(base).totalAmount, 1390);

console.log('\n--- desconto em % ---');
check('10% de 1390 = 139 de desconto', computeSalesTotals({ ...base, discountPercent: 10 }).descontoTotal, 139);
check('total após 10%', computeSalesTotals({ ...base, discountPercent: 10 }).totalAmount, 1251);

console.log('\n--- desconto em R$ ---');
check('R$ 90 de desconto', computeSalesTotals({ ...base, discountAmount: 90 }).descontoTotal, 90);
check('total após R$ 90', computeSalesTotals({ ...base, discountAmount: 90 }).totalAmount, 1300);

console.log('\n--- os dois SOMAM (10% + R$ 50 sobre 1390) ---');
const combinado = computeSalesTotals({ ...base, discountPercent: 10, discountAmount: 50 });
check('desconto % = 139', combinado.descontoPercentual, 139);
check('desconto total = 139 + 50', combinado.descontoTotal, 189);
check('total = 1390 - 189', combinado.totalAmount, 1201);

console.log('\n--- desconto não pode passar da base ---');
const exagerado = computeSalesTotals({ ...base, discountAmount: 9999 });
check('desconto aparado na base', exagerado.descontoTotal, 1390);
check('total nunca negativo', exagerado.totalAmount, 0);
check('marca que foi aparado', exagerado.descontoAparado, true);
check('desconto normal não marca aparado', computeSalesTotals({ ...base, discountAmount: 90 }).descontoAparado, false);

console.log('\n--- percentual fora da faixa ---');
check('500% é limitado a 100%', computeSalesTotals({ ...base, discountPercent: 500 }).percentualAplicado, 100);
check('total com 100% = 0', computeSalesTotals({ ...base, discountPercent: 500 }).totalAmount, 0);
check('percentual negativo vira 0', computeSalesTotals({ ...base, discountPercent: -30 }).descontoTotal, 0);
check('desconto R$ negativo vira 0', computeSalesTotals({ ...base, discountAmount: -100 }).descontoTotal, 0);

console.log('\n--- frete: só soma se for cobrado do comprador ---');
check('cobrando do comprador soma', computeSalesTotals({ ...base, freight: 100, chargeFreightToBuyer: true }).totalAmount, 1490);
check('não cobrando NÃO soma', computeSalesTotals({ ...base, freight: 100, chargeFreightToBuyer: false }).totalAmount, 1390);
check('frete continua registrado', computeSalesTotals({ ...base, freight: 100, chargeFreightToBuyer: false }).frete, 100);
check('padrão é cobrar do comprador', computeSalesTotals({ ...base, freight: 100 }).totalAmount, 1490);

console.log('\n--- frete não entra na base do desconto ---');
const comFrete = computeSalesTotals({ ...base, freight: 200, discountPercent: 10 });
check('desconto continua 139 (não 159)', comFrete.descontoTotal, 139);
check('total = 1390 - 139 + 200', comFrete.totalAmount, 1451);

console.log('\n--- despesas gerais e taxa de montagem somam ---');
check('desp. gerais somam', computeSalesTotals({ ...base, generalExpenses: 60 }).totalAmount, 1450);
check('taxa de montagem soma', computeSalesTotals({ ...base, assemblyFee: 40 }).totalAmount, 1430);
check('negativos são ignorados', computeSalesTotals({ ...base, generalExpenses: -60 }).totalAmount, 1390);
const tudo = computeSalesTotals({ ...base, discountPercent: 10, discountAmount: 50, freight: 100, generalExpenses: 60, assemblyFee: 40 });
check('somatório completo: 1390-189+100+60+40', tudo.totalAmount, 1401);

console.log('\n--- serviços entram na base do desconto ---');
const comServico = computeSalesTotals({ ...base, servicesAmount: 610, discountPercent: 10 });
check('base = 1390 + 610', comServico.base, 2000);
check('desconto 10% de 2000', comServico.descontoTotal, 200);
check('total', comServico.totalAmount, 1800);

console.log('\n--- comissões incidem sobre o subtotal ---');
const comissao = computeSalesTotals({ ...base, discountPercent: 10, freight: 500, sellerCommissionPercent: 5 });
check('subtotal (sem frete)', comissao.subtotal, 1251);
check('5% do subtotal, não do total', comissao.comissaoVendedor, 62.55);
check('sem percentual configurado = 0', computeSalesTotals(base).comissaoVendedor, 0);

console.log('\n--- peso total ---');
check('sem peso no produto = 0', computeSalesTotals(base).pesoTotal, 0);
check('com peso soma qtd x peso', computeSalesTotals({ items: [{ quantity: 3, unitPrice: 10, weight: 2.5 }] }).pesoTotal, 7.5);

console.log('\n--- entradas inválidas não quebram o cálculo ---');
check('sem itens', computeSalesTotals({}).totalAmount, 0);
check('texto no desconto', computeSalesTotals({ ...base, discountAmount: 'abc' }).totalAmount, 1390);
check('null no frete', computeSalesTotals({ ...base, freight: null }).totalAmount, 1390);
check('item sem preço', computeSalesTotals({ items: [{ quantity: 2 }] }).totalAmount, 0);

console.log('\n--- arredondamento em centavos ---');
check('33.333 x 3 arredonda certo', computeSalesTotals({ items: itens([3, 33.333]) }).valorProdutos, 100);
check('desconto de 1/3 não vaza casas', computeSalesTotals({ items: itens([1, 100]), discountPercent: 33.333 }).descontoTotal, 33.33);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
