window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// CONTAGEM DE ESTOQUE (fase CU).
//
// A lista das folhas. Uma contagem aberta é uma lista de leituras e não mexeu
// em saldo nenhum; fechada, ela gerou os movimentos de ajuste.
//
// É a MESMA tela para duas coisas que o raio-X pedia separadas:
//   carga do estoque inicial (VM-EST-08) — contagem contra saldo anterior zero
//   inventário cíclico       (VM-EST-04) — contagem contra o saldo do sistema
// Não há diferença de mecanismo entre as duas, só de quanto o sistema já sabia.
window.MavisSubscreenRegistry.stock.counts = async function renderStockCounts(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const filters = { status: '', depositId: '' };

  const STATUS_SELO = {
    aberta: ['Aberta', 'warning'],
    fechada: ['Fechada', 'success'],
    cancelada: ['Cancelada', 'muted']
  };

  function nomeDoDeposito(id) {
    const achado = (meta.deposits || []).find((d) => d.id === id);
    return achado ? achado.name : '(depósito removido)';
  }

  async function fetchCounts() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    try {
      const res = await api(`/api/stock/counts?${params.toString()}`);
      return res.counts || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar contagens.', 'error');
      return [];
    }
  }

  function abrir(id) {
    state.stockCountId = id;
    state.activeSub = 'new_count';
    loadModule('stock');
  }

  async function render() {
    const counts = await fetchCounts();
    const abertas = counts.filter((c) => c.status === 'aberta').length;
    const fechadas = counts.filter((c) => c.status === 'fechada');
    // ACURACIDADE = itens que o sistema acertou / itens contados, sobre as
    // contagens FECHADAS. As abertas ficam de fora porque ainda podem mudar, e
    // misturá-las faria o número oscilar enquanto alguém digita no galpão.
    const itensFechados = fechadas.reduce((s, c) => s + Number(c.itens || 0), 0);
    const divergentes = fechadas.reduce((s, c) => s + Number(c.divergentes || 0), 0);
    const acuracidade = itensFechados > 0
      ? (((itensFechados - divergentes) / itensFechados) * 100).toFixed(1) + '%'
      : '—';

    const semDeposito = (meta.deposits || []).length === 0;

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead(
          'Contagem de Estoque',
          'A folha por depósito. Aberta, não mexe em saldo; fechada, gera os ajustes.',
          '<button type="button" id="countNew">Nova contagem</button>'
        )}
        ${semDeposito ? `
          <p class="muted">
            Nenhum depósito cadastrado. Contagem é de um <strong>lugar</strong> —
            cadastre o depósito primeiro em <strong>Estoque &gt; Novo Depósito</strong>.
          </p>
        ` : ''}
        <form id="countFilters" class="form-grid">
          <div class="row">
            <label>Situação
              <select name="status">
                <option value="">Todas</option>
                <option value="aberta" ${filters.status === 'aberta' ? 'selected' : ''}>Aberta</option>
                <option value="fechada" ${filters.status === 'fechada' ? 'selected' : ''}>Fechada</option>
                <option value="cancelada" ${filters.status === 'cancelada' ? 'selected' : ''}>Cancelada</option>
              </select>
            </label>
            <label>Depósito<select name="depositId">${S.options(meta.deposits, filters.depositId, { empty: 'Todos' })}</select></label>
          </div>
          <div class="finance-actions-row">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="countClear">Limpar</button>
          </div>
        </form>
      </div>

      <div class="row">
        <div class="panel"><strong>${abertas}</strong><p class="muted">Contagens abertas</p></div>
        <div class="panel"><strong>${fechadas.length}</strong><p class="muted">Contagens fechadas</p></div>
        <div class="panel"><strong>${itensFechados.toLocaleString('pt-BR')}</strong><p class="muted">Itens conferidos</p></div>
        <!-- O que o SISTEMA acertou, nao o que a contagem acertou: divergencia
             e' o sistema estando errado sobre o galpao. -->
        <div class="panel"><strong>${acuracidade}</strong><p class="muted">Acuracidade do sistema</p></div>
      </div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr><th>Código</th><th>Data</th><th>Depósito</th><th>Situação</th><th>Itens</th><th>Divergentes</th><th>Aberta por</th><th>Fechada por</th><th>Ações</th></tr>
            </thead>
            <tbody>
              ${counts.length === 0 ? S.emptyRow(9, 'Nenhuma contagem registrada.') : counts.map((count) => {
                const selo = STATUS_SELO[count.status] || ['?', 'muted'];
                return `
                  <tr>
                    <td>${S.escape(count.code)}</td>
                    <td>${S.formatDate(count.date)}</td>
                    <td>${S.escape(nomeDoDeposito(count.depositId))}</td>
                    <td>${S.badge(selo[0], selo[1])}</td>
                    <td>${Number(count.itens || 0).toLocaleString('pt-BR')}</td>
                    <td>${Number(count.divergentes || 0) > 0
                      ? S.badge(String(count.divergentes), 'warning')
                      : '<span class="muted">0</span>'}</td>
                    <td>${S.escape(count.createdByName || '-')}</td>
                    <td>${S.escape(count.closedByName || '-')}</td>
                    <td>
                      <button type="button" class="secondary" data-abrir="${S.escape(count.id)}">
                        ${count.status === 'aberta' ? 'Continuar' : 'Ver folha'}
                      </button>
                      ${count.status === 'aberta'
                        ? `<button type="button" class="icon-button" data-cancelar="${S.escape(count.id)}" title="Cancelar contagem">${S.trashIcon}</button>`
                        : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:12px;">
          ${counts.length} contagem(ns). Contagem fechada não volta atrás por aqui — o que se
          estorna é o movimento que ela gerou, em <strong>Movimentações</strong>.
        </p>
      </div>
    `;

    document.getElementById('countNew')?.addEventListener('click', () => {
      // Sem id: a tela de folha entende isso como "abrir uma contagem nova".
      state.stockCountId = null;
      state.activeSub = 'new_count';
      loadModule('stock');
    });

    document.getElementById('countFilters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      Object.keys(filters).forEach((k) => { filters[k] = formData.get(k) || ''; });
      render();
    });

    document.getElementById('countClear')?.addEventListener('click', () => {
      Object.keys(filters).forEach((k) => { filters[k] = ''; });
      render();
    });

    content.querySelectorAll('[data-abrir]').forEach((btn) => {
      btn.addEventListener('click', () => abrir(btn.dataset.abrir));
    });

    content.querySelectorAll('[data-cancelar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmado = await confirmModal(
          'Cancelar esta contagem? Ela fica registrada como cancelada — não é excluída,'
          + ' porque andar pelo galpão é trabalho feito e o relatório de acuracidade'
          + ' precisa saber que a contagem existiu.'
        );
        if (!confirmado) return;
        try {
          await api(`/api/stock/counts/${encodeURIComponent(btn.dataset.cancelar)}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'Cancelada na tela de contagens' })
          });
          showToast('Contagem cancelada.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Erro ao cancelar a contagem.', 'error');
        }
      });
    });
  }

  await render();
};
