#!/usr/bin/env node
// DEPÓSITOS DE MONTADOS E DESMONTADOS, SÓ NA MATRIZ (fase EE, 13/10/2026).
//
// Pedido do usuário: a classificação montados/desmontados só na empresa
// matriz, para organizar o estoque e ligar à baixa do PCP. Decidido com ele:
// só a SAL INFINITY PLUS matriz; o "Depósito Matriz" vira o de desmontados e
// nasce o "Depósito Matriz - Montados". A baixa do PCP usa esses dois, sem
// escolha manual.
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
const mig = ler('banco/migrations/fase-ee-deposito-montados-desmontados.sql');
check('classificação só desmontados ou montados', /check \(classificacao is null or classificacao in \('desmontados', 'montados'\)\)/.test(mig));
check('um depósito de cada classificação (índice único)', /create unique index if not exists idx_deposits_classificacao on deposits \(classificacao\)\s*where classificacao is not null/.test(mig));
check('"Depósito Matriz" vira o de desmontados', /update deposits set classificacao = 'desmontados'\s*where name = 'Depósito Matriz'/.test(mig));
check('nasce o "Depósito Matriz - Montados" na mesma empresa', /'Depósito Matriz - Montados'/.test(mig) && /d\.company_id/.test(mig));
check('a escolha manual (pcp_config) sai', /drop table if exists pcp_config;/.test(mig));
check('RECRIAR-DO-ZERO inclui a fase EE', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-ee-deposito-montados-desmontados.sql'));
const cad = ler('lib/db/cadastros.js');
check('o depósito lê e grava a classificação', /classificacao: row\.classificacao \|\| ''/.test(cad) && (cad.match(/classificacao: payload\.classificacao \|\| null/g) || []).length === 2);

console.log('\n--- 2. servidor ---');
const server = semComentarios(ler('server.js'));
check('matriz = SAL INFINITY PLUS 43.792.899/0001-35', /const CNPJ_MATRIZ_DA_MONTAGEM = '43792899000135';/.test(server));
// Fase ER (17/10/2026): a classificação passou a ser uma só, 'montagem' — o
// depósito onde o desmontado vira montado.
check('classificação recusada fora da matriz', /if \(!ehEmpresaMatriz\(companyId\)\) return 'O depósito de montagem só pode ser da matriz/.test(server));
check('  e um só', /O depósito de montagem já é o/.test(server));
check('criar e editar depósito conferem', (server.match(/recusaDaClassificacao\(classificacao, companyId, deposits, (null|id)\)/g) || []).length === 2);
check('a lista diz quais são da matriz', /daMatriz: ehEmpresaMatriz\(d\.companyId\)/.test(server));
check('a baixa usa o depósito classificado', /const \{ depositoMontagemId \} = await depositoDaMontagem\(\);/.test(server));
check('  e não há mais como escolher outros pela API', !/insert into pcp_config/.test(server) && !/from pcp_config/.test(server));

console.log('\n--- 3. telas ---');
const app = ler('public/app.js');
check('Cadastros › Depósitos: campo de classificação só no depósito da matriz', /\$\{depositDraft\.daMatriz \? `[\s\S]{0,200}Classificação \(montagem PCP\)/.test(app));
check('  e coluna "Montagem" na lista', /<th>Montagem<\/th>/.test(app));
const mont = semComentarios(ler('public/modules/pcp/subs/montadores.js'));
check('Montadores do Dia mostra onde a baixa acontece', /config\.depositoMontagemNome/.test(mont));
check('  sem classificação: avisa e leva a Cadastros › Depósitos', /state\.activeSub = 'deposits';/.test(mont));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
