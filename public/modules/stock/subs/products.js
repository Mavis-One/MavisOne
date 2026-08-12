window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.products = async function renderStockProducts(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);
  const filters = { search: '', categoryId: '', status: '', situation: '', depositId: '' };

  /**
   * §20: a quebra por cor embaixo do saldo, e não numa tela de relatório à
   * parte. É a mesma pergunta ("quanto tem deste produto?") com um nível a
   * mais de detalhe — mandar o usuário para outro lugar para respondê-la é o
   * que faz o relatório nunca ser aberto.
   *
   * `semClasse` aparece de propósito: é o saldo de antes do controle por cor,
   * e escondê-lo faria a soma das cores não bater com o total.
   */
  /**
   * Reserva: prometido em pedido aberto, ainda no depósito.
   *
   * `reserved` vem null quando a rota não calculou — aí a linha não diz nada,
   * em vez de afirmar "nada reservado", que seria uma informação inventada.
   * Zero reservado também não vira linha: seria ruído em todo produto parado.
   */
  function reservaDoProduto(product) {
    if (product.reserved === null || product.reserved === undefined) return '';
    if (Number(product.reserved) === 0) return '';
    const livre = Number(product.available || 0);
    return `<div class="stock-reserva" title="Prometido em pedidos abertos que ainda não foram faturados.">`
      + `${S.formatQty(product.reserved)} reservado · <strong>${S.formatQty(livre)} livre</strong>`
      + `</div>`;
  }

  function quebraPorCor(product) {
    const quebra = product.classBalances;
    if (!quebra) return '';
    const partes = (quebra.valores || [])
      .filter((linha) => linha.quantity !== 0)
      .map((linha) => `${S.corBadge(cores, linha.classValueId)} ${S.formatQty(linha.quantity)}`);
    if (quebra.semClasse !== 0) partes.push(`<span class="muted">sem cor ${S.formatQty(quebra.semClasse)}</span>`);
    if (!partes.length) return '';
    return `<div class="stock-quebra-cor">${partes.join(' · ')}</div>`;
  }

  async function fetchProducts() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const res = await api(`/api/stock/products?${params.toString()}`);
      return res.products || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar produtos.', 'error');
      return [];
    }
  }

  function totalsPanel(products) {
    const totalUnits = products.reduce((sum, p) => sum + Number(p.stockQuantity || 0), 0);
    const totalCost = products.reduce((sum, p) => sum + Number(p.stockQuantity || 0) * Number(p.costPrice || 0), 0);
    const alerts = products.filter((p) => p.situation === 'abaixo-minimo' || p.situation === 'zerado').length;
    return `
      <div class="row">
        <div class="panel"><strong>${products.length}</strong><p class="muted">Produtos listados</p></div>
        <div class="panel"><strong>${S.formatQty(totalUnits)}</strong><p class="muted">Unidades em estoque</p></div>
        <div class="panel"><strong>${S.formatBRL(totalCost)}</strong><p class="muted">Valor a custo</p></div>
        <div class="panel"><strong>${alerts}</strong><p class="muted">Zerados ou abaixo do mínimo</p></div>
      </div>
    `;
  }

  async function render() {
    const products = await fetchProducts();
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Produtos', 'Cadastro e posição de estoque. O saldo por depósito vem das movimentações.', '<button type="button" id="stockNewProduct">Novo produto</button>')}
        <form id="stockProductFilters" class="form-grid">
          <div class="row">
            <label>Buscar<input type="search" name="search" value="${S.escape(filters.search)}" placeholder="Nome, SKU ou código de barras" /></label>
            <label>Categoria<select name="categoryId">${S.options(meta.productCategories, filters.categoryId, { empty: 'Todas' })}</select></label>
            <label>Depósito<select name="depositId">${S.options(meta.deposits, filters.depositId, { empty: 'Todos' })}</select></label>
            <label>Status
              <select name="status">
                <option value="">Todos</option>
                <option value="ativo" ${filters.status === 'ativo' ? 'selected' : ''}>Ativo</option>
                <option value="inativo" ${filters.status === 'inativo' ? 'selected' : ''}>Inativo</option>
              </select>
            </label>
            <label>Situação
              <select name="situation">
                <option value="">Todas</option>
                <option value="normal" ${filters.situation === 'normal' ? 'selected' : ''}>Normal</option>
                <option value="abaixo-minimo" ${filters.situation === 'abaixo-minimo' ? 'selected' : ''}>Abaixo do mínimo</option>
                <option value="acima-maximo" ${filters.situation === 'acima-maximo' ? 'selected' : ''}>Acima do máximo</option>
                <option value="zerado" ${filters.situation === 'zerado' ? 'selected' : ''}>Zerado</option>
              </select>
            </label>
          </div>
          <div class="finance-actions-row">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="stockProductClear">Limpar</button>
          </div>
        </form>
      </div>

      ${totalsPanel(products)}

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <th>Produto</th><th>SKU</th><th>Categoria</th><th>Un.</th>
                <th>Custo</th><th>Venda</th><th>Margem</th><th>Saldo</th><th>Situação</th><th>Status</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${products.length === 0
                ? S.emptyRow(11, 'Nenhum produto encontrado.')
                : products.map((product) => `
                  <tr>
                    <td>${S.escape(product.name)}</td>
                    <td>${S.escape(product.sku || '-')}</td>
                    <td>${S.escape(product.categoryName || '-')}</td>
                    <td>${S.escape(product.unit)}</td>
                    <td>${S.formatBRL(product.costPrice)}</td>
                    <td>${S.formatBRL(product.salePrice)}</td>
                    <td>${Number(product.margin || 0).toFixed(1)}%</td>
                    <td>${S.formatQty(product.stockQuantity)}${reservaDoProduto(product)}${quebraPorCor(product)}</td>
                    <td>${S.situationBadge(product.situation)}</td>
                    <td>${S.statusBadge(product.status)}</td>
                    <td>
                      <button type="button" class="secondary finance-pill-sm" data-status="${product.id}">Status</button>
                      <button type="button" class="icon-button edit" data-edit="${product.id}" title="Editar">${S.editIcon}</button>
                      <button type="button" class="icon-button" data-delete="${product.id}" title="Excluir">${S.trashIcon}</button>
                    </td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('stockNewProduct')?.addEventListener('click', () => {
      state.stockEditProductId = null;
      state.activeSub = 'new_product';
      loadModule('stock');
    });

    document.getElementById('stockProductFilters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      Object.keys(filters).forEach((key) => { filters[key] = formData.get(key) || ''; });
      render();
    });

    document.getElementById('stockProductClear')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      render();
    });

    content.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.stockStatusProductId = btn.dataset.status;
        state.activeSub = 'product_status';
        loadModule('stock');
      });
    });

    content.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.stockEditProductId = btn.dataset.edit;
        state.activeSub = 'new_product';
        loadModule('stock');
      });
    });

    content.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const product = products.find((p) => p.id === btn.dataset.delete);
        const confirmed = await confirmModal(`Excluir o produto "${product ? product.name : ''}"? Produtos com movimentações não podem ser excluídos.`);
        if (!confirmed) return;
        try {
          await api(`/api/stock/products/${btn.dataset.delete}`, { method: 'DELETE' });
          showToast('Produto excluído.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir produto.', 'error');
        }
      });
    });
  }

  await render();
};
