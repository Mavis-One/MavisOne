window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_catalog = async function renderNewCatalog(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const editId = state.stockEditCatalogId || null;
  state.stockEditCatalogId = null;

  let current = null;
  if (editId) {
    try {
      const res = await api(`/api/stock/catalogs/${editId}`);
      current = res.catalog;
    } catch (error) {
      showToast('Não foi possível carregar o catálogo para edição.', 'error');
    }
  }

  const selected = new Set(current ? current.productIds || [] : []);
  let search = '';

  function productRows() {
    const term = search.trim().toLowerCase();
    const products = meta.products.filter((p) => !term || `${p.name} ${p.sku}`.toLowerCase().includes(term));
    if (!products.length) return S.emptyRow(4, 'Nenhum produto encontrado.');
    return products.map((product) => `
      <tr>
        <td><input type="checkbox" data-product="${product.id}" ${selected.has(product.id) ? 'checked' : ''} /></td>
        <td>${S.escape(product.name)}</td>
        <td>${S.escape(product.sku || '-')}</td>
        <td>${S.formatBRL(product.salePrice)}</td>
      </tr>
    `).join('');
  }

  function render() {
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead(current ? 'Editar Catálogo' : 'Novo Catálogo de Produtos', 'Selecione os produtos que fazem parte do catálogo.')}
        <form id="catalogForm" class="form-grid">
          <div class="row">
            <label>Nome<input name="name" required value="${S.escape(current ? current.name : '')}" /></label>
            <label>Código<input name="code" value="${S.escape(current ? current.code || '' : '')}" /></label>
            <label>Tabela de preços
              <select name="priceTableId">
                ${S.options(meta.priceTables, current ? current.priceTableId : '', { empty: 'Preço de venda do produto' })}
              </select>
            </label>
            <label>Status
              <select name="status">
                <option value="ativo" ${!current || current.status === 'ativo' ? 'selected' : ''}>Ativo</option>
                <option value="inativo" ${current && current.status === 'inativo' ? 'selected' : ''}>Inativo</option>
              </select>
            </label>
          </div>
          <label>Descrição<textarea name="description" rows="2">${S.escape(current ? current.description || '' : '')}</textarea></label>

          <h4 style="margin:8px 0;">Produtos do catálogo <span class="muted" id="catalogCount">(${selected.size} selecionado(s))</span></h4>
          <div class="finance-actions-row">
            <button type="button" class="secondary finance-pill-sm" id="catalogSelectAll">Selecionar todos os visíveis</button>
            <button type="button" class="secondary finance-pill-sm" id="catalogClear">Limpar seleção</button>
          </div>
          <label>Buscar produto<input type="search" id="catalogSearch" value="${S.escape(search)}" placeholder="Nome ou SKU" /></label>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th style="width:48px;"></th><th>Produto</th><th>SKU</th><th>Preço de venda</th></tr></thead>
              <tbody id="catalogBody">${productRows()}</tbody>
            </table>
          </div>

          <div class="finance-actions-row">
            <button type="submit">${current ? 'Salvar alterações' : 'Salvar catálogo'}</button>
            <button type="button" class="secondary" id="catalogCancel">Ver lista</button>
          </div>
        </form>
      </div>
    `;
    attachHandlers();
  }

  function updateCount() {
    const counter = document.getElementById('catalogCount');
    if (counter) counter.textContent = `(${selected.size} selecionado(s))`;
  }

  function attachHandlers() {
    content.querySelectorAll('[data-product]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(checkbox.dataset.product);
        else selected.delete(checkbox.dataset.product);
        updateCount();
      });
    });

    document.getElementById('catalogSearch')?.addEventListener('input', (event) => {
      search = event.target.value;
      const body = document.getElementById('catalogBody');
      if (body) {
        body.innerHTML = productRows();
        attachHandlers();
      }
    });

    document.getElementById('catalogSelectAll')?.addEventListener('click', () => {
      content.querySelectorAll('[data-product]').forEach((checkbox) => {
        checkbox.checked = true;
        selected.add(checkbox.dataset.product);
      });
      updateCount();
    });

    document.getElementById('catalogClear')?.addEventListener('click', () => {
      selected.clear();
      content.querySelectorAll('[data-product]').forEach((checkbox) => { checkbox.checked = false; });
      updateCount();
    });

    document.getElementById('catalogCancel')?.addEventListener('click', () => {
      state.activeSub = 'catalogs';
      loadModule('stock');
    });

    document.getElementById('catalogForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(event.target);
      const payload = {
        name: formData.get('name'),
        code: formData.get('code'),
        priceTableId: formData.get('priceTableId'),
        status: formData.get('status'),
        description: formData.get('description'),
        productIds: [...selected]
      };
      try {
        if (current) {
          await api(`/api/stock/catalogs/${current.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/api/stock/catalogs', { method: 'POST', body: JSON.stringify(payload) });
        }
        showToast(current ? 'Catálogo atualizado.' : 'Catálogo criado.', 'success');
        state.activeSub = 'catalogs';
        loadModule('stock');
      } catch (error) {
        showToast(error.message || 'Erro ao salvar o catálogo.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  render();
};
