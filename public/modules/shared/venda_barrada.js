// O QUE NÃO APROVA NEM FATURA UM PEDIDO (09/11/2026, pedido do usuário:
// "estou conseguindo faturar com o produto 588 (NÃO PODE!) e outra coisa, não
// deixe o pedido ser aprovado e muito menos faturado em OUTROS como forma de
// pagamento!").
//
// DUAS REGRAS:
//
//   1. O PRODUTO 588, "MÃO-DE-OBRA (SOMENTE PARA SERVIÇO)", não fatura: não
//      aprova para faturar (Pré-Faturado), não fatura (nem com dispensa de
//      nota), não fatura em parte e não entra em NF-e/NFC-e. Mão de obra não é
//      mercadoria: na nota de produto ela sairia com o NCM de moto (87112090,
//      o do cadastro). O "Aprovado Sem Faturamento" continua possível: não
//      fatura nada. Vem do Viper, onde 1.274 pedidos faturaram com ele.
//      O código do produto não muda (fase EJ), por isso a regra é pelo código.
//
//   2. A FORMA DE PAGAMENTO "OUTROS" não aprova pedido nenhum (Pré-Faturado,
//      Faturado, Aprovado Sem Faturamento, Parcialmente Faturado) e não vai à
//      NF-e/NFC-e de venda. Pela forma do cadastro com esse NOME, e não pelo
//      tipo: "Crédito Loja", "Crédito Virtual" e "Crédito em Conta" também são
//      do tipo "outro" e continuam valendo. Só onde o pagamento conta: a
//      categoria que não exige pagamento (transferência, remessa) não é
//      barrada por uma linha que ela nem precisava ter.
//
// FONTE ÚNICA: o servidor recusa na aprovação (aplicarEfeitosDeStatus, que é
// por onde passam a edição e as ações em lote), na criação de pedido que já
// nasce aprovado e na preparação da NF-e/NFC-e. Quem confere a nota é a
// emissão, ANTES da SEFAZ: a autorização fatura o pedido sozinha, e recusar
// depois dela deixaria nota válida e pedido sem faturar.
(function (raiz) {
  const PRODUTOS_QUE_NAO_FATURAM = [
    { sku: '588', nome: 'MÃO-DE-OBRA (SOMENTE PARA SERVIÇO)' }
  ];

  // Os status que faturam (ou preparam o faturamento): é neles que o 588 para.
  const STATUS_QUE_FATURAM = ['pedido-pre-faturado', 'pedido-faturado', 'pedido-parcialmente-faturado'];
  // Os status de pedido aprovado: é neles que a forma "Outros" para.
  const STATUS_APROVADOS = ['pedido-pre-faturado', 'pedido-faturado', 'pedido-aprovado-sem-faturamento', 'pedido-parcialmente-faturado'];

  const NOME_DA_FORMA_BARRADA = 'OUTROS';

  const semAcento = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const chave = (v) => semAcento(v).trim().replace(/\s+/g, ' ').toUpperCase();
  const skuLimpo = (v) => String(v == null ? '' : v).trim();

  /** O produto do código, se ele não fatura; senão null. */
  function produtoQueNaoFatura(sku) {
    const alvo = skuLimpo(sku);
    return (alvo && PRODUTOS_QUE_NAO_FATURAM.find((p) => p.sku === alvo)) || null;
  }

  /**
   * O primeiro item que não fatura: { indice, sku, nome } ou null.
   * `skuDoItem(item)` dá o código do produto da linha (o do cadastro, pelo id);
   * sem ele, vale o `sku` gravado no item.
   */
  function itemQueNaoFatura(itens, skuDoItem) {
    const lista = Array.isArray(itens) ? itens : [];
    for (let indice = 0; indice < lista.length; indice += 1) {
      const item = lista[indice];
      if (!item) continue;
      const sku = typeof skuDoItem === 'function' ? (skuDoItem(item) || item.sku) : item.sku;
      const produto = produtoQueNaoFatura(sku);
      if (produto) return { indice, sku: produto.sku, nome: String(item.name || produto.nome).trim() || produto.nome };
    }
    return null;
  }

  /** A forma de pagamento é a "Outros"? Pelo nome, sem caixa e sem acento. */
  function ehFormaBarrada(nome) {
    return chave(nome) === NOME_DA_FORMA_BARRADA;
  }

  /**
   * A primeira linha de pagamento com valor na forma "Outros": o índice, ou -1.
   * A forma vem do cadastro pelo `methodId` (o nome de lá vale: renomear a
   * forma no cadastro muda a regra junto); sem cadastro, o `methodName` da linha.
   */
  function pagamentoEmFormaBarrada(pagamentos, formas) {
    const porId = new Map((Array.isArray(formas) ? formas : []).filter(Boolean).map((f) => [String(f.id), f]));
    return (Array.isArray(pagamentos) ? pagamentos : []).findIndex((linha) => {
      if (!linha) return false;
      const valor = Number(linha.amount != null ? linha.amount : linha.valor);
      if (!(valor > 0)) return false;
      const forma = linha.methodId ? porId.get(String(linha.methodId)) : null;
      return ehFormaBarrada(forma ? forma.name : linha.methodName);
    });
  }

  const mensagemDoItem = (item) => `O produto ${item.sku} (${item.nome}) não pode ser faturado (item ${item.indice + 1}). `
    + 'Mão de obra não sai em nota de produto: tire o item do pedido para aprovar e faturar.';
  const mensagemDoPagamento = (linha) => 'A forma de pagamento "Outros" não aprova nem fatura pedido '
    + `(aba Pagamentos, linha ${linha + 1}). Troque pela forma em que o cliente pagou.`;

  /**
   * Por que o pedido não pode ir para `statusNovo`: { regra, mensagem, aba, ... }
   * ou null. `exigePagamento`: a categoria do pedido exige pagamento (sem a
   * informação, exige). `formas`: o cadastro de formas de pagamento.
   */
  function impedimento(registro, { statusNovo, formas, skuDoItem, exigePagamento = true } = {}) {
    const r = registro || {};
    if (STATUS_QUE_FATURAM.includes(statusNovo)) {
      const item = itemQueNaoFatura(r.items, skuDoItem);
      if (item) return { regra: 'produto', mensagem: mensagemDoItem(item), aba: 'dados', item: item.indice };
    }
    if (STATUS_APROVADOS.includes(statusNovo) && exigePagamento !== false) {
      const linha = pagamentoEmFormaBarrada(r.payments, formas);
      if (linha >= 0) return { regra: 'pagamento', mensagem: mensagemDoPagamento(linha), aba: 'pagamentos', linha };
    }
    return null;
  }

  /**
   * Por que a NF-e/NFC-e não pode sair: mensagem ou null. `itens`: os da nota,
   * com o código do produto em `sku`. `pagamentos`: os da nota (com methodId
   * quando vêm do pedido). `venda`: a operação é venda — a forma só conta nela.
   */
  const mensagemDoItemNaNota = (item) => `O produto ${item.sku} (${item.nome}) não pode sair em nota fiscal `
    + `(item ${item.indice + 1}): mão de obra não é mercadoria. Tire o item da nota.`;
  const mensagemDoPagamentoNaNota = (linha) => `A forma de pagamento "Outros" não fatura (pagamento ${linha + 1} da nota). `
    + 'Troque pela forma em que o cliente pagou, no pedido (aba Pagamentos).';

  function impedimentoDaNota({ itens, pagamentos, formas, venda = true } = {}) {
    const item = itemQueNaoFatura(itens);
    if (item) return mensagemDoItemNaNota(item);
    if (venda) {
      const linha = pagamentoEmFormaBarrada(pagamentos, formas);
      if (linha >= 0) return mensagemDoPagamentoNaNota(linha);
    }
    return null;
  }

  const api = {
    PRODUTOS_QUE_NAO_FATURAM, STATUS_QUE_FATURAM, STATUS_APROVADOS, NOME_DA_FORMA_BARRADA,
    produtoQueNaoFatura, itemQueNaoFatura, ehFormaBarrada, pagamentoEmFormaBarrada, impedimento, impedimentoDaNota,
    mensagemDoItemNaNota, mensagemDoPagamentoNaNota
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisVendaBarrada = api;
})(typeof window !== 'undefined' ? window : globalThis);
