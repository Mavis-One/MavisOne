window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const NFE_FOCUS_TIPO_OPERACAO_OPTIONS = [
  { value: 'VENDA', label: 'Venda' },
  { value: 'TRANSFERENCIA', label: 'Transferência' },
  { value: 'REMESSA', label: 'Remessa' },
  { value: 'RETORNO', label: 'Retorno' },
  { value: 'DEVOLUCAO', label: 'Devolução' },
  { value: 'BONIFICACAO', label: 'Bonificação' }
];

const NFE_FOCUS_STATUS_BADGE = {
  RASCUNHO: 'finance-badge-muted',
  PROCESSANDO: 'finance-badge-info',
  AUTORIZADO: 'finance-badge-success',
  ERRO: 'finance-badge-danger',
  CANCELADO: 'finance-badge-muted',
  DENEGADO: 'finance-badge-danger',
  INUTILIZADO: 'finance-badge-muted'
};

window.MavisSubscreenRegistry.finance.emitir_nfe_focus = async function renderEmitirNfeFocus(ctx) {
  const { content, api, showToast, escapeHtml, state } = ctx;

  let estabelecimentos = [];
  let selectedEstabelecimentoId = '';
  let meta = { directory: [] };
  let selectedClienteId = '';
  let itens = [{ descricao: '', codigoProduto: '', ncm: '', quantidade: 1, valorUnitario: 0, unidadeComercial: 'UN', origem: 0 }];
  let notasRecentes = [];
  let ultimoResultado = null;

  const destinatario = { nome: '', documento: '', contribuinte: false, inscricaoEstadual: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '', codigoMunicipio: '' };

  try {
    const res = await api('/api/fiscal/estabelecimentos');
    estabelecimentos = (res.estabelecimentos || []).filter((e) => e.ativo && e.emiteNfe);
  } catch (error) {
    showToast('Não foi possível carregar os estabelecimentos: ' + (error.message || error), 'error');
  }

  try {
    meta = await api('/api/finance/meta');
  } catch {
    // segue com diretório vazio — busca de cliente cadastrado fica indisponível
  }

  function itemTotal(item) {
    return Math.round(Number(item.quantidade || 0) * Number(item.valorUnitario || 0) * 100) / 100;
  }

  function grandTotal() {
    return itens.reduce((sum, item) => sum + itemTotal(item), 0);
  }

  async function loadNotasRecentes() {
    if (!selectedEstabelecimentoId) { notasRecentes = []; return; }
    try {
      const res = await api(`/api/fiscal/nfe?estabelecimentoId=${encodeURIComponent(selectedEstabelecimentoId)}`);
      notasRecentes = (res.records || []).slice(0, 10);
    } catch (error) {
      notasRecentes = [];
    }
  }

  function directoryOptions(filterText) {
    const term = (filterText || '').trim().toLowerCase();
    const list = term
      ? meta.directory.filter((c) => c.name.toLowerCase().includes(term) || String(c.document || '').includes(term))
      : meta.directory;
    return list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.document ? ` (${escapeHtml(c.document)})` : ''}</option>`).join('');
  }

  function renderItemsRows() {
    return itens.map((item, index) => `
      <tr data-row="${index}">
        <td><input data-field="descricao" data-index="${index}" value="${escapeHtml(item.descricao)}" required placeholder="Descrição" style="min-width:160px;" /></td>
        <td><input data-field="codigoProduto" data-index="${index}" value="${escapeHtml(item.codigoProduto)}" placeholder="Código" style="width:90px;" /></td>
        <td><input data-field="ncm" data-index="${index}" value="${escapeHtml(item.ncm)}" required maxlength="8" inputmode="numeric" placeholder="8 dígitos" style="width:90px;" /></td>
        <td><input type="number" step="0.01" min="0" data-field="quantidade" data-index="${index}" value="${item.quantidade}" style="width:80px;" /></td>
        <td><input type="number" step="0.01" min="0" data-field="valorUnitario" data-index="${index}" value="${item.valorUnitario}" style="width:100px;" /></td>
        <td><input data-field="unidadeComercial" data-index="${index}" value="${escapeHtml(item.unidadeComercial)}" style="width:70px;" /></td>
        <td class="nfe-item-total" data-row-total="${index}">${financeFormatBRL(itemTotal(item))}</td>
        <td><button type="button" class="icon-button" data-remove-item="${index}" title="Remover item" ${itens.length <= 1 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"></path></svg>
        </button></td>
      </tr>
    `).join('');
  }

  function renderResultado() {
    if (!ultimoResultado) return '';
    const badge = NFE_FOCUS_STATUS_BADGE[ultimoResultado.status] || 'finance-badge-muted';
    return `
      <div class="panel">
        <h3>Resultado da última emissão</h3>
        <p><span class="finance-badge ${badge}">${escapeHtml(ultimoResultado.status)}</span> Referência: ${escapeHtml(ultimoResultado.referencia)}</p>
        ${ultimoResultado.chaveAcesso ? `<p>Chave de acesso: <code>${escapeHtml(ultimoResultado.chaveAcesso)}</code></p>` : ''}
        ${ultimoResultado.mensagemSefaz ? `<p class="muted">${escapeHtml(ultimoResultado.mensagemSefaz)}</p>` : ''}
        ${ultimoResultado.urlDanfe ? `<p><a href="${escapeHtml(ultimoResultado.urlDanfe)}" target="_blank" rel="noopener">Ver DANFE</a></p>` : ''}
      </div>
    `;
  }

  function renderNotasRecentes() {
    if (!selectedEstabelecimentoId) return '';
    return `
      <div class="panel">
        <h3>Últimas NF-e deste estabelecimento</h3>
        ${notasRecentes.length ? `
          <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Referência</th><th>Status</th><th>Número</th><th>Valor</th><th>Data</th></tr></thead>
            <tbody>
              ${notasRecentes.map((nfe) => `
                <tr>
                  <td>${escapeHtml(nfe.referencia)}</td>
                  <td><span class="finance-badge ${NFE_FOCUS_STATUS_BADGE[nfe.status] || 'finance-badge-muted'}">${escapeHtml(nfe.status)}</span></td>
                  <td>${escapeHtml(nfe.numero || '—')}</td>
                  <td>${financeFormatBRL(Number(nfe.valorTotal || 0))}</td>
                  <td>${financeFormatDate(String(nfe.dataEmissao || '').slice(0, 10))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<p class="muted">Nenhuma NF-e emitida ainda por este estabelecimento.</p>'}
      </div>
    `;
  }

  function renderForm() {
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Emitir NF-e (Focus NFe)</h3>
            <p class="muted">Transmite de verdade à SEFAZ via Focus NFe — diferente da "Nova NF-e Avulsa", que só registra localmente.</p>
          </div>
        </div>

        ${!estabelecimentos.length ? `
          <p class="form-error">Nenhum estabelecimento habilitado para emitir NF-e. Cadastre um em Configurações → Integrações → Empresas e estabelecimentos.</p>
        ` : `
        <form id="nfeFocusForm" class="form-grid">
          <div class="cadastro-tabs" role="tablist">
            <button type="button" class="cadastro-tab active" data-tab="emitente" role="tab" aria-selected="true"><span>1. Emitente</span></button>
            <button type="button" class="cadastro-tab" data-tab="destinatario" role="tab" aria-selected="false"><span>2. Destinatário</span></button>
            <button type="button" class="cadastro-tab" data-tab="itens" role="tab" aria-selected="false"><span>3. Itens</span></button>
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="emitente">
            <div class="row">
              <label>Estabelecimento emitente
                <select id="nfeFocusEstabSelect" required>
                  <option value="">Selecione</option>
                  ${estabelecimentos.map((e) => `<option value="${e.id}" ${e.id === selectedEstabelecimentoId ? 'selected' : ''}>${escapeHtml(e.razaoSocial)} — ${escapeHtml(fiscalFormatCnpjSimples(e.cnpj))}</option>`).join('')}
                </select>
              </label>
              <label>Tipo de operação (define a tributação)
                <select name="tipoOperacao">
                  ${NFE_FOCUS_TIPO_OPERACAO_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>Natureza da operação<input name="naturezaOperacao" required value="Venda de mercadoria" /></label>
            <label>Data de emissão<input type="date" name="dataEmissao" required value="${today}" /></label>
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="destinatario" hidden>
            <label>Buscar cliente cadastrado<input type="text" id="nfeFocusClientSearch" placeholder="Buscar por nome ou documento" autocomplete="off" /></label>
            <select id="nfeFocusClientSelect">
              <option value="">Nenhum (preencher manualmente abaixo)</option>
              ${directoryOptions('')}
            </select>
            <div class="row">
              <label>Nome / Razão social<input name="destNome" required value="${escapeHtml(destinatario.nome)}" /></label>
              <label>CPF/CNPJ<input name="destDocumento" required value="${escapeHtml(destinatario.documento)}" /></label>
              <label><input type="checkbox" name="destContribuinte" /> Contribuinte de ICMS</label>
            </div>
            <label>Inscrição estadual (se contribuinte)<input name="destIe" value="${escapeHtml(destinatario.inscricaoEstadual)}" /></label>
            <div class="row">
              <label>CEP<input name="destCep" id="nfeFocusCep" maxlength="9" placeholder="00000-000" /></label>
              <div style="align-self:end;"><button type="button" class="secondary" id="nfeFocusBuscarCep">Buscar CEP</button></div>
            </div>
            <div class="row">
              <label>Logradouro<input name="destLogradouro" required /></label>
              <label>Número<input name="destNumero" required /></label>
              <label>Complemento<input name="destComplemento" /></label>
            </div>
            <div class="row">
              <label>Bairro<input name="destBairro" required /></label>
              <label>Município<input name="destMunicipio" required /></label>
              <label>UF<input name="destUf" maxlength="2" required /></label>
            </div>
            <input type="hidden" name="destCodigoMunicipio" />
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="itens" hidden>
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Descrição</th><th>Código</th><th>NCM</th><th>Qtd.</th><th>Valor unit.</th><th>Unid.</th><th>Total</th><th></th></tr></thead>
                <tbody id="nfeFocusItemsBody">${renderItemsRows()}</tbody>
              </table>
            </div>
            <div style="margin: 10px 0;"><button type="button" class="secondary" id="nfeFocusAddItemBtn">+ Adicionar item</button></div>
            <p class="finance-negative" style="font-size: 1.1rem;">Valor total: <strong id="nfeFocusGrandTotal">${financeFormatBRL(grandTotal())}</strong></p>
          </div>

          <button type="submit" id="nfeFocusSubmitBtn">Emitir NF-e</button>
        </form>
        `}
      </div>

      ${renderResultado()}
      ${renderNotasRecentes()}
    `;

    attachHandlers();
  }

  function refreshItemsTable() {
    const tbody = document.getElementById('nfeFocusItemsBody');
    if (tbody) tbody.innerHTML = renderItemsRows();
    attachItemsHandlers();
    refreshGrandTotal();
  }

  function refreshGrandTotal() {
    const el = document.getElementById('nfeFocusGrandTotal');
    if (el) el.textContent = financeFormatBRL(grandTotal());
  }

  function attachItemsHandlers() {
    document.querySelectorAll('#nfeFocusItemsBody input').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.index);
        const field = input.dataset.field;
        itens[index][field] = field === 'quantidade' || field === 'valorUnitario' ? Number(input.value || 0) : input.value;
        const totalCell = document.querySelector(`[data-row-total="${index}"]`);
        if (totalCell) totalCell.textContent = financeFormatBRL(itemTotal(itens[index]));
        refreshGrandTotal();
      });
    });
    document.querySelectorAll('[data-remove-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.removeItem);
        if (itens.length <= 1) return;
        itens.splice(index, 1);
        refreshItemsTable();
      });
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

    document.getElementById('nfeFocusEstabSelect')?.addEventListener('change', async (event) => {
      selectedEstabelecimentoId = event.target.value;
      await loadNotasRecentes();
      renderForm();
    });

    document.getElementById('nfeFocusClientSearch')?.addEventListener('input', (event) => {
      const select = document.getElementById('nfeFocusClientSelect');
      if (select) select.innerHTML = `<option value="">Nenhum (preencher manualmente abaixo)</option>${directoryOptions(event.target.value)}`;
    });

    document.getElementById('nfeFocusClientSelect')?.addEventListener('change', (event) => {
      const id = event.target.value;
      selectedClienteId = id;
      const found = meta.directory.find((c) => c.id === id);
      if (!found) return;
      const form = document.getElementById('nfeFocusForm');
      if (!form) return;
      form.querySelector('[name="destNome"]').value = found.name || '';
      form.querySelector('[name="destDocumento"]').value = found.document || '';
      form.querySelector('[name="destUf"]').value = found.state || '';
      form.querySelector('[name="destMunicipio"]').value = found.city || '';
      form.querySelector('[name="destIe"]').value = found.stateRegistration || '';
    });

    document.getElementById('nfeFocusBuscarCep')?.addEventListener('click', async () => {
      const form = document.getElementById('nfeFocusForm');
      const cepInput = form.querySelector('[name="destCep"]');
      const cepDigits = (cepInput.value || '').replace(/\D/g, '');
      if (cepDigits.length !== 8) {
        showToast('Informe um CEP com 8 dígitos.', 'warning');
        return;
      }
      try {
        const res = await api(`/api/cep/${cepDigits}`);
        const addr = res.address;
        form.querySelector('[name="destLogradouro"]').value = addr.street || '';
        form.querySelector('[name="destBairro"]').value = addr.neighborhood || '';
        form.querySelector('[name="destMunicipio"]').value = addr.city || '';
        form.querySelector('[name="destUf"]').value = addr.state || '';
        form.querySelector('[name="destCodigoMunicipio"]').value = addr.ibgeCityCode || '';
        showToast('Endereço encontrado.', 'success');
      } catch (error) {
        showToast(error.message || 'CEP não encontrado.', 'error');
      }
    });

    attachItemsHandlers();

    document.getElementById('nfeFocusAddItemBtn')?.addEventListener('click', () => {
      itens.push({ descricao: '', codigoProduto: '', ncm: '', quantidade: 1, valorUnitario: 0, unidadeComercial: 'UN', origem: 0 });
      refreshItemsTable();
    });

    document.getElementById('nfeFocusForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!selectedEstabelecimentoId) {
        showToast('Selecione o estabelecimento emitente.', 'warning');
        return;
      }
      const submitBtn = document.getElementById('nfeFocusSubmitBtn');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;

      const formData = new FormData(event.target);
      const body = {
        estabelecimentoId: selectedEstabelecimentoId,
        tipoOperacao: formData.get('tipoOperacao'),
        naturezaOperacao: formData.get('naturezaOperacao'),
        dataEmissao: formData.get('dataEmissao') ? new Date(formData.get('dataEmissao')).toISOString() : undefined,
        destinatario: {
          nome: formData.get('destNome'),
          documento: formData.get('destDocumento'),
          contribuinte: formData.get('destContribuinte') === 'on',
          inscricaoEstadual: formData.get('destIe'),
          cep: (formData.get('destCep') || '').replace(/\D/g, ''),
          logradouro: formData.get('destLogradouro'),
          numero: formData.get('destNumero'),
          complemento: formData.get('destComplemento'),
          bairro: formData.get('destBairro'),
          municipio: formData.get('destMunicipio'),
          uf: formData.get('destUf'),
          codigoMunicipio: formData.get('destCodigoMunicipio')
        },
        itens: itens.map((item) => ({
          descricao: item.descricao,
          codigoProduto: item.codigoProduto,
          ncm: item.ncm.replace(/\D/g, ''),
          quantidade: Number(item.quantidade || 0),
          valorUnitario: Number(item.valorUnitario || 0),
          unidadeComercial: item.unidadeComercial || 'UN',
          origem: Number(item.origem || 0)
        }))
      };

      try {
        const result = await api('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify(body) });
        ultimoResultado = result.nfe;
        showToast(`NF-e ${result.nfe.status === 'AUTORIZADO' ? 'autorizada' : result.nfe.status.toLowerCase()}.`, result.nfe.status === 'ERRO' ? 'error' : 'success');
      } catch (error) {
        showToast(error.message || 'Erro ao emitir NF-e.', 'error');
      } finally {
        await loadNotasRecentes();
        ultimoResultado = notasRecentes[0] || ultimoResultado;
        renderForm();
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  renderForm();
};

function fiscalFormatCnpjSimples(digits) {
  const clean = String(digits || '').replace(/\D/g, '');
  if (clean.length !== 14) return digits || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
