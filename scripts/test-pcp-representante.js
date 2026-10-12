#!/usr/bin/env node
// REPRESENTANTE NAS ORDENS DE PRODUÇÃO (fase DZ, 12/10/2026).
//
// Decisão do usuário: o representante é PESSOA (ou empresa) do Cadastros com
// o papel "Representante", como o Vendedor. O PCP ganhou a tela
// Representantes (lista + "+ Novo representante", que abre o formulário do
// Cadastros com o papel marcado) e o campo Representante na OP, com coluna e
// filtro na lista. Provado no navegador, no banco local, em 12/10/2026.
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

console.log('\n--- 1. banco ---');
const mig = ler('banco/migrations/fase-dz-pcp-representante.sql');
check('coluna representante_id na OP', /alter table if exists pcp_orders add column if not exists representante_id text;/.test(mig));
check('RECRIAR-DO-ZERO inclui a fase DZ', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-dz-pcp-representante.sql'));
const modulos = require('../lib/db/modulos');
const def = (modulos.RECURSOS || modulos.recursos || {})['pcp/orders'];
const fonteModulos = semComentarios(ler('lib/db/modulos.js'));
check('a OP lê e grava representanteId', /representanteId: \['representante_id', 'texto'\]/.test(fonteModulos) || (def && def.campos && def.campos.representanteId));

console.log('\n--- 2. servidor ---');
const server = semComentarios(ler('server.js'));
check('representante = papel "Representante", em pessoas E empresas',
  /function getRepresentantesDirectory\(data\)[\s\S]{0,300}marcar\(data\.people, 'people'\), \.\.\.marcar\(data\.cnpjs, 'cnpj'\)[\s\S]{0,120}entry\.roles\.includes\('Representante'\)/.test(server));
check('a meta do PCP só lê o cadastro quando pedem', /if \(url\.searchParams\.get\('representantes'\) === '1'\) \{[\s\S]{0,200}apoio\.representantes = getRepresentantesDirectory\(dados\);/.test(server));

console.log('\n--- 3. Cadastros ---');
const app = semComentarios(ler('public/app.js'));
check('papel "Representante" no formulário', /'Representada', 'Representante', 'Vendedor'/.test(app));
check('filtro "Exibir Representantes" na lista', /name="showRepresentatives"[\s\S]{0,80}Exibir Representantes/.test(app) && /showRepresentatives: Boolean\(data\.get\('showRepresentatives'\)\)/.test(app));
const lista = ler('public/modules/shared/lista_de_cadastros.js');
check('  e a lista sabe esconder o papel', /\['showRepresentatives', 'Representante'\]/.test(lista) && /showRepresentatives: g\.showRepresentatives \?\? true/.test(lista));

console.log('\n--- 4. PCP ---');
const pcp = semComentarios(ler('public/modules/pcp/subs/pcp.js'));
check('tela Representantes no menu do PCP', /\{ key: 'representantes', label: 'Representantes'/.test(app) && /R\.representantes = async function renderRepresentantes/.test(pcp));
check('"+ Novo representante" abre o Cadastros com o papel marcado', /abrirNoCadastros\(\{ roles: \['Representante'\], status: 'ativo' \}, 'register'\)/.test(pcp));
check('o lápis abre o cadastro INTEIRO (busca pelo id)', /\/api\/cadastros\/pessoas\/\$\{encodeURIComponent\(id\)\}/.test(pcp) && /'edit'\);/.test(pcp));
check('OP: campo Representante no formulário', /name: 'representanteId', label: 'Representante', type: 'select', empty: 'Sem representante'/.test(pcp));
check('  coluna e filtro na lista de ordens', /label: 'Representante', render: \(i, meta\) => nomeDe\(meta\.representantes, i\.representanteId\)/.test(pcp) && /\{ name: 'representanteId', label: 'Representante', type: 'select', options:/.test(pcp));
check('  e as duas telas pedem a lista', /R\.ordens = C\.makeListScreen\(\{\s*\.\.\.baseComRepresentantes/.test(pcp) && /R\.nova_ordem = C\.makeFormScreen\(\{\s*\.\.\.baseComRepresentantes/.test(pcp));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
