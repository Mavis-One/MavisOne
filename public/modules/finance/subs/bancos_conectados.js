window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const OPEN_FINANCE_CONNECTION_STATUS_META = {
  pending: { label: 'Pendente', tone: 'warning' },
  connected: { label: 'Conectado', tone: 'success' },
  error: { label: 'Erro', tone: 'danger' },
  disconnected: { label: 'Desconectado', tone: 'muted' }
};

function openFinanceConnectionStatusBadge(status) {
  const meta = OPEN_FINANCE_CONNECTION_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

// createdAt/lastSyncAt/receivedAt são timestamptz completos (data + hora),
// diferente do financeFormatDate() do dashboard (que espera só "YYYY-MM-DD").
function openFinanceFormatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

window.MavisSubscreenRegistry.finance.bancos_conectados = async function renderBancosConectados(ctx) {
  const { content, api, showToast, escapeHtml, confirmModal } = ctx;

  let status = { configured: false, provider: null, connected: false, message: '' };
  let estabelecimentos = [];
  let connections = [];

  try {
    status = await api('/api/open-finance/status');
  } catch (error) {
    showToast('Não foi possível verificar o status do Open Finance.', 'warning');
  }

  try {
    const res = await api('/api/fiscal/estabelecimentos');
    estabelecimentos = (res.estabelecimentos || []).filter((e) => e.ativo);
  } catch (error) {
    // Sem permissão de Fiscal > Visualizar (ou nenhum estabelecimento
    // cadastrado ainda) — a tela segue funcionando, só sem o seletor.
  }

  function estabelecimentoLabel(id) {
    const found = estabelecimentos.find((e) => e.id === id);
    return found ? (found.nomeFantasia || found.razaoSocial) : id;
  }

  async function loadConnections() {
    try {
      const res = await api('/api/open-finance/connections');
      connections = res.connections || [];
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar conexões: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView();
  }

  function renderView() {
    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Bancos Conectados</h3>
          <p class="muted">Conexões de Open Finance (Pluggy/Polp/Celcoin) por estabelecimento.</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="bancosConectarBtn">+ Conectar banco</button>
          <button type="button" class="secondary" id="bancosRefreshBtn">Atualizar</button>
        </div>
      </div>

      ${!status.configured ? `
        <div class="panel finance-coming-soon">
          <div class="finance-coming-soon-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
          </div>
          <h3>Nenhum provedor bancário configurado</h3>
          <p class="muted">${escapeHtml(status.message || 'Configure OPEN_FINANCE_PROVIDER e as credenciais no .env do servidor para conectar um banco de verdade.')}</p>
          <p class="muted">Até lá, o Extrato Open Finance continua funcionando no modo manual/CSV.</p>
        </div>
      ` : `
        <div class="panel">
          <p class="muted">Provedor ativo: <strong>${escapeHtml(status.provider || '-')}</strong> · ${escapeHtml(status.message || '')}</p>
        </div>
      `}

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>Estabelecimento</th><th>Provider</th><th>Status</th><th>Última sincronização</th><th>Ações</th></tr></thead>
            <tbody>
              ${connections.length ? connections.map((c) => `
                <tr>
                  <td>${escapeHtml(estabelecimentoLabel(c.estabelecimentoId))}</td>
                  <td>${escapeHtml(c.provider || '-')}</td>
                  <td>
                    ${openFinanceConnectionStatusBadge(c.status)}
                    ${c.errorMessage ? `<div class="muted" style="margin-top:4px;">${escapeHtml(c.errorMessage)}</div>` : ''}
                  </td>
                  <td>${openFinanceFormatDateTime(c.lastSyncAt)}</td>
                  <td class="finance-extrato-actions">
                    ${c.status !== 'disconnected' ? `
                      <button type="button" class="secondary" data-sync="${escapeHtml(c.id)}">Sincronizar agora</button>
                      <button type="button" class="secondary" data-disconnect="${escapeHtml(c.id)}">Desconectar</button>
                    ` : ''}
                    <button type="button" class="secondary" data-audit="${escapeHtml(c.id)}">Auditoria</button>
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="5" class="muted">Nenhuma conexão cadastrada ainda.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
    attachHandlers();
  }

  function attachHandlers() {
    document.getElementById('bancosRefreshBtn')?.addEventListener('click', loadConnections);
    document.getElementById('bancosConectarBtn')?.addEventListener('click', openConectarModal);

    content.querySelectorAll('[data-sync]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await api(`/api/open-finance/connections/${btn.dataset.sync}/sync`, { method: 'POST' });
          const r = res.resultado || {};
          showToast(`Sincronizado: ${r.contasCriadas || 0} conta(s) nova(s), ${r.contasAtualizadas || 0} atualizada(s), ${r.transacoesCriadas || 0} transação(ões) nova(s).`, 'success');
          loadConnections();
        } catch (error) {
          showToast(error.message || 'Erro ao sincronizar.', 'error');
          btn.disabled = false;
        }
      });
    });

    content.querySelectorAll('[data-disconnect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal('Confirma desconectar este banco? A sincronização automática vai parar até reconectar.');
        if (!confirmed) return;
        try {
          const res = await api(`/api/open-finance/connections/${btn.dataset.disconnect}/disconnect`, { method: 'POST' });
          showToast(res.avisoProvider ? `Desconectado localmente. Aviso do provider: ${res.avisoProvider}` : 'Banco desconectado.', res.avisoProvider ? 'warning' : 'success');
          loadConnections();
        } catch (error) {
          showToast(error.message || 'Erro ao desconectar.', 'error');
        }
      });
    });

    content.querySelectorAll('[data-audit]').forEach((btn) => {
      btn.addEventListener('click', () => openAuditModal(btn.dataset.audit));
    });
  }

  function closeBancosModal() {
    document.getElementById('bancosModal')?.remove();
  }

  function openConectarModal() {
    closeBancosModal();
    const overlay = document.createElement('div');
    overlay.id = 'bancosModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Conectar banco</h3>
        ${!status.configured ? `
          <p class="muted">${escapeHtml(status.message || 'Nenhum provedor configurado ainda.')}</p>
          <div class="modal-actions"><button type="button" class="btn-muted" id="bancosConectarCancel">Fechar</button></div>
        ` : `
          <form id="bancosConectarForm" class="form-grid">
            <label>Estabelecimento
              <select name="estabelecimentoId" required>
                <option value="">Selecione</option>
                ${estabelecimentos.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.nomeFantasia || e.razaoSocial)}</option>`).join('')}
              </select>
            </label>
            <div class="modal-actions">
              <button type="button" class="btn-muted" id="bancosConectarCancel">Cancelar</button>
              <button type="submit" class="btn">Conectar</button>
            </div>
          </form>
        `}
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeBancosModal(); });
    document.getElementById('bancosConectarCancel')?.addEventListener('click', closeBancosModal);
    document.getElementById('bancosConectarForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      const formData = new FormData(event.target);
      try {
        await api('/api/open-finance/connections', {
          method: 'POST',
          body: JSON.stringify({ estabelecimentoId: formData.get('estabelecimentoId') })
        });
        showToast('Banco conectado com sucesso.', 'success');
        closeBancosModal();
        loadConnections();
      } catch (error) {
        showToast(error.message || 'Erro ao conectar banco.', 'error');
        submitBtn.disabled = false;
      }
    });
  }

  async function openAuditModal(connectionId) {
    let logs = [];
    try {
      const res = await api(`/api/open-finance/connections/${connectionId}/audit`);
      logs = res.logs || [];
    } catch (error) {
      showToast(error.message || 'Erro ao buscar auditoria.', 'error');
      return;
    }
    closeBancosModal();
    const overlay = document.createElement('div');
    overlay.id = 'bancosModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <h3>Auditoria da conexão</h3>
        <div class="finance-due-list">
          ${logs.length ? logs.map((l) => `
            <div class="finance-due-item">
              <div>
                <strong>${escapeHtml(l.action)}</strong>
                <div class="muted">${openFinanceFormatDateTime(l.createdAt)}${l.byName ? ` · ${escapeHtml(l.byName)}` : ''}</div>
              </div>
            </div>
          `).join('') : '<p class="muted">Nenhum evento registrado ainda.</p>'}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-muted" id="bancosAuditClose">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeBancosModal(); });
    document.getElementById('bancosAuditClose')?.addEventListener('click', closeBancosModal);
  }

  await loadConnections();
};
