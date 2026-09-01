window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// UMA MOVIMENTAÇÃO, VÁRIOS PRODUTOS.
//
// Antes esta tela transferia UM produto por vez. Esvaziar uma prateleira de 12
// itens era preencher origem, destino e data doze vezes — e doze chances de
// errar o destino em uma delas, resultado que só aparece semanas depois, quando
// alguém procura o produto no depósito errado.
//
// Agora o cabeçalho (origem, destino, data, observação) é preenchido uma vez e
// os produtos entram numa lista. O envio é um só, e o servidor confere TODOS os
// itens antes de gravar QUALQUER um: ou a movimentação inteira acontece, ou
// nada acontece. Meia movimentação seria pior do que nenhuma.
//
// A COR CONTINUA POR ITEM, E ISSO NÃO É DETALHE
// ---------------------------------------------
// Cada produto tem a própria classe (cor, voltagem). Um seletor único no
// cabeçalho valeria para todos os itens da lista, o que é errado na primeira
// movimentação que misture dois produtos — e o erro é silencioso: o saldo total
// fica certo e a cor some de um depósito sem aparecer no outro (§18).
window.MavisSubscreenRegistry.stock.new_transfer = async function renderNewTransfer(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);

  // Itens já adicionados. Cada um carrega o nome e o rótulo da cor porque a
  // tabela é redesenhada sozinha, sem voltar à API a cada linha.
  let itens = [];
  // productId -> { detail, classe, classesIgnoradas }. Escolher o mesmo produto
  // duas vezes não repete duas chamadas.
  const cacheProduto = new Map();
  let produtoAtual = null;

  const opcoesProduto = (meta.products || []).map((p) => ({ value: p.id, label: p.name }));

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
      // Uma classe por movimento, como na entrada e na venda: o razão guarda um
      // classValueId, e a transferência gera dois movimentos.
      info.classe = classes.find((c) => c.required) || classes[0] || null;
      info.classesIgnoradas = classes.filter((c) => c !== info.classe);
    } catch (error) {
      info.classe = null;
    }
    cacheProduto.set(productId, info);
    return info;
  }

  function origemSelecionada() {
    return document.querySelector('[name="originDepositId"]')?.value || '';
  }

  // O saldo que importa é o DA COR escolhida no depósito de ORIGEM. Saber que
  // há 12 no Galpão A não diz se algum deles é preto — e transferir do depósito
  // errado só seria recusado no envio, com a lista inteira já montada.
  function saldoNaOrigem(productId, classValueId) {
    const info = cacheProduto.get(productId);
    const origem = origemSelecionada();
    if (!info?.detail || !origem) return null;
    const balance = (info.detail.balances || []).find((b) => b.depositId === origem);
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
        <select id="transferItemClasse" ${obrigatoria ? 'required' : ''}>
          <option value="">${obrigatoria ? 'Selecione' : `Sem ${S.escape(info.classe.name.toLowerCase())}`}</option>
          ${info.classe.valores.map((valor) => `<option value="${S.escape(valor.id)}">${S.escape(valor.name)}</option>`).join('')}
        </select>
      </label>
      ${info.classesIgnoradas.length ? `<p class="muted transfer-classe-aviso">Este produto também usa ${S.escape(info.classesIgnoradas.map((c) => c.name).join(', '))}, mas a transferência registra apenas ${S.escape(info.classe.name)}.</p>` : ''}
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
        <table class="table table-actions">
          <thead><tr><th>Produto</th><th>Variação</th><th>Quantidade</th><th>Saldo na origem</th><th></th></tr></thead>
          <tbody>
            ${itens.map((item, indice) => {
              const saldo = saldoNaOrigem(item.productId, item.classValueId);
              // Avisar aqui, e não só no envio: com a lista montada, um erro
              // genérico do servidor não diz QUAL linha está sem saldo.
              const falta = saldo !== null && item.quantity > saldo;
              return `
                <tr${falta ? ' class="transfer-linha-alerta"' : ''}>
                  <td>${S.escape(item.productName)}</td>
                  <td>${item.classLabel ? S.escape(item.classLabel) : '<span class="muted">—</span>'}</td>
                  <td>${S.formatQty(item.quantity)}</td>
                  <td>${saldo === null ? '<span class="muted">—</span>' : `${S.formatQty(saldo)}${falta ? ' <span class="finance-badge finance-badge-danger">insuficiente</span>' : ''}`}</td>
                  <td><button type="button" class="icon-button transfer-remover" data-indice="${indice}" title="Remover item" aria-label="Remover item">${S.trashIcon}</button></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function pintarItens() {
    const caixa = document.getElementById('transferItens');
    if (!caixa) return;
    caixa.innerHTML = tabelaDeItens();
    caixa.querySelectorAll('.transfer-remover').forEach((btn) => {
      btn.addEventListener('click', () => {
        itens.splice(Number(btn.dataset.indice), 1);
        pintarItens();
      });
    });
    const total = document.getElementById('transferTotalItens');
    if (total) total.textContent = itens.length ? `${itens.length} ${itens.length === 1 ? 'produto' : 'produtos'}` : '';
  }

  function pintarCampoClasse() {
    const caixa = document.getElementById('transferItemClasseBox');
    if (caixa) caixa.innerHTML = campoClasseDoNovoItem();
  }

  function limparNovoItem() {
    const input = document.getElementById('transferProdutoInput');
    const hidden = document.getElementById('transferProdutoValue');
    if (input) input.value = '';
    if (hidden) hidden.value = '';
    const qtd = document.getElementById('transferItemQtd');
    if (qtd) qtd.value = '1';
    produtoAtual = null;
    pintarCampoClasse();
  }

  function adicionarItem() {
    const productId = document.getElementById('transferProdutoValue')?.value || '';
    if (!productId) { showToast('Escolha um produto para adicionar.', 'warning'); return; }
    const quantidade = Number(document.getElementById('transferItemQtd')?.value || 0);
    if (!(quantidade > 0)) { showToast('Informe uma quantidade maior que zero.', 'warning'); return; }

    const info = cacheProduto.get(productId);
    const seletorClasse = document.getElementById('transferItemClasse');
    const classValueId = seletorClasse ? seletorClasse.value : '';
    if (info?.classe && info.classe.required !== false && !classValueId) {
      showToast(`Selecione ${info.classe.name.toLowerCase()} deste produto.`, 'warning');
      return;
    }

    // Mesma regra do servidor: produto + cor repetidos SOMAM. Duas linhas do
    // mesmo item passariam nas duas validações contra o saldo inteiro e
    // deixariam a origem negativa — e, na tela, duas linhas iguais só fazem
    // quem confere contar duas vezes.
    const existente = itens.find((i) => i.productId === productId && i.classValueId === classValueId);
    if (existente) {
      existente.quantity += quantidade;
      showToast('Produto já estava na lista — as quantidades foram somadas.', 'info');
    } else {
      itens.push({
        productId,
        productName: (meta.products || []).find((p) => p.id === productId)?.name || productId,
        classId: classValueId ? (info?.classe?.classId || '') : '',
        classValueId,
        classLabel: classValueId ? (cores.get(classValueId)?.name || '') : '',
        quantity: quantidade
      });
    }
    limparNovoItem();
    pintarItens();
  }

  function render() {
    const hoje = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <form id="transferForm">
        <div class="panel">
          ${S.pageHead('Nova Transferência Entre Depósitos', 'O saldo total do produto não muda — apenas a distribuição entre depósitos.')}
          <div class="form-grid">
            <div class="row">
              <label>Depósito de origem *<select name="originDepositId" id="transferOrigem" required>${S.options(meta.deposits, '', { empty: 'Selecione' })}</select></label>
              <label>Depósito de destino *<select name="destinationDepositId" required>${S.options(meta.deposits, '', { empty: 'Selecione' })}</select></label>
              <label>Data da movimentação *<input type="date" name="date" required value="${hoje}" /></label>
            </div>
            <div class="row">
              <label>Documento<input name="document" /></label>
            </div>
            <label>Observação<textarea name="note" rows="2"></textarea></label>
          </div>
        </div>

        <div class="panel">
          <div class="cadastro-page-head">
            <div>
              <h3>Itens da movimentação</h3>
              <p class="muted" id="transferTotalItens"></p>
            </div>
          </div>

          <div class="row transfer-add-linha">
            <label class="transfer-add-produto">Produto
              ${renderSearchableSelect({ id: 'transferProduto', name: 'produtoBusca', options: opcoesProduto, placeholder: 'Buscar produto...' })}
            </label>
            <div id="transferItemClasseBox" class="transfer-add-classe"></div>
            <label class="transfer-add-qtd">Quantidade<input type="number" step="0.001" min="0.001" id="transferItemQtd" value="1" /></label>
            <div class="transfer-add-botao"><button type="button" id="transferAdicionar">Adicionar</button></div>
          </div>

          <div id="transferItens"></div>
        </div>

        <div class="panel">
          <div class="finance-actions-row">
            <button type="submit">Transferir</button>
            <button type="button" class="secondary" id="transferCancel">Ver transferências</button>
          </div>
        </div>
      </form>
    `;

    attachSearchableSelect({
      id: 'transferProduto',
      options: opcoesProduto,
      onSelect: async (value) => {
        produtoAtual = value;
        // Carrega antes de pintar: o campo de cor depende do que a API responde,
        // e pintar duas vezes faria a caixa piscar a cada produto escolhido.
        await carregarProduto(value);
        pintarCampoClasse();
      }
    });

    // O saldo é sempre relativo à origem: trocá-la muda a coluna inteira.
    document.getElementById('transferOrigem')?.addEventListener('change', pintarItens);
    document.getElementById('transferAdicionar')?.addEventListener('click', adicionarItem);

    // Enter na quantidade adiciona, como em qualquer grade de itens. Sem isto o
    // Enter enviaria o formulário com a lista pela metade.
    document.getElementById('transferItemQtd')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); adicionarItem(); }
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

      if (!itens.length) {
        showToast('Adicione ao menos um produto à movimentação.', 'warning');
        return;
      }
      if (formData.get('originDepositId') === formData.get('destinationDepositId')) {
        showToast('Origem e destino não podem ser o mesmo depósito.', 'warning');
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      const payload = {
        originDepositId: formData.get('originDepositId'),
        destinationDepositId: formData.get('destinationDepositId'),
        date: formData.get('date'),
        document: formData.get('document') || '',
        note: formData.get('note') || '',
        items: itens.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          classId: item.classId,
          classValueId: item.classValueId
        }))
      };
      try {
        const res = await api('/api/stock/transfers', { method: 'POST', body: JSON.stringify(payload) });
        const quantos = (res.transfers || []).length || 1;
        showToast(`Movimentação registrada — ${quantos} ${quantos === 1 ? 'produto transferido' : 'produtos transferidos'}.`, 'success');
        state.activeSub = 'transfers';
        loadModule('stock');
      } catch (error) {
        showToast(error.message || 'Erro ao transferir.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    pintarItens();
  }

  render();
};
