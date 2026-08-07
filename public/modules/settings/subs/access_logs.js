window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// Auditoria de Acesso — quem fez o quê, e o que foi barrado.
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
          Rode <code>supabase/migrations/fase-l-controle-de-acesso.sql</code> no Supabase.
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
        <table class="table">
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
  `;

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
