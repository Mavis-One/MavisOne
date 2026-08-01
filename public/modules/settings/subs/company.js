window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

const SETTINGS_AUDIT_ACTION_LABELS = {
  createUser: 'Criação de usuário',
  deleteUser: 'Exclusão de usuário',
  criarLancamento: 'Criação de lançamento',
  editarLancamento: 'Edição de lançamento',
  baixarLancamento: 'Baixa de lançamento',
  estornarLancamento: 'Estorno de baixa',
  cancelarLancamento: 'Cancelamento de lançamento',
  emitirNfe: 'Emissão de NF-e',
  cancelarNfe: 'Cancelamento de NF-e',
  conciliarTransacao: 'Conciliação de extrato bancário'
};

window.MavisSubscreenRegistry.settings.company = async function renderSettingsCompany(ctx) {
  const { content, data, api, showToast, loadModule, moduleLabels, state, confirmModal, escapeHtml } = ctx;

  const totals = data.totals || {};
  const settingsPermissions = data.permissions || {};
  const canManageCompany = Boolean(settingsPermissions.company);
  const canManageUsers = Boolean(settingsPermissions.users);

  content.innerHTML = `
    <div class="cards">
      ${canManageUsers ? `<div class="card"><h3>Usuários</h3><p>${totals.totalUsers ?? (data.users || []).length}</p></div>` : ''}
      <div class="card"><h3>Produtos</h3><p>${totals.totalProducts ?? 0}</p></div>
      <div class="card"><h3>Vendas</h3><p>${totals.totalSales ?? 0}</p></div>
      <div class="card"><h3>Compras</h3><p>${totals.totalPurchases ?? 0}</p></div>
    </div>

    ${canManageCompany ? `
    <div class="panel">
      <h3>Configurações da empresa</h3>
      <form id="companyForm" class="form-grid">
        <div class="row">
          <label>Nome da empresa<input name="companyName" value="${escapeHtml(data.settings.companyName)}" /></label>
          <label>Moeda<input name="currency" value="${escapeHtml(data.settings.currency)}" /></label>
          <label>Imposto (%)<input name="taxRate" type="number" value="${escapeHtml(String(data.settings.taxRate))}" /></label>
        </div>
        <button type="submit">Salvar</button>
      </form>
    </div>
    ` : '<div class="panel"><p>Sem permissão para visualizar configurações da empresa.</p></div>'}

    ${canManageUsers ? `
    <div class="panel">
      <h3>Criar usuário</h3>
      <form id="userForm" class="form-grid">
        <div class="row">
          <label>Nome<input name="name" required /></label>
          <label>Usuário<input name="username" required /></label>
          <label>Senha<input name="password" required /></label>
        </div>
        <div class="row">
          <label>Função<select name="role"><option value="user">Usuário</option><option value="admin">Admin</option></select></label>
        </div>
        <div class="checkbox-grid">
          ${['dashboard', 'sales', 'purchases', 'stock', 'finance', 'settings', 'cadastros'].map((module) => `<label><input type="checkbox" name="module" value="${module}" /> ${moduleLabels[module]}</label>`).join('')}
        </div>
        <button type="submit">Criar usuário</button>
      </form>
    </div>

    <div class="panel">
      <h3>Usuários cadastrados</h3>
      <table class="table table-actions">
        <thead><tr><th>Usuário</th><th>Nome</th><th>Função</th><th>Módulos</th><th>Ações</th></tr></thead>
        <tbody>
          ${data.users.map((user) => `\n            <tr data-user-id="${user.id}">\n              <td>${escapeHtml(user.username)}</td>\n              <td>${escapeHtml(user.name)}</td>\n              <td>${escapeHtml(user.role)}</td>\n              <td>${escapeHtml(user.allowedModules.join(', '))}</td>\n              <td>\n                <button class="delete-user icon-button" data-id="${user.id}" title="Excluir usuário" ${state.user?.role !== 'admin' || state.user?.id === user.id ? 'disabled' : ''}>\n                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>\n                </button>\n              </td>\n            </tr>\n          `).join('') }
        </tbody>
      </table>
    </div>
    ` : '<div class="panel"><p>Sem permissão para visualizar dados de usuários.</p></div>'}

    <div class="panel">
      <h3>Auditoria</h3>
      <div class="row" style="margin-bottom: 12px;">
        <button type="button" class="secondary" id="auditRefresh">Atualizar</button>
        <button type="button" class="secondary" id="auditPrev">Anterior</button>
        <button type="button" class="secondary" id="auditNext">Próximo</button>
      </div>
      <table class="table table-actions">
        <thead><tr><th>Ação</th><th>Alvo</th><th>Por</th><th>Data</th></tr></thead>
        <tbody id="auditBody"></tbody>
      </table>
      <p id="auditEmpty" class="muted">Nenhum registro de auditoria.</p>
    </div>
  `;

  document.getElementById('companyForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ type: 'company', payload: { companyName: formData.get('companyName'), currency: formData.get('currency'), taxRate: Number(formData.get('taxRate')) } })
      });
      showToast('Configurações da empresa salvas com sucesso.', 'success');
      loadModule('settings');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar configurações da empresa.', 'error');
    }
  });

  document.getElementById('userForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const selectedModules = formData.getAll('module');
    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ type: 'user', payload: { name: formData.get('name'), username: formData.get('username'), password: formData.get('password'), role: formData.get('role'), allowedModules: selectedModules } })
      });
      showToast('Usuário criado com sucesso.', 'success');
      loadModule('settings');
    } catch (error) {
      showToast(error.message || 'Erro ao criar usuário.', 'error');
    }
  });

  document.querySelectorAll('.delete-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const id = btn.dataset.id;
      if (!id) return;
      const row = btn.closest('tr');
      const username = row?.querySelector('td')?.textContent || id;
      const confirmed = await confirmModal(`Confirma exclusão do usuário "${username}"?`);
      if (!confirmed) return;
      try {
        await api('/api/users/delete', { method: 'POST', body: JSON.stringify({ id }) });
        showToast('Usuário excluído com sucesso.', 'success');
        loadModule('settings');
      } catch (err) {
        showToast('Erro ao excluir: ' + err.message, 'error');
      }
    });
  });

  if (state.user?.role === 'admin') {
    let auditOffset = 0;
    const auditLimit = 20;
    async function loadAudit() {
      try {
        const res = await api(`/api/audit?limit=${auditLimit}&offset=${auditOffset}`);
        const logs = res.auditLogs || [];
        const auditBody = document.getElementById('auditBody');
        const auditEmpty = document.getElementById('auditEmpty');
        if (!auditBody || !auditEmpty) return;
        auditBody.innerHTML = logs.map((log) => `
          <tr>
            <td>${escapeHtml(SETTINGS_AUDIT_ACTION_LABELS[log.action] || log.action)}</td>
            <td>${escapeHtml(log.targetUsername || log.targetId)}</td>
            <td>${escapeHtml(log.byName || log.byId)}</td>
            <td>${escapeHtml(new Date(log.at).toLocaleString())}</td>
          </tr>
        `).join('');
        auditEmpty.style.display = logs.length ? 'none' : 'block';
      } catch (err) {
        showToast('Erro ao carregar logs: ' + (err.message || err), 'error');
      }
    }

    document.getElementById('auditRefresh')?.addEventListener('click', () => { auditOffset = 0; loadAudit(); });
    document.getElementById('auditPrev')?.addEventListener('click', () => { auditOffset = Math.max(0, auditOffset - auditLimit); loadAudit(); });
    document.getElementById('auditNext')?.addEventListener('click', () => { auditOffset = auditOffset + auditLimit; loadAudit(); });

    setTimeout(loadAudit, 50);
  }
};
