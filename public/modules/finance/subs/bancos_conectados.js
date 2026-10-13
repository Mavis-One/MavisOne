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

// Rótulos da auditoria em português (fase EI). O modal mostrava o código cru
// gravado pelo servidor ("SYNC_FAILED"); código desconhecido cai no próprio
// código, para nada sumir da lista.
const OPEN_FINANCE_AUDIT_ACTION_LABELS = {
  CONNECTION_CREATED: 'Conexão criada',
  SYNC_COMPLETED: 'Sincronização concluída',
  SYNC_FAILED: 'Falha na sincronização',
  CONNECTION_DISCONNECTED: 'Desconectada'
};

// O que aconteceu de fato em cada evento (fase EI). `details` sempre foi
// gravado — o erro da sincronização, o aviso do provider no Desconectar, as
// contagens da sincronização —, mas o modal nunca o mostrava; depois que o
// toast sumia, ninguém sabia por que a sincronização tinha falhado.
function openFinanceAuditDetail(log) {
  let d = log && log.details;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch (erro) { return d; }
  }
  if (!d || typeof d !== 'object') return '';
  if (d.error) return String(d.error);
  if (d.avisoProvider) return `Aviso do provider: ${d.avisoProvider}`;
  if (d.contasCriadas !== undefined || d.contasAtualizadas !== undefined || d.transacoesCriadas !== undefined) {
    return `${d.contasCriadas || 0} conta(s) nova(s), ${d.contasAtualizadas || 0} atualizada(s), ${d.transacoesCriadas || 0} transação(ões) nova(s)`;
  }
  return '';
}

// Por que o modal Conectar não tem o que oferecer (fase EI). Lista vazia tem
// duas causas, e cada uma pede uma ação diferente: se a LEITURA dos
// estabelecimentos falhou (na prática, o 403 de quem não tem Fiscal ›
// Visualizar), quem resolve é o administrador liberando a permissão; se a
// leitura deu certo e só não há estabelecimento ativo, o caminho é cadastrar
// ou ativar um. Culpar a permissão no segundo caso mandava um administrador —
// que tem todas — procurar um problema que não existe.
function openFinanceMensagemSemEstabelecimento(leituraFalhou) {
  return leituraFalhou
    ? 'Não foi possível ler os estabelecimentos (requer Fiscal › Visualizar).'
    : 'Nenhum estabelecimento ativo cadastrado. Cadastre ou ative um em Configurações › Empresa.';
}

