#!/usr/bin/env node
// BAIXA DE MONTAGEM QUE MOVIMENTA O ESTOQUE DE DESMONTADAS (fase ED, 12/10/2026).
//
// Pedido do usuário: "um botão para dar baixa conforme o pessoal montar, e
// essa baixa tem que movimentar o estoque de desmontadas". Decidido com ele:
// a desmontada é o MESMO produto num depósito de desmontadas; a baixa
// transfere o montado para o depósito de montadas; baixa parcial.
//
// Provado no navegador, no banco local, com 6 CAPACETE C2 (367): sem os
// depósitos o botão fica desligado; baixa de 3 = Matriz 485→482 e Marcolla
// 0→3; baixa de 4 quando faltam 3 é recusada; a linha com baixa não sai;
// baixa do resto = "Montado" 6/6; "Desfazer" devolve 3; desfeitas todas, o
// estoque volta a 485/0. O razão mostra os movimentos "montagem-pcp" e
// "montagem-pcp-estorno".
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
const mig = ler('banco/migrations/fase-ed-pcp-baixa-de-montagem.sql');
check('linha da programação guarda o total montado (>= 0)', /add column if not exists quantidade_montada numeric\(14,4\) not null default 0\s*check \(quantidade_montada >= 0\)/.test(mig));
check('cada baixa guarda os dois movimentos (para o estorno)', /movimento_saida_id text,\s*movimento_entrada_id text,/.test(mig));
check('estorno marca a baixa, não apaga', /estornada_em timestamptz/.test(mig));
check('depósitos guardados numa linha só', /create table if not exists pcp_config \(\s*id smallint primary key default 1 check \(id = 1\)/.test(mig));
check('RLS nas tabelas novas', /alter table pcp_baixas enable row level security;/.test(mig) && /alter table pcp_config enable row level security;/.test(mig));
check('RECRIAR-DO-ZERO inclui a fase ED', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-ed-pcp-baixa-de-montagem.sql'));

console.log('\n--- 2. servidor ---');
const server = semComentarios(ler('server.js'));
const bloco = server.slice(server.indexOf("const baixaMatch = pathname.match("), server.indexOf('const rotaModulo = pathname.match('));
check('rotas antes da rota genérica do PCP', bloco.length > 0 && server.indexOf("if (pathname === '/api/pcp/config')") < server.indexOf('const rotaModulo = pathname.match('));
check('não baixa mais do que falta', /if \(quantidade > falta \+ 1e-9\)/.test(bloco));
check('exige os dois depósitos escolhidos', /Escolha o depósito de desmontadas e o de montadas antes de dar baixa\./.test(bloco));
check('confere o saldo na origem (desmontadas) antes', /assertMovementIsPossible\(data, productsById, \{\s*productId: item\.productId, depositId: origem, type: 'saida'/.test(bloco));
check('saída das desmontadas e entrada nas montadas', /type: 'saida', depositId: origem/.test(bloco) && /type: 'entrada', depositId: destino/.test(bloco));
check('baixa, total montado e movimentos na MESMA transação', /commitStockMovements\(data, \[saida, entrada\], productsById, \{\s*tambemNaTransacao:/.test(bloco));
check('  e duas baixas juntas não passam do programado', /quantidade_montada \+ \$2 <= quantidade \+ 0\.000001/.test(bloco));
check('estorno: volta das montadas para as desmontadas, também em transação', /type: 'saida', depositId: baixa\.destino_deposit_id/.test(bloco) && /type: 'entrada', depositId: baixa\.origem_deposit_id/.test(bloco) && /estornada_em is null/.test(bloco));
check('fica na auditoria (baixa e estorno)', /action: 'pcp\.baixa\.montagem'/.test(bloco) && /action: 'pcp\.baixa\.estorno'/.test(bloco));
check('linha com baixa não sai', /Esta linha já tem baixa de montagem\. Desfaça as baixas antes de tirá-la\./.test(server));
check('quantidade não fica abaixo do montado; o total montado não vem do corpo', /delete corpo\.quantidadeMontada;/.test(server) && /a quantidade não pode ficar abaixo disso/.test(server));

console.log('\n--- 3. tela ---');
const mont = semComentarios(ler('public/modules/pcp/subs/montadores.js'));
check('escolhe os dois depósitos (salvos no servidor)', /id="pcpMontDesmontadas"/.test(mont) && /id="pcpMontMontadas"/.test(mont) && /api\('\/api\/pcp\/config', \{\s*method: 'PUT'/.test(mont));
check('coluna Montadas (x/y) e "Dar baixa" com o que falta sugerido', /<th>Montadas<\/th>/.test(mont) && /value="\$\{falta\}"/.test(mont) && /data-baixa="/.test(mont));
check('sem depósitos, o botão fica desligado', /depositosProntos \? '' : 'disabled/.test(mont));
check('"Desfazer" estorna a última baixa da linha', /data-desfazer=/.test(mont) && /method: 'DELETE'/.test(mont));
check('linha montada mostra "Montado"', /C\.badge\('Montado', 'success'\)/.test(mont));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
