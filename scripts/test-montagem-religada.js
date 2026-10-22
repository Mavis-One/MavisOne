#!/usr/bin/env node
// MONTADO/DESMONTADO RELIGADO, SEM TRAVAR A VENDA (fase FA, 22/10/2026).
//
// O usuário: "eu também pedi para você colocar uma sub-classe dentro dos
// produtos para que eu consiga colocar se eles estão montados e desmontados".
// É a fase ER, desligada na fase EV (19/10) porque o pedido de AUTOPROPELIDO
// passou a exigir a escolha e as lojas pararam. Escolhido com ele: religar sem
// travar a venda — a linha nasce Montado e o item sem condição sai do montado.
//
// Provado no servidor local: a migração devolveu a marca aos 113 produtos e
// esvaziou montagem_pausada. Na Nova Venda, o 9204 (13 montados no Depósito
// Electric) entrou com a coluna Condição em "Montado" (opções Montado e
// Desmontado, sem "Escolha"), saldo 13; em Desmontado, saldo 0. Pela API, como
// a aba antiga da loja, dois pedidos sem condição salvaram (200); aprovar 14
// foi recusado por "(montado) ... disponível 13, necessário 14". Tudo apagado.
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

console.log('\n--- 1. a migração ---');
const sql = ler('banco/migrations/fase-fa-montagem-religada.sql').replace(/--[^\n]*/g, '');
check('a marca volta a quem a fase EV guardou',
  /update products p set controla_montagem = true\s*from montagem_pausada mp\s*where mp\.product_id = p\.id and not p\.controla_montagem;/.test(sql));
check('o que se moveu na pausa vira MONTADO (movimentos e transferências)',
  /update stock_movements m set condicao = 'montado'\s*from products p\s*where p\.id = m\.product_id and p\.controla_montagem and m\.condicao = '';/.test(sql)
  && /update stock_transfers t set condicao = 'montado'\s*from products p\s*where p\.id = t\.product_id and p\.controla_montagem and t\.condicao = '';/.test(sql));
check('  depois de devolver a marca', sql.indexOf('set controla_montagem = true') < sql.indexOf('update stock_movements'));
check('montagem_pausada fica vazia', /delete from montagem_pausada;/.test(sql));
check('o SQL do zero termina nela', /fase-fa-montagem-religada\.sql/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

console.log('\n--- 2. a venda não trava ---');
const obrig = require('../public/modules/shared/venda_obrigatorios');
const pedido = { companyId: 'c', category: 'VENDA', depositId: 'd', sellerId: 's', items: [{ productId: 'MOTO', name: 'MOTO X', chassi: 'ABC', condicao: '' }], payments: [{ methodId: 'f', amount: 1 }] };
check('item que controla montagem, sem condição: nada falta', obrig.faltando(pedido, { montagemDoItem: () => true }) === null);
check('  a função continua dizendo qual item veio sem', obrig.itemSemCondicao(pedido.items, () => true) === 0);
const servidor = semComentarios(ler('server.js'));
check('o servidor baixa do MONTADO o item sem condição', /return stockCore\.normalizarCondicao\(item\.condicao\) \|\| 'montado';/.test(servidor));

console.log('\n--- 3. a tela ---');
const app = semComentarios(ler('public/app.js'));
check('a linha nova nasce com a condição inicial', /condicao: product\.controlaMontagem \? condicaoInicialDoItem\(product\.id, classValueId\) : '',/.test(app));
check('  Montado, ou Desmontado quando o depósito só tem desmontado',
  /return !\(Number\(montado\) > 0\) && Number\(desmontado\) > 0 \? 'desmontado' : 'montado';/.test(app));
check('a coluna não tem mais "Escolha" nem marca de obrigatório',
  /<select class="sales-item-condicao" data-index="\$\{index\}">\s*<option value="montado" \$\{item\.condicao !== 'desmontado' \? 'selected' : ''\}>Montado<\/option>/.test(app)
  && !/<option value="" \$\{item\.condicao \? '' : 'selected'\}>Escolha<\/option>/.test(app));
check('o saldo da linha sem condição é o do montado', /const condicao = produto\.controlaMontagem \? String\(item\.condicao \|\| 'montado'\) : '';/.test(app));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
