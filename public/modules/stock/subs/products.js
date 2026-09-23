window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.products = async function renderStockProducts(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);
  // `pendencia` entra aqui e nao precisa de mais nada: fetchProducts monta a
  // query varrendo este objeto, entao um filtro novo chega ao servidor so' por
  // existir nesta linha.
  const filters = { search: '', categoryId: '', status: '', situation: '', depositId: '', pendencia: '' };

  // ---------------------------------------------------------------------
  // PAGINA E ORDEM (fase CG)
  //
  // Moram na mesma casa dos filtros de proposito: os tres descrevem juntos o
  // recorte que esta na tela, e mexer num sem cuidar do outro e' o que produz
  // "pagina 40 de 2".
  //
  // Nome crescente e' o padrao porque era o que o servidor ja fazia
  // (list.sort por name). Quem nunca clicar em cabecalho nenhum ve a lista
  // exatamente como via antes.
  // ---------------------------------------------------------------------
  const POR_PAGINA = 100;
  let pagina = 1;
  const ordem = { campo: 'name', direcao: 'asc' };
  // Preenchido por fetchProducts a cada carga (fase CT).
  let pendencias = {};

  // Cada coluna e' comparada pelo que ela E', e nao como texto solto:
  //   texto  - comparacao pt-BR, sem diferenciar acento nem maiuscula, e com
  //            numeric:true, que compara pedacos numericos como numero. E' por
  //            isso que o SKU entra aqui e nao como numero puro: '100860' e
  //            'ZM27011250' convivem no mesmo cadastro, e o collator ordena os
  //            dois sem que eu tenha de adivinhar qual e' qual.
  //   numero - custo, venda, margem e saldo JA chegam como numero do servidor.
  //            Arrancar os digitos deles (o que Cadastros faz com 'codigo')
  //            destruiria o negativo e a casa decimal: -100.0% de margem viraria
  //            1000, e R$ 1.234,56 viraria 123456.
  //   alerta - a Situacao ordena por urgencia, nao por alfabeto. Ver abaixo.
  const COLUNAS_ORDENAVEIS = {
    name: { rotulo: 'Produto', tipo: 'texto' },
    sku: { rotulo: 'SKU', tipo: 'texto' },
    categoryName: { rotulo: 'Categoria', tipo: 'texto' },
    unit: { rotulo: 'Un.', tipo: 'texto' },
    costPrice: { rotulo: 'Custo', tipo: 'numero' },
    salePrice: { rotulo: 'Venda', tipo: 'numero' },
    margin: { rotulo: 'Margem', tipo: 'numero' },
    stockQuantity: { rotulo: 'Saldo', tipo: 'numero' },
    situation: { rotulo: 'Situacao', tipo: 'alerta' },
    status: { rotulo: 'Status', tipo: 'texto' }
  };

  // A Situacao em ordem alfabetica ('abaixo-minimo', 'acima-maximo', 'normal',
  // 'zerado') nao responde a pergunta que leva alguem a clicar nela, que e'
  // "o que precisa de mim primeiro?". Entao ela ordena por urgencia: crescente
  // traz o que esta faltando, decrescente traz o que esta sobrando.
  const URGENCIA = { zerado: 0, 'abaixo-minimo': 1, 'acima-maximo': 2, normal: 3 };
  const comparadorDePtBr = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

  function ordenar(lista) {
    const def = COLUNAS_ORDENAVEIS[ordem.campo] || COLUNAS_ORDENAVEIS.name;
    const campo = COLUNAS_ORDENAVEIS[ordem.campo] ? ordem.campo : 'name';
    return lista.slice().sort((a, b) => {
      const va = a[campo];
      const vb = b[campo];
      const vazioA = va === null || va === undefined || String(va).trim() === '';
      const vazioB = vb === null || vb === undefined || String(vb).trim() === '';
      // VAZIO VAI SEMPRE PARA O FIM, nos dois sentidos. Inverter junto com a
      // direcao encheria o topo de tracos ao pedir "maior primeiro" — e quem
      // ordena por Categoria quer ver as categorias, nao quem nao tem.
      //
      // Aqui isso pesa: a importacao do Viper entrou sem categoria nenhuma, e
      // sem esta regra um clique em Categoria mostraria 100 linhas de "-".
      if (vazioA && vazioB) return 0;
      if (vazioA) return 1;
      if (vazioB) return -1;

      let resultado;
      if (def.tipo === 'numero') {
        resultado = Number(va) - Number(vb);
      } else if (def.tipo === 'alerta') {
        const ua = URGENCIA[va] === undefined ? 99 : URGENCIA[va];
        const ub = URGENCIA[vb] === undefined ? 99 : URGENCIA[vb];
        resultado = ua - ub;
      } else {
        resultado = comparadorDePtBr.compare(String(va), String(vb));
      }
      // Empate desempatado pelo nome, e depois pelo id. Sem isso, dois produtos
      // de mesmo custo trocariam de lugar entre um render e outro e a lista
      // pareceria se mexer sozinha.
      if (resultado === 0) resultado = comparadorDePtBr.compare(String(a.name || ''), String(b.name || ''));
      if (resultado === 0) resultado = String(a.id).localeCompare(String(b.id));
      return ordem.direcao === 'asc' ? resultado : -resultado;
    });
  }

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
      // As contagens de pendência vêm do servidor e são guardadas aqui: o
      // cartão as mostra sem que esta tela precise saber o que "sem preço"
      // significa. A regra tem um dono só, em lib/stock-core.js.
      pendencias = res.pendencias || {};
      return res.products || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar produtos.', 'error');
      pendencias = {};
      return [];
    }
  }

  function totalsPanel(products) {
    const totalUnits = products.reduce((sum, p) => sum + Number(p.stockQuantity || 0), 0);
    const totalCost = products.reduce((sum, p) => sum + Number(p.stockQuantity || 0) * Number(p.costPrice || 0), 0);
    const alerts = products.filter((p) => p.situation === 'abaixo-minimo' || p.situation === 'zerado').length;
    return `
      <div class="row">
        <div class="panel"><strong>${products.length.toLocaleString('pt-BR')}</strong><p class="muted">Produtos listados</p></div>
        <div class="panel"><strong>${S.formatQty(totalUnits)}</strong><p class="muted">Unidades em estoque</p></div>
        <div class="panel"><strong>${S.formatBRL(totalCost)}</strong><p class="muted">Valor a custo</p></div>
        <div class="panel"><strong>${alerts}</strong><p class="muted">Zerados ou abaixo do mínimo</p></div>
        <!-- A CONTAGEM E' DA SELECAO, NAO DA PAGINA (fase CT).
             Sem este cartao o filtro de pendencia existia sem ninguem saber
             que havia o que filtrar: 3.078 produtos sem preco nao se anunciam,
             e a lista ordenada por nome nunca os junta. -->
        <div class="panel">
          <strong>${Number(pendencias.qualquer || 0).toLocaleString('pt-BR')}</strong>
          <p class="muted">Com pendência de cadastro${
            (pendencias['sem-preco'] || 0) > 0
              ? ` · ${Number(pendencias['sem-preco']).toLocaleString('pt-BR')} sem preço`
              : ''
          }</p>
        </div>
      </div>
    `;
  }

  async function render() {
    // `todos` e' a lista inteira ja filtrada pelo servidor e ordenada aqui;
    // `visiveis` e' so' a centena que vai para a tela.
    //
    // A ORDEM VALE SOBRE A LISTA INTEIRA, e nao sobre a pagina visivel. E' o
    // ponto que decide se ordenar serve para alguma coisa: ordenar so' as 100
    // linhas da tela reembaralharia cada pagina por conta propria, a pagina 2
    // comecaria de novo no "A", e quem clicasse em "Custo" procurando o mais
    // caro acharia o mais caro DAQUELE PEDACO.
    const todos = ordenar(await fetchProducts());

    const totalRegistros = todos.length;
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / POR_PAGINA));
    // A pagina fica presa entre 1 e o total: um filtro que encolhe a lista
    // enquanto a pessoa esta na pagina 40 nao pode deixa-la olhando para o vazio.
    const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
    pagina = paginaAtual;
    const primeiroDaPagina = (paginaAtual - 1) * POR_PAGINA;
    const visiveis = todos.slice(primeiroDaPagina, primeiroDaPagina + POR_PAGINA);

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
            <!-- A FILA DE PENDENCIAS DE CADASTRO (fase CT).
                 Nao se confunde com "Situacao": aquela fala do SALDO (zerado,
                 abaixo do minimo) e esta fala do CADASTRO (sem preco, sem NCM).
                 Um produto pode estar com saldo normal e sem preco nenhum --
                 3.078 dos 5.475 importados estao exatamente assim. -->
            <label>Pendência de cadastro
              <select name="pendencia">
                <option value="">Todas</option>
                <option value="qualquer" ${filters.pendencia === 'qualquer' ? 'selected' : ''}>Qualquer pendência</option>
                <option value="sem-preco" ${filters.pendencia === 'sem-preco' ? 'selected' : ''}>Sem preço de venda</option>
                <option value="sem-custo" ${filters.pendencia === 'sem-custo' ? 'selected' : ''}>Sem custo</option>
                <option value="sem-ncm" ${filters.pendencia === 'sem-ncm' ? 'selected' : ''}>Sem NCM</option>
              </select>
            </label>
          </div>
          <div class="finance-actions-row">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="stockProductClear">Limpar</button>
          </div>
        </form>
      </div>

      ${totalsPanel(todos)}

      <div class="panel">
        ${barraDePaginas('acima')}
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <!-- Cada coluna e' um button de verdade dentro do th: assim ela
                     recebe foco pelo teclado e e' anunciada como botao. Um th com
                     addEventListener pareceria clicavel so' para quem usa mouse.
                     O aria-sort diz ao leitor de tela o que a setinha diz a quem
                     enxerga. (Sem crase neste comentario: ele mora dentro de um
                     template literal, e uma crase fecharia a string.) -->
                ${Object.entries(COLUNAS_ORDENAVEIS).map(([campo, def]) => {
                  const ativa = campo === ordem.campo;
                  const seta = ativa ? (ordem.direcao === 'asc' ? '▲' : '▼') : '';
                  // O title diz o que o PROXIMO clique fara, e nao o que ja esta feito.
                  const proxima = ativa && ordem.direcao === 'asc' ? 'decrescente' : 'crescente';
                  return `
                    <th aria-sort="${ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}">
                      <button type="button" class="lista-ordenar ${ativa ? 'is-ativa' : ''}"
                              data-ordenar="${campo}"
                              title="Ordenar por ${S.escape(def.rotulo)} em ordem ${proxima}">
                        <span>${S.escape(def.rotulo)}</span>
                        <span class="lista-ordenar-seta" aria-hidden="true">${seta}</span>
                      </button>
                    </th>`;
                }).join('')}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${visiveis.length === 0
                ? S.emptyRow(11, 'Nenhum produto encontrado.')
                : visiveis.map((product) => `
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
        ${barraDePaginas('abaixo')}
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
      pagina = 1;
      render();
    });

    document.getElementById('stockProductClear')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      pagina = 1;
      // A ORDEM NAO E' LIMPA junto. "Limpar" e' sobre os filtros, que estao no
      // formulario acima; a ordem foi escolhida no cabecalho da tabela e a
      // pessoa nao pediu para desfaze-la.
      render();
    });

    content.querySelectorAll('.lista-paginas-botoes [data-pagina]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        pagina = Number(btn.dataset.pagina) || 1;
        render();
        // Sem isto, virar a pagina no rodape deixaria a pessoa olhando para o
        // fim de uma tabela que acabou de trocar inteira.
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    content.querySelectorAll('[data-ordenar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const campo = btn.dataset.ordenar;
        if (!COLUNAS_ORDENAVEIS[campo]) return;
        // Mesma coluna inverte. Coluna nova comeca crescente em vez de herdar a
        // direcao da anterior: herdar faria a lista aparecer ao contrario do que
        // a pessoa acabou de pedir, sem ela ter pedido nada disso.
        if (campo === ordem.campo) {
          ordem.direcao = ordem.direcao === 'asc' ? 'desc' : 'asc';
        } else {
          ordem.campo = campo;
          ordem.direcao = 'asc';
        }
        // Ordenar muda a lista inteira, entao a pagina em que a pessoa estava
        // deixou de querer dizer o que queria.
        pagina = 1;
        render();
      });
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
        const product = todos.find((p) => p.id === btn.dataset.delete);
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
