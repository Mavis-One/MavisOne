window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.products = async function renderStockProducts(ctx) {
  const { content, data, api, showToast, loadModule, confirmModal, escapeHtml } = ctx;

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
          <label>Preço de venda<input name="salePrice" type="number" step="0.01" required value="0" /></label>
        </div>
        <button type="submit">Salvar produto</button>
      </form>
    </div>
    <div class="panel">
      <h3>Estoque atual</h3>
      <table class="table table-actions">
        <thead><tr><th>Produto</th><th>SKU</th><th>Estoque</th><th>Custo</th><th>Venda</th><th>Ações</th></tr></thead>
        <tbody>
          ${data.products.map((product) => `
            <tr>
              <td>${escapeHtml(product.name)}</td>
              <td>${escapeHtml(product.sku)}</td>
              <td>${escapeHtml(String(product.stockQuantity))}</td>
              <td>R$ ${Number(product.costPrice || 0).toFixed(2)}</td>
              <td>R$ ${Number(product.salePrice || 0).toFixed(2)}</td>
              <td>
                <button type="button" class="icon-button edit" data-edit="${escapeHtml(product.id)}" title="Editar produto" aria-label="Editar produto">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
                <button type="button" class="icon-button" data-delete="${escapeHtml(product.id)}" title="Excluir produto" aria-label="Excluir produto">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </td>
            </tr>
          `).join('')}
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

  function closeEditModal() {
    document.getElementById('stockEditModal')?.remove();
  }

  document.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const product = data.products.find((item) => item.id === btn.dataset.edit);
      if (!product) return;
      closeEditModal();
      const overlay = document.createElement('div');
      overlay.id = 'stockEditModal';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h3>Editar produto</h3>
          <form id="stockEditForm" class="form-grid">
            <div class="row">
              <label>Nome<input name="name" required value="${escapeHtml(product.name)}" /></label>
              <label>SKU<input name="sku" required value="${escapeHtml(product.sku)}" /></label>
            </div>
            <div class="row">
              <label>Estoque<input name="stockQuantity" type="number" required value="${Number(product.stockQuantity || 0)}" /></label>
              <label>Custo<input name="costPrice" type="number" step="0.01" required value="${Number(product.costPrice || 0).toFixed(2)}" /></label>
              <label>Preço de venda<input name="salePrice" type="number" step="0.01" required value="${Number(product.salePrice || 0).toFixed(2)}" /></label>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-muted" id="stockEditCancel">Cancelar</button>
              <button type="submit" class="btn">Salvar</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) closeEditModal(); });
      document.getElementById('stockEditCancel')?.addEventListener('click', closeEditModal);
      document.getElementById('stockEditForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitBtn = event.target.querySelector('button[type="submit"]');
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        const formData = new FormData(event.target);
        try {
          await api('/api/stock', {
            method: 'POST',
            body: JSON.stringify({
              id: product.id,
              name: formData.get('name'),
              sku: formData.get('sku'),
              stockQuantity: Number(formData.get('stockQuantity')),
              costPrice: Number(formData.get('costPrice')),
              salePrice: Number(formData.get('salePrice'))
            })
          });
          showToast('Produto atualizado com sucesso.', 'success');
          closeEditModal();
          loadModule('stock');
        } catch (error) {
          showToast(error.message || 'Erro ao atualizar produto.', 'error');
          submitBtn.disabled = false;
        }
      });
    });
  });

  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const product = data.products.find((item) => item.id === btn.dataset.delete);
      const confirmed = await confirmModal(`Confirma excluir o produto "${product ? product.name : btn.dataset.delete}"? Essa ação não pode ser desfeita.`);
      if (!confirmed) return;
      try {
        await api(`/api/stock/${btn.dataset.delete}`, { method: 'DELETE' });
        showToast('Produto excluído com sucesso.', 'success');
        loadModule('stock');
      } catch (error) {
        showToast(error.message || 'Erro ao excluir produto.', 'error');
      }
    });
  });
};
