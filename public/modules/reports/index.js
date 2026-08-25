window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// DUAS FONTES, E CADA TELA BUSCA SÓ A SUA.
//
// Financeiro e Estoque continuam saindo do /api/reports/overview, que traz os
// três resumos de uma vez — trocar entre eles não dispara requisição nova.
//
// Vendas e Por Vendedor saem de /api/reports/vendas, que é outra coisa: recebe
// filtros, devolve linha a linha e — o que importa — aplica o ESCOPO do usuário
// autenticado. Buscar as duas coisas juntas obrigaria o overview a carregar
// todas as vendas do sistema em toda abertura de Relatórios, inclusive para
// quem só vai olhar o estoque.
window.MavisModuleRegistry.reports = async function renderReports(ctx) {
  const { api, content, state, escapeHtml } = ctx;
  const registry = window.MavisSubscreenRegistry.reports || {};
  const sub = registry[state.activeSub] ? state.activeSub : 'vendas';
  if (sub !== state.activeSub) state.activeSub = sub;

  const granularidade = state.reportsGranularidade || 'month';
  const ehVendas = sub === 'vendas' || sub === 'vendedores';

  const falhar = (erro) => {
    content.innerHTML = `<div class="panel"><h3>Relatórios</h3><p class="muted">${escapeHtml(erro.message || 'Não foi possível carregar os relatórios.')}</p></div>`;
  };

  if (ehVendas) {
    // Os filtros vêm do state e são montados pela própria tela — ver
    // relFiltros/relQueryDeFiltros em subs/relatorios.js.
    const filtros = state.reportsVendasFiltros || {};
    const query = new URLSearchParams();
    Object.entries(filtros).forEach(([chave, valor]) => {
      if (chave === 'visao') return;
      if (valor !== '' && valor !== null && valor !== undefined) query.set(chave, valor);
    });
    let relatorioVendas;
    try {
      relatorioVendas = await api(`/api/reports/vendas?${query.toString()}`);
    } catch (error) {
      return falhar(error);
    }
    await registry[sub]({ ...ctx, relatorioVendas, granularidade });
    return;
  }

  let dados;
  try {
    dados = await api(`/api/reports/overview?granularity=${encodeURIComponent(granularidade)}`);
  } catch (error) {
    return falhar(error);
  }
  await registry[sub]({ ...ctx, dados, granularidade });
};
