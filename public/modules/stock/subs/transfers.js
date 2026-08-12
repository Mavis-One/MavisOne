window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// "Entre Depósitos": cada transferência gera duas movimentações (saída na
// origem, entrada no destino), então o saldo total do produto não muda.
window.MavisSubscreenRegistry.stock.transfers = async function renderTransfers(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);
  const filters = { search: '', productId: '', depositId: '' };

  async function fetchTransfers() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const res = await api(`/api/stock/transfers?${params.toString()}`);
      return res.transfers || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar transferências.', 'error');
      return [];
    }
  }

  async function render() {
    const transfers = await fetchTransfers();
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Entre Depósitos', 'Transferências de saldo entre depósitos.', '<button type="button" id="transferNew">Nova transferência</button>')}
        <form id="transferFilters" class="form-grid">
          <div class="row">
            <label>Buscar<input type="search" name="search" value="${S.escape(filters.search)}" placeholder="Código, produto ou observação" /></label>
            <label>Produto<select name="productId">${S.options(meta.products, filters.productId, { empty: 'Todos' })}</select></label>
            <label>Depósito (origem ou destino)<select name="depositId">${S.options(meta.deposits, filters.depositId, { empty: 'Todos' })}</select></label>
          </div>
          <div class="finance-actions-row">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="transferClear">Limpar</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr><th>Código</th><th>Data</th><th>Produto</th><th>Origem</th><th>Destino</th><th>Qtd.</th><th>Observação</th><th>Usuário</th><th>Ações</th></tr>
            </thead>
            <tbody>
              ${transfers.length === 0 ? S.emptyRow(9, 'Nenhuma transferência registrada.') : transfers.map((transfer) => `
                <tr>
                  <td>${S.escape(transfer.code)}</td>
                  <td>${S.formatDate(transfer.date)}</td>
                  <td>${S.escape(transfer.productName)}${transfer.productSku ? ` <span class="muted">(${S.escape(transfer.productSku)})</span>` : ''}${S.corBadge(cores, transfer.classValueId)}</td>
                  <td>${S.escape(transfer.originDepositName || '-')}</td>
                  <td>${S.escape(transfer.destinationDepositName || '-')}</td>
                  <td>${S.formatQty(transfer.quantity)}</td>
                  <td>${S.escape(transfer.note || '-')}</td>
                  <td>${S.escape(transfer.createdByName || '-')}</td>
                  <td><button type="button" class="icon-button" data-delete="${transfer.id}" title="Estornar">${S.trashIcon}</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:12px;">${transfers.length} transferência(s).</p>
      </div>
    `;

    document.getElementById('transferNew')?.addEventListener('click', () => {
      state.activeSub = 'new_transfer';
      loadModule('stock');
    });

    document.getElementById('transferFilters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      Object.keys(filters).forEach((key) => { filters[key] = formData.get(key) || ''; });
      render();
    });

    document.getElementById('transferClear')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      render();
    });

    content.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal('Estornar esta transferência? As duas movimentações geradas serão removidas.');
        if (!confirmed) return;
        try {
          await api(`/api/stock/transfers/${btn.dataset.delete}`, { method: 'DELETE' });
          showToast('Transferência estornada.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Erro ao estornar transferência.', 'error');
        }
      });
    });
  }

  await render();
};
