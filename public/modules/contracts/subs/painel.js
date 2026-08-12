window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.contracts = window.MavisSubscreenRegistry.contracts || {};

// Painel de Contratos. Único painel cujo gráfico olha para FRENTE: contrato não
// é evento passado, é compromisso que vence — e o que interessa é o que vence
// nos próximos meses, não o que foi assinado nos últimos.
window.MavisSubscreenRegistry.contracts.painel = window.MavisPainel.telaDeModulo({
  modulo: 'contracts',
  titulo: 'Painel de Contratos',
  subtitulo: 'Receita recorrente, o que vence à frente e quem pesa mais.',
  blocos: (dados) => {
    const P = window.MavisPainel;
    return [
      P.bloco('Vencimentos nos próximos 12 meses', P.graficoLinha(dados.tendencia || [], undefined, [
        { key: 'vencendo', cssClass: 'finance-chart-line-despesa' }
      ], { formato: 'numero' }), {
        subtitulo: 'Contratos ativos por mês de término. Um pico aqui é trabalho de renovação com data marcada.',
        largo: true
      }),

      // Valor MENSAL, não o do contrato: um anual de R$ 120 mil e um mensal de
      // R$ 120 mil somariam igual, e a fatia do anual ficaria doze vezes maior
      // do que ele representa por mês.
      P.bloco('Recorrência por tipo', P.graficoRosca(dados.porTipo || [], undefined, {
        vazio: 'Nenhum contrato ativo com valor recorrente.'
      }), { subtitulo: 'Valor mensal equivalente, por tipo de contrato.' }),

      P.bloco('Maiores contratos', P.ranking(dados.maiores || [], undefined, {
        vazio: 'Nenhum contrato ativo com valor.'
      }), { subtitulo: 'Por valor mensal equivalente.' })
    ];
  }
});
