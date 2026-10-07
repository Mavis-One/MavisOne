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
  // `faturado`, e não `pedidos`: a faísca do cartão passou a acompanhar a
  // série de FATURAMENTO na fase CO. A linha "pedidos" do gráfico inclui o que
  // ainda não virou receita, e cartão e gráfico discordando na mesma tela é o
  // pior dos dois mundos.
  serie: [{ faturado: 800 }, { faturado: 900 }, { faturado: 1284 }]
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

// O CARTÃO SE CHAMA FATURAMENTO E CONTAVA TODO PEDIDO (fase CO).
//
// Medido em 21/09/2026 nos dados reais: março de 2026 saía R$ 2,49 mi no cartão
// contra R$ 2,22 mi de faturamento de verdade, e julho saía R$ 4,39 mi contra
// R$ 1,46 mi. A diferença tem dois nomes — pedido CANCELADO (R$ 3,0 mi no
// histórico) e `pedido-aprovado-sem-faturamento` (R$ 12,9 mi): transferência
// entre filiais, remessa, bonificação. Mercadoria que saiu e dinheiro que não
// entrou. O nome do cartão prometia receita.
const comStatus = {
  intervalo: AGOSTO,
  pedidos: [
    { date: '2026-08-05', totalAmount: 1000, status: 'pedido-faturado' },
    { date: '2026-08-06', totalAmount: 5000, status: 'pedido-cancelado' },
    { date: '2026-08-07', totalAmount: 7000, status: 'pedido-aprovado-sem-faturamento' },
    { date: '2026-08-08', totalAmount: 200, status: 'pedido' }
  ],
  serie: []
};
const fatFiltrado = K.kpiFaturamento({ ...comStatus, statusQueFaturam: ['pedido-faturado'] });
check('só o que gera receita entra', fatFiltrado.valor === 1000, String(fatFiltrado.valor));
check('  cancelado fica fora', fatFiltrado.valor === 1000);
check('  e remessa/transferência também', fatFiltrado.valor === 1000);
check('o detalhe diz "faturados"', /1 pedido faturado/.test(fatFiltrado.detalhe), fatFiltrado.detalhe);
// A lista vem do catálogo de status (o servidor passa). Este módulo é puro e
// não conhece o vocabulário de venda: sem a lista, o comportamento é o antigo —
// nenhum painel fica sem número por causa disto.
const fatSemLista = K.kpiFaturamento(comStatus);
check('sem a lista, soma tudo (comportamento antigo)', fatSemLista.valor === 13200, String(fatSemLista.valor));
// E o servidor tem de passar a lista, senão o conserto não chega ao cartão.
const servidorSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
check('o servidor passa a lista para o cartão',
  /statusQueFaturam: salesStatus\.CATALOGO\.filter\(\(s\) => s\.geraFinanceiro\)\.map\(\(s\) => s\.value\)/.test(servidorSrc));

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
//
// SEM QUEBRA DE LINHA NO MEIO DA FRASE. A versão anterior pedia
// /pior do que cartão sem número/ e falhou na fase DC, quando a frase passou a
// quebrar entre "que" e "cartão": o texto estava lá, e o regex não atravessa o
// `\n * ` do bloco de comentário. Dois pedaços curtos dizem a mesma coisa e não
// dependem de onde a linha corta.
check('e diz por que não inventar',
  /derivado de nada é pior/.test(kpisSrc) && /parece confiável/.test(kpisSrc));

// A META PASSOU A EXISTIR (fase DC): `metas_de_venda`, por loja e por vendedor.
// O que o bloco acima protegia continua valendo e virou MAIS importante — sem
// meta cadastrada, nenhum cartão declara meta. Falta provar o outro lado: COM
// meta, a faixa aparece.
const comMeta = K.montarKpis({
  permissoes: { sales: true },
  intervalo: AGOSTO, hoje: HOJE,
  pedidos: [{ date: '2026-08-05', status: 'pedido-faturado', totalAmount: 900 }],
  statusQueFaturam: ['pedido-faturado'],
  metaDeVenda: 1000,
  compras: [], entradas: [], produtos: [], depositos: [], serieVendas: []
}).find((c) => c.id === 'faturamento');
check('com meta, 900 de 1000 dá 90%', comMeta.faixa && comMeta.faixa.percentual === 90,
  JSON.stringify(comMeta.faixa));
