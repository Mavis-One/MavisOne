window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// Gestor de Preços: edita custo e venda de vários produtos de uma vez e mostra
// o preço resultante da tabela selecionada.
window.MavisSubscreenRegistry.stock.price_manager = async function renderPriceManager(ctx) {
  const { content, api, showToast } = ctx;
  const S = window.MavisStock;

  let priceTableId = '';
  let search = '';
  let products = [];
  let priceTables = [];
  const edits = new Map();

  async function load() {
    const params = new URLSearchParams();
    if (priceTableId) params.set('priceTableId', priceTableId);
    if (search) params.set('search', search);
    try {
      const res = await api(`/api/stock/price-manager?${params.toString()}`);
      products = res.products || [];
      priceTables = res.priceTables || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar o gestor de preços.', 'error');
      products = [];
    }
  }

  function currentTable() {
    return priceTables.find((t) => t.id === priceTableId) || null;
  }

  function marginFor(cost, sale) {
    const c = Number(cost || 0);
    if (!(c > 0)) return 0;
    return ((Number(sale || 0) - c) / c) * 100;
  }

  function rows() {
    const table = currentTable();
    const isFixed = table && table.type === 'fixo';
    if (!products.length) return S.emptyRow(isFixed ? 7 : 6, 'Nenhum produto encontrado.');
    return products.map((product) => {
      const edit = edits.get(product.id) || {};
      const cost = edit.costPrice ?? product.costPrice;
      const sale = edit.salePrice ?? product.salePrice;
      return `
        <tr data-row="${product.id}">
          <td>${S.escape(product.name)}</td>
          <td>${S.escape(product.sku || '-')}</td>
          <td>${S.formatQty(product.stockQuantity)}</td>
          <td><input type="number" step="0.01" min="0" data-field="costPrice" data-product="${product.id}" value="${Number(cost).toFixed(2)}" style="max-width:120px;" /></td>
          <td><input type="number" step="0.01" min="0" data-field="salePrice" data-product="${product.id}" value="${Number(sale).toFixed(2)}" style="max-width:120px;" /></td>
          <td data-margin="${product.id}">${marginFor(cost, sale).toFixed(1)}%</td>
          ${isFixed
            ? `<td><input type="number" step="0.01" min="0" data-field="tablePrice" data-product="${product.id}" value="${Number(edit.tablePrice ?? product.tablePrice).toFixed(2)}" style="max-width:120px;" /></td>`
            : (table ? `<td>${S.formatBRL(product.tablePrice)}</td>` : '')}
        </tr>
      `;
    }).join('');
  }

  function render() {
    const table = currentTable();
    const isFixed = table && table.type === 'fixo';
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Gestor de Preços', 'Ajuste custo e preço de venda em lote. A margem é recalculada enquanto você digita.')}
        <div class="row">
          <label>Tabela de preços
            <select id="priceManagerTable">${S.options(priceTables, priceTableId, { empty: 'Nenhuma (preço do cadastro)' })}</select>
          </label>
          <label>Buscar<input type="search" id="priceManagerSearch" value="${S.escape(search)}" placeholder="Nome ou SKU" /></label>
        </div>
        ${table ? `<p class="muted">${isFixed
          ? 'Tabela de preço fixo: o valor da última coluna é gravado como preço do produto nesta tabela.'
          : `Tabela por markup de ${Number(table.markupPercent || 0).toFixed(2)}% sobre o custo — a coluna "Preço na tabela" é calculada.`}</p>` : ''}
      </div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Produto</th><th>SKU</th><th>Saldo</th><th>Custo</th><th>Venda</th><th>Margem</th>
                ${table ? '<th>Preço na tabela</th>' : ''}
              </tr>
            </thead>
            <tbody id="priceManagerBody">${rows()}</tbody>
          </table>
        </div>
        <div class="finance-actions-row" style="margin-top:12px;">
          <button type="button" id="priceManagerSave">Salvar alterações</button>
          <span class="muted" id="priceManagerCount">${edits.size} produto(s) alterado(s)</span>
        </div>
      </div>
    `;
    attachHandlers();
  }

  function updateCount() {
    const counter = document.getElementById('priceManagerCount');
    if (counter) counter.textContent = `${edits.size} produto(s) alterado(s)`;
  }

  function attachHandlers() {
    document.getElementById('priceManagerTable')?.addEventListener('change', async (event) => {
      priceTableId = event.target.value;
      await load();
      render();
    });

    let searchTimer = null;
    document.getElementById('priceManagerSearch')?.addEventListener('input', (event) => {
      search = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        await load();
        render();
        const input = document.getElementById('priceManagerSearch');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      }, 350);
    });

    content.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const productId = input.dataset.product;
        const product = products.find((p) => p.id === productId);
        const entry = edits.get(productId) || {};
        entry[input.dataset.field] = Number(input.value || 0);
        edits.set(productId, entry);

        const cost = entry.costPrice ?? product.costPrice;
        const sale = entry.salePrice ?? product.salePrice;
        const marginCell = content.querySelector(`[data-margin="${productId}"]`);
        if (marginCell) marginCell.textContent = `${marginFor(cost, sale).toFixed(1)}%`;
        updateCount();
      });
    });

    document.getElementById('priceManagerSave')?.addEventListener('click', async (event) => {
      if (!edits.size) {
        showToast('Nenhuma alteração para salvar.', 'warning');
        return;
      }
      const btn = event.target;
      btn.disabled = true;
      const updates = [...edits.entries()].map(([productId, values]) => {
        const product = products.find((p) => p.id === productId) || {};
        return {
          productId,
          costPrice: values.costPrice ?? product.costPrice,
          salePrice: values.salePrice ?? product.salePrice,
          tablePrice: values.tablePrice
        };
      });
      try {
        await api('/api/stock/price-manager', { method: 'POST', body: JSON.stringify({ updates, priceTableId }) });
        showToast(`${updates.length} produto(s) atualizado(s).`, 'success');
        edits.clear();
        await load();
        render();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar preços.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  await load();
  render();
};
