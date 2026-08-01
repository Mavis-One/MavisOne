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

function financeBuildChartSvg(series, escapeHtml) {
  const width = 760;
  const height = 220;
  const paddingTop = 12;
  const paddingBottom = 26;
  const chartHeight = height - paddingTop - paddingBottom;
  const n = Math.max(series.length, 1);
  const groupWidth = width / n;
  const barWidth = Math.max(4, Math.min(18, groupWidth / 3));
  const maxVal = Math.max(1, ...series.map((s) => Math.max(s.receitas, s.despesas, Math.abs(s.saldo))));

  const bars = series.map((s, i) => {
    const groupX = i * groupWidth;
    const receitaH = (s.receitas / maxVal) * chartHeight;
    const despesaH = (s.despesas / maxVal) * chartHeight;
    const receitaX = groupX + groupWidth / 2 - barWidth - 2;
    const despesaX = groupX + groupWidth / 2 + 2;
    const baseY = paddingTop + chartHeight;
    return `
      <rect x="${receitaX.toFixed(1)}" y="${(baseY - receitaH).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${receitaH.toFixed(1)}" rx="2" class="finance-chart-bar finance-chart-bar-receita"><title>Receitas ${escapeHtml(s.label)}: ${financeFormatBRL(s.receitas)}</title></rect>
      <rect x="${despesaX.toFixed(1)}" y="${(baseY - despesaH).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${despesaH.toFixed(1)}" rx="2" class="finance-chart-bar finance-chart-bar-despesa"><title>Despesas ${escapeHtml(s.label)}: ${financeFormatBRL(s.despesas)}</title></rect>
      <text x="${(groupX + groupWidth / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="finance-chart-label">${escapeHtml(s.label)}</text>
    `;
  }).join('');

  const baseY = paddingTop + chartHeight;
  const linePoints = series.map((s, i) => {
    const x = i * groupWidth + groupWidth / 2;
    const y = baseY - (s.saldo / maxVal) * chartHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="finance-chart-svg" role="img" aria-label="Gráfico de receitas, despesas e saldo">
      <line x1="0" y1="${baseY}" x2="${width}" y2="${baseY}" class="finance-chart-axis"></line>
      ${bars}
      <polyline points="${linePoints}" class="finance-chart-line"></polyline>
    </svg>
  `;
}

window.MavisSubscreenRegistry.finance.dashboard = async function renderFinanceDashboard(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml } = ctx;

  let period = 'month';
  let granularity = 'month';
  let customFrom = '';
  let customTo = '';
  let dueTab = 'proximos7';

  function goTo(sub) {
    state.activeSub = sub;
    loadModule('finance');
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
      <div class="finance-actions-row">
        <button type="button" data-goto="novo_lancamento">+ Novo Lançamento</button>
        <button type="button" class="secondary" data-goto="lancamentos">Ver Lançamentos</button>
        <button type="button" class="secondary" data-goto="nfe_emitidas">Ver NF-e</button>
        <button type="button" class="secondary" data-goto="extrato_open_finance">Ver Extrato</button>
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

      <div class="cards">
        <div class="card"><h3>Saldo atual</h3><p>${financeFormatBRL(data.saldoAtual)}</p></div>
        <div class="card">
          <h3>Contas a pagar</h3><p>${financeFormatBRL(ap.total)}</p>
          <div class="card-sub">
            <span>Vencidas: ${financeFormatBRL(ap.vencidas)}</span>
            <span>A vencer: ${financeFormatBRL(ap.aVencer)}</span>
            <span>Pagas: ${financeFormatBRL(ap.pagas)}</span>
          </div>
        </div>
        <div class="card">
          <h3>Contas a receber</h3><p>${financeFormatBRL(ar.total)}</p>
          <div class="card-sub">
            <span>Vencidas: ${financeFormatBRL(ar.vencidas)}</span>
            <span>A receber: ${financeFormatBRL(ar.aReceber)}</span>
            <span>Recebidas: ${financeFormatBRL(ar.recebidas)}</span>
          </div>
        </div>
        <div class="card"><h3>Receitas (período)</h3><p>${financeFormatBRL(data.receitas)}</p></div>
        <div class="card"><h3>Despesas (período)</h3><p>${financeFormatBRL(data.despesas)}</p></div>
        <div class="card"><h3>Resultado (período)</h3><p class="${data.resultado >= 0 ? 'finance-positive' : 'finance-negative'}">${financeFormatBRL(data.resultado)}</p></div>
        <div class="card"><h3>Previsão financeira</h3><p>${financeFormatBRL(data.previsaoFinanceira)}</p></div>
        <div class="card"><h3>NF-e emitidas</h3><p>${data.totalNfesEmitidas ?? 0}</p></div>
        <div class="card"><h3>Movimentações bancárias</h3><p>${(data.movimentacoesBancarias && data.movimentacoesBancarias.total) || 0}</p><div class="card-sub"><span>Não conciliadas: ${(data.movimentacoesBancarias && data.movimentacoesBancarias.naoConciliado) || 0}</span></div></div>
      </div>

      <div class="panel">
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
        <div class="panel">
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

        <div class="panel">
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
      renderView(data);
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar o dashboard financeiro: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
    }
  }

  await load();
};
