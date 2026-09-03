// Totais do documento de compra — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script> e o server.js faz
// require(). Mesma razão do sales_totals.js: se a tela somasse de um jeito e o
// servidor de outro, o usuário aprovaria uma ordem de R$ 1.000 e o sistema
// gravaria uma conta a pagar de R$ 1.050. O erro não aparece na hora — aparece
// quando o boleto chega.
//
// A CONTA
// -------
//   itemsTotal  = Σ (quantidade × custo unitário)
//   total       = itemsTotal + frete + outras despesas − desconto
//
// FRETE E DESPESAS SÃO DO DOCUMENTO, NÃO DO ITEM, e não são rateados aqui de
// propósito. O fornecedor cobra um frete pela carga; dividi-lo por item exigiria
// escolher um critério (peso? valor? quantidade?), e cada critério dá um custo
// unitário diferente. Essa escolha é de quem apura custo de reposição, não de
// quem lança a compra — e fazê-la calada aqui gravaria um custo que ninguém
// pediu como se fosse o preço do fornecedor.
(function (raiz) {
  const numero = (valor) => {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  };

  // Duas casas, e o arredondamento no fim de cada linha — não só no total.
  // Somar centavos não arredondados e arredondar uma vez no fim faz a soma das
  // linhas na tela não bater com o total, e o usuário confia no que ele soma.
  const dinheiro = (valor) => Math.round(numero(valor) * 100) / 100;

  function normalizarItem(bruto) {
    const quantity = numero(bruto.quantity);
    const unitCost = numero(bruto.unitCost);
    return {
      productId: String(bruto.productId || ''),
      name: String(bruto.name || '').trim(),
      sku: String(bruto.sku || ''),
      // A cor viaja no ITEM, como em Vendas: o mesmo produto entra duas vezes
      // na mesma compra em cores diferentes, e cada linha entra na sua.
      classId: String(bruto.classId || ''),
      classValueId: String(bruto.classValueId || ''),
      quantity,
      unitCost,
      total: dinheiro(quantity * unitCost)
    };
  }

  function normalizarItens(brutos) {
    if (!Array.isArray(brutos)) return [];
    return brutos
      .map(normalizarItem)
      .filter((item) => item.productId && item.quantity > 0);
  }

  function calcular(documento) {
    const items = normalizarItens(documento.items);
    const itemsTotal = dinheiro(items.reduce((soma, item) => soma + item.total, 0));
    const freight = dinheiro(documento.freight);
    const otherExpenses = dinheiro(documento.otherExpenses);
    const discountAmount = dinheiro(documento.discountAmount);
    return {
      items,
      itemsTotal,
      freight,
      otherExpenses,
      discountAmount,
      totalAmount: dinheiro(itemsTotal + freight + otherExpenses - discountAmount)
    };
  }

  const api = { calcular, normalizarItens, normalizarItem, dinheiro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisPurchaseTotals = api;
})(typeof window !== 'undefined' ? window : globalThis);
