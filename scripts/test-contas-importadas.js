#!/usr/bin/env node
// CONTAS A PAGAR E A RECEBER DO VIPER (13/10/2026).
//
// Guarda as decisões do usuário (todo o em aberto; o que já existe não entra
// de novo; KACCAU/Blumenau fora; título antigo que sumiu do Viper fica como
// está) e as três maneiras de reconhecer o que já existe. Provado no banco
// local com as planilhas de 12/10: 301 a pagar + 126 a receber novos, 247 + 1
// já existentes; a segunda rodada não gravou nada.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const C = require('../lib/importacao-contas-viper');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

const planilha = (cab, linhas) => [{ linhas: [['CONTAS'], ['SAL'], ['Gerado em'], cab.slice(), ...linhas, ['Total', '', '', '', '', '', '999', '0', '999', '', '']] }];

console.log('\n--- 1. leitura ---');
const pagar = C.lerPlanilha(planilha(C.CABECALHO_PAGAR, [
  ['SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)', '49.292.546 FULANA DE TAL', 'COMPRA-2901/1', '92059', '09/10/2026', '26/10/2026', '106.78', '0', '106.78', 'Aberto', 'Parcela 1 - Compra 2900'],
  ['KACCAU ELETRIC COMERCIAL LTDA', 'X', 'COMPRA-1/1', '', '01/10/2026', '20/10/2026', '10', '0', '10', 'Aberto', ''],
  ['SAL INFINITY BY BLUMENAU', 'Y', 'COMPRA-2/1', '', '01/10/2026', '20/10/2026', '10', '0', '10', 'Aberto', ''],
  ['SAL INFINITY ELECTRIC LTDA', 'JAHU BORRACHAS', 'L 36541', '', '01/09/2026', '05/10/2026', '1.491,00', '0', '1.491,00', 'Vencido', 'Serviço']
]), 'DESPESA');
check('título lido com datas ISO e valor', pagar.titulos[0].vencimento === '2026-10-26' && pagar.titulos[0].aberto === 106.78 && pagar.titulos[0].nota === '92059');
check('empresa vira CNPJ (para achar o estabelecimento)', pagar.titulos[0].cnpjEmpresa === '43792899000135' && pagar.titulos[1].cnpjEmpresa === '46877837000114');
check('KACCAU e Blumenau ficam de fora', pagar.titulos.length === 2 && pagar.ignorados.filter((x) => /KACCAU/.test(x.motivo)).length === 2);
check('valor com milhar e vírgula', pagar.titulos[1].aberto === 1491);
check('linha de Total ignorada', !pagar.titulos.some((t) => /total/i.test(t.empresa)));
const receber = C.lerPlanilha(planilha(C.CABECALHO_RECEBER, [
  ['SAL INFINITY PLUS COMERCIO LTDA FILIAL 05 (TIMBO)', 'CLEIDE', 'VEN-16306/2', '203', '09/10/2026', '09/10/2026', '1965.4', '500', '1465.4', 'Vencido', 'Parcela 2/2'],
  ['SAL INFINITY PLUS COMERCIO LTDA FILIAL 05 (TIMBO)', 'JOSE', 'VEN-1/1', '', '09/10/2026', '09/10/2026', '100', '100', '0', 'Pago', '']
]), 'RECEITA');
check('já pago fica de fora', receber.titulos.length === 1 && receber.ignorados[0].motivo === 'já quitado');
let recusa = '';
try { C.lerPlanilha(planilha(C.CABECALHO_PAGAR, []), 'RECEITA'); } catch (e) { recusa = e.message; }
check('planilha trocada (pagar como receber) é recusada', /Colunas fora do lugar/.test(recusa));

console.log('\n--- 2. o que já existe não entra ---');
const existentes = [
  { id: 'e1', type: 'DESPESA', document: 'LF26756 · L 36541', clientSupplierName: 'OUTRO NOME', amount: 1, dueDate: '2026-01-01' },
  { id: 'e2', type: 'RECEITA', document: 'LF100 · NF 203', clientSupplierName: 'Cleide', amount: 1965.4, dueDate: '2026-10-09' }
];
const plano = C.planejar([...pagar.titulos, ...receber.titulos], existentes);
check('pelo documento ("L 36541" da carga de 11/09)', plano.jaExistem.some((t) => t.documento === 'L 36541' && t.existenteId === 'e1' && t.como === 'documento'));
check('por pessoa + valor + vencimento (sem acento, sem maiúscula)', plano.jaExistem.some((t) => t.documento === 'VEN-16306/2' && t.existenteId === 'e2'));
check('o novo entra', plano.novos.length === 1 && plano.novos[0].documento === 'COMPRA-2901/1');
const duas = [{ ...pagar.titulos[0], documento: 'A/1' }, { ...pagar.titulos[0], documento: 'A/2' }];
const p2 = C.planejar(duas, [{ id: 'x', type: 'DESPESA', document: 'LF1 · NF 9', clientSupplierName: '49.292.546 FULANA DE TAL', amount: 106.78, dueDate: '2026-10-26' }]);
check('um lançamento existente casa com UM título só (duas parcelas iguais = duas)', p2.jaExistem.length === 1 && p2.novos.length === 1);
const reimporta = C.planejar([pagar.titulos[0]], [{ id: 'y', type: 'DESPESA', document: 'LF27414 · COMPRA-2901/1', clientSupplierName: 'Z', amount: 1, dueDate: '2020-01-01' }]);
check('reimportar: o documento gravado ("LF… · COMPRA-2901/1") reconhece', reimporta.novos.length === 0);

console.log('\n--- 3. o lançamento ---');
const l = C.comoLancamento(receber.titulos[0], { estabelecimentoId: 'est', pessoaId: 'pes' });
check('entra pelo que FALTA, pendente', l.amount === 1465.4 && l.status === 'pending' && l.type === 'RECEITA');
check('o original e o quitado ficam na observação', /Valor original R\$ 1965,40, já quitado no Viper R\$ 500,00/.test(l.note));
check('documento do Viper, NF na descrição, pessoa e empresa ligadas', l.document === 'VEN-16306/2' && /NF 203/.test(l.description) && l.clientSupplierId === 'pes' && l.estabelecimentoId === 'est');
check('nome sem o CNPJ de MEI do começo', C.nomeComparavel('49.292.546 Fulána de Tal') === 'FULANA DE TAL');

console.log('\n--- 4. servidor e script ---');
const server = semComentarios(ler('server.js'));
check('rota só para administrador, com simulação', /pathname === '\/api\/finance\/importacao\/viper'[\s\S]{0,200}!\(await ehAdmin\(user\)\)/.test(server) && /gravarContas\(body\.titulos, \{ simular: body\.simular === true, usuario: user \}\)/.test(server));
check('fica na auditoria', /action: 'financeiro\.importacao\.viper'/.test(server));
const db = semComentarios(ler('lib/db/contas-importadas.js'));
check('grava pelo mesmo createFinancialEntry da tela', /financeiro\.createFinancialEntry\(/.test(db));
check('NÃO dá baixa em nada (título que sumiu do Viper fica como está)', !/updateFinancialEntry|status: 'paid'|'pago'/.test(db));
check('pessoa só liga quando o nome aponta para UMA', /ids\.length === 1 \? ids\[0\] : ''/.test(db));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
