window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fleet = window.MavisSubscreenRegistry.fleet || {};

// Painel de Frota. Frota é centro de CUSTO: todos os cartões de dinheiro aqui
// marcam inverterCor no servidor, para gasto subindo não aparecer em verde.
window.MavisSubscreenRegistry.fleet.painel = window.MavisPainel.telaDeModulo({
  modulo: 'fleet',
  titulo: 'Painel de Frota',
  subtitulo: 'Onde o dinheiro da frota está indo, por veículo e por tipo de gasto.',
  blocos: (dados) => {
    const P = window.MavisPainel;
    return [
      P.bloco('Combustível e manutenção', P.graficoLinha(dados.tendencia || [], undefined, [
        { key: 'combustivel', cssClass: 'finance-chart-line-blue' },
        { key: 'manutencao', cssClass: 'finance-chart-line-despesa' }
      ]), {
        subtitulo: 'Separados de propósito: combustível é contínuo, manutenção vem em picos — somados, um esconderia o outro.',
        largo: true
      }),

      P.bloco('Custo por veículo', P.graficoBarras(dados.porVeiculo || [], undefined, {
        tom: 'alerta', vazio: 'Nenhum gasto lançado no período.'
      }), { subtitulo: 'Combustível e manutenção somados, por placa.' }),

      P.bloco('Preventiva x corretiva', P.graficoRosca(dados.porTipoManutencao || [], undefined, {
        vazio: 'Nenhuma manutenção no período.'
      }), { subtitulo: 'Corretiva dominando é sinal de que a preventiva está atrasada.' })
    ];
  }
});
