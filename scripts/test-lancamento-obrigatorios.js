#!/usr/bin/env node
// CONTA BANCÁRIA E CENTRO DE CUSTO OBRIGATÓRIOS NO LANÇAMENTO (23/10/2026).
//
// O usuário: "deixe os campos de centro de custo, conta bancária e banco em
// lançamentos e títulos financeiros como obrigatórios". O banco é o da conta.
// Logo depois: "a obrigatoriedade de centro de custo fique apenas na raiz do
// CNPJ 43.792.899, pois os demais não têm; deixe como opcional".
//
// Provado no servidor local (com um centro de custo de teste): sem os dois, o
// POST deu 400 "Informe a conta bancária e o centro de custo do lançamento.";
// com os dois, 200; tirar o centro na edição, 400; editar só o vencimento de
// um título que já os tem, 200; transferência sem centro, 200. Na tela, os
// rótulos "Conta bancária *" e "Centro de custo *", e salvar sem eles avisou e
// pôs o cursor na conta bancária. Depois da regra da raiz: título da Electric
// (46.877.837) sem centro, 200; da Plus (43.792.899) sem centro, 400; e o
// asterisco do centro some e volta ao trocar a empresa na tela. Tudo apagado.
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

console.log('\n--- 1. a regra (shared/lancamento_obrigatorios.js) ---');
const R = require('../public/modules/shared/lancamento_obrigatorios');
const PLUS = '43.792.899/0001-35';
const campos = (l) => R.faltando(l).map((c) => c.campo).join();
check('despesa da raiz 43.792.899 sem conta e sem centro: os dois faltam', campos({ type: 'DESPESA', cnpjDoEstabelecimento: PLUS }) === 'bankAccountId,costCenter');
check('receita também', campos({ type: 'RECEITA', bankAccountId: 'b1', cnpjDoEstabelecimento: PLUS }) === 'costCenter');
check('outra raiz (Electric 46.877.837): só a conta', campos({ type: 'DESPESA', cnpjDoEstabelecimento: '46877837000114' }) === 'bankAccountId');
check('sem estabelecimento conhecido: só a conta', campos({ type: 'DESPESA' }) === 'bankAccountId');
check('a raiz é conferida com ou sem máscara', R.exigeCentroDeCusto('43792899000216') && R.exigeCentroDeCusto('43.792.899/0005-69') && !R.exigeCentroDeCusto('4379289'));
check('com os dois, nada falta', R.faltando({ type: 'DESPESA', bankAccountId: 'b1', costCenter: 'c1', cnpjDoEstabelecimento: PLUS }).length === 0);
check('transferência fica fora (tem origem e destino, não tem centro)', R.faltando({ type: 'transferencia', cnpjDoEstabelecimento: PLUS }).length === 0);
check('espaço em branco não conta como preenchido', R.faltando({ type: 'DESPESA', bankAccountId: ' ', costCenter: 'c1', cnpjDoEstabelecimento: PLUS }).length === 1);
check('a mensagem junta os que faltam', R.mensagem(R.faltando({ type: 'DESPESA', cnpjDoEstabelecimento: PLUS })) === 'Informe a conta bancária e o centro de custo do lançamento.'
  && R.mensagem([]) === '');

console.log('\n--- 2. o servidor ---');
const servidor = semComentarios(ler('server.js'));
const validar = servidor.slice(servidor.indexOf('function validarLancamentoFinanceiro('), servidor.indexOf('function recomputeFinanceEntryStatus('));
check('o validador de sempre confere, com o CNPJ do estabelecimento',
  validar.includes('const faltam = lancamentoObrigatorios.faltando({ type, bankAccountId, costCenter, cnpjDoEstabelecimento: cnpj });')
  && validar.includes('if (faltam.length) return lancamentoObrigatorios.mensagem(faltam);'));
check('  criar e editar resolvem o estabelecimento antes e mandam o CNPJ dele',
  servidor.includes('validarLancamentoFinanceiro({ ...body, type, amount, cnpjDoEstabelecimento: await cnpjDoEstabelecimento(escolha.id) })')
  && servidor.includes('validarLancamentoFinanceiro({ ...proposto, cnpjDoEstabelecimento: await cnpjDoEstabelecimento(escolhaPut.id) })'));
check('  editar (PUT) confere o resultado: o que veio, senão o gravado', /costCenter: body\.costCenter !== undefined \? body\.costCenter : entry\.costCenter/.test(servidor)
  && /bankAccountId: body\.bankAccountId !== undefined \? body\.bankAccountId : entry\.bankAccountId/.test(servidor));
check('  o CNPJ sai do estabelecimento do título', /async function cnpjDoEstabelecimento\(estabelecimentoId\) \{[\s\S]{0,200}fiscalDb\.getEstabelecimentoById\(estabelecimentoId\)/.test(servidor));
check('  e a tela recebe o CNPJ de cada estabelecimento', servidor.includes('razaoSocial: e.razaoSocial, nomeFantasia: e.nomeFantasia, cnpj: e.cnpj }'));

console.log('\n--- 3. a tela (Novo Lançamento / Edição de Título) ---');
const tela = semComentarios(ler('public/modules/finance/subs/novo_lancamento.js'));
check('conta com asterisco; o do centro conforme a empresa', tela.includes('<label>Conta bancária *')
  && tela.includes("<label>Centro de custo<span data-centro-asterisco>${centroObrigatorioAqui() ? ' *' : ''}</span>")
  && tela.includes("asterisco.textContent = centroObrigatorioAqui() ? ' *' : '';"));
check('salvar sem eles avisa, leva ao campo e não envia',
  tela.includes('window.MavisLancamentoObrigatorios.faltando({ ...payload, type: formType, cnpjDoEstabelecimento: cnpjDoEstabelecimentoAtual() })')
  && tela.includes('document.getElementById(faltamNoLancamento[0].foco)?.focus();'));
check('index.html carrega a regra', /shared\/lancamento_obrigatorios\.js/.test(ler('public/index.html')));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