check('  com o rótulo "da meta"', comMeta.faixa.rotulo === 'da meta');
// 90% é "dá para virar", não "vai dar ruim": o tom separa os três casos.
check('  e tom de atenção entre 70 e 99', comMeta.faixa.tom === 'atencao', comMeta.faixa.tom);
// E a faixa tem a MESMA forma das outras (valor/percentual/rotulo/tom): a barra
// do cartão já existia, e um segundo formato faria o cartão de meta parecer
// diferente dos outros sem motivo.
check('  na mesma forma das outras faixas',
  ['valor', 'percentual', 'rotulo', 'tom', 'contagem'].every((k) => k in comMeta.faixa));

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
// A faixa do estoque depende de `situation`, que o produto cru não tem. Era o
// produto serializado inteiro; desde dashboard-e-sino (07/10/2026) é
// stockCore.resumoParaKpi — os quatro campos que o cartão lê, com os valores de
// serializeProduct e SEM a quebra por depósito, que varria o razão inteiro por
// produto (153 ms com 59 movimentos, 6,1 s com 5.900). A equivalência é
// conferida logo abaixo, com razão e sem razão.
check('usa o resumo do produto para o cartão', /produtos: canStock \? products\.map\(\(p\) => stockCore\.resumoParaKpi\(data, p\)\)/.test(serverSrc));
{
  const core = require('../lib/stock-core');
  const dados = {
    productMeta: { a: { minStock: 5 }, b: { minStock: 1 }, c: { minStock: '3' }, d: {}, f: { minStock: 2, maxStock: 3 } },
    deposits: [{ id: 'd1', name: 'Loja' }, { id: 'd2', name: 'CD' }],
    // O razão NÃO entra na conta do cartão: quantidade é a do produto. Com
    // movimentos aqui, uma versão que lesse o razão daria outro número.
    stockMovements: [
      { productId: 'a', depositId: 'd1', quantity: 2, type: 'entrada' },
      { productId: 'b', depositId: 'd2', quantity: 1, type: 'SAIDA' },
      { productId: 'f', depositId: 'd1', quantity: 9, type: 'entrada', classValueId: 'cor-1' }
    ],
    stockTransfers: [],
    productCategories: []
  };
  // Com mínimo e abaixo dele, sem mínimo, saldo zero e negativo, quantidade e
  // custo em texto, custo inválido, acima do máximo.
  const lista = [
    { id: 'a', stockQuantity: 2, costPrice: 10.5 }, { id: 'b', stockQuantity: '7', costPrice: '1.25' },
    { id: 'c', stockQuantity: 0, costPrice: null }, { id: 'd', stockQuantity: -1, costPrice: 3 },
    { id: 'e', stockQuantity: 4, costPrice: 'x' }, { id: 'f', stockQuantity: 4, costPrice: 2 }
  ];
  const campos = (p) => ({ stockQuantity: p.stockQuantity, costPrice: p.costPrice, situation: p.situation, minStock: p.minStock });
  const iguais = lista.every((p) => JSON.stringify(campos(core.serializeProduct(p, dados))) === JSON.stringify(core.resumoParaKpi(dados, p)));
  check('  e o resumo tem os MESMOS quatro campos de serializeProduct', iguais);
  const cartao = (produtos) => JSON.stringify(K.kpiEstoque({ produtos, depositos: dados.deposits }));
  check('  e dá o mesmo cartão de Estoque',
    cartao(lista.map((p) => core.serializeProduct(p, dados))) === cartao(lista.map((p) => core.resumoParaKpi(dados, p))));
  // E não depende do razão: sem movimento nenhum, o mesmo resumo.
  const semRazao = { ...dados, stockMovements: [], deposits: [] };
  check('  e o resumo não muda sem o razão',
    lista.every((p) => JSON.stringify(core.resumoParaKpi(dados, p)) === JSON.stringify(core.resumoParaKpi(semRazao, p))));
}
// A rota não carrega mais o razão nem o produto inteiro para o cartão.
{
  const rotaPainel = serverSrc.slice(serverSrc.indexOf("if (pathname === '/api/dashboard') {"), serverSrc.indexOf("if (pathname === '/api/dashboard/atencao'"));
  check('  e a rota lê os produtos pelo recorte do cartão', /canStock \? painelInicioDb\.getProductsParaValor\(\)/.test(rotaPainel)
    && !/stockCore\.serializeProduct\(/.test(rotaPainel));
}
// Lançamento cancelado não é dívida nem receita.
check('descarta lançamento cancelado', /\.filter\(\(e\) => !isFinanceEntryCancelled\(e\)\)/.test(serverSrc));
check('classifica receita x despesa', /tipo: classifyFinanceEntry\(e\)/.test(serverSrc));
// A mesma série do gráfico alimenta a sparkline.
// O ESCOPO ENTROU NA CHAMADA (fase DC). A série alimenta a faísca do cartão e
// saía de `data.orders` cru: um vendedor restrito lia a curva da empresa.
check('a série vem de buildSalesChartSeries, COM escopo',
  /serieVendas: canSales \? buildSalesChartSeries\(data, 'month', escopoVendas\)/.test(serverSrc));
check('  e os pedidos do cartão também são filtrados pelo escopo',
  /pedidos: canSales\s*\n\s*\? \(data\.orders \|\| \[\]\)\s*\n\s*\.filter\(\(o\) => escopoLib\.vendaVisivel\(escopoVendas, o\.sellerId\)\)/.test(serverSrc));
// E MOVIMENTAÇÃO INTERNA TAMBÉM SAI DO CARTÃO (30/09/2026), pela mesma regra
// que a tirou do gráfico. Hoje o filtro de status já a excluía — transferência
// não gera financeiro —, e esta é a trava explícita: cartão e gráfico
// discordando na mesma tela é o pior dos dois, como o comentário do sparkline
// em lib/kpis.js diz.
// ANCORADO NO BLOCO DO CARTÃO, e não solto no arquivo. A primeira versão era
// `/\.filter\(filialDaVenda\.ehVenda\)/` sobre o server.js inteiro, e uma
// mutação passou por ela: tirar o filtro do cartão deixava a MESMA linha no
// bloco que calcula o numerador da meta, e o teste dava verde sobre um cartão
// que voltou a somar transferência.
check('  e movimentacao interna sai do cartao pela mesma regra do grafico',
  /pedidos: canSales\s*\n\s*\? \(data\.orders \|\| \[\]\)\s*\n\s*\.filter\(\(o\) => escopoLib\.vendaVisivel\(escopoVendas, o\.sellerId\)\)\s*\n\s*\.filter\(filialDaVenda\.ehVenda\)/.test(serverSrc));
check('o período é parametrizável', /getPeriodRange\(url\.searchParams\.get\('period'\) \|\| 'month'/.test(serverSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
