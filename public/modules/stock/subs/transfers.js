window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// "Entre Depósitos": o saldo total do produto nunca muda — a transferência move
// entre depósitos, não cria nem consome.
//
// FASE CZ: agora há TRÂNSITO. Uma carga enviada gera saída na origem e entrada
// no balde de trânsito; a entrada no destino só acontece na CONFERÊNCIA. Por
// isso a lista tem situação, filtro de pendentes e a ação de conferir — antes,
// sair e chegar eram o mesmo instante e não havia nada a acompanhar.
// `situacaoInicial` e' o que separa "Entre Depositos" (tudo) de "Cargas a
// Conferir" (so' as pendentes). Duas entradas de menu, uma tela: quem esta na
// filial precisa de um lugar para PERGUNTAR "chegou algo para mim?", e mandar
// essa pessoa abrir a lista inteira e montar um filtro e' como a carga fica
// dias sem conferencia.
async function renderTransfers(ctx, situacaoInicial) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);

  // O seletor de produto deixou de ser um <select> (fase CH): sao 5.476
  // produtos depois da importacao, e 457 deles tem nome repetido. O rotulo leva
  // o SKU porque o nome sozinho nao distingue.
  const opcoesProduto = window.MavisRotuloProduto.opcoes(meta.products);
  const cores = S.indiceDeCores(meta);
  const filters = { search: '', productId: '', depositId: '', status: situacaoInicial || '' };

  const SITUACOES = [
    { id: 'enviada', name: 'Em trânsito (aguardando conferência)' },
    { id: 'recebida', name: 'Recebida' }
  ];

  // A situação da LINHA, já sabendo do parcial: "Em trânsito" sozinho não
  // distingue a carga que nem começou a chegar da que chegou pela metade, e é
  // essa diferença que decide se alguém precisa ir ao balcão procurar caixa.
  function badgeSituacao(t) {
    if (t.status !== 'enviada') return S.badge('Recebida', 'success');
    if (Number(t.receivedQuantity || 0) > 0) {
      return S.badge(`Parcial — faltam ${S.formatQty(t.pendingQuantity)}`, 'warning');
    }
    return S.badge('Em trânsito', 'info');
  }

  async function fetchTransfers() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const res = await api(`/api/stock/transfers?${params.toString()}`);
      return res.transfers || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar transferências.', 'error');
      return [];
    }
  }

  async function render() {
    const transfers = await fetchTransfers();
    const pendentes = transfers.filter((t) => t.status === 'enviada');
    content.innerHTML = `
      <div class="panel">
        ${situacaoInicial === 'enviada'
        ? S.pageHead('Cargas a Conferir', '',
          '<button type="button" id="transferNew">Nova transferência</button>')
        : S.pageHead('Entre Depósitos', '',
          '<button type="button" id="transferNew">Nova transferência</button>')}
        <form id="transferFilters" class="form-grid">
          <div class="row">
            <label>Buscar<input type="search" name="search" value="${S.escape(filters.search)}" placeholder="Código, produto ou observação" /></label>
            <label>Produto
              ${renderSearchableSelect({ id: 'transferFiltroProduto', name: 'productId', options: opcoesProduto, selectedValue: filters.productId, placeholder: 'Todos — busque por nome ou SKU' })}
            </label>
            <label>Depósito (origem ou destino)<select name="depositId">${S.options(meta.deposits, filters.depositId, { empty: 'Todos' })}</select></label>
            <label>Situação<select name="status">${S.options(SITUACOES, filters.status, { empty: 'Todas' })}</select></label>
          </div>
          <div class="finance-actions-row">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="transferClear">Limpar</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr><th>Código</th><th>Data</th><th>Produto</th><th>Origem</th><th>Destino</th><th>Enviado</th><th>Recebido</th><th>Situação</th><th>Usuário</th><th>Ações</th></tr>
            </thead>
            <tbody>
              ${transfers.length === 0 ? S.emptyRow(10, 'Nenhuma transferência registrada.') : transfers.map((transfer) => `
                <tr>
                  <td>${S.escape(transfer.code)}</td>
                  <td>${S.formatDate(transfer.date)}</td>
                  <td>${S.escape(transfer.productName)}${transfer.productSku ? ` <span class="muted">(${S.escape(transfer.productSku)})</span>` : ''}${S.corBadge(cores, transfer.classValueId)}</td>
                  <td>${S.escape(transfer.originDepositName || '-')}</td>
                  <td>${S.escape(transfer.destinationDepositName || '-')}</td>
                  <td>${S.formatQty(transfer.quantity)}</td>
                  <td>${S.formatQty(transfer.receivedQuantity)}</td>
                  <td>${badgeSituacao(transfer)}</td>
                  <td>${S.escape(transfer.createdByName || '-')}</td>
                  <td class="cadastro-list-actions">
                    ${transfer.status === 'enviada' ? `<button type="button" class="secondary" data-receive="${transfer.id}">Conferir</button>` : ''}
                    <button type="button" class="icon-button" data-delete="${transfer.id}" title="Estornar">${S.trashIcon}</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:12px;">
          ${transfers.length} transferência(s).
          ${pendentes.length ? `<strong>${pendentes.length} aguardando conferência</strong>` : ''}
        </p>
      </div>
    `;

    document.getElementById('transferNew')?.addEventListener('click', () => {
      state.activeSub = 'new_transfer';
      loadModule('stock');
    });

    // Em branco quer dizer "todos", como o "Todos" do <select> antigo.
    attachSearchableSelect({ id: 'transferFiltroProduto', options: opcoesProduto });

    document.getElementById('transferFilters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      Object.keys(filters).forEach((key) => { filters[key] = formData.get(key) || ''; });
      render();
    });

    document.getElementById('transferClear')?.addEventListener('click', () => {
      // Em "Cargas a Conferir", limpar volta ao propósito da tela e não a
      // esvazia de sentido: sem isto, o botão transformaria a tela de pendentes
      // no histórico inteiro e ninguém entenderia por quê.
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      filters.status = situacaoInicial || '';
      render();
    });

    // A conferência abre a CARGA inteira, não a linha clicada: o que chega no
    // balcão é um caminhão, e conferir item por item em telas separadas é como
    // se perde uma caixa.
    content.querySelectorAll('[data-receive]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.stockReceiveTransferId = btn.dataset.receive;
        state.activeSub = 'receive_transfer';
        loadModule('stock');
      });
    });

    content.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const alvo = transfers.find((t) => t.id === btn.dataset.delete);
        const confirmed = await confirmModal(alvo && alvo.status === 'enviada'
          ? 'Estornar esta carga? A mercadoria volta do trânsito para o depósito de origem, '
            + 'como se nunca tivesse saído.'
          : 'Estornar esta transferência? As movimentações geradas serão removidas.');
        if (!confirmed) return;
        try {
          await api(`/api/stock/transfers/${btn.dataset.delete}`, { method: 'DELETE' });
          showToast('Transferência estornada.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Erro ao estornar transferência.', 'error');
        }
      });
    });
  }

  await render();
}

window.MavisSubscreenRegistry.stock.transfers = (ctx) => renderTransfers(ctx, '');
window.MavisSubscreenRegistry.stock.transfers_pending = (ctx) => renderTransfers(ctx, 'enviada');
