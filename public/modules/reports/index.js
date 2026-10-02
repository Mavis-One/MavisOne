window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// RELATÓRIOS POR GRUPO, como no Viper: cada item do menu é um grupo
// (Financeiro, Vendas, Estoque...), que abre a lista dos seus relatórios.
//
// O catálogo vem de /api/reports/catalogo, já recortado pelo que esta pessoa
// pode ver, e fica guardado no state: trocar de grupo não busca de novo.
//
// QUATRO TELAS JÁ EXISTIAM e continuam sendo as mesmas (subs/relatorios.js):
// Pedidos e Vendas por Vendedor saem de /api/reports/vendas, que recebe
// filtros e aplica o ESCOPO do usuário; Síntese Financeira e Valor em Estoque
// saem de /api/reports/overview. No catálogo elas são as entradas `especial`.
window.MavisModuleRegistry.reports = async function renderReports(ctx) {
  const { api, content, state, escapeHtml } = ctx;
  // O Personalizado não é um grupo do catálogo: o relatório dele é dado salvo,
  // e a tela é outra (subs/personalizado.js).
  if (state.activeSub === 'personalizado' && window.MavisRelatoriosPersonalizados) {
    return window.MavisRelatoriosPersonalizados.desenhar(ctx);
  }
  const especiais = window.MavisRelatoriosEspeciais || {};
  const telas = window.MavisRelatoriosCatalogo;

  const falhar = (erro) => {
    content.innerHTML = `<div class="panel"><h3>Relatórios</h3><p class="muted">${escapeHtml(erro.message || 'Não foi possível carregar os relatórios.')}</p></div>`;
  };

  let catalogo = state.relatoriosCatalogo;
  if (!catalogo) {
    try {
      catalogo = await api('/api/reports/catalogo');
      state.relatoriosCatalogo = catalogo;
    } catch (error) {
      return falhar(error);
    }
  }
  const grupos = catalogo.grupos || [];
  const grupo = grupos.find((g) => g.key === state.activeSub) || grupos[0];
  if (!grupo) {
    content.innerHTML = '<div class="panel"><h3>Relatórios</h3><p class="muted">Nenhum relatório disponível para o seu usuário.</p></div>';
    return;
  }
  if (grupo.key !== state.activeSub) state.activeSub = grupo.key;

  state.relatorioAberto = state.relatorioAberto || {};
  const aberto = grupo.relatorios.find((r) => r.key === state.relatorioAberto[grupo.key]);
  if (!aberto) return telas.lista(ctx, grupo);
  if (!aberto.especial) return telas.relatorio(ctx, grupo, aberto, catalogo.opcoes);

  const desenhar = especiais[aberto.especial];
  if (!desenhar) return telas.lista(ctx, grupo);
  const granularidade = state.reportsGranularidade || 'month';

  if (aberto.especial === 'vendas' || aberto.especial === 'vendedores') {
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
    await desenhar({ ...ctx, relatorioVendas, granularidade });
    telas.comVolta(ctx, grupo);
    return;
  }

  let dados;
  try {
    dados = await api(`/api/reports/overview?granularity=${encodeURIComponent(granularidade)}`);
  } catch (error) {
    return falhar(error);
  }
  await desenhar({ ...ctx, dados, granularidade });
  telas.comVolta(ctx, grupo);
};
