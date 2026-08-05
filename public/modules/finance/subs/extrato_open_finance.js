window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const BANK_TX_STATUS_META = {
  nao_conciliado: { label: 'Não conciliado', tone: 'warning' },
  conciliado: { label: 'Conciliado', tone: 'success' },
  ignorado: { label: 'Ignorado', tone: 'muted' }
};

function bankTxStatusBadge(status) {
  const meta = BANK_TX_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

window.MavisSubscreenRegistry.finance.extrato_open_finance = async function renderExtratoOpenFinance(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml, confirmModal } = ctx;

  let meta = { bankAccounts: [] };
  try {
    meta = await api('/api/finance/meta');
  } catch (error) {
    showToast('Não foi possível carregar as contas bancárias.', 'warning');
  }

  const filters = { bankAccountId: '', status: '', type: '', search: '', dateFrom: '', dateTo: '' };
  let page = 1;
  const limit = 15;

  function bankAccountOptions(selectedId) {
    return meta.bankAccounts.map((acc) => `<option value="${acc.id}" ${selectedId === acc.id ? 'selected' : ''}>${escapeHtml(acc.name)}</option>`).join('');
  }

  function buildQuery() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }

  async function load() {
    if (!meta.bankAccounts.length) {
      renderNoAccounts();
      return;
    }
    let result;
    try {
      result = await api(`/api/finance/bank-transactions?${buildQuery()}`);
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar extrato: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView(result);
  }

  function renderNoAccounts() {
    content.innerHTML = `
      <div class="panel finance-coming-soon">
        <div class="finance-coming-soon-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
        </div>
        <h3>Nenhuma conta bancária cadastrada</h3>
        <p class="muted">Cadastre uma conta bancária em "Novo Lançamento" (ícone "+" ao lado do campo Conta bancária) antes de importar ou lançar um extrato.</p>
        <div class="finance-actions-row">
          <button type="button" id="extratoGoToLancamento">Ir para Novo Lançamento</button>
        </div>
      </div>
    `;
    document.getElementById('extratoGoToLancamento')?.addEventListener('click', () => {
      state.activeSub = 'novo_lancamento';
      loadModule('finance');
    });
  }

  function renderView(result) {
    const totalPages = Math.max(1, Math.ceil(result.total / limit));
    const summary = result.summary || { naoConciliado: 0, conciliado: 0, ignorado: 0 };

    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Extrato Open Finance</h3>
          <p class="muted">${result.total} movimentação${result.total === 1 ? '' : 'ões'} · Importação manual/CSV (sem provedor bancário conectado)</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="extratoNewBtn">+ Nova movimentação</button>
          <button type="button" class="secondary" id="extratoImportBtn">Importar CSV</button>
          <button type="button" class="secondary" id="extratoRefreshBtn">Atualizar</button>
        </div>
      </div>

      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'red', label: 'Não conciliadas', value: String(summary.naoConciliado) })}
        ${financeStatCard({ tone: 'green', label: 'Conciliadas', value: String(summary.conciliado) })}
        ${financeStatCard({ tone: 'cyan', label: 'Ignoradas', value: String(summary.ignorado) })}
      </div>

      <form id="extratoFilterForm" class="cadastro-filter-panel">
        <div class="cadastro-filter-grid-5">
          <label class="cadastro-field">
            <span>Conta bancária</span>
            <select name="bankAccountId"><option value="">Todas</option>${bankAccountOptions(filters.bankAccountId)}</select>
          </label>
          <label class="cadastro-field">
            <span>Status</span>
            <select name="status">
              <option value="">Todos</option>
              ${Object.entries(BANK_TX_STATUS_META).map(([value, m]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </label>
          <label class="cadastro-field">
            <span>Tipo</span>
            <select name="type">
              <option value="">Todos</option>
              <option value="entrada" ${filters.type === 'entrada' ? 'selected' : ''}>Entrada</option>
              <option value="saida" ${filters.type === 'saida' ? 'selected' : ''}>Saída</option>
            </select>
          </label>
          <label class="cadastro-field">
            <span>Busca</span>
            <input name="search" value="${escapeHtml(filters.search)}" placeholder="Descrição" />
          </label>
          <label class="cadastro-field">
            <span>Data inicial</span>
            <input type="date" name="dateFrom" value="${escapeHtml(filters.dateFrom)}" />
          </label>
          <label class="cadastro-field">
            <span>Data final</span>
            <input type="date" name="dateTo" value="${escapeHtml(filters.dateTo)}" />
          </label>
        </div>
        <div class="cadastro-filter-actions">
          <button type="submit">Filtrar</button>
          <button type="button" class="secondary" id="extratoFilterClearBtn">Limpar filtros</button>
        </div>
      </form>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Tipo</th><th>Conta</th><th>Status</th><th>Conciliação</th><th>Ações</th></tr></thead>
            <tbody>
              ${result.transactions.length ? result.transactions.map((tx) => `
                <tr>
                  <td>${financeFormatDate(tx.date)}</td>
                  <td>${escapeHtml(tx.description)}</td>
                  <td class="${tx.type === 'entrada' ? 'finance-positive' : 'finance-negative'}">${tx.type === 'entrada' ? '+' : '-'} ${financeFormatBRL(tx.amount)}</td>
                  <td>${tx.type === 'entrada' ? 'Entrada' : 'Saída'}</td>
                  <td>${escapeHtml(tx.bankAccountName || '-')}</td>
                  <td>${bankTxStatusBadge(tx.status)}</td>
                  <td>${tx.matchedEntryId ? `<span class="finance-clickable-row" data-view-entry="${escapeHtml(tx.matchedEntryId)}">${escapeHtml(tx.matchedEntryDescription || 'Ver lançamento')}</span>` : '<span class="muted">-</span>'}</td>
                  <td class="finance-extrato-actions">
                    ${tx.status === 'nao_conciliado' ? `
                      <button type="button" class="secondary" data-conciliar="${escapeHtml(tx.id)}">Conciliar</button>
                      <button type="button" class="secondary" data-ignorar="${escapeHtml(tx.id)}">Ignorar</button>
                    ` : ''}
                    ${tx.status === 'conciliado' ? `<button type="button" class="secondary" data-desconciliar="${escapeHtml(tx.id)}">Desconciliar</button>` : ''}
                    ${tx.status === 'ignorado' ? `<button type="button" class="secondary" data-reativar="${escapeHtml(tx.id)}">Reativar</button>` : ''}
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="8" class="muted">Nenhuma movimentação encontrada com os filtros atuais.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="finance-pagination">
          <button type="button" class="secondary" id="extratoPrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted">Página ${page} de ${totalPages}</span>
          <button type="button" class="secondary" id="extratoNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
        </div>
      </div>
    `;

    attachViewHandlers(result);
  }

  function attachViewHandlers(result) {
    const totalPages = Math.max(1, Math.ceil(result.total / limit));

    document.getElementById('extratoRefreshBtn')?.addEventListener('click', load);
    document.getElementById('extratoNewBtn')?.addEventListener('click', openNewTransactionModal);
    document.getElementById('extratoImportBtn')?.addEventListener('click', openImportModal);

    document.getElementById('extratoFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      filters.bankAccountId = formData.get('bankAccountId') || '';
      filters.status = formData.get('status') || '';
      filters.type = formData.get('type') || '';
      filters.search = formData.get('search') || '';
      filters.dateFrom = formData.get('dateFrom') || '';
      filters.dateTo = formData.get('dateTo') || '';
      page = 1;
      load();
    });
    document.getElementById('extratoFilterClearBtn')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      page = 1;
      load();
    });

    document.getElementById('extratoPrevPage')?.addEventListener('click', () => { if (page > 1) { page -= 1; load(); } });
    document.getElementById('extratoNextPage')?.addEventListener('click', () => { if (page < totalPages) { page += 1; load(); } });

    content.querySelectorAll('[data-view-entry]').forEach((el) => {
      el.addEventListener('click', () => {
        state.financeOpenEntryId = el.dataset.viewEntry;
        state.activeSub = 'lancamentos';
        loadModule('finance');
      });
    });

    content.querySelectorAll('[data-conciliar]').forEach((btn) => {
      btn.addEventListener('click', () => openConciliarModal(btn.dataset.conciliar));
    });
    content.querySelectorAll('[data-ignorar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/finance/bank-transactions/${btn.dataset.ignorar}/ignorar`, { method: 'POST' });
          showToast('Movimentação ignorada.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao ignorar movimentação.', 'error');
        }
      });
    });
    content.querySelectorAll('[data-desconciliar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal('Confirma desconciliar esta movimentação? A baixa registrada no lançamento vinculado será estornada.');
        if (!confirmed) return;
        try {
          await api(`/api/finance/bank-transactions/${btn.dataset.desconciliar}/desconciliar`, { method: 'POST' });
          showToast('Movimentação desconciliada.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao desconciliar movimentação.', 'error');
        }
      });
    });
    content.querySelectorAll('[data-reativar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/finance/bank-transactions/${btn.dataset.reativar}/reativar`, { method: 'POST' });
          showToast('Movimentação reativada.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao reativar movimentação.', 'error');
        }
      });
    });
  }

  function closeExtratoModal() {
    document.getElementById('extratoModal')?.remove();
  }

  function openNewTransactionModal() {
    closeExtratoModal();
    const overlay = document.createElement('div');
    overlay.id = 'extratoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Nova movimentação</h3>
        <form id="extratoNewForm" class="form-grid">
          <label>Conta bancária<select name="bankAccountId" required><option value="">Selecione</option>${bankAccountOptions('')}</select></label>
          <div class="row">
            <label>Data<input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
            <label>Valor<input type="number" step="0.01" min="0.01" name="amount" required /></label>
          </div>
          <label>Tipo
            <select name="type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
          </label>
          <label>Descrição<input name="description" required /></label>
          <div class="modal-actions">
            <button type="button" class="btn-muted" id="extratoNewCancel">Cancelar</button>
            <button type="submit" class="btn">Registrar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeExtratoModal(); });
    document.getElementById('extratoNewCancel')?.addEventListener('click', closeExtratoModal);
    document.getElementById('extratoNewForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      const formData = new FormData(event.target);
      try {
        await api('/api/finance/bank-transactions', {
          method: 'POST',
          body: JSON.stringify({
            bankAccountId: formData.get('bankAccountId'),
            date: formData.get('date'),
            amount: Number(formData.get('amount')),
            type: formData.get('type'),
            description: formData.get('description')
          })
        });
        showToast('Movimentação registrada com sucesso.', 'success');
        closeExtratoModal();
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao registrar movimentação.', 'error');
        submitBtn.disabled = false;
      }
    });
  }

  function openImportModal() {
    closeExtratoModal();
    const overlay = document.createElement('div');
    overlay.id = 'extratoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <h3>Importar extrato (CSV)</h3>
        <p class="muted">Cole o conteúdo do CSV com cabeçalho <code>data,descricao,valor,tipo</code> (tipo: entrada/saida). Sem provedor Open Finance conectado — esta é a importação manual.</p>
        <form id="extratoImportForm" class="form-grid">
          <label>Conta bancária de destino<select name="bankAccountId" required><option value="">Selecione</option>${bankAccountOptions('')}</select></label>
          <label>Conteúdo CSV<textarea name="csvText" rows="8" placeholder="data,descricao,valor,tipo
2026-08-01,PIX recebido Cliente X,2500,entrada
2026-08-02,Tarifa bancaria,25.50,saida"></textarea></label>
          <div class="modal-actions">
            <button type="button" class="btn-muted" id="extratoImportCancel">Cancelar</button>
            <button type="submit" class="btn">Importar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeExtratoModal(); });
    document.getElementById('extratoImportCancel')?.addEventListener('click', closeExtratoModal);
    document.getElementById('extratoImportForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      const formData = new FormData(event.target);
      try {
        const result = await api('/api/finance/bank-transactions/import', {
          method: 'POST',
          body: JSON.stringify({ bankAccountId: formData.get('bankAccountId'), text: formData.get('csvText') })
        });
        showToast(`${result.count} movimentação(ões) importada(s)${result.skipped ? `, ${result.skipped} linha(s) inválida(s) ignorada(s)` : ''}.`, 'success');
        closeExtratoModal();
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao importar CSV.', 'error');
        submitBtn.disabled = false;
      }
    });
  }

  async function openConciliarModal(txId) {
    let matches = [];
    try {
      const res = await api(`/api/finance/bank-transactions/${txId}/matches`);
      matches = res.matches || [];
    } catch (error) {
      showToast(error.message || 'Erro ao buscar possíveis correspondências.', 'error');
      return;
    }

    closeExtratoModal();
    const overlay = document.createElement('div');
    overlay.id = 'extratoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <h3>Conciliar movimentação</h3>
        <p class="muted">Possíveis correspondências (por valor e data). Escolha uma ou busque manualmente abaixo.</p>
        <div class="finance-due-list" id="extratoMatchesList">
          ${matches.length ? matches.map((m) => `
            <div class="finance-due-item">
              <div>
                <strong>${escapeHtml(m.description)}</strong> ${m.exactAmountMatch ? '<span class="finance-badge finance-badge-success">Valor exato</span>' : ''}
                <div class="muted">${escapeHtml(m.clienteFornecedor || '-')} · Vencimento: ${financeFormatDate(m.dueDate)}</div>
              </div>
              <div class="finance-due-item-amount">
                ${financeFormatBRL(m.remaining)}
                <button type="button" class="secondary" data-match-entry="${escapeHtml(m.id)}">Conciliar com este</button>
              </div>
            </div>
          `).join('') : '<p class="muted">Nenhuma correspondência automática encontrada.</p>'}
        </div>

        <h4 style="margin-top:16px;">Buscar manualmente</h4>
        <div class="row">
          <input type="text" id="extratoManualSearch" placeholder="Buscar lançamento por descrição ou cliente/fornecedor..." />
        </div>
        <div class="finance-due-list" id="extratoManualResults"></div>

        <div class="modal-actions">
          <button type="button" class="btn-muted" id="extratoConciliarCancel">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeExtratoModal(); });
    document.getElementById('extratoConciliarCancel')?.addEventListener('click', closeExtratoModal);

    async function doConciliar(entryId) {
      try {
        await api(`/api/finance/bank-transactions/${txId}/conciliar`, { method: 'POST', body: JSON.stringify({ entryId }) });
        showToast('Movimentação conciliada com sucesso.', 'success');
        closeExtratoModal();
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao conciliar.', 'error');
      }
    }

    overlay.querySelectorAll('[data-match-entry]').forEach((btn) => {
      btn.addEventListener('click', () => doConciliar(btn.dataset.matchEntry));
    });

    let searchTimeout = null;
    document.getElementById('extratoManualSearch')?.addEventListener('input', (event) => {
      clearTimeout(searchTimeout);
      const term = event.target.value.trim();
      searchTimeout = setTimeout(async () => {
        if (!term) {
          document.getElementById('extratoManualResults').innerHTML = '';
          return;
        }
        try {
          const res = await api(`/api/finance/entries?search=${encodeURIComponent(term)}&limit=8`);
          const container = document.getElementById('extratoManualResults');
          if (!container) return;
          const pendentes = res.entries.filter((e) => e.rawStatus === 'pending' || e.rawStatus === 'parcial');
          container.innerHTML = pendentes.length ? pendentes.map((e) => `
            <div class="finance-due-item">
              <div>
                <strong>${escapeHtml(e.description)}</strong>
                <div class="muted">${escapeHtml(e.clienteFornecedor || '-')} · Vencimento: ${financeFormatDate(e.dueDate)}</div>
              </div>
              <div class="finance-due-item-amount">
                ${financeFormatBRL(e.amountPrevisto - e.amountRealizado)}
                <button type="button" class="secondary" data-match-entry="${escapeHtml(e.id)}">Conciliar com este</button>
              </div>
            </div>
          `).join('') : '<p class="muted">Nenhum lançamento pendente encontrado.</p>';
          container.querySelectorAll('[data-match-entry]').forEach((btn) => {
            btn.addEventListener('click', () => doConciliar(btn.dataset.matchEntry));
          });
        } catch (error) {
          showToast(error.message || 'Erro ao buscar lançamentos.', 'error');
        }
      }, 300);
    });
  }

  await load();
};
