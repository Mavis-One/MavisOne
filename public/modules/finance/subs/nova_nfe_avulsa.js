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

  // CFOP da tabela oficial (Fase Q). Só as SAÍDAS: esta tela emite nota de
  // venda, e oferecer CFOP de entrada aqui só criaria chance de errar.
  // Sem a migração aplicada, a lista vem vazia e o campo segue como texto livre.
  // A categoria vem embutida na descrição ("Vendas · Venda de ..."): a tabela
  // não tem coluna para isso. Aqui ela volta a ser um campo, para virar o
  // cabeçalho do grupo no select e deixar a opção só com o texto da lei.
  function separarCategoria(descricao) {
    const corte = String(descricao || '').indexOf(' · ');
    if (corte === -1) return { categoria: '', texto: String(descricao || '') };
    return { categoria: descricao.slice(0, corte), texto: descricao.slice(corte + 3) };
  }

  let cfopSaida = [];
  try {
    const tabelas = await api('/api/fiscal/tabelas');
    cfopSaida = (tabelas.cfop || [])
      .filter((c) => c.tipo === 'SAIDA')
      // codigo é char(4) no banco: normaliza para o `selected` comparar direito.
      .map((c) => ({ ...c, codigo: String(c.codigo).trim(), ...separarCategoria(c.descricao) }));
  } catch (error) {
    // Sem permissão fiscal ou tabela ausente: segue sem a lista.
  }

  // Da venda para o resto: a ordem que a pessoa provavelmente procura.
  const ORDEM_CATEGORIA = ['Vendas', 'Devolução', 'Transferência', 'Remessas', 'Estoque', 'Outros'];

  function cfopOptions(escolhido) {
    const grupos = new Map();
    cfopSaida.forEach((c) => {
      if (!grupos.has(c.categoria)) grupos.set(c.categoria, []);
      grupos.get(c.categoria).push(c);
    });
    const posicao = (nome) => {
      const i = ORDEM_CATEGORIA.indexOf(nome);
      return i === -1 ? ORDEM_CATEGORIA.length : i; // categoria nova cai no fim
    };
    return [...grupos.keys()].sort((a, b) => posicao(a) - posicao(b)).map((nome) => {
      const opcoes = grupos.get(nome).map((c) => `
        <option value="${escapeHtml(c.codigo)}" title="${escapeHtml(c.texto)}" ${escolhido === c.codigo ? 'selected' : ''}>${escapeHtml(c.codigo)} — ${escapeHtml(c.texto.slice(0, 55))}${c.texto.length > 55 ? '…' : ''}</option>`).join('');
      // Sem categoria (banco antigo, antes do prefixo) as opções vão soltas.
      return nome ? `<optgroup label="${escapeHtml(nome)}">${opcoes}</optgroup>` : opcoes;
    }).join('');
  }

  // Chegou pelo fluxo Pedido -> Gerar NF-e: a tela nasce preenchida com o
  // pedido em vez de em branco. Consumido UMA vez — sem o delete, voltar aqui
  // depois reabriria a nota do pedido antigo.
  const doPedido = state.nfeFromOrder || null;
  if (doPedido) delete state.nfeFromOrder;

  let selectedClientSupplierId = doPedido?.clientSupplierId || '';
  let items = doPedido?.items?.length
    ? doPedido.items.map((item) => ({ cfop: '', ncm: '', ...item }))
    : [{ code: '', description: '', quantity: 1, unitPrice: 0, cfop: '', ncm: '' }];
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
        <td>${cfopSaida.length ? `
          <select data-field="cfop" data-index="${index}" style="width:230px;" title="Código Fiscal de Operações e Prestações">
            <option value="">CFOP…</option>
            ${cfopOptions(item.cfop)}
          </select>`
          // Sem a tabela fiscal no banco, continua o campo livre que já existia.
          : `<input data-field="cfop" data-index="${index}" value="${escapeHtml(item.cfop)}" placeholder="CFOP" style="width:80px;" />`}</td>
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
    // `select` entrou aqui junto com o CFOP da tabela oficial: caixa de texto
    // avisa por 'input', lista de seleção por 'change'. Escutar só 'input'
    // deixaria o CFOP escolhido sem chegar ao item.
    document.querySelectorAll('#nfeItemsBody input, #nfeItemsBody select').forEach((input) => {
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
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
            <label>Observações fiscais<textarea name="taxNotes" rows="3" placeholder="CFOP geral, natureza da operação, etc. (sem cálculo automático de tributos)">${escapeHtml(doPedido?.taxNotes || '')}</textarea></label>
          </div>

          <div class="finance-actions-row">
            <button type="button" class="secondary" id="nfePreviewBtn">Pré Visualizar</button>
            <button type="submit">Emitir NF-e</button>
          </div>
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

    // Pré Visualizar — espelho da DANFE montado com o que está na tela, ANTES
    // de emitir. Não consulta a SEFAZ (lá a DANFE só existe depois de
    // autorizada) e por isso sai marcado como SEM VALOR FISCAL: serve para
    // conferir forma e conteúdo, não para circular com a mercadoria.
    document.getElementById('nfePreviewBtn')?.addEventListener('click', () => {
      const form = document.getElementById('nfeForm');
      if (!form) return;
      const dados = new FormData(form);
      const linhas = items.filter((item) => item.description);
      if (!linhas.length) {
        showToast('Adicione ao menos um item para pré-visualizar.', 'warning');
        return;
      }
      const janela = window.open('', '_blank', 'noopener,noreferrer');
      if (!janela) {
        showToast('O navegador bloqueou a janela de pré-visualização.', 'warning');
        return;
      }
      janela.opener = null;
      const campo = (nome) => escapeHtml(String(dados.get(nome) || '-'));
      const dinheiro = (v) => financeFormatBRL(Number(v || 0));
      janela.document.write(`
        <html><head><meta charset="utf-8" /><title>Espelho da NF-e</title><style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #10213a; }
          .tarja { border: 2px dashed #b91c1c; color: #b91c1c; text-align: center;
                   font-weight: 700; letter-spacing: .08em; padding: 8px; margin-bottom: 14px; }
          .caixa { border: 1px solid #333; padding: 10px 12px; margin-bottom: 10px; }
          .caixa h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
                      margin: 0 0 8px; color: #555; }
          .grade { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 16px; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 4px; }
          th, td { border: 1px solid #999; padding: 5px 7px; font-size: 11px; text-align: left; }
          th { background: #eee; }
          .num { text-align: right; }
          .totais { display: flex; justify-content: flex-end; gap: 28px; font-size: 13px; margin-top: 10px; }
          .totais strong { font-size: 16px; }
          @media print { .tarja { -webkit-print-color-adjust: exact; } }
        </style></head><body>
          <div class="tarja">ESPELHO — SEM VALOR FISCAL — CONFERÊNCIA ANTES DA EMISSÃO</div>

          <div class="caixa">
            <h2>Destinatário / Remetente</h2>
            <div class="grade">
              <div><strong>Nome:</strong> ${campo('clientName')}</div>
              <div><strong>CPF/CNPJ:</strong> ${campo('clientDocument')}</div>
              <div><strong>Inscrição estadual:</strong> ${campo('clientStateRegistration')}</div>
              <div><strong>Endereço:</strong> ${campo('clientAddress')}</div>
              <div><strong>Município:</strong> ${campo('clientCity')}</div>
              <div><strong>UF:</strong> ${campo('clientState')}</div>
            </div>
          </div>

          <div class="caixa">
            <h2>Dados dos produtos / serviços</h2>
            <table>
              <thead><tr><th>Código</th><th>Descrição</th><th>CFOP</th><th>NCM</th>
                <th class="num">Qtd.</th><th class="num">Valor unit.</th><th class="num">Valor total</th></tr></thead>
              <tbody>${linhas.map((item) => `<tr>
                <td>${escapeHtml(item.code || '-')}</td>
                <td>${escapeHtml(item.description)}</td>
                <td>${escapeHtml(item.cfop || '-')}</td>
                <td>${escapeHtml(item.ncm || '-')}</td>
                <td class="num">${Number(item.quantity || 0)}</td>
                <td class="num">${dinheiro(item.unitPrice)}</td>
                <td class="num">${dinheiro(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td>
              </tr>`).join('')}</tbody>
            </table>
            <div class="totais">
              <div>Itens: ${linhas.length}</div>
              <div><strong>Total: ${dinheiro(grandTotal())}</strong></div>
            </div>
          </div>

          <div class="caixa">
            <h2>Dados adicionais</h2>
            <div style="font-size:12px; white-space: pre-wrap;">${campo('taxNotes')}</div>
          </div>
        </body></html>`);
      janela.document.close();
      janela.focus();
    });

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
        // Amarra a nota ao pedido que a originou (e o servidor fecha o outro
        // lado, gravando a nota no pedido).
        orderId: doPedido?.orderId || '',
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
