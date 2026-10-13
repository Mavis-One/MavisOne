#!/usr/bin/env node
/**
 * PEDIDO SEM ESTOQUE, FATURAMENTO NÃO — E A TELA SEM NEGATIVO NEM RESERVA
 * (13/10/2026, pedido do usuário).
 *
 * 1. Pedido com produto zerado salva como sempre; a NF-e do pedido é recusada
 *    ANTES de ir à SEFAZ enquanto o saldo não cobrir. Sem isso a nota saía, e
 *    o faturamento que a autorização dispara falhava calado (só auditoria).
 *    Primeiro só para o produto marcado num campo "Permite pedido sem
 *    estoque"; no mesmo dia o usuário pediu para valer para todos, e o campo,
 *    que deixou de ter efeito, saiu da tela (também a pedido dele).
 * 2. Produtos (Estoque), busca de produto e itens do pedido: negativo aparece
 *    como 0, e o número reservado não aparece.
 *
 * Provado no banco local: pedido 16340 com a PLACA DO zerada — a
 * pré-conferência recusa ("Sem estoque para faturar") sem transmitir nada.
 * Dados de teste apagados.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const stockCore = require('../lib/stock-core');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. o campo "Permite pedido sem estoque" saiu ---');
// Com a trava valendo para todos, uma caixa que não muda nada seria pior que
// nenhuma (13/10/2026). O que um produto já tenha gravado some na próxima
// gravação: buildProductMeta só monta os campos que conhece.
check('a tela não tem mais a caixa', !/vendeSemEstoque/.test(ler('public/modules/stock/subs/new_product.js')));
check('o meta não grava mais', !('vendeSemEstoque' in stockCore.buildProductMeta({ vendeSemEstoque: true }, { vendeSemEstoque: true })));
check('a leitura não devolve mais',
  !('vendeSemEstoque' in stockCore.serializeProduct({ id: 'p1', name: 'X', stockQuantity: 0 }, { deposits: [], stockMovements: [], productMeta: { p1: { vendeSemEstoque: true } } })));

console.log('\n--- 2. a NF-e do pedido confere antes de transmitir ---');
const servidor = ler('server.js');
const conta = (servidor.match(/async function itensSemEstoqueParaFaturar\(pedido\) \{[\s\S]*?\n\}/) || [''])[0];
check('a conta existe', conta.length > 0);
// No mesmo dia o usuário pediu a trava para TODOS os produtos.
check('  vale para todo produto, marcado ou não', !/vendeSemEstoque/.test(conta));
check('  só quando o faturamento vai baixar: pedido que já baixou fica de fora', /if \(pedido\.stockApplied\) return \[\];/.test(conta));
check('  e categoria que não altera estoque também',
  /const regra = await regraDaCategoriaDoPedido\(pedido\.category\);\s*if \(!regra\.alteraEstoque\) return \[\];/.test(conta));
check('  pela cor quando o item tem cor, senão pelo produto', /item\.classValueId\s*\? stockCore\.classValueBalance/.test(conta));
check('  somando linhas repetidas do mesmo produto', /atual\.quantidade \+= Number\(item\.quantity \|\| 0\)/.test(conta));
const preparar = servidor.slice(servidor.indexOf('async function prepararNfeParaTransmitir'), servidor.indexOf('async function emitirNfeFiscal'));
check('prepararNfeParaTransmitir recusa (emissão e pré-conferência usam ela)',
  /const faltando = pedido \? await itensSemEstoqueParaFaturar\(pedido\) : \[\];[\s\S]{0,120}if \(faltando\.length\)/.test(preparar));
check('  ANTES dos itens e da regra fiscal', preparar.indexOf('itensSemEstoqueParaFaturar') < preparar.indexOf('const itens = [];'));
check('o faturamento continua recusando sem saldo para todos', /Estoque insuficiente para "\$\{item\.name\}"/.test(servidor));

console.log('\n--- 3. sem negativo e sem reserva na tela ---');
const compartilhado = ler('public/modules/stock/shared.js');
const janela = { MavisStock: {} };
vm.runInNewContext(compartilhado, { window: janela, document: {}, console });
const S = janela.MavisStock;
check('negativo vira 0', S.qtdVisivel(-6) === '0');
check('positivo fica', S.qtdVisivel(2.5) === '2.5');
const painel = S.quantidadesPorEstoque({ stockQuantity: -2, unallocated: -1, balances: [{ depositName: 'Barra', quantity: -6 }, { depositName: 'Centro', quantity: 4 }] });
check('cartão de depósito negativo mostra 0', /Barra[\s\S]*?estoque-card-qtd">0</.test(painel), painel.replace(/\s+/g, ' ').slice(0, 160));
check('  sem o estado "negativo" nem o aviso', !/negativo/.test(painel));
check('  e o "sem depósito" negativo não aparece', !/SEM DEPÓSITO DEFINIDO/.test(painel));
const lista = ler('public/modules/stock/subs/products.js');
check('lista de produtos: saldo pelo qtdVisivel, sem a linha da reserva',
  /<td>\$\{S\.qtdVisivel\(product\.stockQuantity\)\}\$\{transitoDoProduto\(product\)\}/.test(lista) && !/reservado ·/.test(lista));
check('  cor negativa não aparece', /\.filter\(\(linha\) => linha\.quantity > 0\)/.test(lista));
const status = ler('public/modules/stock/subs/product_status.js');
check('tela do produto: saldo total pelo qtdVisivel', /S\.qtdVisivel\(product\.stockQuantity\)/.test(status));
const app = ler('public/app.js');
check('venda: a busca diz só o disponível', /return cabecalho \+ `disponível \$\{qtdVisivel\(livre\)\}`;/.test(app));
check('  a coluna Disponível sem o "de X"', !/sales-item-reservado/.test(app));
check('  e o aviso sem a frase da reserva', !/Parte do estoque já está reservada em outros pedidos/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
