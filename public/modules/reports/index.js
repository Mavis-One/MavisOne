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
    const consulta = query.toString();

    // TROCAR DE VISÃO (Tabela / Por vendedor) NÃO VAI AO SERVIDOR. `visao` nem
    // entra na consulta: o servidor recalculava exatamente a mesma resposta
    // (~600 ms) para a tela mudar de layout. A troca marca
    // `reportsVendasSoRedesenhar`, e aqui a resposta que JÁ ESTÁ NA TELA é
    // redesenhada — só ela, e só se a consulta for a mesma. Qualquer outro
    // caminho (Aplicar, Atualizar, página, ordem, voltar de outra tela) vai ao
    // servidor como sempre: nada aqui serve dado que a pessoa não estava vendo.
    //
    // E SÓ SE A FOTO FOR RECENTE (FOTO_DA_TELA_VALE_MS). A resposta na tela tem
    // a idade de quando foi pedida: quem abriu a Tabela às 9h e clica em "Por
    // vendedor" às 11h veria o ranking das 9h, sem os pedidos faturados no
    // meio — e antes desta mudança o clique trazia o dado do momento. Passado
    // o prazo, a troca vai ao servidor como antes (e, com o opcoesHash abaixo,
    // a ida já é barata). Dentro do prazo, é o mesmo dado de segundos atrás.
    // Fica aqui dentro, e não no topo do arquivo: este é um script clássico, e
    // um `const` de topo entraria no escopo global compartilhado com os outros.
    const FOTO_DA_TELA_VALE_MS = 60 * 1000;
    const soRedesenhar = state.reportsVendasSoRedesenhar;
    state.reportsVendasSoRedesenhar = false;
    const naTela = state.reportsVendasNaTela;
    if (soRedesenhar && naTela && naTela.consulta === consulta
      && Date.now() - naTela.pedidaEm < FOTO_DA_TELA_VALE_MS) {
      await desenhar({ ...ctx, relatorioVendas: naTela.relatorioVendas, granularidade });
      telas.comVolta(ctx, grupo);
      return;
    }

    // AS LISTAS DOS FILTROS SÓ VÊM QUANDO MUDAM. A tela manda o `opcoesHash`
    // das listas que guardou; se o servidor calcular as mesmas, a resposta vem
    // sem `opcoes` (421 de 590 KB) e a tela usa as guardadas. Ver a rota
    // /api/reports/vendas em server.js.
    const guardadas = state.reportsVendasOpcoes;
    const comHash = new URLSearchParams(consulta);
    if (guardadas && guardadas.hash) comHash.set('opcoesHash', guardadas.hash);
    let relatorioVendas;
    try {
      relatorioVendas = await api(`/api/reports/vendas?${comHash.toString()}`);
      if (!relatorioVendas.opcoes) {
        if (guardadas && guardadas.hash === relatorioVendas.opcoesHash) {
          relatorioVendas = { ...relatorioVendas, opcoes: guardadas.opcoes };
        } else {
          // Não deveria acontecer (o servidor só omite quando o hash bate),
          // mas, se acontecer, a resposta vem inteira de novo em vez de a
          // tela desenhar filtros sem lista.
          relatorioVendas = await api(`/api/reports/vendas?${consulta}`);
        }
      }
    } catch (error) {
      return falhar(error);
    }
    state.reportsVendasOpcoes = { hash: relatorioVendas.opcoesHash, opcoes: relatorioVendas.opcoes };
    state.reportsVendasNaTela = { consulta, relatorioVendas, pedidaEm: Date.now() };
    await desenhar({ ...ctx, relatorioVendas, granularidade });
    telas.comVolta(ctx, grupo);
    return;
  }

  // `parte` pede só o bloco desta tela: a Síntese não lê produto e o Valor em
  // Estoque não lê lançamento (ver /api/reports/overview em server.js).
  let dados;
  try {
    dados = await api(`/api/reports/overview?granularity=${encodeURIComponent(granularidade)}&parte=${encodeURIComponent(aberto.especial)}`);
  } catch (error) {
    return falhar(error);
  }
  await desenhar({ ...ctx, dados, granularidade });
  telas.comVolta(ctx, grupo);
};
