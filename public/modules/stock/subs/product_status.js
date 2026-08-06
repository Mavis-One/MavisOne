window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// Consulta da posição de um produto: saldo por depósito, limites e histórico.
window.MavisSubscreenRegistry.stock.product_status = async function renderProductStatus(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  let productId = state.stockStatusProductId || (meta.products[0] ? meta.products[0].id : '');
  state.stockStatusProductId = null;

  async function load() {
    if (!productId) return null;
    try {
      return await api(`/api/stock/products/${productId}`);
    } catch (error) {
      showToast(error.message || 'Erro ao carregar o status do produto.', 'error');
      return null;
    }
  }

  function movementRow(movement) {
    const tone = movement.type === 'entrada' ? 'success' : 'danger';
    const sign = movement.type === 'entrada' ? '+' : '-';
    return `
      <tr>
        <td>${S.escape(movement.code)}</td>
        <td>${S.formatDate(movement.date)}</td>
        <td>${S.badge(movement.type === 'entrada' ? 'Entrada' : 'Saída', tone)}</td>
        <td>${S.escape(movement.depositName || '-')}</td>
        <td>${sign}${S.formatQty(movement.quantity)}</td>
        <td>${S.escape(movement.categoryName || '-')}</td>
        <td>${S.escape(movement.note || movement.document || '-')}</td>
      </tr>
    `;
  }

  async function render() {
    const result = await load();
    const product = result ? result.product : null;
    const movements = result ? result.movements : [];

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Status do Produto', 'Posição atual e histórico de movimentações.')}
        <label>Produto
          <select id="statusProductSelect">${S.options(meta.products, productId, { empty: meta.products.length ? null : 'Nenhum produto cadastrado' })}</select>
        </label>
      </div>

      ${!product ? '<div class="panel"><p class="muted">Cadastre um produto para consultar o status.</p></div>' : `
        <div class="row">
          <div class="panel"><strong>${S.formatQty(product.stockQuantity)}</strong><p class="muted">Saldo total (${S.escape(product.unit)})</p></div>
          <div class="panel"><strong>${S.situationBadge(product.situation)}</strong><p class="muted">Mín. ${S.formatQty(product.minStock)} / Máx. ${S.formatQty(product.maxStock)}</p></div>
          <div class="panel"><strong>${S.formatBRL(Number(product.stockQuantity) * Number(product.costPrice))}</strong><p class="muted">Valor a custo</p></div>
          <div class="panel"><strong>${S.statusBadge(product.status)}</strong><p class="muted">${S.escape(product.categoryName || 'Sem categoria')}</p></div>
        </div>

        <div class="panel">
          <h3>Saldo por depósito</h3>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Depósito</th><th>Saldo</th><th>Participação</th></tr></thead>
              <tbody>
                ${product.balances.length === 0 ? S.emptyRow(3, 'Nenhum depósito cadastrado.') : product.balances.map((balance) => `
                  <tr>
                    <td>${S.escape(balance.depositName)}</td>
                    <td>${S.formatQty(balance.quantity)}</td>
                    <td>${Number(product.stockQuantity) > 0 ? ((balance.quantity / Number(product.stockQuantity)) * 100).toFixed(1) : '0.0'}%</td>
                  </tr>
                `).join('')}
                ${product.unallocated !== 0 ? `
                  <tr>
                    <td class="muted">Sem depósito definido</td>
                    <td class="muted">${S.formatQty(product.unallocated)}</td>
                    <td class="muted">-</td>
                  </tr>
                ` : ''}
              </tbody>
            </table>
          </div>
          ${product.unallocated !== 0 ? '<p class="muted" style="margin-top:12px;">"Sem depósito definido" é o saldo que existe no cadastro do produto mas ainda não foi distribuído por movimentações. Registre uma entrada para alocá-lo.</p>' : ''}
        </div>

        <div class="panel">
          <h3>Últimas movimentações</h3>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Código</th><th>Data</th><th>Tipo</th><th>Depósito</th><th>Qtd.</th><th>Categoria</th><th>Observação</th></tr></thead>
              <tbody>${movements.length === 0 ? S.emptyRow(7, 'Nenhuma movimentação registrada.') : movements.map(movementRow).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <div class="finance-actions-row">
            <button type="button" id="statusNewMovement">Nova movimentação</button>
            <button type="button" class="secondary" id="statusEditProduct">Editar produto</button>
          </div>
        </div>
      `}
    `;

    document.getElementById('statusProductSelect')?.addEventListener('change', (event) => {
      productId = event.target.value;
      render();
    });

    document.getElementById('statusNewMovement')?.addEventListener('click', () => {
      state.stockMovementProductId = productId;
      state.activeSub = 'new_movement';
      loadModule('stock');
    });

    document.getElementById('statusEditProduct')?.addEventListener('click', () => {
      state.stockEditProductId = productId;
      state.activeSub = 'new_product';
      loadModule('stock');
    });
  }

  await render();
};
