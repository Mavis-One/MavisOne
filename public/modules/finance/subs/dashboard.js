window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const FINANCE_PERIOD_OPTIONS = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mês' },
  { key: 'prev_month', label: 'Mês anterior' },
  { key: 'next_month', label: 'Próximo mês' },
  { key: 'custom', label: 'Personalizado' }
];

const FINANCE_GRANULARITY_OPTIONS = [
  { key: 'day', label: 'Diário' },
  { key: 'week', label: 'Semanal' },
  { key: 'month', label: 'Mensal' },
  { key: 'year', label: 'Anual' }
];

const FINANCE_DUE_TABS = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'amanha', label: 'Amanhã' },
  { key: 'proximos7', label: 'Próximos 7 dias' },
  { key: 'proximos30', label: 'Próximos 30 dias' }
];

const FINANCE_STATUS_META = {
  pago: { label: 'Pago', tone: 'success' },
  recebido: { label: 'Recebido', tone: 'success' },
  pendente: { label: 'Pendente', tone: 'warning' },
  vencido: { label: 'Vencido', tone: 'danger' },
  parcial: { label: 'Parcial', tone: 'info' },
  cancelado: { label: 'Cancelado', tone: 'muted' }
};

const FINANCE_TYPE_LABEL = { receita: 'Receita', despesa: 'Despesa', transferencia: 'Transferência', outro: 'Outro' };

function financeFormatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function financeFormatDate(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

// O rótulo vai ESCAPADO (fase EI): para situação fora do catálogo ele é o
// próprio status gravado, e a rota legada POST /api/finance gravava o que viesse
// no corpo. A CSP barra script inline, mas HTML injetado ainda desenhava o que
// quisesse por cima da tela. Esta função também serve Lançamentos e NF-e
// Emitidas. `escapeHtml` é a global do app.js, resolvida na hora da chamada.
function financeStatusBadge(status) {
  const meta = FINANCE_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${escapeHtml(meta.label)}</span>`;
}

function financeStatCard({ tone, label, value, badge, sub, delta }) {
  return `
    <div class="finance-stat-card finance-stat-card-${tone}">
      ${badge ? `<span class="finance-stat-badge">${badge}</span>` : ''}
      <div class="finance-stat-card-head">
        <span class="finance-stat-dot"></span>
        <span class="finance-stat-label">${label}</span>
      </div>
      <p class="finance-stat-value">${value}</p>
      ${sub ? `<div class="finance-stat-sub">${sub}</div>` : ''}
      ${delta || ''}
    </div>
  `;
}

function financeStatSubRow(tone, label, value) {
  return `<span class="finance-stat-sub-row ${tone}">${label}: ${financeFormatBRL(value)}</span>`;
}

// O gráfico de tendência mudou de casa: agora é MavisPainel.graficoLinha, em
// modules/shared/painel.js. Ele nasceu aqui e virou global por acidente — o
// Dashboard Geral e Relatórios passaram a chamá-lo confiando na ordem das tags
// <script>, e qualquer reordenação do index.html quebraria duas telas que nem
// mencionam o Financeiro. `financeBuildChartSvg` continua valendo como apelido,
// definido lá; o desenho é literalmente a mesma função.

// O relógio da atualização automática mora FORA da tela (fase DS): sair do
// dashboard e voltar cria uma tela nova, e a cadeia da anterior acharia o selo
// "Atualizado há..." da nova e continuaria viva ao lado dela. Um relógio só,
// trocado por quem abrir a tela por último.
let financeDashboardRelogio = null;

window.MavisSubscreenRegistry.finance.dashboard = async function renderFinanceDashboard(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml } = ctx;

  let period = 'month';
  let granularity = 'month';
  let customFrom = '';
  let customTo = '';
  let dueTab = 'proximos7';
  let lastLoadedAt = Date.now();
  const AUTO_REFRESH_MS = 60000;
  // UMA CADEIA SÓ DE ATUALIZAÇÃO (fase DS).
  //
  // Cada load() terminava com um `setTimeout(tickLiveBadge, 1000)` novo, sem
  // cancelar o anterior: clicar num período ou granularidade deixava mais uma
  // cadeia viva, e cada uma pedia /api/finance/summary a cada minuto. Simulado
  // com o arquivo real e relógio falso: parado, 10 chamadas em 10 min; depois
  // de 3 cliques, 39. Cada uma segurava o servidor (um processo só) por
  // centenas de ms.
  //
  // `financeDashboardRelogio` é a cadeia que vale: toda nova cancela a
  // anterior. `carga` numera as cargas, e só a MAIS NOVA desenha — dois cliques
  // rápidos podiam desenhar a resposta velha por cima da nova, se ela chegasse
  // depois.
  let carga = 0;
  let carregando = false;

  function goTo(sub) {
    state.activeSub = sub;
    loadModule('finance');
  }

  function agendarTick() {
    clearTimeout(financeDashboardRelogio);
    financeDashboardRelogio = setTimeout(tickLiveBadge, 1000);
  }

  function tickLiveBadge() {
    financeDashboardRelogio = null;
    const badge = document.getElementById('financeLiveBadgeText');
    if (!badge || !document.body.contains(badge)) return; // usuário navegou pra outra tela: para o timer
    const elapsedS = Math.round((Date.now() - lastLoadedAt) / 1000);
    if (elapsedS * 1000 >= AUTO_REFRESH_MS) {
      // "Personalizado" sem as duas datas aplicadas não atualiza (fase EI): a
      // carga iria sem datas, o servidor devolveria só o dia de hoje com a
      // pílula Personalizado marcada, e o redesenho apagaria as datas que a
      // pessoa estava digitando. O relógio segue; atualiza depois do Aplicar.
      if (period === 'custom' && (!customFrom || !customTo)) {
        badge.textContent = `Atualizado há ${elapsedS}s · aplique o período para atualizar`;
        agendarTick();
        return;
      }
      // A atualização automática não se soma a uma carga em andamento (um
      // clique do usuário, por exemplo): aquela já vai trazer o dado novo e
      // religar o relógio quando terminar.
      if (!carregando) load();
      return;
    }
    const nextInS = Math.max(0, Math.round((AUTO_REFRESH_MS - elapsedS * 1000) / 1000));
    badge.textContent = `Atualizado há ${elapsedS}s · próxima em ${nextInS}s`;
    agendarTick();
  }

  function attachHandlers(data) {
    content.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        period = btn.dataset.period;
        if (period !== 'custom') {
          load();
        } else {
          renderView(data, true);
        }
      });
    });

    document.getElementById('financeCustomApply')?.addEventListener('click', () => {
      customFrom = document.getElementById('financeCustomFrom')?.value || '';
      customTo = document.getElementById('financeCustomTo')?.value || '';
      if (!customFrom || !customTo) {
        showToast('Informe as duas datas do período personalizado.', 'warning');
        return;
      }
      load();
    });

    content.querySelectorAll('[data-granularity]').forEach((btn) => {
      btn.addEventListener('click', () => {
        granularity = btn.dataset.granularity;
        load();
      });
    });

    content.querySelectorAll('[data-due-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dueTab = btn.dataset.dueTab;
        renderView(data);
      });
    });

    content.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => goTo(btn.dataset.goto));
    });

    // OS VENCIMENTOS DA ABA, NA LISTA (fase EI). As janelas das abas daqui
    // (hoje, amanhã, hoje..+6, hoje..+29, só em aberto) são as mesmas dos
    // atalhos de Vencimento de Lançamentos — a lista abre com os mesmos N
    // títulos que o painel contou. lancamentos.js lê state.financeFilters
    // uma vez, na entrada.
    content.querySelectorAll('[data-ver-vencimentos]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const periodo = { hoje: 'hoje', amanha: 'amanha', proximos7: '7dias', proximos30: '30dias' }[dueTab];
        state.financeFilters = { status: 'pendente,vencido,parcial', periodo: periodo || '' };
        goTo('lancamentos');
      });
    });

    // A linha abre O lançamento clicado (fase EI), e não a lista na página 1:
    // é o contrato que Extrato e NF-e Emitidas já usam — lancamentos.js lê
    // state.financeOpenEntryId e abre o modal dele, buscando pelo id.
    content.querySelectorAll('.finance-clickable-row').forEach((row) => {
      row.addEventListener('click', () => {
        if (row.dataset.entryId) state.financeOpenEntryId = row.dataset.entryId;
        goTo('lancamentos');
      });
    });
  }

  function renderView(data, preserveCustomInputs) {
    const ap = data.contasAPagar || {};
    const ar = data.contasAReceber || {};
    // Cada aba chega como { itens, quantidade, total } (fase EI): os dez que
    // vencem primeiro e o tamanho da aba inteira. A lista solta é o formato de
    // antes, aceito para a tela não ficar vazia com o servidor velho.
    const dueBucket = (data.proximosVencimentos && data.proximosVencimentos[dueTab]) || {};
    const dueList = Array.isArray(dueBucket) ? dueBucket : (dueBucket.itens || []);
    const dueQuantidade = Array.isArray(dueBucket) ? dueBucket.length : Number(dueBucket.quantidade || dueList.length);
    const dueTotal = Array.isArray(dueBucket)
      ? dueBucket.reduce((soma, item) => soma + Number(item.amount || 0), 0)
      : Number(dueBucket.total || 0);

    // "ÚLTIMOS LANÇAMENTOS" SEM ROLAR DE LADO (fase EI).
    //
    // `.table td` é nowrap, e uma descrição do Viper (até 220 caracteres)
    // levava a tabela a 2.074 px. Só cortar o texto não bastou: com descrição
    // e cliente em 14rem cada, as 8 colunas ainda davam 1.118 px, contra 835 px
    // de meio painel em 1920 (Chrome headless, app.css de 13/10/2026) — Valor e
    // Situação continuavam fora da vista. Por isso, duas mudanças de layout:
    //
    //   1. a tabela do resumo tem 6 colunas: o cliente/fornecedor vai numa
    //      segunda linha da descrição, menor (os dois cortados, texto inteiro
    //      no `title`), e a Data de lançamento saiu — quem precisa dela tem a
    //      lista completa a um clique, e no resumo o que se usa é o
    //      Vencimento. Fica em 778 px no pior caso medido ("Transferência",
    //      R$ 1.234.567,89, "Cancelado");
    //   2. os dois painéis só ficam lado a lado quando cada um tem pelo menos
    //      54rem (864 px = 778 da tabela + 46 de respiro e borda + 40 de folga
    //      para outra fonte). Abaixo disso empilham e a tabela ganha a largura
    //      inteira. Medido: lado a lado de 1905 px de janela para cima (no
    //      limite, 820 px visíveis para os 778); 1920 com a barra secundária,
    //      1680, 1536, 1366, 1280 e 1024 empilham, e a tabela cabe inteira em
    //      todos. `min(100%, ...)` deixa o celular numa coluna só (lá a tabela
    //      rola dentro da própria caixa, como toda .table, e a página não).
    //
    // Se uma coluna voltar para esta tabela, refaça a conta dos 54rem.
    //
    // Em "Próximos vencimentos", a lista leva `minmax(0, 1fr)`: a coluna
    // implícita da grade é `auto` e não encolhe abaixo da descrição cortada
    // (22rem) mais o valor. Num celular (500 px, medido) o item ia a 549 px e
    // a PÁGINA inteira rolava de lado; assim ele cabe e a descrição vira "…".
    content.innerHTML = `
      <div class="finance-actions-row" style="justify-content: space-between; align-items: center;">
        <div class="finance-actions-row" style="margin-bottom: 0;">
          <button type="button" data-goto="novo_lancamento">+ Novo Lançamento</button>
          <button type="button" class="secondary" data-goto="lancamentos">Ver Lançamentos</button>
          <button type="button" class="secondary" data-goto="nfe_emitidas">Ver NF-e</button>
          <button type="button" class="secondary" data-goto="extrato_open_finance">Ver Extrato</button>
        </div>
        <span class="finance-live-badge"><span class="finance-live-dot"></span><span id="financeLiveBadgeText">Atualizado agora</span></span>
      </div>

      <div class="panel">
        <div class="finance-toolbar">
          <div class="finance-period-group" role="tablist">
            ${FINANCE_PERIOD_OPTIONS.map((opt) => `<button type="button" class="finance-pill ${period === opt.key ? 'active' : ''}" data-period="${opt.key}">${opt.label}</button>`).join('')}
          </div>
          ${period === 'custom' ? `
            <div class="finance-custom-range">
              <label>De <input type="date" id="financeCustomFrom" value="${escapeHtml(customFrom)}" /></label>
              <label>Até <input type="date" id="financeCustomTo" value="${escapeHtml(customTo)}" /></label>
              <button type="button" class="secondary" id="financeCustomApply">Aplicar</button>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'blue', label: 'Saldo atual', value: financeFormatBRL(data.saldoAtual) })}
        ${financeStatCard({
          tone: 'red',
          label: 'Contas a pagar',
          value: financeFormatBRL(ap.total),
          badge: ap.vencidas > 0 ? 'Vencido' : '',
          sub: `${financeStatSubRow('danger', 'Vencidas', ap.vencidas)}${financeStatSubRow('warning', 'A vencer', ap.aVencer)}`
        })}
        ${financeStatCard({
          tone: 'green',
          label: 'Contas a receber',
          value: financeFormatBRL(ar.total),
          sub: `${financeStatSubRow('danger', 'Vencidas', ar.vencidas)}${financeStatSubRow('success', 'A receber', ar.aReceber)}`
        })}
        ${financeStatCard({ tone: 'green', label: 'Receitas', value: financeFormatBRL(data.receitas) })}
        ${financeStatCard({ tone: 'red', label: 'Despesas', value: financeFormatBRL(data.despesas) })}
        ${financeStatCard({
          tone: 'purple',
          label: 'Resultado',
          value: financeFormatBRL(data.resultado),
          delta: typeof data.resultadoDeltaPercent === 'number' ? `
            <span class="finance-stat-delta ${data.resultadoDeltaPercent >= 0 ? 'up' : 'down'}">
              ${data.resultadoDeltaPercent >= 0 ? '▲' : '▼'} ${Math.abs(data.resultadoDeltaPercent).toFixed(0)}% vs. período anterior
            </span>
          ` : ''
        })}
        ${financeStatCard({ tone: 'cyan', label: 'Previsão', value: financeFormatBRL(data.previsaoFinanceira) })}
        ${financeStatCard({
          tone: 'teal',
          label: 'NF-e emitidas',
          // Fase EI: a contagem vem do banco (todas as autorizadas, sem
          // período — o cartão diz isso). null = a contagem não veio: "—", e
          // não um 0 que pareceria número de verdade.
          value: typeof data.totalNfesEmitidas === 'number' ? data.totalNfesEmitidas.toLocaleString('pt-BR') : '—',
          sub: '<span class="finance-stat-sub-row muted">Autorizadas · todas as datas</span>'
        })}
        ${financeStatCard({
          tone: 'purple',
          label: 'Movimentações',
          value: String((data.movimentacoesBancarias && data.movimentacoesBancarias.total) || 0),
          sub: (data.movimentacoesBancarias && data.movimentacoesBancarias.naoConciliado) ? `<span class="finance-stat-sub-row warning">Não conciliadas: ${data.movimentacoesBancarias.naoConciliado}</span>` : ''
        })}
      </div>

      <div class="panel finance-panel-stripe-chart">
        <div class="finance-chart-head">
          <h3>Fluxo financeiro</h3>
          <div class="finance-granularity-group" role="tablist">
            ${FINANCE_GRANULARITY_OPTIONS.map((opt) => `<button type="button" class="finance-pill finance-pill-sm ${granularity === opt.key ? 'active' : ''}" data-granularity="${opt.key}">${opt.label}</button>`).join('')}
          </div>
        </div>
        <div class="finance-chart-legend">
          <span><i class="finance-legend-dot finance-legend-receita"></i> Receitas</span>
          <span><i class="finance-legend-dot finance-legend-despesa"></i> Despesas</span>
          <span><i class="finance-legend-line"></i> Saldo</span>
        </div>
        <div class="finance-chart-wrap">
          ${financeBuildChartSvg(data.chartSeries || [], escapeHtml)}
        </div>
      </div>

      <div class="row" style="align-items: start; grid-template-columns: repeat(auto-fit, minmax(min(100%, 54rem), 1fr));">
        <div class="panel finance-panel-stripe-due">
          <h3>Próximos vencimentos</h3>
          <div class="finance-due-tabs" role="tablist">
            ${FINANCE_DUE_TABS.map((tab) => `<button type="button" class="finance-pill finance-pill-sm ${dueTab === tab.key ? 'active' : ''}" data-due-tab="${tab.key}">${tab.label}</button>`).join('')}
          </div>
          ${dueQuantidade ? `<p class="muted" style="margin: 10px 0 0;">${dueQuantidade.toLocaleString('pt-BR')} ${dueQuantidade === 1 ? 'título' : 'títulos'} · ${financeFormatBRL(dueTotal)} em aberto</p>` : ''}
          <div class="finance-due-list" style="grid-template-columns: minmax(0, 1fr);">
            ${dueList.length ? dueList.map((item) => `
              <div class="finance-due-item finance-clickable-row" data-entry-id="${escapeHtml(item.id || '')}">
                <div style="min-width: 0; flex: 1;">
                  <strong class="texto-cortado" title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || '-')}</strong>
                  <div class="muted texto-cortado" title="${escapeHtml(item.clienteFornecedor || '')}">${escapeHtml(item.clienteFornecedor || '-')}</div>
                  <div class="muted">Vencimento: ${financeFormatDate(item.dueDate)}</div>
                </div>
                <div class="finance-due-item-amount">
                  ${financeFormatBRL(item.amount)}
                  ${financeStatusBadge(item.status)}
                </div>
              </div>
            `).join('') : '<p class="muted">Nenhum vencimento nesse intervalo.</p>'}
          </div>
          ${dueQuantidade > dueList.length ? `
            <div class="finance-actions-row" style="margin: 10px 0 0; align-items: center;">
              <span class="muted">Mostrando os ${dueList.length} que vencem primeiro, de ${dueQuantidade.toLocaleString('pt-BR')}.</span>
              <button type="button" class="secondary" data-ver-vencimentos>Ver os ${dueQuantidade.toLocaleString('pt-BR')} em Lançamentos</button>
            </div>
          ` : ''}
        </div>

        <div class="panel finance-panel-stripe-entries">
          <div class="finance-chart-head">
            <h3>Últimos lançamentos</h3>
            <button type="button" class="secondary" data-goto="lancamentos">Ver todos</button>
          </div>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Código</th><th>Descrição · Cliente/Fornecedor</th><th>Tipo</th><th>Vencimento</th><th class="col-valor">Valor</th><th>Situação</th></tr></thead>
              <tbody>
                ${(data.ultimosLancamentos || []).length ? data.ultimosLancamentos.map((entry) => `
                  <tr class="cadastro-row-clickable finance-clickable-row" data-entry-id="${escapeHtml(entry.id || '')}">
                    <td>${escapeHtml(entry.codigo || '-')}</td>
                    <td>
                      <span class="texto-cortado is-curto" title="${escapeHtml(entry.description || '')}">${escapeHtml(entry.description || '-')}</span>
                      <small class="texto-cortado is-curto muted" title="${escapeHtml(entry.clienteFornecedor || '')}">${escapeHtml(entry.clienteFornecedor || '-')}</small>
                    </td>
                    <td>${escapeHtml(FINANCE_TYPE_LABEL[entry.type] || entry.type || '-')}</td>
                    <td>${financeFormatDate(entry.dueDate)}</td>
                    <td class="col-valor">${financeFormatBRL(entry.amount)}</td>
                    <td>${financeStatusBadge(entry.status)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="6" class="muted">Nenhum lançamento registrado ainda.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    attachHandlers(data);

    if (preserveCustomInputs) {
      const fromInput = document.getElementById('financeCustomFrom');
      const toInput = document.getElementById('financeCustomTo');
      if (fromInput) fromInput.value = customFrom;
      if (toInput) toInput.value = customTo;
    }
  }

  async function load() {
    const params = new URLSearchParams({ period, granularity });
    if (period === 'custom') {
      if (customFrom) params.set('from', customFrom);
      if (customTo) params.set('to', customTo);
    }
    const minha = ++carga;
    carregando = true;
    try {
      const data = await api(`/api/finance/summary?${params.toString()}`);
      if (minha !== carga) return; // chegou depois de uma carga mais nova: descarta
      lastLoadedAt = Date.now();
      renderView(data);
      agendarTick();
    } catch (error) {
      if (minha !== carga) return;
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar o dashboard financeiro: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
    } finally {
      if (minha === carga) carregando = false;
    }
  }

  await load();
};
