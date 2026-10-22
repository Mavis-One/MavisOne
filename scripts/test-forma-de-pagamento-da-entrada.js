#!/usr/bin/env node
// A FORMA DE PAGAMENTO DOS TÍTULOS DA ENTRADA DE NF-e (22/10/2026).
//
// O usuário: "quero que você habilite um campo para eu decidir a forma de
// pagamento dessas NFs" — as que entram pelo XML com financeiro, junto do
// parcelamento (ex.: a nota diz boleto, a compra foi no cartão em 5 vezes).
// Um campo no bloco Contas a pagar da conferência, que começa na forma que o
// XML declara (quando casa com uma cadastrada) e vai gravado em cada título.
//
// Provado no servidor local: o XML de exemplo (tPag 15) abriu com "Boleto
// Bancário" e o aviso "Na nota: Boleto bancário."; trocado para "Cartão de
// Crédito" e parcelado em 5, os 5 títulos (122,50 cada) nasceram com a forma
// e a Edição de Título abriu com ela. Uma forma inexistente deu 400 sem gravar
// a entrada. Tudo apagado depois.
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

console.log('\n--- 1. a sugestão pelo tPag do XML (entradaNfe.formaSugerida) ---');
const { formaSugerida } = require('../lib/entradaNfe');
const formas = [
  { id: 'bol', name: 'Boleto Bancário', type: 'boleto', status: 'ativo' },
  { id: 'cc', name: 'Cartão de Crédito', type: 'cartao-credito', status: 'ativo' },
  { id: 'fin', name: 'Financiamento Viacredi', type: 'crediario', status: 'ativo' },
  { id: 'dup', name: 'Duplicata', type: 'crediario', status: 'ativo' },
  { id: 'dep', name: 'Depósito Bancário', type: 'transferencia', status: 'ativo' },
  { id: 'tra', name: 'Transferência bancária', type: 'transferencia', status: 'ativo' },
  { id: 'pix-velho', name: 'PIX antigo', type: 'pix', status: 'inativo' }
];
const sugere = (codigo, forma) => formaSugerida([{ codigo, forma, valor: 1 }], formas);
check('15 boleto -> Boleto Bancário', sugere('15', 'Boleto bancário') === 'bol');
check('03 cartão de crédito -> Cartão de Crédito', sugere('03', 'Cartão de crédito') === 'cc');
check('14 duplicata mercantil -> Duplicata, e não o primeiro crediário', sugere('14', 'Duplicata mercantil') === 'dup');
check('18 transferência -> a de nome igual, e não o depósito', sugere('18', 'Transferência bancária') === 'tra');
check('16 depósito -> Depósito Bancário', sugere('16', 'Depósito bancário') === 'dep');
check('forma inativa não é sugerida (17 PIX só inativo)', sugere('17', 'PIX') === '');
check('90 sem pagamento e 99 outros não sugerem', sugere('90', 'Sem pagamento') === '' && sugere('99', 'Outros') === '');
check('sem <pag> no XML, sem sugestão', formaSugerida([], formas) === '' && formaSugerida(undefined, formas) === '');
check('a primeira que casa vale (90 e depois 03)', formaSugerida([{ codigo: '90', forma: 'Sem pagamento' }, { codigo: '03', forma: 'Cartão de crédito' }], formas) === 'cc');

console.log('\n--- 2. o servidor ---');
const servidor = semComentarios(ler('server.js'));
const analisar = servidor.slice(servidor.indexOf("pathname === '/api/purchases/entrada-nfe/analisar'"), servidor.indexOf("pathname === '/api/purchases/entrada-nfe/analisar'") + 7000);
check('a análise manda as formas ativas', /formasDePagamento: \(data\.paymentMethods \|\| \[\]\)\s*\.filter\(\(f\) => f\.status !== 'inativo'\)/.test(analisar));
check('  e a sugerida pelo XML', /formaDePagamentoSugeridaId: entradaNfe\.formaSugerida\(conferencia\.nota && conferencia\.nota\.pagamentos, data\.paymentMethods\)/.test(analisar));
const lancar = servidor.slice(servidor.indexOf('async function lancarEntradaConferida('), servidor.indexOf('async function lancarEntradaConferida(') + 20000);
const posConferir = lancar.indexOf('formaDosTitulos = (data.paymentMethods');
const posGravar = lancar.indexOf('entradaNfeDb.criarEntrada(');
check('a forma é conferida ANTES de gravar a nota', posConferir > 0 && posGravar > posConferir);
check('  forma que não existe: 400', /if \(!formaDosTitulos\) \{\s*return sendJson\(res, \{ error: 'A forma de pagamento escolhida não existe mais\. Escolha outra\.' \}, 400\);/.test(lancar));
check('  só quando gera financeiro', /if \(querFinanceiro && String\(body\.formaDePagamentoId \|\| ''\)\.trim\(\)\)/.test(lancar));
check('cada título leva a forma', /\.\.\.\(formaDosTitulos \? \{ paymentMethodId: formaDosTitulos\.id, paymentMethodName: formaDosTitulos\.name \} : \{\}\),\s*type: 'purchase'/.test(lancar));

console.log('\n--- 3. a tela ---');
const tela = semComentarios(ler('public/modules/purchases/subs/entrada_nfe.js'));
check('o campo fica no bloco Contas a pagar', /\$\{campoDaFormaDePagamento\(\)\}/.test(tela) && /<select id="entradaFormaPagamento">/.test(tela));
check('  com "Sem forma" e as formas da análise', /<option value="">— Sem forma —<\/option>/.test(tela) && /tela\.formasDePagamento = resposta\.formasDePagamento \|\| \[\];/.test(tela));
check('  começando na sugerida, a cada nota', /tela\.formaDePagamentoId = resposta\.formaDePagamentoSugeridaId \|\| '';/.test(tela));
check('  mostrando o que a nota diz', /Na nota: \$\{escapeHtml\(\[\.\.\.new Set\(pagamentosDoXml\)\]\.join\(', '\)\)\}/.test(tela));
check('o Criar produto não perde a escolha', /'totalAPagar', 'formaDePagamentoId'\]/.test(tela));
check('vai no lançamento quando gera financeiro', /\.\.\.\(tela\.gerarFinanceiro && tela\.formaDePagamentoId \? \{ formaDePagamentoId: tela\.formaDePagamentoId \} : \{\}\)/.test(tela));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
