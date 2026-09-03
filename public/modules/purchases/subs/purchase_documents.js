// COTAÇÕES E ORDENS DE COMPRA — a mesma lista, dois recortes.
//
// Este arquivo registra DUAS telas do menu (`purchase_quotes` e
// `purchase_orders`) com UM renderizador. Não é economia de código: é o
// desenho. Cotação e ordem são o mesmo documento em pontos diferentes da vida,
// e duas listas escritas separadamente divergiriam na primeira coluna nova —
// uma mostraria a previsão de entrega, a outra não, e ninguém saberia dizer
// qual das duas está errada.
//
// O que muda entre elas é o filtro (`type`) e o texto. Tudo o mais — colunas,
// ações, badges — sai do catálogo de status.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

(function () {
  const catalogo = () => window.MavisPurchaseStatus;

  const dinheiro = (valor) => `R$ ${Number(valor || 0).toFixed(2)}`;

  function badge(status) {
    const meta = catalogo().obter(status);
    return `<span class="finance-badge finance-badge-${meta.tom || 'muted'}">${meta.label}</span>`;
  }

  // Data no formato do usuário sem depender de Date: 'aaaa-mm-dd' vindo do
  // Postgres já é texto ordenável, e passá-lo por new Date() num navegador em
  // fuso negativo devolve o dia anterior.
  const dataBr = (iso) => {
    const texto = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return '-';
    const [a, m, d] = texto.split('-');
    return `${d}/${m}/${a}`;
  };

  // Ordem cuja entrega prometida já passou e que ainda não chegou. É a única
  // informação da lista que não está em nenhuma coluna do banco: sai da
  // comparação entre a promessa e hoje, e é o motivo de delivery_date existir.
  function estaAtrasada(documento) {
    if (!documento.deliveryDate || documento.stockApplied) return false;
    if (catalogo().ehCancelado(documento.status)) return false;
    return String(documento.deliveryDate).slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  function montarRenderizador({ tipo, titulo, vazio }) {
    return async function renderDocumentosDeCompra(ctx) {
      const { content, api, showToast, confirmModal, escapeHtml, state, renderApp, loadModule } = ctx;

      async function carregar() {
        let resposta;
        try {
          resposta = await api(`/api/purchases/documentos?tipo=${encodeURIComponent(tipo)}`);
        } catch (erro) {
          content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar: ${escapeHtml(erro.message || 'erro desconhecido')}</p></div>`;
          return;
        }
        desenhar(resposta.documentos || []);
      }

      function desenhar(documentos) {
        const atrasadas = documentos.filter(estaAtrasada).length;
        content.innerHTML = `
          <div class="panel">
            <div class="panel-header">
              <h3>${titulo}</h3>
              <button type="button" id="novoDocumentoCompra">Novo</button>
            </div>
            ${atrasadas ? `<p class="finance-badge finance-badge-danger">${atrasadas} com entrega atrasada</p>` : ''}
            <div class="table-scroll">
              <table class="table table-actions">
                <thead>
                  <tr>
                    <th>Nº</th><th>Fornecedor</th><th>Data</th>
                    <th>Entrega</th><th>Itens</th><th>Total</th><th>Status</th><th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  ${documentos.length ? documentos.map((doc) => `
                    <tr>
                      <td>${doc.code == null ? '-' : escapeHtml(String(doc.code))}</td>
                      <td>${escapeHtml(doc.supplierName || '-')}</td>
                      <td>${dataBr(doc.date)}</td>
                      <td>${doc.deliveryDate ? dataBr(doc.deliveryDate) : '<span class="muted">-</span>'}
                          ${estaAtrasada(doc) ? '<span class="finance-badge finance-badge-danger">atrasada</span>' : ''}</td>
                      <td>${doc.items.length}</td>
                      <td>${dinheiro(doc.totalAmount)}</td>
                      <td>${badge(doc.status)}</td>
                      <td class="finance-extrato-actions">
                        ${catalogo().proximos(doc.status).map((alvo) => `
                          <button type="button" class="secondary"
                            data-transicao="${escapeHtml(doc.id)}"
                            data-alvo="${escapeHtml(alvo.value)}">${escapeHtml(alvo.label)}</button>
                        `).join('')}
                        ${doc.stockApplied ? '' : `
                          <button type="button" class="secondary" data-editar="${escapeHtml(doc.id)}">Editar</button>
                          <button type="button" class="secondary" data-excluir="${escapeHtml(doc.id)}">Excluir</button>
                        `}
                      </td>
                    </tr>
                  `).join('') : `<tr><td colspan="8" class="muted">${vazio}</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        `;

        const abrirFormulario = (id) => {
          state.activeSub = 'new_purchase_order';
          state.purchaseDocumentId = id || null;
          // O tipo do menu de onde se veio decide o status inicial do
          // formulário: entrar por Cotações e sair com uma ordem seria o
          // sistema decidindo por quem clicou.
          state.purchaseDocumentTipo = tipo;
          renderApp();
          loadModule('purchases');
        };

        document.getElementById('novoDocumentoCompra')?.addEventListener('click', () => abrirFormulario(null));

        document.querySelectorAll('[data-editar]').forEach((botao) => {
          botao.addEventListener('click', () => abrirFormulario(botao.dataset.editar));
        });

        document.querySelectorAll('[data-transicao]').forEach((botao) => {
          botao.addEventListener('click', async () => {
            const alvo = catalogo().obter(botao.dataset.alvo);
            // Só confirma o que mexe em estoque ou dinheiro. Pedir confirmação
            // para "marcar como enviada" ensina a clicar em OK sem ler, e aí a
            // confirmação que importa também passa batida.
            if (alvo.entraEstoque || alvo.geraFinanceiro || alvo.cancelado) {
              const efeitos = [
                alvo.entraEstoque ? 'dar entrada dos itens no estoque' : '',
                alvo.geraFinanceiro ? 'criar a conta a pagar' : '',
                alvo.cancelado ? 'estornar o que já tiver entrado' : ''
              ].filter(Boolean).join(', ');
              const confirmado = await confirmModal(`Confirma "${alvo.label}"? Isto vai ${efeitos}.`);
              if (!confirmado) return;
            }
            try {
              await api(`/api/purchases/documentos/${encodeURIComponent(botao.dataset.transicao)}/status`, {
                method: 'POST', body: JSON.stringify({ status: alvo.value })
              });
              showToast(`Documento agora está em "${alvo.label}".`, 'success');
              carregar();
            } catch (erro) {
              showToast(erro.message || 'Erro ao mudar o status.', 'error');
            }
          });
        });

        document.querySelectorAll('[data-excluir]').forEach((botao) => {
          botao.addEventListener('click', async () => {
            const confirmado = await confirmModal('Confirma excluir este documento? Não há como desfazer.');
            if (!confirmado) return;
            try {
              await api(`/api/purchases/documentos/${encodeURIComponent(botao.dataset.excluir)}`, { method: 'DELETE' });
              showToast('Documento excluído.', 'success');
              carregar();
            } catch (erro) {
              showToast(erro.message || 'Erro ao excluir.', 'error');
            }
          });
        });
      }

      await carregar();
    };
  }

  window.MavisSubscreenRegistry.purchases.purchase_quotes = montarRenderizador({
    tipo: 'quote',
    titulo: 'Cotações',
    vazio: 'Nenhuma cotação ainda. Uma cotação vira ordem de compra sem virar outro documento — o mesmo registro muda de status.'
  });

  window.MavisSubscreenRegistry.purchases.purchase_orders = montarRenderizador({
    tipo: 'order',
    titulo: 'Ordens de Compra',
    vazio: 'Nenhuma ordem de compra ainda.'
  });
})();
