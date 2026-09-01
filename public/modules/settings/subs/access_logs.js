window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// Rótulos das ações da trilha /api/audit. Este mapa veio da tela "Empresa",
// junto com o painel que ele serve.
const ACCESS_AUDIT_ACTION_LABELS = {
  createUser: 'Criação de usuário',
  updateUser: 'Edição de usuário',
  deleteUser: 'Exclusão de usuário',
  criarLancamento: 'Criação de lançamento',
  editarLancamento: 'Edição de lançamento',
  baixarLancamento: 'Baixa de lançamento',
  estornarLancamento: 'Estorno de baixa',
  cancelarLancamento: 'Cancelamento de lançamento',
  emitirNfe: 'Emissão de NF-e',
  cancelarNfe: 'Cancelamento de NF-e',
  emitirNfeFiscal: 'Emissão de NF-e (Focus)',
  cancelarNfeFiscal: 'Cancelamento de NF-e (Focus)',
  emitirCartaCorrecaoFiscal: 'Carta de Correção (Focus)',
  inutilizarNumeracaoFiscal: 'Inutilização de numeração (Focus)',
  conciliarTransacao: 'Conciliação de extrato bancário'
};

// Auditoria de Acesso — quem fez o quê, e o que foi barrado.
//
// SÃO DUAS TRILHAS, E AGORA ELAS FICAM NA MESMA TELA
// --------------------------------------------------
// `/api/access-logs` (abaixo) registra ACESSO: toda tentativa negada e as
// ações de escrita, com IP. `/api/audit` registra o que foi FEITO — usuário
// criado, lançamento baixado, NF-e emitida.
//
// A segunda ficava dentro da tela "Empresa", onde ninguém procuraria por ela,
// enquanto a tela chamada "Auditoria" mostrava só a primeira. Quem investigava
// um incidente via metade da história e não tinha como saber que faltava a
// outra metade.
//
// O filtro de resultado começa em "Negado" de propósito: numa investigação, a
// primeira pergunta quase sempre é "quem tentou fazer o que não podia".
window.MavisSubscreenRegistry.settings.access_logs = async function renderAccessLogs(ctx) {
  const { content, api, state, escapeHtml } = ctx;

  const filtros = state.settingsDraft?.accessLogFilters || { result: '', action: '', limit: 100 };
  const parametros = new URLSearchParams({ limit: String(filtros.limit) });
  if (filtros.result) parametros.set('result', filtros.result);
  if (filtros.action) parametros.set('action', filtros.action);

  let resposta;
  try {
    resposta = await api(`/api/access-logs?${parametros.toString()}`);
  } catch (error) {
    content.innerHTML = `<div class="panel"><p class="muted">${escapeHtml(error.message || 'Erro ao ler a trilha de auditoria.')}</p></div>`;
    return;
  }

  const logs = resposta.logs || [];
  const dataHora = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '-' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}`;
  };

  content.innerHTML = `
    <div class="cadastro-page-head">
      <div>
        <h3>Auditoria de Acesso</h3>
        <p class="muted">${logs.length} registro${logs.length === 1 ? '' : 's'} — ações de escrita e toda tentativa negada.</p>
      </div>
    </div>

    ${resposta.disponivel === false ? `
      <div class="panel">
        <p class="sales-totals-alerta">
          A tabela de auditoria ainda não existe no banco — nada está sendo registrado.
          Rode <code>banco/migrations/fase-l-controle-de-acesso.sql</code> no Supabase.
        </p>
      </div>` : ''}

    <form id="logsFiltro" class="row" style="margin-bottom: 12px;">
      <label>Resultado
        <select name="result">
          <option value="" ${filtros.result === '' ? 'selected' : ''}>Todos</option>
          <option value="NEGADO" ${filtros.result === 'NEGADO' ? 'selected' : ''}>Negado</option>
          <option value="PERMITIDO" ${filtros.result === 'PERMITIDO' ? 'selected' : ''}>Permitido</option>
        </select>
      </label>
      <label>Ação<input name="action" value="${escapeHtml(filtros.action)}" placeholder="Ex.: sales.excluir" /></label>
      <label>Quantidade
        <select name="limit">
          ${[50, 100, 200, 500].map((n) => `<option value="${n}" ${Number(filtros.limit) === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <div style="align-self: end;"><button type="submit" class="secondary">Filtrar</button></div>
    </form>

    <div class="panel">
      <div class="table-scroll">
        <table class="table" id="tabelaAcessos">
          <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Recurso</th><th>Resultado</th><th>IP</th><th>Detalhe</th></tr></thead>
          <tbody>
            ${logs.length ? logs.map((log) => `
              <tr>
                <td>${dataHora(log.created_at)}</td>
                <td>${escapeHtml(log.user_name || '-')}</td>
                <td>${escapeHtml(log.action)}</td>
                <td>${escapeHtml(log.resource_type || '-')}${log.resource_id ? ` · ${escapeHtml(log.resource_id)}` : ''}</td>
                <td><span class="finance-badge finance-badge-${log.result === 'NEGADO' ? 'danger' : 'success'}">${escapeHtml(log.result)}</span></td>
                <td>${escapeHtml(log.ip || '-')}</td>
                <td class="muted">${escapeHtml(JSON.stringify(log.detail || {}))}</td>
              </tr>
            `).join('') : '<tr><td colspan="7" class="muted">Nenhum registro com os filtros atuais.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    ${state.user?.role === 'admin' ? `
    <div class="cadastro-page-head" style="margin-top: 24px;">
      <div>
        <h3>Ações registradas</h3>
        <p class="muted">O que foi feito no sistema — usuário criado, lançamento baixado, nota emitida.</p>
      </div>
      <div class="cadastro-list-actions">
        <button type="button" class="secondary" id="auditRefresh">Atualizar</button>
        <button type="button" class="secondary" id="auditPrev">Anterior</button>
        <button type="button" class="secondary" id="auditNext">Próximo</button>
      </div>
    </div>
    <div class="panel">
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>Ação</th><th>Alvo</th><th>Por</th><th>Data</th></tr></thead>
          <tbody id="auditBody"></tbody>
        </table>
      </div>
      <p id="auditEmpty" class="muted">Nenhum registro de auditoria.</p>
    </div>
    ` : ''}
  `;

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
            <td>${escapeHtml(ACCESS_AUDIT_ACTION_LABELS[log.action] || log.action)}</td>
            <td>${escapeHtml(log.targetUsername || log.targetId)}</td>
            <td>${escapeHtml(log.byName || log.byId)}</td>
            <td>${escapeHtml(new Date(log.at).toLocaleString())}</td>
          </tr>
        `).join('');
        auditEmpty.style.display = logs.length ? 'none' : 'block';
      } catch (err) {
        ctx.showToast('Erro ao carregar logs: ' + (err.message || err), 'error');
      }
    }
    document.getElementById('auditRefresh')?.addEventListener('click', () => { auditOffset = 0; loadAudit(); });
    document.getElementById('auditPrev')?.addEventListener('click', () => { auditOffset = Math.max(0, auditOffset - auditLimit); loadAudit(); });
    document.getElementById('auditNext')?.addEventListener('click', () => { auditOffset = auditOffset + auditLimit; loadAudit(); });
    setTimeout(loadAudit, 50);
  }

  document.getElementById('logsFiltro')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const dados = new FormData(event.target);
    state.settingsDraft = {
      ...state.settingsDraft,
      accessLogFilters: {
        result: dados.get('result') || '',
        action: dados.get('action') || '',
        limit: Number(dados.get('limit') || 100)
      }
    };
    ctx.loadModule('settings');
  });
};
