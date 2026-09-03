#!/usr/bin/env node
/**
 * O NÚMERO DO LANÇAMENTO FINANCEIRO — LF0001 (fase AT).
 *
 * Roda no `npm test`, sem servidor: tudo aqui é função pura ou leitura de
 * fonte.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. QUE A TELA DE EDIÇÃO SE IDENTIFICA PELO NÚMERO. Ela mostrava os oito
 *    últimos caracteres do id interno ("41196-9q1") — um pedaço de
 *    identificador que ninguém dita ao telefone, não ordena e não se procura.
 *    Se alguém voltar a usar o id no título, este teste acusa.
 *
 * 2. QUE O NÚMERO SAI DA SEQUENCE, e não de max(code)+1 no Node: max+1 reusa
 *    número depois de uma exclusão e gera o mesmo duas vezes sob concorrência.
 *    Número de documento repetido é pior do que número nenhum.
 *
 * 3. QUE LANÇAMENTO SEM NÚMERO NÃO VIRA "LF0000". Os registros anteriores à
 *    migração têm `code` nulo; inventar um código para eles criaria o mesmo
 *    "LF0000" repetido em todos.
 *
 * 4. QUE EDITAR E CRIAR SÃO A MESMA TELA. É o pedido: mesmo layout, título
 *    diferente. Se alguém duplicar o formulário para "customizar a edição",
 *    os dois passam a divergir campo a campo.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const codigo = require('../public/modules/shared/lancamento_codigo');

console.log('--- 1. o formato ---');
check('1 vira LF0001', codigo.formatar(1) === 'LF0001', codigo.formatar(1));
check('42 vira LF0042', codigo.formatar(42) === 'LF0042', codigo.formatar(42));
// Passar de 9999 não pode truncar nem reiniciar: número comprido é melhor do
// que número repetido.
check('10000 cresce, não trunca', codigo.formatar(10000) === 'LF10000', codigo.formatar(10000));
check('o padding deixa a ordem de texto igual à numérica',
  codigo.formatar(9) < codigo.formatar(10), `${codigo.formatar(9)} < ${codigo.formatar(10)}`);

console.log('\n--- 2. sem número não se inventa número ---');
check('nulo vira vazio', codigo.formatar(null) === '');
check('zero vira vazio', codigo.formatar(0) === '');
check('undefined vira vazio', codigo.formatar(undefined) === '');
// O rótulo é o que o título usa: sem número, sobra só o texto.
check('o rótulo sem número não diz "(sem número)"',
  codigo.rotulo(null, 'Editar Lançamento') === 'Editar Lançamento',
  codigo.rotulo(null, 'Editar Lançamento'));
check('e com número monta o título pedido',
  codigo.rotulo(42, 'Editar Lançamento') === 'Editar Lançamento LF0042',
  codigo.rotulo(42, 'Editar Lançamento'));

console.log('\n--- 3. a volta, para a busca ser tolerante ---');
check('LF0042 volta a 42', codigo.numero('LF0042') === 42);
check('  e 42 sozinho também', codigo.numero('42') === 42);
check('  texto que não é número devolve nulo', codigo.numero('abc') === null);

console.log('\n--- 4. o título da tela de edição ---');
const tela = ler('public/modules/finance/subs/novo_lancamento.js');
const semComentario = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const telaLimpa = semComentario(tela);
check('usa o rótulo compartilhado', /MavisLancamentoCodigo\.rotulo\(editEntry\.code, 'Editar Lançamento'\)/.test(telaLimpa));
// O defeito que originou o pedido.
check('  e NÃO mostra mais um pedaço do id interno',
  !/String\(editEntry\.id\)\.slice\(-8\)/.test(telaLimpa));
check('criar continua sendo "Novo Lançamento"', /'Novo Lançamento'/.test(telaLimpa));

console.log('\n--- 5. editar e criar são a MESMA tela ---');
// Uma função de render só, usada nos dois casos. Duas seriam duas telas para
// divergir campo a campo — que é justamente o que o pedido não quer.
const renders = (telaLimpa.match(/function renderForm\(/g) || []).length;
check('existe UMA função de formulário', renders === 1, `${renders} encontrada(s)`);
check('  e o modo de edição é um parâmetro, não outra tela',
  /editEntry \?/.test(telaLimpa));
// A tela de edição é alcançada pela lista, apontando para a MESMA sub-tela.
const lista = ler('public/modules/finance/subs/lancamentos.js');
check('a lista manda para a mesma sub-tela', /state\.activeSub = 'novo_lancamento'/.test(lista));

console.log('\n--- 6. o número vem do banco, não do Node ---');
const dados = ler('lib/db/financeiro.js');
check('a criação pede nextval', /nextval\('financial_entries_code_seq'\)/.test(dados));
check('  e não calcula max+1', !/max\(code\)/.test(semComentario(dados)));
const migracao = ler('banco/migrations/fase-at-numero-do-lancamento-financeiro.sql');
check('a migração cria a sequence', /create sequence if not exists financial_entries_code_seq/.test(migracao));
// Sem o setval, o próximo lançamento nasceria com LF0001 e esbarraria no índice
// único — e o erro apareceria na primeira conta a pagar de quem migrou.
check('  e continua a sequence depois do backfill', /setval\(\s*'financial_entries_code_seq'/.test(migracao));
check('  o número é único no banco', /create unique index[\s\S]{0,120}financial_entries \(code\)/.test(migracao));
// Numerar histórico é decidir o que o número significa: por entrada no sistema.
check('  o backfill numera por ordem de criação', /order by created_at, id/.test(migracao));

console.log('\n--- 7. o número chega à tela ---');
const servidor = ler('server.js');
check('a serialização manda code e codigo',
  /code: entry\.code == null \? null : Number\(entry\.code\)/.test(servidor)
  && /codigo: lancamentoCodigo\.formatar\(entry\.code\)/.test(servidor));
check('  o index.html carrega o compartilhado', /shared\/lancamento_codigo\.js/.test(ler('public/index.html')));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
