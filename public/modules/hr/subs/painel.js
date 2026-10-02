window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.hr = window.MavisSubscreenRegistry.hr || {};

// Painel de RH. Mede PESSOAS e movimentação de quadro — não desempenho
// individual, que este ERP não tem como medir e cujo palpite seria pior que a
// ausência.
window.MavisSubscreenRegistry.hr.painel = window.MavisPainel.telaDeModulo({
  modulo: 'hr',
  titulo: 'Painel de RH',
  blocos: (dados) => {
    const P = window.MavisPainel;
    return [
      P.bloco('Admissões e desligamentos', P.graficoLinha(dados.tendencia || [], undefined, [
        { key: 'admissoes', cssClass: 'finance-chart-line-receita' },
        { key: 'desligamentos', cssClass: 'finance-chart-line-despesa' }
      ], { formato: 'numero' }), { largo: true }),

      P.bloco('Pessoas por departamento', P.graficoBarras(dados.porDepartamento || [], undefined, {
        formato: 'numero', vazio: 'Nenhum colaborador ativo.'
      })),

      P.bloco('Afastamentos', P.graficoRosca(dados.porTipoAfastamento || [], undefined, {
        formato: 'numero', vazio: 'Nenhum afastamento iniciado no período.'
      }))
    ];
  }
});
