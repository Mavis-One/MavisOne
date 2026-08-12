window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_transfer = async function renderNewTransfer(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);
  let productDetail = null;
  let classeDoProduto = null;
  let classesIgnoradas = [];
  let classValueId = '';

  async function loadProductDetail(productId) {
    classeDoProduto = null;
    classesIgnoradas = [];
    classValueId = '';
    if (!productId) { productDetail = null; return; }
    try {
      const res = await api(`/api/stock/products/${productId}`);
      productDetail = res.product;
    } catch (error) {
      productDetail = null;
    }
    try {
      const res = await api(`/api/stock/products/${productId}/classes`);
      const classes = res.classes || [];
      // Uma classe por movimento, como na entrada e na venda: o razão guarda
      // um classValueId, e a transferência gera dois movimentos.
      classeDoProduto = classes.find((c) => c.required) || classes[0] || null;
      classesIgnoradas = classes.filter((c) => c !== classeDoProduto);
    } catch (error) {
      classeDoProduto = null;
    }
  }

  function classeField() {
    if (!classeDoProduto) return '';
    const obrigatoria = classeDoProduto.required !== false;
    return `
      <div class="row">
        <label>${S.escape(classeDoProduto.name)}${obrigatoria ? '' : ' <span class="muted">(opcional)</span>'}
          <select name="classValueId" id="transferClassValue" ${obrigatoria ? 'required' : ''}>
            <option value="">${obrigatoria ? 'Selecione' : `Sem ${S.escape(classeDoProduto.name.toLowerCase())}`}</option>
            ${classeDoProduto.valores.map((valor) => `<option value="${S.escape(valor.id)}" ${valor.id === classValueId ? 'selected' : ''}>${S.escape(valor.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${classesIgnoradas.length ? `<p class="muted">Este produto também usa ${S.escape(classesIgnoradas.map((c) => c.name).join(', '))}, mas a transferência registra apenas ${S.escape(classeDoProduto.name)}.</p>` : ''}
    `;
  }

  // A tabela mostra o saldo DA COR escolhida, não o total do depósito. Saber
  // que há 12 no Galpão A não diz se algum deles é preto — e transferir do
  // depósito errado só é recusado no envio, com o formulário já preenchido.
  function saldoDaLinha(balance) {
    if (!classValueId) return balance.quantity;
    const linha = (balance.classes || []).find((c) => c.classValueId === classValueId);
    return linha ? linha.quantity : 0;
  }

  function balanceTable() {
    if (!productDetail) return '<p class="muted">Selecione um produto para ver o saldo de cada depósito.</p>';
    const cabecalho = classValueId
      ? `Saldo de ${S.escape(cores.get(classValueId)?.name || classValueId)}`
      : 'Saldo disponível';
    return `
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>Depósito</th><th>${cabecalho}</th></tr></thead>
          <tbody>
            ${productDetail.balances.length === 0 ? S.emptyRow(2, 'Nenhum depósito cadastrado.') : productDetail.balances.map((b) => `
              <tr><td>${S.escape(b.depositName)}</td><td>${S.formatQty(saldoDaLinha(b))}</td></tr>
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
          ${classeField()}
          <label>Observação<textarea name="note" rows="2"></textarea></label>
          <div class="finance-actions-row">
            <button type="submit">Transferir</button>
            <button type="button" class="secondary" id="transferCancel">Ver transferências</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <h3>Saldo por depósito</h3>
        <div id="transferBalances">${balanceTable()}</div>
      </div>
    `;

    document.getElementById('transferProduct')?.addEventListener('change', async (event) => {
      await loadProductDetail(event.target.value);
      render(event.target.value);
    });

    // Só a tabela é redesenhada: um render() completo apagaria origem, destino
    // e quantidade que o usuário já tinha preenchido.
    document.getElementById('transferClassValue')?.addEventListener('change', (event) => {
      classValueId = event.target.value;
      const painel = document.getElementById('transferBalances');
      if (painel) painel.innerHTML = balanceTable();
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
        // §18: os dois movimentos gerados levam a cor. Sem isto, a saída
        // tiraria 4 pretos da origem e a entrada daria 4 sem cor ao destino.
        classId: formData.get('classValueId') ? (classeDoProduto?.classId || '') : '',
        classValueId: formData.get('classValueId') || '',
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
