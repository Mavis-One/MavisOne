window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Painel Fiscal. A pergunta que ele responde não é "quanto faturei" — isso é do
// painel de Vendas — e sim "as notas estão saindo, e o que ficou pelo caminho".
window.MavisSubscreenRegistry.fiscal.painel = window.MavisPainel.telaDeModulo({
  modulo: 'fiscal',
  titulo: 'Painel Fiscal',
  blocos: (dados) => {
    const P = window.MavisPainel;
    return [
      P.bloco('Autorizações e erros', P.graficoLinha(dados.tendencia || [], undefined, [
        { key: 'autorizadas', cssClass: 'finance-chart-line-receita' },
        { key: 'erros', cssClass: 'finance-chart-line-despesa' }
      ], { formato: 'numero' }), { largo: true }),

      P.bloco('Situação das notas', P.graficoRosca(dados.porStatus || [], undefined, {
        formato: 'numero', vazio: 'Nenhuma nota no período.'
      })),

      P.bloco('Por operação fiscal', P.graficoBarras(dados.porOperacao || [], undefined, {
        vazio: 'Nenhuma nota autorizada no período.'
      }))
    ];
  }
});
