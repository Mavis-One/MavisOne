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

function financeStatusBadge(status) {
  const meta = FINANCE_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
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

window.MavisSubscreenRegistry.finance.dashboard = async function renderFinanceDashboard(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml } = ctx;

  let period = 'month';
  let granularity = 'month';
  let customFrom = '';
  let customTo = '';
  let dueTab = 'proximos7';
  let lastLoadedAt = Date.now();
  const AUTO_REFRESH_MS = 60000;

  function goTo(sub) {
    state.activeSub = sub;
    loadModule('finance');
  }

  function tickLiveBadge() {
    const badge = document.getElementById('financeLiveBadgeText');
    if (!badge || !document.body.contains(badge)) return; // usuário navegou pra outra tela: para o timer
    const elapsedS = Math.round((Date.now() - lastLoadedAt) / 1000);
    if (elapsedS * 1000 >= AUTO_REFRESH_MS) {
      load();
      return;
    }
    const nextInS = Math.max(0, Math.round((AUTO_REFRESH_MS - elapsedS * 1000) / 1000));
    badge.textContent = `Atualizado há ${elapsedS}s · próxima em ${nextInS}s`;
    setTimeout(tickLiveBadge, 1000);
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

    content.querySelectorAll('.finance-clickable-row').forEach((row) => {
      row.addEventListener('click', () => goTo('lancamentos'));
    });
  }

  function renderView(data, preserveCustomInputs) {
    const ap = data.contasAPagar || {};
    const ar = data.contasAReceber || {};
    const dueList = (data.proximosVencimentos && data.proximosVencimentos[dueTab]) || [];

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
        ${financeStatCard({ tone: 'teal', label: 'NF-e emitidas', value: String(data.totalNfesEmitidas ?? 0) })}
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

      <div class="row" style="align-items: start;">
        <div class="panel finance-panel-stripe-due">
          <h3>Próximos vencimentos</h3>
          <div class="finance-due-tabs" role="tablist">
            ${FINANCE_DUE_TABS.map((tab) => `<button type="button" class="finance-pill finance-pill-sm ${dueTab === tab.key ? 'active' : ''}" data-due-tab="${tab.key}">${tab.label}</button>`).join('')}
          </div>
          <div class="finance-due-list">
            ${dueList.length ? dueList.map((item) => `
              <div class="finance-due-item finance-clickable-row">
                <div>
                  <strong>${escapeHtml(item.description || '-')}</strong>
                  <span class="muted"> · ${escapeHtml(item.clienteFornecedor || '-')}</span>
                  <div class="muted">Vencimento: ${financeFormatDate(item.dueDate)}</div>
                </div>
                <div class="finance-due-item-amount">
                  ${financeFormatBRL(item.amount)}
                  ${financeStatusBadge(item.status)}
                </div>
              </div>
            `).join('') : '<p class="muted">Nenhum vencimento nesse intervalo.</p>'}
          </div>
        </div>

        <div class="panel finance-panel-stripe-entries">
          <div class="finance-chart-head">
            <h3>Últimos lançamentos</h3>
            <button type="button" class="secondary" data-goto="lancamentos">Ver todos</button>
          </div>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Código</th><th>Data</th><th>Descrição</th><th>Tipo</th><th>Cliente/Fornecedor</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead>
              <tbody>
                ${(data.ultimosLancamentos || []).length ? data.ultimosLancamentos.map((entry) => `
                  <tr class="cadastro-row-clickable finance-clickable-row">
                    <td>${escapeHtml(String(entry.id).slice(-8))}</td>
                    <td>${financeFormatDate(entry.date)}</td>
                    <td>${escapeHtml(entry.description || '-')}</td>
                    <td>${FINANCE_TYPE_LABEL[entry.type] || entry.type}</td>
                    <td>${escapeHtml(entry.clienteFornecedor || '-')}</td>
                    <td>${financeFormatDate(entry.dueDate)}</td>
                    <td>${financeFormatBRL(entry.amount)}</td>
                    <td>${financeStatusBadge(entry.status)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="8" class="muted">Nenhum lançamento registrado ainda.</td></tr>'}
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
    try {
      const data = await api(`/api/finance/summary?${params.toString()}`);
      lastLoadedAt = Date.now();
      renderView(data);
      setTimeout(tickLiveBadge, 1000);
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar o dashboard financeiro: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
    }
  }

  await load();
};
