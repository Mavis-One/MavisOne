#!/usr/bin/env node
// IBS e CBS — Reforma Tributária (LC 214/2025).
//
// A armadilha desta tabela: cClassTrib e CST NÃO são códigos independentes.
// Os 3 primeiros dígitos do cClassTrib SÃO o CST. Uma linha cadastrada sob o
// CST errado passa no cadastro, vai para a nota e volta como rejeição da
// SEFAZ — ou pior, classifica a operação sob uma hipótese legal que não é a
// dela, e isso ninguém confere depois.
//
// A outra: a carga é PARCIAL de propósito (a tabela oficial tem centenas de
// códigos e aqui só entrou o que foi conferido um a um). Se a tela tratar a
// lista como exaustiva, o usuário fica impedido de cadastrar um código
// legítimo por uma limitação nossa.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const migracao = ler('supabase/migrations/fase-z-ibs-cbs.sql');
const dbSrc = ler('lib/db/fiscal.js');
const telaSrc = ler('public/modules/fiscal/subs/regras.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Extrai as linhas de INSERT para conferir os dados, não só o texto do SQL.
function linhasInsert(tabela, colunas) {
  const inicio = migracao.indexOf(`insert into ${tabela} (`);
  const fim = migracao.indexOf('on conflict', inicio);
  const trecho = migracao.slice(inicio, fim);
  return [...trecho.matchAll(/\(([^()]*)\)(?=,\s*$|\s*$)/gm)]
    .map((m) => m[1].split(/',\s*'/).map((s) => s.replace(/^'|'$/g, '').trim()))
    .filter((campos) => campos.length === colunas)
    .map((campos) => campos);
}

console.log('--- CST do IBS/CBS: a lista completa ---');
const csts = linhasInsert('cst_ibs_cbs', 2);
const codigosCst = csts.map((c) => c[0]);
// Conferido contra a listagem do ERP em uso (2026-08-10).
const ESPERADOS = ['000', '010', '011', '200', '210', '220', '221', '222', '400', '410',
  '510', '515', '550', '620', '800', '810', '811', '820', '830'];
check('19 códigos', codigosCst.length === 19, String(codigosCst.length));
ESPERADOS.forEach((c) => check(`CST ${c} presente`, codigosCst.includes(c)));
check('nenhum código a mais', codigosCst.every((c) => ESPERADOS.includes(c)), codigosCst.filter((c) => !ESPERADOS.includes(c)).join(',') || 'ok');
check('todos com 3 dígitos', codigosCst.every((c) => /^\d{3}$/.test(c)));
check('sem duplicata', new Set(codigosCst).size === codigosCst.length);

console.log('\n--- cClassTrib: o código carrega o CST dentro dele ---');
const classes = linhasInsert('classificacao_tributaria', 3);
check('carga tem códigos', classes.length > 0, `${classes.length} código(s)`);
check('todos com 6 dígitos', classes.every(([codigo]) => /^\d{6}$/.test(codigo)));
// A regra que o banco também impõe por CHECK — testada aqui para pegar o erro
// antes de tentar rodar a migração.
classes.forEach(([codigo, cst]) => {
  check(`${codigo} declara o CST do próprio prefixo`, codigo.slice(0, 3) === cst, `prefixo ${codigo.slice(0, 3)} x cst ${cst}`);
});
classes.forEach(([codigo, cst]) => {
  check(`  ${codigo}: o CST ${cst} existe na tabela`, codigosCst.includes(cst));
});
check('sem duplicata', new Set(classes.map((c) => c[0])).size === classes.length);
check('toda linha tem descrição', classes.every(([, , desc]) => desc && desc.length > 10));

console.log('\n--- o banco impede a incoerência sozinho ---');
// Se só o teste conferir, uma carga futura feita direto no SQL Editor entra errada.
check('CHECK amarra cst ao prefixo do código', /check \(cst = substring\(codigo from 1 for 3\)\)/.test(migracao));
check('FK garante que o CST existe', /references cst_ibs_cbs\(codigo\)/.test(migracao));
check('índice por CST', /idx_classificacao_tributaria_cst/.test(migracao));

console.log('\n--- a migração pode rodar duas vezes ---');
check('create table if not exists', (migracao.match(/create table if not exists/g) || []).length >= 2);
check('on conflict nos inserts', (migracao.match(/on conflict \(codigo\) do update/g) || []).length >= 2);
check('add column if not exists', (migracao.match(/add column if not exists/g) || []).length === 4);

console.log('\n--- a regra fiscal carrega os campos novos ---');
['cst_ibs_cbs', 'class_trib', 'aliquota_ibs', 'aliquota_cbs'].forEach((coluna) => {
  check(`coluna ${coluna} criada`, new RegExp(`add column if not exists ${coluna}`).test(migracao));
  check(`  ${coluna} lida no map`, new RegExp(`row\\.${coluna}`).test(dbSrc));
});
check('cstIbsCbs gravado', /cst_ibs_cbs: textoOuNulo\(payload\.cstIbsCbs\)/.test(dbSrc));
check('classTrib gravado', /class_trib: textoOuNulo\(payload\.classTrib\)/.test(dbSrc));
// Alíquota 0 é legítima (CST 400 isenção, 410 imunidade): `|| null` a
// transformaria em "não preenchido".
check('alíquota IBS aceita zero', /aliquota_ibs: numeroOuNulo\(payload\.aliquotaIbs\)/.test(dbSrc));
check('alíquota CBS aceita zero', /aliquota_cbs: numeroOuNulo\(payload\.aliquotaCbs\)/.test(dbSrc));

console.log('\n--- as tabelas chegam na tela ---');
check('cst_ibs_cbs consultada', /consultar\('cst_ibs_cbs', 'codigo'\)/.test(dbSrc));
check('classificacao_tributaria consultada', /consultar\('classificacao_tributaria', 'codigo'\)/.test(dbSrc));
// Sem a migração aplicada, as outras tabelas não podem parar de funcionar.
check('ausência das tabelas não derruba as outras', /if \(\/does not exist\|Could not find\|schema cache\/i\.test/.test(dbSrc));
check('a tela recebe cstIbsCbs', /cstIbsCbs: cstIbsCbs \|\| \[\]/.test(dbSrc));
check('a tela recebe a classificação', /classificacaoTributaria: classTrib \|\| \[\]/.test(dbSrc));

console.log('\n--- a lista parcial não vira camisa de força ---');
// Select fechado impediria cadastrar um código oficial que ainda não subiu.
check('cClassTrib aceita digitação', /<input name="classTrib" list="listaClassTrib"/.test(telaSrc));
check('com sugestão por datalist', /<datalist id="listaClassTrib">/.test(telaSrc));
check('e avisa que a lista não é exaustiva', /pode digitar um que não esteja na lista/.test(telaSrc));
check('o servidor marca a carga como parcial', /classificacaoTributariaParcial: true/.test(dbSrc));
check('a migração diz que está parcial', /PARCIAL de propósito/.test(migracao));

console.log('\n--- os campos são enviados e relidos ---');
// Se ficarem de fora de CAMPOS_TEXTO, o formulário desenha mas não grava — e
// editar uma regra apagaria o que já estava salvo.
['cstIbsCbs', 'classTrib', 'aliquotaIbs', 'aliquotaCbs'].forEach((campo) => {
  check(`${campo} está em CAMPOS_TEXTO`, new RegExp(`'${campo}'`).test(telaSrc.slice(telaSrc.indexOf('const CAMPOS_TEXTO'), telaSrc.indexOf('function semAcento'))));
});
check('a seção de IBS/CBS existe no formulário', /IBS e CBS — Reforma Tributária/.test(telaSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
