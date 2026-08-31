window.MavisModuleRegistry = window.MavisModuleRegistry || {};

// Ordem das abas exibidas nos favoritos do dashboard (mesma ordem do menu lateral).
// Rótulos e sub-abas vêm de moduleLabels/moduleSubItems (definidos em app.js) para
// que sidebar e dashboard nunca fiquem dessincronizados.
const DASHBOARD_MODULE_ORDER = ['dashboard', 'sales', 'purchases', 'stock', 'finance', 'cadastros'];

// Abrir um módulo pelo balão do dashboard não escolhe sub-aba: sem sub-aba o
// módulo cai na sua Área de Trabalho, igual a clicar nele no menu lateral.
// Antes havia aqui um mapa apontando cada módulo para uma tela fixa
// (Vendas -> Pedidos, Estoque -> Produtos), o que dava dois destinos diferentes
// para o mesmo clique dependendo de onde ele partia.
const DASHBOARD_DEFAULT_SUB = {};

function buildPinKey(moduleKey, subKey) {
  return subKey ? `${moduleKey}::${subKey}` : moduleKey;
}

function getModuleIcon(label) {
  const letters = String(label || '')
    .replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return letters || 'MO';
}

function getVisibleModules(state) {
  const allowed = new Set(Array.isArray(state.user?.allowedModules) ? state.user.allowedModules : []);
  return DASHBOARD_MODULE_ORDER
    .filter((moduleKey) => moduleKey === 'dashboard' || allowed.has(moduleKey))
    .map((moduleKey) => ({
      key: moduleKey,
      label: moduleLabels[moduleKey] || moduleKey,
      items: (typeof telasVisiveis === 'function' ? telasVisiveis(moduleKey) : (moduleSubItems[moduleKey] || []))
    }));
}

function getDefaultSubKey(moduleKey) {
  return DASHBOARD_DEFAULT_SUB[moduleKey] || null;
}

function navigateToModule(ctx, moduleKey, subKey) {
  const { state, renderApp, loadModule } = ctx;
  state.activeModule = moduleKey;
  state.activeSub = subKey || null;
  state.selectedModule = null;
  renderApp();
  loadModule(moduleKey);
}

// Nome não pode ser "saveDashboardPins": app.js já declara uma função global com esse
// nome (assinatura de 1 argumento). Como estes são scripts clássicos, os dois top-level
// "function saveDashboardPins" viram a MESMA variável global — a de app.js, carregada
// por último, vence. Uma chamada daqui com (ctx, nextPins) caía na versão de app.js,
// que só declara 1 parâmetro: "ctx" virava o valor de "nextPins" lá dentro, falhava o
// Array.isArray() e zerava todos os favoritos a cada clique. Nome diferente evita a colisão.
async function applyDashboardPins(ctx, nextPins) {
  if (typeof window.saveDashboardPins === 'function') {
    const saved = await window.saveDashboardPins(nextPins);
    ctx.state.user.dashboardPins = saved;
    return saved;
  }

  ctx.state.user.dashboardPins = nextPins;
  return nextPins;
}

function renderPinButton(ctx, pinKey, label, pinnedSet) {
  const pinned = pinnedSet.has(pinKey);
  return `
    <button
      type="button"
      class="dashboard-pin-btn favorite-btn ${pinned ? 'active' : ''}"
      aria-pressed="${pinned ? 'true' : 'false'}"
      title="${pinned ? 'Desfixar' : 'Fixar'} ${ctx.escapeHtml(label)}"
      data-pin-key="${ctx.escapeHtml(pinKey)}"
    >
      ${favoriteIconSvg(pinned)}
    </button>
  `;
}

