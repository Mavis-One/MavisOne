window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.movements = async function renderStockMovements(ctx) {
  const { content, data } = ctx;

  content.innerHTML = `
    <div class="panel">
      <h3>Movimentos de estoque</h3>
      <table class="table">
        <thead><tr><th>Produto</th><th>SKU</th><th>Estoque atual</th><th>Custo</th><th>Venda</th></tr></thead>
        <tbody>
          ${data.products.map((product) => `<tr><td>${product.name}</td><td>${product.sku}</td><td>${product.stockQuantity}</td><td>R$ ${product.costPrice}</td><td>R$ ${product.salePrice}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
};
