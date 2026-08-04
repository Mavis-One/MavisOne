window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

const FISCAL_REGIME_OPTIONS = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional' },
  { value: 'SIMPLES_EXCESSO_SUBLIMITE', label: 'Simples Nacional — excesso de sublimite' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real' }
];
const FISCAL_CRT_OPTIONS = [
  { value: '1', label: '1 — Simples Nacional' },
  { value: '2', label: '2 — Simples Nacional (excesso de sublimite)' },
  { value: '3', label: '3 — Regime Normal' },
  { value: '4', label: '4 — MEI' }
];
const FISCAL_ESTAB_TIPO_OPTIONS = [
  { value: 'MATRIZ', label: 'Matriz' },
  { value: 'FILIAL', label: 'Filial' },
  { value: 'DEPOSITO_FECHADO', label: 'Depósito fechado' },
  { value: 'ARMAZEM_GERAL', label: 'Armazém geral' }
];

function fiscalDigitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function fiscalFormatCnpj(digits) {
  const clean = fiscalDigitsOnly(digits);
  if (clean.length !== 14) return digits || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function fiscalFormatCnpjRaiz(digits) {
  const clean = fiscalDigitsOnly(digits);
  if (clean.length !== 8) return digits || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2.$3');
}

window.MavisSubscreenRegistry.settings.fiscal = async function renderSettingsFiscal(ctx) {
  const { content, api, showToast, escapeHtml, confirmModal } = ctx;

  let empresas = [];
  let selectedEmpresaId = null;
  let estabelecimentos = [];
  let empresaForm = null; // null | {} (nova) | objeto empresa (edição)
  let estabForm = null; // null | {} (novo) | objeto estabelecimento (edição)
  let estabStatusById = {};

  async function loadEmpresas() {
    const res = await api('/api/fiscal/empresas');
    empresas = res.empresas || [];
  }

  async function loadEstabelecimentos(empresaId) {
    const res = await api(`/api/fiscal/estabelecimentos?empresaId=${encodeURIComponent(empresaId)}`);
    estabelecimentos = res.estabelecimentos || [];
  }

  function selectedEmpresa() {
    return empresas.find((e) => e.id === selectedEmpresaId) || null;
  }

  function renderEmpresasTable() {
    if (!empresas.length) {
      return '<p class="muted">Nenhuma empresa cadastrada ainda.</p>';
    }
    return `
      <div class="table-scroll">
      <table class="table table-actions">
        <thead><tr><th>Razão social</th><th>CNPJ raiz</th><th>Regime tributário</th><th>CRT</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${empresas.map((emp) => `
            <tr data-empresa-id="${emp.id}" class="${emp.id === selectedEmpresaId ? 'active-row' : ''}">
              <td>${escapeHtml(emp.razaoSocial)}</td>
              <td>${escapeHtml(fiscalFormatCnpjRaiz(emp.cnpjRaiz))}</td>
              <td>${escapeHtml((FISCAL_REGIME_OPTIONS.find((o) => o.value === emp.regimeTributario) || {}).label || emp.regimeTributario)}</td>
              <td>${escapeHtml(String(emp.crt))}</td>
              <td>${emp.ativo ? '<span class="finance-badge finance-badge-success">Ativa</span>' : '<span class="finance-badge finance-badge-muted">Inativa</span>'}</td>
              <td>
                <button type="button" class="secondary fiscal-select-empresa" data-id="${emp.id}">Estabelecimentos</button>
                <button class="edit-empresa icon-button edit" data-id="${emp.id}" title="Editar empresa" aria-label="Editar empresa">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
                <button class="delete-empresa icon-button" data-id="${emp.id}" title="Excluir empresa" aria-label="Excluir empresa">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    `;
  }

  function renderEmpresaForm() {
    if (!empresaForm) return '';
    const isEditing = Boolean(empresaForm.id);
    return `
      <div class="panel">
        <h3>${isEditing ? 'Editar empresa' : 'Nova empresa'}</h3>
        <form id="fiscalEmpresaForm" class="form-grid">
          <div class="row">
            <label>CNPJ raiz (8 dígitos)<input name="cnpjRaiz" required maxlength="8" inputmode="numeric" placeholder="Somente números" value="${escapeHtml(empresaForm.cnpjRaiz || '')}" ${isEditing ? 'disabled' : ''} /></label>
            <label>Razão social<input name="razaoSocial" required value="${escapeHtml(empresaForm.razaoSocial || '')}" /></label>
          </div>
          <div class="row">
            <label>Regime tributário
              <select name="regimeTributario" required>
                ${FISCAL_REGIME_OPTIONS.map((o) => `<option value="${o.value}" ${empresaForm.regimeTributario === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </label>
            <label>CRT
              <select name="crt" required>
                ${FISCAL_CRT_OPTIONS.map((o) => `<option value="${o.value}" ${String(empresaForm.crt || '') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="row">
            <label>Alíquota crédito ICMS SN (%)<input name="aliquotaCreditoIcmsSn" type="number" step="0.0001" min="0" value="${empresaForm.aliquotaCreditoIcmsSn ?? ''}" /></label>
            <label>Vigência da alíquota<input name="aliquotaSnVigencia" type="date" value="${empresaForm.aliquotaSnVigencia || ''}" /></label>
          </div>
          <div class="checkbox-grid">
            <label><input type="checkbox" name="opcaoTransferenciaTributada" ${empresaForm.opcaoTransferenciaTributada ? 'checked' : ''} /> Opção por transferência tributada (Convênio ICMS 109/2024)</label>
            <label><input type="checkbox" name="eImportadora" ${empresaForm.eImportadora ? 'checked' : ''} /> É importadora</label>
            ${isEditing ? `<label><input type="checkbox" name="ativo" ${empresaForm.ativo ? 'checked' : ''} /> Ativa</label>` : ''}
          </div>
          <div class="row">
            <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar empresa'}</button>
            <button type="button" class="secondary" id="fiscalEmpresaCancel">Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderEstabelecimentosSection() {
    const empresa = selectedEmpresa();
    if (!empresa) return '';
    return `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Estabelecimentos — ${escapeHtml(empresa.razaoSocial)}</h3>
            <p class="muted">Matriz e filiais desta empresa. Cada uma tem IE, endereço e token da Focus NFe próprios.</p>
          </div>
          <div class="cadastro-list-actions">
            <button type="button" id="fiscalNewEstabBtn">+ Novo estabelecimento</button>
          </div>
        </div>
        ${estabelecimentos.length ? `
          <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>CNPJ</th><th>Tipo</th><th>Razão social</th><th>UF</th><th>Focus NFe</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              ${estabelecimentos.map((estab) => `
                <tr data-estab-id="${estab.id}">
                  <td>${escapeHtml(fiscalFormatCnpj(estab.cnpj))}</td>
                  <td>${escapeHtml((FISCAL_ESTAB_TIPO_OPTIONS.find((o) => o.value === estab.tipo) || {}).label || estab.tipo)}</td>
                  <td>${escapeHtml(estab.razaoSocial)}</td>
                  <td>${escapeHtml(estab.uf)}</td>
                  <td>${estab.focusTokenConfigured ? `<span class="finance-badge finance-badge-info">${escapeHtml(estab.focusAmbiente === 'producao' ? 'Produção' : 'Homologação')}</span>` : '<span class="finance-badge finance-badge-muted">Sem token</span>'}</td>
                  <td data-estab-status="${estab.id}">${estabStatusById[estab.id] || ''}</td>
                  <td>
                    <button type="button" class="secondary fiscal-test-estab" data-id="${estab.id}">Testar conexão</button>
                    <button class="edit-estab icon-button edit" data-id="${estab.id}" title="Editar estabelecimento" aria-label="Editar estabelecimento">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    </button>
                    <button class="delete-estab icon-button" data-id="${estab.id}" title="Excluir estabelecimento" aria-label="Excluir estabelecimento">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<p class="muted">Nenhum estabelecimento cadastrado ainda.</p>'}
      </div>
      ${renderEstabForm()}
    `;
  }

  function renderEstabForm() {
    if (!estabForm) return '';
    const isEditing = Boolean(estabForm.id);
    return `
      <div class="panel">
        <h3>${isEditing ? 'Editar estabelecimento' : 'Novo estabelecimento'}</h3>
        <form id="fiscalEstabForm" class="form-grid">
          <div class="row">
            <label>CNPJ (14 dígitos)<input name="cnpj" required maxlength="14" inputmode="numeric" placeholder="Somente números" value="${escapeHtml(estabForm.cnpj || '')}" /></label>
            <label>Ordem<input name="ordem" required maxlength="4" value="${escapeHtml(estabForm.ordem || '0001')}" placeholder="0001 = matriz" /></label>
            <label>Tipo
              <select name="tipo" required>
                ${FISCAL_ESTAB_TIPO_OPTIONS.map((o) => `<option value="${o.value}" ${estabForm.tipo === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="row">
            <label>Razão social<input name="razaoSocial" required value="${escapeHtml(estabForm.razaoSocial || '')}" /></label>
            <label>Nome fantasia<input name="nomeFantasia" value="${escapeHtml(estabForm.nomeFantasia || '')}" /></label>
          </div>
          <div class="row">
            <label>E-mail<input name="email" type="email" value="${escapeHtml(estabForm.email || '')}" /></label>
            <label>Telefone<input name="telefone" value="${escapeHtml(estabForm.telefone || '')}" /></label>
            <label>CNAE principal<input name="cnaePrincipal" required maxlength="7" inputmode="numeric" value="${escapeHtml(estabForm.cnaePrincipal || '')}" /></label>
          </div>
          <div class="row">
            <label>Inscrição estadual<input name="inscricaoEstadual" required value="${escapeHtml(estabForm.inscricaoEstadual || '')}" /></label>
            <label>Inscrição estadual (ST)<input name="inscricaoEstadualSt" value="${escapeHtml(estabForm.inscricaoEstadualSt || '')}" /></label>
            <label>Inscrição municipal<input name="inscricaoMunicipal" value="${escapeHtml(estabForm.inscricaoMunicipal || '')}" /></label>
          </div>
          <div class="row">
            <label>Logradouro<input name="logradouro" required value="${escapeHtml(estabForm.logradouro || '')}" /></label>
            <label>Número<input name="numero" required value="${escapeHtml(estabForm.numero || '')}" /></label>
            <label>Complemento<input name="complemento" value="${escapeHtml(estabForm.complemento || '')}" /></label>
          </div>
          <div class="row">
            <label>Bairro<input name="bairro" required value="${escapeHtml(estabForm.bairro || '')}" /></label>
            <label>Código do município (IBGE)<input name="codigoMunicipio" required maxlength="7" inputmode="numeric" value="${escapeHtml(estabForm.codigoMunicipio || '')}" /></label>
            <label>Município<input name="municipio" required value="${escapeHtml(estabForm.municipio || '')}" /></label>
          </div>
          <div class="row">
            <label>UF<input name="uf" required maxlength="2" value="${escapeHtml(estabForm.uf || '')}" /></label>
            <label>CEP<input name="cep" required maxlength="9" value="${escapeHtml(estabForm.cep || '')}" /></label>
          </div>
          <div class="row">
            <label>Token Focus NFe${isEditing ? ' (deixe em branco para manter o atual)' : ''}<input name="focusToken" type="password" autocomplete="off" placeholder="${estabForm.focusTokenConfigured ? '••••••••' : 'Gerado no painel da Focus NFe'}" /></label>
            <label>Ambiente Focus
              <select name="focusAmbiente">
                <option value="homologacao" ${(estabForm.focusAmbiente || 'homologacao') === 'homologacao' ? 'selected' : ''}>Homologação</option>
                <option value="producao" ${estabForm.focusAmbiente === 'producao' ? 'selected' : ''}>Produção</option>
              </select>
            </label>
          </div>
          <div class="checkbox-grid">
            <label><input type="checkbox" name="emiteNfe" ${estabForm.emiteNfe !== false ? 'checked' : ''} /> Emite NF-e</label>
            <label><input type="checkbox" name="emiteNfce" ${estabForm.emiteNfce ? 'checked' : ''} /> Emite NFC-e</label>
            ${isEditing ? `<label><input type="checkbox" name="ativo" ${estabForm.ativo !== false ? 'checked' : ''} /> Ativo</label>` : ''}
          </div>
          <div class="row">
            <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar estabelecimento'}</button>
            <button type="button" class="secondary" id="fiscalEstabCancel">Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderAll() {
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Empresas (fiscal)</h3>
            <p class="muted">Cadastro fiscal completo — usado pra emissão real de NF-e via Focus NFe. Uma linha por raiz de CNPJ.</p>
          </div>
          <div class="cadastro-list-actions">
            <button type="button" id="fiscalNewEmpresaBtn">+ Nova empresa</button>
          </div>
        </div>
        ${renderEmpresasTable()}
      </div>
      ${renderEmpresaForm()}
      ${renderEstabelecimentosSection()}
    `;
    attachHandlers();
  }

  function attachHandlers() {
    document.getElementById('fiscalNewEmpresaBtn')?.addEventListener('click', () => {
      empresaForm = { ativo: true };
      renderAll();
    });
    document.getElementById('fiscalEmpresaCancel')?.addEventListener('click', () => {
      empresaForm = null;
      renderAll();
    });
    document.getElementById('fiscalEmpresaForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        cnpjRaiz: fiscalDigitsOnly(formData.get('cnpjRaiz')),
        razaoSocial: formData.get('razaoSocial'),
        regimeTributario: formData.get('regimeTributario'),
        crt: Number(formData.get('crt')),
        aliquotaCreditoIcmsSn: formData.get('aliquotaCreditoIcmsSn') ? Number(formData.get('aliquotaCreditoIcmsSn')) : null,
        aliquotaSnVigencia: formData.get('aliquotaSnVigencia') || null,
        opcaoTransferenciaTributada: formData.get('opcaoTransferenciaTributada') === 'on',
        eImportadora: formData.get('eImportadora') === 'on',
        ativo: formData.get('ativo') === 'on'
      };
      try {
        if (empresaForm.id) {
          await api(`/api/fiscal/empresas/${empresaForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          showToast('Empresa atualizada com sucesso.', 'success');
        } else {
          await api('/api/fiscal/empresas', { method: 'POST', body: JSON.stringify(payload) });
          showToast('Empresa criada com sucesso.', 'success');
        }
        empresaForm = null;
        await loadEmpresas();
        renderAll();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar empresa.', 'error');
      }
    });

    document.querySelectorAll('.edit-empresa').forEach((btn) => {
      btn.addEventListener('click', () => {
        const empresa = empresas.find((e) => e.id === btn.dataset.id);
        if (!empresa) return;
        empresaForm = { ...empresa };
        renderAll();
      });
    });

    document.querySelectorAll('.delete-empresa').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const empresa = empresas.find((e) => e.id === btn.dataset.id);
        if (!empresa) return;
        const confirmed = await confirmModal(`Excluir a empresa "${empresa.razaoSocial}"? Só é possível se ela não tiver estabelecimentos cadastrados.`);
        if (!confirmed) return;
        try {
          await api(`/api/fiscal/empresas/${empresa.id}`, { method: 'DELETE' });
          showToast('Empresa excluída.', 'success');
          if (selectedEmpresaId === empresa.id) { selectedEmpresaId = null; estabelecimentos = []; }
          await loadEmpresas();
          renderAll();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir empresa.', 'error');
        }
      });
    });

    document.querySelectorAll('.fiscal-select-empresa').forEach((btn) => {
      btn.addEventListener('click', async () => {
        selectedEmpresaId = btn.dataset.id;
        estabForm = null;
        try {
          await loadEstabelecimentos(selectedEmpresaId);
        } catch (error) {
          showToast(error.message || 'Erro ao carregar estabelecimentos.', 'error');
        }
        renderAll();
      });
    });

    document.getElementById('fiscalNewEstabBtn')?.addEventListener('click', () => {
      estabForm = { empresaId: selectedEmpresaId, ordem: '0001', tipo: 'MATRIZ', focusAmbiente: 'homologacao', emiteNfe: true };
      renderAll();
    });
    document.getElementById('fiscalEstabCancel')?.addEventListener('click', () => {
      estabForm = null;
      renderAll();
    });
    document.getElementById('fiscalEstabForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        empresaId: selectedEmpresaId,
        cnpj: fiscalDigitsOnly(formData.get('cnpj')),
        ordem: formData.get('ordem'),
        tipo: formData.get('tipo'),
        razaoSocial: formData.get('razaoSocial'),
        nomeFantasia: formData.get('nomeFantasia'),
        email: formData.get('email'),
        telefone: formData.get('telefone'),
        cnaePrincipal: fiscalDigitsOnly(formData.get('cnaePrincipal')),
        inscricaoEstadual: formData.get('inscricaoEstadual'),
        inscricaoEstadualSt: formData.get('inscricaoEstadualSt'),
        inscricaoMunicipal: formData.get('inscricaoMunicipal'),
        logradouro: formData.get('logradouro'),
        numero: formData.get('numero'),
        complemento: formData.get('complemento'),
        bairro: formData.get('bairro'),
        codigoMunicipio: fiscalDigitsOnly(formData.get('codigoMunicipio')),
        municipio: formData.get('municipio'),
        uf: String(formData.get('uf') || '').toUpperCase(),
        cep: fiscalDigitsOnly(formData.get('cep')),
        focusToken: formData.get('focusToken') || undefined,
        focusAmbiente: formData.get('focusAmbiente'),
        emiteNfe: formData.get('emiteNfe') === 'on',
        emiteNfce: formData.get('emiteNfce') === 'on',
        ativo: formData.get('ativo') === 'on'
      };
      try {
        if (estabForm.id) {
          await api(`/api/fiscal/estabelecimentos/${estabForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          showToast('Estabelecimento atualizado com sucesso.', 'success');
        } else {
          await api('/api/fiscal/estabelecimentos', { method: 'POST', body: JSON.stringify(payload) });
          showToast('Estabelecimento criado com sucesso.', 'success');
        }
        estabForm = null;
        await loadEstabelecimentos(selectedEmpresaId);
        renderAll();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar estabelecimento.', 'error');
      }
    });

    document.querySelectorAll('.edit-estab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const estab = estabelecimentos.find((e) => e.id === btn.dataset.id);
        if (!estab) return;
        estabForm = { ...estab };
        renderAll();
      });
    });

    document.querySelectorAll('.delete-estab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const estab = estabelecimentos.find((e) => e.id === btn.dataset.id);
        if (!estab) return;
        const confirmed = await confirmModal(`Excluir o estabelecimento "${estab.razaoSocial}"?`);
        if (!confirmed) return;
        try {
          await api(`/api/fiscal/estabelecimentos/${estab.id}`, { method: 'DELETE' });
          showToast('Estabelecimento excluído.', 'success');
          await loadEstabelecimentos(selectedEmpresaId);
          renderAll();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir estabelecimento.', 'error');
        }
      });
    });

    document.querySelectorAll('.fiscal-test-estab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cell = document.querySelector(`[data-estab-status="${btn.dataset.id}"]`);
        if (cell) cell.textContent = 'Testando...';
        try {
          const status = await api(`/api/fiscal/estabelecimentos/${btn.dataset.id}/focus-status`);
          const label = status.connected
            ? '<span class="finance-badge finance-badge-success">Conectado</span>'
            : `<span class="finance-badge finance-badge-danger" title="${escapeHtml(status.message || '')}">Falhou</span>`;
          estabStatusById[btn.dataset.id] = label;
          if (cell) cell.innerHTML = label;
        } catch (error) {
          if (cell) cell.textContent = 'Erro: ' + (error.message || error);
        }
      });
    });
  }

  try {
    await loadEmpresas();
  } catch (error) {
    showToast(error.message || 'Erro ao carregar empresas fiscais.', 'error');
  }
  renderAll();
};
