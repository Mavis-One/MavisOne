window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// Todas as telas de Relatórios saem da MESMA resposta (/api/reports/overview):
// vendas, financeiro e estoque vêm juntos. Buscar aqui, uma vez, evita que
// trocar de relatório dispare uma requisição nova a cada clique.
window.MavisModuleRegistry.reports = async function renderReports(ctx) {
  const { api, content, state, escapeHtml } = ctx;
  const registry = window.MavisSubscreenRegistry.reports || {};
  const sub = registry[state.activeSub] ? state.activeSub : 'vendas';
  if (sub !== state.activeSub) state.activeSub = sub;

  const granularidade = state.reportsGranularidade || 'month';

  let dados;
  try {
    dados = await api(`/api/reports/overview?granularity=${encodeURIComponent(granularidade)}`);
  } catch (error) {
    content.innerHTML = `<div class="panel"><h3>Relatórios</h3><p class="muted">${escapeHtml(error.message || 'Não foi possível carregar os relatórios.')}</p></div>`;
    return;
  }

  await registry[sub]({ ...ctx, dados, granularidade });
};
