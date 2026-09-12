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

  // ---------------------------------------------------------------------
  // A TABELA SAI EM PAGINAS DE 100 (fase CH)
  //
  // Esta tela desenhava uma linha por produto, com DOIS OU TRES <input> em
  // cada. Medido num Chrome de verdade com os 5.476 produtos importados:
  // 49.310 nos no DOM — a tela mais pesada do sistema.
  //
  // `edits` mora FORA do render e nao e' tocado pela troca de pagina: quem
  // altera o custo na pagina 1, vira para a 3 e clica em Salvar salva as duas.
  // Perder a alteracao ao virar a pagina seria pior do que nao paginar.
  // ---------------------------------------------------------------------
  const POR_PAGINA = 100;
  let pagina = 1;

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

  function rows(visiveis) {
    const table = currentTable();
    const isFixed = table && table.type === 'fixo';
    if (!visiveis.length) return S.emptyRow(isFixed ? 7 : 6, 'Nenhum produto encontrado.');
    return visiveis.map((product) => {
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

    const totalRegistros = products.length;
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / POR_PAGINA));
    // Buscar algo que encolhe a lista enquanto a pessoa esta na pagina 30 nao
    // pode deixa-la olhando para o vazio.
    const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
    pagina = paginaAtual;
    const primeiroDaPagina = (paginaAtual - 1) * POR_PAGINA;
    const visiveis = products.slice(primeiroDaPagina, primeiroDaPagina + POR_PAGINA);

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
        ${barraDePaginas('acima')}
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Produto</th><th>SKU</th><th>Saldo</th><th>Custo</th><th>Venda</th><th>Margem</th>
                ${table ? '<th>Preço na tabela</th>' : ''}
              </tr>
            </thead>
            <tbody id="priceManagerBody">${rows(visiveis)}</tbody>
          </table>
        </div>
        ${barraDePaginas('abaixo')}
        <div class="finance-actions-row" style="margin-top:12px;">
          <button type="button" id="priceManagerSave">Salvar alterações</button>
          <!-- A contagem e' de TUDO que esta alterado, e nao do que esta na
               tela: e' isso que Salvar vai gravar. Dizer "2 alterados" numa
               pagina onde ha 5 pendentes faria a pessoa salvar sem saber. -->
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
      pagina = 1;
      await load();
      render();
    });

    content.querySelectorAll('.lista-paginas-botoes [data-pagina]').forEach((botao) => {
      botao.addEventListener('click', () => {
        if (botao.disabled) return;
        pagina = Number(botao.dataset.pagina) || 1;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    let searchTimer = null;
    document.getElementById('priceManagerSearch')?.addEventListener('input', (event) => {
      search = event.target.value;
      // Buscar na pagina 30 e continuar na 30 mostraria "Nenhum produto
      // encontrado" — e a pessoa concluiria que a busca nao achou nada.
      pagina = 1;
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
