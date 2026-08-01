window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.movements = async function renderStockMovements(ctx) {
  const { content, data, escapeHtml } = ctx;

  content.innerHTML = `
    <div class="panel">
      <h3>Movimentos de estoque</h3>
      <table class="table">
        <thead><tr><th>Produto</th><th>SKU</th><th>Estoque atual</th><th>Custo</th><th>Venda</th></tr></thead>
        <tbody>
          ${data.products.map((product) => `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.sku)}</td><td>${escapeHtml(String(product.stockQuantity))}</td><td>R$ ${Number(product.costPrice || 0).toFixed(2)}</td><td>R$ ${Number(product.salePrice || 0).toFixed(2)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
};
