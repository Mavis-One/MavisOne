// Cálculo dos totais de Pedido/Orçamento — FONTE ÚNICA.
//
// Este arquivo mora em public/ para o navegador carregar por <script>, mas o
// server.js também faz require() dele. É de propósito: se a tela calculasse de
// um jeito e o servidor de outro, o usuário veria um total e o sistema gravaria
// outro. Qualquer mudança de regra tem que valer nos dois lados.
(function (raiz) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const naoNegativo = (v) => Math.max(0, num(v));
  const cent = (v) => Math.round(v * 100) / 100;

  /**
   * Regras, na ordem em que se aplicam:
   *
   * 1. Base de desconto = Valor dos Produtos + Valor dos Serviços.
   *    Frete, despesas gerais e taxa de montagem NÃO entram na base — dar
   *    desconto sobre o frete que você mesmo vai pagar não faz sentido.
   *
   * 2. O percentual é limitado a 0–100. Sem isso, digitar 500 no campo de %
   *    zeraria a venda inteira.
   *
   * 3. Os dois descontos SOMAM: primeiro o %, depois o valor fixo. Um desconto
   *    de 10% + R$ 50 numa base de R$ 1.000 dá R$ 150 de desconto.
   *
   * 4. O desconto total nunca passa da base. Se passar, é aparado e o retorno
   *    marca `descontoAparado: true` — a tela avisa em vez de deixar o usuário
   *    achar que o desconto inteiro foi aplicado.
   *
   * 5. O frete só entra no total se "Cobrar Frete do Comprador" estiver ligado.
   *    Desligado, o frete é custo do vendedor: aparece no formulário, mas não é
   *    cobrado do cliente.
   *
   * 6. Despesas gerais e taxa de montagem sempre somam, e nunca são negativas.
   */
  function computeSalesTotals(input) {
    const entrada = input || {};
    const itens = Array.isArray(entrada.items) ? entrada.items : [];

    const valorProdutos = cent(itens.reduce((soma, item) => {
      // Aceita `total` já calculado (vem assim do servidor) ou qtd × preço.
      const total = item.total !== undefined ? num(item.total) : num(item.quantity) * num(item.unitPrice);
      return soma + total;
    }, 0));

    // Peso e serviços já leem os campos certos: no dia em que o produto ganhar
    // peso e existir item de serviço, isto passa a valer sozinho.
    const pesoTotal = cent(itens.reduce((soma, item) => soma + num(item.quantity) * num(item.weight), 0));
    const valorServicos = naoNegativo(entrada.servicesAmount);

    const base = cent(valorProdutos + valorServicos);

    const percentual = Math.min(100, naoNegativo(entrada.discountPercent));
    const descontoPercentual = cent(base * (percentual / 100));
    const descontoValor = naoNegativo(entrada.discountAmount);

    const descontoSolicitado = cent(descontoPercentual + descontoValor);
    const descontoTotal = cent(Math.min(descontoSolicitado, base));
    const descontoAparado = descontoSolicitado > base;

    const subtotal = cent(base - descontoTotal);

    const frete = naoNegativo(entrada.freight);
    const cobrarFreteDoComprador = entrada.chargeFreightToBuyer !== false;
    const freteCobrado = cobrarFreteDoComprador ? frete : 0;

    const despesasGerais = naoNegativo(entrada.generalExpenses);
    const taxaMontagem = naoNegativo(entrada.assemblyFee);

    const totalAmount = cent(subtotal + freteCobrado + despesasGerais + taxaMontagem);

    // Comissões incidem sobre o subtotal (após desconto, sem frete/despesas) —
    // é o que de fato entrou como venda.
    const comissaoVendedor = cent(subtotal * (naoNegativo(entrada.sellerCommissionPercent) / 100));
    const comissaoRepresentacao = cent(subtotal * (naoNegativo(entrada.agentCommissionPercent) / 100));

    return {
      valorProdutos,
      valorServicos,
      pesoTotal,
      base,
      descontoPercentual,
      descontoValor,
      descontoTotal,
      descontoAparado,
      percentualAplicado: percentual,
      subtotal,
      frete,
      freteCobrado,
      cobrarFreteDoComprador,
      despesasGerais,
      taxaMontagem,
      comissaoVendedor,
      comissaoRepresentacao,
      totalAmount,
      // Mantidos para não quebrar quem já lia estes nomes.
      itemsTotal: valorProdutos
    };
  }

  const api = { computeSalesTotals };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisSalesTotals = api;
})(typeof window !== 'undefined' ? window : null);
