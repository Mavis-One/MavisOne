// O NÚMERO DO LANÇAMENTO FINANCEIRO — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script> e o server.js faz
// require(). Mesma razão do sales_totals.js: se a tela escrevesse "LF12" e o
// servidor "LF0012", seriam dois números para o mesmo lançamento — e quem
// procurasse por um não acharia o outro.
//
// O FORMATO
// ---------
//   LF0001, LF0042, LF1234, LF10000
//
// Quatro dígitos com zeros à esquerda até 9999, e depois cresce naturalmente.
// O padding existe para a lista ordenar visualmente igual à ordem numérica —
// sem ele, "LF10" aparece antes de "LF9" em qualquer ordenação por texto.
//
// Não trunca em 9999: um sistema que reinicia ou corta a numeração ao passar do
// teto é pior do que um número comprido.
//
// POR QUE `LF` E NÃO `LF-`
// ------------------------
// Os outros documentos do sistema usam hífen (MOV-0001, TRA-0001), mas este foi
// pedido escrito assim, sem. Trocar por consistência seria decidir por quem vai
// ditar o número ao telefone — e o hífen entra aqui, num lugar só, se mudar de
// ideia.
(function (raiz) {
  const PREFIXO = 'LF';
  const DIGITOS = 4;

  /**
   * Número -> código. Sem número, devolve string vazia.
   *
   * VAZIO, E NÃO "LF0000": lançamento sem número é lançamento que a migração
   * ainda não alcançou (a coluna nasceu anulável de propósito — ver a fase AT).
   * Inventar "LF0000" para ele criaria um código que parece de verdade,
   * repetido em todos os que faltam.
   */
  function formatar(code) {
    const n = Number(code);
    if (!Number.isFinite(n) || n <= 0) return '';
    return PREFIXO + String(Math.trunc(n)).padStart(DIGITOS, '0');
  }

  /** "LF0042" -> 42. Aceita com ou sem o prefixo, para a busca ser tolerante. */
  function numero(codigo) {
    const texto = String(codigo || '').trim().toUpperCase();
    const so = texto.startsWith(PREFIXO) ? texto.slice(PREFIXO.length) : texto;
    const n = Number(so.replace(/\D/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * O que mostrar quando o lançamento ainda não tem número.
   *
   * Usado nos títulos: "Editar lançamento LF0042" contra "Editar lançamento"
   * — melhor do que "Editar lançamento (sem número)", que faz o usuário
   * procurar um defeito onde só há um registro antigo.
   */
  function rotulo(code, prefixoTexto) {
    const codigo = formatar(code);
    const base = prefixoTexto || '';
    return codigo ? `${base}${base ? ' ' : ''}${codigo}` : base;
  }

  const api = { PREFIXO, DIGITOS, formatar, numero, rotulo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisLancamentoCodigo = api;
})(typeof window !== 'undefined' ? window : globalThis);