// Cada módulo favoritado gera DOIS balões independentes: um para o módulo em si
// (título + fixar/desfixar) e outro, ao lado/abaixo, com a coluna das abas
// daquele módulo marcadas como favoritas.
function renderModuleGroup(ctx, module, pinnedSet) {
  const { state, escapeHtml } = ctx;
  const mainPinKey = buildPinKey(module.key);
  const isMainPinned = pinnedSet.has(mainPinKey);
  const pinnedItems = module.items.filter((item) => pinnedSet.has(buildPinKey(module.key, item.key)));
  const showModule = isMainPinned || pinnedItems.length > 0;

  if (!showModule) {
    return '';
  }

  return `
    <div class="dashboard-favorite-group">
      <section class="dashboard-module-balloon ${state.activeModule === module.key ? 'active' : ''}">
        <button type="button" class="dashboard-module-title" data-open-module="${escapeHtml(module.key)}">
          <span class="dashboard-module-avatar">${escapeHtml(getModuleIcon(module.label))}</span>
          <span class="dashboard-module-heading">
            <strong>${escapeHtml(module.label)}</strong>
            <span>${isMainPinned ? 'Módulo fixado' : 'Abas fixadas'}</span>
          </span>
        </button>
        ${renderPinButton(ctx, mainPinKey, module.label, pinnedSet)}
      </section>

      ${pinnedItems.length ? `
        <section class="dashboard-tabs-balloon">
          <div class="dashboard-tabs-column">
            ${pinnedItems.map((item) => {
              const pinKey = buildPinKey(module.key, item.key);
              const isActive = state.activeModule === module.key && state.activeSub === item.key;
              return `
                <div class="dashboard-tab-row ${isActive ? 'active' : ''}">
                  <button type="button" class="dashboard-tab-open" data-open-sub="${escapeHtml(module.key)}::${escapeHtml(item.key)}">
                    ${escapeHtml(item.label)}
                  </button>
                  ${renderPinButton(ctx, pinKey, item.label, pinnedSet)}
                </div>
              `;
            }).join('')}
          </div>
        </section>
      ` : ''}
    </div>
  `;
}

const DASHBOARD_CHART_GRANULARITY_OPTIONS = [
  { key: 'day', label: 'Diário' },
  { key: 'week', label: 'Semanal' },
  { key: 'month', label: 'Mensal' },
  { key: 'year', label: 'Anual' }
];

// O seletor de granularidade dos gráficos (dia/semana/mês/ano) também define o
// intervalo dos KPIs — trocar para "Semanal" e o cartão continuar somando o
// mês faria os dois discordarem na mesma tela.
const PERIODO_DO_GRANULARITY = { day: 'today', week: 'week', month: 'month', year: 'year' };

