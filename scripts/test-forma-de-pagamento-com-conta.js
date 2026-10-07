#!/usr/bin/env node
// FORMA DE PAGAMENTO COM CONTA BANCÁRIA ERA SEMPRE RECUSADA.
//
// O DEFEITO (achado na rodada de desempenho, out/2026)
// ----------------------------------------------------
// Cadastros › Nova Forma de Pagamento oferece as contas bancárias num select.
// A pessoa escolhia uma e salvar respondia "Conta bancária não encontrada." —
// para QUALQUER conta, inclusive as que o próprio select listou.
//
// O `build` da forma de pagamento (lib/cadastros-core.js) confere o
// bankAccountId contra `data.bankAccounts`. Essa coleção está em
// NAO_PERSISTIR desde que as contas foram para o Postgres (fase BA): loadData
// a devolve vazia, e a rota genérica de cadastros, que carregava as
// credenciadoras para a mesma validação, nunca carregou as contas. Resultado:
// nenhuma das 16 formas desta base tem conta — ninguém conseguiu salvar.
//
// De carona, a coluna "Conta bancária" da lista saía sempre "-": o
// `serialize` procura o nome na mesma coleção vazia.
//
// O CONSERTO: a rota carrega as contas (syncContasBancarias, só a tabela de
// contas, sem o resto do Financeiro) junto das credenciadoras, para este
// cadastro. A regra continua a escrita: recusar conta que NÃO EXISTE.
//
// SEM BANCO: a regra roda de verdade sobre listas de exemplo, e a rota é
// conferida no fonte.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const { semComentarios } = require('./sem-comentarios');
const cadastrosCore = require(path.join(RAIZ, 'lib', 'cadastros-core'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const forma = cadastrosCore.CADASTRO_COLLECTIONS['payment-methods'];
const CONTAS = [{ id: 'conta-1', name: 'Banco do Brasil' }, { id: 'conta-2', name: 'Sicredi' }];
const tentar = (body, data) => {
  try { return { ok: true, valor: forma.build(body, null, data) }; } catch (erro) { return { ok: false, erro }; }
};

console.log('--- 1. a regra: recusa conta que não existe, e só ela ---');
{
  const comConta = tentar({ name: 'PIX Sicredi', bankAccountId: 'conta-2' }, { bankAccounts: CONTAS });
  check('conta que existe é aceita', comConta.ok && comConta.valor.bankAccountId === 'conta-2',
    comConta.ok ? undefined : comConta.erro.message);
  const inexistente = tentar({ name: 'PIX', bankAccountId: 'conta-9' }, { bankAccounts: CONTAS });
  check('conta que não existe é recusada com 404',
    !inexistente.ok && inexistente.erro.status === 404 && /Conta bancária não encontrada/.test(inexistente.erro.message));
  const semConta = tentar({ name: 'Dinheiro' }, { bankAccounts: [] });
  check('forma sem conta continua sendo aceita', semConta.ok && semConta.valor.bankAccountId === '');
  // O defeito, reproduzido: com a coleção vazia (o que loadData devolve), a
  // conta que existe de verdade é recusada. É por isso que a rota TEM de
  // carregar as contas antes do build.
  const comoEra = tentar({ name: 'PIX Sicredi', bankAccountId: 'conta-2' }, { bankAccounts: [] });
  check('(o defeito: sem as contas carregadas, a conta real era recusada)', !comoEra.ok);
  const lista = forma.serialize({ id: 'f1', name: 'PIX Sicredi', bankAccountId: 'conta-2' }, { bankAccounts: CONTAS });
  check('a lista mostra o nome da conta', lista.bankAccountName === 'Sicredi', lista.bankAccountName);
}

console.log('\n--- 2. a rota genérica carrega as contas para este cadastro ---');
const servidor = semComentarios(ler('server.js'));
const rota = servidor.slice(servidor.indexOf('const cadastroCollectionMatch = pathname.match('));
const ramo = /if \(cadastroCollectionMatch\[1\] === 'payment-methods'\) \{([\s\S]*?)\n {6}\}/.exec(rota);
check('o ramo da forma de pagamento existe', Boolean(ramo));
check('  carrega as credenciadoras (fase BV)', ramo && /data\.cardAcquirers = await adquirentesDb\.listar\(\);/.test(ramo[1]));
check('  E as contas bancárias', ramo && /await syncContasBancarias\(data\);/.test(ramo[1]));
check('  antes do build de qualquer método',
  rota.indexOf('await syncContasBancarias(data);') > -1
  && rota.indexOf('await syncContasBancarias(data);') < rota.indexOf('config.build(body, null, data, helpers)')
  && rota.indexOf('await syncContasBancarias(data);') < rota.indexOf('config.build(body, list[index], data, helpers)'));
check('as contas vêm só da tabela de contas, não do Financeiro inteiro',
  /async function syncContasBancarias\(data\) \{\s*\n\s*data\.bankAccounts = await db\.getBankAccounts\(\);/.test(servidor)
  && !/if \(cadastroCollectionMatch\[1\] === 'payment-methods'\) \{[^}]*syncFinanceData/.test(rota));

console.log('\n--- 3. a tela oferece as contas que o servidor aceita ---');
const tela = ler('public/modules/cadastros/subs/nova_forma_pagamento.js');
check('o select lê meta.bankAccounts', /name: 'bankAccountId'[^\n]*options: \(meta\) => meta\.bankAccounts/.test(tela));
check('  e a tela pede essa parte da meta', /metaPartes: \[[^\]]*'bankAccounts'/.test(tela));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
