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
 * A TAXA DA FORMA E A IDENTIDADE DO CARTÃO, na parcela (fase BX).
 *
 * A TAXA existia no cadastro de formas de pagamento e NUNCA ERA LIDA. Uma venda
 * de R$ 1.000,00 no cartão a 3,5% credita R$ 965,00 na conta, e o título dizia
 * R$ 1.000,00: a conciliação errava por exatamente a taxa em toda venda no
 * cartão, e toda margem saía otimista pelo mesmo valor.
 *
 * `amount` CONTINUA SENDO O BRUTO — é o que o cliente pagou. A taxa entra ao
 * lado: quanto custa e quanto sobra. Mexer no bruto mudaria receita, comissão e
 * todo relatório que já existe.
 *
 * Só sai quando a forma COBRA taxa: campo ausente é "não se aplica", enquanto
 * `feePercent: 0` seria "taxa zero contratada". São afirmações diferentes, e a
 * tela mostra uma e não a outra.
 *
 * A IDENTIDADE DO CARTÃO (credenciadora, bandeira, NSU) vai junto porque sem
 * ela a conciliação não tem por onde casar: o extrato da credenciadora vem por
 * NSU e bandeira, não por número de pedido. O NOME da credenciadora é gravado
 * junto do id, e não buscado na leitura, pela mesma razão de
 * `clientSupplierName`: credenciadora renomeada ou inativada não pode apagar de
 * quem era o título do ano passado.
 */
function taxaEcartao(linha, forma, valor, credenciadorasPorId) {
  if (!forma) return {};
  const extra = {};
  // Fase ET (19/10/2026): na linha simulada, a taxa é a da tabela da
  // credenciadora (por canal, bandeira e parcelas), e não a única da forma. O
  // valor da taxa vem pronto do simulador, em centavos exatos.
  const simulada = Boolean(linha && linha.cartaoModalidade) && Number.isFinite(Number(linha.cartaoTaxa));
  const percentual = simulada ? Math.round(Number(linha.cartaoTaxa) * 1000000) / 10000 : Number(forma.feePercent || 0);
  if (percentual > 0) {
    const taxa = simulada && Number(linha.cartaoValorTaxa) > 0 && cent(linha.amount) === cent(valor)
      ? cent(linha.cartaoValorTaxa)
      : cent(valor * percentual / 100);
    extra.feePercent = percentual;
    extra.feeAmount = taxa;
    extra.netAmount = cent(valor - taxa);
  }
  if (!formaPagamento.ehCartao(forma.type)) return extra;
  const credenciadora = credenciadorasPorId.get(String(forma.cardAcquirerId || '')) || null;
  extra.cardAcquirerId = forma.cardAcquirerId || '';
  extra.cardAcquirerName = credenciadora ? credenciadora.name : '';
  extra.cardBrand = linha.cardBrand || '';
  extra.cardAuthorization = linha.cardAuthorization || '';
  return extra;
}

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
  // As credenciadoras entram por `contexto` pelo mesmo motivo do número da
  // nota: buscá-las é ida ao banco, e esta função é pura de propósito — é ela
  // que o teste sem banco exercita. Sem o mapa, o título fica com o id da
  // credenciadora e sem o nome, que degrada em vez de quebrar.
  const credenciadoras = contexto.credenciadorasPorId instanceof Map
    ? contexto.credenciadorasPorId
    : new Map();

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
    // O CARTÃO SIMULADO VIRA TÍTULO PELO LÍQUIDO (22/10/2026, decisão do
    // usuário: "quero que o valor líquido apareça no campo de valor quando eu
    // escolher um parcelamento pelo simulador" — na linha e no título). A
    // linha continua com o valor NO CARTÃO (`amount`): é o que o cliente paga,
    // o que fecha com o total do pedido e o que vai na NF-e. O título nasce
    // com o que a loja recebe (no cartão − taxa da tabela), e a taxa já não
    // entra de novo como feeAmount, senão a baixa a descontaria duas vezes.
    const bruto = cent(linha.amount);
    const pelaTabela = Boolean(linha.cartaoModalidade) && Number(linha.cartaoValorTaxa) > 0;
    const valorDoTitulo = pelaTabela ? cent(bruto - Number(linha.cartaoValorTaxa)) : bruto;
    const cartao = taxaEcartao(linha, forma, bruto, credenciadoras);
    if (pelaTabela) {
      delete cartao.feePercent;
      delete cartao.feeAmount;
      delete cartao.netAmount;
    }
    const observacaoDaLinha = String(linha.note || '').trim();
    const observacaoDoCartao = pelaTabela
      ? `Cartão: no cartão R$ ${bruto.toFixed(2).replace('.', ',')}, taxa R$ ${cent(linha.cartaoValorTaxa).toFixed(2).replace('.', ',')}; título pelo líquido.`
      : '';
    // Vencimento, em ordem: o que o vendedor escreveu na linha; senão a data da
    // venda mais o prazo que a FORMA promete (a maquininha que paga em 30 dias
    // não vence hoje); senão a data da venda.
    const vence = linha.dueDate
      || (forma ? formaPagamento.vencimento(record.date, forma.daysToReceive) : record.date);
    return {
      dueDate: vence,
      amount: valorDoTitulo,
      // O valor no cartão, só para a conta da diferença abaixo (sai antes de voltar).
      bruto,
      description: descricao.montar({
        ...comum,
        parcela: indice + 1,
        parcelas: linhas.length,
        forma: linha.methodName || ''
      }),
      methodId: linha.methodId || '',
      // A Observação da linha de pagamento vira a do título (17/10/2026,
      // pedido do usuário: "essa informação seja colocada nas observações de
      // título, puxe automaticamente").
      note: [observacaoDaLinha, observacaoDoCartao].filter(Boolean).join(' — '),
      // Quem lê isto: quem cria o lançamento. Ver o comentário do catálogo.
      quitaNaHora: quita,
      recebivelDe: forma ? formaPagamento.recebivelDe(tipo) : 'cliente',
      // A conta onde o dinheiro cai, quando a forma a declara. É o que faz o
      // saldo bancário do ERP deixar de ser ficção.
      bankAccountId: forma ? (forma.bankAccountId || '') : '',
      ...cartao
    };
  });

  // A diferença é contra o que as LINHAS cobram (o valor no cartão), e não
  // contra os títulos: a taxa do cartão simulado não é pagamento faltando.
  const somado = cent(parcelas.reduce((soma, p) => soma + p.bruto, 0));
  parcelas.forEach((p) => { delete p.bruto; });
  const diferenca = cent(total - somado);
  // Um centavo de diferença é arredondamento de parcela (1000/3), não erro de
  // digitação — nesse caso o ajuste vai na última parcela em vez de virar linha.
  if (Math.abs(diferenca) >= 0.01 && Math.abs(diferenca) <= 0.05) {
    const ultima = parcelas[parcelas.length - 1];
    ultima.amount = cent(ultima.amount + diferenca);
    // O LÍQUIDO ACOMPANHA O AJUSTE. A taxa foi calculada sobre o valor de
    // antes do centavo; deixar o líquido como estava faria bruto − taxa não
    // fechar com o líquido — e é justamente o líquido que a conciliação usa,
    // então a diferença apareceria como se fosse do banco.
    if (ultima.feeAmount != null) {
      ultima.feeAmount = cent(ultima.amount * ultima.feePercent / 100);
      ultima.netAmount = cent(ultima.amount - ultima.feeAmount);
    }
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
