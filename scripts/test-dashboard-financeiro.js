#!/usr/bin/env node
/**
 * O DASHBOARD DO FINANCEIRO (fase EI) — a tela de verdade, num DOM falso, e a
 * contagem de NF-e contra o banco.
 *
 * O que a fase consertou, e que nenhum outro teste segurava:
 *
 *   1. a tabela "Últimos lançamentos": descrição e cliente cortados (com o
 *      texto inteiro no title), Valor alinhado à direita, o código LF0042 no
 *      lugar de um pedaço do id, e a linha abre O lançamento clicado
 *      (state.financeOpenEntryId), não a lista na página 1. E o layout que a
 *      faz caber sem rolar de lado: 6 colunas (cliente embaixo da descrição,
 *      sem a Data), os painéis lado a lado só a partir de 54rem cada, e a
 *      lista de vencimentos com coluna que encolhe (sem isso a página rolava
 *      de lado no celular). A medida em pixels foi feita no Chrome headless
 *      (o comentário do renderView em dashboard.js tem os números); aqui fica
 *      preso o que a medida pressupõe;
 *   2. o selo de situação escapa o rótulo — situação fora do catálogo é o
 *      próprio texto gravado, e a rota legada gravava qualquer um;
 *   3. "Próximos vencimentos" lê { itens, quantidade, total } e diz quantos
 *      ficaram de fora;
 *   4. o cartão "NF-e emitidas" mostra o número que veio, e "—" quando não veio;
 *   5. "Personalizado" sem datas aplicadas não se atualiza sozinho (ia sem
 *      datas, voltava "hoje" e apagava o que a pessoa digitava);
 *   6. com banco: contarNfeAutorizadas dá o mesmo que a tela NF-e Emitidas
 *      mostra como "autorizada", somando as três origens dela.
 *
 * A conta dos títulos parciais e a ordem das listas, sobre o banco de verdade,
 * estão em scripts/test-lista-de-lancamentos.js §3; a regra das contas, em
 * casos de borda, em scripts/test-relatorios-desempenho.js §5.
 *
 * SEM BANCO (DATABASE_URL ausente ou o Postgres fora do ar), a parte 6 diz que
 * pulou e o resto roda.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// O escapeHtml de verdade, recortado do app.js: é a global que o selo usa.
const appJs = ler('public/app.js');
const iniEscape = appJs.indexOf('function escapeHtml(');
const escapeHtml = new Function(`${appJs.slice(iniEscape, appJs.indexOf('\n}\n', iniEscape) + 2)}; return escapeHtml;`)();

/**
 * Um DOM de mentira, do tamanho do que o dashboard usa: innerHTML guarda o
 * texto, e querySelectorAll acha as tags pelo atributo data-* ou pela classe,
 * com o dataset montado dos data-* da tag. Cada elemento guarda os ouvintes.
 */
function elementosDe(html, seletor) {
  const tags = [...html.matchAll(/<([a-z0-9]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g)];
  return tags.map((m) => {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2];
    return attrs;
  }).filter((attrs) => {
    if (seletor.startsWith('[') && seletor.endsWith(']')) return Object.prototype.hasOwnProperty.call(attrs, seletor.slice(1, -1));
    if (seletor.startsWith('.')) return String(attrs.class || '').split(/\s+/).includes(seletor.slice(1));
    return false;
  }).map((attrs) => {
    const dataset = {};
    Object.keys(attrs).filter((k) => k.startsWith('data-')).forEach((k) => {
      dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    });
    const ouvintes = [];
    return { attrs, dataset, ouvintes, addEventListener: (ev, fn) => ouvintes.push(fn), clicar: () => ouvintes.forEach((fn) => fn()) };
  });
}

