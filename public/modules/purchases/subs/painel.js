window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

// Painel de Compras. A conta vem de lib/painel-modulos.js (painelCompras); aqui
// só se escolhe quais blocos desenhar e em que ordem.
window.MavisSubscreenRegistry.purchases.painel = window.MavisPainel.telaDeModulo({
  modulo: 'purchases',
  titulo: 'Painel de Compras',
  subtitulo: 'Quanto entrou, de quem e a que preço.',
  blocos: (dados) => {
    const P = window.MavisPainel;
    return [
      P.bloco('Compras no período', P.graficoLinha(dados.tendencia || [], undefined, [
        { key: 'valor', cssClass: 'finance-chart-line-despesa' }
      ]), { subtitulo: 'Valor comprado por dia (ou por mês, em períodos longos).', largo: true }),

      // Barras e não rosca: fornecedores não somam um total que interesse — a
      // pergunta é "quem pesa mais", não "que fatia cada um é".
      P.bloco('Maiores fornecedores', P.graficoBarras(dados.porFornecedor || [], undefined, {
        vazio: 'Nenhuma compra registrada no período.'
      }), { subtitulo: 'Por valor comprado no período.' })
    ];
  }
});
