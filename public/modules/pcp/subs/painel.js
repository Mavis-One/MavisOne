window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.pcp = window.MavisSubscreenRegistry.pcp || {};

// Painel de PCP. O número que manda aqui é o de OPs em ATRASO: produção adiantada
// não compensa entrega perdida.
window.MavisSubscreenRegistry.pcp.painel = window.MavisPainel.telaDeModulo({
  modulo: 'pcp',
  titulo: 'Painel de Produção',
  blocos: (dados) => {
    const P = window.MavisPainel;
    return [
      P.bloco('Produção apontada', P.graficoLinha(dados.tendencia || [], undefined, [
        { key: 'produzido', cssClass: 'finance-chart-line-blue' }
      ], { formato: 'numero' }), { largo: true }),

      // O que FALTA produzir, não o total da OP: setor com 10 OPs quase prontas
      // pesa menos que um com 2 OPs intocadas, e o total esconderia isso.
      P.bloco('Fila por setor', P.graficoBarras(dados.porSetor || [], undefined, {
        formato: 'numero', vazio: 'Nenhuma OP em andamento.'
      })),

      P.bloco('Ordens por etapa', P.graficoRosca(dados.porEtapa || [], undefined, {
        formato: 'numero', vazio: 'Nenhuma ordem de produção cadastrada.'
      }))
    ];
  }
});