function abrirDashboard(respostas) {
  let agora = 0;
  let proximoId = 1;
  const fila = new Map();
  const setTimeout = (fn, ms) => { const id = proximoId++; fila.set(id, { quando: agora + ms, fn }); return id; };
  const clearTimeout = (id) => { fila.delete(id); };
  const DateFalso = class extends Date { static now() { return agora; } };
  const badge = { textContent: '' };
  const tela = { html: '', elementos: new Map() };
  const content = {
    set innerHTML(html) { tela.html = html; tela.elementos.clear(); },
    get innerHTML() { return tela.html; },
    querySelectorAll: (sel) => {
      if (!tela.elementos.has(sel)) tela.elementos.set(sel, elementosDe(tela.html, sel));
      return tela.elementos.get(sel);
    }
  };
  const documentFalso = {
    getElementById: (id) => (id === 'financeLiveBadgeText' ? badge : null),
    body: { contains: () => true }
  };
  const chamadas = [];
  const api = (url) => {
    chamadas.push(url);
    const resposta = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
    return Promise.resolve(JSON.parse(JSON.stringify(resposta)));
  };
  const state = {};
  const modulos = [];
  const ctx = vm.createContext({
    window: {}, document: documentFalso, setTimeout, clearTimeout, Date: DateFalso, URLSearchParams,
    Number, String, Math, Promise, console, Object, Array, JSON, escapeHtml
  });
  vm.runInContext(ler('public/modules/finance/subs/dashboard.js'), ctx);
  ctx.financeBuildChartSvg = () => '';
  const render = ctx.window.MavisSubscreenRegistry.finance.dashboard;
  const pronto = render({ content, api, showToast() {}, state, loadModule: (m) => modulos.push(m), escapeHtml });
  // Avança o relógio falso disparando os timers no caminho.
  async function avancar(ms) {
    const fim = agora + ms;
    for (;;) {
      const prox = [...fila.entries()].sort((a, b) => a[1].quando - b[1].quando)[0];
      if (!prox || prox[1].quando > fim) break;
      fila.delete(prox[0]);
      agora = prox[1].quando;
      prox[1].fn();
      await new Promise((r) => setImmediate(r));
    }
    agora = fim;
  }
  return { pronto, tela, content, chamadas, state, modulos, badge, avancar };
}

const LONGA = 'Referente ao PEDIDO DE VENDA de codigo 3318 efetuado em 08/02/2025 no valor de R$ 6.990,00 - "Valor" <b>de</b> entrada & parcelas restantes do cliente';
const RESUMO = {
  period: 'month', range: { from: '2026-10-01', to: '2026-10-31' }, granularity: 'month',
  saldoAtual: 10, contasAPagar: { total: 1, vencidas: 0, aVencer: 1 }, contasAReceber: { total: 2, vencidas: 0, aReceber: 2 },
  receitas: 0, despesas: 0, resultado: 0, resultadoDeltaPercent: null, previsaoFinanceira: 11, chartSeries: [],
  proximosVencimentos: {
    hoje: { itens: [], quantidade: 0, total: 0 },
    amanha: { itens: [], quantidade: 0, total: 0 },
    proximos7: {
      itens: Array.from({ length: 10 }, (_, i) => ({ id: `fin-due-${i}`, description: LONGA, clienteFornecedor: 'Cliente', dueDate: '2026-10-14', amount: 100, status: 'pendente' })),
      quantidade: 36,
      total: 3600
    },
    proximos30: [{ id: 'fin-velho', description: 'formato antigo', clienteFornecedor: 'X', dueDate: '2026-10-20', amount: 5, status: 'pendente' }]
  },
  ultimosLancamentos: [
    { id: 'fin-viper-2e8c9c2d', codigo: 'LF0042', date: '2026-10-13', description: LONGA, type: 'receita', clienteFornecedor: 'SAL INFINITY COMERCIO DE BICICLETAS E PECAS LTDA', dueDate: '2026-10-13', amount: 6990, status: 'pendente' },
    { id: 'fin-legado', codigo: '', date: '2026-10-12', description: 'x', type: 'despesa', clienteFornecedor: '', dueDate: '2026-10-12', amount: 1, status: '<img src=x onerror=alert(1)>' }
  ],
  totalNfesEmitidas: 4122,
  movimentacoesBancarias: { total: 0, naoConciliado: 0 }
};

