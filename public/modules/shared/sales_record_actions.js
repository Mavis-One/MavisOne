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
  // Pedido de outro vendedor: o vendedor vê, mas não muda (ver lib/venda-do-vendedor.js).
  const DE_OUTRO_VENDEDOR = 'Este pedido/orçamento é de outro vendedor.';

  // O tipo vem do status (tela única) — mas o ctx ainda manda `recordType`
  // porque é o que a tela já tem em mãos; os dois concordam por construção.
  const ehPedido = (ctx) => S.tipoDoStatus(ctx.status) === 'order';
  const precisaSalvar = (ctx) => (ctx.isEditing ? true : SALVE_ANTES);
  // "Já saiu mercadoria" — vale tanto para faturado quanto para aprovado sem
  // faturamento. É o que separa um documento ainda editável de um consumado.
  const jaBaixouEstoque = (ctx) => S.baixaEstoque(ctx.status);
  // "TEM NOTA" É A NOTA VALER, NÃO O VÍNCULO EXISTIR (13/10/2026). O pedido
  // guarda o id da nota mesmo depois de cancelada — documento fiscal não se
  // apaga —, e ler só `nfeId` deixava o pedido sem como emitir a nota nova.
  // Mesma regra do servidor (notaQueSustentaOFaturamento): vale a AUTORIZADA e
  // a que está PROCESSANDO. Sem situação (nota manual), continua valendo.
  const NOTA_VALENDO = ['AUTORIZADO', 'PROCESSANDO'];
  const temNotaValendo = (ctx) => {
    if (!ctx.nfeId) return false;
    const situacao = String(ctx.nfeStatus || '').toUpperCase();
    return !situacao || NOTA_VALENDO.includes(situacao);
  };
  // O FLUXO É APROVAR E DEPOIS EMITIR (13/10/2026, pedido do usuário).
  //
  // Faturar exige documento fiscal (fase AV) e a nota autorizada fatura o
  // pedido sozinha (fase BE). Então "Aprovar Pedido" não fatura: leva o pedido
  // a "Pedido Pré-Faturado" — aprovado, esperando a nota, sem baixar estoque
  // nem gerar financeiro. Daí saem a NF-e e a NFC-e; a autorização fatura.
  // Antes, "Aprovar" pedia faturar e o servidor recusava por falta de nota, e
  // "Gerar NF-e" pedia o pedido já faturado: um pedido novo não tinha saída.
  const ehPreFaturado = (ctx) => S.normalizar(ctx.status) === 'pedido-pre-faturado';
  // Aprovado para emitir: pré-faturado, ou já com estoque baixado (faturado
  // com dispensa, aprovado sem faturamento — a nota de transferência).
  const aprovadoParaEmitir = (ctx) => ehPreFaturado(ctx) || jaBaixouEstoque(ctx);
  const APROVE_ANTES = 'Aprove o pedido antes de emitir a nota.';

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
        if (ctx.somenteLeitura) return DE_OUTRO_VENDEDOR;
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
        if (ctx.somenteLeitura) return DE_OUTRO_VENDEDOR;
        if (ehPedido(ctx)) {
          if (S.geraFinanceiro(ctx.status)) return 'Este pedido já está faturado.';
          if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não pode ser faturado.';
          if (ehPreFaturado(ctx)) return 'Este pedido já está aprovado — gere a NF-e ou a NFC-e.';
          return true;
        }
        if (ctx.status === 'orcamento-aprovado') return 'Este orçamento já está aprovado.';
        if (S.ehCancelado(ctx.status)) return 'Orçamento reprovado não pode ser aprovado.';
        return true;
      },
      run: (ctx) => {
        if (!ehPedido(ctx)) return ctx.mudarStatus('orcamento-aprovado', 'Aprovar este orçamento?');
        // Com nota já valendo, falta só o faturamento (a autorização não o
        // aplicou): aí sim fatura direto.
        if (temNotaValendo(ctx)) {
          return ctx.mudarStatus('pedido-faturado', 'Faturar este pedido? O estoque será baixado e as contas a receber serão geradas.');
        }
        // Desde 16/10/2026 as contas a receber nascem aqui, na aprovação.
        return ctx.mudarStatus('pedido-pre-faturado',
          'Aprovar este pedido? As contas a receber são geradas agora e a Edição de Título abre em seguida. Depois gere a NF-e ou a NFC-e (a autorização da nota baixa o estoque).');
      }
    },
    {
      // A saída de mercadoria que NÃO é venda: transferência entre depósitos,
      // remessa, bonificação, comodato, troca em garantia. Baixa o estoque e
      // não cria nada a receber — antes só existia "faturar", que acendia os
      // dois efeitos juntos e obrigava a cancelar o financeiro na mão depois.
      id: 'aprovar_sem_faturamento', label: 'Aprovar Sem Faturamento', icon: I.check,
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (ctx.somenteLeitura) return DE_OUTRO_VENDEDOR;
        if (!ehPedido(ctx)) return 'Só pedido baixa estoque — aprove o orçamento primeiro.';
        if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não baixa estoque.';
        if (jaBaixouEstoque(ctx)) return 'O estoque deste pedido já foi baixado.';
        if (ehPreFaturado(ctx)) return 'Este pedido já foi aprovado para sair com nota.';
        return true;
      },
      run: (ctx) => ctx.mudarStatus(
        'pedido-aprovado-sem-faturamento',
        'Aprovar sem faturamento? O estoque será baixado e NENHUMA conta a receber será gerada.'
      )
    },
    {
      // Depois de aprovar (a autorização fatura), do faturado com dispensa e
      // do aprovado sem faturamento (a nota de transferência/remessa). O
      // servidor confere o estoque antes de transmitir.
      id: 'gerar_nfe', label: 'Gerar NF-e', icon: I.note, tone: 'success',
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (ctx.somenteLeitura) return DE_OUTRO_VENDEDOR;
        if (!ehPedido(ctx)) return 'Só pedido gera NF-e — aprove o orçamento primeiro.';
        if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não emite NF-e.';
        if (!aprovadoParaEmitir(ctx)) return APROVE_ANTES;
        if (temNotaValendo(ctx)) return 'Este pedido já tem NF-e emitida.';
        return true;
      },
      run: (ctx) => ctx.gerarNfe()
    },
    {
      // NFC-e: a nota do balcão. Como a NF-e, sai do pedido APROVADO e é a
      // autorização que fatura (baixa o estoque e cria a conta a receber). O
      // servidor monta a nota do próprio pedido e recusa o que não é venda a
      // consumidor — com o motivo.
      id: 'emitir_nfce', label: 'Emitir NFC-e', icon: I.barcode, tone: 'success',
      enabled: (ctx) => {
        if (!ctx.isEditing) return SALVE_ANTES;
        if (ctx.somenteLeitura) return DE_OUTRO_VENDEDOR;
        if (!ehPedido(ctx)) return 'Só pedido emite NFC-e — aprove o orçamento primeiro.';
        if (S.ehCancelado(ctx.status)) return 'Pedido cancelado não emite NFC-e.';
        if (!aprovadoParaEmitir(ctx)) return APROVE_ANTES;
        if (temNotaValendo(ctx)) return 'Este pedido já tem nota fiscal emitida.';
        return true;
      },
      run: (ctx) => ctx.emitirNfce()
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
      // Cupom para impressora térmica (12/10/2026): o pedido numa bobina de
      // 80 ou 58 mm. Ver shared/cupom_pedido.js.
      id: 'cupom_80', label: 'Imprimir Cupom 80mm', icon: I.printer,
      enabled: precisaSalvar,
      run: (ctx) => ctx.imprimirCupom({ largura: 80 })
    },
    {
      id: 'cupom_58', label: 'Imprimir Cupom 58mm', icon: I.printer,
      enabled: precisaSalvar,
      run: (ctx) => ctx.imprimirCupom({ largura: 58 })
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

  // O VENDEDOR SÓ CRIA (16/10/2026, pedido do usuário: "que eles não consigam
  // aprovar nem faturar ou até mesmo excluir, somente criar pedidos/
  // orçamentos"). Ficam à vista e desligadas, com o motivo — quem decide de
  // verdade é o servidor (lib/venda-do-vendedor.js, soCria).
  const SO_QUEM_NAO_E_VENDEDOR = ['cancelar', 'faturamento_parcial', 'aprovar', 'aprovar_sem_faturamento', 'gerar_nfe', 'emitir_nfce'];
  const VENDEDOR_SO_CRIA = 'Vendedor só cria e edita orçamentos e pedidos em aberto: aprovar, faturar, cancelar e emitir nota ficam com o administrador ou com quem não é vendedor.';
  CATALOG.forEach((acao) => {
    if (!SO_QUEM_NAO_E_VENDEDOR.includes(acao.id)) return;
    const original = acao.enabled;
    acao.enabled = (ctx) => (ctx && ctx.soCria
      ? VENDEDOR_SO_CRIA
      : (typeof original === 'function' ? original(ctx) : true));
  });

  return { CATALOG, SO_QUEM_NAO_E_VENDEDOR, VENDEDOR_SO_CRIA };
})();
