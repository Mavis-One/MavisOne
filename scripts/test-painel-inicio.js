#!/usr/bin/env node
/**
 * O INÍCIO LÊ SÓ O QUE SOMA — e continua dizendo o mesmo (dashboard-e-sino).
 *
 * As três rotas do Início (/api/dashboard, /charts e /atencao) passaram a ler
 * recortes do banco (lib/db/painel-inicio.js) em vez das tabelas inteiras, e a
 * tela passou a reaproveitar o que já está nela. Os outros testes da área
 * conferem a LIGAÇÃO (qual carregador cada rota chama). Este confere o
 * COMPORTAMENTO, sem banco e sem servidor:
 *
 *   1. o pré-filtro do sino é SUPERCONJUNTO da regra de lib/atencao.js — o
 *      painel montado com o recorte é idêntico ao montado com tudo, em datas e
 *      fusos diferentes (cada fuso num processo filho, porque contasAVencer usa
 *      a meia-noite LOCAL);
 *   2. chaveDaFilial memorizada devolve o mesmo que a conta sem memória, mesmo
 *      depois de o teto limpar o mapa;
 *   3. o sino (app.js): a busca em voo de ANTES de uma escrita não é
 *      reaproveitada nem vira o painel fresco; e, vencido, ele espera a tela;
 *   4. a tela do Início (num `vm`, com `api` de mentira e relógio falso): quantas
 *      idas ao servidor cada clique custa, e o que invalida o reaproveitamento;
 *   5. fixar favorito não refaz a tela.
 *
 * A igualdade dos predicados SQL com estes espelhos em JS foi provada contra o
 * banco real (mesmas linhas que os carregadores de sempre filtrados em JS), e as
 * respostas HTTP comparadas com a versão anterior — ver o commit.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ===========================================================================
// 1. O PRÉ-FILTRO DO SINO
// ===========================================================================
// Os espelhos em JS dos predicados de lib/db/painel-inicio.js, aplicados a uma
// base inventada que tem de tudo: status em várias grafias e caixas, títulos
// importados e próprios, de pedido importado e de pedido próprio, vencidos, a
// vencer, distantes, sem vencimento; pedidos dos dois lados do piso, com e sem
// nota; produtos com e sem mínimo.
function rodarSuperconjunto() {
  const A = require('../lib/atencao');
  const stockCore = require('../lib/stock-core');
  const ISO = (d) => d.toISOString().slice(0, 10);
  const somaDias = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ISO(d); };

  // Base determinística (sem Math.random: o teste tem de falhar igual sempre).
  let semente = 7;
  // Os bits ALTOS do gerador: os baixos de um congruencial repetem com período
  // curto, e os campos sorteados em sequência sairiam amarrados uns aos outros.
  const sorteio = (n) => { semente = (semente * 1103515245 + 12345) % 2147483648; return Math.floor(semente / 65536) % n; };
  const STATUS = ['pending', 'PENDING', 'Pendente', 'parcial', 'Parcial', 'paid', 'PAID', 'cancelado', '', null, 'pago', 'pendentes'];
  const pedidos = [];
  for (let i = 0; i < 400; i += 1) {
    const code = sorteio(5) === 0 ? null : 15900 + sorteio(200);
    pedidos.push({
      id: `ord-${i}`, code, nfeId: sorteio(3) === 0 ? `nfe-${i}` : '',
      status: ['pedido-faturado', 'cancelado', 'orcamento', 'pedido-aprovado-sem-faturamento'][sorteio(4)],
      date: somaDias('2026-09-20', sorteio(30)), createdAt: '', totalAmount: sorteio(10000) / 100
    });
  }
  const base = '2026-10-07';
  const entradas = [];
  for (let i = 0; i < 1500; i += 1) {
    const ref = sorteio(3) === 0 ? `ord-${sorteio(420)}` : '';
    entradas.push({
      id: sorteio(4) === 0 ? `fin-viper-${i}` : `fin-${i}`,
      type: sorteio(2) ? 'RECEITA' : 'DESPESA',
      status: STATUS[sorteio(STATUS.length)],
      date: somaDias(base, sorteio(60) - 40),
      dueDate: sorteio(15) === 0 ? null : somaDias(base, sorteio(40) - 20),
      amount: sorteio(100000) / 100,
      referenceId: ref
    });
  }
  const meta = {};
  const produtosTodos = [];
  for (let i = 0; i < 300; i += 1) {
    const id = `p-${i}`;
    if (sorteio(3) === 0) meta[id] = { minStock: [0, 1, 5, '3', 'x', ''][sorteio(6)] };
    produtosTodos.push({ id, stockQuantity: sorteio(12) - 2 });
  }
  const data = { productMeta: meta };
  const statusQueFaturam = ['pedido-faturado'];
  const situacao = (lista) => lista.map((p) => ({
    situation: stockCore.productSituation(data, p),
    temMinimo: Number(stockCore.productMeta(data, p.id).minStock || 0) > 0
  }));

  // Espelhos dos predicados SQL (lib/db/painel-inicio.js).
  const emAbertoSql = (s) => ['pending', 'pendente', 'parcial'].includes(String(s == null ? '\u0000' : s).replace(/[A-Z]/g, (c) => c.toLowerCase()));
  const lancamentosDoSino = (limite, prefixo) => entradas.filter((e) => emAbertoSql(e.status)
    && e.dueDate != null && e.dueDate <= limite && String(e.id).slice(0, prefixo.length) !== prefixo);
  const pedidosDoSino = (referencias, piso) => pedidos.filter((p) => (p.code != null && p.code >= piso && !p.nfeId) || referencias.includes(p.id));
  const comMinimo = new Set(stockCore.idsComMinimo(data));

  const datas = ['2026-10-07T00:30:00.000Z', '2026-10-07T12:00:00.000Z', '2026-10-07T23:30:00.000Z',
    '2026-12-31T23:59:00.000Z', '2026-03-08T02:00:00.000Z', '2026-11-01T03:30:00.000Z'];
  const resultados = [];
  for (const agora of datas) {
    for (const permissoes of [
      { finance: true, sales: true, stock: true, fiscal: true },
      { finance: true, sales: false, stock: false, fiscal: false },
      { finance: false, sales: true, stock: true, fiscal: false }
    ]) {
      // Como a rota monta o limite: hoje (UTC) + 8.
      // (Conferido por mutação: com hoje + 6 o painel muda nesta base.)
      const limite = somaDias(agora.slice(0, 10), 8);
      const recorteEntradas = permissoes.finance ? lancamentosDoSino(limite, A.PREFIXO_IMPORTADO) : [];
      const referencias = [...new Set(recorteEntradas.map((e) => e.referenceId).filter(Boolean))];
      const recortePedidos = permissoes.sales ? pedidosDoSino(referencias, A.PRIMEIRO_NUMERO_PROPRIO) : [];
      const comTudo = A.montarAtencao({
        entradas: permissoes.finance ? entradas : [], notasFiscais: [], pedidos: permissoes.sales ? pedidos : [],
        produtos: permissoes.stock ? situacao(produtosTodos) : [], statusQueFaturam, permissoes, agora
      });
      const comRecorte = A.montarAtencao({
        entradas: recorteEntradas, notasFiscais: [], pedidos: recortePedidos,
        produtos: permissoes.stock ? situacao(produtosTodos.filter((p) => comMinimo.has(p.id))) : [],
        statusQueFaturam, permissoes, agora
      });
      resultados.push({ agora, iguais: JSON.stringify(comTudo) === JSON.stringify(comRecorte), total: comTudo.total });
    }
  }
  // O piso e o prefixo são os reais (lib/atencao.js): nesta base inventada os
  // dois cortam de verdade — códigos dos dois lados de 16.000, ids com e sem
  // `fin-viper-`.
  return resultados;
}

if (process.env.PAINEL_INICIO_FILHO) {
  process.stdout.write(JSON.stringify(rodarSuperconjunto()));
  process.exit(0);
}

console.log('--- 1. o pré-filtro do sino é superconjunto da regra ---');
for (const fuso of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
  const filho = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ: fuso, PAINEL_INICIO_FILHO: '1' }, encoding: 'utf8' });
  let resultados = [];
  try { resultados = JSON.parse(filho.stdout); } catch (_) { resultados = []; }
  const diferentes = resultados.filter((r) => !r.iguais);
  const comPendencia = resultados.filter((r) => r.total > 0).length;
  check(`fuso ${fuso}: o painel com o recorte é o mesmo de com tudo`,
    resultados.length === 18 && diferentes.length === 0 && comPendencia >= 12,
    `${resultados.length} casos, ${comPendencia} com pendência, ${diferentes.length} diferente(s)${filho.stderr ? ' ' + filho.stderr.slice(0, 200) : ''}`);
}

// ===========================================================================
console.log('\n--- 2. chaveDaFilial memorizada ---');
// ===========================================================================
{
  const { chaveDaFilial } = require('../lib/filial-da-venda');
  const semMemoria = (nome) => String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const nomes = ['Timbó', 'Timbo', ' TIMBÓ  ', 'Joinville   Centro', '', null, undefined, 0, 'Assistência', 'Transferência entre Filiais'];
  check('mesma chave que a conta sem memória', nomes.every((n) => chaveDaFilial(n) === semMemoria(n) && chaveDaFilial(n) === semMemoria(n)));
  // Passa do teto (5.000) e o mapa é limpo: as respostas continuam certas.
  let todasCertas = true;
  for (let i = 0; i < 12000; i += 1) {
    const n = `Loja ${i} Ç`;
    if (chaveDaFilial(n) !== semMemoria(n)) todasCertas = false;
  }
  check('  e continua certa depois de o teto limpar o mapa', todasCertas && nomes.every((n) => chaveDaFilial(n) === semMemoria(n)));
}

// ===========================================================================
console.log('\n--- 3. o sino do app.js ---');
// ===========================================================================
// Recorta as funções do sino e roda com `api`, `document` e relógio falsos.
{
  const app = ler('public/app.js');
  const recortar = (assinatura) => {
    const inicio = app.indexOf(assinatura);
    const fim = app.indexOf('\n}\n', inicio);
    return app.slice(inicio, fim + 3);
  };
  const fonte = [
    'async function buscarAtencao(', 'function atualizarSinoDeAtencao(', 'function soltarSinoDeAtencao(', 'async function pintarSinoDeAtencao('
  ].map(recortar).join('\n');
  const estado = { chamadas: 0, respostas: [], timers: [], agora: 1_000_000 };
  const marca = { hidden: true, classList: { toggle() {} } };
  const botao = { title: '' };
  const contexto = {
    Date: class extends Date { static now() { return estado.agora; } },
    Number, String, Promise, Error,
    document: { getElementById: (id) => (id === 'notifDot' ? marca : id === 'notifBtn' ? botao : null) },
    setTimeout: (fn) => { estado.timers.push(fn); return estado.timers.length; },
    clearTimeout: () => {},
    // Cada chamada fica pendurada até o teste resolvê-la.
    api: () => { estado.chamadas += 1; return new Promise((ok) => estado.respostas.push(ok)); }
  };
  vm.createContext(contexto);
  vm.runInContext(`
    const ATENCAO_VALIDADE_MS = 60000; const SINO_RESERVA_MS = 2000;
    let ultimoPainelAtencao = null; let atencaoBuscadaEm = 0; let atencaoEmVoo = null;
    let atencaoGeracao = 0; let atencaoEmVooGeracao = -1; let sinoEsperandoATela = null;
    ${fonte}
    this.S = {
      buscarAtencao, atualizarSinoDeAtencao, soltarSinoDeAtencao,
      escrever() { atencaoBuscadaEm = 0; atencaoGeracao += 1; },
      get fresco() { return ultimoPainelAtencao && (Date.now() - atencaoBuscadaEm) < ATENCAO_VALIDADE_MS; },
      get painel() { return ultimoPainelAtencao; },
      get esperando() { return Boolean(sinoEsperandoATela); }
    };`, contexto);
  const S = contexto.S;
  const esvaziar = () => new Promise((ok) => setImmediate(ok));

  (async () => {
    // A busca sai, e no meio dela alguém grava (fatura um pedido).
    const antes = S.buscarAtencao({ forcar: true });
    S.escrever();
    // O painel do Início, aberto depois da escrita, NÃO pode receber a busca de antes.
    const depois = S.buscarAtencao({ forcar: true });
    check('a busca de antes de uma escrita não serve a quem pede depois', estado.chamadas === 2, `${estado.chamadas} chamada(s)`);
    estado.respostas[0]({ total: 1, criticos: 1, itens: ['velho'] });
    await antes;
    check('  e a resposta dela não vira o painel fresco', !S.fresco && S.painel === null);
    estado.respostas[1]({ total: 0, criticos: 0, itens: [] });
    const pDepois = await depois;
    check('  a de depois vira', S.fresco && S.painel === pDepois);
    // Sem escrita no meio, quem pede durante a busca pega a mesma.
    estado.agora += 61000;
    const a = S.buscarAtencao({ forcar: true });
    const b = S.buscarAtencao({ forcar: true });
    check('sem escrita no meio, uma busca em voo atende os dois', estado.chamadas === 3, `${estado.chamadas}`);
    estado.respostas[2]({ total: 2, criticos: 0, itens: [] });
    const [ra, rb] = await Promise.all([a, b]);
    check('  com a mesma resposta', ra === rb && ra.total === 2);

    // Vencido: o sino ESPERA a tela.
    estado.agora += 61000;
    S.atualizarSinoDeAtencao();
    check('vencido, o sino não sai junto com a tela', estado.chamadas === 3 && S.esperando);
    S.soltarSinoDeAtencao();
    check('  e sai quando loadModule o solta', estado.chamadas === 4 && !S.esperando);
    estado.respostas[3]({ total: 5, criticos: 2, itens: [] });
    await esvaziar(); await esvaziar();
    check('  e pinta a marca com a resposta', marca.hidden === false && /5 pendência/.test(botao.title), botao.title);
    // Fresco: pinta na hora, sem ir ao servidor.
    marca.hidden = true;
    S.atualizarSinoDeAtencao();
    await esvaziar();
    check('fresco, pinta na hora sem ir ao servidor', estado.chamadas === 4 && marca.hidden === false && !S.esperando);
    // O temporizador de reserva solta sozinho quem não tem loadModule depois.
    estado.agora += 61000;
    S.atualizarSinoDeAtencao();
    estado.timers[estado.timers.length - 1]();
    check('  e o temporizador de reserva solta sozinho', estado.chamadas === 5 && !S.esperando);
    estado.respostas[4]({ total: 0, criticos: 0, itens: [] });
    await esvaziar();
    secao4();
  })().catch((e) => { check('o sino rodou sem erro', false, e.message); secao4(); });
}

// ===========================================================================
// 4 e 5. A TELA DO INÍCIO
// ===========================================================================
function secao4() {
  console.log('\n--- 4. a tela do Início: idas ao servidor por clique ---');
  const fonte = ler('public/modules/dashboard/index.js');
  const chamadas = [];
  let agora = 2_000_000;
  const ouvintes = [];
  const elemento = (attrs = {}) => ({
    innerHTML: '', hidden: false, value: '', dataset: {}, ...attrs,
    addEventListener(tipo, fn) { ouvintes.push({ el: this, tipo, fn }); },
    querySelectorAll() { return []; }, querySelector() { return null; },
    elements: {}, setAttribute() {}, classList: { toggle() {} }
  });
  let secaoFavoritos = null;
  const content = elemento();
  content.querySelector = (sel) => (sel === '[data-dashboard-favoritos]' ? secaoFavoritos : null);
  const contexto = {
    console, Promise, Map, Set, Array, Object, String, Number, JSON, Math, encodeURIComponent, Boolean,
    Date: class extends Date { static now() { return agora; } },
    moduleLabels: { dashboard: 'Início', sales: 'Vendas', finance: 'Financeiro' },
    moduleSubItems: {}, telasVisiveis: () => [], favoriteIconSvg: () => '',
    financeBuildChartSvg: () => '<svg></svg>', getDashboardPinLabel: (k) => k,
    getDashboardPinSet: () => new Set(estadoTela.user.dashboardPins),
    buscarAtencao: async ({ forcar = false } = {}) => { chamadas.push(`sino(forcar=${forcar})`); return { itens: [], total: 0 }; },
    document: { createElement: () => { const molde = { set innerHTML(v) { molde.firstElementChild = { html: v, replaceWith() {}, querySelectorAll: () => [] }; } }; return molde; } }
  };
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(fonte, contexto, { filename: 'dashboard/index.js' });
  let falharProxima = false;
  // Uma promessa que segura a resposta do gráfico: deixa uma abertura em voo.
  let segurarGrafico = null;
  const estadoTela = { user: { id: 'u1', name: 'Ana', allowedModules: ['sales', 'finance'], dashboardPins: [] }, activeModule: 'dashboard' };
  const ctx = {
    content, state: estadoTela, showToast() {}, escapeHtml: (s) => String(s),
    api: async (url) => {
      chamadas.push(url.replace(/\?.*/, ''));
      if (segurarGrafico && url.startsWith('/api/dashboard/charts')) await segurarGrafico;
      if (falharProxima) { falharProxima = false; throw new Error('rede'); }
      if (url.startsWith('/api/dashboard/charts')) return { salesChartSeries: [], financeChartSeries: [], filiais: [{ nome: 'Araquari' }], filial: '', permissions: { sales: true, finance: true } };
      return { kpis: [{ id: 'faturamento', modulo: 'sales', titulo: 'F', valor: 1 }, { id: 'a-receber', modulo: 'finance', titulo: 'R', valor: 1 }] };
    }
  };
  const render = contexto.window.MavisModuleRegistry.dashboard;
  const passo = async (nome, fn, esperado) => {
    chamadas.length = 0;
    await fn();
    check(nome, JSON.stringify(chamadas) === JSON.stringify(esperado), chamadas.join(', ') || 'nenhuma');
  };

  (async () => {
    await passo('abrir o Início: as duas rotas e o sino pela porta única, forçado',
      () => render(ctx), ['/api/dashboard/charts', '/api/dashboard', 'sino(forcar=true)']);
    await passo('clicar numa aba: nenhuma', () => { estadoTela.dashboardAba = 'sales'; return render(ctx, { reusar: 'tudo' }); }, []);
    await passo('trocar a filial: só o gráfico (e o sino guardado)', () => { estadoTela.dashboardFilial = 'Araquari'; return render(ctx, { reusar: 'resumo' }); },
      ['/api/dashboard/charts', 'sino(forcar=false)']);
    await passo('abrir a meta depois: nenhuma', () => { estadoTela.dashboardMetaAberta = true; return render(ctx, { reusar: 'tudo' }); }, []);
    await passo('trocar o período: tudo de novo', () => { estadoTela.dashboardChartGranularity = 'year'; return render(ctx); },
      ['/api/dashboard/charts', '/api/dashboard', 'sino(forcar=true)']);
    agora += 61000;
    await passo('aba 61 s depois: venceu, tudo de novo', () => render(ctx, { reusar: 'tudo' }),
      ['/api/dashboard/charts', '/api/dashboard', 'sino(forcar=false)']);
    estadoTela.user = { ...estadoTela.user, id: 'u2' };
    await passo('aba com OUTRO usuário na mesma aba do navegador: tudo de novo', () => render(ctx, { reusar: 'tudo' }),
      ['/api/dashboard/charts', '/api/dashboard', 'sino(forcar=false)']);
    // Uma fonte que falhou não é guardada: o próximo clique tenta de novo.
    falharProxima = true;
    await passo('abrir com o gráfico fora do ar', () => render(ctx), ['/api/dashboard/charts', '/api/dashboard', 'sino(forcar=true)']);
    await passo('  a aba seguinte não reaproveita a falha', () => render(ctx, { reusar: 'tudo' }),
      ['/api/dashboard/charts', '/api/dashboard', 'sino(forcar=false)']);

    console.log('\n--- 5. fixar favorito ---');
    let trocada = null;
    secaoFavoritos = { replaceWith(nova) { trocada = nova; } };
    contexto.saveDashboardPins = async (pins) => { chamadas.push('PUT favoritos'); return pins; };
    chamadas.length = 0;
    await vm.runInContext('alternarFavoritoDoDashboard', contexto)(ctx, 'sales', 'Vendas');
    check('fixar grava o favorito e não refaz nenhuma rota do painel', JSON.stringify(chamadas) === JSON.stringify(['PUT favoritos']), chamadas.join(', '));
    check('  e troca só a seção, já com o favorito', Boolean(trocada) && /data-dashboard-favoritos/.test(trocada.html)
      && JSON.stringify(estadoTela.user.dashboardPins) === '["sales"]');
    chamadas.length = 0;
    await vm.runInContext('alternarFavoritoDoDashboard', contexto)(ctx, 'sales', 'Vendas');
    check('  e desfixar em seguida lê o conjunto atual', JSON.stringify(estadoTela.user.dashboardPins) === '[]');

    // Fixar DURANTE uma abertura em andamento (trocar o período e clicar na
    // estrela do DOM antigo): a gravação termina antes, a abertura desenha por
    // último — e tem de desenhar o favorito que acabou de ser gravado.
    let soltarGrafico;
    segurarGrafico = new Promise((r) => { soltarGrafico = r; });
    content.innerHTML = '';
    estadoTela.dashboardChartGranularity = 'month';
    const abertura = render(ctx);
    await new Promise((ok) => setImmediate(ok));
    await vm.runInContext('alternarFavoritoDoDashboard', contexto)(ctx, 'sales', 'Vendas');
    check('fixar durante uma abertura em voo grava o favorito', JSON.stringify(estadoTela.user.dashboardPins) === '["sales"]');
    segurarGrafico = null;
    soltarGrafico();
    await abertura;
    check('  e a abertura, que termina depois, desenha a seção com ele',
      /data-dashboard-favoritos/.test(content.innerHTML) && !/Sem favoritos/.test(content.innerHTML)
      && /data-pin-key="sales"/.test(content.innerHTML), content.innerHTML.includes('Sem favoritos') ? 'desenhou "Sem favoritos"' : '');

    console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
    process.exit(falhas ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
