window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

const STOCK_MOVEMENT_TYPE_META = {
  compra: { label: 'Compra', tone: 'success' },
  venda: { label: 'Venda', tone: 'danger' },
  estorno: { label: 'Estorno', tone: 'info' },
  ajuste: { label: 'Ajuste', tone: 'muted' }
};

function stockMovementBadge(type) {
  const meta = STOCK_MOVEMENT_TYPE_META[type] || { label: type || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

function stockMovementFormatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

window.MavisSubscreenRegistry.stock.movements = async function renderStockMovements(ctx) {
  const { content, data, api, showToast, escapeHtml } = ctx;

  let productFilter = '';

  async function load() {
    let result;
    try {
      const query = productFilter ? `?productId=${encodeURIComponent(productFilter)}` : '';
      result = await api(`/api/stock/movements${query}`);
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar movimentos: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView(result.movements || []);
  }

  function renderView(movements) {
    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Movimentos de estoque</h3>
          <p class="muted">Histórico de entradas e saídas — compras, vendas faturadas e estornos.</p>
        </div>
        <div class="cadastro-list-actions">
          <label class="cadastro-field" style="margin:0;">
            <select id="movementsProductFilter">
              <option value="">Todos os produtos</option>
              ${data.products.map((p) => `<option value="${p.id}" ${productFilter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="secondary" id="movementsRefreshBtn">Atualizar</button>
        </div>
      </div>
      <div class="panel">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Referência</th><th>Nota</th><th>Usuário</th></tr></thead>
            <tbody>
              ${movements.length ? movements.map((m) => `
                <tr>
                  <td>${stockMovementFormatDateTime(m.createdAt)}</td>
                  <td>${escapeHtml(m.productName || m.productId)}</td>
                  <td>${stockMovementBadge(m.type)}</td>
                  <td class="${m.quantityDelta >= 0 ? 'finance-positive' : 'finance-negative'}">${m.quantityDelta >= 0 ? '+' : ''}${m.quantityDelta}</td>
                  <td>${escapeHtml(m.referenceType || '-')}</td>
                  <td>${escapeHtml(m.note || '-')}</td>
                  <td>${escapeHtml(m.createdByName || '-')}</td>
                </tr>
              `).join('') : `<tr><td colspan="7" class="muted">Nenhuma movimentação registrada${productFilter ? ' para este produto' : ''} ainda.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('movementsRefreshBtn')?.addEventListener('click', load);
    document.getElementById('movementsProductFilter')?.addEventListener('change', (event) => {
      productFilter = event.target.value;
      load();
    });
  }

  await load();
};
