// Quais contas a receber um pedido faturado gera — SEM banco e SEM rede.
//
// A regra mora aqui, isolada, porque é dinheiro: um pedido de R$ 1.000 tem que
// virar exatamente R$ 1.000 a receber, nem centavo a mais. O teste
// (scripts/test-vendas-financeiro.js) cobre os arredondamentos e os casos em
// que as parcelas não fecham com o total.

const formaPagamento = require('../public/modules/shared/forma_pagamento');
const descricao = require('../public/modules/shared/descricao_lancamento');

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
function parcelasDoPedido(record, formasPorId, contexto = {}) {
  const total = cent(record?.totalAmount);
  if (!(total > 0)) return [];

  // AS PARTES FIXAS DA DESCRIÇÃO, iguais em todas as parcelas do mesmo pedido.
  // Quem monta a frase é o catálogo (shared/descricao_lancamento.js) — aqui só
  // se junta o que este pedido sabe.
  //
  // O NÚMERO DA NOTA VEM DE FORA, em `contexto`: o pedido guarda `nfeId` (um
  // uuid), e trocar uuid por número é consulta ao banco — coisa que esta função
  // não faz e não deve fazer, porque é ela que o teste puro exercita. A dispensa,
  // ao contrário, está no próprio registro desde a fase AV.
  const comum = {
    qual: 'receita',
    tipo: 'venda',
    pedido: record.code || '',
    nota: contexto.nfeNumero || '',
    semNota: Boolean(record.dispensaDocumentoFiscal)
  };
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
      description: descricao.montar(comum),
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
      description: descricao.montar({
        ...comum,
        parcela: indice + 1,
        parcelas: linhas.length,
        forma: linha.methodName || ''
      }),
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
  } else if (diferenca < -0.05) {
    // PAGARAM MAIS DO QUE A VENDA (fase BQ).
    //
    // A diferenca negativa virava uma conta a receber NEGATIVA no Contas a
    // Receber — uma linha de -R$ 100,00 que SUBTRAI do total a receber do
    // periodo em vez de somar. Ninguem procura um titulo com o sinal
    // trocado, e o total do painel fechava menor que a soma das parcelas
    // visiveis sem nada explicar a falta.
    //
    // Recusar, e nao aparar: se as linhas de pagamento somam mais que o
    // pedido, uma das duas coisas esta errada, e aparar em silencio
    // escolheria qual sem perguntar. A recusa acontece antes de qualquer
    // parcela ser gravada.
    const erro = new Error(
      `As linhas de pagamento somam ${somado.toFixed(2)}, mais que o total do pedido `
      + `(${total.toFixed(2)}). Corrija os valores das parcelas ou o total antes de faturar.`
    );
    erro.status = 400;
    throw erro;
  } else if (diferenca > 0.05) {
    parcelas.push({
      dueDate: record.dueDate || record.date,
      amount: diferenca,
      description: descricao.montar({
        ...comum,
        complemento: 'Diferença não coberta pelos pagamentos informados'
      }),
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
