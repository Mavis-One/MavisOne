window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_movement = async function renderNewMovement(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const preselectedProduct = state.stockMovementProductId || '';
  state.stockMovementProductId = null;

  let type = 'entrada';
  let productDetail = null;

  // Mostra o saldo por depósito do produto escolhido, para a saída não ser às cegas.
  async function loadProductDetail(productId) {
    if (!productId) { productDetail = null; return; }
    try {
      const res = await api(`/api/stock/products/${productId}`);
      productDetail = res.product;
    } catch (error) {
      productDetail = null;
    }
  }

  function balanceHint() {
    if (!productDetail) return '';
    const rows = productDetail.balances
      .map((b) => `${S.escape(b.depositName)}: <strong>${S.formatQty(b.quantity)}</strong>`)
      .join(' &nbsp;·&nbsp; ');
    return `<p class="muted">Saldo atual — total <strong>${S.formatQty(productDetail.stockQuantity)}</strong>${rows ? ` &nbsp;|&nbsp; ${rows}` : ''}${productDetail.unallocated !== 0 ? ` &nbsp;|&nbsp; sem depósito: <strong>${S.formatQty(productDetail.unallocated)}</strong>` : ''}</p>`;
  }

  function categoryOptions() {
    const list = (meta.movementCategories || []).filter((c) => !c.kind || c.kind === 'ambos' || c.kind === type);
    return S.options(list, '', { empty: 'Sem categoria' });
  }

  function render(selectedProductId) {
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Nova Movimentação', 'Entrada aumenta e saída reduz o saldo do depósito escolhido.')}

        <div class="finance-period-group" style="margin-bottom:18px;">
          <button type="button" class="finance-pill ${type === 'entrada' ? 'active' : ''}" data-mov-type="entrada">Entrada</button>
          <button type="button" class="finance-pill ${type === 'saida' ? 'active' : ''}" data-mov-type="saida">Saída</button>
        </div>

        <form id="movementForm" class="form-grid">
          <div class="row">
            <label>Produto
              <select name="productId" id="movementProduct" required>${S.options(meta.products, selectedProductId, { empty: 'Selecione' })}</select>
            </label>
            <label>Depósito<select name="depositId" required>${S.options(meta.deposits, '', { empty: 'Selecione' })}</select></label>
            <label>Data<input type="date" name="date" required value="${today}" /></label>
          </div>
          ${balanceHint()}
          <div class="row">
            <label>Quantidade<input type="number" step="0.001" min="0.001" name="quantity" required /></label>
            <label>Custo unitário<input type="number" step="0.01" min="0" name="unitCost" value="0" /></label>
            <label>Categoria<select name="categoryId">${categoryOptions()}</select></label>
            <label>Documento<input name="document" placeholder="NF, pedido, romaneio..." /></label>
          </div>
          <label>Observação<textarea name="note" rows="2"></textarea></label>
          <div class="finance-actions-row">
            <button type="submit">Registrar movimentação</button>
            <button type="button" class="secondary" id="movementCancel">Ver movimentações</button>
          </div>
        </form>
      </div>
    `;
    attachHandlers();
  }

  function attachHandlers() {
    content.querySelectorAll('[data-mov-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        type = btn.dataset.movType;
        render(document.getElementById('movementProduct')?.value || '');
      });
    });

    document.getElementById('movementProduct')?.addEventListener('change', async (event) => {
      await loadProductDetail(event.target.value);
      render(event.target.value);
    });

    document.getElementById('movementCancel')?.addEventListener('click', () => {
      state.activeSub = 'movements';
      loadModule('stock');
    });

    document.getElementById('movementForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(event.target);
      const payload = {
        type,
        productId: formData.get('productId'),
        depositId: formData.get('depositId'),
        date: formData.get('date'),
        quantity: Number(formData.get('quantity') || 0),
        unitCost: Number(formData.get('unitCost') || 0),
        categoryId: formData.get('categoryId') || '',
        document: formData.get('document') || '',
        note: formData.get('note') || ''
      };
      try {
        await api('/api/stock/movements', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Movimentação registrada.', 'success');
        state.activeSub = 'movements';
        loadModule('stock');
      } catch (error) {
        showToast(error.message || 'Erro ao registrar movimentação.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  if (preselectedProduct) await loadProductDetail(preselectedProduct);
  render(preselectedProduct);
};
