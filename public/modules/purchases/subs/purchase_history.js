window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

window.MavisSubscreenRegistry.purchases.purchase_history = async function renderPurchasesHistory(ctx) {
  const { content, data, escapeHtml } = ctx;

  content.innerHTML = `
    <div class="panel">
      <h3>Historico de compras</h3>
      <table class="table">
        <thead><tr><th>ID</th><th>Fornecedor</th><th>Data</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          ${data.purchases.map((purchase) => `<tr><td>${escapeHtml(purchase.id)}</td><td>${escapeHtml(purchase.supplier)}</td><td>${escapeHtml(purchase.date)}</td><td>R$ ${Number(purchase.total || 0).toFixed(2)}</td><td>${escapeHtml(purchase.status)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
};
