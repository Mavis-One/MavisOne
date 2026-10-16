window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// NOVA MOVIMENTAÇÃO COM VÁRIOS ITENS (16/10/2026, pedido do usuário: "quero
// poder adicionar mais de um item em uma única movimentação, para não precisar
// abrir 15 movimentações de 15 itens diferentes").
//
// O desenho é o da transferência entre depósitos (new_transfer.js): em cima o
// que é DA MOVIMENTAÇÃO e vale para todos os itens — entrada ou saída,
// depósito, data, categoria, documento, observação —, embaixo a lista de itens,
// montada uma linha por vez. O servidor grava todos ou nenhum (ver a rota
// POST /api/stock/movements).
window.MavisSubscreenRegistry.stock.new_movement = async function renderNewMovement(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);

  // O seletor de produto não é um <select> (fase CH): são 5.476 produtos, e 457
  // com nome repetido — por isso o rótulo leva o SKU.
  const opcoesProduto = window.MavisRotuloProduto.opcoes(meta.products);
  const rotuloDoProduto = (productId) => (opcoesProduto.find((o) => o.value === productId) || {}).label || productId;

  // Veio do atalho "movimentar" de um produto: ele já abre na linha de adicionar.
  const preselectedProduct = state.stockMovementProductId || '';
  state.stockMovementProductId = null;

  let type = 'entrada';
  let itens = [];
  let produtoAtual = preselectedProduct;
  const cacheProduto = new Map();

  async function carregarProduto(productId) {
    if (!productId) return null;
    if (cacheProduto.has(productId)) return cacheProduto.get(productId);
    const info = { detail: null, classe: null, classesIgnoradas: [] };
    try {
      const res = await api(`/api/stock/products/${productId}`);
      info.detail = res.product;
    } catch (error) {
      info.detail = null;
    }
    try {
      const res = await api(`/api/stock/products/${productId}/classes`);
      const classes = res.classes || [];
      // O movimento guarda UMA classe (classId + classValueId): com duas, a
      // tela usa a primeira e AVISA, em vez de gravar metade em silêncio.
      info.classe = classes.find((c) => c.required) || classes[0] || null;
      info.classesIgnoradas = classes.filter((c) => c !== info.classe);
    } catch (error) {
      info.classe = null;
    }
    cacheProduto.set(productId, info);
    return info;
  }

  const depositoEscolhido = () => document.querySelector('#movementForm [name="depositId"]')?.value || '';

  // O saldo que importa é o DA COR no depósito escolhido: na saída, dizer "8"
  // quando os 8 estão em outro galpão faria a lista ser recusada no fim.
  function saldoNoDeposito(productId, classValueId) {
    const info = cacheProduto.get(productId);
    const deposito = depositoEscolhido();
    if (!info?.detail || !deposito) return null;
    const balance = (info.detail.balances || []).find((b) => b.depositId === deposito);
    if (!balance) return 0;
    if (!classValueId) return balance.quantity;
    const linha = (balance.classes || []).find((c) => c.classValueId === classValueId);
    return linha ? linha.quantity : 0;
  }

  function campoClasseDoNovoItem() {
    const info = produtoAtual ? cacheProduto.get(produtoAtual) : null;
    if (!info?.classe) return '';
    const obrigatoria = info.classe.required !== false;
    return `
      <label class="transfer-item-classe">${S.escape(info.classe.name)}${obrigatoria ? '' : ' <span class="muted">(opcional)</span>'}
        <select id="movementItemClasse" ${obrigatoria ? 'required' : ''}>
          <option value="">${obrigatoria ? 'Selecione' : `Sem ${S.escape(info.classe.name.toLowerCase())}`}</option>
          ${info.classe.valores.map((valor) => {
            // Na saída o saldo da cor no depósito decide a escolha; na entrada
            // não há o que decidir, e o número só polui o rótulo.
            const saldo = type === 'saida' ? saldoNoDeposito(produtoAtual, valor.id) : null;
            const rotulo = saldo === null ? valor.name : `${valor.name} — ${S.formatQty(saldo)} disponível`;
            return `<option value="${S.escape(valor.id)}">${S.escape(rotulo)}</option>`;
          }).join('')}
        </select>
      </label>
      ${info.classesIgnoradas.length ? `<p class="muted transfer-classe-aviso">Este produto também usa ${S.escape(info.classesIgnoradas.map((c) => c.name).join(', '))}, mas a movimentação registra apenas ${S.escape(info.classe.name)}.</p>` : ''}
    `;
  }

  const CAIXA_VAZIA = '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><path d="M10 12h4"></path></svg>';

  function tabelaDeItens() {
    if (!itens.length) {
      return `
        <div class="transfer-vazio">
          <div class="transfer-vazio-icone">${CAIXA_VAZIA}</div>
          <p class="transfer-vazio-titulo">Nenhum produto adicionado</p>
          <p class="muted">Use o formulário acima para adicionar produtos à movimentação.</p>
        </div>
      `;
    }
    return `
      <div class="table-scroll">
        <table class="table table-actions movimento-itens">
          <thead><tr><th>Produto</th><th>Variação</th><th>Quantidade</th><th>Custo unitário</th><th>Saldo no depósito</th><th></th></tr></thead>
          <tbody>
            ${itens.map((item, indice) => {
              const saldo = saldoNoDeposito(item.productId, item.classValueId);
              // Na saída, avisar já na linha: com a lista montada, a recusa do
              // servidor diria o produto, mas só depois de clicar.
              const falta = type === 'saida' && saldo !== null && item.quantity > saldo;
              return `
                <tr${falta ? ' class="transfer-linha-alerta"' : ''}>
                  <td>${S.escape(item.productName)}</td>
                  <td>${item.classLabel ? S.escape(item.classLabel) : '<span class="muted">—</span>'}</td>
                  <td>${S.formatQty(item.quantity)}</td>
                  <td>${S.formatBRL(item.unitCost)}</td>
                  <td>${saldo === null ? '<span class="muted">—</span>' : `${S.formatQty(saldo)}${falta ? ' <span class="finance-badge finance-badge-danger">insuficiente</span>' : ''}`}</td>
                  <td><button type="button" class="icon-button movimento-remover" data-indice="${indice}" title="Remover item" aria-label="Remover item">${S.trashIcon}</button></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function pintarItens() {
    const caixa = document.getElementById('movementItens');
    if (!caixa) return;
    caixa.innerHTML = tabelaDeItens();
    caixa.querySelectorAll('.movimento-remover').forEach((btn) => {
      btn.addEventListener('click', () => {
        itens.splice(Number(btn.dataset.indice), 1);
        pintarItens();
      });
    });
    const total = document.getElementById('movementTotalItens');
    if (total) total.textContent = itens.length ? `${itens.length} ${itens.length === 1 ? 'produto' : 'produtos'}` : '';
  }

  function pintarCampoClasse() {
    const caixa = document.getElementById('movementItemClasseBox');
    if (caixa) caixa.innerHTML = campoClasseDoNovoItem();
  }

  function limparNovoItem() {
    const input = document.getElementById('movementProductInput');
    const hidden = document.getElementById('movementProductValue');
    if (input) input.value = '';
    if (hidden) hidden.value = '';
    const qtd = document.getElementById('movementItemQtd');
    if (qtd) qtd.value = '1';
    const custo = document.getElementById('movementItemCusto');
    if (custo) custo.value = '0';
    produtoAtual = '';
    pintarCampoClasse();
    input?.focus();
  }

  function adicionarItem() {
    const escolhido = document.getElementById('movementProductValue')?.value || '';
    if (!escolhido) {
      showToast('Escolha um produto na lista — digitar o nome não basta.', 'warning');
      return;
    }
    const productId = escolhido;
    const quantidade = Number(document.getElementById('movementItemQtd')?.value || 0);
    if (!(quantidade > 0)) { showToast('Informe uma quantidade maior que zero.', 'warning'); return; }
    const custo = Number(document.getElementById('movementItemCusto')?.value || 0);

    const info = cacheProduto.get(productId);
    const seletorClasse = document.getElementById('movementItemClasse');
    const classValueId = seletorClasse ? seletorClasse.value : '';
    if (info?.classe && info.classe.required !== false && !classValueId) {
      showToast(`Selecione ${info.classe.name.toLowerCase()} deste produto.`, 'warning');
      return;
    }

    // Mesma regra do servidor: produto + cor repetidos SOMAM — duas linhas
    // iguais passariam cada uma contra o saldo inteiro.
    const existente = itens.find((i) => i.productId === productId && i.classValueId === classValueId);
    if (existente) {
      existente.quantity += quantidade;
      if (custo > 0) existente.unitCost = custo;
      showToast('Produto já estava na lista — as quantidades foram somadas.', 'info');
    } else {
      itens.push({
        productId,
        productName: rotuloDoProduto(productId),
        classId: classValueId ? (info?.classe?.classId || '') : '',
        classValueId,
        classLabel: classValueId ? (cores.get(classValueId)?.name || '') : '',
        quantity: quantidade,
        unitCost: custo
      });
    }
    limparNovoItem();
    pintarItens();
  }

  function categoryOptions(selecionada) {
    const list = (meta.movementCategories || []).filter((c) => !c.kind || c.kind === 'ambos' || c.kind === type);
    return S.options(list, selecionada, { empty: 'Sem categoria' });
  }

  function render() {
    const hoje = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <form id="movementForm">
        <div class="panel">
          ${S.pageHead('Nova Movimentação')}

          <div class="finance-period-group" style="margin-bottom:18px;">
            <button type="button" class="finance-pill ${type === 'entrada' ? 'active' : ''}" data-mov-type="entrada">Entrada</button>
            <button type="button" class="finance-pill ${type === 'saida' ? 'active' : ''}" data-mov-type="saida">Saída</button>
          </div>

          <div class="form-grid">
            <div class="row">
              <label>Depósito *<select name="depositId" id="movementDeposit" required>${S.options(meta.deposits, '', { empty: 'Selecione' })}</select></label>
              <label>Data *<input type="date" name="date" required value="${hoje}" /></label>
              <label>Categoria<select name="categoryId" id="movementCategoria">${categoryOptions('')}</select></label>
              <label>Documento<input name="document" placeholder="NF, pedido, romaneio..." /></label>
            </div>
            <label>Observação<textarea name="note" rows="2"></textarea></label>
          </div>
        </div>

        <div class="panel">
          <div class="cadastro-page-head">
            <div>
              <h3>Itens da movimentação</h3>
              <p class="muted" id="movementTotalItens"></p>
            </div>
          </div>

          <div class="row transfer-add-linha movimento-add-linha">
            <label class="transfer-add-produto">Produto
              ${renderSearchableSelect({ id: 'movementProduct', name: 'produtoBusca', options: opcoesProduto, selectedValue: produtoAtual, placeholder: 'Buscar por nome ou SKU...' })}
            </label>
            <div id="movementItemClasseBox" class="transfer-add-classe">${campoClasseDoNovoItem()}</div>
            <label class="transfer-add-qtd">Quantidade<input type="number" step="0.001" min="0.001" id="movementItemQtd" value="1" /></label>
            <label class="transfer-add-qtd">Custo unitário<input type="number" step="0.01" min="0" id="movementItemCusto" value="0" /></label>
            <div class="transfer-add-botao"><button type="button" id="movementAdicionar">Adicionar</button></div>
          </div>

          <div id="movementItens"></div>
        </div>

        <div class="panel">
          <div class="finance-actions-row">
            <button type="submit">Registrar movimentação</button>
            <button type="button" class="secondary" id="movementCancel">Ver movimentações</button>
          </div>
        </div>
      </form>
    `;

    // Entrada/Saída troca só o que depende do tipo — as categorias e o aviso
    // de saldo —, sem redesenhar: depósito, data e a lista continuam.
    content.querySelectorAll('[data-mov-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        type = btn.dataset.movType;
        content.querySelectorAll('[data-mov-type]').forEach((b) => b.classList.toggle('active', b.dataset.movType === type));
        const categoria = document.getElementById('movementCategoria');
        if (categoria) categoria.innerHTML = categoryOptions(categoria.value);
        pintarCampoClasse();
        pintarItens();
      });
    });

    attachSearchableSelect({
      id: 'movementProduct',
      options: opcoesProduto,
      onSelect: async (value) => {
        produtoAtual = value;
        // Carrega antes de pintar: o campo de cor depende do que a API responde.
        await carregarProduto(value);
        pintarCampoClasse();
        document.getElementById('movementItemQtd')?.focus();
      }
    });

    // O saldo é sempre do depósito escolhido: trocá-lo muda a coluna inteira
    // e o saldo de cada cor na linha de adicionar.
    document.getElementById('movementDeposit')?.addEventListener('change', () => {
      pintarCampoClasse();
      pintarItens();
    });
    document.getElementById('movementAdicionar')?.addEventListener('click', adicionarItem);

    // Enter na quantidade ou no custo adiciona, como em qualquer grade de
    // itens; sem isto o Enter enviaria a movimentação com a lista pela metade.
    ['movementItemQtd', 'movementItemCusto'].forEach((id) => {
      document.getElementById(id)?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); adicionarItem(); }
      });
    });

    document.getElementById('movementCancel')?.addEventListener('click', () => {
      state.activeSub = 'movements';
      loadModule('stock');
    });

    document.getElementById('movementForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (!itens.length) {
        showToast('Adicione ao menos um produto à movimentação.', 'warning');
        return;
      }
      const formData = new FormData(event.target);
      if (submitBtn) submitBtn.disabled = true;
      const payload = {
        type,
        depositId: formData.get('depositId'),
        date: formData.get('date'),
        categoryId: formData.get('categoryId') || '',
        document: formData.get('document') || '',
        note: formData.get('note') || '',
        items: itens.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          // classId acompanha o valor porque o razão guarda os dois.
          classId: item.classId,
          classValueId: item.classValueId
        }))
      };
      try {
        const res = await api('/api/stock/movements', { method: 'POST', body: JSON.stringify(payload) });
        const quantos = (res.movements || []).length || 1;
        showToast(`Movimentação registrada — ${quantos} ${quantos === 1 ? 'produto' : 'produtos'}.`, 'success');
        state.activeSub = 'movements';
        loadModule('stock');
      } catch (error) {
        showToast(error.message || 'Erro ao registrar movimentação.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    pintarItens();
  }

  if (preselectedProduct) await carregarProduto(preselectedProduct);
  render();
};
