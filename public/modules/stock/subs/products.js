window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.products = async function renderStockProducts(ctx) {
  const { content, data, api, showToast, loadModule } = ctx;

  content.innerHTML = `
    <div class="panel">
      <h3>Novo produto</h3>
      <form id="stockForm" class="form-grid">
        <div class="row">
          <label>Nome<input name="name" required /></label>
          <label>SKU<input name="sku" required /></label>
        </div>
        <div class="row">
          <label>Estoque inicial<input name="stockQuantity" type="number" required value="0" /></label>
          <label>Custo<input name="costPrice" type="number" step="0.01" required value="0" /></label>
          <label>Preco de venda<input name="salePrice" type="number" step="0.01" required value="0" /></label>
        </div>
        <button type="submit">Salvar produto</button>
      </form>
    </div>
    <div class="panel">
      <h3>Estoque atual</h3>
      <table class="table">
        <thead><tr><th>Produto</th><th>SKU</th><th>Estoque</th><th>Custo</th><th>Venda</th></tr></thead>
        <tbody>
          ${data.products.map((product) => `<tr><td>${product.name}</td><td>${product.sku}</td><td>${product.stockQuantity}</td><td>R$ ${product.costPrice}</td><td>R$ ${product.salePrice}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('stockForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      await api('/api/stock', {
        method: 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          sku: formData.get('sku'),
          stockQuantity: Number(formData.get('stockQuantity')),
          costPrice: Number(formData.get('costPrice')),
          salePrice: Number(formData.get('salePrice'))
        })
      });
      showToast('Produto salvo com sucesso.', 'success');
      loadModule('stock');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar produto.', 'error');
    }
  });
};
