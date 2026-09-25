// MODALIDADE DO FRETE NA NF-e (modFrete) — FONTE ÚNICA.
//
// Mora em public/ porque a tela de emissão carrega por <script> e o server.js
// faz require() dele. Mesma razão do forma_pagamento.js e do sales_status.js:
// os DOIS caminhos de emissão montam o corpo da nota (a tela, e
// `montarNfeDoPedido` no servidor, que o pré-check usa), e uma regra escrita
// duas vezes são duas regras.
//
// O QUE ESTAVA ERRADO
// -------------------
// A tela mandava `modalidadeFrete: 0` FIXO sempre que havia valor de frete, e o
// servidor não mandava nada — caindo no palpite do builder,
// `frete > 0 ? 0 : 9`. Os dois ignoravam o campo "Meio de Envio" da aba Entrega
// do pedido, que é justamente quem sabe a resposta.
//
// O efeito, para uma operação de venda em loja com entrega própria:
//
//   Meio de Envio      frete cobrado   declarava   é
//   Entrega Própria     R$ 0,00          9          3
//   Entrega Própria     R$ 80,00         0          3
//   Transportadora      R$ 0,00          9          0
//   Retirada no Balcão  R$ 0,00          9          9   (já certo)
//   Transportadora      R$ 80,00         0          0   (já certo)
//
// Ou seja: toda nota de entrega própria saía declarando frete CONTRATADO de
// terceiro, e toda entrega cujo frete a loja absorveu saía declarando que não
// houve transporte nenhum.
//
// POR QUE O VALOR NÃO DECIDE A MODALIDADE
// ---------------------------------------
// `modFrete` responde QUEM CONTRATOU o transporte, não se ele foi cobrado. A
// loja que leva a bicicleta na própria camionete e não cobra nada fez transporte
// próprio (3) com vFrete zero; declarar 9 ("sem ocorrência de transporte")
// afirma que a mercadoria não saiu do lugar. O valor e a modalidade são dois
// fatos diferentes, e o `freteCobrado` da fase BQ zera o primeiro sem mexer no
// segundo.
//
// A TABELA É A DA SEFAZ, não uma invenção nossa (NT 2016.002 e a revisão de
// 2023):
//   0 = contratação por conta do remetente (CIF)
//   1 = contratação por conta do destinatário (FOB)
//   2 = contratação por conta de terceiros
//   3 = transporte próprio por conta do remetente
//   4 = transporte próprio por conta do destinatário
//   9 = sem ocorrência de transporte
//
// O 1 E O 4 NÃO SÃO ESCOLHÍVEIS AQUI, de propósito: os dois dizem que quem
// contratou foi o DESTINATÁRIO, e o pedido não tem campo que registre isso. A
// lista de Meio de Envio descreve como a mercadoria sai da loja, não quem pagou
// a transportadora. Inventar 1 a partir de "cobrar frete do comprador" seria
// confundir quem PAGA com quem CONTRATA — repassar o frete na nota é o próprio
// CIF, e continua sendo 0.
//
// "Outro" não tem resposta, e é o único caso em que o valor volta a decidir.
(function (raiz) {
  // A LISTA MORA AQUI, e não na tela, para não existir meio de envio sem
  // modalidade. Solta em app.js, um sexto item entraria no select e sairia
  // declarando 0 sem ninguém decidir nada.
  const MEIOS_ENVIO = ['Outro', 'Correios', 'Transportadora', 'Retirada no Balcão', 'Entrega Própria'];

  const POR_MEIO = {
    'Correios': 0,
    'Transportadora': 0,
    'Entrega Própria': 3,
    'Retirada no Balcão': 9
  };

  /**
   * A modalidade de frete da nota, ou `undefined` quando o meio não responde.
   *
   * `undefined` e não 0: quem chama repassa ao builder, e é o builder que tem o
   * último palpite (`frete > 0 ? 0 : 9`). Devolver 0 aqui apagaria esse palpite
   * e faria "Outro" sem frete declarar transporte contratado.
   */
  function paraNota(meioDeEnvio) {
    const meio = String(meioDeEnvio || '').trim();
    if (!meio) return undefined;
    const codigo = POR_MEIO[meio];
    return codigo === undefined ? undefined : codigo;
  }

  /** O rótulo da SEFAZ, para a tela poder dizer o que vai sair na nota. */
  const ROTULOS = {
    0: 'Frete por conta do remetente (CIF)',
    1: 'Frete por conta do destinatário (FOB)',
    2: 'Frete por conta de terceiros',
    3: 'Transporte próprio por conta do remetente',
    4: 'Transporte próprio por conta do destinatário',
    9: 'Sem ocorrência de transporte'
  };

  function rotulo(codigo) {
    return ROTULOS[Number(codigo)] || '';
  }

  const api = { MEIOS_ENVIO, POR_MEIO, ROTULOS, paraNota, rotulo };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisModalidadeFrete = api;
})(typeof window !== 'undefined' ? window : null);
