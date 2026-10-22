#!/usr/bin/env node
// VENDA NO CARTÃO: TAXAS DA REDE, SIMULADOR E "QUEM PAGA A TAXA" (fase ET,
// 19/10/2026).
//
// O usuário colou "006_cartao_simulador.sql" e pediu "adicione esse módulo".
// Decidido com ele: o acréscimo (cliente paga) vai como outras despesas na nota;
// a taxa da Rede fica na própria conta a receber; "Loja assume" só com campanha
// ou aprovação de administrador.
//
// Provado no servidor local: a carga trouxe 403 taxas (13 bandeiras), 44
// fatores e 4 PVs; pedido de R$ 6.990,00 em Mastercard 12x pela maquininha,
// com a tela mandando valor 1, foi gravado com 8.069,96 (acréscimo 1.079,96,
// taxa 8,60% = 694,02, repasse 20/10/2026) e total 8.069,96; "Loja assume" sem
// campanha, como administrador, ficou 6.990,00 com taxa 601,14 e aprovado pelo
// administrador; Hipercard (sem taxa) e parcelado emissor + loja recusados;
// aprovado, o título nasceu em 8.069,96 com taxa 8,6% (694,02), líquido
// 7.375,94 e vencimento no repasse. Na tela: o simulador listou crédito 1x a
// 21x (12x de 672,50 = 8.069,96; taxa e retorno só para o administrador),
// "Escolher" travou o valor da linha e somou "Acréscimo do Cartão" no total, e
// "Loja assume" voltou a 6.990,00 pedindo a campanha. Financeiro › Taxas de
// Cartão mostrou os fatores, as taxas e os PVs; gravar acrescentou a vigência
// de hoje. Tudo apagado depois.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');
const servidor = semComentarios(ler('server.js'));

console.log('\n--- 1. o simulador (shared/cartao_simulador.js) ---');
const s = require('../public/modules/shared/cartao_simulador');
const tabelas = {
  taxas: [
    { canal: 'maquininha', bandeira: 'MASTERCARD', modalidade: 'credito', parcelas: 12, taxa: 0.086, prazoDias: 2, prazoDiasUteis: true, vigencia: '2026-10-17' },
    { canal: 'maquininha', bandeira: 'MASTERCARD', modalidade: 'debito', parcelas: 1, taxa: 0.0093, prazoDias: 1, prazoDiasUteis: true, vigencia: '2026-10-17' },
    { canal: 'maquininha', bandeira: 'SICREDI', modalidade: 'credito', parcelas: 2, taxa: 0.0303, prazoDias: 31, prazoDiasUteis: false, taxaPorParcela: true, vigencia: '2026-10-17' },
    { canal: 'maquininha', bandeira: 'MASTERCARD', modalidade: 'credito', parcelas: 12, taxa: 0.09, prazoDias: 2, prazoDiasUteis: true, vigencia: '2026-11-01' }
  ],
  fatores: [
    { empresaId: '', canal: 'maquininha', modalidade: 'credito', parcelas: 12, fator: 1.1545, vigencia: '2026-10-17' },
    { empresaId: '', canal: 'maquininha', modalidade: 'credito', parcelas: 2, fator: 1.0553, vigencia: '2026-10-17' },
    { empresaId: 'LOJA-X', canal: 'maquininha', modalidade: 'credito', parcelas: 12, fator: 1.2, vigencia: '2026-10-17' }
  ]
};
const opcao = { base: 6990, canal: 'maquininha', bandeira: 'MASTERCARD', modalidade: 'credito', parcelas: 12, data: '2026-10-17', tabelas };
const cliente = s.calcular({ ...opcao, quemPaga: 'cliente' });
check('o exemplo do script, cliente paga: 8.069,96 | 1.079,96 | 694,02 | 7.375,94 | retorno 422,26',
  cliente.cobrado === 8069.96 && cliente.acrescimo === 1079.96 && cliente.valorTaxa === 694.02 && cliente.liquido === 7375.94 && cliente.retorno === 422.26,
  JSON.stringify([cliente.cobrado, cliente.acrescimo, cliente.valorTaxa, cliente.liquido, cliente.retorno]));
