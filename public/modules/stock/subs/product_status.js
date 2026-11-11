window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// Consulta da posição de um produto: saldo por depósito, limites e histórico.
window.MavisSubscreenRegistry.stock.product_status = async function renderProductStatus(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);

  // O seletor deixou de ser um <select> (fase CH): sao 5.476 produtos depois da
  // importacao, e 457 deles tem nome repetido. O rotulo leva o SKU porque o
  // nome sozinho nao distingue qual das sete "SETA" e' esta.
  const opcoesProduto = window.MavisRotuloProduto.opcoes(meta.products);

  // O PRODUTO ABERTO SOBREVIVE AO REDESENHO (11/11/2026, pedido do usuário:
  // "toda vez que eu troco de aba ou faço algum movimento fora dessa página
  // ela joga pra essa outra"). Voltar à aba redesenha a tela (dados ao vivo ->
  // loadModule); o produto escolhido só valia no primeiro desenho, e o
  // seguinte abria o primeiro da lista ("0,100 UN PB314P..."). Agora o aberto
  // fica em state.stockStatusAbertoId (e no endereço, para o F5); o pedido de
  // fora (lista de produtos, cadastro, endereço) vem antes dele.
  const existe = (id) => Boolean(id) && meta.products.some((p) => p.id === id);
  let productId = [state.stockStatusProductId, state.stockStatusAbertoId].find(existe)
    || (meta.products[0] ? meta.products[0].id : '');
  state.stockStatusProductId = null;
  const abrirProduto = (id) => {
    productId = id;
    state.stockStatusAbertoId = id || null;
    // Só com esta tela na frente: a carga do meta demora, e a pessoa pode ter saído.
    if (typeof gravarTelaNoEndereco === 'function' && state.activeModule === 'stock' && state.activeSub === 'product_status') {
      gravarTelaNoEndereco('stock', 'product_status', { substituir: true });
    }
  };
  abrirProduto(productId);

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
    const historicoDePreco = result && Array.isArray(result.historicoDePreco) ? result.historicoDePreco : [];
    const deParaPreco = (par) => {
      if (!par) return '-';
      if (par.de === null || par.de === undefined) return S.formatBRL(par.para);
      if (Math.round(par.de * 100) === Math.round(par.para * 100)) return S.formatBRL(par.para);
      return `${S.formatBRL(par.de)} → ${S.formatBRL(par.para)}`;
    };

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Status do Produto')}
        <label>Produto
          ${meta.products.length
            ? renderSearchableSelect({ id: 'statusProduto', name: 'statusProduto', options: opcoesProduto, selectedValue: productId, placeholder: 'Buscar por nome ou SKU...' })
            : '<select disabled><option>Nenhum produto cadastrado</option></select>'}
        </label>
      </div>

      ${!product ? '<div class="panel"><p class="muted">Cadastre um produto para consultar o status.</p></div>' : `
        <div class="row">
          <div class="panel"><strong>${S.qtdVisivel(product.stockQuantity)}</strong><p class="muted">Saldo total (${S.escape(product.unit)})</p></div>
          <div class="panel"><strong>${S.situationBadge(product.situation)}</strong><p class="muted">Mín. ${S.formatQty(product.minStock)} / Máx. ${S.formatQty(product.maxStock)}</p></div>
          ${(typeof usuarioEhAdmin === 'function' && usuarioEhAdmin()) ? `<div class="panel"><strong>${S.formatBRL(Math.max(0, Number(product.stockQuantity)) * Number(product.costPrice))}</strong><p class="muted">Valor a custo</p></div>` : ''}
          <div class="panel"><strong>${S.statusBadge(product.status)}</strong><p class="muted">${S.escape(product.categoryName || 'Sem categoria')}</p></div>
        </div>

        <div class="panel">
          <h3>Quantidades Disponíveis por Estoque</h3>
          <!-- Era uma tabela de tres colunas (Deposito / Saldo / Participacao).
               A pergunta que se faz aqui e "de onde eu tiro este produto?", e
               ela se responde correndo o olho pelos cartoes. A participacao
               continua, no title de cada cartao. O painel mora em
               stock/shared.js porque nao e so desta tela. -->
          ${S.quantidadesPorEstoque(product)}
          ${product.unallocated > 0 ? '<p class="muted" style="margin-top:12px;">"Sem depósito definido" é o saldo que existe no cadastro do produto mas ainda não foi distribuído por movimentações. Registre uma entrada para alocá-lo.</p>' : ''}
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

        ${historicoDePreco.length ? `
        <div class="panel">
          <h3>Histórico de preço</h3>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Data</th><th>Usuário</th>${(typeof usuarioEhAdmin === 'function' && usuarioEhAdmin()) ? '<th>Custo</th>' : ''}<th>Venda</th><th>Origem</th></tr></thead>
              <tbody>${historicoDePreco.map((h) => `
                <tr>
                  <td>${S.escape(new Date(h.at).toLocaleString('pt-BR'))}</td>
                  <td>${S.escape(h.byName || '-')}</td>
                  ${(typeof usuarioEhAdmin === 'function' && usuarioEhAdmin()) ? `<td>${deParaPreco(h.custo)}</td>` : ''}
                  <td>${deParaPreco(h.venda)}</td>
                  <td>${S.escape(h.origem || '-')}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>` : ''}

        <div class="panel">
          <div class="finance-actions-row">
            <button type="button" id="statusNewMovement">Nova movimentação</button>
            <button type="button" class="secondary" id="statusEditProduct">Editar produto</button>
          </div>
        </div>
      `}
    `;

    attachSearchableSelect({
      id: 'statusProduto',
      options: opcoesProduto,
      onSelect: (value) => {
        abrirProduto(value);
        render();
      }
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
