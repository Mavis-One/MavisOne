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
  'financeEntryStatusLabel', 'sumFinanceAmount', 'enderecoDaPessoa', 'indiceDoCadastro', 'acharNoCadastro',
  'resolveFinanceCounterparty', 'resolveFinanceCounterpartyDocument', 'filterFinanceEntries',
  'compararLancamentosDaLista', 'filtrarListaDeLancamentos', 'getFinanceEntryPayments',
  'financeEntryEffectiveDue', 'financeEntryPaidTotal', 'esperadoNoExtrato', 'scoreBankTransactionMatch',
  'looseNameMatch', 'findBankTransactionMatches', 'getPeriodRange', 'getPreviousPeriodRange',
  'buildPeriodBuckets', 'buildFinanceChartSeries', 'buildFinanceDashboardSummary',
  // Fase EI: a ordem por coluna e o resumo das abas.
  'ordenarListaDeLancamentos', 'resumirListaDeLancamentos', 'situacaoPorUrgencia',
  // Fase EI: o título parcial no dashboard (em aberto = previsto - baixado).
  'isFinanceEntryPartial', 'financeEntryOpenAmount', 'sumFinanceOpenAmount', 'sumFinancePartialPaid'
];
// Constantes de topo que as funções acima leem — do `const NOME = {` até o
// primeiro `};` no começo de linha, como corpoDe faz com as funções.
function constanteDe(nome) {
  const marca = `\nconst ${nome} = {`;
  const ini = src.indexOf(marca);
  if (ini < 0) throw new Error(`server.js não tem mais a constante ${nome}`);
  return src.slice(ini, src.indexOf('\n};', ini + 1) + 3);
}
// Os módulos que o server.js recebe por require (fase EI): a busca procura no
// código formatado e reconhece valor; a ordem e as abas vêm do catálogo.
const lancamentoCodigo = require(path.join(RAIZ, 'public/modules/shared/lancamento_codigo'));
const listaDeLancamentos = require(path.join(RAIZ, 'public/modules/shared/lancamentos_lista'));
const descricaoLancamento = require(path.join(RAIZ, 'public/modules/shared/descricao_lancamento'));
const S = new Function('lancamentoCodigo', 'listaDeLancamentos', 'descricaoLancamento',
  `const CACHE_DIRETORIO = new WeakMap();\n${constanteDe('ORDENS_DA_LISTA_DE_LANCAMENTOS')}\n${NOMES.map(corpoDe).join('\n')}\nreturn { ${NOMES.join(', ')} };`
)(lancamentoCodigo, listaDeLancamentos, descricaoLancamento);

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
    const [inteiros, baixas, people, cnpjs, purchases, financialCategories, costCenters, bankAccounts] = await Promise.all([
      db.getFinancialEntries(), db.getAllFinancialPayments(), db.getPeople(), db.getCnpjs(), db.getPurchases(),
      db.getFinancialCategories(), db.getCostCenters(), db.getBankAccounts()
    ]);
    const dbjson = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'db.json'), 'utf8')); } catch { return {}; }
    })();
    // Categorias, centros e contas (fase EI): a ordem por coluna lê o NOME deles.
    const base = { people, cnpjs, purchases, sales: dbjson.sales || [], financialCategories, costCenters, bankAccounts };
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
       (select description from financial_entries order by date desc, id desc limit 1) descr,
       (select date::text from financial_entries group by 1 order by count(*) desc, 1 limit 1) dia,
       (select due_date::text from financial_entries group by 1 order by count(*) desc, 1 limit 1) venc`)).rows[0];
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
      { search: 'a', category: amostra.cat || 'x', dateFrom: '2026-01-01', amountMin: '100' },
      // O byte NUL (só numa URL forjada): o Postgres recusa o parâmetro, então
      // montarFiltroDaLista o reescreve. Os casos com data real conferem a
      // borda — `dateFrom=<dia>\u0000` EXCLUI o próprio dia no JS, e
      // `dateTo=<dia>\u0000` o inclui. <dia> é a data com mais lançamentos.
      { dateFrom: `${amostra.dia}\u0000` }, { dateTo: `${amostra.dia}\u0000` },
      { dueFrom: `${amostra.venc}\u0000` }, { dueTo: `${amostra.venc}\u0000` },
      { clientSupplierId: `${amostra.cli || 'x'}\u0000` }, { category: '\u0000' },
      { dateFrom: '2026-03-01\u0000' }, { dateTo: '2026-03-01\u0000x' }, { dateFrom: '\u0000' }, { dateTo: '\u0000' },
      { dueFrom: `${hoje}\u0000`, dueTo: '2026-12\u0000' }, { dateFrom: '2026-0\u00003' }, { amountMin: '1\u0000' },
      { search: 'a\u0000' }
    ];
    // FASE EI — a busca por código, documento e valor, as situações juntas das
    // abas e a ordem por coluna. Cada ordem é comparada com a da leitura
    // INTEIRA: se getLancamentosDaLista esquecer a coluna que a ordem lê, o
    // parcial chega com o valor padrão do map e a ordem sai outra.
    const comCodigo = inteiros.find((e) => e.code) || {};
    const comDocumento = inteiros.find((e) => String(e.document || '').length > 6) || {};
    const valorReal = inteiros.find((e) => Number(e.amount) >= 1000) || { amount: 2500 };
    const emReais = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    casos.push(
      { search: lancamentoCodigo.formatar(comCodigo.code) }, { search: `lf${comCodigo.code}` }, { search: String(comCodigo.code || '') },
      { search: String(comDocumento.document || '').slice(-6) },
      { search: emReais(valorReal.amount) }, { search: `R$ ${emReais(valorReal.amount)}` }, { search: String(Number(valorReal.amount)) },
      { search: '100' }, { search: '100,00' }, { search: '2.500' }, { search: '1,234' }, { search: 'joao' }, { search: 'icms a recolher' },
      { status: 'pendente,vencido,parcial' }, { status: 'pago,recebido' }, { status: ' vencido , pendente ' }, { status: 'cancelado,xyz' },
      { status: ',' }, { type: 'despesa', status: 'pendente,vencido,parcial', search: 'a' },
      // O recorte do parcial vencido (aba Vencidos), sozinho e com o vencido.
      { status: 'vencido,parcial-vencido' }, { status: 'parcial-vencido' }, { status: 'parcial-vencido', sort: 'status', dir: 'asc' }
    );
    listaDeLancamentos.ORDENAVEIS.forEach((sort) => {
      casos.push({ sort, dir: 'asc' }, { sort, dir: 'desc' });
    });
    casos.push(
      { sort: 'constructor' }, { sort: '__proto__', dir: 'asc' }, { sort: 'xyz', dir: 'asc' }, { sort: 'amount', dir: 'xyz' },
      { sort: 'amount', dir: 'asc', type: 'despesa', status: 'vencido' },
      { sort: 'clienteFornecedor', dir: 'asc', search: 'a' },
      { sort: 'category', dir: 'desc', category: amostra.cat || 'x' },
      { sort: 'dueDate', dir: 'asc', status: 'pendente,vencido,parcial', dueFrom: '2026-01-01' },
      { sort: 'description', dir: 'asc', search: emReais(valorReal.amount) }
    );
    let iguais = 0;
    for (const caso of casos) {
      const q = new URLSearchParams(caso);
      const filtrada = S.filterFinanceEntries({ ...base, finance: inteiros }, q);
      // Sem ?sort=, o oráculo continua sendo o sort de sempre, escrito aqui: é o
      // que prova que a ordem padrão não mudou na fase EI.
      const antes = (q.get('sort') ? S.ordenarListaDeLancamentos(filtrada, q, base) : filtrada.sort(S.compararLancamentosDaLista)).map((e) => e.id);
      const dados = { ...base };
      const parciais = await db.getLancamentosDaLista(q);
      const depois = S.filtrarListaDeLancamentos(dados, parciais, q).map((e) => e.id);
      const igual = antes.length === depois.length && antes.every((id, i) => id === depois[i]);
      if (igual) iguais += 1;
      else check(`lista igual para ${JSON.stringify(caso)}`, false, `${antes.length} x ${depois.length}`);
    }
    check(`as ${casos.length} combinações dão a mesma lista inteira, na mesma ordem`, iguais === casos.length, `${iguais}/${casos.length}`);

    // ----------------------------------------------------------------- 1b
    console.log('\n--- 1b. a rota em dois tempos (fase EI) dá a mesma lista, e o resumo fecha ---');
    // A rota filtra por tudo menos a situação (para as abas contarem) e depois
    // pela situação. Tem de dar a lista de um tempo só.
    const somaBaixas = new Map();
    baixas.forEach((b) => somaBaixas.set(b.entryId, (somaBaixas.get(b.entryId) || 0) + Number(b.amount || 0)));
    // O que as baixas ABATERAM (fase EI): valor + desconto − juros − multa — a
    // conta do "em aberto" da lista, a mesma da rota de baixa.
    const abatido = new Map();
    baixas.forEach((b) => abatido.set(b.entryId, (abatido.get(b.entryId) || 0)
      + Number(b.amount || 0) + Number(b.discount || 0) - Number(b.interest || 0) - Number(b.fine || 0)));
    const casosDaRota = [
      {}, { status: 'vencido' }, { status: 'pendente,vencido,parcial', sort: 'amount', dir: 'desc' },
      { status: 'parcial' }, { status: 'pago,recebido', type: 'receita', search: 'pedido' },
      { status: 'pendente', sort: 'dueDate', dir: 'asc', dueFrom: '2026-01-01' }, { search: emReais(valorReal.amount) }
    ];
    let rotaIgual = 0;
    let resumoIgual = 0;
    let contagemFecha = 0;
    for (const caso of casosDaRota) {
      const q = new URLSearchParams(caso);
      const semSituacao = new URLSearchParams(q);
      semSituacao.delete('status');
      const dados = { ...base };
      const todos = S.filtrarListaDeLancamentos(dados, await db.getLancamentosDaLista(q), semSituacao);
      const emDoisTempos = q.get('status')
        ? S.filterFinanceEntries({ ...dados, finance: todos }, new URLSearchParams({ status: q.get('status') }))
        : todos;
      const deUmaVez = S.filtrarListaDeLancamentos({ ...base }, await db.getLancamentosDaLista(q), q);
      if (emDoisTempos.map((e) => e.id).join() === deUmaVez.map((e) => e.id).join()) rotaIgual += 1;
      else check(`rota em dois tempos para ${JSON.stringify(caso)}`, false, `${emDoisTempos.length} x ${deUmaVez.length}`);

      // O resumo dos PARCIAIS (o que a rota calcula) é o mesmo da leitura
      // inteira: prova que as colunas sempre trazidas bastam para as abas.
      const abatidoDosParciais = new Map(emDoisTempos.filter((e) => S.financeEntryStatusLabel(e) === 'parcial').map((e) => [e.id, abatido.get(e.id) || 0]));
      const resumoDaRota = S.resumirListaDeLancamentos(todos, emDoisTempos, abatidoDosParciais);
      const porId = new Map(inteiros.map((e) => [e.id, e]));
      const resumoInteiro = S.resumirListaDeLancamentos(todos.map((e) => porId.get(e.id)), emDoisTempos.map((e) => porId.get(e.id)), abatido);
      if (JSON.stringify(resumoDaRota) === JSON.stringify(resumoInteiro)) resumoIgual += 1;
      else check(`resumo para ${JSON.stringify(caso)}`, false, `${JSON.stringify(resumoDaRota.totais)} x ${JSON.stringify(resumoInteiro.totais)}`);
      const somaDasAbas = Object.values(resumoDaRota.situacoes).reduce((s, x) => s + x.quantidade, 0);
      if (somaDasAbas === todos.length && resumoDaRota.totais.quantidade === emDoisTempos.length) contagemFecha += 1;
      else check(`contagem das abas para ${JSON.stringify(caso)}`, false, `${somaDasAbas} x ${todos.length}`);
    }
    check(`a rota em dois tempos dá a lista de um tempo só (${casosDaRota.length} casos)`, rotaIgual === casosDaRota.length, `${rotaIgual}/${casosDaRota.length}`);
    check('o resumo das abas é o mesmo com as colunas parciais e com a leitura inteira', resumoIgual === casosDaRota.length, `${resumoIgual}/${casosDaRota.length}`);
    check('as abas somam a lista sem situação, e o total é o da lista filtrada', contagemFecha === casosDaRota.length, `${contagemFecha}/${casosDaRota.length}`);

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
    check('as colunas do resumo vêm na mesma ordem da leitura inteira', paraResumo.map((e) => e.id).join() === inteiros.map((e) => e.id).join());
    // FASE EI — o baixado dos parciais, lido só para eles, é o que sai de todas
    // as baixas. Em centavos: a ordem das baixas de mesmo instante pode mudar o
    // último bit da soma, e a tela mostra centavos.
    const pagoDosParciais = await db.getPagoDosParciais();
    const parciaisNoJs = inteiros.filter((e) => String(e.status || '').toLowerCase() === 'parcial');
    const centavos = (v) => Math.round(Number(v || 0) * 100);
    check('o baixado dos parciais é o das baixas inteiras, título a título',
      pagoDosParciais.size === parciaisNoJs.filter((e) => somaBaixas.has(e.id)).length
      && parciaisNoJs.every((e) => centavos(pagoDosParciais.get(e.id)) === centavos(somaBaixas.get(e.id))),
      `${pagoDosParciais.size} parciais com baixa`);
    // O mesmo `extras` nos dois lados: aqui se compara a LEITURA dos lançamentos.
    const extras = { pagoDosParciais, nfesAutorizadas: 7 };
    let iguaisResumo = 0;
    const periodos = [
      { period: 'month', granularity: 'month' }, { period: 'year', granularity: 'year' },
      { period: 'week', granularity: 'day' }, { period: 'today', granularity: 'week' },
      { period: 'prev_month' }, { period: 'next_month' }, { period: 'custom', from: '2026-01-01', to: '2026-06-30' }
    ];
    for (const p of periodos) {
      const q = new URLSearchParams(p);
      const antes = S.buildFinanceDashboardSummary({ ...base, finance: inteiros }, q, extras);
      const depois = S.buildFinanceDashboardSummary({ ...base, finance: paraResumo }, q, extras);
      const mesmo = JSON.stringify(antes) === JSON.stringify(depois);
      if (mesmo) iguaisResumo += 1;
      else check(`resumo ${JSON.stringify(p)}`, false);
    }
    check(`o resumo de ${periodos.length} períodos é o mesmo, byte a byte`, iguaisResumo === periodos.length, `${iguaisResumo}/${periodos.length}`);

    // FASE EI, sobre os dados de verdade: o que o painel passou a dizer.
    const comBaixas = S.buildFinanceDashboardSummary({ ...base, finance: paraResumo }, new URLSearchParams(), extras);
    const semBaixas = S.buildFinanceDashboardSummary({ ...base, finance: paraResumo }, new URLSearchParams());
    const tipoDe = (e) => S.classifyFinanceEntry(e);
    const pagoDe = (e) => Number(pagoDosParciais.get(e.id) || 0);
    const emAbertoTirado = parciaisNoJs.filter((e) => ['receita', 'despesa'].includes(tipoDe(e)))
      .reduce((s, e) => s + Math.min(pagoDe(e), Number(e.amount || 0)), 0);
    check('a pagar + a receber caem exatamente o baixado dos parciais',
      centavos(semBaixas.contasAPagar.total + semBaixas.contasAReceber.total - comBaixas.contasAPagar.total - comBaixas.contasAReceber.total)
        === centavos(emAbertoTirado), `R$ ${emAbertoTirado.toFixed(2)}`);
    const saldoDosParciais = parciaisNoJs.reduce((s, e) => s + (tipoDe(e) === 'receita' ? pagoDe(e) : (tipoDe(e) === 'despesa' ? -pagoDe(e) : 0)), 0);
    check('e o saldo passa a ver o baixado deles', centavos(comBaixas.saldoAtual - semBaixas.saldoAtual) === centavos(saldoDosParciais),
      `R$ ${saldoDosParciais.toFixed(2)}`);
    const maioresCodigos = inteiros.filter((e) => !S.isFinanceEntryCancelled(e) && Number(e.code) > 0)
      .map((e) => Number(e.code)).sort((a, b) => b - a).slice(0, 8).map((c) => lancamentoCodigo.formatar(c));
    check('"Últimos lançamentos" são os 8 de maior número, com o LF', comBaixas.ultimosLancamentos.map((e) => e.codigo).join() === maioresCodigos.join(),
      comBaixas.ultimosLancamentos.map((e) => e.codigo).join(' '));
    const hojeStr = S.toDateStr(S.getTodayLocal());
    const abas = comBaixas.proximosVencimentos;
    const emOrdem = (itens) => itens.every((item, i) => i === 0 || itens[i - 1].dueDate <= item.dueDate);
    check('cada aba de vencimentos: no máximo 10, em ordem de vencimento, com quantidade e total da aba',
      ['hoje', 'amanha', 'proximos7', 'proximos30'].every((k) => abas[k] && abas[k].itens.length <= 10 && emOrdem(abas[k].itens)
        && abas[k].quantidade >= abas[k].itens.length && typeof abas[k].total === 'number')
      && (abas.proximos30.quantidade === 0 || abas.proximos30.itens[0].dueDate >= hojeStr),
      ['hoje', 'amanha', 'proximos7', 'proximos30'].map((k) => `${k} ${abas[k] && abas[k].itens.length}/${abas[k] && abas[k].quantidade}`).join(', '));
    check('o cartão de NF-e mostra a contagem que a rota passou', comBaixas.totalNfesEmitidas === 7 && semBaixas.totalNfesEmitidas === null
      && !('nfeStats' in comBaixas));

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
    // Um id com NUL (de URL ou corpo forjado) não pode derrubar a leitura com
    // 500: some da lista, e os outros ids continuam vindo.
    const comNul = await db.getFinancialEntriesByIds([`${comBaixa[0].id}\u0000`, comBaixa[0].id]);
    const baixasComNul = await db.getFinancialPaymentsByEntries(['\u0000', comBaixa[0].id]);
    const notasComNul = await db.getFinancialEntriesByNfe(['a\u0000b']);
    check('id com NUL é ignorado, sem erro do banco', comNul.length === 1 && comNul[0].id === comBaixa[0].id
      && baixasComNul.length === baixas.filter((b) => b.entryId === comBaixa[0].id).length && notasComNul.length === 0);
  } finally {
    await fecharPool();
  }
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
