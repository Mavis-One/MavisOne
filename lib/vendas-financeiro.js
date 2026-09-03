// Quais contas a receber um pedido faturado gera — SEM banco e SEM rede.
//
// A regra mora aqui, isolada, porque é dinheiro: um pedido de R$ 1.000 tem que
// virar exatamente R$ 1.000 a receber, nem centavo a mais. O teste
// (scripts/test-vendas-financeiro.js) cobre os arredondamentos e os casos em
// que as parcelas não fecham com o total.

const formaPagamento = require('../public/modules/shared/forma_pagamento');

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
function parcelasDoPedido(record, formasPorId) {
  const total = cent(record?.totalAmount);
  if (!(total > 0)) return [];

  const codigo = record.code ? `Pedido ${record.code}` : 'Pedido';
  const linhas = (Array.isArray(record?.payments) ? record.payments : [])
    .filter((linha) => cent(linha?.amount) > 0);

  // O CADASTRO DA FORMA DE PAGAMENTO É QUEM DECIDE se a parcela nasce quitada e
  // quando ela vence. Sem o mapa (chamadas antigas, e o teste puro), nada quita
  // na hora — que é exatamente o comportamento de antes desta mudança.
  const formas = formasPorId instanceof Map ? formasPorId : new Map();
  const daForma = (linha) => formas.get(String(linha?.methodId || '')) || null;

  if (!linhas.length) {
    return [{
      dueDate: record.dueDate || record.date,
      amount: total,
      description: codigo,
      quitaNaHora: false,
      recebivelDe: 'cliente'
    }];
  }

  const parcelas = linhas.map((linha, indice) => {
    const forma = daForma(linha);
    const tipo = forma ? forma.type : '';
    const quita = Boolean(forma) && formaPagamento.quitaNaHora(tipo);
    // Vencimento, em ordem: o que o vendedor escreveu na linha; senão a data da
    // venda mais o prazo que a FORMA promete (a maquininha que paga em 30 dias
    // não vence hoje); senão a data da venda.
    const vence = linha.dueDate
      || (forma ? formaPagamento.vencimento(record.date, forma.daysToReceive) : record.date);
    return {
      dueDate: vence,
      amount: cent(linha.amount),
      description: [
        codigo,
        linhas.length > 1 ? `Parcela ${indice + 1}/${linhas.length}` : null,
        linha.methodName || null
      ].filter(Boolean).join(' · '),
      methodId: linha.methodId || '',
      // Quem lê isto: quem cria o lançamento. Ver o comentário do catálogo.
      quitaNaHora: quita,
      recebivelDe: forma ? formaPagamento.recebivelDe(tipo) : 'cliente',
      // A conta onde o dinheiro cai, quando a forma a declara. É o que faz o
      // saldo bancário do ERP deixar de ser ficção.
      bankAccountId: forma ? (forma.bankAccountId || '') : ''
    };
  });

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
      description: `${codigo} · Diferença não coberta pelos pagamentos informados`,
      // A diferença NUNCA nasce quitada: ela existe porque os pagamentos não
      // fecharam o total, e dar por recebido o que ninguém disse ter recebido
      // apagaria a dívida em silêncio — o oposto do que esta linha serve.
      quitaNaHora: false,
      recebivelDe: 'cliente'
    });
  }

  return parcelas;
}

module.exports = { parcelasDoPedido };
