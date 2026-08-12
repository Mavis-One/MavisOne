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
  // O <select> é recriado a cada render(); sem guardar a escolha, trocar o tipo
  // ou o produto apagaria o depósito que o usuário já tinha selecionado.
  let depositId = '';
  let classeDoProduto = null;
  let saldosPorValor = {};
  let classesIgnoradas = [];
  let classValueId = '';

  // Mostra o saldo por depósito do produto escolhido, para a saída não ser às cegas.
  async function loadProductDetail(productId) {
    if (!productId) { productDetail = null; classeDoProduto = null; saldosPorValor = {}; classesIgnoradas = []; return; }
    try {
      const res = await api(`/api/stock/products/${productId}`);
      productDetail = res.product;
    } catch (error) {
      productDetail = null;
    }
    await loadClasses(productId);
  }

  /**
   * Classes do produto + saldo por valor.
   *
   * O saldo vem filtrado pelo depósito escolhido: dizer "8 pretos" quando os 8
   * estão em outro galpão faria a saída ser recusada depois de preenchida.
   */
  async function loadClasses(productId) {
    classeDoProduto = null;
    saldosPorValor = {};
    classesIgnoradas = [];
    if (!productId) return;
    try {
      const query = depositId ? `?depositId=${encodeURIComponent(depositId)}` : '';
      const res = await api(`/api/stock/products/${productId}/classes${query}`);
      const classes = res.classes || [];
      // O movimento guarda UMA classe (classId + classValueId). Um produto com
      // duas classes atribuídas não cabe no razão como está — então a tela usa
      // a primeira e AVISA, em vez de gravar metade da informação em silêncio.
      classeDoProduto = classes.find((c) => c.required) || classes[0] || null;
      classesIgnoradas = classes.filter((c) => c !== classeDoProduto);
      saldosPorValor = res.saldos || {};
    } catch (error) {
      classeDoProduto = null;
    }
    if (!classeDoProduto || !classeDoProduto.valores.some((v) => v.id === classValueId)) classValueId = '';
  }

  function classeField() {
    if (!classeDoProduto) return '';
    const obrigatoria = classeDoProduto.required !== false;
    const opcoes = classeDoProduto.valores.map((valor) => {
      const saldo = Number(saldosPorValor[valor.id] || 0);
      // Na saída o saldo é a informação que decide a escolha; na entrada não
      // existe nada a decidir, e o número só polui o rótulo.
      const rotulo = type === 'saida' ? `${valor.name} — ${S.formatQty(saldo)} disponível` : valor.name;
      return `<option value="${S.escape(valor.id)}" ${valor.id === classValueId ? 'selected' : ''}>${S.escape(rotulo)}</option>`;
    }).join('');
    return `
      <div class="row">
        <label>${S.escape(classeDoProduto.name)}${obrigatoria ? '' : ' <span class="muted">(opcional)</span>'}
          <select name="classValueId" id="movementClassValue" ${obrigatoria ? 'required' : ''}>
            <option value="">${obrigatoria ? 'Selecione' : 'Sem ' + S.escape(classeDoProduto.name.toLowerCase())}</option>
            ${opcoes}
          </select>
        </label>
      </div>
      ${classesIgnoradas.length ? `<p class="muted">Este produto também usa ${S.escape(classesIgnoradas.map((c) => c.name).join(', '))}, mas a movimentação registra apenas ${S.escape(classeDoProduto.name)}.</p>` : ''}
    `;
  }

  function balanceHint() {
    if (!productDetail) return '';
    const rows = productDetail.balances
      .map((b) => `${S.escape(b.depositName)}: <strong>${S.formatQty(b.quantity)}</strong>`)
      .join(' &nbsp;·&nbsp; ');
    // A reserva não bloqueia a saída — pode ser justamente a separação do
    // pedido que reservou. Mas dar baixa de 10 quando 8 estão prometidos a
    // outro cliente é decisão de quem opera, e ela precisa do número à vista.
    const reservado = Number(productDetail.reserved || 0);
    const aviso = type === 'saida' && reservado > 0
      ? `<p class="stock-aviso-reserva">Atenção: <strong>${S.formatQty(reservado)}</strong> deste produto estão reservados em pedidos abertos. Livre: <strong>${S.formatQty(productDetail.available)}</strong>.</p>`
      : '';
    return `<p class="muted">Saldo atual — total <strong>${S.formatQty(productDetail.stockQuantity)}</strong>${rows ? ` &nbsp;|&nbsp; ${rows}` : ''}${productDetail.unallocated !== 0 ? ` &nbsp;|&nbsp; sem depósito: <strong>${S.formatQty(productDetail.unallocated)}</strong>` : ''}</p>${aviso}`;
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
            <label>Depósito<select name="depositId" id="movementDeposit" required>${S.options(meta.deposits, depositId, { empty: 'Selecione' })}</select></label>
            <label>Data<input type="date" name="date" required value="${today}" /></label>
          </div>
          ${balanceHint()}
          ${classeField()}
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

    // Trocar de depósito muda o saldo de cada cor — o rótulo "8 disponível"
    // vale para o galpão escolhido, não para a empresa inteira.
    document.getElementById('movementDeposit')?.addEventListener('change', async (event) => {
      depositId = event.target.value;
      const productId = document.getElementById('movementProduct')?.value || '';
      await loadClasses(productId);
      render(productId);
    });

    document.getElementById('movementClassValue')?.addEventListener('change', (event) => {
      classValueId = event.target.value;
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
        // classId acompanha o valor porque o razão guarda os dois: sem ele,
        // saber a que classe "Preto" pertence exigiria consultar o catálogo.
        classId: formData.get('classValueId') ? (classeDoProduto?.classId || '') : '',
        classValueId: formData.get('classValueId') || '',
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
