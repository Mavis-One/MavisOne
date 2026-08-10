window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

const PURCHASE_STATUS_META = {
  pendente: { label: 'Pendente', tone: 'warning' },
  recebida: { label: 'Recebida', tone: 'success' },
  cancelada: { label: 'Cancelada', tone: 'danger' }
};

function purchaseStatusBadge(status) {
  const meta = PURCHASE_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

window.MavisSubscreenRegistry.purchases.purchase_history = async function renderPurchasesHistory(ctx) {
  const { content, api, showToast, loadModule, confirmModal, escapeHtml } = ctx;

  async function load() {
    let result;
    try {
      result = await api('/api/purchases');
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar compras: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView(result.purchases || []);
  }

  function renderView(purchases) {
    content.innerHTML = `
      <div class="panel">
        <h3>Histórico de Compras</h3>
        <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>ID</th><th>Fornecedor</th><th>Data</th><th>Total</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              ${purchases.length ? purchases.map((purchase) => `
                <tr>
                  <td>${escapeHtml(purchase.id)}</td>
                  <td>${escapeHtml(purchase.supplier)}</td>
                  <td>${escapeHtml(purchase.date)}</td>
                  <td>R$ ${Number(purchase.total || 0).toFixed(2)}</td>
                  <td>${purchaseStatusBadge(purchase.status)}</td>
                  <td class="finance-extrato-actions">
                    ${purchase.status === 'pendente' ? `
                      <button type="button" class="secondary" data-receber="${escapeHtml(purchase.id)}">Marcar recebida</button>
                      <button type="button" class="secondary" data-cancelar="${escapeHtml(purchase.id)}">Cancelar</button>
                    ` : '<span class="muted">-</span>'}
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="6" class="muted">Nenhuma compra registrada ainda.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.querySelectorAll('[data-receber]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/purchases/${btn.dataset.receber}`, { method: 'PUT', body: JSON.stringify({ status: 'recebida' }) });
          showToast('Compra marcada como recebida.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao atualizar compra.', 'error');
        }
      });
    });

    document.querySelectorAll('[data-cancelar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal('Confirma cancelar esta compra? O estoque somado por ela será estornado, e o lançamento financeiro pendente será cancelado.');
        if (!confirmed) return;
        try {
          await api(`/api/purchases/${btn.dataset.cancelar}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelada' }) });
          showToast('Compra cancelada.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao cancelar compra.', 'error');
        }
      });
    });
  }

  await load();
};