(async () => {
  console.log('--- 1. a tabela "Últimos lançamentos" ---');
  const t = abrirDashboard([RESUMO]);
  await t.pronto;
  const html = t.tela.html;
  const descricaoEscapada = escapeHtml(LONGA);
  check('a descrição vai cortada, com o texto inteiro (escapado) no title',
    html.includes(`<span class="texto-cortado is-curto" title="${descricaoEscapada}">${descricaoEscapada}</span>`));
  check('  o cliente também, numa segunda linha menor da mesma célula',
    /<span class="texto-cortado is-curto" title="[^"]*">[^<]*<\/span>\s*<small class="texto-cortado is-curto muted" title="SAL INFINITY COMERCIO DE BICICLETAS E PECAS LTDA">SAL INFINITY COMERCIO DE BICICLETAS E PECAS LTDA<\/small>\s*<\/td>/.test(html));
  check('  Valor alinhado à direita, no cabeçalho e na célula', html.includes('<th class="col-valor">Valor</th>') && /<td class="col-valor">/.test(html));
  check('  o código é o LF, e não um pedaço do id', html.includes('<td>LF0042</td>') && !html.includes('2e8c9c2d</td>'));
  check('  sem número, "-"', /data-entry-id="fin-legado">\s*<td>-<\/td>/.test(html));

  // O layout que faz a tabela caber (fase EI). Com 8 colunas ela dava 1.118 px
  // contra 835 visíveis em meio painel de 1920; os números estão no
  // comentário do renderView. Se alguém devolver uma coluna, o check avisa que
  // a conta dos 54rem precisa ser refeita.
  const cabecalho = (html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/) || [])[1] || '';
  const titulos = [...cabecalho.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  check('  a tabela do resumo tem 6 colunas, sem Data e sem coluna própria de cliente',
    titulos.join('|') === 'Código|Descrição · Cliente/Fornecedor|Tipo|Vencimento|Valor|Situação', titulos.join(' | '));
  const linhaDoLancamento = (html.match(/data-entry-id="fin-viper-2e8c9c2d">([\s\S]*?)<\/tr>/) || [])[1] || '';
  check('  e cada linha também tem 6 células', (linhaDoLancamento.match(/<td[\s>]/g) || []).length === 6);
  check('  os painéis só ficam lado a lado a partir de 54rem cada (abaixo, empilham)',
    html.includes('<div class="row" style="align-items: start; grid-template-columns: repeat(auto-fit, minmax(min(100%, 54rem), 1fr));">'));
  check('  a lista de vencimentos encolhe com o painel (a página não rola de lado no celular)',
    html.includes('<div class="finance-due-list" style="grid-template-columns: minmax(0, 1fr);">'));
  const vazio = abrirDashboard([{ ...RESUMO, ultimosLancamentos: [] }]);
  await vazio.pronto;
  check('  sem lançamentos, a linha vazia ocupa as 6 colunas', vazio.tela.html.includes('<td colspan="6" class="muted">Nenhum lançamento registrado ainda.</td>'));

  console.log('\n--- 2. o selo de situação escapa o rótulo ---');
  check('situação fora do catálogo sai como texto', html.includes('&lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img src=x'));

  console.log('\n--- 3. a linha abre o lançamento ---');
  const linhas = t.content.querySelectorAll('.finance-clickable-row');
  const daTabela = linhas.find((l) => l.dataset.entryId === 'fin-viper-2e8c9c2d');
  check('as linhas levam o id do lançamento', !!daTabela && linhas.filter((l) => l.dataset.entryId).length === linhas.length, `${linhas.length} linhas`);
  if (daTabela) daTabela.clicar();
  check('  clicar põe o id em state.financeOpenEntryId e vai para Lançamentos',
    t.state.financeOpenEntryId === 'fin-viper-2e8c9c2d' && t.state.activeSub === 'lancamentos' && t.modulos.includes('finance'));

  console.log('\n--- 4. "Próximos vencimentos" ---');
  check('a aba diz quantos títulos e quanto em aberto', /36 títulos · R\$\s?3\.600,00 em aberto/.test(html));
  check('  e quantos ficaram de fora', html.includes('Mostrando os 10 que vencem primeiro, de 36.'));
  check('  a descrição do vencimento também vai cortada', html.includes(`<strong class="texto-cortado" title="${descricaoEscapada}">`));
  check('  o item leva o id do lançamento', html.includes('data-entry-id="fin-due-0"'));
  const abaAntiga = t.content.querySelectorAll('[data-due-tab]').find((b) => b.dataset.dueTab === 'proximos30');
  if (abaAntiga) abaAntiga.clicar();
  check('  a lista solta (formato de antes) ainda aparece', t.tela.html.includes('formato antigo') && /1 título · R\$\s?5,00 em aberto/.test(t.tela.html));

  console.log('\n--- 5. o cartão de NF-e ---');
  check('mostra o número que veio, e diz que é de todas as datas', /<p class="finance-stat-value">4\.122<\/p>/.test(html) && html.includes('Autorizadas · todas as datas'));
  const semNumero = abrirDashboard([{ ...RESUMO, totalNfesEmitidas: null, proximosVencimentos: {} }]);
  await semNumero.pronto;
  check('  sem a contagem, "—" (e não 0)', /<p class="finance-stat-value">—<\/p>/.test(semNumero.tela.html));
  check('  aba sem formato nenhum ({}) não quebra a tela', semNumero.tela.html.includes('Nenhum vencimento nesse intervalo.'));

  console.log('\n--- 6. "Personalizado" sem datas não se atualiza sozinho ---');
  const p = abrirDashboard([RESUMO]);
  await p.pronto;
  const pilula = p.content.querySelectorAll('[data-period]').find((b) => b.dataset.period === 'custom');
  if (pilula) pilula.clicar();
  await p.avancar(3 * 60000);
  check('três minutos depois, nenhuma carga a mais', p.chamadas.length === 1, `${p.chamadas.length} chamadas`);
  check('  e o selo diz por quê', /aplique o período para atualizar/.test(p.badge.textContent), p.badge.textContent);
  const m = abrirDashboard([RESUMO]);
  await m.pronto;
  await m.avancar(3 * 60000);
  check('  fora do Personalizado, a atualização automática continua', m.chamadas.length >= 3, `${m.chamadas.length} chamadas`);

  console.log('\n--- 7. a contagem de NF-e é a da tela NF-e Emitidas (com banco) ---');
  if (!process.env.DATABASE_URL) {
    console.log('  (sem DATABASE_URL: parte com banco pulada)');
  } else {
    const { consultar, fecharPool } = require('../lib/db/conexao');
    let noAr = true;
    try { await consultar('select 1'); } catch (erro) { noAr = false; console.log(`  (banco fora do ar: parte com banco pulada — ${erro.message})`); }
    if (noAr) {
      try {
        const fiscalDb = require('../lib/db/fiscal');
        const nfeImportadasDb = require('../lib/db/nfe-importadas');
        const db = require('../db');
        const [contagem, fiscais, importadas, manuais] = await Promise.all([
          fiscalDb.contarNfeAutorizadas(), fiscalDb.getNfeRecordsParaLista(), nfeImportadasDb.listarEmitidasParaLista(), db.getNfes()
        ]);
        const naTela = fiscais.filter((n) => n.status === 'AUTORIZADO').length
          + importadas.filter((n) => n.status === 'autorizada').length
          + manuais.filter((n) => n.status === 'autorizada').length;
        check('contarNfeAutorizadas = as "autorizada" das três origens da lista', contagem === naTela,
          `${contagem} x ${naTela} (fiscal ${fiscais.length}, importadas ${importadas.length}, manuais ${manuais.length})`);
      } finally {
        await fecharPool();
      }
    }
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
