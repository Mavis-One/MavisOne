// O FORMULÁRIO DE COMPRA — um só, para cotação e para ordem.
//
// Não existe "Nova Cotação" separada de "Nova Ordem de Compra". É a mesma tela,
// e o campo Status decide qual dos dois o documento é — o mesmo desenho que
// Vendas adotou depois de descobrir que suas duas telas eram a mesma. Ver o
// cabeçalho de public/modules/shared/purchase_status.js.
//
// A tela também EDITA. Um documento que já deu entrada no estoque não abre aqui
// (a lista nem oferece o botão, e o servidor recusa): os itens dele já viraram
// linhas do razão, e mudar a quantidade deixaria a ordem dizendo 8 com 10
// unidades lançadas.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

window.MavisSubscreenRegistry.purchases.new_purchase_order = async function renderNovoDocumentoDeCompra(ctx) {
  const { content, data, api, showToast, state, renderApp, loadModule, escapeHtml } = ctx;
  const catalogo = window.MavisPurchaseStatus;
  const totais = window.MavisPurchaseTotals;

  const produtos = data.products || [];
  const produtosPorId = new Map(produtos.map((p) => [p.id, p]));
  const directory = data.directory || [];

  // OS DOIS SELETORES DESTA TELA DEIXARAM DE SER <select> (fase CH).
  //
  // Medido no navegador depois das importacoes: fornecedor com 6.493 <option>,
  // produto com 5.476, e 12.030 nos no DOM so' desses dois campos. Um <select>
  // desse tamanho nao se procura — rola-se ate' achar.
  //
  // O rotulo do produto leva o SKU porque 457 produtos tem nome repetido (203
  // nomes, ate' 7 vezes cada) COM CUSTOS DIFERENTES. Numa ordem de compra isso
  // e' dinheiro: escolher a "SETA" errada entre sete grava o custo errado no
  // item, e o erro so' aparece quando a nota do fornecedor nao bate.
  const opcoesProduto = window.MavisRotuloProduto.opcoes(produtos);
  const opcoesFornecedor = directory.map((e) => ({ value: e.id, label: e.name }));
  const depositos = data.deposits || [];

  const editandoId = state.purchaseDocumentId || null;
  // Entrar por Cotações e sair com uma ordem seria a tela decidindo por quem
  // clicou. O menu de origem manda no status inicial.
  const statusInicial = state.purchaseDocumentTipo === 'order' ? 'ordem' : 'cotacao';

  let documento = {
    status: statusInicial,
    supplierId: '', supplierName: '', depositId: '',
    date: new Date().toISOString().slice(0, 10),
    deliveryDate: '', note: '',
    items: [], freight: 0, otherExpenses: 0, discountAmount: 0
  };

  if (editandoId) {
    try {
      const resposta = await api('/api/purchases/documentos');
      const achado = (resposta.documentos || []).find((d) => d.id === editandoId);
      if (achado) documento = { ...documento, ...achado, deliveryDate: achado.deliveryDate || '' };
    } catch (erro) {
      showToast(erro.message || 'Erro ao carregar o documento.', 'error');
    }
  }

  const dinheiro = (v) => `R$ ${Number(v || 0).toFixed(2)}`;
  const numeroDoCampo = (id) => Number(document.getElementById(id)?.value || 0);

  function recalcular() {
    return totais.calcular({
      items: documento.items,
      freight: numeroDoCampo('compraFrete'),
      otherExpenses: numeroDoCampo('compraDespesas'),
      discountAmount: numeroDoCampo('compraDesconto')
    });
  }

  function linhasDeItens() {
    if (!documento.items.length) {
      return '<tr><td colspan="5" class="muted">Nenhum item. Escolha o produto, a quantidade e o custo, e clique em Adicionar.</td></tr>';
    }
    return documento.items.map((item, indice) => `
      <tr>
        <td>${escapeHtml(item.name || produtosPorId.get(item.productId)?.name || item.productId)}</td>
        <td>${Number(item.quantity)}</td>
        <td>${dinheiro(item.unitCost)}</td>
        <td>${dinheiro(item.total)}</td>
        <td><button type="button" class="secondary" data-remover="${indice}">Remover</button></td>
      </tr>
    `).join('');
  }

  function adicionarItem() {
    const productId = document.getElementById('compraProdutoValue')?.value || '';
    const quantity = Number(document.getElementById('compraQtd')?.value || 0);
    const unitCost = Number(document.getElementById('compraCusto')?.value || 0);
    if (!productId || quantity <= 0) {
      showToast('Escolha o produto e uma quantidade maior que zero.', 'warning');
      return;
    }
    const produto = produtosPorId.get(productId);
    // Produto repetido SOMA em vez de virar segunda linha. Duas linhas do mesmo
    // produto não são erro no banco, mas na tela só fazem quem confere somar de
    // cabeça — e o servidor normaliza do mesmo jeito.
    const existente = documento.items.find((i) => i.productId === productId && i.unitCost === unitCost);
    if (existente) {
      existente.quantity += quantity;
      existente.total = totais.dinheiro(existente.quantity * existente.unitCost);
    } else {
      documento.items.push(totais.normalizarItem({
        productId, name: produto?.name || '', sku: produto?.sku || '', quantity, unitCost
      }));
    }
    document.getElementById('compraQtd').value = '1';
    desenhar();
  }

  function desenhar() {
    const calculado = documento.items.length ? recalcular() : {
      itemsTotal: 0, freight: Number(documento.freight || 0),
      otherExpenses: Number(documento.otherExpenses || 0),
      discountAmount: Number(documento.discountAmount || 0),
      totalAmount: 0
    };

    content.innerHTML = `
      <div class="panel">
        <h3>${editandoId ? 'Editar documento de compra' : 'Novo documento de compra'}</h3>
        <form id="compraForm" class="form-grid">
          <div class="row">
            <label>Status
              <select name="status" id="compraStatus">
                ${catalogo.selecionaveis().map((s) => `
                  <option value="${s.value}" ${documento.status === s.value ? 'selected' : ''}>${escapeHtml(s.label)}</option>
                `).join('')}
                ${catalogo.CATALOGO.filter((s) => !s.selecionavel).map((s) => `
                  <option value="${s.value}" ${documento.status === s.value ? 'selected' : ''} disabled>${escapeHtml(s.label)}</option>
                `).join('')}
              </select>
            </label>
            <label>Fornecedor
              ${renderSearchableSelect({ id: 'compraFornecedor', name: 'supplierId', options: opcoesFornecedor, selectedValue: documento.supplierId, placeholder: 'Buscar fornecedor...' })}
            </label>
          </div>
          <div class="row">
            <label>Data<input type="date" id="compraData" value="${escapeHtml(String(documento.date || '').slice(0, 10))}" /></label>
            <label>Previsão de entrega<input type="date" id="compraEntrega" value="${escapeHtml(String(documento.deliveryDate || '').slice(0, 10))}" /></label>
            <label>Depósito de entrada
              <select id="compraDeposito">
                <option value="">— sem depósito —</option>
                ${depositos.map((d) => `<option value="${d.id}" ${documento.depositId === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
              </select>
            </label>
          </div>

          <h4>Itens</h4>
          <div class="row">
            <label>Produto
              ${renderSearchableSelect({ id: 'compraProduto', name: 'produtoBusca', options: opcoesProduto, placeholder: 'Buscar por nome ou SKU...' })}
            </label>
            <label>Quantidade<input type="number" id="compraQtd" min="0" step="0.0001" value="1" /></label>
            <label>Custo unitário<input type="number" id="compraCusto" min="0" step="0.01" value="0.00" /></label>
            <button type="button" class="secondary" id="compraAdicionar">Adicionar</button>
          </div>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Produto</th><th>Qtd</th><th>Custo un.</th><th>Total</th><th></th></tr></thead>
              <tbody>${linhasDeItens()}</tbody>
            </table>
          </div>

          <div class="row">
            <label>Frete<input type="number" id="compraFrete" min="0" step="0.01" value="${Number(calculado.freight).toFixed(2)}" /></label>
            <label>Outras despesas<input type="number" id="compraDespesas" min="0" step="0.01" value="${Number(calculado.otherExpenses).toFixed(2)}" /></label>
            <label>Desconto<input type="number" id="compraDesconto" min="0" step="0.01" value="${Number(calculado.discountAmount).toFixed(2)}" /></label>
          </div>
          <p>
            Itens: <strong>${dinheiro(calculado.itemsTotal)}</strong> &nbsp;·&nbsp;
            Total do documento: <strong id="compraTotal">${dinheiro(calculado.totalAmount)}</strong>
          </p>

          <label>Observação<textarea id="compraObs" rows="2">${escapeHtml(documento.note || '')}</textarea></label>

          <div class="row">
            <button type="submit">${editandoId ? 'Salvar' : 'Gravar'}</button>
            <button type="button" class="secondary" id="compraCancelar">Cancelar</button>
          </div>
        </form>
      </div>
    `;

    attachSearchableSelect({ id: 'compraFornecedor', options: opcoesFornecedor });

    attachSearchableSelect({
      id: 'compraProduto',
      options: opcoesProduto,
      onSelect: (valor, opcao) => {
        const campo = document.getElementById('compraCusto');
        if (campo) campo.value = Number(opcao?.product?.costPrice || 0).toFixed(2);
      }
    });

    document.getElementById('compraAdicionar')?.addEventListener('click', adicionarItem);
    document.querySelectorAll('[data-remover]').forEach((botao) => {
      botao.addEventListener('click', () => {
        documento.items.splice(Number(botao.dataset.remover), 1);
        desenhar();
      });
    });

    // O total acompanha o que se digita: quem lança frete quer ver o efeito
    // antes de gravar, não depois.
    ['compraFrete', 'compraDespesas', 'compraDesconto'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        const alvo = document.getElementById('compraTotal');
        if (alvo) alvo.textContent = dinheiro(recalcular().totalAmount);
      });
    });

    const voltar = () => {
      state.activeSub = statusInicial === 'ordem' ? 'purchase_orders' : 'purchase_quotes';
      state.purchaseDocumentId = null;
      renderApp();
      loadModule('purchases');
    };
    document.getElementById('compraCancelar')?.addEventListener('click', voltar);

    document.getElementById('compraForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      // CLIQUE DUPLO NÃO GRAVA DOIS DOCUMENTOS (fase BS).
      //
      // Não havia guarda nenhuma: dois cliques em "Gravar" criavam duas ordens
      // idênticas, cada uma com o seu número (o código vem de sequence, então os
      // números diferem — o que duplica é o documento). Se as duas forem
      // recebidas depois, a mercadoria entra duas vezes e nascem duas contas a
      // pagar para a mesma compra.
      //
      // Mesmo padrão de stock/subs/new_movement.js. O botão só volta a valer
      // quando a gravação falha: no sucesso a tela troca de lista.
      const botao = evento.target.querySelector('button[type="submit"]');
      if (botao?.disabled) return;
      const fornecedorId = document.getElementById('compraFornecedorValue')?.value || '';
      if (!fornecedorId) {
        showToast('Escolha o fornecedor.', 'warning');
        return;
      }
      if (!documento.items.length) {
        showToast('Inclua ao menos um item.', 'warning');
        return;
      }
      if (botao) botao.disabled = true;
      const corpo = {
        status: document.getElementById('compraStatus')?.value || statusInicial,
        supplierId: fornecedorId,
        depositId: document.getElementById('compraDeposito')?.value || '',
        date: document.getElementById('compraData')?.value || '',
        deliveryDate: document.getElementById('compraEntrega')?.value || null,
        note: document.getElementById('compraObs')?.value || '',
        items: documento.items,
        freight: numeroDoCampo('compraFrete'),
        otherExpenses: numeroDoCampo('compraDespesas'),
        discountAmount: numeroDoCampo('compraDesconto')
      };
      try {
        if (editandoId) {
          await api(`/api/purchases/documentos/${encodeURIComponent(editandoId)}`, { method: 'PUT', body: JSON.stringify(corpo) });
          showToast('Documento salvo.', 'success');
        } else {
          await api('/api/purchases/documentos', { method: 'POST', body: JSON.stringify(corpo) });
          showToast('Documento gravado.', 'success');
        }
        // Vai para a lista do tipo que o documento FICOU sendo, não do menu de
        // onde se veio: gravar uma cotação já como ordem e cair na lista de
        // Cotações mostraria uma lista sem o que se acabou de gravar.
        state.activeSub = window.MavisPurchaseStatus.ehCotacao(corpo.status) ? 'purchase_quotes' : 'purchase_orders';
        state.purchaseDocumentId = null;
        renderApp();
        loadModule('purchases');
      } catch (erro) {
        // Só aqui o botão volta: quem falhou precisa poder tentar de novo.
        if (botao) botao.disabled = false;
        showToast(erro.message || 'Erro ao gravar o documento.', 'error');
      }
    });
  }

  desenhar();
};
