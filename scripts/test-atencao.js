#!/usr/bin/env node
// Painel "Atenção" do hub — lib/atencao.js
//
// O QUE ELE RESOLVE
// -----------------
// Tudo o que está errado já está gravado, só que espalhado por seis telas: uma
// conta venceu no Financeiro, uma NF-e foi rejeitada no Fiscal, um pedido está
// faturado sem nota, um produto furou o mínimo no Estoque. Ninguém descobre
// isso navegando — descobre quando o cliente liga.
//
// COMO UM PAINEL DE ALERTA FALHA
// ------------------------------
//   1. mostrando linha com zero: vira ruído e a pessoa para de ler;
//   2. pintando tudo de vermelho: a severidade deixa de significar algo;
//   3. mostrando pendência de módulo que a pessoa não pode abrir: ela clica e
//      leva "Sem permissão";
//   4. contando um registro que já foi resolvido (conta paga, nota autorizada).
const fs = require('fs');
const path = require('path');
const A = require('../lib/atencao');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const serverSrc = ler('server.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const HOJE = '2026-08-11';
const TUDO = { finance: true, fiscal: true, sales: true, stock: true };
const montar = (over = {}) => A.montarAtencao({
  agora: `${HOJE}T10:00:00Z`,
  permissoes: TUDO,
  entradas: [], notasFiscais: [], pedidos: [], produtos: [],
  statusQueFaturam: ['pedido-faturado'],
  ...over
});

console.log('--- só entra o que exige ação ---');
// Linha com zero é ruído: a pessoa para de ler o painel.
check('sistema sem problema nenhum não gera item', montar().itens.length === 0);
check('e o total é zero', montar().total === 0);

console.log('\n--- contas vencidas ---');
const vencidas = montar({ entradas: [
  { status: 'pending', dueDate: '2026-07-28', amount: 1200 },
  { status: 'pending', dueDate: '2026-08-01', amount: 800 }
] });
const contas = vencidas.itens.find((i) => i.id === 'contas-vencidas');
check('detecta as duas', contas && contas.contagem === 2, String(contas?.contagem));
// Vencido não é aviso de prazo, é fato consumado.
check('severidade alta', contas.severidade === 'alta');
check('soma o valor', /2\.000,00/.test(contas.detalhe), contas.detalhe);
// A mais antiga dá a dimensão: cinco de ontem é uma coisa, uma de 90 dias é outra.
check('conta os dias da mais antiga', /14 dias/.test(contas.detalhe), contas.detalhe);

console.log('\n--- o que já foi resolvido não conta ---');
// Contar título pago faria o painel mentir para sempre.
const pagas = montar({ entradas: [
  { status: 'pago', dueDate: '2026-01-01', amount: 9999 },
  { status: 'cancelado', dueDate: '2026-01-01', amount: 5000 },
  { status: 'recebido', dueDate: '2026-01-01', amount: 3000 }
] });
check('título pago não vira alerta', !pagas.itens.some((i) => i.id === 'contas-vencidas'));
// Os dois vocabulários convivem no sistema: 'pending' do banco, 'pendente' da tela.
check('reconhece "pending"', A.emAberto({ status: 'pending' }));
check('reconhece "pendente"', A.emAberto({ status: 'pendente' }));
check('reconhece "parcial"', A.emAberto({ status: 'parcial' }));
check('e recusa "pago"', !A.emAberto({ status: 'pago' }));

console.log('\n--- a vencer é aviso, não fato ---');
const aVencer = montar({ entradas: [{ status: 'pending', dueDate: '2026-08-14', amount: 500 }] });
const proximas = aVencer.itens.find((i) => i.id === 'contas-a-vencer');
check('detecta as próximas', proximas && proximas.contagem === 1);
check('severidade média', proximas.severidade === 'media');
// Vencendo hoje já entra em "vencem em 7 dias", não em "vencidas".
const hojeMesmo = montar({ entradas: [{ status: 'pending', dueDate: HOJE, amount: 100 }] });
check('vencendo hoje não é "vencida"', !hojeMesmo.itens.some((i) => i.id === 'contas-vencidas'));
check('mas entra em "a vencer"', hojeMesmo.itens.some((i) => i.id === 'contas-a-vencer'));
// Fora da janela não interessa: seria a lista inteira de contas do ano.
const longe = montar({ entradas: [{ status: 'pending', dueDate: '2026-12-01', amount: 100 }] });
check('vencimento distante fica de fora', longe.itens.length === 0);

console.log('\n--- NF-e ---');
const notas = montar({ notasFiscais: [
  { status: 'ERRO' }, { status: 'DENEGADO' }, { status: 'AUTORIZADO' }, { status: 'CANCELADO' }
] });
const erro = notas.itens.find((i) => i.id === 'nfe-erro');
check('erro e denegada contam', erro && erro.contagem === 2, String(erro?.contagem));
check('autorizada e cancelada não', erro.contagem === 2);
// Nota rejeitada trava expedição: a mercadoria não pode sair sem documento.
check('severidade alta', erro.severidade === 'alta');

// Nota presa em PROCESSANDO é sintoma de webhook que não chegou: a SEFAZ já
// respondeu e o sistema não soube. Sem o alerta, ela fica em limbo.
const travada = montar({ notasFiscais: [
  { status: 'PROCESSANDO', dataEmissao: '2026-08-08' },
  { status: 'PROCESSANDO', dataEmissao: HOJE }
] });
const presa = travada.itens.find((i) => i.id === 'nfe-processando');
check('processando há dias vira alerta', presa && presa.contagem === 1, String(presa?.contagem));
check('processando de hoje não', presa.contagem === 1);
check('e sugere o que fazer', /Consultar status/.test(presa.detalhe), presa.detalhe);

console.log('\n--- pedidos faturados sem nota ---');
// Venda concretizada sem documento fiscal é o alerta mais caro da lista.
//
// `code >= 16000` em toda fixture daqui para baixo: é o piso da fase CG, que
// separa o que nasceu neste sistema do histórico importado do ViperERP. Desde a
// fase CO o painel só cobra o que nasceu aqui — ver o bloco de nasceuAqui.
const semNota = montar({ pedidos: [
  { code: 16001, status: 'pedido-faturado', nfeId: '', date: '2026-08-05', totalAmount: 3000 },
  { code: 16002, status: 'pedido-faturado', nfeId: 'nfe-1', date: '2026-08-05', totalAmount: 1000 },
  { code: 16003, status: 'orcamento', nfeId: '', date: '2026-08-05', totalAmount: 500 }
] });
const pedidos = semNota.itens.find((i) => i.id === 'pedidos-sem-nota');
check('só o faturado sem nota conta', pedidos && pedidos.contagem === 1, String(pedidos?.contagem));
check('severidade alta', pedidos.severidade === 'alta');
check('soma o valor sem documento', /3\.000,00/.test(pedidos.detalhe), pedidos.detalhe);
// Faturado hoje ainda não é problema — a nota sai no mesmo dia.
const hojeFaturado = montar({ pedidos: [{ code: 16004, status: 'pedido-faturado', nfeId: '', date: HOJE, totalAmount: 100 }] });
check('faturado hoje tem tolerância', hojeFaturado.itens.length === 0);

console.log('\n--- HISTÓRICO IMPORTADO NÃO É PENDÊNCIA (fase CO) ---');
// O QUE O PAINEL MOSTRAVA, medido em 21/09/2026 nos dados reais: 13.325
// "pedidos faturados sem NF-e", R$ 24.809.929,55 — e 13.320 deles eram a
// importação do ViperERP, cuja nota saiu no sistema ANTIGO. Nenhum pedido havia
// nascido aqui ainda (a sequence estava em 15.999).
//
// Painel de pendência que nunca zera deixa de ser lido, e aí a pendência de
// verdade se perde no meio dos treze mil. O histórico continua nas listas de
// Vendas, Financeiro e Estoque — só deixou de ser cobrado como tarefa.
const soHistorico = montar({ pedidos: [
  { code: 14086, status: 'pedido-faturado', nfeId: '', date: '2026-03-10', totalAmount: 5000 },
  { code: null, status: 'pedido-faturado', nfeId: '', date: '2026-03-11', totalAmount: 7000 }
] });
check('pedido importado não vira alerta', !soHistorico.itens.some((i) => i.id === 'pedidos-sem-nota'),
  JSON.stringify(soHistorico.itens.map((i) => i.id)));
// Sem `code` conta como importado: documento que nasce aqui recebe número da
// sequence, então ausência de número é marca de linha que entrou por fora.
check('  e sem code também não', soHistorico.total === 0, String(soHistorico.total));
// O que importa é não jogar fora o que é real junto com o histórico.
const misturado = montar({ pedidos: [
  { code: 14090, status: 'pedido-faturado', nfeId: '', date: '2026-03-10', totalAmount: 5000 },
  { code: 16010, status: 'pedido-faturado', nfeId: '', date: '2026-08-05', totalAmount: 2500 }
] });
const soOMeu = misturado.itens.find((i) => i.id === 'pedidos-sem-nota');
check('no meio do histórico, o que nasceu aqui continua cobrado', soOMeu && soOMeu.contagem === 1, String(soOMeu?.contagem));
check('  e o valor é só o dele', /2\.500,00/.test(soOMeu.detalhe), soOMeu.detalhe);

// TÍTULO DE PEDIDO IMPORTADO TAMBÉM É HISTÓRICO: era o que punha "a mais antiga
// há 320 dias" no painel. `referenceId` é o que amarra a parcela ao pedido.
const titulos = montar({
  pedidos: [
    { code: 14099, status: 'pedido-faturado', nfeId: 'x', date: '2025-11-01', totalAmount: 500 },
    { code: 16020, status: 'pedido-faturado', nfeId: 'y', date: '2026-09-01', totalAmount: 700 }
  ],
  // Vencimentos ANTES de HOJE (11/08/2026), senão caem em "a vencer" e este
  // check mediria outra coisa.
  entradas: [
    { id: 't1', referenceId: '', status: 'pending', dueDate: '2025-11-01', amount: 500 },
    { id: 't2', referenceId: '', status: 'pending', dueDate: '2026-07-01', amount: 700 },
    { id: 't3', referenceId: '', status: 'pending', dueDate: '2026-07-02', amount: 900 }
  ]
});
// Os pedidos das fixtures não têm id, então nenhum título casa por referência:
// os três contam. É o caso do título digitado à mão (aluguel, imposto), que
// nasceu aqui e tem de continuar cobrando — o corte do histórico não pode
// silenciar despesa de verdade só porque ela é antiga.
const vencidasSemRef = titulos.itens.find((i) => i.id === 'contas-vencidas');
check('título sem referência de pedido continua cobrado', vencidasSemRef && vencidasSemRef.contagem === 3, String(vencidasSemRef?.contagem));
const comRef = montar({
  pedidos: [{ id: 'ord-velho', code: 14099, status: 'pedido-faturado', nfeId: 'x', date: '2025-11-01', totalAmount: 500 }],
  entradas: [{ id: 't1', referenceId: 'ord-velho', status: 'pending', dueDate: '2025-11-01', amount: 500 }]
});
check('  mas título de pedido importado sai da conta', !comRef.itens.some((i) => i.id === 'contas-vencidas'),
  JSON.stringify(comRef.itens.map((i) => i.id)));

console.log('\n--- "zerado" só é pendência com mínimo declarado (fase CO) ---');
// Os 5.475 produtos deste banco estão em zero porque o razão nunca foi
// carregado, e nenhum tem mínimo cadastrado: o painel acusava 5.476 reposições
// que são ausência de dado, não falta de mercadoria.
const semMinimo = montar({ produtos: [
  { situation: 'zerado', temMinimo: false },
  { situation: 'zerado', temMinimo: false }
] });
check('zerado sem mínimo não alerta', !semMinimo.itens.some((i) => i.id === 'estoque-minimo'),
  JSON.stringify(semMinimo.itens.map((i) => i.id)));
const estoqueReal = montar({ produtos: [
  { situation: 'zerado', temMinimo: true },
  { situation: 'abaixo-minimo', temMinimo: true },
  { situation: 'zerado', temMinimo: false }
] });
const alertaEstoque = estoqueReal.itens.find((i) => i.id === 'estoque-minimo');
check('com mínimo declarado, alerta', alertaEstoque && alertaEstoque.contagem === 2, String(alertaEstoque?.contagem));
// 'abaixo-minimo' só existe quando há mínimo > 0, então entra sempre.
check('  e conta o zerado entre eles', /1 com saldo zerado/.test(alertaEstoque.detalhe), alertaEstoque.detalhe);
// A lista vem do CATÁLOGO de status, não escrita à mão: um status novo que
// gere financeiro entra sozinho no alerta.
check('o servidor lê os status do catálogo',
  /salesStatus\.CATALOGO\s*\n?\s*\.filter\(\(s\) => s\.geraFinanceiro\)/.test(serverSrc));

console.log('\n--- estoque ---');
const estoque = montar({ produtos: [
  // `temMinimo` desde a fase CO: 'zerado' só é pendência quando alguém
  // declarou que o produto devia ter estoque. Ver o bloco logo acima.
  { situation: 'abaixo-minimo', temMinimo: true }, { situation: 'zerado', temMinimo: true },
  { situation: 'normal' }, { situation: 'acima-maximo' }
] });
const min = estoque.itens.find((i) => i.id === 'estoque-minimo');
check('conta abaixo do mínimo e zerado', min && min.contagem === 2, String(min?.contagem));
// Saldo zerado é pior do que pouco saldo: sobe a severidade.
check('zerado eleva para média', min.severidade === 'media');
const soAbaixo = montar({ produtos: [{ situation: 'abaixo-minimo', temMinimo: true }] });
check('sem zerado, fica baixa', soAbaixo.itens[0].severidade === 'baixa');

console.log('\n--- permissão decide o que aparece ---');
// Mostrar pendência de módulo que a pessoa não pode abrir é oferecer um beco
// sem saída: ela clica e leva "Sem permissão".
const soEstoque = A.montarAtencao({
  agora: `${HOJE}T10:00:00Z`,
  permissoes: { stock: true },
  entradas: [{ status: 'pending', dueDate: '2026-01-01', amount: 999 }],
  notasFiscais: [{ status: 'ERRO' }],
  pedidos: [{ code: 16030, status: 'pedido-faturado', nfeId: '', date: '2026-01-01' }],
  produtos: [{ situation: 'zerado', temMinimo: true }],
  statusQueFaturam: ['pedido-faturado']
});
check('só o módulo permitido aparece', soEstoque.itens.length === 1, soEstoque.itens.map((i) => i.modulo).join(','));
check('e é o do estoque', soEstoque.itens[0].modulo === 'stock');

console.log('\n--- ordenação: o mais grave primeiro ---');
// Se tudo fosse vermelho, a severidade deixaria de significar algo.
const misto = montar({
  entradas: [{ status: 'pending', dueDate: '2026-07-01', amount: 100 }, { status: 'pending', dueDate: '2026-08-13', amount: 50 }],
  produtos: [{ situation: 'abaixo-minimo', temMinimo: true }],
  notasFiscais: [{ status: 'ERRO' }, { status: 'ERRO' }, { status: 'ERRO' }]
});
const severidades = misto.itens.map((i) => i.severidade);
check('altas antes de médias e baixas',
  JSON.stringify(severidades) === JSON.stringify([...severidades].sort((a, b) => ({ alta: 0, media: 1, baixa: 2 }[a]) - ({ alta: 0, media: 1, baixa: 2 }[b]))),
  severidades.join(' > '));
// Entre iguais, o que afeta mais registros vem primeiro.
check('entre iguais, o de maior volume primeiro', misto.itens[0].id === 'nfe-erro', misto.itens[0].id);

console.log('\n--- contadores para o sino e os badges ---');
check('total soma tudo', misto.total === 6, String(misto.total));
check('críticos contam só os de alta', misto.criticos === 4, String(misto.criticos));
check('agrupa por módulo', misto.porModulo.fiscal === 3 && misto.porModulo.finance === 2, JSON.stringify(misto.porModulo));

console.log('\n--- todo item sabe para onde levar ---');
// Alerta sem destino é uma frase, não uma ferramenta.
misto.itens.forEach((i) => {
  check(`${i.id} tem módulo e tela`, Boolean(i.modulo && i.sub), `${i.modulo}/${i.sub}`);
});

console.log('\n--- a rota degrada em vez de derrubar a tela ---');
const rota = serverSrc.slice(serverSrc.indexOf("pathname === '/api/dashboard/atencao'"), serverSrc.indexOf("pathname === '/api/dashboard/charts'"));
// A tabela fiscal pode não responder: migração pendente, estabelecimento
// ainda não cadastrado. Um alerta a menos é melhor do que nenhum.
check('falha do fiscal não derruba o painel', /catch \(erroFiscal\)/.test(rota));
check('é rota própria, não campo do dashboard', /pathname === '\/api\/dashboard\/atencao'/.test(serverSrc));
check('e o motivo está escrito', /a parte cara da tela/.test(serverSrc));

console.log('\n--- a rota varre as vendas DE VERDADE ---');
// O CHECK QUE FALTAVA, e o defeito que ele encontrou.
//
// Os testes acima alimentam pedidosSemNota() direto, com pedidos de mentira —
// então passavam com a função certa ligada na coleção errada. A rota entregava
// `data.sales`, a coleção LEGADA, que não recebe escrita desde que as vendas
// viraram orders/quotes e está sempre vazia. O alerta nunca disparou: nos dados
// reais deste banco eram 8 pedidos e R$ 26.033,80 sem documento fiscal.
//
// Função certa + teste verde + ligação errada é o defeito que mais custa a
// achar, porque nada nele parece errado.
check('o painel recebe data.orders', /pedidos: data\.orders/.test(rota));
check('  e NÃO a coleção legada data.sales', !/pedidos: data\.sales/.test(rota));
// Sem o sync, data.orders chega vazio e o efeito é o mesmo de antes.
//
// Aceita as duas versões do sync porque na fase CM esta rota passou a usar a
// ENXUTA (só as colunas que um agregado lê — 323 ms viraram 49 ms). O que
// importa aqui não é o nome: é que alguém popule data.orders antes do uso.
check('  com um sync de vendas chamado antes', /syncSalesData(ParaAgregado)?\(data\)/.test(rota));

// E O QUE A VERSÃO ENXUTA NÃO PODE DEIXAR DE FORA.
//
// `pedidosSemNota` começa com `if (p.nfeId) return false`. Se a carga enxuta
// não trouxer `nfe_id`, esse campo chega `undefined`, o filtro nunca corta, e o
// painel passa a acusar como "faturado sem NF-e" TODO pedido — inclusive os que
// têm nota. Nada quebra: o alerta só fica errado, que é o defeito que este
// arquivo inteiro existe para pegar.
//
// Quase aconteceu: a primeira versão do recorte tinha oito colunas e nenhuma
// delas era nfe_id.
// As duas constantes juntas: a base é compartilhada com o orçamento e a de
// pedido acrescenta o `nfe_id` (orçamento não tem nota, e a coluna não existe
// em `quotes` — pedir a lista única ali derruba a rota).
const vendasDb = ler('lib/db/vendas-compras.js');
const recorte = [
  (/const COLUNAS_DE_AGREGADO = '([^']*)'/.exec(vendasDb) || [])[1] || '',
  (/const COLUNAS_DE_AGREGADO_PEDIDO = `([^`]*)`/.exec(vendasDb) || [])[1] || ''
].join(', ');
check('a carga enxuta de pedido traz nfe_id', /nfe_id/.test(recorte), recorte || 'recorte não encontrado');
// `date` e `created_at` são a segunda metade do filtro (o pedido só entra depois
// de um dia), e o valor é o que o alerta mostra.
['date', 'created_at', 'total_amount', 'status'].forEach((c) => {
  check(`  e também ${c}`, new RegExp(`\\b${c}\\b`).test(recorte));
});

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
