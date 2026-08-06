window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// Tabela de preços: markup calcula sobre o custo do produto; preço fixo grava
// um valor por produto (a lista de itens só aparece nesse caso).
window.MavisSubscreenRegistry.stock.new_price_table = async function renderNewPriceTable(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const editId = state.stockEditPriceTableId || null;
  state.stockEditPriceTableId = null;

  let current = null;
  if (editId) {
    try {
      const res = await api(`/api/stock/price-tables/${editId}`);
      current = res.priceTable;
    } catch (error) {
      showToast('Não foi possível carregar a tabela para edição.', 'error');
    }
  }

  let type = current ? current.type : 'markup';
  const itemPrices = new Map((current && current.items ? current.items : []).map((item) => [item.productId, item.price]));
  let itemSearch = '';

  function itemRows() {
    const term = itemSearch.trim().toLowerCase();
    const products = meta.products.filter((p) => !term || `${p.name} ${p.sku}`.toLowerCase().includes(term));
    if (!products.length) return S.emptyRow(4, 'Nenhum produto encontrado.');
    return products.map((product) => `
      <tr>
        <td>${S.escape(product.name)}</td>
        <td>${S.escape(product.sku || '-')}</td>
        <td>${S.formatBRL(product.costPrice)}</td>
        <td><input type="number" step="0.01" min="0" data-price-for="${product.id}" value="${itemPrices.has(product.id) ? itemPrices.get(product.id) : ''}" placeholder="${Number(product.salePrice || 0).toFixed(2)}" style="max-width:140px;" /></td>
      </tr>
    `).join('');
  }

  function render() {
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead(current ? 'Editar Tabela de Preços' : 'Nova Tabela de Preços', 'Markup aplica um percentual sobre o custo. Preço fixo usa o valor informado por produto.')}
        <form id="priceTableForm" class="form-grid">
          <div class="row">
            <label>Nome<input name="name" required value="${S.escape(current ? current.name : '')}" /></label>
            <label>Código<input name="code" value="${S.escape(current ? current.code || '' : '')}" /></label>
            <label>Status
              <select name="status">
                <option value="ativo" ${!current || current.status === 'ativo' ? 'selected' : ''}>Ativo</option>
                <option value="inativo" ${current && current.status === 'inativo' ? 'selected' : ''}>Inativo</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label>Tipo
              <select name="type" id="priceTableType">
                <option value="markup" ${type === 'markup' ? 'selected' : ''}>Markup sobre o custo</option>
                <option value="fixo" ${type === 'fixo' ? 'selected' : ''}>Preço fixo por produto</option>
              </select>
            </label>
            <label>Markup (%)<input type="number" step="0.01" name="markupPercent" ${type === 'fixo' ? 'disabled' : ''} value="${current ? Number(current.markupPercent || 0) : 0}" /></label>
            <label>Vigência de<input type="date" name="validFrom" value="${current ? current.validFrom || '' : ''}" /></label>
            <label>Vigência até<input type="date" name="validTo" value="${current ? current.validTo || '' : ''}" /></label>
          </div>
          <label>Observações<textarea name="notes" rows="2">${S.escape(current ? current.notes || '' : '')}</textarea></label>

          <div id="priceTableItems" class="${type === 'fixo' ? '' : 'hidden'}">
            <h4 style="margin:8px 0;">Preços por produto</h4>
            <p class="muted">Deixe em branco para o produto usar o preço de venda do cadastro.</p>
            <label>Buscar produto<input type="search" id="priceItemSearch" value="${S.escape(itemSearch)}" placeholder="Nome ou SKU" /></label>
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Produto</th><th>SKU</th><th>Custo</th><th>Preço na tabela</th></tr></thead>
                <tbody id="priceItemBody">${itemRows()}</tbody>
              </table>
            </div>
          </div>

          <div class="finance-actions-row">
            <button type="submit">${current ? 'Salvar alterações' : 'Salvar tabela'}</button>
            <button type="button" class="secondary" id="priceTableCancel">Ver lista</button>
          </div>
        </form>
      </div>
    `;

    attachHandlers();
  }

  // Mantém em memória o que já foi digitado antes de redesenhar a lista.
  function captureItemInputs() {
    content.querySelectorAll('[data-price-for]').forEach((input) => {
      const productId = input.dataset.priceFor;
      if (input.value === '') itemPrices.delete(productId);
      else itemPrices.set(productId, Number(input.value));
    });
  }

  function attachHandlers() {
    document.getElementById('priceTableType')?.addEventListener('change', (event) => {
      captureItemInputs();
      type = event.target.value;
      render();
    });

    document.getElementById('priceItemSearch')?.addEventListener('input', (event) => {
      captureItemInputs();
      itemSearch = event.target.value;
      const body = document.getElementById('priceItemBody');
      if (body) body.innerHTML = itemRows();
    });

    document.getElementById('priceTableCancel')?.addEventListener('click', () => {
      state.activeSub = 'price_tables';
      loadModule('stock');
    });

    document.getElementById('priceTableForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;
      captureItemInputs();
      const formData = new FormData(event.target);
      const payload = {
        name: formData.get('name'),
        code: formData.get('code'),
        status: formData.get('status'),
        type,
        markupPercent: type === 'markup' ? Number(formData.get('markupPercent') || 0) : 0,
        validFrom: formData.get('validFrom'),
        validTo: formData.get('validTo'),
        notes: formData.get('notes'),
        items: type === 'fixo'
          ? [...itemPrices.entries()].map(([productId, price]) => ({ productId, price }))
          : []
      };
      try {
        if (current) {
          await api(`/api/stock/price-tables/${current.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/api/stock/price-tables', { method: 'POST', body: JSON.stringify(payload) });
        }
        showToast(current ? 'Tabela atualizada.' : 'Tabela criada.', 'success');
        state.activeSub = 'price_tables';
        loadModule('stock');
      } catch (error) {
        showToast(error.message || 'Erro ao salvar a tabela.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  render();
};
