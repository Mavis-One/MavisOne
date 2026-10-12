#!/usr/bin/env node
// PRODUTOS DO VIPER PELA PLANILHA "PRODUTOS" (12/10/2026).
//
// Guarda as decisões do usuário: entram os produtos de código novo e o NCM
// onde está vazio; NÃO entram estoque (a coluna é o total do grupo), preço
// dos que já existem, NCM diferente nem nome dos que já existem. Provado no
// banco local: 272 novos + 83 NCM, e a segunda rodada não grava nada.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const P = require('../lib/importacao-produtos-viper');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');

const planilha = (linhas) => [{ linhas: [
  ['PRODUTOS'], ['SAL INFINITY ELECTRIC LTDA'], ['Gerado em: 12/10/2026'],
  P.CABECALHO.slice(),
  ...linhas
] }];

console.log('\n--- 1. leitura ---');
const lida = P.lerPlanilha(planilha([
  ['7691', '-cod40  paralama   dianteiro q3', 'UN', 'Produto', '140', '1', '8714.99.10', 'TRIBUTADO', 'Ativo', '14/09/2026'],
  ['1362', 'Correia Dayco', 'UN', 'Produto', '65', '0', '4010.33.00', 'TRIBUTADO', 'Inativo', '14/09/2026'],
  ['101062', 'Adaptador', 'UN', 'Produto', '', '0', '', 'TRIBUTADO', 'Ativo', '25/09/2026'],
  ['1362', 'Repetido', 'UN', 'Produto', '1', '0', '', '', 'Ativo', ''],
  ['', '', '', '', '', '', '', '', '', '']
]));
check('empresa vem do topo', lida.empresa === 'SAL INFINITY ELECTRIC LTDA', lida.empresa);
check('nome em maiúscula, sem espaço sobrando', lida.itens[0].nome === '-COD40 PARALAMA DIANTEIRO Q3', lida.itens[0].nome);
check('NCM só dígitos', lida.itens[0].ncm === '87149910');
check('inativo reconhecido', lida.itens[1].ativo === false && lida.itens[0].ativo === true);
check('sem preço e sem NCM: zero e vazio', lida.itens[2].preco === 0 && lida.itens[2].ncm === '');
check('código repetido fica de fora, com o motivo', lida.itens.length === 3 && lida.ignorados.some((x) => x.codigo === '1362' && /repetido/.test(x.motivo)));
let recusou = '';
try { P.lerPlanilha([{ linhas: [['Código', 'Descrição', 'Preço']] }]); } catch (e) { recusou = e.message; }
check('coluna fora do lugar: recusa (preço no NCM não passa calado)', /fora do lugar/.test(recusou), recusou.slice(0, 60));

console.log('\n--- 2. o que entra ---');
const plano = P.planejar(lida.itens, [
  { id: 'p1', sku: '7691', ncm: '' },
  { id: 'p2', sku: '1362', ncm: '40103300' }
]);
check('código que já existe não é novo', plano.existentes === 2 && plano.novos.map((n) => n.codigo).join() === '101062');
check('NCM entra onde está VAZIO', plano.ncmParaPreencher.length === 1 && plano.ncmParaPreencher[0].id === 'p1' && plano.ncmParaPreencher[0].ncm === '87149910');
const outroNcm = P.planejar([{ ...lida.itens[1], ncm: '99999999' }], [{ id: 'p2', sku: '1362', ncm: '40103300' }]);
check('NCM diferente do daqui NÃO é trocado', outroNcm.ncmParaPreencher.length === 0);
check('código compara sem maiúscula/minúscula', P.planejar([{ ...lida.itens[0], codigo: 'ab1' }], [{ id: 'x', sku: 'AB1', ncm: '1' }]).existentes === 1);

console.log('\n--- 3. o que NÃO entra (no fonte) ---');
const lib = semComentarios(fs.readFileSync(path.join(RAIZ, 'lib/importacao-produtos-viper.js'), 'utf8'));
const db = semComentarios(fs.readFileSync(path.join(RAIZ, 'lib/db/produtos-importados.js'), 'utf8'));
check('estoque da planilha nunca é lido', !/l\[5\]/.test(lib));
check('produto novo nasce com saldo e custo zero', /values|select \$1, \$2, \$3, 0, 0, \$4/.test(db) && /select \$1, \$2, \$3, 0, 0, \$4/.test(db));
check('o único UPDATE é o do NCM vazio', (db.match(/update products/g) || []).length === 1 && /update products set ncm = \$2 where id = \$1 and coalesce\(trim\(ncm\), ''\) = ''/.test(db));
check('reimportar não duplica (where not exists pelo SKU)', /where not exists \(select 1 from products where lower\(trim\(sku\)\) = lower\(\$3\)\)/.test(db));
check('tudo numa transação', /emTransacao\(async \(cliente\)/.test(db));

console.log('\n--- 4. a rota ---');
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
check('só administrador', /pathname === '\/api\/stock\/importacao\/viper'[\s\S]{0,200}!\(await ehAdmin\(user\)\)\) return sendJson\(res, \{ error: 'Só um administrador importa produtos/.test(server));
check('simular confere sem gravar', /gravarProdutos\(body\.itens, \{ simular: body\.simular === true \}\)/.test(server));
check('inativo vai para o meta do produto, como na tela', /stockCore\.buildProductMeta\(\{ status: criado\.ativo \? 'ativo' : 'inativo', unit: 'UN' \}\)/.test(server));
check('fica na auditoria', /action: 'estoque\.importacao\.viper'/.test(server));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