const loja = s.calcular({ ...opcao, quemPaga: 'loja' });
check('  loja assume: 6.990,00 | 0 | 601,14 | 6.388,86', loja.cobrado === 6990 && loja.acrescimo === 0 && loja.valorTaxa === 601.14 && loja.liquido === 6388.86);
check('repasse em dias úteis (sábado 17/10 + 2 úteis = terça 20/10)', cliente.repasse === '2026-10-20');
check('  e em dias corridos, com a taxa por parcela (Sicredi 2x: +31 dias)', (() => {
  const r = s.calcular({ ...opcao, bandeira: 'SICREDI', parcelas: 2, quemPaga: 'cliente' });
  return r.repasse === '2026-11-17' && r.taxaPorParcela === true;
})());
check('a vigência que vale é a da data da venda', s.calcular({ ...opcao, quemPaga: 'loja', data: '2026-11-05' }).taxa === 0.09 && loja.taxa === 0.086);
check('o fator da loja vence o geral', s.calcular({ ...opcao, quemPaga: 'cliente', empresaId: 'LOJA-X' }).cobrado === 8388);
check('sem taxa, sem fator e parcelado emissor + loja: recusas',
  /Sem taxa cadastrada/.test(s.calcular({ ...opcao, bandeira: 'ELO', quemPaga: 'cliente' }).erro || '')
  && /Fator do simulador não cadastrado/.test(s.calcular({ ...opcao, modalidade: 'debito', parcelas: 1, quemPaga: 'cliente' }).erro || '')
  && /Parcelado emissor/.test(s.calcular({ ...opcao, modalidade: 'parcelado_emissor', parcelas: 1, quemPaga: 'loja' }).erro || ''));
check('as opções da tela: débito e crédito, débito primeiro', s.opcoes({ base: 6990, canal: 'maquininha', bandeira: 'MASTERCARD', quemPaga: 'loja', data: '2026-10-17', tabelas })
  .map((o) => `${o.modalidade}${o.parcelas}`).join(',') === 'debito1,credito12');

console.log('\n--- 2. bandeiras, totais e título ---');
const bc = require('../public/modules/shared/bandeira_cartao');
check('as bandeiras novas (11, 13, 18) e a chave da taxa', bc.existe('11') && bc.existe('13') && bc.existe('18')
  && bc.chaveDaTaxa('02') === 'MASTERCARD' && bc.chaveDaTaxa('99', 'sicredi') === 'SICREDI' && bc.chaveDaTaxa('99') === 'OUTROS');
const totais = require('../public/modules/shared/sales_totals').computeSalesTotals({
  items: [{ quantity: 1, unitPrice: 6990 }], payments: [{ amount: 8069.96, cartaoModalidade: 'credito', cartaoAcrescimo: 1079.96 }, { amount: 10, cartaoAcrescimo: 99 }]
});
check('o acréscimo da linha simulada soma no total (e só dela)', totais.acrescimoCartao === 1079.96 && totais.totalAmount === 8069.96);
const { parcelasDoPedido } = require('../lib/vendas-financeiro');
const [titulo] = parcelasDoPedido({ id: 'o', code: 1, date: '2026-10-17', totalAmount: 8069.96, payments: [
  { methodId: 'cc', amount: 8069.96, dueDate: '2026-10-20', cartaoModalidade: 'credito', cartaoTaxa: 0.086, cartaoValorTaxa: 694.02 }] },
new Map([['cc', { id: 'cc', type: 'cartao-credito', feePercent: 0 }]]), {});
// Desde 22/10/2026 (decisão do usuário: o líquido no valor da linha e no
// título) o título nasce no LÍQUIDO — no cartão menos a taxa da tabela —, sem
// feeAmount/netAmount (senão a baixa descontaria a taxa de novo), com a conta
// na observação; a linha segue no cobrado e não sobra "diferença".
const todos = parcelasDoPedido({ id: 'o', code: 1, date: '2026-10-17', totalAmount: 8069.96, payments: [
  { methodId: 'cc', amount: 8069.96, dueDate: '2026-10-20', cartaoModalidade: 'credito', cartaoTaxa: 0.086, cartaoValorTaxa: 694.02 }] },
new Map([['cc', { id: 'cc', type: 'cartao-credito', feePercent: 0 }]]), {});
check('o título nasce no líquido da tabela, com o vencimento do repasse e sem parcela de diferença',
  titulo.amount === 7375.94 && titulo.feeAmount === undefined && titulo.netAmount === undefined && titulo.dueDate === '2026-10-20'
  && /no cartão R\$ 8069,96, taxa R\$ 694,02; título pelo líquido/.test(titulo.note) && todos.length === 1);

