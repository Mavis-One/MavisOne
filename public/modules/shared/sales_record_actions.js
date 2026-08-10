// Catálogo do "Mais Ações" da tela de Pedidos e Orçamentos.
//
// Regra que atravessa quase tudo: rascunho não tem ação. Aprovar, cancelar,
// duplicar ou imprimir um pedido que ainda não foi salvo não faz sentido — ele
// não tem código, não existe para o resto do sistema. Por isso a maioria exige
// `ctx.isEditing`.
window.MavisSalesRecordActions = (function () {
  const I = window.MavisActionsMenu.ICONS;
  const S = window.MavisSalesStatus;
  const SALVE_ANTES = 'Salve o registro antes de usar esta ação.';
  const SEM_MODULO = 'Módulo ainda não existe no sistema.';
  const SEM_INTEGRACAO = 'Requer integração de envio ainda não configurada.';

  // O tipo vem do status (tela única) — mas o ctx ainda manda `recordType`
  // porque é o que a tela já tem em mãos; os dois concordam por construção.
  const ehPedido = (ctx) => S.tipoDoStatus(ctx.status) === 'order';
  const precisaSalvar = (ctx) => (ctx.isEditing ? true : SALVE_ANTES);
  // "Já saiu mercadoria" — vale tanto para faturado quanto para aprovado sem
  // faturamento. É o que separa um documento ainda editável de um consumado.
  const jaBaixouEstoque = (ctx) => S.baixaEstoque(ctx.status);

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
        if (S.ehCancelado(ctx.status)) return 'Este registro já está cancelado.';
        if (S.geraFinanceiro(ctx.status)) return 'Pedido faturado não pode ser cancelado por aqui — cancele a NF-e primeiro.';
        return true;
      },
      run: (ctx) => ctx.mudarStatus(ehPedido(ctx) ? 'pedido-cancelado' : 'orcamento-reprovado', 'Confirma o cancelamento deste registro?')
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
          if (S.geraFinanceiro(ctx.status)) return 'Este pedido já está faturado.';
          if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não pode ser faturado.';
          return true;
        }
        if (ctx.status === 'orcamento-aprovado') return 'Este orçamento já está aprovado.';
        if (S.ehCancelado(ctx.status)) return 'Orçamento reprovado não pode ser aprovado.';
        return true;
      },
      run: (ctx) => ehPedido(ctx)
        ? ctx.mudarStatus('pedido-faturado', 'Faturar este pedido? O estoque será baixado e as contas a receber serão geradas.')
        : ctx.mudarStatus('orcamento-aprovado', 'Aprovar este orçamento?')
    },
    {
      // A saída de mercadoria que NÃO é venda: transferência entre depósitos,
      // remessa, bonificação, comodato, troca em garantia. Baixa o estoque e
      // não cria nada a receber — antes só existia "faturar", que acendia os
      // dois efeitos juntos e obrigava a cancelar o financeiro na mão depois.
      id: 'aprovar_sem_faturamento', label: 'Aprovar Sem Faturamento', icon: I.check,
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (!ehPedido(ctx)) return 'Só pedido baixa estoque — aprove o orçamento primeiro.';
        if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não baixa estoque.';
        if (jaBaixouEstoque(ctx)) return 'O estoque deste pedido já foi baixado.';
        return true;
      },
      run: (ctx) => ctx.mudarStatus(
        'pedido-aprovado-sem-faturamento',
        'Aprovar sem faturamento? O estoque será baixado e NENHUMA conta a receber será gerada.'
      )
    },
    {
      // Só aparece habilitada depois de faturar: NF-e é documento fiscal, e
      // emitir a de um pedido que ainda pode mudar é pedir para cancelar nota.
      id: 'gerar_nfe', label: 'Gerar NF-e', icon: I.note, tone: 'success',
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (!ehPedido(ctx)) return 'Só pedido gera NF-e — aprove o orçamento e fature o pedido primeiro.';
        if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não emite NF-e.';
        // Aprovado sem faturamento também emite: é justamente a nota de
        // transferência/remessa, que é NF-e sem financeiro por trás.
        if (!jaBaixouEstoque(ctx)) return 'Fature (ou aprove) o pedido antes de emitir a NF-e.';
        if (ctx.nfeId) return 'Este pedido já tem NF-e emitida.';
        return true;
      },
      run: (ctx) => ctx.gerarNfe()
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
      id: 'whatsapp', label: 'Enviar por WhatsApp', icon: I.whatsapp, tone: 'success',
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
      // Abre uma OP por item que TENHA ficha técnica. Produto revendido não se
      // fabrica, e o servidor o ignora em vez de encher o PCP de ordens que
      // ninguém vai produzir.
      id: 'ordem_producao', label: 'Gerar Ordem de Produção', icon: I.clock,
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (!ehPedido(ctx)) return 'Só pedido gera ordem de produção — aprove o orçamento primeiro.';
        if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não gera produção.';
        return true;
      },
      run: (ctx) => ctx.gerarOrdemProducao()
    }
  ];

  return { CATALOG };
})();
