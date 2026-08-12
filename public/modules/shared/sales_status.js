// Catálogo de Status de Pedido/Orçamento — FONTE ÚNICA.
//
// Mora em public/ para o navegador carregar por <script>, mas o server.js
// também faz require() dele — mesma razão do sales_totals.js: se a tela
// entendesse "faturado" de um jeito e o servidor de outro, o usuário veria um
// status e o sistema baixaria estoque (ou geraria financeiro) por outro.
//
// DESENHO
// -------
// Antes existiam duas telas (Novo Pedido / Novo Orçamento) e dois conjuntos de
// status disjuntos, e o tipo do registro era escolhido pela tela em que você
// entrou. Agora a tela é uma só e é o STATUS que define o tipo: quem está em
// "Orçamento" é orçamento, todo o resto é pedido.
//
// Só DOIS status são escolhidos à mão — "Orçamento" e "Pedido". Os outros
// existem no catálogo, aparecem na lista e nos filtros, e são atribuídos pelo
// sistema (faturar, cancelar, aprovar) ou por conciliação. Ficam visíveis no
// select, desabilitados, para o usuário saber que existem e para onde o
// documento pode caminhar.
//
// CADA STATUS DECLARA SEUS DOIS EFEITOS, e é isso que o servidor obedece:
//   baixaEstoque   — reserva/desconta os itens do estoque
//   geraFinanceiro — cria as contas a receber (parcelasDoPedido)
//
// Os dois são independentes de propósito. "Pedido Aprovado Sem Faturamento" é
// exatamente o caso em que eles divergem: a mercadoria sai (estoque baixa), mas
// não há dinheiro a receber — é a nota de transferência entre depósitos/filiais,
// remessa, bonificação, comodato. Antes isso era impossível de representar:
// "faturado" era a única porta e ela acendia os dois efeitos juntos.
(function (raiz) {
  const CATALOGO = [
    // --- Os dois selecionáveis ------------------------------------------------
    {
      value: 'orcamento', label: 'Orçamento', tipo: 'quote', selecionavel: true,
      tom: 'info', baixaEstoque: false, geraFinanceiro: false
    },
    {
      value: 'pedido', label: 'Pedido', tipo: 'order', selecionavel: true,
      tom: 'warning', baixaEstoque: false, geraFinanceiro: false
    },

    // --- Pedido: atribuídos pelo sistema --------------------------------------
    {
      // Pedido fechado que ainda não foi para o faturamento. Separado de
      // "Pedido" porque "Pedido" é o rascunho aceito; este já passou pela
      // conferência e está na fila.
      value: 'pedido-nao-faturado', label: 'Pedido Não Faturado', tipo: 'order',
      tom: 'warning', baixaEstoque: false, geraFinanceiro: false
    },
    {
      // Separado/reservado para faturar, mas sem documento emitido ainda.
      value: 'pedido-pre-faturado', label: 'Pedido Pré-Faturado', tipo: 'order',
      tom: 'info', baixaEstoque: false, geraFinanceiro: false
    },
    {
      // O caminho normal: saiu mercadoria e nasceu conta a receber.
      value: 'pedido-faturado', label: 'Pedido Faturado', tipo: 'order',
      tom: 'success', baixaEstoque: true, geraFinanceiro: true
    },
    {
      // Sai mercadoria, NÃO nasce financeiro. Transferência entre depósitos,
      // remessa, bonificação, comodato, troca em garantia.
      value: 'pedido-aprovado-sem-faturamento', label: 'Pedido Aprovado Sem Faturamento', tipo: 'order',
      tom: 'success', baixaEstoque: true, geraFinanceiro: false
    },
    {
      value: 'pedido-cancelado', label: 'Pedido Cancelado', tipo: 'order',
      tom: 'danger', baixaEstoque: false, geraFinanceiro: false, cancelado: true
    },
    {
      // A mercadoria sai, mas o financeiro NÃO é gerado automaticamente.
      // Faturamento parcial por item ainda não existe (ver a ação "Faturamento
      // Parcial" em sales_record_actions.js), então gerar a parcela cheia aqui
      // cobraria do cliente o que ainda não foi faturado. Enquanto o rateio não
      // existir, a parcela do que saiu é lançada à mão no Financeiro.
      //
      // "Pedido Aprovado Parcialmente Sem Faturamento" ficou de fora de
      // propósito: é a combinação de dois casos que o sistema não trabalha
      // (parcial + sem faturamento) e nenhuma tela ou rotina a atribui.
      value: 'pedido-parcialmente-faturado', label: 'Pedido Parcialmente Faturado', tipo: 'order',
      tom: 'info', baixaEstoque: true, geraFinanceiro: false, parcial: true
    },

    // --- Orçamento: desfechos -------------------------------------------------
    // Não estavam na lista pedida, mas os orçamentos antigos já tinham
    // "aprovado"/"reprovado" gravados e a ação Aprovar precisa de um destino.
    // Sem eles esses registros ficariam com status órfão na tela.
    {
      value: 'orcamento-aprovado', label: 'Orçamento Aprovado', tipo: 'quote',
      tom: 'success', baixaEstoque: false, geraFinanceiro: false
    },
    {
      value: 'orcamento-reprovado', label: 'Orçamento Reprovado', tipo: 'quote',
      tom: 'danger', baixaEstoque: false, geraFinanceiro: false, cancelado: true
    }
  ];

  const PORVALOR = new Map(CATALOGO.map((item) => [item.value, item]));

  // Status gravados antes desta mudança. Registro antigo não é migrado no
  // banco: é traduzido na leitura e regravado no formato novo no próximo
  // salvamento. Assim nada precisa de migração SQL e nada fica ilegível.
  const LEGADOS = {
    'pendente': 'pedido',
    'faturado': 'pedido-faturado',
    'cancelado': 'pedido-cancelado',
    'em aberto': 'orcamento',
    'aprovado': 'orcamento-aprovado',
    'reprovado': 'orcamento-reprovado'
  };

  const PADRAO_POR_TIPO = { order: 'pedido', quote: 'orcamento' };

  function padraoDoTipo(tipo) {
    return PADRAO_POR_TIPO[tipo] || 'pedido';
  }

  /**
   * Devolve sempre um valor do catálogo.
   *
   * `tipoRegistro` ('order' | 'quote') é opcional e serve de rede: se o status
   * gravado pertence ao outro tipo (registro corrompido, importação de CSV com
   * status escrito à mão), cai no padrão do tipo em vez de deixar um pedido
   * respondendo às regras de orçamento.
   */
  function normalizar(status, tipoRegistro) {
    const bruto = String(status || '').trim().toLowerCase();
    const valor = PORVALOR.has(bruto) ? bruto : (LEGADOS[bruto] || '');
    if (!valor) return padraoDoTipo(tipoRegistro);
    if (tipoRegistro && PORVALOR.get(valor).tipo !== tipoRegistro) return padraoDoTipo(tipoRegistro);
    return valor;
  }

  function meta(status, tipoRegistro) {
    return PORVALOR.get(normalizar(status, tipoRegistro));
  }

  const tipoDoStatus = (status) => meta(status).tipo;
  const baixaEstoque = (status, tipoRegistro) => Boolean(meta(status, tipoRegistro).baixaEstoque);
  const geraFinanceiro = (status, tipoRegistro) => Boolean(meta(status, tipoRegistro).geraFinanceiro);
  const ehCancelado = (status, tipoRegistro) => Boolean(meta(status, tipoRegistro).cancelado);
  const rotulo = (status, tipoRegistro) => meta(status, tipoRegistro).label;

  /**
   * O status SEGURA estoque sem ter baixado?
   *
   * É a janela entre prometer e entregar: pedido fechado, mercadoria ainda no
   * depósito. Quem está aqui reserva (ver lib/reservas.js).
   *
   * Derivado dos três campos que já definem cada status, em vez de uma lista
   * própria: uma lista à parte faria um status novo nascer sem reserva e sem
   * ninguém notar, que é exatamente como as unidades acabavam prometidas duas
   * vezes.
   *   - orçamento não reserva: é proposta, não compromisso;
   *   - cancelado não reserva: deixou de ser promessa;
   *   - quem já baixou não reserva: virou movimento, o saldo já caiu.
   */
  const reservaEstoque = (status, tipoRegistro) => {
    const m = meta(status, tipoRegistro);
    return m.tipo === 'order' && !m.baixaEstoque && !m.cancelado;
  };

  /**
   * Opções do <select> da tela, na ordem do catálogo.
   *
   * Os não-selecionáveis vêm com `disabled: true` — continuam à vista, mas o
   * usuário não os escolhe à mão. O status ATUAL nunca vem desabilitado: um
   * pedido faturado precisa conseguir exibir (e reenviar) o próprio status.
   */
  function opcoesSelect(statusAtual) {
    const atual = normalizar(statusAtual);
    return CATALOGO.map((item) => ({
      value: item.value,
      label: item.label,
      disabled: !item.selecionavel && item.value !== atual,
      selected: item.value === atual
    }));
  }

  const api = {
    CATALOGO,
    LEGADOS,
    normalizar,
    meta,
    tipoDoStatus,
    baixaEstoque,
    reservaEstoque,
    geraFinanceiro,
    ehCancelado,
    rotulo,
    padraoDoTipo,
    opcoesSelect
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisSalesStatus = api;
})(typeof window !== 'undefined' ? window : null);
