#!/usr/bin/env node
/**
 * O FINANCEIRO POR RECORTE DÁ O MESMO QUE O FINANCEIRO INTEIRO (fase DS) — com
 * o banco de verdade, só leitura.
 *
 * A fase DS trocou, nas rotas /api/finance/*, a leitura das duas tabelas
 * inteiras (27.362 lançamentos e 25.709 baixas) por leituras do que cada rota
 * usa. Três dessas trocas reproduzem no banco uma parte do que o JavaScript
 * fazia, e é aí que uma divergência poderia nascer sem ninguém ver:
 *
 *   1. a lista de lançamentos: os filtros de campo cru viraram WHERE
 *      (lib/db/financeiro.js, montarFiltroDaLista). Aqui a LISTA INTEIRA
 *      filtrada e ordenada — todas as páginas — é comparada com a de antes
 *      (getFinancialEntries + filterFinanceEntries + o mesmo sort), para uma
 *      matriz de filtros que inclui os valores malformados que a tela não manda
 *      mas a URL aceita;
 *   2. as sugestões de conciliação: só os títulos pendentes/parciais, cortados
 *      no banco por `lower(status collate "C")`;
 *   3. o resumo do dashboard: dez colunas em vez do registro inteiro.
 *
 * As funções de regra (filterFinanceEntries, findBankTransactionMatches,
 * buildFinanceDashboardSummary...) são tiradas do PRÓPRIO server.js, sem
 * cópia: se uma delas mudar e a leitura do banco não acompanhar, este teste
 * acusa.
 *
 * SEM BANCO (DATABASE_URL ausente ou o Postgres fora do ar), o teste diz que
 * pulou e sai com sucesso: a parte que não depende de banco está em
 * scripts/test-financeiro-por-recorte.js.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
// Do `function nome(` no começo da linha até a primeira `}` no começo de linha.
function corpoDe(nome) {
  const marcas = [`\nfunction ${nome}(`, `\nasync function ${nome}(`];
  const marca = marcas.find((m) => src.includes(m));
  if (!marca) throw new Error(`server.js não tem mais a função ${nome}`);
  const ini = src.indexOf(marca);
  return src.slice(ini, src.indexOf('\n}', ini + 1) + 2);
}
const NOMES = [
  'pad2', 'toDateStr', 'getTodayLocal', 'sanitizeDigits', 'normalizeText', 'parseDateOnly', 'sumBy',
  'classifyFinanceEntry', 'isFinanceEntryRealized', 'isFinanceEntryCancelled', 'financeEntryDueDate',
  'financeEntryStatusLabel', 'sumFinanceAmount', 'indiceDoCadastro', 'acharNoCadastro',
  'resolveFinanceCounterparty', 'resolveFinanceCounterpartyDocument', 'filterFinanceEntries',
  'compararLancamentosDaLista', 'filtrarListaDeLancamentos', 'getFinanceEntryPayments',
  'financeEntryEffectiveDue', 'financeEntryPaidTotal', 'esperadoNoExtrato', 'scoreBankTransactionMatch',
  'looseNameMatch', 'findBankTransactionMatches', 'getPeriodRange', 'getPreviousPeriodRange',
  'buildPeriodBuckets', 'buildFinanceChartSeries', 'buildFinanceDashboardSummary'
];
const S = new Function(`const CACHE_DIRETORIO = new WeakMap();\n${NOMES.map(corpoDe).join('\n')}\nreturn { ${NOMES.join(', ')} };`)();

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('  (sem DATABASE_URL: teste com banco pulado)');
    process.exit(0);
  }
  const { consultar, fecharPool } = require('../lib/db/conexao');
  try {
    await consultar('select 1');
  } catch (erro) {
    console.log(`  (banco fora do ar: teste com banco pulado — ${erro.message})`);
    process.exit(0);
  }
  const db = require('../db');

  try {
    const [inteiros, baixas, people, cnpjs, purchases] = await Promise.all([
      db.getFinancialEntries(), db.getAllFinancialPayments(), db.getPeople(), db.getCnpjs(), db.getPurchases()
    ]);
    const dbjson = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'db.json'), 'utf8')); } catch { return {}; }
    })();
    const base = { people, cnpjs, purchases, sales: dbjson.sales || [] };
    console.log(`(${inteiros.length} lançamentos, ${baixas.length} baixas)`);
    // A ORDEM DOS EMPATES. getFinancialEntries ordena só por data, e os do mesmo
    // dia saíam numa ordem que o Postgres escolhia a cada leitura (sort em disco,
    // em paralelo). As leituras novas desempatam por id. Para comparar sem ruído,
    // o caminho de antes recebe os lançamentos numa das ordens que ele já podia
    // receber — a mesma das leituras novas — e aí a saída tem de ser IDÊNTICA,
    // byte a byte, inclusive os últimos bits das somas.
    const posicao = new Map((await consultar('select id from financial_entries order by date desc, id desc')).rows.map((r, i) => [r.id, i]));
    inteiros.sort((a, b) => posicao.get(a.id) - posicao.get(b.id));

    // ------------------------------------------------------------------ 1
    console.log('\n--- 1. a lista inteira, filtrada e ordenada, é a mesma ---');
    const amostra = (await consultar(`select
       (select category_id from financial_entries where category_id is not null group by 1 order by count(*) desc limit 1) cat,
       (select bank_account_id from financial_entries where bank_account_id is not null group by 1 order by count(*) desc limit 1) conta,
       (select client_supplier_id from financial_entries where coalesce(client_supplier_id,'') <> '' group by 1 order by count(*) desc limit 1) cli,
       (select description from financial_entries order by date desc, id desc limit 1) descr`)).rows[0];
    const hoje = S.toDateStr(S.getTodayLocal());
    const pessoa = people.find((p) => p.id === amostra.cli);
    const casos = [
      {}, { type: 'receita' }, { type: 'despesa' }, { type: 'transferencia' }, { type: 'outro' }, { type: 'RECEITA' },
      { status: 'pago' }, { status: 'recebido' }, { status: 'pendente' }, { status: 'vencido' }, { status: 'parcial' },
      { status: 'cancelado' }, { status: 'xyz' }, { status: 'PAGO' }, { status: 'ké' },
      { category: amostra.cat || 'x' }, { bankAccountId: amostra.conta || 'x' }, { clientSupplierId: amostra.cli || 'x' },
      { costCenter: 'cc-inexistente' },
      { dateFrom: '2026-01-01' }, { dateTo: '2025-12-31' }, { dateFrom: '2026-03-01', dateTo: '2026-03-31' },
      { dateFrom: '2026-3-1' }, { dateFrom: 'abc' }, { dateTo: '9999' },
      { dueFrom: hoje }, { dueTo: hoje }, { dueFrom: '2026-10-01', dueTo: '2026-10-31' },
      { amountMin: '1000' }, { amountMax: '50.5' }, { amountMin: '0' }, { amountMin: 'abc' }, { amountMax: 'abc' },
      { amountMin: '1e3', amountMax: '2e3' }, { amountMax: '-5' }, { amountMin: 'Infinity' }, { amountMax: 'Infinity' },
      { amountMin: '-Infinity' }, { amountMin: '0x10' }, { amountMin: ' 12 ' },
      { type: 'despesa', status: 'vencido' }, { type: 'receita', status: 'pendente', dueFrom: hoje },
      { search: 'a' }, { search: 'LTDA' }, { search: '-' }, { search: 'fin-viper-0' }, { search: '  ' },
      { search: 'ção' }, { search: 'JOÃO' }, { search: (pessoa && pessoa.name ? pessoa.name.slice(0, 6) : 'maria') },
      { search: String(amostra.descr || '').slice(0, 8) }, { search: 'a', type: 'despesa', status: 'pago' },
      { search: 'zzzzzzzzzz' },
      { search: 'a', category: amostra.cat || 'x', dateFrom: '2026-01-01', amountMin: '100' }
    ];
    let iguais = 0;
    for (const caso of casos) {
      const q = new URLSearchParams(caso);
      const antes = S.filterFinanceEntries({ ...base, finance: inteiros }, q).sort(S.compararLancamentosDaLista).map((e) => e.id);
      const dados = { ...base };
      const parciais = await db.getLancamentosDaLista(q);
      const depois = S.filtrarListaDeLancamentos(dados, parciais, q).map((e) => e.id);
      const igual = antes.length === depois.length && antes.every((id, i) => id === depois[i]);
      if (igual) iguais += 1;
      else check(`lista igual para ${JSON.stringify(caso)}`, false, `${antes.length} x ${depois.length}`);
    }
    check(`as ${casos.length} combinações dão a mesma lista inteira, na mesma ordem`, iguais === casos.length, `${iguais}/${casos.length}`);

    // ------------------------------------------------------------------ 2
    console.log('\n--- 2. as sugestões de conciliação são as mesmas ---');
    const emAberto = await db.getLancamentosEmAberto();
    const baixasEmAberto = await db.getFinancialPaymentsByEntries(emAberto.map((e) => e.id));
    const abertosNoJs = inteiros.filter((e) => ['pending', 'parcial'].includes(String(e.status || '').toLowerCase()));
    check('o corte do banco é o corte do JS', emAberto.length === abertosNoJs.length
      && new Set(emAberto.map((e) => e.id)).size === new Set(abertosNoJs.map((e) => e.id)).size
      && abertosNoJs.every((e) => emAberto.some((x) => x.id === e.id)), `${emAberto.length} títulos`);
    // As transações vêm de títulos reais: o valor e o vencimento de alguns
    // em aberto, de cada tipo, mais um que não casa com nada.
    const exemplos = [
      ...abertosNoJs.filter((e) => S.classifyFinanceEntry(e) === 'receita').slice(0, 3),
      ...abertosNoJs.filter((e) => S.classifyFinanceEntry(e) === 'despesa').slice(0, 3)
    ].map((e, i) => ({
      id: `tx-teste-${i}`, type: S.classifyFinanceEntry(e) === 'receita' ? 'entrada' : 'saida',
      amount: Number(e.amount), date: S.financeEntryDueDate(e), counterpartyName: i % 2 ? 'LTDA' : ''
    }));
    exemplos.push({ id: 'tx-teste-x', type: 'entrada', amount: 0.01, date: '2020-01-01' });
    // Com a mesma ordem de entrada (ver acima), o sort estável da conciliação
    // desempata igual dos dois lados: tem de ser byte a byte.
    let iguaisConc = 0;
    for (const tx of exemplos) {
      const antes = S.findBankTransactionMatches(tx, { ...base, finance: inteiros, financialPayments: baixas });
      const depois = S.findBankTransactionMatches(tx, { ...base, finance: emAberto, financialPayments: baixasEmAberto });
      const mesmo = JSON.stringify(antes) === JSON.stringify(depois) && antes.length > 0;
      if (mesmo) iguaisConc += 1;
      else check(`sugestões de ${tx.id}`, false, `${antes.length} x ${depois.length}`);
    }
    check(`as sugestões de ${exemplos.length} transações são as mesmas`, iguaisConc === exemplos.length, `${iguaisConc}/${exemplos.length}`);

    // ------------------------------------------------------------------ 3
    console.log('\n--- 3. o resumo do dashboard é o mesmo ---');
    const paraResumo = await db.getFinancialEntriesParaResumo();
    check('as dez colunas vêm na mesma ordem da leitura inteira', paraResumo.map((e) => e.id).join() === inteiros.map((e) => e.id).join());
    let iguaisResumo = 0;
    const periodos = [
      { period: 'month', granularity: 'month' }, { period: 'year', granularity: 'year' },
      { period: 'week', granularity: 'day' }, { period: 'today', granularity: 'week' },
      { period: 'prev_month' }, { period: 'next_month' }, { period: 'custom', from: '2026-01-01', to: '2026-06-30' }
    ];
    for (const p of periodos) {
      const q = new URLSearchParams(p);
      const antes = S.buildFinanceDashboardSummary({ ...base, finance: inteiros }, q);
      const depois = S.buildFinanceDashboardSummary({ ...base, finance: paraResumo }, q);
      const mesmo = JSON.stringify(antes) === JSON.stringify(depois);
      if (mesmo) iguaisResumo += 1;
      else check(`resumo ${JSON.stringify(p)}`, false);
    }
    check(`o resumo de ${periodos.length} períodos é o mesmo, byte a byte`, iguaisResumo === periodos.length, `${iguaisResumo}/${periodos.length}`);

    // ------------------------------------------------------------------ 4
    console.log('\n--- 4. um lançamento por id é o mesmo objeto, com as mesmas baixas ---');
    const comBaixa = inteiros.filter((e) => baixas.some((b) => b.entryId === e.id)).slice(0, 5);
    const porId = await db.getFinancialEntriesByIds(comBaixa.map((e) => e.id));
    const baixasDeles = await db.getFinancialPaymentsByEntries(comBaixa.map((e) => e.id));
    const ok4 = comBaixa.every((e) => {
      const x = porId.find((y) => y.id === e.id);
      const b1 = baixas.filter((b) => b.entryId === e.id).map((b) => JSON.stringify(b)).sort();
      const b2 = baixasDeles.filter((b) => b.entryId === e.id).map((b) => JSON.stringify(b)).sort();
      return JSON.stringify(x) === JSON.stringify(e) && JSON.stringify(b1) === JSON.stringify(b2);
    });
    check('lançamento e baixas por id = os da leitura inteira', ok4, `${comBaixa.length} lançamentos`);
  } finally {
    await fecharPool();
  }
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
