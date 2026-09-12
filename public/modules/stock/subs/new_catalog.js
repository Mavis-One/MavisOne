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

  // ---------------------------------------------------------------------
  // A TABELA SAI EM PAGINAS DE 100 (fase CH)
  //
  // Esta tela desenhava uma linha com caixa de marcar por produto. Medido num
  // Chrome de verdade com os 5.476 importados: 32.895 nos no DOM.
  //
  // `selected` mora FORA do render e a troca de pagina nao o toca: marcar na
  // pagina 1, virar para a 4 e salvar grava as duas. Perder a marcacao ao
  // virar a pagina seria pior do que nao paginar.
  // ---------------------------------------------------------------------
  const POR_PAGINA = 100;
  let pagina = 1;

  // O filtro virou funcao propria porque DUAS coisas precisam dele: as linhas
  // da pagina e o botao "marcar todos os filtrados". Filtrar em dois lugares
  // faria o botao marcar um conjunto diferente do que a tela mostra.
  function produtosFiltrados() {
    const term = search.trim().toLowerCase();
    return meta.products.filter((p) => !term || `${p.name} ${p.sku}`.toLowerCase().includes(term));
  }

  function productRows(visiveis) {
    if (!visiveis.length) return S.emptyRow(4, 'Nenhum produto encontrado.');
    return visiveis.map((product) => `
      <tr>
        <td><input type="checkbox" data-product="${product.id}" ${selected.has(product.id) ? 'checked' : ''} /></td>
        <td>${S.escape(product.name)}</td>
        <td>${S.escape(product.sku || '-')}</td>
        <td>${S.formatBRL(product.salePrice)}</td>
      </tr>
    `).join('');
  }

  function render() {
    const filtrados = produtosFiltrados();
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
            <button type="button" class="secondary finance-pill-sm" id="catalogSelectAll">Selecionar os ${totalRegistros.toLocaleString('pt-BR')} filtrados</button>
            <button type="button" class="secondary finance-pill-sm" id="catalogClear">Limpar seleção</button>
          </div>
          <label>Buscar produto<input type="search" id="catalogSearch" value="${S.escape(search)}" placeholder="Nome ou SKU" /></label>
          ${barraDePaginas('acima')}
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th style="width:48px;"></th><th>Produto</th><th>SKU</th><th>Preço de venda</th></tr></thead>
              <tbody id="catalogBody">${productRows(visiveis)}</tbody>
            </table>
          </div>
          ${barraDePaginas('abaixo')}

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

    content.querySelectorAll('.lista-paginas-botoes [data-pagina]').forEach((botao) => {
      botao.addEventListener('click', () => {
        if (botao.disabled) return;
        pagina = Number(botao.dataset.pagina) || 1;
        render();
      });
    });

    document.getElementById('catalogSearch')?.addEventListener('input', (event) => {
      search = event.target.value;
      // Buscar na pagina 30 e continuar na 30 mostraria "Nenhum produto
      // encontrado" — e a pessoa concluiria que a busca nao achou nada.
      pagina = 1;
      // Re-render inteiro, e nao so' o <tbody>: a barra de paginas e a
      // contagem no botao "Selecionar os N filtrados" tambem mudaram.
      render();
      // E o foco volta para o campo, no fim do texto: sem isto a pessoa perde
      // o cursor a cada letra digitada.
      const input = document.getElementById('catalogSearch');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });

    document.getElementById('catalogSelectAll')?.addEventListener('click', () => {
      // Pela LISTA, e nao varrendo o DOM: varrer o DOM marcaria so' as 100 da
      // pagina, e quem monta um catalogo a partir de uma busca perderia o que
      // tinha antes de a tela paginar.
      produtosFiltrados().forEach((produto) => selected.add(produto.id));
      render();
    });

    document.getElementById('catalogClear')?.addEventListener('click', () => {
      // Limpa a selecao INTEIRA, inclusive o que foi marcado em outras paginas:
      // "Limpar selecao" que deixasse marcacoes invisiveis para tras gravaria
      // um catalogo com produtos que a pessoa acredita ter desmarcado.
      selected.clear();
      render();
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
