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
const semNota = montar({ pedidos: [
  { status: 'pedido-faturado', nfeId: '', date: '2026-08-05', totalAmount: 3000 },
  { status: 'pedido-faturado', nfeId: 'nfe-1', date: '2026-08-05', totalAmount: 1000 },
  { status: 'orcamento', nfeId: '', date: '2026-08-05', totalAmount: 500 }
] });
const pedidos = semNota.itens.find((i) => i.id === 'pedidos-sem-nota');
check('só o faturado sem nota conta', pedidos && pedidos.contagem === 1, String(pedidos?.contagem));
check('severidade alta', pedidos.severidade === 'alta');
check('soma o valor sem documento', /3\.000,00/.test(pedidos.detalhe), pedidos.detalhe);
// Faturado hoje ainda não é problema — a nota sai no mesmo dia.
const hojeFaturado = montar({ pedidos: [{ status: 'pedido-faturado', nfeId: '', date: HOJE, totalAmount: 100 }] });
check('faturado hoje tem tolerância', hojeFaturado.itens.length === 0);
// A lista vem do CATÁLOGO de status, não escrita à mão: um status novo que
// gere financeiro entra sozinho no alerta.
check('o servidor lê os status do catálogo',
  /salesStatus\.CATALOGO\s*\n?\s*\.filter\(\(s\) => s\.geraFinanceiro\)/.test(serverSrc));

console.log('\n--- estoque ---');
const estoque = montar({ produtos: [
  { situation: 'abaixo-minimo' }, { situation: 'zerado' },
  { situation: 'normal' }, { situation: 'acima-maximo' }
] });
const min = estoque.itens.find((i) => i.id === 'estoque-minimo');
check('conta abaixo do mínimo e zerado', min && min.contagem === 2, String(min?.contagem));
// Saldo zerado é pior do que pouco saldo: sobe a severidade.
check('zerado eleva para média', min.severidade === 'media');
const soAbaixo = montar({ produtos: [{ situation: 'abaixo-minimo' }] });
check('sem zerado, fica baixa', soAbaixo.itens[0].severidade === 'baixa');

console.log('\n--- permissão decide o que aparece ---');
// Mostrar pendência de módulo que a pessoa não pode abrir é oferecer um beco
// sem saída: ela clica e leva "Sem permissão".
const soEstoque = A.montarAtencao({
  agora: `${HOJE}T10:00:00Z`,
  permissoes: { stock: true },
  entradas: [{ status: 'pending', dueDate: '2026-01-01', amount: 999 }],
  notasFiscais: [{ status: 'ERRO' }],
  pedidos: [{ status: 'pedido-faturado', nfeId: '', date: '2026-01-01' }],
  produtos: [{ situation: 'zerado' }],
  statusQueFaturam: ['pedido-faturado']
});
check('só o módulo permitido aparece', soEstoque.itens.length === 1, soEstoque.itens.map((i) => i.modulo).join(','));
check('e é o do estoque', soEstoque.itens[0].modulo === 'stock');

console.log('\n--- ordenação: o mais grave primeiro ---');
// Se tudo fosse vermelho, a severidade deixaria de significar algo.
const misto = montar({
  entradas: [{ status: 'pending', dueDate: '2026-07-01', amount: 100 }, { status: 'pending', dueDate: '2026-08-13', amount: 50 }],
  produtos: [{ situation: 'abaixo-minimo' }],
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

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
