window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

function nfeAddDays(dateStr, days) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  const base = (y && m && d) ? new Date(y, m - 1, d) : new Date();
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

function nfeComputeInstallmentsPreview(total, count, intervalDays) {
  const n = Math.max(1, Number(count || 1));
  const per = Math.floor((total / n) * 100) / 100;
  const installments = [];
  let allocated = 0;
  for (let i = 0; i < n; i += 1) {
    const isLast = i === n - 1;
    const amount = isLast ? Math.round((total - allocated) * 100) / 100 : per;
    allocated += amount;
    installments.push({ number: i + 1, offsetDays: n > 1 ? intervalDays * (i + 1) : 0, amount });
  }
  return installments;
}

window.MavisSubscreenRegistry.finance.nova_nfe_avulsa = async function renderNovaNfeAvulsa(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml } = ctx;

  let meta = { directory: [] };
  try {
    meta = await api('/api/finance/meta');
  } catch (error) {
    // segue com diretório vazio
    showToast('Não foi possível carregar o diretório de clientes/fornecedores para busca.', 'warning');
  }

  let selectedClientSupplierId = '';
  let items = [{ code: '', description: '', quantity: 1, unitPrice: 0, cfop: '', ncm: '' }];
  let paymentType = 'avista';

  function directoryOptions(filterText) {
    const term = (filterText || '').trim().toLowerCase();
    const list = term
      ? meta.directory.filter((c) => c.name.toLowerCase().includes(term) || String(c.code || '').toLowerCase().includes(term) || String(c.document || '').includes(term))
      : meta.directory;
    return list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.code ? ` (${escapeHtml(c.code)})` : ''}</option>`).join('');
  }

  function itemTotal(item) {
    return Math.round(Number(item.quantity || 0) * Number(item.unitPrice || 0) * 100) / 100;
  }

  function grandTotal() {
    return items.reduce((sum, item) => sum + itemTotal(item), 0);
  }

  function renderItemsRows() {
    return items.map((item, index) => `
      <tr data-row="${index}">
        <td><input data-field="code" data-index="${index}" value="${escapeHtml(item.code)}" style="width:80px;" /></td>
        <td><input data-field="description" data-index="${index}" value="${escapeHtml(item.description)}" required style="min-width:160px;" /></td>
        <td><input type="number" step="0.01" min="0" data-field="quantity" data-index="${index}" value="${item.quantity}" style="width:80px;" /></td>
        <td><input type="number" step="0.01" min="0" data-field="unitPrice" data-index="${index}" value="${item.unitPrice}" style="width:100px;" /></td>
        <td><input data-field="cfop" data-index="${index}" value="${escapeHtml(item.cfop)}" placeholder="CFOP" style="width:80px;" /></td>
        <td><input data-field="ncm" data-index="${index}" value="${escapeHtml(item.ncm)}" placeholder="NCM" style="width:90px;" /></td>
        <td class="nfe-item-total" data-row-total="${index}">${financeFormatBRL(itemTotal(item))}</td>
        <td><button type="button" class="icon-button" data-remove-item="${index}" title="Remover item" ${items.length <= 1 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"></path></svg>
        </button></td>
      </tr>
    `).join('');
  }

  function refreshGrandTotal() {
    const el = document.getElementById('nfeGrandTotal');
    if (el) el.textContent = financeFormatBRL(grandTotal());
    refreshInstallmentsPreview();
  }

  function refreshItemsTable() {
    const tbody = document.getElementById('nfeItemsBody');
    if (tbody) tbody.innerHTML = renderItemsRows();
    attachItemsHandlers();
    refreshGrandTotal();
  }

  function attachItemsHandlers() {
    document.querySelectorAll('#nfeItemsBody input').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.index);
        const field = input.dataset.field;
        items[index][field] = field === 'quantity' || field === 'unitPrice' ? Number(input.value || 0) : input.value;
        const totalCell = document.querySelector(`[data-row-total="${index}"]`);
        if (totalCell) totalCell.textContent = financeFormatBRL(itemTotal(items[index]));
        refreshGrandTotal();
      });
    });
    document.querySelectorAll('[data-remove-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.removeItem);
        if (items.length <= 1) return;
        items.splice(index, 1);
        refreshItemsTable();
      });
    });
  }

  function refreshInstallmentsPreview() {
    const container = document.getElementById('nfeInstallmentsPreview');
    if (!container) return;
    const dateInput = document.querySelector('input[name="date"]');
    const countInput = document.getElementById('nfeInstallmentsCount');
    const intervalInput = document.getElementById('nfeInstallmentInterval');
    const count = paymentType === 'parcelado' ? Number(countInput?.value || 2) : 1;
    const interval = Number(intervalInput?.value || 30);
    const baseDate = dateInput?.value || new Date().toISOString().slice(0, 10);
    const preview = nfeComputeInstallmentsPreview(grandTotal(), count, interval);
    container.innerHTML = preview.map((inst) => `
      <div class="finance-due-item">
        <div>Parcela ${inst.number}/${preview.length}</div>
        <div class="finance-due-item-amount">${financeFormatBRL(inst.amount)}<span class="muted">Venc. ${financeFormatDate(nfeAddDays(baseDate, inst.offsetDays))}</span></div>
      </div>
    `).join('');
  }

  function renderForm() {
    const today = new Date().toISOString().slice(0, 10);

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Nova NF-e Avulsa</h3>
            <p class="muted">Registro estruturado de NF-e — não realiza transmissão real à SEFAZ.</p>
          </div>
        </div>

        <form id="nfeForm" class="form-grid">
          <div class="row">
            <label>Número<input name="number" placeholder="Gerado automaticamente se vazio" /></label>
            <label>Série<input name="series" value="1" /></label>
            <label>Data de emissão<input type="date" name="date" required value="${today}" /></label>
          </div>

          <div class="cadastro-tabs" role="tablist">
            <button type="button" class="cadastro-tab active" data-tab="cliente" role="tab" aria-selected="true"><span>1. Cliente</span></button>
            <button type="button" class="cadastro-tab" data-tab="itens" role="tab" aria-selected="false"><span>2. Produtos/Serviços</span></button>
            <button type="button" class="cadastro-tab" data-tab="tributacao" role="tab" aria-selected="false"><span>3. Tributação</span></button>
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="cliente">
            <label>Buscar cliente cadastrado<input type="text" id="nfeClientSearch" placeholder="Buscar por nome, código ou documento" autocomplete="off" /></label>
            <select id="nfeClientSelect">
              <option value="">Nenhum (preencher manualmente abaixo)</option>
              ${directoryOptions('')}
            </select>
            <div class="row">
              <label>Nome / Razão social<input name="clientName" required /></label>
              <label>CPF/CNPJ<input name="clientDocument" required /></label>
            </div>
            <div class="row">
              <label>Endereço<input name="clientAddress" /></label>
              <label>Cidade<input name="clientCity" /></label>
              <label>Estado (UF)<input name="clientState" maxlength="2" /></label>
            </div>
            <label>Inscrição estadual<input name="clientStateRegistration" /></label>
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="itens" hidden>
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Código</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>CFOP</th><th>NCM</th><th>Total</th><th></th></tr></thead>
                <tbody id="nfeItemsBody">${renderItemsRows()}</tbody>
              </table>
            </div>
            <div style="margin: 10px 0;"><button type="button" class="secondary" id="nfeAddItemBtn">+ Adicionar item</button></div>
            <p class="finance-negative" style="font-size: 1.1rem;">Valor total: <strong id="nfeGrandTotal">${financeFormatBRL(grandTotal())}</strong></p>
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="tributacao" hidden>
            <label>Forma de pagamento</label>
            <div class="finance-period-group" role="tablist">
              <button type="button" class="finance-pill active" data-payment-type="avista">À vista</button>
              <button type="button" class="finance-pill" data-payment-type="parcelado">Parcelado</button>
            </div>
            <div id="nfeInstallmentFields" class="row hidden" style="margin-top: 12px;">
              <label>Número de parcelas<input type="number" id="nfeInstallmentsCount" min="2" max="60" step="1" value="2" /></label>
              <label>Intervalo entre parcelas (dias)<input type="number" id="nfeInstallmentInterval" min="1" value="30" /></label>
            </div>
            <div id="nfeInstallmentsPreview" class="finance-due-list" style="margin-top: 10px;"></div>

            <label style="margin-top: 16px;">Chave de acesso (opcional)<input name="key" placeholder="Se houver emissão externa" /></label>
            <label>Observações fiscais<textarea name="taxNotes" rows="3" placeholder="CFOP geral, natureza da operação, etc. (sem cálculo automático de tributos)"></textarea></label>
          </div>

          <button type="submit">Emitir NF-e</button>
        </form>
      </div>
    `;

    attachHandlers();
    refreshInstallmentsPreview();
  }

  function renderSuccess(nfe) {
    content.innerHTML = `
      <div class="panel finance-coming-soon">
        <div class="finance-coming-soon-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
        </div>
        <h3>NF-e emitida com sucesso</h3>
        <p class="muted">NF-e ${escapeHtml(nfe.number)} — ${financeFormatBRL(nfe.amount)} — ${nfe.financialEntries.length} parcela${nfe.financialEntries.length === 1 ? '' : 's'} gerada${nfe.financialEntries.length === 1 ? '' : 's'} em Lançamentos.</p>
        <div class="finance-actions-row">
          <button type="button" id="nfeSuccessView">Ver NF-e</button>
          <button type="button" class="secondary" id="nfeSuccessNew">Nova NF-e</button>
        </div>
      </div>
    `;
    document.getElementById('nfeSuccessView')?.addEventListener('click', () => {
      state.activeSub = 'nfe_emitidas';
      loadModule('finance');
    });
    document.getElementById('nfeSuccessNew')?.addEventListener('click', () => {
      selectedClientSupplierId = '';
      items = [{ code: '', description: '', quantity: 1, unitPrice: 0, cfop: '', ncm: '' }];
      paymentType = 'avista';
      renderForm();
    });
  }

  function attachHandlers() {
    content.querySelectorAll('.cadastro-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.tab;
        content.querySelectorAll('.cadastro-tab').forEach((btn) => {
          const isActive = btn === tabBtn;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
        });
        content.querySelectorAll('.cadastro-tab-panel').forEach((panel) => {
          panel.hidden = panel.dataset.tabPanel !== target;
        });
      });
    });

    document.getElementById('nfeClientSearch')?.addEventListener('input', (event) => {
      const select = document.getElementById('nfeClientSelect');
      if (select) select.innerHTML = `<option value="">Nenhum (preencher manualmente abaixo)</option>${directoryOptions(event.target.value)}`;
    });

    document.getElementById('nfeClientSelect')?.addEventListener('change', (event) => {
      const id = event.target.value;
      selectedClientSupplierId = id;
      const found = meta.directory.find((c) => c.id === id);
      if (!found) return;
      const form = document.getElementById('nfeForm');
      if (!form) return;
      form.querySelector('[name="clientName"]').value = found.name || '';
      form.querySelector('[name="clientDocument"]').value = found.document || '';
      form.querySelector('[name="clientAddress"]').value = found.address || '';
      form.querySelector('[name="clientCity"]').value = found.city || '';
      form.querySelector('[name="clientState"]').value = found.state || '';
      form.querySelector('[name="clientStateRegistration"]').value = found.stateRegistration || '';
    });

    attachItemsHandlers();

    document.getElementById('nfeAddItemBtn')?.addEventListener('click', () => {
      items.push({ code: '', description: '', quantity: 1, unitPrice: 0, cfop: '', ncm: '' });
      refreshItemsTable();
    });

    content.querySelectorAll('[data-payment-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        paymentType = btn.dataset.paymentType;
        content.querySelectorAll('[data-payment-type]').forEach((b) => b.classList.toggle('active', b === btn));
        document.getElementById('nfeInstallmentFields')?.classList.toggle('hidden', paymentType !== 'parcelado');
        refreshInstallmentsPreview();
      });
    });

    document.getElementById('nfeInstallmentsCount')?.addEventListener('input', refreshInstallmentsPreview);
    document.getElementById('nfeInstallmentInterval')?.addEventListener('input', refreshInstallmentsPreview);
    document.querySelector('input[name="date"]')?.addEventListener('input', refreshInstallmentsPreview);

    document.getElementById('nfeForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(event.target);
      const payload = {
        number: formData.get('number'),
        series: formData.get('series') || '1',
        date: formData.get('date'),
        customer: formData.get('clientName'),
        clientDocument: formData.get('clientDocument'),
        clientSupplierId: selectedClientSupplierId,
        clientAddress: formData.get('clientAddress'),
        clientCity: formData.get('clientCity'),
        clientState: formData.get('clientState'),
        clientStateRegistration: formData.get('clientStateRegistration'),
        items: items.map((item) => ({
          code: item.code,
          description: item.description,
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unitPrice || 0),
          cfop: item.cfop,
          ncm: item.ncm
        })),
        taxNotes: formData.get('taxNotes'),
        key: formData.get('key'),
        paymentType,
        installmentsCount: Number(document.getElementById('nfeInstallmentsCount')?.value || 2),
        installmentIntervalDays: Number(document.getElementById('nfeInstallmentInterval')?.value || 30)
      };

      try {
        const result = await api('/api/finance/nfe', { method: 'POST', body: JSON.stringify(payload) });
        showToast('NF-e emitida com sucesso.', 'success');
        renderSuccess(result.nfe);
      } catch (error) {
        showToast(error.message || 'Erro ao emitir NF-e.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  renderForm();
};
