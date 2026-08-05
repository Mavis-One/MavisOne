window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

window.MavisSubscreenRegistry.purchases.new_purchase = async function renderPurchasesNew(ctx) {
  const { content, data, api, showToast, state, renderApp, loadModule, escapeHtml } = ctx;
  const directory = data.directory || [];

  content.innerHTML = `
    <div class="panel">
      <h3>Nova compra</h3>
      <form id="purchaseForm" class="form-grid">
        <div class="row">
          <label>Fornecedor
            ${renderSearchableSelect({ id: 'purchaseSupplier', name: 'supplierId', options: directory.map((entry) => ({ value: entry.id, label: entry.name })), placeholder: 'Buscar fornecedor cadastrado...' })}
          </label>
          <label>Data<input name="date" type="date" /></label>
        </div>
        <div class="row">
          <label>Produto<select name="productId" id="purchaseProductSelect">${data.products.map((product) => `<option value="${product.id}" data-cost-price="${Number(product.costPrice || 0)}">${escapeHtml(product.name)}</option>`).join('')}</select></label>
          <label>Quantidade<input name="quantity" type="number" min="1" required value="1" /></label>
          <label>Custo unitário<input name="costPrice" id="purchaseCostPriceInput" type="number" step="0.01" required value="${Number(data.products[0]?.costPrice || 0).toFixed(2)}" /></label>
        </div>
        <button type="submit">Registrar compra</button>
      </form>
    </div>
  `;

  attachSearchableSelect({ id: 'purchaseSupplier', options: directory.map((entry) => ({ value: entry.id, label: entry.name })) });

  document.getElementById('purchaseProductSelect')?.addEventListener('change', (event) => {
    const selectedOption = event.target.selectedOptions[0];
    const costPriceInput = document.getElementById('purchaseCostPriceInput');
    if (selectedOption && costPriceInput) {
      costPriceInput.value = Number(selectedOption.dataset.costPrice || 0).toFixed(2);
    }
  });

  document.getElementById('purchaseForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const supplierId = document.getElementById('purchaseSupplierValue')?.value || '';
    const supplierName = document.getElementById('purchaseSupplierInput')?.value || '';
    if (!supplierId && !supplierName.trim()) {
      showToast('Informe o fornecedor.', 'warning');
      return;
    }
    try {
      await api('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId,
          supplier: supplierName,
          date: formData.get('date'),
          productId: formData.get('productId'),
          quantity: Number(formData.get('quantity')),
          costPrice: Number(formData.get('costPrice'))
        })
      });
      showToast('Compra registrada com sucesso.', 'success');
      state.activeSub = 'purchase_history';
      renderApp();
      loadModule('purchases');
    } catch (error) {
      showToast(error.message || 'Erro ao registrar compra.', 'error');
    }
  });
};
