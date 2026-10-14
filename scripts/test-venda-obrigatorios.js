#!/usr/bin/env node
/**
 * EMPRESA, CATEGORIA, DEPÓSITO, VENDEDOR E PAGAMENTO OBRIGATÓRIOS (13/10/2026).
 *
 * Pedido do usuário: "coloque empresa, categoria, depósito (mesmo que puxado
 * automaticamente), vendedor (mesmo que puxado automaticamente) e pagamentos
 * como campo obrigatório". Regra única em
 * public/modules/shared/venda_obrigatorios.js — a tela confere antes de salvar
 * e o servidor recusa na gravação (criação e edição). Cancelar continua
 * possível com o pedido incompleto.
 */
const fs = require('fs');
const path = require('path');
const O = require('../public/modules/shared/venda_obrigatorios.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const completo = {
  companyId: 'emp1', category: 'Venda de Materiais', depositId: 'dep1', sellerId: 'v1',
  payments: [{ methodId: 'f1', amount: 100 }]
};

console.log('--- 1. a regra ---');
check('pedido completo passa', O.faltando(completo) === null);
[['companyId', 'empresa'], ['category', 'categoria'], ['depositId', 'depósito'], ['sellerId', 'vendedor']].forEach(([campo, nome]) => {
  const falta = O.faltando({ ...completo, [campo]: '' });
  check(`sem ${nome} é recusado`, falta && falta.campo === campo, falta && falta.mensagem);
});
check('  espaço em branco não conta como preenchido', O.faltando({ ...completo, category: '   ' })?.campo === 'category');
check('sem pagamento é recusado', O.faltando({ ...completo, payments: [] })?.campo === 'payments');
check('  linha sem forma não conta', O.faltando({ ...completo, payments: [{ methodId: '', amount: 100 }] })?.campo === 'payments');
check('  linha de valor zero não conta', O.faltando({ ...completo, payments: [{ methodId: 'f1', amount: 0 }] })?.campo === 'payments');
check('  e a mensagem leva à aba Pagamentos', O.faltando({ ...completo, payments: [] })?.aba === 'pagamentos');
check('a ordem é a da tela: empresa primeiro', O.faltando({})?.campo === 'companyId');

// 14/10/2026: transferência entre filiais não gera financeiro, então não exige
// pagamento. Provado pela API: VENDA sem pagamento -> 400; "Transferencia entre
// Filiais" sem pagamento -> salvo (pedido de teste apagado, numeração restaurada).
const semPagamento = { ...completo, payments: [] };
check('transferência e remessa (não cadastradas) passam sem pagamento',
  O.faltando({ ...semPagamento, category: 'Transferencia entre Filiais' }) === null
  && O.faltando({ ...semPagamento, category: 'TRANSFERÊNCIA / FILIAL 02' }) === null
  && O.faltando({ ...semPagamento, category: 'Remessa' }) === null);
check('  venda continua exigindo', O.faltando({ ...semPagamento, category: 'VENDA' })?.campo === 'payments');
// 14/10/2026: os pagamentos fecham com o total do pedido. Provado pela API:
// pedido de R$ 20,00 com R$ 5,00 em pagamento -> 400 "diferença de R$ 15,00",
// sem gastar número; na tela, um pagamento só acompanha o total, travado.
const pagos = (...v) => v.map((amount) => ({ methodId: 'f1', amount }));
check('a soma dos pagamentos tem de fechar com o total',
  O.faltando({ ...completo, payments: pagos(5000, 1990) }, { total: 6990 }) === null
  && /diferença de R\$\s?1\.990,00/.test(O.faltando({ ...completo, payments: pagos(5000) }, { total: 6990 })?.mensagem || ''));
check('  centavo de arredondamento não conta', O.faltando({ ...completo, payments: pagos(3330.33, 3330.33, 3330.34) }, { total: 9991 }) === null);
check('  sem o total (quem não sabe), não confere', O.faltando({ ...completo, payments: pagos(1) }) === null);
check('  tela e servidor passam o total',
  ler('public/app.js').includes('total: computeTotals().totalAmount') && ler('server.js').includes('total: computeSalesTotals(items, body).totalAmount'));
check('  um pagamento só acompanha o total', ler('public/app.js').includes('if (payments.length === 1 && Math.abs(Number(payments[0].amount || 0) - totais.totalAmount) >= 0.005) {'));
check('categoria cadastrada: vale o "gera financeiro" dela',
  O.faltando({ ...semPagamento, category: 'Loja' }, { categorias: [{ name: 'Loja', geraFinanceiro: false }] }) === null
  && O.faltando({ ...semPagamento, category: 'Transfer X' }, { categorias: [{ name: 'Transfer X', geraFinanceiro: true }] })?.campo === 'payments');

console.log('\n--- 2. o servidor recusa ---');
const servidor = ler('server.js');
check('na criação e na edição, com as categorias cadastradas',
  (servidor.match(/const obrigatorioQueFalta = (?:vaiCancelar \? null : )?vendaObrigatorios\.faltando\(body, \{ categorias: await categoriasDaVendaParaRegra\(\), total: computeSalesTotals\(items, body\)\.totalAmount \}\);/g) || []).length === 2);
check('  menos para cancelar um pedido incompleto',
  /const vaiCancelar = salesStatus\.ehCancelado\(/.test(servidor) && /vaiCancelar \? null : vendaObrigatorios\.faltando\(body, /.test(servidor));

console.log('\n--- 3. a tela ---');
const app = ler('public/app.js');
['Empresa *', 'Categoria *', 'Depósito *', 'Vendedor *'].forEach((rotulo) => {
  check(`rótulo "${rotulo}"`, app.includes(`<label>${rotulo}`) || app.includes(`campo-somente-leitura">${rotulo}`));
});
check('confere antes de salvar e leva à aba do campo',
  /window\.MavisVendaObrigatorios\.faltando\(payload, \{ categorias: meta\.salesCategories \|\| \[\], total: computeTotals\(\)\.totalAmount \}\)/.test(app) && /abrirAba\(obrigatorioQueFalta\.aba \|\| 'dados'\)/.test(app));
const html = ler('public/index.html');
check('o script carrega antes do app.js',
  html.indexOf('shared/venda_obrigatorios.js') > 0 && html.indexOf('shared/venda_obrigatorios.js') < html.indexOf('src="/app.js"'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
