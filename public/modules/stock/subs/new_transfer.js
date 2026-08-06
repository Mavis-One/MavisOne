window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_transfer = async function renderNewTransfer(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  let productDetail = null;

  async function loadProductDetail(productId) {
    if (!productId) { productDetail = null; return; }
    try {
      const res = await api(`/api/stock/products/${productId}`);
      productDetail = res.product;
    } catch (error) {
      productDetail = null;
    }
  }

  function balanceTable() {
    if (!productDetail) return '<p class="muted">Selecione um produto para ver o saldo de cada depósito.</p>';
    return `
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>Depósito</th><th>Saldo disponível</th></tr></thead>
          <tbody>
            ${productDetail.balances.length === 0 ? S.emptyRow(2, 'Nenhum depósito cadastrado.') : productDetail.balances.map((b) => `
              <tr><td>${S.escape(b.depositName)}</td><td>${S.formatQty(b.quantity)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${productDetail.unallocated !== 0 ? `<p class="muted">Há ${S.formatQty(productDetail.unallocated)} sem depósito definido. Registre uma entrada antes de transferir esse saldo.</p>` : ''}
    `;
  }

  function render(selectedProductId) {
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Nova Transferência Entre Depósitos', 'O saldo total do produto não muda — apenas a distribuição entre depósitos.')}
        <form id="transferForm" class="form-grid">
          <div class="row">
            <label>Produto<select name="productId" id="transferProduct" required>${S.options(meta.products, selectedProductId, { empty: 'Selecione' })}</select></label>
            <label>Data<input type="date" name="date" required value="${today}" /></label>
            <label>Quantidade<input type="number" step="0.001" min="0.001" name="quantity" required /></label>
          </div>
          <div class="row">
            <label>Depósito de origem<select name="originDepositId" required>${S.options(meta.deposits, '', { empty: 'Selecione' })}</select></label>
            <label>Depósito de destino<select name="destinationDepositId" required>${S.options(meta.deposits, '', { empty: 'Selecione' })}</select></label>
            <label>Documento<input name="document" /></label>
          </div>
          <label>Observação<textarea name="note" rows="2"></textarea></label>
          <div class="finance-actions-row">
            <button type="submit">Transferir</button>
            <button type="button" class="secondary" id="transferCancel">Ver transferências</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <h3>Saldo por depósito</h3>
        ${balanceTable()}
      </div>
    `;

    document.getElementById('transferProduct')?.addEventListener('change', async (event) => {
      await loadProductDetail(event.target.value);
      render(event.target.value);
    });

    document.getElementById('transferCancel')?.addEventListener('click', () => {
      state.activeSub = 'transfers';
      loadModule('stock');
    });

    document.getElementById('transferForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      const formData = new FormData(event.target);
      if (formData.get('originDepositId') === formData.get('destinationDepositId')) {
        showToast('Origem e destino não podem ser o mesmo depósito.', 'warning');
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      const payload = {
        productId: formData.get('productId'),
        date: formData.get('date'),
        quantity: Number(formData.get('quantity') || 0),
        originDepositId: formData.get('originDepositId'),
        destinationDepositId: formData.get('destinationDepositId'),
        document: formData.get('document') || '',
        note: formData.get('note') || ''
      };
      try {
        await api('/api/stock/transfers', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Transferência registrada.', 'success');
        state.activeSub = 'transfers';
        loadModule('stock');
      } catch (error) {
        showToast(error.message || 'Erro ao transferir.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  render('');
};
