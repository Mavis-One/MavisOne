#!/usr/bin/env node
/**
 * O NOME DA FILIAL NOS CAMPOS DE ESCOLHA (13/10/2026).
 *
 * O campo Filial do cadastro de depósito listava onze "SAL INFINITY PLUS
 * COMERCIO LTDA" iguais: o meta do Estoque mandava só a razão social. Este
 * teste segura as três saídas — fantasia, cidade + filial do CNPJ, desempate.
 */
const fs = require('fs');
const path = require('path');
const { opcoesDeEmpresa, rotuloDaEmpresa, numeroDaFilial } = require('../lib/rotulo-da-empresa');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const RAZAO = 'SAL INFINITY PLUS COMERCIO LTDA';
check('o nome fantasia vem primeiro', rotuloDaEmpresa({ name: RAZAO, tradeName: 'SAL INFINITY PLUS (TIMBO)' }) === 'SAL INFINITY PLUS (TIMBO)');
const semFantasia = rotuloDaEmpresa({ name: RAZAO, city: 'Timbó', document: '43.792.899/0005-69' });
check('sem fantasia: razão social + cidade + filial', semFantasia === `${RAZAO} — Timbó 0005`, semFantasia);
check('CPF não vira número de filial', numeroDaFilial('123.456.789-09') === '');

const lojas = [
  { id: 'a', name: RAZAO, city: 'Joinville', document: '43792899000801' },
  { id: 'b', name: RAZAO, city: 'Joinville', document: '43792899000992' },
  { id: 'c', name: RAZAO, tradeName: 'LOJA', document: '43792899000216' },
  { id: 'd', name: RAZAO, tradeName: 'LOJA', document: '43792899000305' }
];
const nomes = opcoesDeEmpresa(lojas).map((o) => o.name);
check('nenhum rótulo repetido', new Set(nomes).size === nomes.length, nomes.join(' | '));
check('  fantasia repetida desempata pela filial', nomes.includes('LOJA (0002)') && nomes.includes('LOJA (0003)'));
check('a lista leva só id e nome', Object.keys(opcoesDeEmpresa(lojas)[0]).join() === 'id,name');

const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('o meta do Estoque usa o rótulo da filial', /companies: opcoesDeEmpresa\(data\.companies\)/.test(servidor));
check('  e não manda mais a razão social crua', !/companies: \(data\.companies \|\| \[\]\)\.map\(\(c\) => \(\{ id: c\.id, name: c\.name \}\)\)/.test(servidor));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
