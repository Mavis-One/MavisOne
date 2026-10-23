#!/usr/bin/env node
// CONTA A PAGAR A PRAZO VENCE EM DIA ÚTIL (23/10/2026, fase FD).
//
// O usuário: "tudo que for colocado no sistema com vencimento para sábado,
// domingo e/ou feriados nacionais brasileiros seja jogado para o próximo dia
// útil" — e logo depois: "apenas contas a pagar com intuito de parcelamento ou a
// prazo; tudo que for à vista não entra nisso".
//
// Provado no servidor local: despesa a prazo no sábado 24/10 gravou 26/10; à
// vista (vence no dia) e receita ficaram em 24/10; três parcelas em Finados,
// 25/12 e Carnaval de 2027 gravaram 03/11, 28/12 e 10/02; editar o vencimento
// para domingo 15/11 gravou 16/11; o Parcelar em dois sábados gravou as
// segundas. Na tela, 24/10 digitado virou 26/10; na entrada de NF-e, 3 parcelas
// a 30 dias de 20/08 saíram 20/08, 21/09 (o 19/09 é sábado) e 19/10. A
// migração moveu só a conta a pagar a prazo em aberto (pendente e parcial), e
// o calendário dela (SQL) deu o mesmo dia útil que o JS nos 4.383 dias de 2024
// a 2035. Tudo apagado depois.
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

console.log('\n--- 1. o calendário (shared/dia_util.js) ---');
const D = require('../public/modules/shared/dia_util');
const iso = (d) => d.toISOString().slice(0, 10);
check('Páscoa de 2025, 2026 e 2027', iso(D.pascoa(2025)) === '2025-04-20' && iso(D.pascoa(2026)) === '2026-04-05' && iso(D.pascoa(2027)) === '2027-03-28');
const f26 = [...D.feriadosNacionais(2026).keys()].sort();
check('2026: os 13 dias sem expediente bancário nacional', f26.join() === [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04',
  '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25'].join(), f26.join());
check('20/11 só desde 2024 (Lei 14.759/2023)', !D.feriadosNacionais(2023).has('2023-11-20') && D.feriadosNacionais(2024).has('2024-11-20'));
check('sábado e domingo vão à segunda', D.proximoDiaUtil('2026-10-24') === '2026-10-26' && D.proximoDiaUtil('2026-10-25') === '2026-10-26');
check('feriado na sexta e fim de semana em seguida', D.proximoDiaUtil('2026-04-03') === '2026-04-06');
check('Carnaval: segunda e terça, vai à quarta', D.proximoDiaUtil('2027-02-06') === '2027-02-10');
check('dia útil fica', D.proximoDiaUtil('2026-10-23') === '2026-10-23' && D.ehDiaUtil('2026-10-23'));
check('o motivo diz por quê', D.motivo('2026-10-24') === 'sábado' && D.motivo('2026-11-02') === 'Finados' && D.motivo('2026-10-23') === '');

console.log('\n--- 2. a regra: só conta a pagar a prazo ---');
check('despesa a prazo no sábado vai ao dia útil', D.vencimentoDoTitulo({ type: 'DESPESA', date: '2026-10-01', dueDate: '2026-10-24' }) === '2026-10-26');
check('despesa à vista (vence no dia) fica', D.vencimentoDoTitulo({ type: 'DESPESA', date: '2026-10-24', dueDate: '2026-10-24' }) === '2026-10-24');
check('receita fica', D.vencimentoDoTitulo({ type: 'RECEITA', date: '2026-10-01', dueDate: '2026-10-24' }) === '2026-10-24');
check('transferência fica', D.vencimentoDoTitulo({ type: 'TRANSFERENCIA', date: '2026-10-01', dueDate: '2026-10-24' }) === '2026-10-24');
check('sem a data do lançamento, não se presume a prazo', D.vencimentoDoTitulo({ type: 'DESPESA', dueDate: '2026-10-24' }) === '2026-10-24');

console.log('\n--- 3. onde se aplica ---');
const db = semComentarios(ler('lib/db/financeiro.js'));
check('criar o título (o único insert de lançamento)', /due_date: diaUtil\.vencimentoDoTitulo\(\{\s*type: tipoDoLancamento\(payload\.type\), date: payload\.date, dueDate: payload\.dueDate \|\| payload\.date\s*\}\) \|\| payload\.date,/.test(db));
check('editar o vencimento, com tipo e data do título gravado quando não vêm', /row\.due_date = diaUtil\.vencimentoDoTitulo\(\{ type: tipoDoLancamento\(type\), date, dueDate: payload\.dueDate \}\);/.test(db)
  && /const atual = await getFinancialEntryById\(id\);/.test(db));
const servidor = semComentarios(ler('server.js'));
check('as rotas guardam o mesmo dia (edição e Parcelar)', (servidor.match(/entry\.dueDate = diaUtil\.vencimentoDoTitulo\(\{ \.\.\.entry, dueDate: (body\.dueDate|parcelas\[0\]\.dueDate) \}\);/g) || []).length === 3);
check('a importação do Viper casa pelo dia útil', /const mesmoVencimento = \(e\) => mesmoDiaUtil\(e\.dueDate\) === mesmoDiaUtil\(t\.vencimento\);/.test(ler('lib/importacao-contas-viper.js')));
check('telas: entrada de NF-e (parcelas e duplicatas), Novo Lançamento, Parcelar, entrada manual',
  /vencimento: ano \? vencimentoUtil\(/.test(ler('public/modules/purchases/subs/entrada_nfe.js'))
  && /\$\{dataBr\(vencimentoUtil\(d\.vencimento\)\)\}/.test(ler('public/modules/purchases/subs/entrada_nfe.js'))
  && /vencimentoUtil\(dataDaParcela\(primeira, i, intervalo\)\)/.test(ler('public/modules/finance/subs/novo_lancamento.js'))
  && /window\.MavisDiaUtil\.vencimentoDoTitulo\(\{ type: entry\.type, date: entry\.date, dueDate: bruta \}\)/.test(ler('public/modules/finance/subs/lancamentos.js'))
  && /D\.vencimentoDoTitulo\(\{ type: 'DESPESA', date: nota\.dataEmissao, dueDate: c\.value \}\)/.test(ler('public/modules/purchases/subs/entrada_nfe_manual.js')));
check('index.html carrega o calendário', /shared\/dia_util\.js/.test(ler('public/index.html')));

console.log('\n--- 4. os títulos que já existiam (migração) ---');
const sql = ler('banco/migrations/fase-fd-vencimento-em-dia-util.sql').replace(/--[^\n]*/g, '');
check('funções só da migração (pg_temp), sem segunda cópia permanente', (sql.match(/create function pg_temp\./g) || []).length === 3 && !/create (or replace )?function (?!pg_temp\.)/.test(sql));
check('só conta a pagar a prazo em aberto', /where type = 'DESPESA'\s*and status in \('pending', 'parcial'\)[\s\S]*and due_date > date\s*and not pg_temp\.eh_dia_util\(due_date\);/.test(sql));
check('o SQL do zero termina nela', /fase-fd-vencimento-em-dia-util\.sql/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
