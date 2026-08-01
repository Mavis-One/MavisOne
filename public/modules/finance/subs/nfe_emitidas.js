window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const NFE_STATUS_META = {
  autorizada: { label: 'Autorizada', tone: 'success' },
  cancelada: { label: 'Cancelada', tone: 'muted' },
  denegada: { label: 'Denegada', tone: 'danger' },
  rejeitada: { label: 'Rejeitada', tone: 'danger' },
  pendente: { label: 'Pendente', tone: 'warning' }
};

function nfeStatusBadge(status) {
  const meta = NFE_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

function nfeFormatDocument(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value || '-';
}

function nfePrint(nfe) {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return;
  win.opener = null;
  const itemsRows = (nfe.items || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.code || '-')}</td>
      <td>${escapeHtml(item.description || '')}</td>
      <td>${escapeHtml(String(item.quantity ?? ''))}</td>
      <td>${financeFormatBRL(item.unitPrice)}</td>
      <td>${financeFormatBRL(item.total)}</td>
    </tr>
  `).join('');
  win.document.write(`
    <html>
      <head>
        <title>NF-e ${escapeHtml(nfe.number)}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #10213a; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
          .muted { color: #666; }
          .total { text-align: right; font-weight: bold; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>NF-e ${escapeHtml(nfe.number)} / Série ${escapeHtml(nfe.series)}</h1>
        <p class="muted">Documento gerado pelo sistema — registro interno, sem valor fiscal (não é uma DANFE oficial).</p>
        <p><strong>Data de emissão:</strong> ${financeFormatDate(nfe.date)} &nbsp; <strong>Status:</strong> ${escapeHtml((NFE_STATUS_META[nfe.status] || {}).label || nfe.status)}</p>
        <p><strong>Cliente:</strong> ${escapeHtml(nfe.customer)} &nbsp; <strong>CPF/CNPJ:</strong> ${escapeHtml(nfeFormatDocument(nfe.clientDocument))}</p>
        <p><strong>Endereço:</strong> ${escapeHtml(nfe.clientAddress || '-')}, ${escapeHtml(nfe.clientCity || '-')} - ${escapeHtml(nfe.clientState || '-')}</p>
        ${nfe.key ? `<p><strong>Chave:</strong> ${escapeHtml(nfe.key)}</p>` : ''}
        <table>
          <thead><tr><th>Código</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
          <tbody>${itemsRows}</tbody>
        </table>
        <p class="total">Valor total: ${financeFormatBRL(nfe.amount)}</p>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

window.MavisSubscreenRegistry.finance.nfe_emitidas = async function renderFinanceNfeEmitidas(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml, confirmModal } = ctx;

  const filters = { search: '', status: '', dateFrom: '', dateTo: '' };
  let page = 1;
  const limit = 15;

  function buildQuery() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }

  async function load() {
    let result;
    try {
      result = await api(`/api/finance/nfe?${buildQuery()}`);
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar NF-e: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView(result);
  }

  function financialSummary(nfe) {
    if (!nfe.financialEntries.length) return '-';
    const paid = nfe.financialEntries.filter((e) => e.status === 'pago' || e.status === 'recebido').length;
    return `${paid}/${nfe.financialEntries.length} parcela${nfe.financialEntries.length === 1 ? '' : 's'} paga${paid === 1 ? '' : 's'}`;
  }

  function renderView(result) {
    const totalPages = Math.max(1, Math.ceil(result.total / limit));

    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>NF-e Emitidas</h3>
          <p class="muted">${result.total} nota${result.total === 1 ? '' : 's'} encontrada${result.total === 1 ? '' : 's'}</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="nfeNewBtn">+ Nova NF-e</button>
        </div>
      </div>

      <form id="nfeFilterForm" class="row" style="margin-bottom: 12px;">
        <label class="cadastro-field" style="grid-column: span 2;">
          <span>Busca</span>
          <input name="search" value="${escapeHtml(filters.search)}" placeholder="Número, cliente ou chave" />
        </label>
        <label class="cadastro-field">
          <span>Status</span>
          <select name="status">
            <option value="">Todos</option>
            ${Object.entries(NFE_STATUS_META).map(([value, meta]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${meta.label}</option>`).join('')}
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
        <div style="align-self: end;"><button type="submit" class="secondary">Filtrar</button></div>
      </form>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr><th>Número</th><th>Série</th><th>Data</th><th>Cliente</th><th>CPF/CNPJ</th><th>Valor</th><th>Status</th><th>Chave</th><th>Lançamento financeiro</th><th>Ações</th></tr>
            </thead>
            <tbody>
              ${result.nfes.length ? result.nfes.map((nfe) => `
                <tr class="cadastro-row-clickable finance-entry-row" data-id="${escapeHtml(nfe.id)}">
                  <td>${escapeHtml(nfe.number)}</td>
                  <td>${escapeHtml(nfe.series)}</td>
                  <td>${financeFormatDate(nfe.date)}</td>
                  <td>${escapeHtml(nfe.customer)}</td>
                  <td>${nfeFormatDocument(nfe.clientDocument)}</td>
                  <td>${financeFormatBRL(nfe.amount)}</td>
                  <td>${nfeStatusBadge(nfe.status)}</td>
                  <td>${nfe.key ? escapeHtml(nfe.key) : '<span class="muted">-</span>'}</td>
                  <td>${financialSummary(nfe)}</td>
                  <td>${nfe.status === 'autorizada' ? `<button type="button" class="secondary" data-quick-cancel="${nfe.id}">Cancelar</button>` : ''}</td>
                </tr>
              `).join('') : `<tr><td colspan="10" class="muted">Nenhuma NF-e encontrada.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="finance-pagination">
          <button type="button" class="secondary" id="nfePrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted">Página ${page} de ${totalPages}</span>
          <button type="button" class="secondary" id="nfeNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
        </div>
      </div>
    `;

    document.getElementById('nfeNewBtn')?.addEventListener('click', () => {
      state.activeSub = 'nova_nfe_avulsa';
      loadModule('finance');
    });

    document.getElementById('nfeFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      filters.search = formData.get('search') || '';
      filters.status = formData.get('status') || '';
      filters.dateFrom = formData.get('dateFrom') || '';
      filters.dateTo = formData.get('dateTo') || '';
      page = 1;
      load();
    });

    content.querySelectorAll('.finance-entry-row').forEach((row) => {
      row.addEventListener('click', () => openNfeModal(row.dataset.id));
    });
    content.querySelectorAll('[data-quick-cancel]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await cancelNfe(btn.dataset.quickCancel);
      });
    });

    document.getElementById('nfePrevPage')?.addEventListener('click', () => { if (page > 1) { page -= 1; load(); } });
    document.getElementById('nfeNextPage')?.addEventListener('click', () => {
      if (page < totalPages) { page += 1; load(); }
    });
  }

  async function cancelNfe(id) {
    const confirmed = await confirmModal('Confirma o cancelamento desta NF-e? Parcelas ainda pendentes serão canceladas; parcelas já pagas permanecem no histórico.');
    if (!confirmed) return;
    try {
      await api(`/api/finance/nfe/${id}/cancelar`, { method: 'POST' });
      showToast('NF-e cancelada com sucesso.', 'success');
      closeNfeModal();
      await load();
    } catch (error) {
      showToast(error.message || 'Erro ao cancelar NF-e.', 'error');
    }
  }

  function closeNfeModal() {
    document.getElementById('nfeModal')?.remove();
  }

  async function openNfeModal(id) {
    let nfe;
    try {
      const res = await api(`/api/finance/nfe/${id}`);
      nfe = res.nfe;
    } catch (error) {
      showToast(error.message || 'Erro ao carregar NF-e.', 'error');
      return;
    }
    renderNfeModal(nfe);
  }

  function renderNfeModal(nfe) {
    closeNfeModal();
    const overlay = document.createElement('div');
    overlay.id = 'nfeModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="finance-modal-head">
          <div>
            <h3>NF-e ${escapeHtml(nfe.number)} / Série ${escapeHtml(nfe.series)}</h3>
            <p class="muted">${escapeHtml(nfe.customer)} ${nfeStatusBadge(nfe.status)}</p>
          </div>
          <button type="button" class="icon-button" id="nfeModalClose" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        <div class="finance-modal-info-grid">
          <div><span class="muted">Data de emissão</span><strong>${financeFormatDate(nfe.date)}</strong></div>
          <div><span class="muted">CPF/CNPJ</span><strong>${nfeFormatDocument(nfe.clientDocument)}</strong></div>
          <div><span class="muted">Endereço</span><strong>${escapeHtml(nfe.clientAddress || '-')}</strong></div>
          <div><span class="muted">Cidade/UF</span><strong>${escapeHtml(nfe.clientCity || '-')} ${nfe.clientState ? '/ ' + escapeHtml(nfe.clientState) : ''}</strong></div>
          <div><span class="muted">Inscrição estadual</span><strong>${escapeHtml(nfe.clientStateRegistration || '-')}</strong></div>
          <div><span class="muted">Chave de acesso</span><strong>${escapeHtml(nfe.key || '-')}</strong></div>
          <div><span class="muted">Valor total</span><strong>${financeFormatBRL(nfe.amount)}</strong></div>
          <div><span class="muted">Forma de pagamento</span><strong>${nfe.paymentType === 'parcelado' ? `Parcelado (${nfe.installmentsCount}x)` : 'À vista'}</strong></div>
        </div>

        <h4>Itens</h4>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Código</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
            <tbody>
              ${nfe.items.map((item) => `<tr><td>${escapeHtml(item.code || '-')}</td><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${financeFormatBRL(item.unitPrice)}</td><td>${financeFormatBRL(item.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${nfe.taxNotes ? `<p class="muted">Observações fiscais: ${escapeHtml(nfe.taxNotes)}</p>` : ''}

        <h4>Lançamentos financeiros vinculados</h4>
        ${nfe.financialEntries.length ? `
          <div class="finance-due-list">
            ${nfe.financialEntries.map((entry) => `
              <div class="finance-due-item finance-clickable-row" data-view-entry="${entry.id}">
                <div>
                  <strong>${escapeHtml(entry.description)}</strong>
                  <div class="muted">Vencimento: ${financeFormatDate(entry.dueDate)}</div>
                </div>
                <div class="finance-due-item-amount">${financeFormatBRL(entry.amount)} ${financeStatusBadge(entry.status)}</div>
              </div>
            `).join('')}
          </div>
        ` : '<p class="muted">Nenhum lançamento vinculado.</p>'}

        <div class="finance-modal-actions">
          <button type="button" class="secondary" id="nfeModalPrint">Imprimir</button>
          ${nfe.status === 'autorizada' ? `<button type="button" class="btn-danger" id="nfeModalCancel">Cancelar NF-e</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeNfeModal(); });
    document.getElementById('nfeModalClose')?.addEventListener('click', closeNfeModal);
    document.getElementById('nfeModalPrint')?.addEventListener('click', () => nfePrint(nfe));
    document.getElementById('nfeModalCancel')?.addEventListener('click', () => cancelNfe(nfe.id));

    overlay.querySelectorAll('[data-view-entry]').forEach((row) => {
      row.addEventListener('click', () => {
        closeNfeModal();
        state.financeOpenEntryId = row.dataset.viewEntry;
        state.activeSub = 'lancamentos';
        loadModule('finance');
      });
    });
  }

  await load();
};
