window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const FINANCE_TYPE_TOGGLE = [
  { value: 'RECEITA', label: 'Receita' },
  { value: 'DESPESA', label: 'Despesa' },
  { value: 'TRANSFERENCIA', label: 'Transferência' }
];

window.MavisSubscreenRegistry.finance.novo_lancamento = async function renderFinanceNovoLancamento(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml } = ctx;

  let meta = { categories: [], costCenters: [], bankAccounts: [], directory: [] };
  try {
    meta = await api('/api/finance/meta');
  } catch (error) {
    // segue com metadados vazios
    showToast('Não foi possível carregar categorias/centros de custo/contas bancárias. Os campos correspondentes ficarão vazios.', 'warning');
  }

  let editEntry = null;
  if (state.financeEditEntryId) {
    try {
      const res = await api(`/api/finance/entries/${state.financeEditEntryId}`);
      editEntry = res.entry;
    } catch (error) {
      showToast('Não foi possível carregar o lançamento para edição.', 'error');
    }
    state.financeEditEntryId = null;
  }

  let formType = editEntry ? String(editEntry.type).toUpperCase() : 'DESPESA';

  function directoryOptions(filterText) {
    const term = (filterText || '').trim().toLowerCase();
    const list = term
      ? meta.directory.filter((c) => c.name.toLowerCase().includes(term) || String(c.code || '').toLowerCase().includes(term))
      : meta.directory;
    return list.map((c) => `<option value="${c.id}" ${editEntry && editEntry.clientSupplierId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}${c.code ? ` (${escapeHtml(c.code)})` : ''}</option>`).join('');
  }

  function categoryOptions() {
    return meta.categories.map((c) => `<option value="${c.id}" ${editEntry && editEntry.category === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  }
  function costCenterOptions() {
    return meta.costCenters.map((c) => `<option value="${c.id}" ${editEntry && editEntry.costCenter === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  }
  function bankAccountOptions(selectedId) {
    return meta.bankAccounts.map((c) => `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  }

  function renderForm() {
    const isReceita = formType === 'RECEITA';
    const isTransfer = formType === 'TRANSFERENCIA';
    const today = new Date().toISOString().slice(0, 10);

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>${editEntry ? 'Editar Lançamento' : 'Novo Lançamento'}</h3>
            <p class="muted">${editEntry ? `Editando ${escapeHtml(String(editEntry.id).slice(-8))}` : 'Registre uma receita, despesa ou transferência.'}</p>
          </div>
        </div>

        <div class="finance-period-group" role="tablist" style="margin-bottom: 18px;">
          ${FINANCE_TYPE_TOGGLE.map((opt) => `<button type="button" class="finance-pill ${formType === opt.value ? 'active' : ''}" data-type="${opt.value}" ${editEntry ? 'disabled' : ''}>${opt.label}</button>`).join('')}
        </div>

        <form id="financeEntryForm" class="form-grid">
          <div class="row">
            <label>Data<input type="date" name="date" required value="${editEntry ? editEntry.date : today}" /></label>
            <label>Vencimento<input type="date" name="dueDate" required value="${editEntry ? editEntry.dueDate : today}" /></label>
            <label>Valor<input type="number" step="0.01" min="0.01" name="amount" required value="${editEntry ? editEntry.amountPrevisto : ''}" /></label>
          </div>

          ${isTransfer ? `
            <div class="row">
              <label>Conta de origem
                <div class="finance-inline-select">
                  <select name="sourceBankAccountId" class="js-bank-account-select" required><option value="">Selecione</option>${bankAccountOptions(editEntry ? editEntry.bankAccountId : '')}</select>
                  <button type="button" class="icon-button edit" data-inline-add="bankAccount" title="Nova conta bancária">+</button>
                </div>
              </label>
              <label>Conta de destino
                <div class="finance-inline-select">
                  <select name="targetBankAccountId" class="js-bank-account-select" required><option value="">Selecione</option>${bankAccountOptions(editEntry ? editEntry.targetBankAccountId : '')}</select>
                  <button type="button" class="icon-button edit" data-inline-add="bankAccount" title="Nova conta bancária">+</button>
                </div>
              </label>
            </div>
          ` : `
            <div class="row">
              <label>${isReceita ? 'Cliente' : 'Fornecedor'}
                <input type="text" id="financePartySearch" placeholder="Buscar por nome ou código..." autocomplete="off" value="${editEntry && editEntry.clienteFornecedor ? escapeHtml(editEntry.clienteFornecedor) : ''}" />
              </label>
              <label>&nbsp;
                <select name="clientSupplierId" id="financePartySelect">
                  <option value="">Nenhum (usar nome livre abaixo)</option>
                  ${directoryOptions('')}
                </select>
              </label>
              <label>Nome livre (se não cadastrado)<input name="clientSupplierName" value="${editEntry && !editEntry.clientSupplierId ? escapeHtml(editEntry.clienteFornecedor || '') : ''}" /></label>
            </div>
            <div class="row">
              <label>Conta bancária
                <div class="finance-inline-select">
                  <select name="bankAccountId" class="js-bank-account-select"><option value="">Selecione</option>${bankAccountOptions(editEntry ? editEntry.bankAccountId : '')}</select>
                  <button type="button" class="icon-button edit" data-inline-add="bankAccount" title="Nova conta bancária">+</button>
                </div>
              </label>
              <label>Plano de Contas
                <div class="finance-inline-select">
                  <select name="category" class="js-category-select"><option value="">Selecione</option>${categoryOptions()}</select>
                  <button type="button" class="icon-button edit" data-inline-add="category" title="Nova categoria">+</button>
                </div>
              </label>
              <label>Centro de custo
                <div class="finance-inline-select">
                  <select name="costCenter" class="js-cost-center-select"><option value="">Selecione</option>${costCenterOptions()}</select>
                  <button type="button" class="icon-button edit" data-inline-add="costCenter" title="Novo centro de custo">+</button>
                </div>
              </label>
            </div>
          `}

          <div class="row">
            <label>Documento<input name="document" value="${editEntry ? escapeHtml(editEntry.document || '') : ''}" /></label>
            <label>Descrição<input name="description" required value="${editEntry ? escapeHtml(editEntry.description || '') : ''}" /></label>
          </div>
          <label>Observação<textarea name="note" rows="3">${editEntry ? escapeHtml(editEntry.note || '') : ''}</textarea></label>

          <div id="financeInlineAddRow" class="finance-inline-add hidden">
            <input type="text" id="financeInlineAddInput" placeholder="Nome" />
            <button type="button" class="secondary" id="financeInlineAddConfirm">Adicionar</button>
            <button type="button" class="secondary" id="financeInlineAddCancel">Cancelar</button>
          </div>

          <button type="submit">${editEntry ? 'Salvar alterações' : 'Salvar lançamento'}</button>
        </form>
      </div>
    `;

    attachFormHandlers();
  }

  function renderSuccess(entry) {
    content.innerHTML = `
      <div class="panel finance-coming-soon">
        <div class="finance-coming-soon-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
        </div>
        <h3>Lançamento salvo com sucesso</h3>
        <p class="muted">${escapeHtml(entry.description || '')} — ${financeFormatBRL(entry.amountPrevisto)}</p>
        <div class="finance-actions-row">
          <button type="button" id="financeSuccessView">Ver Lançamento</button>
          <button type="button" class="secondary" id="financeSuccessNew">Novo Lançamento</button>
        </div>
      </div>
    `;
    document.getElementById('financeSuccessView')?.addEventListener('click', () => {
      state.financeOpenEntryId = entry.id;
      state.activeSub = 'lancamentos';
      loadModule('finance');
    });
    document.getElementById('financeSuccessNew')?.addEventListener('click', () => {
      editEntry = null;
      formType = 'DESPESA';
      renderForm();
    });
  }

  let inlineAddKind = null;

  function attachFormHandlers() {
    content.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (editEntry) return;
        formType = btn.dataset.type;
        renderForm();
      });
    });

    document.getElementById('financePartySearch')?.addEventListener('input', (event) => {
      const select = document.getElementById('financePartySelect');
      if (select) {
        select.innerHTML = `<option value="">Nenhum (usar nome livre abaixo)</option>${directoryOptions(event.target.value)}`;
      }
    });

    content.querySelectorAll('[data-inline-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        inlineAddKind = btn.dataset.inlineAdd;
        const row = document.getElementById('financeInlineAddRow');
        const input = document.getElementById('financeInlineAddInput');
        if (row) row.classList.remove('hidden');
        if (input) { input.value = ''; input.focus(); }
      });
    });

    document.getElementById('financeInlineAddCancel')?.addEventListener('click', () => {
      document.getElementById('financeInlineAddRow')?.classList.add('hidden');
      inlineAddKind = null;
    });

    document.getElementById('financeInlineAddConfirm')?.addEventListener('click', async (event) => {
      const confirmBtn = event.target;
      if (confirmBtn.disabled) return;
      const input = document.getElementById('financeInlineAddInput');
      const name = (input?.value || '').trim();
      if (!name) {
        showToast('Informe um nome.', 'warning');
        return;
      }
      confirmBtn.disabled = true;
      const endpointByKind = {
        category: '/api/finance/categories',
        costCenter: '/api/finance/cost-centers',
        bankAccount: '/api/finance/bank-accounts'
      };
      const selectClassByKind = {
        category: '.js-category-select',
        costCenter: '.js-cost-center-select',
        bankAccount: '.js-bank-account-select'
      };
      try {
        const res = await api(endpointByKind[inlineAddKind], { method: 'POST', body: JSON.stringify({ name }) });
        const created = res.category || res.costCenter || res.bankAccount;
        if (inlineAddKind === 'category') meta.categories.push(created);
        if (inlineAddKind === 'costCenter') meta.costCenters.push(created);
        if (inlineAddKind === 'bankAccount') meta.bankAccounts.push(created);

        content.querySelectorAll(selectClassByKind[inlineAddKind]).forEach((select) => {
          const option = document.createElement('option');
          option.value = created.id;
          option.textContent = created.name;
          option.selected = true;
          select.appendChild(option);
        });

        showToast('Cadastrado com sucesso.', 'success');
        document.getElementById('financeInlineAddRow')?.classList.add('hidden');
        inlineAddKind = null;
      } catch (error) {
        showToast(error.message || 'Erro ao cadastrar.', 'error');
      } finally {
        confirmBtn.disabled = false;
      }
    });

    document.getElementById('financeEntryForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(event.target);
      const payload = {
        type: formType,
        date: formData.get('date'),
        dueDate: formData.get('dueDate'),
        amount: Number(formData.get('amount')),
        description: formData.get('description'),
        document: formData.get('document'),
        note: formData.get('note')
      };
      if (formType === 'TRANSFERENCIA') {
        payload.bankAccountId = formData.get('sourceBankAccountId') || '';
        payload.targetBankAccountId = formData.get('targetBankAccountId') || '';
      } else {
        payload.bankAccountId = formData.get('bankAccountId') || '';
        payload.category = formData.get('category') || '';
        payload.costCenter = formData.get('costCenter') || '';
        payload.clientSupplierId = formData.get('clientSupplierId') || '';
        payload.clientSupplierName = formData.get('clientSupplierName') || '';
      }

      try {
        let result;
        if (editEntry) {
          result = await api(`/api/finance/entries/${editEntry.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          result = await api('/api/finance/entries', { method: 'POST', body: JSON.stringify(payload) });
        }
        showToast(editEntry ? 'Lançamento atualizado com sucesso.' : 'Lançamento criado com sucesso.', 'success');
        renderSuccess(result.entry);
      } catch (error) {
        showToast(error.message || 'Erro ao salvar lançamento.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  renderForm();
};
