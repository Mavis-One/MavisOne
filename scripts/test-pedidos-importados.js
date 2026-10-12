#!/usr/bin/env node
// PEDIDOS E ORÇAMENTOS DO VIPER (LISTAGEM DE VENDAS) — 12/10/2026.
//
// O que isto guarda:
//   1. o número: 16.000+ é numeração do MavisONE desde a fase CG, e o Viper
//      numerou outubro de 16.060 a 16.327 com pedidos já lançados aqui em
//      produção. Número de OUTRO documento é conflito — nunca gravado por cima;
//   2. número fora da faixa (14.334.125, 27.001) não entra: o reparo da
//      sequence pularia para depois dele;
//   3. histórico: sem estoque e sem financeiro aplicados de novo, com as
//      mesmas bandeiras da importação de 11/09 (commit 21f4236);
//   4. a sequence salta para depois do maior número importado.
//
// SEM BANCO: o montador roda sobre uma planilha em memória; a gravação roda
// contra um `consultar` falso injetado no cache do require.
'use strict';
const path = require('path');
const fs = require('fs');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');

// --- 1. o montador ----------------------------------------------------------
const { montarPedidos, notaDaLinha } = require('../lib/importacao-pedidos-viper');
const CAB = ['Número', 'Doc.', 'Faturado', 'NFe/ NFCe', 'Empresa', 'Data Emissão', 'Cliente', 'Total', 'Vendedor', 'Canc.'];
const aba = [{ nome: 'Listagem de Vendas', linhas: [['LISTAGEM DE VENDAS'], ['SAL'], ['Gerado em'], CAB,
  ['16321', 'VEN', 'Sim', '278 (Aprovada)', 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 02 (MARCOLLA)', '10/10/2026', 'JUNIOR CHARLES HOLLER', '3990', '28.807.155 SAMUEL RODRIGUES ELOI', 'Não'],
  ['16300', 'VEN', 'Sim', '-', 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 06 (GUARAMIRIM)', '09/10/2026', 'IVAN', '3490', 'X', 'Sim'],
  ['16310', 'ORC', 'Não', '-', 'SAL INFINITY ELECTRIC LTDA', '09/10/2026', 'ELIELMA', '299', 'Y', 'Não'],
  ['16060', 'VEN', 'Sim', '196 (Aprovada)', 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 05 (TIMBO)', '01/10/2026', 'RAFAEL', '5990', 'T', 'Não'],
  ['16060', 'ORC', 'Não', '-', 'SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)', '01/10/2026', 'TIMBO', '5990', 'T', 'Não'],
  ['14334125', 'VEN', 'Sim', '-', 'SAL INFINITY ELECTRIC LTDA', '01/10/2026', 'M', '299', 'B', 'Não'],
  ['27001', 'VEN', 'Sim', '-', 'SAL INFINITY ELECTRIC LTDA', '01/10/2026', 'K', '370', 'G', 'Não'],
  ['16200', 'VEN', 'Sim', '-', 'KACCAU ELETRIC COMERCIAL LTDA', '05/10/2026', 'Z', '1', 'Z', 'Não']
] }];
const r = montarPedidos(aba);
const porCodigo = (c) => r.documentos.find((d) => d.codigo === c);
console.log('\n--- 1. o montador ---');
check('VEN faturado = pedido-faturado, com a NF lida', porCodigo(16321).status === 'pedido-faturado' && porCodigo(16321).nota.numero === '278');
check('VEN cancelado = pedido-cancelado', porCodigo(16300).status === 'pedido-cancelado');
check('ORC = orçamento', porCodigo(16310).tipo === 'orcamento' && porCodigo(16310).status === 'orcamento');
check('a filial vai no sufixo da categoria (Guaramirim = "Kaccau", como no histórico)',
  porCodigo(16321).categoria.endsWith('/ Marcolla') && porCodigo(16300).categoria.endsWith('/ Kaccau') && !porCodigo(16310).categoria.includes('/'));
check('o mesmo número em VEN e ORC entra uma vez (dividem a numeração)', r.documentos.filter((d) => d.codigo === 16060).length === 1 && porCodigo(16060).tipo === 'pedido');
check('número fora da faixa fica de fora (14.334.125 e 27.001)', !porCodigo(14334125) && !porCodigo(27001)
  && r.ignorados.filter((x) => /fora da faixa/.test(x.motivo)).length === 2);
check('empresa fora do MavisONE fica de fora', !porCodigo(16200) && r.ignorados.some((x) => /KACCAU/.test(x.motivo)));
check('"278 (Aprovada)" e "-"', notaDaLinha('278 (Aprovada)').situacao === 'Aprovada' && notaDaLinha('-') === null);

// --- 2. a gravação, contra um banco falso ------------------------------------
const existentes = {
  16321: { tabela: 'pedido', note: 'Importado do ViperERP em 12/10/2026 — pedido nº 16321 | Empresa: ...', cliente: 'JUNIOR', data: '2026-10-10' },
  16300: { tabela: 'pedido', note: 'Pedido lançado no balcão', cliente: 'CLIENTE DO MAVISONE', data: '2026-10-11' }
};
const sqls = [];
const consultarFalso = async (sql, params = []) => {
  sqls.push(sql);
  if (/from people/.test(sql)) return { rows: [{ id: 'pes-cli', name: 'ELIELMA' }, { id: 'pes-vend', name: 'SAMUEL RODRIGUES ELOI' }, { id: 'pes-y', name: 'Y' }] };
  if (/select distinct seller_id/.test(sql)) return { rows: [{ seller_id: 'pes-vend' }, { seller_id: 'pes-y' }] };
  if (/from orders where code = \$1/.test(sql)) return { rows: existentes[params[0]] ? [existentes[params[0]]] : [] };
  if (/from fiscal_documentos f/.test(sql)) return { rows: [] };
  return { rows: [] };
};
const criados = [];
require.cache[require.resolve('../lib/db/conexao')] = { id: 'x', filename: 'x', loaded: true, exports: { consultar: consultarFalso, emTransacao: async (fn) => fn({ query: consultarFalso }) } };
require.cache[require.resolve('../lib/db/vendas-compras')] = { id: 'y', filename: 'y', loaded: true, exports: {
  createOrder: async (p) => { criados.push({ tabela: 'orders', ...p }); return { id: 'ord-' + p.code }; },
  createQuote: async (p) => { criados.push({ tabela: 'quotes', ...p }); return { id: 'qte-' + p.code }; }
} };
const { gravarPedidos, motivoDaRecusa, nomeChave } = require('../lib/db/pedidos-importados');

(async () => {
  console.log('\n--- 2. a conferência (simular) não grava nada ---');
  const sim = await gravarPedidos(r.documentos, { simular: true });
  check('simular não cria documento nem mexe na sequence', criados.length === 0 && !sqls.some((s) => /setval/.test(s)));
  check('  e já aponta o conflito e o "já existia"', sim.conflitos.length === 1 && sim.existentes === 1, JSON.stringify({ c: sim.conflitos.length, e: sim.existentes }));

  console.log('\n--- 3. a gravação ---');
  sqls.length = 0;
  const g = await gravarPedidos(r.documentos, { usuario: { id: 'u', name: 'Admin' } });
  check('o número de OUTRO documento é conflito e NÃO é gravado', g.conflitos.length === 1 && g.conflitos[0].codigo === 16300 && !criados.some((c) => c.code === 16300));
  check('  e o conflito diz quem é quem', g.conflitos[0].mavisone.cliente === 'CLIENTE DO MAVISONE' && g.conflitos[0].viper.cliente === 'IVAN');
  check('o mesmo pedido do Viper = "já existia", sem duplicar', g.existentes === 1 && !criados.some((c) => c.code === 16321));
  check('os livres são gravados: pedido em orders, orçamento em quotes', criados.length === 2
    && criados.find((c) => c.code === 16310).tabela === 'quotes' && criados.find((c) => c.code === 16060).tabela === 'orders');
  const ped = criados.find((c) => c.code === 16060);
  check('histórico: pedido faturado com as bandeiras da importação de 11/09 e sem itens',
    ped.stockApplied === true && ped.financeApplied === true && Array.isArray(ped.items) && ped.items.length === 0);
  check('  a nota diz que veio do Viper, com o número e a NF', /^Importado do ViperERP em .* — pedido nº 16060 \| Empresa: .*NF nº 196 \(Aprovada\)/.test(ped.note));
  check('o cliente liga pelo nome quando o nome aponta para UMA pessoa', criados.find((c) => c.code === 16310).clientSupplierId === 'pes-cli' && ped.clientSupplierId === null);
  check('o vendedor do Viper com prefixo de MEI liga ao vendedor', nomeChave('28.807.155 SAMUEL RODRIGUES ELOI') === 'SAMUEL RODRIGUES ELOI');
  check('a sequence salta para depois do maior (greatest, nunca rebaixa)', sqls.some((s) => /setval\('sales_code_seq', greatest\(\s*\(select last_value from sales_code_seq\)/.test(s)));
  check('a rota recusa número fora da faixa e status estranho', motivoDaRecusa({ ...ped, tipo: 'pedido', codigo: 27001, status: 'pedido', data: '2026-10-01', total: 1, empresa: 'SAL INFINITY ELECTRIC LTDA' }) === 'número fora da faixa'
    && motivoDaRecusa({ tipo: 'pedido', codigo: 16000, status: 'faturado', data: '2026-10-01', total: 1, empresa: 'SAL INFINITY ELECTRIC LTDA' }) === 'status inválido');

  console.log('\n--- 4. rota e script ---');
  const server = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  check('a rota é só de administrador', /pathname === '\/api\/sales\/importacao\/viper' && req\.method === 'POST'\) \{\s*try \{\s*const user = await getCurrentUser\(req\);\s*if \(!user \|\| !\(await ehAdmin\(user\)\)\) return sendJson/.test(server));
  const script = fs.readFileSync(path.join(RAIZ, 'scripts/importar-pedidos-viper.js'), 'utf8');
  check('o script só grava com --enviar (sem ele, simular: true)', /simular: !enviar/.test(script));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
