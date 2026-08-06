// Catálogo do "Mais Ações" da tela de Pedidos e Orçamentos.
//
// Regra que atravessa quase tudo: rascunho não tem ação. Aprovar, cancelar,
// duplicar ou imprimir um pedido que ainda não foi salvo não faz sentido — ele
// não tem código, não existe para o resto do sistema. Por isso a maioria exige
// `ctx.isEditing`.
window.MavisSalesRecordActions = (function () {
  const I = window.MavisActionsMenu.ICONS;
  const SALVE_ANTES = 'Salve o registro antes de usar esta ação.';
  const SEM_MODULO = 'Módulo ainda não existe no sistema.';
  const SEM_INTEGRACAO = 'Requer integração de envio ainda não configurada.';

  const ehPedido = (ctx) => ctx.recordType === 'order';
  const precisaSalvar = (ctx) => (ctx.isEditing ? true : SALVE_ANTES);

  const CATALOG = [
    {
      id: 'ordem_compra', label: 'Gerar Ordem de Compra', icon: I.cart,
      enabled: () => SEM_MODULO
    },
    {
      id: 'despesa_montagem', label: 'Despesa de Montagem', icon: I.tool,
      enabled: () => SEM_MODULO
    },
    {
      id: 'cancelar', label: 'Cancelar Pedido', icon: I.cancel, tone: 'danger',
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (ctx.status === 'cancelado' || ctx.status === 'reprovado') return 'Este registro já está cancelado.';
        if (ctx.status === 'faturado') return 'Pedido faturado não pode ser cancelado por aqui — cancele a NF-e primeiro.';
        return true;
      },
      run: (ctx) => ctx.mudarStatus(ehPedido(ctx) ? 'cancelado' : 'reprovado', 'Confirma o cancelamento deste registro?')
    },
    {
      id: 'faturamento_parcial', label: 'Faturamento Parcial', icon: I.money,
      enabled: () => 'Faturamento parcial ainda não implementado — hoje o pedido é faturado por inteiro.'
    },
    {
      id: 'aprovar', label: 'Aprovar Pedido', icon: I.check, tone: 'success',
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (ehPedido(ctx)) {
          if (ctx.status === 'faturado') return 'Este pedido já está faturado.';
          if (ctx.status === 'cancelado') return 'Pedido cancelado não pode ser faturado.';
          return true;
        }
        if (ctx.status === 'aprovado') return 'Este orçamento já está aprovado.';
        if (ctx.status === 'reprovado') return 'Orçamento reprovado não pode ser aprovado.';
        return true;
      },
      run: (ctx) => ehPedido(ctx)
        ? ctx.mudarStatus('faturado', 'Faturar este pedido? O estoque será baixado.')
        : ctx.mudarStatus('aprovado', 'Aprovar este orçamento?')
    },
    {
      id: 'imprimir', label: 'Imprimir Pedido', icon: I.printer,
      enabled: precisaSalvar,
      run: (ctx) => ctx.imprimir({ direta: false })
    },
    {
      id: 'impressao_direta', label: 'Impressão Direta', icon: I.printer,
      enabled: precisaSalvar,
      run: (ctx) => ctx.imprimir({ direta: true })
    },
    {
      id: 'email', label: 'Enviar por E-mail', icon: I.mail,
      enabled: () => SEM_INTEGRACAO
    },
    {
      id: 'whatsapp', label: 'Enviar por Whatsapp', icon: I.whatsapp, tone: 'success',
      enabled: () => SEM_INTEGRACAO
    },
    {
      id: 'baixar', label: 'Baixar', icon: I.download,
      enabled: precisaSalvar,
      run: (ctx) => ctx.baixar()
    },
    {
      id: 'duplicar', label: 'Duplicar Venda', icon: I.copy,
      enabled: precisaSalvar,
      run: (ctx) => ctx.duplicar()
    },
    {
      id: 'observacoes', label: 'Observações', icon: I.note,
      run: (ctx) => ctx.focarObservacoes()
    },
    {
      id: 'ordem_producao', label: 'Gerar Ordem de Produção', icon: I.clock,
      enabled: () => SEM_MODULO
    }
  ];

  return { CATALOG };
})();
