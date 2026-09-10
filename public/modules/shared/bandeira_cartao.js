// AS BANDEIRAS DE CARTÃO DA NF-e (campo `tBand`) — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script> e o servidor faz
// require(). Mesma razão do forma_pagamento.js: a tela e o servidor precisam
// concordar sobre um código que vai para a SEFAZ.
//
// POR QUE ISTO VIROU ARQUIVO PRÓPRIO
// ----------------------------------
// Na fase BV a tabela nasceu em DOIS lugares — `lib/db/adquirentes.js`, que
// valida o que entra no cadastro, e as dez caixas escritas à mão em
// `nova_credenciadora.js`. Duas listas do mesmo assunto convergem enquanto
// ninguém mexe e divergem no dia em que alguém acrescenta uma bandeira em uma
// só: o cadastro aceitaria um código que a tela não sabe desenhar, ou a tela
// ofereceria um que o cadastro descarta em silêncio.
//
// Agora a fase BW acrescentou um TERCEIRO consumidor — o select de bandeira na
// linha de pagamento do pedido. Três cópias era o momento de parar.
//
// O CÓDIGO É O DA SEFAZ, e não um id interno: o que está guardado no cadastro é
// exatamente o que vai no XML, sem tradução no meio do caminho.
//
// A TABELA ESTÁ COMPLETA? Não. O layout 4.0 nasceu com 01-09 e 99, e a NT
// 2023.005 estendeu a faixa até 27 com bandeiras regionais. Estas dez são as
// que dá para conferir; inventar código que a SEFAZ não conhece produziria
// rejeição na hora da emissão, que é o custo caro. Quem precisar de uma que
// não está aqui usa `99 — Outros`, que é o que a própria tabela reserva para
// isso — e acrescentar as que faltam é acrescentar UMA linha, neste arquivo.
(function (raiz) {
  const CATALOGO = [
    { codigo: '01', nome: 'Visa' },
    { codigo: '02', nome: 'Mastercard' },
    { codigo: '03', nome: 'American Express' },
    { codigo: '04', nome: 'Sorocred' },
    { codigo: '05', nome: 'Diners Club' },
    { codigo: '06', nome: 'Elo' },
    { codigo: '07', nome: 'Hipercard' },
    { codigo: '08', nome: 'Aura' },
    { codigo: '09', nome: 'Cabal' },
    { codigo: '99', nome: 'Outros' }
  ];

  const porCodigo = new Map(CATALOGO.map((b) => [b.codigo, b]));

  const existe = (codigo) => porCodigo.has(String(codigo || ''));
  // Bandeira desconhecida devolve '' e não '99': dizer "Outros" no lugar de
  // "não sei" seria inventar informação para a SEFAZ.
  const nome = (codigo) => (porCodigo.get(String(codigo || '')) || {}).nome || '';

  /**
   * As bandeiras que a tela deve oferecer para uma credenciadora.
   *
   * Credenciadora sem bandeira marcada NÃO restringe — é o que o formulário do
   * cadastro promete em texto ("deixe todas desmarcadas para não restringir").
   * Restringir para nada aqui faria o select do pedido nascer vazio e ninguém
   * conseguiria lançar cartão.
   */
  function ofertadas(bandeirasDaCredenciadora) {
    const marcadas = (Array.isArray(bandeirasDaCredenciadora) ? bandeirasDaCredenciadora : [])
      .map((b) => String(b || ''))
      .filter((b) => porCodigo.has(b));
    if (!marcadas.length) return CATALOGO.slice();
    return CATALOGO.filter((b) => marcadas.includes(b.codigo));
  }

  const api = { CATALOGO, existe, nome, ofertadas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisBandeiraCartao = api;
})(typeof window !== 'undefined' ? window : globalThis);
