window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

window.MavisSubscreenRegistry.purchases.suppliers = async function renderPurchasesSuppliers(ctx) {
  const { content, data, escapeHtml } = ctx;

  const suppliers = [...new Map(data.purchases.map((purchase) => [purchase.supplier, { name: purchase.supplier, purchases: 0, total: 0 }])).values()];
  data.purchases.forEach((purchase) => {
    const supplier = suppliers.find((entry) => entry.name === purchase.supplier);
    if (supplier) {
      supplier.purchases += 1;
      supplier.total += Number(purchase.total || 0);
    }
  });

  content.innerHTML = `
    <div class="panel">
      <h3>Fornecedores</h3>
      <table class="table">
        <thead><tr><th>Fornecedor</th><th>Compras</th><th>Total</th></tr></thead>
        <tbody>
          ${suppliers.map((supplier) => `<tr><td>${escapeHtml(supplier.name)}</td><td>${supplier.purchases}</td><td>R$ ${supplier.total.toFixed(2)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
};
