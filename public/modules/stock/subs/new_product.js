window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_product = async function renderNewProduct(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const editId = state.stockEditProductId || null;
  state.stockEditProductId = null;

  let current = null;
  if (editId) {
    try {
      const res = await api(`/api/stock/products/${editId}`);
      current = res.product;
    } catch (error) {
      showToast('Não foi possível carregar o produto para edição.', 'error');
    }
  }

  const value = (key, fallback = '') => S.escape(current ? current[key] ?? fallback : fallback);

  content.innerHTML = `
    <div class="panel">
      ${S.pageHead(current ? 'Editar Produto' : 'Novo Produto', current
        ? 'O saldo não é alterado por aqui — use Nova Movimentação.'
        : 'O estoque inicial vira uma movimentação de entrada no depósito escolhido.')}
      <form id="stockProductForm" class="form-grid">
        <div class="row">
          <label>Nome<input name="name" required value="${value('name')}" /></label>
          <label>SKU<input name="sku" required value="${value('sku')}" /></label>
          <label>Código de barras (EAN)<input name="ean" value="${value('ean')}" /></label>
        </div>
        <div class="row">
          <label>Categoria<select name="categoryId">${S.options(meta.productCategories, current ? current.categoryId : '', { empty: 'Sem categoria' })}</select></label>
          <label>Unidade<input name="unit" value="${value('unit', 'UN')}" /></label>
          <label>Marca<input name="brand" value="${value('brand')}" /></label>
          <label>Status
            <select name="status">
              <option value="ativo" ${!current || current.status === 'ativo' ? 'selected' : ''}>Ativo</option>
              <option value="inativo" ${current && current.status === 'inativo' ? 'selected' : ''}>Inativo</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label>Custo<input type="number" step="0.01" min="0" name="costPrice" required value="${current ? Number(current.costPrice || 0) : 0}" /></label>
          <label>Preço de venda<input type="number" step="0.01" min="0" name="salePrice" required value="${current ? Number(current.salePrice || 0) : 0}" /></label>
          <label>NCM<input name="ncm" value="${value('ncm')}" /></label>
        </div>
        <div class="row">
          <label>Estoque mínimo<input type="number" step="0.001" min="0" name="minStock" value="${current ? Number(current.minStock || 0) : 0}" /></label>
          <label>Estoque máximo<input type="number" step="0.001" min="0" name="maxStock" value="${current ? Number(current.maxStock || 0) : 0}" /></label>
          <label>Depósito padrão<select name="defaultDepositId">${S.options(meta.deposits, current ? current.defaultDepositId : '', { empty: 'Nenhum' })}</select></label>
          <label>Localização<input name="location" value="${value('location')}" placeholder="Ex.: Corredor 3, prateleira B" /></label>
        </div>
        ${current ? `
          <div class="row">
            <label>Saldo atual<input value="${S.formatQty(current.stockQuantity)}" disabled /></label>
          </div>
        ` : `
          <div class="row">
            <label>Estoque inicial<input type="number" step="0.001" min="0" name="stockQuantity" value="0" /></label>
            <label>Categoria da movimentação inicial<select name="movementCategoryId">${S.options(meta.movementCategories, '', { empty: 'Sem categoria' })}</select></label>
          </div>
          <p class="muted">Se informar estoque inicial maior que zero, selecione também o depósito padrão — é nele que a entrada será registrada.</p>
        `}
        <label>Observações<textarea name="notes" rows="2">${value('notes')}</textarea></label>
        <div class="finance-actions-row">
          <button type="submit">${current ? 'Salvar alterações' : 'Salvar produto'}</button>
          <button type="button" class="secondary" id="stockProductCancel">Ver lista</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('stockProductCancel')?.addEventListener('click', () => {
    state.activeSub = 'products';
    loadModule('stock');
  });

  document.getElementById('stockProductForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;
    if (submitBtn) submitBtn.disabled = true;
    const formData = new FormData(event.target);
    const payload = {
      id: current ? current.id : undefined,
      name: formData.get('name'),
      sku: formData.get('sku'),
      ean: formData.get('ean'),
      categoryId: formData.get('categoryId'),
      unit: formData.get('unit'),
      brand: formData.get('brand'),
      status: formData.get('status'),
      costPrice: Number(formData.get('costPrice') || 0),
      salePrice: Number(formData.get('salePrice') || 0),
      ncm: formData.get('ncm'),
      minStock: Number(formData.get('minStock') || 0),
      maxStock: Number(formData.get('maxStock') || 0),
      defaultDepositId: formData.get('defaultDepositId'),
      location: formData.get('location'),
      notes: formData.get('notes')
    };
    if (!current) {
      payload.stockQuantity = Number(formData.get('stockQuantity') || 0);
      payload.movementCategoryId = formData.get('movementCategoryId') || '';
    }

    try {
      await api('/api/stock/products', { method: 'POST', body: JSON.stringify(payload) });
      showToast(current ? 'Produto atualizado.' : 'Produto criado.', 'success');
      state.activeSub = 'products';
      loadModule('stock');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar produto.', 'error');
      if (submitBtn) submitBtn.disabled = false;
    }
  });
};
