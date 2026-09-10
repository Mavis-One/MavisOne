window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const FINANCE_ENTRY_TYPE_OPTIONS = [
  { value: 'receita', label: 'Receita' },
  { value: 'despesa', label: 'Despesa' },
  { value: 'transferencia', label: 'Transferência' }
];

const FINANCE_ENTRY_STATUS_OPTIONS = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'pago', label: 'Pago' },
  { value: 'recebido', label: 'Recebido' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'parcial', label: 'Parcial' },
  { value: 'cancelado', label: 'Cancelado' }
];

window.MavisSubscreenRegistry.finance.lancamentos = async function renderFinanceLancamentos(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml, confirmModal } = ctx;

  let meta = { categories: [], costCenters: [], bankAccounts: [], directory: [] };
  const filters = { search: '', type: '', status: '', clientSupplierId: '', category: '', costCenter: '', bankAccountId: '', dateFrom: '', dateTo: '', dueFrom: '', dueTo: '', amountMin: '', amountMax: '' };
  let showAdvanced = false;
  let page = 1;
  const limit = 15;

  try {
    meta = await api('/api/finance/meta');
  } catch (error) {
    // segue com metadados vazios: a lista funciona, só os selects ficam sem opções
    showToast('Não foi possível carregar categorias/centros de custo/contas bancárias para os filtros.', 'warning');
  }

  function optionList(list) {
    return (list || []).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ''}</option>`).join('');
  }

  function buildQuery(extra) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (extra) Object.entries(extra).forEach(([key, value]) => params.set(key, value));
    return params.toString();
  }

  async function load() {
    let result;
    try {
      result = await api(`/api/finance/entries?${buildQuery()}`);
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar lançamentos: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView(result);
  }

  function attachFilterHandlers() {
    document.getElementById('financeFilterToggleBtn')?.addEventListener('click', () => {
      showAdvanced = !showAdvanced;
      load();
    });

    document.getElementById('financeQuickSearch')?.addEventListener('input', (event) => {
      filters.search = event.target.value;
    });
    document.getElementById('financeQuickSearchForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      page = 1;
      load();
    });

    document.getElementById('financeFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      filters.type = formData.get('type') || '';
      filters.status = formData.get('status') || '';
      filters.clientSupplierId = formData.get('clientSupplierId') || '';
      filters.category = formData.get('category') || '';
      filters.costCenter = formData.get('costCenter') || '';
      filters.bankAccountId = formData.get('bankAccountId') || '';
      filters.dateFrom = formData.get('dateFrom') || '';
      filters.dateTo = formData.get('dateTo') || '';
      filters.dueFrom = formData.get('dueFrom') || '';
      filters.dueTo = formData.get('dueTo') || '';
      filters.amountMin = formData.get('amountMin') || '';
      filters.amountMax = formData.get('amountMax') || '';
      page = 1;
      load();
    });

    document.getElementById('financeFilterClearBtn')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      const searchInput = document.getElementById('financeQuickSearch');
      if (searchInput) searchInput.value = '';
      page = 1;
      load();
    });
  }

  function attachTableHandlers(result) {
    content.querySelectorAll('.finance-entry-row').forEach((row) => {
      row.addEventListener('click', () => openEntryModal(row.dataset.id));
    });
    content.querySelectorAll('[data-quick-baixa]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        openEntryModal(btn.dataset.quickBaixa, { focusPayment: true });
      });
    });

    document.getElementById('financePrevPage')?.addEventListener('click', () => {
      if (page > 1) { page -= 1; load(); }
    });
    document.getElementById('financeNextPage')?.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(result.total / limit));
      if (page < totalPages) { page += 1; load(); }
    });

    document.getElementById('financeNewEntryBtn')?.addEventListener('click', () => {
      state.financeEditEntryId = null;
      state.activeSub = 'novo_lancamento';
      loadModule('finance');
    });
  }

  function renderView(result) {
    const totalPages = Math.max(1, Math.ceil(result.total / limit));

    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Lançamentos</h3>
          <p class="muted">${result.total} lançamento${result.total === 1 ? '' : 's'} encontrado${result.total === 1 ? '' : 's'}</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="financeNewEntryBtn">+ Novo Lançamento</button>
          <button type="button" class="secondary" id="financeFilterToggleBtn">${showAdvanced ? 'Ocultar filtros' : 'Busca avançada'}</button>
        </div>
      </div>

      <form id="financeQuickSearchForm" class="row" style="margin-bottom: 12px;">
        <label class="cadastro-field" style="grid-column: span 3;">
          <span>Busca</span>
          <input id="financeQuickSearch" name="search" value="${escapeHtml(filters.search)}" placeholder="Código, descrição ou cliente/fornecedor" />
        </label>
        <div style="align-self: end;"><button type="submit" class="secondary">Buscar</button></div>
      </form>

      ${showAdvanced ? `
        <form id="financeFilterForm" class="cadastro-filter-panel">
          <div class="cadastro-filter-grid-5">
            <label class="cadastro-field">
              <span>Tipo</span>
              <select name="type">
                <option value="">Todos</option>
                ${FINANCE_ENTRY_TYPE_OPTIONS.map((opt) => `<option value="${opt.value}" ${filters.type === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
              </select>
            </label>
            <label class="cadastro-field">
              <span>Situação</span>
              <select name="status">
                <option value="">Todas</option>
                ${FINANCE_ENTRY_STATUS_OPTIONS.map((opt) => `<option value="${opt.value}" ${filters.status === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
              </select>
            </label>
            <label class="cadastro-field">
              <span>Cliente / Fornecedor</span>
              <select name="clientSupplierId">
                <option value="">Todos</option>
                ${optionList(meta.directory)}
              </select>
            </label>
            <label class="cadastro-field">
              <span>Plano de Contas</span>
              <select name="category">
                <option value="">Todos</option>
                ${optionList(meta.categories)}
              </select>
            </label>
            <label class="cadastro-field">
              <span>Centro de custo</span>
              <select name="costCenter">
                <option value="">Todos</option>
                ${optionList(meta.costCenters)}
              </select>
            </label>
            <label class="cadastro-field">
              <span>Conta bancária</span>
              <select name="bankAccountId">
                <option value="">Todas</option>
                ${optionList(meta.bankAccounts)}
              </select>
            </label>
            <label class="cadastro-field">
              <span>Data inicial</span>
              <input type="date" name="dateFrom" value="${escapeHtml(filters.dateFrom)}" />
            </label>
            <label class="cadastro-field">
              <span>Data final</span>
              <input type="date" name="dateTo" value="${escapeHtml(filters.dateTo)}" />
            </label>
            <label class="cadastro-field">
              <span>Vencimento de</span>
              <input type="date" name="dueFrom" value="${escapeHtml(filters.dueFrom)}" />
            </label>
            <label class="cadastro-field">
              <span>Vencimento até</span>
              <input type="date" name="dueTo" value="${escapeHtml(filters.dueTo)}" />
            </label>
            <label class="cadastro-field">
              <span>Valor mínimo</span>
              <input type="number" step="0.01" name="amountMin" value="${escapeHtml(filters.amountMin)}" />
            </label>
            <label class="cadastro-field">
              <span>Valor máximo</span>
              <input type="number" step="0.01" name="amountMax" value="${escapeHtml(filters.amountMax)}" />
            </label>
          </div>
          <div class="cadastro-filter-actions">
            <button type="submit">Aplicar filtros</button>
            <button type="button" class="secondary" id="financeFilterClearBtn">Limpar filtros</button>
          </div>
        </form>
      ` : ''}

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <th>Código</th><th>Data</th><th>Vencimento</th><th>Descrição</th><th>Tipo</th><th>Categoria</th>
                <th>Cliente/Fornecedor</th><th>Valor previsto</th><th>Valor realizado</th><th>Situação</th><th>Documento</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${result.entries.length ? result.entries.map((entry) => `
                <tr class="cadastro-row-clickable finance-entry-row" data-id="${escapeHtml(entry.id)}">
                  ${/* ERRO CORRIGIDO AQUI (fase AX). A coluna "Código" mostrava os oito
                       últimos caracteres do id interno — "41196-9q1" — que não é
                       número, não ordena e ninguém dita ao telefone. A fase AT criou
                       o número do lançamento (LF0042) e ligou o título da tela de
                       edição; ESTA coluna, que é onde o número é procurado, continuou
                       com o pedaço de uuid. Ver shared/lancamento_codigo.js. */''}
                  <td>${escapeHtml(entry.codigo || '-')}</td>
                  <td>${financeFormatDate(entry.date)}</td>
                  <td>${financeFormatDate(entry.dueDate)}</td>
                  <td>${escapeHtml(entry.description || '-')}</td>
                  <td>${FINANCE_TYPE_LABEL[entry.type] || entry.type}</td>
                  <td>${escapeHtml(entry.categoryName || '-')}</td>
                  <td>${escapeHtml(entry.clienteFornecedor || '-')}</td>
                  <td>${financeFormatBRL(entry.amountPrevisto)}</td>
                  <td>${financeFormatBRL(entry.amountRealizado)}</td>
                  <td>${financeStatusBadge(entry.status)}</td>
                  <td>${escapeHtml(entry.document || '-')}</td>
                  <td>
                    ${(entry.rawStatus === 'pending' || entry.rawStatus === 'parcial') ? `<button type="button" class="secondary" data-quick-baixa="${escapeHtml(entry.id)}">Baixar</button>` : ''}
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="12" class="muted">Nenhum lançamento encontrado com os filtros atuais.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="finance-pagination">
          <button type="button" class="secondary" id="financePrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted">Página ${page} de ${totalPages}</span>
          <button type="button" class="secondary" id="financeNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
        </div>
      </div>
    `;

    attachFilterHandlers();
    attachTableHandlers(result);
  }

  async function openEntryModal(id, options) {
    let entry;
    try {
      const res = await api(`/api/finance/entries/${id}`);
      entry = res.entry;
    } catch (error) {
      showToast(error.message || 'Erro ao carregar lançamento.', 'error');
      return;
    }
    renderEntryModal(entry, options || {});
  }

  function closeEntryModal() {
    document.getElementById('financeEntryModal')?.remove();
  }

  function renderEntryModal(entry, options) {
    closeEntryModal();

    const isReceita = entry.type === 'receita';
    const canPay = entry.rawStatus === 'pending' || entry.rawStatus === 'parcial';
    const canCancel = entry.rawStatus !== 'paid' && entry.rawStatus !== 'cancelado';
    const canEstorno = entry.payments.length > 0;
    const saldoRestante = Math.max(0, entry.amountPrevisto - entry.amountRealizado);
    // A TAXA DA MAQUININHA (fase BX). Só na PRIMEIRA baixa: com uma baixa
    // parcial no meio, o que falta já não é o líquido inteiro, e sugerir que é
    // colocaria um número errado no campo.
    const taxaAAbater = entry.feeAmount != null && entry.netAmount != null && !entry.payments.length
      ? entry.feeAmount
      : 0;
    // O que a credenciadora credita de fato. É este valor que vai aparecer no
    // extrato — baixar pelo bruto deixa o título em "parcial" pela taxa, para
    // sempre.
    const valorSugerido = taxaAAbater > 0 ? entry.netAmount : saldoRestante;

    const overlay = document.createElement('div');
    overlay.id = 'financeEntryModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="finance-modal-head">
          <div>
            <h3>${escapeHtml(entry.description || 'Lançamento')}</h3>
            <p class="muted">${entry.codigo ? `${escapeHtml(entry.codigo)} · ` : ''}${FINANCE_TYPE_LABEL[entry.type] || entry.type} ${financeStatusBadge(entry.status)}</p>
          </div>
          <button type="button" class="icon-button" id="financeModalClose" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        <div class="finance-modal-info-grid">
          <div><span class="muted">Data</span><strong>${financeFormatDate(entry.date)}</strong></div>
          <div><span class="muted">Vencimento</span><strong>${financeFormatDate(entry.dueDate)}</strong></div>
          <div><span class="muted">${isReceita ? 'Cliente' : 'Fornecedor'}</span><strong>${escapeHtml(entry.clienteFornecedor || '-')}</strong></div>
          <div><span class="muted">Categoria</span><strong>${escapeHtml(entry.categoryName || '-')}</strong></div>
          <div><span class="muted">Centro de custo</span><strong>${escapeHtml(entry.costCenterName || '-')}</strong></div>
          <div><span class="muted">Conta bancária</span><strong>${escapeHtml(entry.bankAccountName || '-')}</strong></div>
          <div><span class="muted">Documento</span><strong>${escapeHtml(entry.document || '-')}</strong></div>
          <div><span class="muted">Valor previsto</span><strong>${financeFormatBRL(entry.amountPrevisto)}</strong></div>
          <div><span class="muted">Valor realizado</span><strong>${financeFormatBRL(entry.amountRealizado)}</strong></div>
          <div><span class="muted">Saldo em aberto</span><strong>${financeFormatBRL(saldoRestante)}</strong></div>
        </div>
        ${entry.cardAcquirerName || entry.feeAmount != null ? `
          <div class="finance-cartao-box">
            <h4>Cartão e taxa</h4>
            <div class="finance-modal-info-grid">
              ${entry.cardAcquirerName ? `<div><span class="muted">Credenciadora</span><strong>${escapeHtml(entry.cardAcquirerName)}</strong></div>` : ''}
              ${entry.cardBrand ? `<div><span class="muted">Bandeira</span><strong>${escapeHtml(entry.cardBrandName || entry.cardBrand)}</strong></div>` : ''}
              ${entry.cardAuthorization ? `<div><span class="muted">NSU / Autorização</span><strong>${escapeHtml(entry.cardAuthorization)}</strong></div>` : ''}
              ${entry.feePercent != null ? `<div><span class="muted">Taxa</span><strong>${Number(entry.feePercent).toFixed(2)}%</strong></div>` : ''}
              ${entry.feeAmount != null ? `<div><span class="muted">Taxa em reais</span><strong>${financeFormatBRL(entry.feeAmount)}</strong></div>` : ''}
              ${entry.netAmount != null ? `<div><span class="muted">Crédito previsto</span><strong>${financeFormatBRL(entry.netAmount)} em ${financeFormatDate(entry.dueDate)}</strong></div>` : ''}
            </div>
            ${entry.netAmount != null ? `<p class="muted">
              O valor previsto acima é o BRUTO da venda — é o que o cliente pagou. A credenciadora
              credita ${financeFormatBRL(entry.netAmount)}, já descontada a taxa. É esse o número que vai
              aparecer no extrato.
            </p>` : ''}
          </div>` : ''}
        ${entry.note ? `<p class="muted">Obs: ${escapeHtml(entry.note)}</p>` : ''}

        ${/* Fase AX: por que este lançamento foi cancelado. Fica junto do valor
             porque é a primeira pergunta de quem abre um lançamento cancelado, e
             a resposta vivia só na trilha de auditoria — outra tela, outra busca.

             "Motivo não registrado" para os cancelados antes desta fase: é a
             verdade, e melhor do que uma frase inventada que parece motivo. */''}
        ${entry.rawStatus === 'cancelado' ? `
          <p class="prompt-aviso">
            <strong>Lançamento cancelado${entry.cancelledByName ? ` por ${escapeHtml(entry.cancelledByName)}` : ''}${entry.cancelledAt ? ` em ${financeFormatDate(String(entry.cancelledAt).slice(0, 10))}` : ''}.</strong>
            ${entry.cancelReason
              ? `Motivo: ${escapeHtml(entry.cancelReason)}`
              : 'Motivo não registrado — o cancelamento é anterior à exigência de motivo.'}
          </p>` : ''}

        ${entry.payments.length ? `
          <h4>Histórico de baixas</h4>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Data</th><th>Valor</th><th>Conta</th><th>Juros</th><th>Multa</th><th>Desconto</th><th>Por</th></tr></thead>
              <tbody>
                ${entry.payments.map((p) => `
                  <tr>
                    <td>${financeFormatDate(p.date)}</td>
                    <td>${financeFormatBRL(p.amount)}</td>
                    <td>${escapeHtml(p.bankAccountName || '-')}</td>
                    <td>${financeFormatBRL(p.interest)}</td>
                    <td>${financeFormatBRL(p.fine)}</td>
                    <td>${financeFormatBRL(p.discount)}</td>
                    <td>${escapeHtml(p.createdByName || '-')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}

        ${canPay ? `
          <h4>${isReceita ? 'Recebimento' : 'Pagamento'}</h4>
          <form id="financePaymentForm" class="form-grid">
            <div class="row">
              <label>Valor<input type="number" step="0.01" name="amount" required value="${Number(valorSugerido).toFixed(2)}" /></label>
              <label>Data<input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
              <label>Conta bancária<select name="bankAccountId"><option value="">Selecione</option>${optionListInline(entry, 'bankAccounts')}</select></label>
            </div>
            <div class="row">
              <label>Juros<input type="number" step="0.01" name="interest" value="0" /></label>
              <label>Multa<input type="number" step="0.01" name="fine" value="0" /></label>
              <label>Desconto<input type="number" step="0.01" name="discount" value="${Number(taxaAAbater).toFixed(2)}" /></label>
            </div>
            ${taxaAAbater > 0 ? `<p class="muted">
              Já preenchido com o crédito líquido e a taxa da credenciadora no desconto: assim o título
              fecha pelo bruto e a conta recebe o que recebeu. Sem o desconto, sobrariam
              ${financeFormatBRL(taxaAAbater)} em aberto para sempre.
            </p>` : ''}
            <label>Observação<input name="note" /></label>
            <button type="submit">Registrar ${isReceita ? 'recebimento' : 'pagamento'}</button>
          </form>
        ` : ''}

        <div class="finance-modal-actions">
          ${entry.rawStatus === 'pending' ? `<button type="button" class="secondary" id="financeModalEdit">${entry.editable ? 'Editar' : 'Editar vencimento e classificação'}</button>` : ''}
          ${canEstorno ? `<button type="button" class="secondary" id="financeModalEstorno">Estornar última baixa</button>` : ''}
          ${canCancel ? `<button type="button" class="btn-danger" id="financeModalCancel">Cancelar lançamento</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeEntryModal(); });
    document.getElementById('financeModalClose')?.addEventListener('click', closeEntryModal);

    document.getElementById('financePaymentForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(event.target);
      try {
        await api(`/api/finance/entries/${entry.id}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(formData.get('amount')),
            date: formData.get('date'),
            bankAccountId: formData.get('bankAccountId'),
            interest: Number(formData.get('interest') || 0),
            fine: Number(formData.get('fine') || 0),
            discount: Number(formData.get('discount') || 0),
            note: formData.get('note')
          })
        });
        showToast(`${isReceita ? 'Recebimento' : 'Pagamento'} registrado com sucesso.`, 'success');
        closeEntryModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao registrar baixa.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    document.getElementById('financeModalEstorno')?.addEventListener('click', async () => {
      const confirmed = await confirmModal('Confirma o estorno da última baixa deste lançamento?');
      if (!confirmed) return;
      try {
        await api(`/api/finance/entries/${entry.id}/estorno`, { method: 'POST' });
        showToast('Baixa estornada com sucesso.', 'success');
        closeEntryModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao estornar baixa.', 'error');
      }
    });

    document.getElementById('financeModalCancel')?.addEventListener('click', async () => {
      // MOTIVO, E NÃO SÓ "CONFIRMA?" (fase AX). O mesmo promptModal do
      // cancelamento de NF-e: conta os caracteres enquanto se escreve e só
      // libera o botão quando o texto serve, em vez de deixar escrever, enviar
      // e receber o erro do servidor de volta.
      const motivo = await promptModal({
        titulo: `Cancelar ${entry.codigo || 'lançamento'}`,
        descricao: 'O lançamento continua na lista, marcado como cancelado, com o motivo registrado. O histórico não se perde.',
        rotulo: 'Motivo do cancelamento',
        placeholder: 'Ex.: pedido devolvido pelo cliente em 03/09',
        minimo: 10,
        maximo: 300,
        confirmar: 'Cancelar lançamento'
      });
      if (!motivo) return;
      try {
        await api(`/api/finance/entries/${entry.id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) });
        showToast('Lançamento cancelado.', 'success');
        closeEntryModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao cancelar lançamento.', 'error');
      }
    });

    document.getElementById('financeModalEdit')?.addEventListener('click', () => {
      closeEntryModal();
      state.financeEditEntryId = entry.id;
      state.activeSub = 'novo_lancamento';
      loadModule('finance');
    });

    if (options.focusPayment) {
      document.getElementById('financePaymentForm')?.querySelector('input[name="amount"]')?.focus();
    }
  }

  function optionListInline(entry, kind) {
    if (kind === 'bankAccounts') {
      return meta.bankAccounts.map((acc) => `<option value="${acc.id}" ${entry.bankAccountId === acc.id ? 'selected' : ''}>${escapeHtml(acc.name)}</option>`).join('');
    }
    return '';
  }

  await load();

  if (state.financeOpenEntryId) {
    const entryIdToOpen = state.financeOpenEntryId;
    state.financeOpenEntryId = null;
    openEntryModal(entryIdToOpen);
  }
};
