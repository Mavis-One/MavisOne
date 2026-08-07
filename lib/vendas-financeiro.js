// Quais contas a receber um pedido faturado gera — SEM banco e SEM rede.
//
// A regra mora aqui, isolada, porque é dinheiro: um pedido de R$ 1.000 tem que
// virar exatamente R$ 1.000 a receber, nem centavo a mais. O teste
// (scripts/test-vendas-financeiro.js) cobre os arredondamentos e os casos em
// que as parcelas não fecham com o total.

const cent = (v) => Math.round(Number(v || 0) * 100) / 100;

/**
 * Fonte das parcelas, nesta ordem:
 *
 * 1. As linhas da aba "Pagamentos" do pedido, quando existirem. É o que o
 *    vendedor combinou com o cliente (entrada + 2x, boleto para 30 dias...),
 *    então é o que deve virar contas a receber.
 *
 * 2. Sem linhas, uma parcela única no total da venda. Vencimento na data do
 *    pedido: à vista é o padrão de quem não preencheu nada.
 *
 * Se as linhas de pagamento não somarem o total do pedido, a DIFERENÇA vira uma
 * parcela extra em vez de sumir. Pagamento parcial preenchido pela metade é
 * erro de digitação comum, e o financeiro não pode simplesmente perder o que
 * falta — melhor aparecer uma linha "diferença" para alguém corrigir.
 */
function parcelasDoPedido(record) {
  const total = cent(record?.totalAmount);
  if (!(total > 0)) return [];

  const codigo = record.code ? `Pedido ${record.code}` : 'Pedido';
  const linhas = (Array.isArray(record?.payments) ? record.payments : [])
    .filter((linha) => cent(linha?.amount) > 0);

  if (!linhas.length) {
    return [{
      dueDate: record.dueDate || record.date,
      amount: total,
      description: codigo
    }];
  }

  const parcelas = linhas.map((linha, indice) => ({
    dueDate: linha.dueDate || record.date,
    amount: cent(linha.amount),
    description: [
      codigo,
      linhas.length > 1 ? `Parcela ${indice + 1}/${linhas.length}` : null,
      linha.methodName || null
    ].filter(Boolean).join(' · ')
  }));

  const somado = cent(parcelas.reduce((soma, p) => soma + p.amount, 0));
  const diferenca = cent(total - somado);
  // Um centavo de diferença é arredondamento de parcela (1000/3), não erro de
  // digitação — nesse caso o ajuste vai na última parcela em vez de virar linha.
  if (Math.abs(diferenca) >= 0.01 && Math.abs(diferenca) <= 0.05) {
    parcelas[parcelas.length - 1].amount = cent(parcelas[parcelas.length - 1].amount + diferenca);
  } else if (Math.abs(diferenca) > 0.05) {
    parcelas.push({
      dueDate: record.dueDate || record.date,
      amount: diferenca,
      description: `${codigo} · Diferença não coberta pelos pagamentos informados`
    });
  }

  return parcelas;
}

module.exports = { parcelasDoPedido };
