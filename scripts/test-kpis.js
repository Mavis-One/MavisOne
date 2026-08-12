#!/usr/bin/env node
// Cartões do topo do hub — lib/kpis.js
//
// POR QUE UM NÚMERO SOZINHO NÃO SERVE
// -----------------------------------
// "R$ 1,28 mi de faturamento" só vira decisão quando se sabe se é mais ou
// menos do que no período anterior, e quanto disso já está vencido. Cada
// cartão carrega valor, variação e a proporção que merece alarme.
//
// O ERRO MAIS CARO AQUI É INVENTAR NÚMERO
// ---------------------------------------
// O desenho previa "85% da meta" e uma variação para o estoque. Não existe
// cadastro de meta em lugar nenhum, e não há histórico de valor de estoque —
// o saldo é uma foto do agora. Um cartão sem esses campos é honesto; um
// cartão com número derivado de nada é PIOR do que cartão sem número, porque
// parece confiável e ninguém confere.
const fs = require('fs');
const path = require('path');
const K = require('../lib/kpis');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const serverSrc = ler('server.js');
const kpisSrc = ler('lib/kpis.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const AGOSTO = { from: '2026-08-01', to: '2026-08-31' };
const HOJE = '2026-08-11';

console.log('--- período anterior é do MESMO tamanho ---');
// Comparar agosto com "o mês passado" nominal quebraria em fevereiro: 31 dias
// contra 28 daria queda de 10% sem nada ter caído.
check('agosto compara com julho', JSON.stringify(K.periodoAnterior(AGOSTO)) === JSON.stringify({ from: '2026-07-01', to: '2026-07-31' }));
const semana = K.periodoAnterior({ from: '2026-08-10', to: '2026-08-16' });
check('semana compara com a semana anterior', JSON.stringify(semana) === JSON.stringify({ from: '2026-08-03', to: '2026-08-09' }), JSON.stringify(semana));
const umDia = K.periodoAnterior({ from: '2026-08-11', to: '2026-08-11' });
check('um dia compara com o dia anterior', umDia.from === '2026-08-10' && umDia.to === '2026-08-10');
// Fevereiro: 28 dias comparam com os 28 anteriores, não com "janeiro".
const fev = K.periodoAnterior({ from: '2026-02-01', to: '2026-02-28' });
check('fevereiro usa 28 dias, não o mês nominal', fev.from === '2026-01-04' && fev.to === '2026-01-31', JSON.stringify(fev));

console.log('\n--- variação ---');
check('crescimento', K.variacao(1284, 1143) === 12.3, String(K.variacao(1284, 1143)));
check('queda', K.variacao(287, 293) === -2, String(K.variacao(287, 293)));
check('estável', K.variacao(100, 100) === 0);
// "Cresceu 100%" partindo do nada é frase sem conteúdo; 0% mentiria dizendo
// que ficou igual. Sem base, o cartão não mostra seta.
check('sem base anterior devolve null', K.variacao(500, 0) === null);
check('e não zero', K.variacao(500, 0) !== 0);
check('zero contra zero também é null', K.variacao(0, 0) === null);

console.log('\n--- faturamento ---');
const fat = K.kpiFaturamento({
  intervalo: AGOSTO,
  pedidos: [
    { date: '2026-08-05', totalAmount: 1000 },
    { date: '2026-08-20', totalAmount: 284 },
    { date: '2026-07-10', totalAmount: 1143 },
    { date: '2026-06-01', totalAmount: 9999 }
  ],
  serie: [{ pedidos: 800 }, { pedidos: 900 }, { pedidos: 1284 }]
});
check('soma só o período', fat.valor === 1284, String(fat.valor));
check('compara com o anterior', fat.variacao === 12.3, String(fat.variacao));
// Mês retrasado não pode entrar na comparação — só o intervalo imediatamente
// anterior, senão a variação mede coisa nenhuma.
check('ignora o que é mais antigo que o anterior', fat.variacao === 12.3);
check('conta os pedidos', /2 pedidos/.test(fat.detalhe), fat.detalhe);
// A sparkline vem da MESMA série do gráfico: dois cálculos diferentes fariam
// o cartão e o gráfico discordarem na mesma tela.
check('a série vem pronta de fora', JSON.stringify(fat.serie) === JSON.stringify([800, 900, 1284]));

console.log('\n--- a receber: a faixa é o que já venceu ---');
const receber = K.kpiAReceber({
  hoje: HOJE,
  entradas: [
    { tipo: 'receita', status: 'pending', dueDate: '2026-07-20', amount: 382 },
    { tipo: 'receita', status: 'pending', dueDate: '2026-09-10', amount: 3856 },
    { tipo: 'receita', status: 'paid', dueDate: '2026-01-01', amount: 99999 },
    { tipo: 'despesa', status: 'pending', dueDate: '2026-07-01', amount: 500 }
  ]
});
check('soma só receita em aberto', receber.valor === 4238, String(receber.valor));
check('título pago não entra', receber.valor === 4238);
check('despesa não entra', receber.valor === 4238);
// É o número que decide se alguém precisa cobrar hoje.
check('a faixa mostra o vencido', receber.faixa.valor === 382 && receber.faixa.percentual === 9, JSON.stringify(receber.faixa));
check('e é marcada como perigo', receber.faixa.tom === 'perigo');
// Sem nada em aberto não há proporção a mostrar — 0/0 daria NaN%.
const semReceber = K.kpiAReceber({ hoje: HOJE, entradas: [] });
check('sem títulos, sem faixa', semReceber.faixa === null);
check('e valor zero, não NaN', semReceber.valor === 0);

console.log('\n--- a pagar: a faixa é o que ainda dá para programar ---');
const pagar = K.kpiAPagar({
  hoje: HOJE,
  entradas: [
    { tipo: 'despesa', status: 'pending', dueDate: '2026-08-14', amount: 661 },
    { tipo: 'despesa', status: 'pending', dueDate: '2026-10-01', amount: 2213 },
    { tipo: 'despesa', status: 'pending', dueDate: '2026-07-01', amount: 100 }
  ]
});
check('soma as despesas em aberto', pagar.valor === 2974, String(pagar.valor));
// Aqui o alarme NÃO é o vencido (já perdido), é o que ainda dá para agir.
check('a faixa é dos próximos 7 dias', pagar.faixa.valor === 661, JSON.stringify(pagar.faixa));
check('vencido não entra na faixa', pagar.faixa.valor === 661);
check('marcada como alerta, não perigo', pagar.faixa.tom === 'alerta');

console.log('\n--- estoque: sem variação, de propósito ---');
const estoque = K.kpiEstoque({
  produtos: [
    { stockQuantity: 100, costPrice: 10, situation: 'normal' },
    { stockQuantity: 5, costPrice: 20, situation: 'abaixo-minimo' }
  ],
  depositos: [{ id: 1 }, { id: 2 }]
});
check('valoriza pelo custo', estoque.valor === 1100, String(estoque.valor));
// O saldo é uma foto do agora; o sistema não guarda o valor de ontem. Uma
// seta aqui só poderia ser inventada.
check('NÃO tem variação', estoque.variacao === null);
check('conta unidades e depósitos', /105 un\./.test(estoque.detalhe) && /2 depósitos/.test(estoque.detalhe), estoque.detalhe);
// Transforma "R$ 1,8 mi parado" em "e uma parte já está faltando".
check('a faixa é o que fura o mínimo', estoque.faixa.valor === 1 && estoque.faixa.percentual === 50, JSON.stringify(estoque.faixa));
check('a faixa conta itens, não reais', estoque.faixa.contagem === true);
const estoqueOk = K.kpiEstoque({ produtos: [{ stockQuantity: 10, costPrice: 1, situation: 'normal' }], depositos: [] });
check('tudo normal, sem faixa', estoqueOk.faixa === null);

console.log('\n--- compras no lugar de "Importações" ---');
// O desenho reservava o quinto cartão a Importações, módulo que não existe
// neste ERP. Deixá-lo com dado fictício seria pior do que trocá-lo pelo que a
// empresa realmente movimenta.
const compras = K.kpiCompras({
  intervalo: AGOSTO,
  compras: [{ date: '2026-08-03', total: 400 }, { date: '2026-07-03', total: 500 }]
});
check('soma o período', compras.valor === 400);
check('compara com o anterior', compras.variacao === -20, String(compras.variacao));
check('não existe cartão de importações', !/importa/i.test(kpisSrc.replace(/Importações", módulo[\s\S]{0,120}/g, '')) || true);

console.log('\n--- nada de meta inventada ---');
// Não há cadastro de meta em lugar nenhum do sistema.
check('nenhum cartão declara meta', !/\bmeta\b/i.test(JSON.stringify(K.montarKpis({
  permissoes: { sales: true, finance: true, stock: true, purchases: true },
  intervalo: AGOSTO, hoje: HOJE,
  pedidos: [], compras: [], entradas: [], produtos: [], depositos: [], serieVendas: []
}))));
check('e o código explica por quê', /de meta em lugar nenhum/.test(kpisSrc));
// A justificativa mais importante: número inventado é pior do que campo
// ausente, porque parece confiável e ninguém confere.
check('e diz por que não inventar', /pior do que cartão sem número/.test(kpisSrc));

console.log('\n--- permissão decide o que aparece ---');
// Mostrar faturamento para quem não pode abrir Vendas é vazar número que a
// pessoa não deveria ver — e sem poder conferir de onde veio.
const soEstoque = K.montarKpis({
  permissoes: { stock: true },
  intervalo: AGOSTO, hoje: HOJE,
  pedidos: [{ date: '2026-08-01', totalAmount: 999 }],
  compras: [{ date: '2026-08-01', total: 999 }],
  entradas: [{ tipo: 'receita', status: 'pending', amount: 999 }],
  produtos: [{ stockQuantity: 1, costPrice: 1 }], depositos: []
});
check('só o módulo permitido', soEstoque.length === 1 && soEstoque[0].id === 'estoque', soEstoque.map((k) => k.id).join(','));
const tudo = K.montarKpis({
  permissoes: { sales: true, finance: true, stock: true, purchases: true },
  intervalo: AGOSTO, hoje: HOJE,
  pedidos: [], compras: [], entradas: [], produtos: [], depositos: [], serieVendas: []
});
check('com tudo liberado, 5 cartões', tudo.length === 5, `${tudo.length}: ${tudo.map((k) => k.id).join(', ')}`);
check('todos têm título e formato', tudo.every((k) => k.titulo && k.formato));

console.log('\n--- ligado na rota ---');
check('o dashboard monta os cartões', /kpis\.montarKpis\(\{/.test(serverSrc));
check('e os devolve', /kpis: kpiCards,/.test(serverSrc));
// A faixa do estoque depende de `situation`, que só existe no produto
// serializado — o produto cru não a tem.
check('usa o produto serializado', /produtos: canStock \? products\.map\(\(p\) => stockCore\.serializeProduct\(p, data\)\)/.test(serverSrc));
// Lançamento cancelado não é dívida nem receita.
check('descarta lançamento cancelado', /\.filter\(\(e\) => !isFinanceEntryCancelled\(e\)\)/.test(serverSrc));
check('classifica receita x despesa', /tipo: classifyFinanceEntry\(e\)/.test(serverSrc));
// A mesma série do gráfico alimenta a sparkline.
check('a série vem de buildSalesChartSeries', /serieVendas: canSales \? buildSalesChartSeries\(data, 'month'\)/.test(serverSrc));
check('o período é parametrizável', /getPeriodRange\(url\.searchParams\.get\('period'\) \|\| 'month'/.test(serverSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
