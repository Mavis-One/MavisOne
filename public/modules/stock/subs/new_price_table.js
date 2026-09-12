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

  // ---------------------------------------------------------------------
  // PAGINACAO — o mesmo desenho do Novo Catalogo (subs/new_catalog.js).
  //
  // Medido no navegador com os dados reais, antes: 32.895 nos no DOM e 5.484
  // campos numa tela que tem oito. A lista de "Preco na tabela" era um <input
  // type="number"> por produto do cadastro, todos de uma vez — e montados
  // TAMBEM quando o tipo era Markup, que nem usa a lista: o bloco ficava
  // `hidden`, com os 5.475 campos dentro dele.
  //
  // `itemPrices` mora FORA do render e a troca de pagina nao o toca (o
  // captureItemInputs() ja guardava o que foi digitado antes de redesenhar):
  // digitar na pagina 1, virar para a 4 e salvar grava as duas.
  // ---------------------------------------------------------------------
  const POR_PAGINA = 100;
  let pagina = 1;

  function produtosFiltrados() {
    const term = itemSearch.trim().toLowerCase();
    return meta.products.filter((p) => !term || `${p.name} ${p.sku}`.toLowerCase().includes(term));
  }

  function itemRows(products) {
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
    // Tipo Markup nao usa a lista: nao monta nada. Antes ela era montada e
    // escondida, o que custa o mesmo ao navegador e nao serve a ninguem.
    const daLista = type === 'fixo';
    const filtrados = daLista ? produtosFiltrados() : [];
    const totalRegistros = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / POR_PAGINA));
    const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
    pagina = paginaAtual;
    const primeiroDaPagina = (paginaAtual - 1) * POR_PAGINA;
    const visiveis = filtrados.slice(primeiroDaPagina, primeiroDaPagina + POR_PAGINA);

    const barraDePaginas = (posicao) => (totalRegistros === 0 ? '' : `
      <div class="lista-paginas lista-paginas-${posicao}">
        <span class="muted">
          Mostrando <strong>${primeiroDaPagina + 1}</strong>–<strong>${primeiroDaPagina + visiveis.length}</strong>
          de <strong>${totalRegistros.toLocaleString('pt-BR')}</strong> produto${totalRegistros === 1 ? '' : 's'}
        </span>
        ${totalPaginas > 1 ? `
          <div class="lista-paginas-botoes">
            <button type="button" class="secondary" data-pagina="1" ${paginaAtual === 1 ? 'disabled' : ''} title="Primeira página" aria-label="Primeira página">««</button>
            <button type="button" class="secondary" data-pagina="${paginaAtual - 1}" ${paginaAtual === 1 ? 'disabled' : ''} title="Página anterior" aria-label="Página anterior">‹</button>
            <span class="lista-paginas-atual">Página ${paginaAtual} de ${totalPaginas}</span>
            <button type="button" class="secondary" data-pagina="${paginaAtual + 1}" ${paginaAtual === totalPaginas ? 'disabled' : ''} title="Próxima página" aria-label="Próxima página">›</button>
            <button type="button" class="secondary" data-pagina="${totalPaginas}" ${paginaAtual === totalPaginas ? 'disabled' : ''} title="Última página" aria-label="Última página">»»</button>
          </div>
        ` : ''}
      </div>
    `);

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
            ${barraDePaginas('acima')}
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Produto</th><th>SKU</th><th>Custo</th><th>Preço na tabela</th></tr></thead>
                <tbody id="priceItemBody">${daLista ? itemRows(visiveis) : ''}</tbody>
              </table>
            </div>
            ${barraDePaginas('abaixo')}
            ${itemPrices.size ? `<p class="muted">${itemPrices.size.toLocaleString('pt-BR')} produto${itemPrices.size === 1 ? '' : 's'} com preço informado — o que foi digitado em outras páginas continua valendo ao salvar.</p>` : ''}
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
      // Buscar na pagina 30 e continuar na 30 mostraria "Nenhum produto
      // encontrado" — e a pessoa concluiria que a busca nao achou nada.
      pagina = 1;
      // Re-render inteiro, e nao so' o <tbody>: a barra de paginas mudou.
      render();
      // E o foco volta para o campo, no fim do texto: sem isto a pessoa perde
      // o cursor a cada letra digitada.
      const input = document.getElementById('priceItemSearch');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });

    content.querySelectorAll('[data-pagina]').forEach((botao) => {
      botao.addEventListener('click', () => {
        // Guarda o que foi digitado ANTES de trocar de pagina: sem isto, virar
        // a pagina apagaria os precos da pagina atual.
        captureItemInputs();
        pagina = Number(botao.dataset.pagina) || 1;
        render();
      });
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
