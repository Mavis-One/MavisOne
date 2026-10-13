#!/usr/bin/env node
/**
 * SEM RESERVA DO VIPER E SEM ESTOQUE NA MÃO DE OBRA (13/10/2026).
 *
 * O usuário mostrou a Nova Venda com "-244 de 0" na mão de obra e pediu: "não
 * pode existir isso". No banco local, 100% das reservas vinham de 373 pedidos
 * importados do Viper que ficaram "Pedido"; o -244 era a MÃO-DE-OBRA (588), um
 * serviço cadastrado como produto que movimenta estoque. Decisões dele:
 *   - pedido importado do Viper não reserva;
 *   - só a 588 deixa de controlar estoque (migração fase-eh), e o sistema
 *     respeita products.movimenta_estoque = false na venda.
 *
 * Provado no banco local: zero reservas; pedido com a 588 passa na
 * pré-conferência e é aprovado sem movimento de estoque; na Nova Venda a
 * coluna mostra "-" e não há aviso de falta. Dados de teste apagados.
 */
const fs = require('fs');
const path = require('path');
const reservas = require('../lib/reservas');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. o que reserva ---');
const pedidos = [
  { id: 'v1', code: 1, status: 'pedido', createdByName: 'Importação Viper', items: [{ productId: 'mao', quantity: 244 }, { productId: 'pneu', quantity: 3 }] },
  { id: 'm1', code: 2, status: 'pedido', createdByName: 'VENDEDOR', items: [{ productId: 'pneu', quantity: 2 }, { productId: 'mao', quantity: 1 }] }
];
// No mesmo dia o usuário pediu para tirar a reserva do sistema INTEIRO (ver
// test-reserva-estoque.js): agora nenhum pedido reserva, do Viper ou não. As
// regras daqui continuam no código (e nos checks abaixo) para o dia em que a
// reserva for religada.
const r = reservas.calcularReservas(pedidos, { naoMovimentam: new Set(['mao']) });
check('pedido importado do Viper não reserva', reservas.reservado(r, 'pneu') === 0, reservas.reservado(r, 'pneu'));
check('serviço não reserva', reservas.reservado(r, 'mao') === 0);
check('e, desde que a reserva saiu, nenhum pedido reserva',
  reservas.reservado(reservas.calcularReservas(pedidos), 'mao') === 0 && reservas.reservado(reservas.calcularReservas(pedidos), 'pneu') === 0);
check('a regra do Viper continua no cálculo', /if \(order\.createdByName === IMPORTADO_DO_VIPER\) continue;/.test(ler('lib/reservas.js')));
check('a marca do Viper é a mesma dos relatórios', /'Importação Viper'/.test(ler('lib/relatorios/comum.js')) && reservas.IMPORTADO_DO_VIPER === 'Importação Viper');
const vendas = ler('lib/db/vendas-compras.js');
check('a leitura das reservas traz quem criou o pedido', /COLUNAS_DE_RESERVA = 'id, code, status, items, created_by_name'/.test(vendas));
check('o produto da venda diz se movimenta estoque', /movimentaEstoque: row\.movimenta_estoque !== false/.test(vendas));
const servidor = ler('server.js');
const chamadas = servidor.match(/reservasLib\.calcularReservas\([^)]*\)/g) || [];
check('os três cálculos de reserva passam os serviços', chamadas.length === 3 && chamadas.every((c) => /naoMovimentam: idsQueNaoMovimentam\(/.test(c)), chamadas.join(' | '));

console.log('\n--- 2. serviço não baixa, não estorna e não trava a nota ---');
const baixa = servidor.slice(servidor.indexOf('async function transitionOrderStockEffect'), servidor.indexOf('async function numeroDaNotaDoPedido'));
check('fica fora da projeção e do estorno', /if \(achado && achado\.movimentaEstoque === false\) continue;\s*produtos\.set\(id, achado\);/.test(baixa));
check('  e da baixa', /if \(!produtoAtual \|\| produtoAtual\.movimentaEstoque === false\) continue;/.test(baixa));
const trava = (servidor.match(/async function itensSemEstoqueParaFaturar\(pedido\) \{[\s\S]*?\n\}/) || [''])[0];
check('a trava da NF-e pula serviço', /if \(!produto \|\| produto\.movimentaEstoque === false\) continue;/.test(trava));
const nfce = servidor.slice(servidor.indexOf('// O ESTOQUE ANTES DA NOTA. Autorizada, a NFC-e'), servidor.indexOf('return emitirNfeFiscal(montarNfeDoPedido(pedido, estabelecimentoId, data), user, { modelo: 65 });'));
check('  e a da NFC-e também', /if \(!produto \|\| produto\.movimentaEstoque === false\) continue;/.test(nfce));

console.log('\n--- 3. a tela da venda ---');
const app = ler('public/app.js');
check('serviço não tem saldo no item (coluna "-", fora do aviso)', /if \(!produto \|\| produto\.movimentaEstoque === false\) return null;/.test(app));
check('  e a dica diz por quê', /'Serviço: não controla estoque\.'/.test(app));
check('a busca não mostra saldo de serviço', /if \(p\.movimentaEstoque === false\) return cabecalho\.slice\(0, -3\);/.test(app));

console.log('\n--- 4. a migração ---');
const sql = ler('banco/migrations/fase-eh-mao-de-obra-sem-estoque.sql');
check('marca só a 588, conferindo código E nome',
  /set movimenta_estoque = false\s*where sku = '588'\s*and upper\(name\) like 'MAO-DE%OBRA%'/.test(sql));
check('  e roda de novo sem efeito', /movimenta_estoque is distinct from false/.test(sql));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
