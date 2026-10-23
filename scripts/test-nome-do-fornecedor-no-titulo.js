#!/usr/bin/env node
// O NOME DO CLIENTE/FORNECEDOR GRAVADO NO TÍTULO (fase FC, 23/10/2026).
//
// O usuário, num print do relatório de contas: "o fornecedor de dois títulos
// não foi puxado por mais que ele já estivesse cadastrado". O formulário do
// título manda o CÓDIGO do cadastro escolhido e deixa o nome vazio ("Nome
// livre" é para quem não tem cadastro); as telas acham o nome no cadastro
// inteiro, e o relatório só em `people` — fornecedor cadastrado como CNPJ saía
// em branco.
//
// Provado no servidor local, com um fornecedor de teste só no cadastro de
// CNPJs: título criado com ele gravou "SEGURADORA TESTE FC LTDA"; trocar o
// fornecedor de um título na edição trocou o nome junto; um título com o nome
// apagado (como os de produção) saiu com o nome no relatório Contas a Pagar, e
// a atualização da migração o preencheu. Tudo apagado depois.
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

console.log('\n--- 1. a gravação (lib/db/financeiro.js) ---');
const db = semComentarios(ler('lib/db/financeiro.js'));
check('o nome sai do cadastro inteiro: pessoas e CNPJs',
  /select name from people where id = \$1 union all select name from cnpjs where id = \$1 limit 1/.test(db));
check('  e não achar não impede gravar', /catch \(erro\) \{\s*return '';\s*\}/.test(db.slice(db.indexOf('async function nomeDoCadastro('))));
check('criar: cadastro escolhido sem nome livre grava o nome do cadastro',
  /client_supplier_name: payload\.clientSupplierName\s*\|\| \(payload\.clientSupplierId \? await nomeDoCadastro\(payload\.clientSupplierId\) : ''\),/.test(db));
check('editar: idem, e o nome livre continua valendo quando vem',
  /if \(payload\.clientSupplierName !== undefined\) row\.client_supplier_name = payload\.clientSupplierName;\s*if \(payload\.clientSupplierId && !String\(payload\.clientSupplierName \|\| ''\)\.trim\(\)\) \{\s*row\.client_supplier_name = \(await nomeDoCadastro\(payload\.clientSupplierId\)\) \|\| row\.client_supplier_name \|\| '';/.test(db));
check('é o único lugar que insere título', (ler('server.js').match(/from\('financial_entries'\)\.insert|insert into financial_entries/g) || []).length === 0
  && (ler('lib/db/financeiro.js').match(/from\('financial_entries'\)\.insert/g) || []).length === 1);

console.log('\n--- 2. os títulos que já existiam (migração) ---');
const sql = ler('banco/migrations/fase-fc-nome-do-fornecedor-no-titulo.sql').replace(/--[^\n]*/g, '');
check('preenche pelos dois cadastros, só os sem nome',
  /update financial_entries e set client_supplier_name = p\.name\s*from people p\s*where p\.id = e\.client_supplier_id\s*and coalesce\(e\.client_supplier_name, ''\) = ''/.test(sql)
  && /update financial_entries e set client_supplier_name = c\.name\s*from cnpjs c\s*where c\.id = e\.client_supplier_id\s*and coalesce\(e\.client_supplier_name, ''\) = ''/.test(sql));
check('o SQL do zero termina nela', /fase-fc-nome-do-fornecedor-no-titulo\.sql/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

console.log('\n--- 3. os relatórios (lib/relatorios/financeiro.js) ---');
const rel = ler('lib/relatorios/financeiro.js');
check('Contas a Pagar/Receber: pessoa, CNPJ e o nome gravado, nessa ordem',
  rel.includes("coalesce(pe.name, cn.name, nullif(e.client_supplier_name, ''), '') as pessoa")
  && (rel.match(/left join cnpjs cn on cn\.id = e\.client_supplier_id/g) || []).length === 2);
check('Inadimplentes: nome, documento e telefone também do CNPJ',
  rel.includes("coalesce(pe.name, cn.name, nullif(e.client_supplier_name, ''), 'Sem cliente') as cliente")
  && rel.includes("coalesce(pe.document, cn.document, '') as documento, coalesce(pe.phone, cn.phone, '') as telefone"));
check('nenhuma crase solta dentro do SQL (quebraria a template string)', (() => {
  try { require('../lib/relatorios/financeiro'); return true; } catch (e) { return false; }
})());

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
