// COMO CADA FORMA DE PAGAMENTO VIRA DINHEIRO — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script> e o server.js faz
// require(). Mesma razão do sales_status.js: aqui a tela e o servidor precisam
// concordar sobre algo que decide se uma venda entra no caixa ou vira dívida do
// cliente.
//
// O PROBLEMA QUE ISTO RESOLVE
// ---------------------------
// A auditoria do ERP anterior (ViperERP, 02/09/2026) achou isto como o pior
// defeito do sistema, e o MavisONE tinha o mesmo:
//
//   toda venda gerava um lançamento `status: 'pending'`, fixo no código.
//
// Quer dizer: a venda paga em DINHEIRO, na hora, no balcão, nascia como conta a
// receber em aberto. No Viper isso produziu R$ 140.375,77 "a receber" e R$ 0,00
// "realizado" em dois dias, com todo cliente que comprou aparecendo no relatório
// de Inadimplentes. Quatro relatórios (inadimplência, comissão, lucratividade,
// rentabilidade) passaram a mentir — e o saldo das contas bancárias virou
// ficção. O ERP não avisa: cada tela, sozinha, parece certa.
//
// O QUE DECIDE
// ------------
// Não é o valor nem a data: é a FORMA. E o cadastro já sabia disso — cada forma
// de pagamento tem `type` e `daysToReceive`. O que faltava era alguém ler.
//
//   quitaNaHora  — o dinheiro está na conta no ato. O lançamento nasce QUITADO,
//                  com a baixa registrada. Sem a baixa, o "realizado" continua
//                  R$ 0,00 e o problema só muda de lugar.
//   recebivelDe  — de QUEM se está esperando:
//                    'cliente'   — ele deve, e atrasar é inadimplência de verdade
//                    'operadora' — o cliente já pagou; quem deve é a
//                                  credenciadora do cartão. Cobrar o cliente por
//                                  isso é o erro que enche o relatório de
//                                  inadimplentes de quem não deve nada.
//                    ''          — quitado na hora, não há recebível.
//
// O PRAZO SAI DO CADASTRO, não daqui. `daysToReceive` é por forma (a maquininha
// de um adquirente paga em 30 dias, a de outro em 14), então o vencimento do
// cartão é `data da venda + daysToReceive`. Antes o vencimento era o da venda —
// e a parcela nascia vencida no mesmo dia.
//
// O CODIGO tPag TAMBEM MORA AQUI (fase BU)
// ----------------------------------------
// `tPag` e o codigo da forma de pagamento no grupo `pag` da NF-e. Existiam
// duas listas sem ponte entre elas: este catalogo, que o pedido usa, e a
// tabela FORMAS_PAGAMENTO do montador do payload. Sem a traducao, o grupo
// `pag` da nota nao tinha como saber que forma foi usada na venda — e saia
// com uma linha unica "99 Outros" pelo total, qualquer que fosse o pagamento.
//
// Fica no catalogo, e nao numa tabela de-para separada, pelo mesmo motivo de
// `quitaNaHora` e `recebivelDe`: quem acrescentar uma forma nova acrescenta
// tudo o que ela significa num lugar so, em vez de descobrir depois que
// esqueceu metade.
(function (raiz) {
  const CATALOGO = [
    {
      value: 'dinheiro', label: 'Dinheiro', tPag: '01',
      quitaNaHora: true, recebivelDe: ''
    },
    {
      value: 'pix', label: 'PIX', tPag: '17',
      quitaNaHora: true, recebivelDe: ''
    },
    {
      // Débito cai na conta no mesmo dia ou no seguinte. Tratar como recebível
      // de 1 dia seria precisão que ninguém usa e ruído que todo mundo vê.
      value: 'cartao-debito', label: 'Cartão de Débito', tPag: '04',
      quitaNaHora: true, recebivelDe: '', cartao: true
    },
    {
      // O CLIENTE JÁ PAGOU. O que falta é a credenciadora repassar, e é dela que
      // se cobra. Manter como dívida do cliente é o que fazia o relatório de
      // inadimplentes listar quem comprou no cartão ontem.
      value: 'cartao-credito', label: 'Cartão de Crédito', tPag: '03',
      quitaNaHora: false, recebivelDe: 'operadora', cartao: true
    },
    {
      value: 'boleto', label: 'Boleto', tPag: '15',
      quitaNaHora: false, recebivelDe: 'cliente'
    },
    {
      // Transferência/TED costuma ser combinada e conferida depois, não no ato.
      value: 'transferencia', label: 'Transferência', tPag: '18',
      quitaNaHora: false, recebivelDe: 'cliente'
    },
    {
      value: 'cheque', label: 'Cheque', tPag: '02',
      quitaNaHora: false, recebivelDe: 'cliente'
    },
    {
      // 05 e "Credito Loja" na tabela da SEFAZ: e exatamente o crediario da
      // propria loja, sem banco nem cartao no meio.
      value: 'crediario', label: 'Crediário', tPag: '05',
      quitaNaHora: false, recebivelDe: 'cliente'
    },
    {
      // Forma que ninguém classificou. NÃO quita na hora, de propósito: o erro
      // de deixar em aberto o que já foi pago é visível e alguém corrige; o de
      // dar por paga uma venda que não foi apaga a dívida em silêncio.
      value: 'outro', label: 'Outro', tPag: '99',
      quitaNaHora: false, recebivelDe: 'cliente'
    }
  ];

  const porValor = new Map(CATALOGO.map((f) => [f.value, f]));

  // Forma desconhecida cai no 'outro' — o comportamento conservador acima.
  function obter(valor) {
    return porValor.get(String(valor || '')) || porValor.get('outro');
  }

  const quitaNaHora = (tipo) => Boolean(obter(tipo).quitaNaHora);
  const recebivelDe = (tipo) => obter(tipo).recebivelDe;
  const rotulo = (tipo) => obter(tipo).label;
  // Forma desconhecida cai em '99 Outros' pela mesma queda de obter().
  const codigoNfe = (tipo) => obter(tipo).tPag;
  // ESTA FORMA PEDE O GRUPO `card` DA NF-e? (fase BW)
  //
  // Só o cartão tem credenciadora, bandeira e NSU. Perguntar ao catálogo, e não
  // testar o texto do tipo em cada tela, é o que evita a lista de tipos ser
  // reescrita em três lugares e ficar desencontrada quando entrar uma forma
  // nova de cartão — foi assim que a tabela de bandeiras acabou duplicada.
  const ehCartao = (tipo) => Boolean(obter(tipo).cartao);

  /**
   * O vencimento da parcela, dado o que a forma de pagamento promete.
   *
   * Recebe a data em 'aaaa-mm-dd' e soma os dias em UTC — somar em horário
   * local faz a data pular um dia em fuso negativo, que é o Brasil inteiro.
   */
  function vencimento(dataBase, diasParaReceber) {
    const texto = String(dataBase || '').slice(0, 10);
    const dias = Number(diasParaReceber);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    if (!Number.isFinite(dias) || dias <= 0) return texto;
    const d = new Date(`${texto}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.trunc(dias));
    return d.toISOString().slice(0, 10);
  }

  const api = { CATALOGO, obter, quitaNaHora, recebivelDe, rotulo, codigoNfe, ehCartao, vencimento };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisFormaPagamento = api;
})(typeof window !== 'undefined' ? window : globalThis);