function dashboardSaudacao(hora) {
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

// R$ 1,28 mi / R$ 423,8 mil / R$ 940,00. Milhão e mil abreviados porque o
// cartão é estreito e sete dígitos com centavos não cabem — mas abaixo de mil
// o valor sai inteiro, onde o centavo ainda importa.
function dashboardValorCurto(valor) {
  const n = Number(valor || 0);
  const abs = Math.abs(n);
  if (abs >= 1000000) return { numero: (n / 1000000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sufixo: 'mi', prefixo: 'R$' };
  if (abs >= 1000) return { numero: (n / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), sufixo: 'mil', prefixo: 'R$' };
  return { numero: n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sufixo: '', prefixo: 'R$' };
}

/**
 * Sparkline do cartão.
 *
 * Sem eixo e sem rótulo de propósito: ela responde "está subindo ou caindo?",
 * não "quanto". Quem quer o número exato abre o gráfico logo abaixo.
 *
 * `preserveAspectRatio="none"` deixa a linha esticar com a largura do cartão —
 * a forma da curva importa, a proporção não.
 */
function dashboardSparkline(serie) {
  const valores = (serie || []).map((v) => Number(v || 0));
  // Com menos de dois pontos não há tendência a desenhar, e uma linha reta
  // sugeriria estabilidade que não foi medida.
  if (valores.length < 2) return '';
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const faixa = max - min || 1;
  const pontos = valores.map((v, i) => {
    const x = (i * 120) / (valores.length - 1);
    const y = 24 - ((v - min) / faixa) * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `
    <svg class="kpi-spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pontos.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>`;
}

function dashboardCartaoKpi(kpi, escapeHtml) {
  const v = dashboardValorCurto(kpi.valor);
  const temVariacao = kpi.variacao !== null && kpi.variacao !== undefined;
  const subiu = temVariacao && kpi.variacao > 0;
  const caiu = temVariacao && kpi.variacao < 0;
  const tomVariacao = subiu ? 'sobe' : caiu ? 'desce' : 'igual';
  return `
    <article class="kpi-card">
      <h3>${escapeHtml(kpi.titulo)}</h3>
      <p class="kpi-valor">${v.prefixo} ${v.numero}${v.sufixo ? ` <small>${v.sufixo}</small>` : ''}</p>
      <p class="kpi-sub">
        ${temVariacao ? `<span class="kpi-delta kpi-delta-${tomVariacao}">${subiu ? '▲' : caiu ? '▼' : '='} ${Math.abs(kpi.variacao).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>` : ''}
        <span>${escapeHtml(kpi.detalhe || '')}</span>
      </p>
      ${kpi.faixa ? `
        <div class="kpi-faixa">
          <div class="kpi-trilho kpi-trilho-${escapeHtml(kpi.faixa.tom)}">
            <i style="width:${Math.min(100, Math.max(0, kpi.faixa.percentual))}%"></i>
          </div>
          <div class="kpi-faixa-legenda">
            <span>${kpi.faixa.contagem
              ? `${kpi.faixa.valor} ${escapeHtml(kpi.faixa.rotulo)}`
              : `${dashboardValorCurto(kpi.faixa.valor).prefixo} ${dashboardValorCurto(kpi.faixa.valor).numero} ${dashboardValorCurto(kpi.faixa.valor).sufixo} ${escapeHtml(kpi.faixa.rotulo)}`}</span>
            <span>${kpi.faixa.percentual}%</span>
          </div>
        </div>
      ` : (kpi.serie ? dashboardSparkline(kpi.serie) : '')}
    </article>`;
}

window.MavisModuleRegistry.dashboard = async function renderDashboard(ctx) {
  const { content, state, showToast, api, escapeHtml } = ctx;
  const visibleModules = getVisibleModules(state);
  const pinnedSet = getDashboardPinSet();
  const favoriteModules = visibleModules.filter((module) => {
    const mainPinned = pinnedSet.has(buildPinKey(module.key));
    const hasPinnedItems = module.items.some((item) => pinnedSet.has(buildPinKey(module.key, item.key)));
    return mainPinned || hasPinnedItems;
  });

  const granularity = state.dashboardChartGranularity || 'month';
  let charts = { salesChartSeries: [], financeChartSeries: [], permissions: {} };
  try {
    charts = await api(`/api/dashboard/charts?granularity=${granularity}`);
  } catch (error) {
    // Sem os gráficos o resto do Dashboard Geral (favoritos) continua funcionando normalmente.
  }

  // As três fontes são independentes e falham em separado: um KPI indisponível
  // não pode apagar os gráficos, nem o painel de pendências apagar os KPIs.
  // Buscadas em paralelo porque nenhuma depende da outra — em série, a tela
  // esperaria a soma dos três tempos.
  const [resumo, pendencias] = await Promise.all([
    api(`/api/dashboard?period=${encodeURIComponent(PERIODO_DO_GRANULARITY[granularity] || 'month')}`).catch(() => ({ kpis: [] })),
    api('/api/dashboard/atencao').catch(() => ({ itens: [] }))
  ]);

  async function togglePin(pinKey, label) {
    const wasPinned = pinnedSet.has(pinKey);
    const nextPins = wasPinned
      ? Array.from(pinnedSet).filter((item) => item !== pinKey)
      : Array.from(new Set([...pinnedSet, pinKey]));

    try {
      await applyDashboardPins(ctx, nextPins);
      showToast(wasPinned ? `Removido dos fixados: ${label}` : `Fixado: ${label}`, 'success');
      await window.MavisModuleRegistry.dashboard(ctx);
    } catch (error) {
      showToast(error.message || 'Erro ao salvar favoritos do dashboard.', 'error');
    }
  }

  const salesChartPanel = charts.permissions?.sales ? `
    <section class="panel finance-panel-stripe-chart">
      <h3>Fluxo de Vendas</h3>
      <div class="finance-chart-legend">
        <!-- Cor por classe, não por style inline: inline vence o CSS, e a
             legenda ficava presa no azul/roxo do tema claro enquanto a linha
             do gráfico acendia no escuro. -->
        <span><i class="finance-legend-dot finance-legend-pedidos"></i> Pedidos</span>
        <span><i class="finance-legend-dot finance-legend-orcamentos"></i> Orçamentos</span>
      </div>
      <div class="finance-chart-wrap">
        ${financeBuildChartSvg(charts.salesChartSeries || [], escapeHtml, [
          { key: 'pedidos', cssClass: 'finance-chart-line-blue' },
          { key: 'orcamentos', cssClass: 'finance-chart-line-purple' }
        ])}
      </div>
    </section>
  ` : '';

  const financeChartPanel = charts.permissions?.finance ? `
    <section class="panel finance-panel-stripe-chart">
      <h3>Fluxo Financeiro</h3>
      <div class="finance-chart-legend">
        <span><i class="finance-legend-dot finance-legend-receita"></i> Receitas</span>
        <span><i class="finance-legend-dot finance-legend-despesa"></i> Despesas</span>
        <span><i class="finance-legend-line"></i> Saldo</span>
      </div>
      <div class="finance-chart-wrap">
        ${financeBuildChartSvg(charts.financeChartSeries || [], escapeHtml)}
      </div>
    </section>
  ` : '';

  const cartoes = resumo.kpis || [];
  const itensAtencao = pendencias.itens || [];

  /**
   * ABAS DE SEÇÃO
   * =============
   * O painel cresceu para cinco cartões, dois gráficos, as pendências e os
   * favoritos — uma rolagem longa em que ninguém olha o fim. As abas separam
   * por ÁREA: quem abriu para conferir o caixa não passa pelo gráfico de
   * vendas no caminho.
   *
   * DUAS COISAS QUE NÃO ENTRAM NA ABA, DE PROPÓSITO
   * ----------------------------------------------
   * 1. ATENÇÃO. Aba esconde conteúdo, e pendência escondida é pendência
   *    perdida: uma nota rejeitada não pode ficar invisível porque o usuário
   *    estava na aba Vendas. Fica fixa na coluna da direita em TODAS as abas,
   *    sempre completa — nunca filtrada pela aba.
   * 2. FAVORITOS. É o atalho para sair do painel; escondê-lo atrás de uma aba
   *    acrescentaria um clique a toda navegação.
   *
   * As abas são DERIVADAS do que existe: só aparece a área que tem cartão ou
   * gráfico para mostrar, e a permissão já decidiu isso lá atrás. Uma lista
   * fixa mostraria "Financeiro" vazio para quem não tem o módulo.
   */
  const AREAS = [
    { key: 'sales', label: 'Vendas' },
    { key: 'finance', label: 'Financeiro' },
    { key: 'stock', label: 'Estoque' },
    { key: 'purchases', label: 'Compras' }
  ];
  const graficoDaArea = { sales: salesChartPanel, finance: financeChartPanel };
  const areasComConteudo = AREAS.filter((area) => cartoes.some((k) => k.modulo === area.key) || graficoDaArea[area.key]);
  // Uma área só não vira abas: "Visão geral" e "Vendas" mostrariam o mesmo
  // conteúdo, e duas abas idênticas são pior que nenhuma.
  const usaAbas = areasComConteudo.length > 1;
  const abas = usaAbas ? [{ key: 'geral', label: 'Visão geral' }, ...areasComConteudo] : [];
  const abaAtiva = abas.some((a) => a.key === state.dashboardAba) ? state.dashboardAba : 'geral';

  const cartoesVisiveis = abaAtiva === 'geral' ? cartoes : cartoes.filter((k) => k.modulo === abaAtiva);
  const graficosVisiveis = abaAtiva === 'geral'
    ? [salesChartPanel, financeChartPanel].filter(Boolean)
    : [graficoDaArea[abaAtiva]].filter(Boolean);

  const tiraDeAbas = usaAbas ? `
    <nav class="dashboard-abas" role="tablist" aria-label="Seções do painel">
      ${abas.map((aba) => `
        <button type="button" role="tab" aria-selected="${aba.key === abaAtiva}"
                class="dashboard-aba ${aba.key === abaAtiva ? 'active' : ''}"
                data-dashboard-aba="${escapeHtml(aba.key)}">${escapeHtml(aba.label)}</button>
      `).join('')}
    </nav>
  ` : '';

  // Painel de pendências ao lado do gráfico de vendas — as mesmas do sino da
  // barra superior, lidas da mesma rota, para os dois nunca discordarem.
  const painelAtencao = `
    <section class="panel dashboard-atencao">
      <div class="dashboard-atencao-topo">
        <h3>Atenção</h3>
        ${itensAtencao.length ? `<span class="muted">${pendencias.total} registro(s)</span>` : ''}
      </div>
      ${itensAtencao.length ? itensAtencao.map((item, i) => `
        <button type="button" class="dashboard-atencao-item" data-atencao="${i}">
          <span class="notif-sev notif-sev-${escapeHtml(item.severidade)}"></span>
          <span class="dashboard-atencao-texto">
            <strong>${escapeHtml(item.titulo)}</strong>
            <span>${escapeHtml(item.detalhe || '')}</span>
          </span>
          <span class="dashboard-atencao-conta">${escapeHtml(String(item.contagem))}</span>
        </button>
      `).join('')
      // Painel vazio é boa notícia e precisa dizer isso — sem texto, parece
      // que o carregamento falhou.
      : '<p class="dashboard-atencao-vazio">Nada pendente. Contas em dia, notas autorizadas e estoque acima do mínimo.</p>'}
    </section>`;

  content.innerHTML = `
    <div class="dashboard-shell">
      <section class="dashboard-saudacao">
        <div>
          <h2>${escapeHtml(dashboardSaudacao(new Date().getHours()))}, ${escapeHtml(String(state.user?.name || 'Usuário').split(/\s+/)[0])}</h2>
          <p class="muted">${itensAtencao.length
            ? `${pendencias.criticos ? `${pendencias.criticos} item(ns) crítico(s)` : `${pendencias.total} pendência(s)`} esperando você.`
            : 'Nada pendente no momento.'}</p>
        </div>
        <!-- O MESMO seletor manda nos gráficos e nos KPIs. Dois controles
             separados deixariam a tela mostrando semana num lugar e mês no
             outro, sem ninguém perceber. -->
        <div class="finance-granularity-group" role="tablist">
          ${DASHBOARD_CHART_GRANULARITY_OPTIONS.map((opt) => `<button type="button" class="finance-pill finance-pill-sm ${granularity === opt.key ? 'active' : ''}" data-dashboard-granularity="${opt.key}">${opt.label}</button>`).join('')}
        </div>
      </section>

      ${tiraDeAbas}

      ${cartoesVisiveis.length ? `
        <section class="kpi-grid">
          ${cartoesVisiveis.map((kpi) => dashboardCartaoKpi(kpi, escapeHtml)).join('')}
        </section>
      ` : ''}

      <div class="dashboard-charts-section">
        <!-- Gráfico largo, pendências estreitas: a lista é de leitura rápida,
             o gráfico precisa de espaço para os doze meses caberem sem os
             rótulos se sobreporem.
             Atenção fica na coluna da direita em TODAS as abas — é o único
             bloco que a troca de aba não pode esconder. -->
        <div class="dashboard-charts-grid dashboard-charts-grid-principal">
          ${graficosVisiveis[0] || '<div class="dashboard-aba-vazia"><p class="muted">Nada para mostrar nesta seção no período escolhido.</p></div>'}
          ${painelAtencao}
        </div>
        ${graficosVisiveis.slice(1).map((grafico) => `<div class="dashboard-charts-grid">${grafico}</div>`).join('')}
      </div>

      <section class="panel">
        <div class="dashboard-favoritos-topo">
          <h3>Favoritos</h3>
          <p class="muted">Somente os módulos e abas fixados aparecem aqui.</p>
        </div>
        ${favoriteModules.length ? `
          <div class="dashboard-favorites-grid">
            ${favoriteModules.map((module) => renderModuleGroup(ctx, module, pinnedSet)).join('')}
          </div>
        ` : `
          <div class="dashboard-empty-state">
            <strong>Sem favoritos</strong>
            <p class="muted">Use "Fixar módulo" na Área de Trabalho, ou a estrela ao lado de cada tela.</p>
          </div>
        `}
      </section>
    </div>
  `;

  content.querySelectorAll('[data-dashboard-aba]').forEach((button) => {
    button.addEventListener('click', () => {
      state.dashboardAba = button.dataset.dashboardAba;
      window.MavisModuleRegistry.dashboard(ctx);
    });
  });

  content.querySelectorAll('[data-dashboard-granularity]').forEach((button) => {
    button.addEventListener('click', () => {
      state.dashboardChartGranularity = button.dataset.dashboardGranularity;
      window.MavisModuleRegistry.dashboard(ctx);
    });
  });

  // Cada pendência leva à tela onde ela se resolve — a mesma navegação do
  // painel do sino, para os dois se comportarem igual.
  content.querySelectorAll('[data-atencao]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const item = itensAtencao[Number(botao.dataset.atencao)];
      if (item) navigateToModule(ctx, item.modulo, item.sub);
    });
  });

  content.querySelectorAll('[data-open-module]').forEach((button) => {
    button.addEventListener('click', () => {
      const moduleKey = button.dataset.openModule;
      if (!moduleKey) return;
      navigateToModule(ctx, moduleKey, getDefaultSubKey(moduleKey));
    });
  });

  content.querySelectorAll('[data-open-sub]').forEach((button) => {
    button.addEventListener('click', () => {
      const [moduleKey, subKey] = String(button.dataset.openSub || '').split('::');
      if (!moduleKey || !subKey) return;
      navigateToModule(ctx, moduleKey, subKey);
    });
  });

  content.querySelectorAll('[data-pin-key]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const pinKey = button.dataset.pinKey;
      if (!pinKey) return;
      togglePin(pinKey, getDashboardPinLabel(pinKey));
    });
  });
};
