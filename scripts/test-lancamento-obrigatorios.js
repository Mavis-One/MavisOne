#!/usr/bin/env node
// CONTA BANCÁRIA E CENTRO DE CUSTO OBRIGATÓRIOS NO LANÇAMENTO (23/10/2026).
//
// O usuário: "deixe os campos de centro de custo, conta bancária e banco em
// lançamentos e títulos financeiros como obrigatórios". O banco é o da conta.
//
// Provado no servidor local (com um centro de custo de teste): sem os dois, o
// POST deu 400 "Informe a conta bancária e o centro de custo do lançamento.";
// com os dois, 200; tirar o centro na edição, 400; editar só o vencimento de
// um título que já os tem, 200; transferência sem centro, 200. Na tela, os
// rótulos "Conta bancária *" e "Centro de custo *", e salvar sem eles avisou e
// pôs o cursor na conta bancária. Tudo apagado depois.
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
check('despesa sem conta e sem centro: os dois faltam', R.faltando({ type: 'DESPESA' }).map((c) => c.campo).join() === 'bankAccountId,costCenter');
check('receita também', R.faltando({ type: 'RECEITA', bankAccountId: 'b1' }).map((c) => c.campo).join() === 'costCenter');
check('com os dois, nada falta', R.faltando({ type: 'DESPESA', bankAccountId: 'b1', costCenter: 'c1' }).length === 0);
check('transferência fica fora (tem origem e destino, não tem centro)', R.faltando({ type: 'transferencia' }).length === 0);
check('espaço em branco não conta como preenchido', R.faltando({ type: 'DESPESA', bankAccountId: ' ', costCenter: 'c1' }).length === 1);
check('a mensagem junta os que faltam', R.mensagem(R.faltando({ type: 'DESPESA' })) === 'Informe a conta bancária e o centro de custo do lançamento.'
  && R.mensagem([]) === '');

console.log('\n--- 2. o servidor ---');
const servidor = semComentarios(ler('server.js'));
const validar = servidor.slice(servidor.indexOf('function validarLancamentoFinanceiro('), servidor.indexOf('function recomputeFinanceEntryStatus('));
check('o validador de sempre confere os dois', /const faltam = lancamentoObrigatorios\.faltando\(\{ type, bankAccountId, costCenter \}\);\s*if \(faltam\.length\) return lancamentoObrigatorios\.mensagem\(faltam\);/.test(validar));
check('  criar (POST) passa o corpo inteiro', /const invalido = validarLancamentoFinanceiro\(\{ \.\.\.body, type, amount \}\);/.test(servidor));
check('  editar (PUT) confere o resultado: o que veio, senão o gravado', /costCenter: body\.costCenter !== undefined \? body\.costCenter : entry\.costCenter/.test(servidor)
  && /bankAccountId: body\.bankAccountId !== undefined \? body\.bankAccountId : entry\.bankAccountId/.test(servidor));

console.log('\n--- 3. a tela (Novo Lançamento / Edição de Título) ---');
const tela = semComentarios(ler('public/modules/finance/subs/novo_lancamento.js'));
check('os rótulos têm o asterisco', /<label>Conta bancária \*/.test(tela) && /<label>Centro de custo \*/.test(tela));
check('salvar sem eles avisa, leva ao campo e não envia',
  /window\.MavisLancamentoObrigatorios\.faltando\(\{ \.\.\.payload, type: formType \}\)/.test(tela)
  && /document\.getElementById\(faltamNoLancamento\[0\]\.foco\)\?\.focus\(\);/.test(tela));
check('index.html carrega a regra', /shared\/lancamento_obrigatorios\.js/.test(ler('public/index.html')));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
