window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// CONFERÊNCIA DA CARGA (fase CZ) — o trânsito vira estoque do destino.
//
// A tela existe porque a transferência deixou de ser instantânea. Enquanto sair
// e chegar eram o mesmo instante, a carga que ia do CD para a FILIAL 08
// aparecia no estoque da filial antes de o caminhão sair: a filial vendia o que
// estava na estrada, e perda no caminho não existia como fato — reaparecia meses
// depois como falta na contagem dela.
//
// A CARGA INTEIRA, E NÃO A LINHA CLICADA. O que chega no balcão é um caminhão.
// Conferir item por item em telas separadas é exatamente como se perde uma
// caixa: a pessoa confere três linhas, é interrompida, e as outras duas ficam
// para "depois" sem que nada na tela lembre disso.
//
// ZERO É RESPOSTA. O campo nasce com o que falta, mas apagar para zero é o
// lançamento mais importante da tela: "esta caixa não chegou". A linha continua
// pendente, o saldo continua no trânsito, e a carga segue na lista de
// aguardando conferência — que é o contrário de apagar a divergência.
window.MavisSubscreenRegistry.stock.receive_transfer = async function renderReceiveTransfer(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);

  function voltar() {
    state.stockReceiveTransferId = '';
    state.activeSub = 'transfers';
    loadModule('stock');
  }

  const alvoId = state.stockReceiveTransferId || '';
  if (!alvoId) return voltar();

  // Da linha clicada para a carga: uma leitura para achar o lote, outra para
  // trazê-lo inteiro. Pedir o lote direto exigiria a lista guardar o batchId de
  // cada linha no DOM, e ele já vem na resposta.
  let linhas = [];
  let batchId = '';
  try {
    const umaSo = await api(`/api/stock/transfers?productId=&search=`);
    const alvo = (umaSo.transfers || []).find((t) => t.id === alvoId);
    if (!alvo) {
      showToast('Carga não encontrada.', 'error');
      return voltar();
    }
    batchId = alvo.batchId || '';
    const res = await api(`/api/stock/transfers?batchId=${encodeURIComponent(batchId)}`);
    linhas = res.transfers || [];
  } catch (error) {
    showToast(error.message || 'Erro ao carregar a carga.', 'error');
    return voltar();
  }

  // O que já foi recebido por inteiro entra na tela como histórico, sem campo:
  // esconder as linhas fechadas faria a segunda conferência parecer uma carga
  // menor do que a que saiu.
  const pendentes = linhas.filter((l) => l.status === 'enviada');
  const primeira = linhas[0] || {};

  async function render() {
    content.innerHTML = `
      <div class="panel">
        ${S.pageHead(
    `Conferir carga ${S.escape(primeira.code || '')}`,
    '',
    '<button type="button" class="secondary" id="receiveBack">Voltar</button>'
  )}
        <div class="sales-info-grid">
          <label class="sales-total-field is-readonly">Origem
            <input value="${S.escape(primeira.originDepositName || '-')}" disabled />
          </label>
          <label class="sales-total-field is-readonly">Destino
            <input value="${S.escape(primeira.destinationDepositName || '-')}" disabled />
          </label>
          <label class="sales-total-field is-readonly">Enviada em
            <input value="${S.escape(S.formatDate(primeira.date))}" disabled />
          </label>
          <label class="sales-total-field is-readonly">Itens na carga
            <input value="${linhas.length} (${pendentes.length} pendente${pendentes.length === 1 ? '' : 's'})" disabled />
          </label>
        </div>
      </div>

      <form class="panel" id="receiveForm">
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr><th>Produto</th><th>Enviado</th><th>Já recebido</th><th>Falta</th><th>Chegou agora</th></tr>
            </thead>
            <tbody>
              ${linhas.map((l) => `
                <tr>
                  <td>
                    ${S.escape(l.productName)}${l.productSku ? ` <span class="muted">(${S.escape(l.productSku)})</span>` : ''}
                    ${S.corBadge(cores, l.classValueId)}
                  </td>
                  <td>${S.formatQty(l.quantity)}</td>
                  <td>${S.formatQty(l.receivedQuantity)}</td>
                  <td>${l.status === 'enviada' ? `<strong>${S.formatQty(l.pendingQuantity)}</strong>` : '-'}</td>
                  <td>
                    ${l.status === 'enviada' ? `
                      <input type="number" step="0.0001" min="0" max="${l.pendingQuantity}"
                             data-transfer="${l.id}" value="${l.pendingQuantity}"
                             style="max-width:130px;" />
                    ` : S.badge('Recebida', 'success')}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        ${pendentes.length ? `
          <div class="finance-actions-row" style="margin-top:12px;">
            <button type="submit">Confirmar recebimento</button>
            <button type="button" class="secondary" id="receiveNothing">Nada chegou</button>
          </div>
        ` : `
          <p class="muted" style="margin-top:12px;">Esta carga já foi recebida por inteiro.</p>
        `}
      </form>
    `;

    document.getElementById('receiveBack')?.addEventListener('click', voltar);

    // "Nada chegou" zera os campos em vez de enviar: a confirmação fica no
    // mesmo lugar de sempre, e a pessoa vê os zeros antes de mandar.
    document.getElementById('receiveNothing')?.addEventListener('click', () => {
      content.querySelectorAll('[data-transfer]').forEach((input) => { input.value = '0'; });
      showToast('Campos zerados. Confirme para registrar que a carga não chegou.', 'info');
    });

    document.getElementById('receiveForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const items = [];
      content.querySelectorAll('[data-transfer]').forEach((input) => {
        items.push({ transferId: input.dataset.transfer, quantity: Number(input.value || 0) });
      });
      const total = items.reduce((soma, i) => soma + i.quantity, 0);
      if (!total) {
        // Sem quantidade nenhuma não há o que gravar: a rota recusaria, e a
        // recusa por aqui explica o que aconteceu em vez de mostrar um erro.
        const ok = await confirmModal(
          'Nenhuma quantidade informada. A carga fica inteira em trânsito e nada é gravado.\n\n'
          + 'Isso é o mesmo que não conferir. Voltar para a lista?'
        );
        if (ok) voltar();
        return;
      }

      const faltando = items.filter((i) => {
        const linha = linhas.find((l) => l.id === i.transferId);
        return linha && i.quantity < Number(linha.pendingQuantity || 0);
      });
      if (faltando.length) {
        const ok = await confirmModal(
          `${faltando.length} ${faltando.length === 1 ? 'item chegou' : 'itens chegaram'} em quantidade `
          + 'menor do que a enviada.\n\nO que faltar continua em trânsito e a carga segue pendente na '
          + 'lista, para ser conferida de novo quando o restante aparecer. Confirmar assim?'
        );
        if (!ok) return;
      }

      try {
        const res = await api('/api/stock/transfers/receive', {
          method: 'POST',
          body: JSON.stringify({ batchId, items })
        });
        showToast(res.pendente > 0
          ? `Recebimento registrado. Ainda faltam ${S.formatQty(res.pendente)} nesta carga.`
          : 'Carga recebida por inteiro.', 'success', 6000);
        voltar();
      } catch (error) {
        showToast(error.message || 'Erro ao conferir a carga.', 'error', 8000);
      }
    });
  }

  await render();
};
