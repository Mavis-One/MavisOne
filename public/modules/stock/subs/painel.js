window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// Painel de Estoque. Responde às três perguntas do módulo: quanto vale o que
// está parado, o que está girando e o que está para faltar.
window.MavisSubscreenRegistry.stock.painel = window.MavisPainel.telaDeModulo({
  modulo: 'stock',
  titulo: 'Painel de Estoque',
  subtitulo: 'Valor parado, giro do período e o que está para faltar.',
  blocos: (dados) => {
    const P = window.MavisPainel;
    return [
      P.bloco('Entradas e saídas', P.graficoLinha(dados.tendencia || [], undefined, [
        { key: 'entradas', cssClass: 'finance-chart-line-receita' },
        { key: 'saidas', cssClass: 'finance-chart-line-despesa' }
      ], { formato: 'numero' }), {
        subtitulo: 'Unidades movimentadas. As duas linhas juntas mostram se o estoque está crescendo ou drenando.',
        largo: true
      }),

      // Rosca aqui é honesto: as fatias SOMAM o valor total do estoque. Por
      // isso "Sem depósito" aparece em vez de sumir — escondê-lo faria as
      // fatias não fecharem com o cartão.
      P.bloco('Valor por depósito', P.graficoRosca(dados.porDeposito || [], undefined, {
        vazio: 'Nenhum produto com saldo.'
      }), { subtitulo: 'Quanto do dinheiro parado está em cada galpão.' }),

      P.bloco('Maior valor parado', P.ranking(dados.maioresValores || [], undefined, {
        vazio: 'Nenhum produto com saldo.'
      }), { subtitulo: 'Produtos que concentram o capital imobilizado.' })
    ];
  }
});
