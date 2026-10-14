#!/usr/bin/env node
/**
 * O NÚMERO DA NF-e VAI SOZINHO PARA O PEDIDO (14/10/2026).
 *
 * Pedido do usuário: "quando uma nota fiscal for faturada o número dela seja
 * puxado automaticamente para o pedido no campo Número NF-e". Na autorização
 * (que também chega pelo webhook da Focus) o número e a data de emissão vão
 * para payment_info.nfeNumber / nfeBillingDate; no cancelamento, o número sai
 * se ainda for o da nota cancelada.
 *
 * Provado no banco local num pedido real (restaurado depois): gravou 5053 e
 * 2026-10-14 sem mexer nas outras chaves; cancelar a 9999 não tocou; cancelar
 * a 5053 limpou.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const servidor = ler('server.js');
const banco = ler('lib/db/vendas-compras.js');

check('só as duas chaves mudam em payment_info',
  banco.includes("|| jsonb_build_object('nfeNumber', $2::text, 'nfeBillingDate', $3::text)"));
check('limpar só se ainda for o número da nota cancelada',
  banco.includes("where id = $1 and payment_info->>'nfeNumber' = $2::text"));
const fatura = servidor.slice(servidor.indexOf('async function faturarPedidoDaNota('), servidor.indexOf('function enderecoDaPessoa('));
check('grava DEPOIS de faturar (o faturamento regrava o pedido inteiro)',
  /await mudarStatusSalesRecord\(\{ id: pedido\.id, code: pedido\.code \}, 'pedido-faturado', dataVendas, quemFatura\);\s*await anotarNumeroDaNotaNoPedido\(nfe, pedido\.id\);/.test(fatura));
check('  também quando o pedido já estava faturado (dispensa) e quando o faturamento falha',
  /anotarNotaNoFinanceiroDoPedido\(dataVendas, pedido, nfe\.numero\);\s*await anotarNumeroDaNotaNoPedido\(nfe, pedido\.id\);/.test(fatura)
  && fatura.includes('await anotarNumeroDaNotaNoPedido(nfe, pedidoId);'));
const desfatura = servidor.slice(servidor.indexOf('async function desfaturarPedidoDaNota('), servidor.indexOf('async function anotarNumeroDaNotaNoPedido('));
check('o cancelamento tira o número, saia o desfaturamento por onde sair',
  desfatura.includes("await db.gravarNotaNoPedido(pedidoId, { numero: '', numeroAtual: String(nfe.numero) });")
  && /\} finally \{\s*await limparNumero\(\);\s*\}/.test(desfatura));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
