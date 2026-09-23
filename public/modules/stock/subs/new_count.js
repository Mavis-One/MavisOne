window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// A FOLHA DE CONTAGEM (fase CU).
//
// Duas telas numa: sem `state.stockCountId` ela ABRE uma contagem; com ele, ela
// É a folha — recebe item por item e fecha.
//
// POR QUE A FOLHA É GRAVADA ITEM A ITEM, E NÃO MONTADA NO NAVEGADOR
// -----------------------------------------------------------------
// A transferência monta a lista no navegador e envia tudo num POST, e serve lá
// porque transferir é um ato de minutos. Contar não é: leva horas, é feita por
// mais de uma pessoa, e quem conta está no corredor com o celular na mão.
// Perder a lista num F5 é exatamente a falha que faz a contagem voltar para o
// papel — e do papel ela não volta para o sistema.
//
// O QUE A TELA MOSTRA QUE O SERVIDOR NÃO ADIVINHA
// -----------------------------------------------
// A diferença por linha, ANTES de fechar. Um fechamento que só diz "23 ajustes
// aplicados" obriga a conferir no razão depois do fato; o ajuste tem de ser
// visível enquanto ainda dá para recontar.
window.MavisSubscreenRegistry.stock.new_count = async function renderNewCount(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  const meta = await S.loadMeta(api, showToast);
  const cores = S.indiceDeCores(meta);
  // O rótulo leva o SKU: são 5.475 produtos e 457 têm nome repetido, então o
  // nome sozinho não distingue qual deles está na prateleira.
  const opcoesProduto = window.MavisRotuloProduto.opcoes(meta.products);

  // productId -> { classe, classesIgnoradas }. Escolher o mesmo produto duas
  // vezes não repete a chamada.
  const cacheClasses = new Map();
  let produtoAtual = '';

  function voltarParaLista() {
    state.stockCountId = null;
    state.activeSub = 'counts';
    loadModule('stock');
  }

  async function classesDoProduto(productId) {
    if (!productId) return null;
    if (cacheClasses.has(productId)) return cacheClasses.get(productId);
    const info = { classe: null, classesIgnoradas: [] };
    try {
      const res = await api(`/api/stock/products/${productId}/classes`);
      const classes = res.classes || [];
      // Uma classe por leitura, como na movimentação e na transferência: o
      // razão guarda um classValueId só.
      info.classe = classes.find((c) => c.required) || classes[0] || null;
      info.classesIgnoradas = classes.filter((c) => c !== info.classe);
    } catch (error) {
      info.classe = null;
    }
    cacheClasses.set(productId, info);
    return info;
  }

  // -------------------------------------------------------------------------
  // ABERTURA
  // -------------------------------------------------------------------------
  async function renderAbertura() {
    const hoje = new Date().toISOString().slice(0, 10);
    const semDeposito = (meta.deposits || []).length === 0;

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead(
          'Nova Contagem de Estoque',
          'Escolha o depósito a contar. A contagem nasce aberta e não mexe em saldo até ser fechada.',
          '<button type="button" class="secondary" id="countBack">Voltar</button>'
        )}
        ${semDeposito ? `
          <p class="muted">
            Nenhum depósito cadastrado. Contagem é de um <strong>lugar</strong> —
            cadastre o depósito em <strong>Estoque &gt; Novo Depósito</strong> e volte aqui.
          </p>
        ` : `
          <form id="countOpenForm" class="form-grid">
            <div class="row">
              <label>Depósito<select name="depositId" required>${S.options(meta.deposits, '', { empty: 'Selecione' })}</select></label>
              <label>Data<input type="date" name="date" required value="${hoje}" /></label>
            </div>
            <label>Observação<textarea name="note" rows="2" placeholder="Inventário do mês, carga inicial da loja, recontagem do corredor 3..."></textarea></label>
            <div class="finance-actions-row">
              <button type="submit">Abrir contagem</button>
            </div>
          </form>
          <!-- Sem crase neste comentario: ele mora dentro de um template
               literal, e uma crase fecharia a string. -->
          <p class="muted">
            Para a CARGA INICIAL de uma loja, abra a contagem do depósito e informe
            a quantidade de cada produto: o saldo do sistema é zero, então o ajuste
            é a quantidade contada. É a mesma folha do inventário.
          </p>
        `}
      </div>
    `;

    document.getElementById('countBack')?.addEventListener('click', voltarParaLista);

    document.getElementById('countOpenForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const botao = event.target.querySelector('button[type="submit"]');
      botao.disabled = true;
      const formData = new FormData(event.target);
      try {
        const res = await api('/api/stock/counts', {
          method: 'POST',
          body: JSON.stringify({
            depositId: formData.get('depositId'),
            date: formData.get('date'),
            note: formData.get('note') || ''
          })
        });
        showToast(`Contagem ${res.count.code} aberta.`, 'success');
        state.stockCountId = res.count.id;
        await renderFolha();
      } catch (error) {
        showToast(error.message || 'Erro ao abrir a contagem.', 'error');
        botao.disabled = false;
      }
    });
  }

  // -------------------------------------------------------------------------
  // A FOLHA
  // -------------------------------------------------------------------------
  async function carregarFolha() {
    try {
      return await api(`/api/stock/counts/${encodeURIComponent(state.stockCountId)}`);
    } catch (error) {
      showToast(error.message || 'Erro ao carregar a contagem.', 'error');
      return null;
    }
  }

  function linhaDeItem(item, aberta) {
    // O QUE SE COMPARA DEPENDE DE A CONTAGEM ESTAR ABERTA.
    //
    // Aberta: contra `saldoAtual`, porque é ele que o fechamento vai usar.
    // Fechada: contra `expectedQuantity`, o saldo de quando se contou — é o que
    // prova a divergência. Depois do fechamento o saldo passou a ser o contado,
    // e comparar com ele diria que o sistema sempre esteve certo.
    const base = aberta ? Number(item.saldoAtual || 0) : Number(item.expectedQuantity || 0);
    const contado = Number(item.countedQuantity || 0);
    const diferenca = aberta ? contado - base : Number(item.adjustment || 0);
    const tom = diferenca === 0 ? 'muted' : (diferenca > 0 ? 'success' : 'danger');
    const sinal = diferenca > 0 ? '+' : '';
    return `
      <tr${item.productMissing ? ' class="transfer-linha-alerta"' : ''}>
        <td>
          ${S.escape(item.productName || item.productId)}${S.corBadge(cores, item.classValueId)}
          ${item.productMissing ? ' <span class="muted">(produto removido do cadastro)</span>' : ''}
        </td>
        <td>${S.formatQty(base)}</td>
        <td><strong>${S.formatQty(contado)}</strong></td>
        <td>${S.badge(`${sinal}${S.formatQty(diferenca)}`, tom)}</td>
        <td>${S.escape(item.note || '-')}</td>
        <td>${S.escape(item.countedByName || '-')}</td>
        <td>${aberta
          ? `<button type="button" class="icon-button" data-remover="${S.escape(item.id)}" title="Remover do da folha">${S.trashIcon}</button>`
          : ''}</td>
      </tr>
    `;
  }

  async function renderFolha() {
    const dados = await carregarFolha();
    if (!dados) return voltarParaLista();
    const count = dados.count;
    const itens = dados.items || [];
    const aberta = count.status === 'aberta';

    const divergentes = itens.filter((item) => {
      const base = aberta ? Number(item.saldoAtual || 0) : Number(item.expectedQuantity || 0);
      return Number(item.countedQuantity || 0) !== base;
    }).length;

    const info = produtoAtual ? cacheClasses.get(produtoAtual) : null;
    const campoClasse = info?.classe ? `
      <label>${S.escape(info.classe.name)}${info.classe.required === false ? ' <span class="muted">(opcional)</span>' : ''}
        <select id="countItemClasse" ${info.classe.required !== false ? 'required' : ''}>
          <option value="">${info.classe.required !== false ? 'Selecione' : 'Sem ' + S.escape(info.classe.name.toLowerCase())}</option>
          ${info.classe.valores.map((v) => `<option value="${S.escape(v.id)}">${S.escape(v.name)}</option>`).join('')}
        </select>
      </label>
    ` : '';

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead(
          `Contagem ${S.escape(count.code)}`,
          `${S.escape(count.depositName || '(depósito removido)')} · ${S.formatDate(count.date)}`,
          '<button type="button" class="secondary" id="countBack">Voltar</button>'
        )}
        <div class="row">
          <div class="panel">
            <strong>${S.badge(
              aberta ? 'Aberta' : (count.status === 'fechada' ? 'Fechada' : 'Cancelada'),
              aberta ? 'warning' : (count.status === 'fechada' ? 'success' : 'muted')
            )}</strong>
            <p class="muted">Situação</p>
          </div>
          <div class="panel"><strong>${itens.length.toLocaleString('pt-BR')}</strong><p class="muted">Itens contados</p></div>
          <div class="panel"><strong>${divergentes}</strong><p class="muted">Divergentes</p></div>
          <div class="panel">
            <strong>${S.escape(count.closedByName || count.createdByName || '-')}</strong>
            <p class="muted">${count.closedByName ? 'Fechada por' : 'Aberta por'}</p>
          </div>
        </div>
        ${count.note ? `<p class="muted">${S.escape(count.note)}</p>` : ''}
        ${count.status === 'cancelada' && count.cancelReason
          ? `<p class="muted">Motivo do cancelamento: ${S.escape(count.cancelReason)}</p>` : ''}
      </div>

      ${aberta ? `
        <div class="panel">
          <h3>Contar um produto</h3>
          <form id="countItemForm" class="form-grid">
            <div class="row">
              <label>Produto
                ${renderSearchableSelect({ id: 'countItemProduto', name: 'productId', options: opcoesProduto, selectedValue: produtoAtual, placeholder: 'Buscar por nome ou SKU...', required: true })}
              </label>
              ${campoClasse}
              <!-- min="0" e nao min="0.001": ZERO e a contagem mais importante
                   que existe -- "fui a prateleira e nao havia nada". Um campo
                   que so aceita numero positivo nao registra perda total, que e
                   o que a contagem existe para achar. -->
              <label>Quantidade contada<input type="number" step="0.001" min="0" name="countedQuantity" required placeholder="0 é válido" /></label>
            </div>
            <label>Observação da linha<input name="note" placeholder="Caixa violada, produto em outro corredor..." /></label>
            <div class="finance-actions-row">
              <button type="submit">Registrar leitura</button>
              <span class="muted">Contar o mesmo produto de novo SUBSTITUI a leitura anterior.</span>
            </div>
          </form>
        </div>
      ` : ''}

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <th>Produto</th>
                <th>${aberta ? 'Saldo do sistema' : 'Saldo na contagem'}</th>
                <th>Contado</th>
                <th>${aberta ? 'Ajuste ao fechar' : 'Ajuste aplicado'}</th>
                <th>Observação</th><th>Contado por</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${itens.length === 0 ? S.emptyRow(7, 'Nenhum produto contado ainda.') : itens.map((item) => linhaDeItem(item, aberta)).join('')}
            </tbody>
          </table>
        </div>
        ${aberta ? `
          <div class="finance-actions-row" style="margin-top:12px;">
            <button type="button" id="countClose" ${itens.length === 0 ? 'disabled' : ''}>Fechar contagem e aplicar ajustes</button>
            <button type="button" class="secondary" id="countCancel">Cancelar contagem</button>
          </div>
          <p class="muted">
            Fechar gera um movimento de ajuste por linha divergente — as linhas em que o
            contado bate com o saldo não geram movimento nenhum, e ficam na folha como
            prova de que foram conferidas.
          </p>
        ` : `
          <p class="muted">
            ${count.status === 'fechada'
              ? 'Contagem fechada. Para desfazer um ajuste, estorne o movimento em <strong>Movimentações</strong> — a folha fica como registro.'
              : 'Contagem cancelada. Nenhum ajuste foi aplicado.'}
          </p>
        `}
      </div>
    `;

    document.getElementById('countBack')?.addEventListener('click', voltarParaLista);
    if (!aberta) return;

    // `onSelect`, e não `onChange`: é o nome que attachSearchableSelect usa, e
    // um `onChange` passado aqui seria aceito em silêncio e nunca chamado — o
    // campo de variação simplesmente não apareceria para produto com cor.
    attachSearchableSelect({
      id: 'countItemProduto',
      options: opcoesProduto,
      onSelect: async (valor) => {
        // Redesenha só para trocar o campo de variação — e a leitura em
        // andamento não é perdida porque a folha vive no banco, não aqui.
        if (valor === produtoAtual) return;
        produtoAtual = valor;
        await classesDoProduto(valor);
        await renderFolha();
      }
    });

    document.getElementById('countItemForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const botao = event.target.querySelector('button[type="submit"]');
      const formData = new FormData(event.target);
      const productId = formData.get('productId');
      if (!productId) {
        showToast('Escolha o produto contado.', 'warning');
        return;
      }
      const bruto = formData.get('countedQuantity');
      if (bruto === '' || bruto === null) {
        showToast('Informe a quantidade contada (zero é uma contagem válida).', 'warning');
        return;
      }
      botao.disabled = true;
      const classe = cacheClasses.get(productId)?.classe || null;
      try {
        await api(`/api/stock/counts/${encodeURIComponent(count.id)}/items`, {
          method: 'POST',
          body: JSON.stringify({
            productId,
            classId: classe ? classe.id : '',
            classValueId: document.getElementById('countItemClasse')?.value || '',
            countedQuantity: Number(bruto),
            note: formData.get('note') || ''
          })
        });
        // Zera o produto escolhido: a próxima leitura é de outro item, e deixar
        // o anterior selecionado convida a recontar o mesmo sem perceber.
        produtoAtual = '';
        await renderFolha();
      } catch (error) {
        showToast(error.message || 'Erro ao registrar a leitura.', 'error');
        botao.disabled = false;
      }
    });

    content.querySelectorAll('[data-remover]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(
            `/api/stock/counts/${encodeURIComponent(count.id)}/items/${encodeURIComponent(btn.dataset.remover)}`,
            { method: 'DELETE' }
          );
          await renderFolha();
        } catch (error) {
          showToast(error.message || 'Erro ao remover o item.', 'error');
        }
      });
    });

    document.getElementById('countClose')?.addEventListener('click', async (event) => {
      const confirmado = await confirmModal(
        `Fechar a contagem ${count.code}? Serão gerados os movimentos de ajuste de ${divergentes}`
        + ` linha(s) divergente(s), e o saldo do depósito passa a ser o contado.`
        + ' A folha não volta atrás depois disso.'
      );
      if (!confirmado) return;
      event.target.disabled = true;
      try {
        const res = await api(`/api/stock/counts/${encodeURIComponent(count.id)}/close`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        showToast(
          `Contagem fechada: ${res.ajustes} ajuste(s) aplicado(s),`
          + ` ${res.conferidosSemDivergencia} item(ns) conferido(s) sem divergência.`,
          'success'
        );
        await renderFolha();
      } catch (error) {
        showToast(error.message || 'Erro ao fechar a contagem.', 'error');
        event.target.disabled = false;
      }
    });

    document.getElementById('countCancel')?.addEventListener('click', async () => {
      // MOTIVO, E NÃO SÓ "CONFIRMA?" — mesmo padrão do cancelamento de venda
      // (fase AX). Uma contagem abandonada sem motivo escrito é uma pergunta
      // que ninguém consegue responder meses depois.
      const motivo = await promptModal({
        titulo: `Cancelar a contagem ${count.code}?`,
        descricao: 'Ela fica registrada como cancelada — não é excluída, porque andar pelo'
          + ' galpão é trabalho feito e a acuracidade precisa saber que a contagem existiu.',
        rotulo: 'Motivo do cancelamento',
        placeholder: 'Recontagem necessária, folha aberta por engano...',
        minimo: 3,
        confirmar: 'Cancelar contagem'
      });
      if (!motivo) return;
      try {
        await api(`/api/stock/counts/${encodeURIComponent(count.id)}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: motivo })
        });
        showToast('Contagem cancelada.', 'success');
        voltarParaLista();
      } catch (error) {
        showToast(error.message || 'Erro ao cancelar a contagem.', 'error');
      }
    });
  }

  if (state.stockCountId) await renderFolha();
  else await renderAbertura();
};
