window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.movements = async function renderStockMovements(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const filters = { search: '', type: '', productId: '', depositId: '', categoryId: '', dateFrom: '', dateTo: '' };
  let page = 1;
  const limit = 20;

  const eyeIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

  // Escopo da movimentação: só leitura. Movimentação registrada não se edita,
  // se estiver errada o caminho é estornar e lançar de novo.
  function closeDetailModal() {
    document.getElementById('movDetailModal')?.remove();
    document.removeEventListener('keydown', onDetailKeydown);
  }

  function onDetailKeydown(event) {
    if (event.key === 'Escape') closeDetailModal();
  }

  function detailItem(label, value) {
    return `<div><span class="muted">${S.escape(label)}</span><strong>${value}</strong></div>`;
  }

  function openDetailModal(movement) {
    if (!movement) return;
    closeDetailModal();
    const overlay = document.createElement('div');
    overlay.id = 'movDetailModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <h3>Escopo da movimentação ${S.escape(movement.code)}</h3>
        <div class="modal-body">
          <div class="stock-detail-grid">
            ${detailItem('Data', S.formatDate(movement.date))}
            ${detailItem('Tipo', S.badge(movement.type === 'entrada' ? 'Entrada' : 'Saída', movement.type === 'entrada' ? 'success' : 'danger'))}
            ${detailItem('Produto', `${S.escape(movement.productName)}${movement.productSku ? ` <span class="muted">(${S.escape(movement.productSku)})</span>` : ''}`)}
            ${detailItem('Depósito', S.escape(movement.depositName || '-'))}
            ${detailItem('Quantidade', `${movement.type === 'entrada' ? '+' : '-'}${S.formatQty(movement.quantity)}`)}
            ${detailItem('Custo unitário', S.formatBRL(movement.unitCost))}
            ${detailItem('Custo total', S.formatBRL(movement.totalCost))}
            ${detailItem('Categoria', S.escape(movement.categoryName || '-'))}
            ${detailItem('Documento', S.escape(movement.document || '-'))}
            ${detailItem('Origem', movement.transferId ? S.badge('Transferência', 'info') : S.badge(movement.origin === 'saldo-inicial' ? 'Saldo inicial' : 'Manual', 'muted'))}
            ${detailItem('Registrado por', S.escape(movement.createdByName || '-'))}
          </div>
          <label>Observação
            <textarea rows="4" readonly placeholder="Sem observação registrada.">${S.escape(movement.note || '')}</textarea>
          </label>
          <p class="muted" style="margin:8px 0 0;">Somente leitura. Para corrigir, estorne a movimentação e lance novamente.</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-muted" id="movDetailClose">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDetailModal(); });
    document.getElementById('movDetailClose')?.addEventListener('click', closeDetailModal);
    document.addEventListener('keydown', onDetailKeydown);
  }

  async function fetchMovements() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      return await api(`/api/stock/movements?${params.toString()}`);
    } catch (error) {
      showToast(error.message || 'Erro ao carregar movimentações.', 'error');
      return { movements: [], total: 0, page: 1, limit };
    }
  }

  async function render() {
    closeDetailModal();
    const result = await fetchMovements();
    const movements = result.movements || [];
    const totalPages = Math.max(1, Math.ceil((result.total || 0) / limit));
    const entradas = movements.filter((m) => m.type === 'entrada').reduce((s, m) => s + Number(m.quantity), 0);
    const saidas = movements.filter((m) => m.type === 'saida').reduce((s, m) => s + Number(m.quantity), 0);

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Movimentações', 'Entradas e saídas de estoque por depósito.', '<button type="button" id="movNew">Nova movimentação</button>')}
        <form id="movFilters" class="form-grid">
          <div class="row">
            <label>Buscar<input type="search" name="search" value="${S.escape(filters.search)}" placeholder="Código, documento, produto" /></label>
            <label>Tipo
              <select name="type">
                <option value="">Todos</option>
                <option value="entrada" ${filters.type === 'entrada' ? 'selected' : ''}>Entrada</option>
                <option value="saida" ${filters.type === 'saida' ? 'selected' : ''}>Saída</option>
              </select>
            </label>
            <label>Produto<select name="productId">${S.options(meta.products, filters.productId, { empty: 'Todos' })}</select></label>
            <label>Depósito<select name="depositId">${S.options(meta.deposits, filters.depositId, { empty: 'Todos' })}</select></label>
          </div>
          <div class="row">
            <label>Categoria<select name="categoryId">${S.options(meta.movementCategories, filters.categoryId, { empty: 'Todas' })}</select></label>
            <label>De<input type="date" name="dateFrom" value="${filters.dateFrom}" /></label>
            <label>Até<input type="date" name="dateTo" value="${filters.dateTo}" /></label>
          </div>
          <div class="finance-actions-row">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="movClear">Limpar</button>
          </div>
        </form>
      </div>

      <div class="row">
        <div class="panel"><strong>${result.total || 0}</strong><p class="muted">Movimentações no filtro</p></div>
        <div class="panel"><strong>+${S.formatQty(entradas)}</strong><p class="muted">Entradas nesta página</p></div>
        <div class="panel"><strong>-${S.formatQty(saidas)}</strong><p class="muted">Saídas nesta página</p></div>
      </div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr><th>Código</th><th>Data</th><th>Tipo</th><th>Produto</th><th>Depósito</th><th>Qtd.</th><th>Custo unit.</th><th>Categoria</th><th>Documento</th><th>Origem</th><th>Ações</th></tr>
            </thead>
            <tbody>
              ${movements.length === 0 ? S.emptyRow(11, 'Nenhuma movimentação encontrada.') : movements.map((movement) => `
                <tr data-detail="${movement.id}" title="Ver detalhes da movimentação">
                  <td>${S.escape(movement.code)}</td>
                  <td>${S.formatDate(movement.date)}</td>
                  <td>${S.badge(movement.type === 'entrada' ? 'Entrada' : 'Saída', movement.type === 'entrada' ? 'success' : 'danger')}</td>
                  <td>${S.escape(movement.productName)}${movement.productSku ? ` <span class="muted">(${S.escape(movement.productSku)})</span>` : ''}</td>
                  <td>${S.escape(movement.depositName || '-')}</td>
                  <td>${movement.type === 'entrada' ? '+' : '-'}${S.formatQty(movement.quantity)}</td>
                  <td>${S.formatBRL(movement.unitCost)}</td>
                  <td>${S.escape(movement.categoryName || '-')}</td>
                  <td>${S.escape(movement.document || '-')}</td>
                  <td>${movement.transferId ? S.badge('Transferência', 'info') : S.badge(movement.origin === 'saldo-inicial' ? 'Saldo inicial' : 'Manual', 'muted')}</td>
                  <td>
                    <button type="button" class="icon-button" data-detail-btn="${movement.id}" title="Ver observação">${eyeIcon}</button>
                    <button type="button" class="icon-button" data-delete="${movement.id}" title="Estornar" ${movement.transferId ? 'disabled' : ''}>${S.trashIcon}</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="finance-actions-row" style="margin-top:12px; align-items:center;">
          <button type="button" class="secondary finance-pill-sm" id="movPrev" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted">Página ${result.page || 1} de ${totalPages}</span>
          <button type="button" class="secondary finance-pill-sm" id="movNext" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
        </div>
      </div>
    `;

    document.getElementById('movNew')?.addEventListener('click', () => {
      state.activeSub = 'new_movement';
      loadModule('stock');
    });

    document.getElementById('movFilters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      Object.keys(filters).forEach((key) => { filters[key] = formData.get(key) || ''; });
      page = 1;
      render();
    });

    document.getElementById('movClear')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      page = 1;
      render();
    });

    document.getElementById('movPrev')?.addEventListener('click', () => { page = Math.max(1, page - 1); render(); });
    document.getElementById('movNext')?.addEventListener('click', () => { page = Math.min(totalPages, page + 1); render(); });

    content.querySelectorAll('[data-detail]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('button')) return; // deixa os botões de ação passarem
        openDetailModal(movements.find((m) => m.id === row.dataset.detail));
      });
    });

    content.querySelectorAll('[data-detail-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openDetailModal(movements.find((m) => m.id === btn.dataset.detailBtn));
      });
    });

    content.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal('Estornar esta movimentação? O saldo do produto será recalculado.');
        if (!confirmed) return;
        try {
          await api(`/api/stock/movements/${btn.dataset.delete}`, { method: 'DELETE' });
          showToast('Movimentação estornada.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Erro ao estornar movimentação.', 'error');
        }
      });
    });
  }

  await render();
};