window.MavisSubscreenRegistry.finance.bancos_conectados = async function renderBancosConectados(ctx) {
  const { content, api, showToast, escapeHtml, confirmModal } = ctx;

  let status = { configured: false, provider: null, connected: false, message: '' };
  // Duas listas (fase EI): a completa serve de reserva para o RÓTULO da
  // conexão — estabelecimento inativado continua tendo nome —, e só os ativos
  // entram no seletor do modal Conectar.
  let todosEstabelecimentos = [];
  let estabelecimentos = [];
  // Marca só a FALHA da leitura (fase EI), para o modal Conectar distinguir
  // "não posso ver" de "não há" — ver openFinanceMensagemSemEstabelecimento.
  let leituraEstabelecimentosFalhou = false;
  let connections = [];

  try {
    status = await api('/api/open-finance/status');
  } catch (error) {
    showToast('Não foi possível verificar o status do Open Finance.', 'warning');
  }

  try {
    const res = await api('/api/fiscal/estabelecimentos');
    todosEstabelecimentos = res.estabelecimentos || [];
    estabelecimentos = todosEstabelecimentos.filter((e) => e.ativo);
  } catch (error) {
    // Na prática, o 403 de quem não tem Fiscal > Visualizar (ou uma falha de
    // rede) — a tela segue funcionando, só sem o seletor. "Nenhum cadastrado"
    // NÃO cai aqui: a rota responde 200 com a lista vazia.
    leituraEstabelecimentosFalhou = true;
  }

  // O nome vem primeiro do próprio servidor (c.estabelecimentoNome, fase EI),
  // que não depende da permissão Fiscal. Nunca devolve o UUID cru: ele não diz
  // nada a quem lê a tabela.
  function estabelecimentoLabel(conexao) {
    if (conexao.estabelecimentoNome) return conexao.estabelecimentoNome;
    const found = todosEstabelecimentos.find((e) => e.id === conexao.estabelecimentoId);
    return found ? (found.nomeFantasia || found.razaoSocial) : '(estabelecimento indisponível)';
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
                  <td><span class="texto-cortado is-medio" title="${escapeHtml(estabelecimentoLabel(c))}">${escapeHtml(estabelecimentoLabel(c))}</span></td>
                  <td>${escapeHtml(c.provider || '-')}</td>
                  <td>
                    ${openFinanceConnectionStatusBadge(c.status)}
                    ${/* Mensagem do provider cortada com "…" e inteira no title
                         (fase EI): a célula é nowrap, e um erro de ~200
                         caracteres levava a tabela a 2.000 px, com Ações
                         fora da tela. */ ''}
                    ${c.errorMessage ? `<span class="texto-cortado is-medio muted" style="margin-top:4px" title="${escapeHtml(c.errorMessage)}">${escapeHtml(c.errorMessage)}</span>` : ''}
                  </td>
                  <td>${openFinanceFormatDateTime(c.lastSyncAt)}</td>
                  ${/* O flex fica numa div DENTRO da célula (fase EI): com a
                       classe no próprio <td>, ele deixava de ser table-cell —
                       botões à esquerda sob o cabeçalho à direita, e a borda
                       da linha no meio quando a linha era mais alta. */''}
                  <td>
                    <div class="finance-extrato-actions" style="justify-content:flex-end">
                      ${c.status !== 'disconnected' ? `
                        <button type="button" class="secondary" data-sync="${escapeHtml(c.id)}">Sincronizar agora</button>
                        <button type="button" class="secondary" data-disconnect="${escapeHtml(c.id)}">Desconectar</button>
                      ` : ''}
                      <button type="button" class="secondary" data-audit="${escapeHtml(c.id)}">Auditoria</button>
                    </div>
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
          // Recarrega também na falha (fase EI): o servidor já gravou status
          // 'error' e a mensagem do provider, e a linha seguia com o badge
          // verde antigo até alguém clicar em Atualizar. O render recria o
          // botão, então não há o que reabilitar.
          loadConnections();
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
        ` : !estabelecimentos.length ? `
          ${/* Sem estabelecimento ativo visível (fase EI): ou a leitura
               falhou (sem Fiscal > Visualizar), ou não há nenhum ativo — a
               mensagem diz qual dos dois. Antes aparecia um select
               obrigatório só com "Selecione", que não deixava enviar e não
               dizia por quê. */''}
          <p class="muted">${escapeHtml(openFinanceMensagemSemEstabelecimento(leituraEstabelecimentosFalhou))}</p>
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
          ${logs.length ? logs.map((l) => {
            const detalhe = openFinanceAuditDetail(l);
            // cursor:default — a classe vem da lista de vencimentos, onde o
            // item é clicável; aqui não é (fase EI).
            return `
            <div class="finance-due-item" style="cursor:default">
              <div style="min-width:0">
                <strong>${escapeHtml(OPEN_FINANCE_AUDIT_ACTION_LABELS[l.action] || l.action || '-')}</strong>
                <div class="muted">${openFinanceFormatDateTime(l.createdAt)}${l.byName ? ` · ${escapeHtml(l.byName)}` : ''}</div>
                ${detalhe ? `<div class="muted" style="margin-top:4px">${escapeHtml(detalhe)}</div>` : ''}
              </div>
            </div>
          `;
          }).join('') : '<p class="muted">Nenhum evento registrado ainda.</p>'}
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