console.log('\n--- 3. o banco (fase ET) ---');
const mig = ler('banco/migrations/fase-et-cartao-simulador.sql');
const linhasDeTaxa = (mig.match(/^\s*\('(MAQUININHA|LINK)','[A-Z]+','(DEBITO|CREDITO|PRE_PAGO|PARCELADO_EMISSOR|CREDIARIO)',\d+,0\.\d{4},/gm) || []).length;
check('a carga das taxas da Rede: 403 linhas', linhasDeTaxa === 403, linhasDeTaxa);
check('  e dos fatores (44) e dos 4 PVs', (mig.match(/\('(MAQUININHA|LINK)','(DEBITO|CREDITO)',\d+,1\.\d+\)/g) || []).length === 44
  && (mig.match(/\('9\d{7}', '/g) || []).length === 4);
check('a Rede entra como credenciadora se ainda não estiver', /insert into card_acquirers/.test(mig) && /'01425787000104'/.test(mig));

console.log('\n--- 4. o servidor ---');
check('refaz o simulador ao criar e ao alterar (o aprovado não muda)', /await simularCartoesDoPedido\(body, user\);/.test(servidor)
  && /if \(!travadoPorAprovacao\) await simularCartoesDoPedido\(body, user\);/.test(servidor));
check('  pela mesma conta da tela, com as tabelas do banco', /const resultado = cartaoSimulador\.calcular\(\{/.test(servidor) && /const tabelas = await cartaoDb\.lerTabelas\(\);/.test(servidor));
check('  "Loja assume" só com campanha ou administrador', /if \(!campanha && !admin\) \{/.test(servidor) && /linha\.cartaoAprovadoPor = campanha \? '' : user\.name;/.test(servidor));
check('  o título vence no repasse', /if \(resultado\.repasse\) linha\.dueDate = resultado\.repasse;/.test(servidor));
check('a linha guarda os campos do simulador', /\.\.\.linhaDoSimuladorDeCartao\(linha\)/.test(servidor));
check('o acréscimo vai como outras despesas na NF-e', /outrasDespesas: \(totais\.despesasGerais \|\| 0\) \+ \(totais\.taxaMontagem \|\| 0\) \+ \(totais\.acrescimoCartao \|\| 0\)/.test(servidor)
  && /outrasDespesas: \(totaisDaNota\.despesasGerais \|\| 0\) \+ \(totaisDaNota\.taxaMontagem \|\| 0\) \+ \(totaisDaNota\.acrescimoCartao \|\| 0\)/.test(ler('public/app.js')));
check('  e a NFC-e segue recusando despesa acessória (campo da Focus não confirmado)', /ou acréscimo do cartão\)\. A NFC-e é a venda de balcão: emita NF-e para ele\./.test(servidor));
check('as tabelas: a venda lê; o Financeiro lê, e só o administrador grava', /pathname === '\/api\/sales\/cartao\/tabelas'/.test(servidor)
  && /pathname === '\/api\/finance\/cartao' && req\.method === 'GET'/.test(servidor) && /Só o administrador muda as taxas de cartão\./.test(servidor));

console.log('\n--- 5. as telas e o relatório ---');
const app = ler('public/app.js');
check('a linha de cartão: canal, quem paga, valor dos produtos e Simular', /class="sales-cartao-canal"/.test(app) && /class="sales-cartao-quem"/.test(app)
  && /class="sales-cartao-base"/.test(app) && /class="secondary sales-cartao-simular"/.test(app));
check('  taxa, líquido e retorno só para o administrador', /verRetorno \? '<th>Taxa<\/th><th>Líquido<\/th><th>Retorno<\/th>' : ''/.test(app));
check('  a linha simulada trava o valor e o total mostra o acréscimo', /'Cobrado no cartão \(simulador\)'/.test(app) && /Acréscimo do Cartão \(R\$\)/.test(app));
check('  e o campo mostra o líquido ao administrador (o valor no cartão segue na linha)',
  /value="\$\{valorDaLinhaNaTela\(linha\)\}"/.test(app)
  && /const liquidoDoCartao = \(linha\) => \(linha && linha\.cartaoModalidade && Number\(linha\.cartaoValorTaxa\) > 0 && usuarioEhAdmin\(\)/.test(app)
  && /\['\.sales-payment-amount', \(linha, valor\) => \{ if \(!linha\.cartaoModalidade\) linha\.amount =/.test(app));
check('Financeiro › Taxas de Cartão', /key: 'taxas_cartao', label: 'Taxas de Cartão'/.test(app)
  && /'taxas_cartao'\]/.test(ler('public/modules/finance/index.js')) && /finance\/subs\/taxas_cartao\.js/.test(ler('public/index.html'))
  && /shared\/cartao_simulador\.js/.test(ler('public/index.html')));
const rel = require('../lib/relatorios/vendas').find((r) => r.key === 'vendas-no-cartao');
check('o relatório Vendas no Cartão por Tipo', rel && rel.titulo === 'Vendas no Cartão por Tipo' && rel.totais.includes('resultado'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
