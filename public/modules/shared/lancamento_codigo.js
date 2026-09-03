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
  // O mesmo separador da descrição (shared/descricao_lancamento.js): não aparece
  // dentro de número de documento nem de chave de acesso, então nunca vira
  // ambiguidade na hora de ler onde termina o número e começa a referência.
  const SEPARADOR = ' · ';

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

  /**
   * O CAMPO "DOCUMENTO" DO LANÇAMENTO (fase AY).
   *
   * Foi pedido assim: "para cada lançamento financeiro o documento comece com
   * LF{número} para manter padronizado".
   *
   * COMEÇA com o número, e não SÓ o número. O que estava lá antes — o código do
   * pedido, o número da NF-e, a chave de acesso de 44 dígitos — é o documento
   * EXTERNO, e é por ele que uma pessoa liga a conta a pagar à nota do
   * fornecedor na conferência. Substituir apagaria o único lugar onde essa
   * ligação está escrita.
   *
   *   LF0042 · 000000123
   *   LF0042 · 42260812345678000199550010000001231000001238
   *   LF0042                      (quando não há documento externo)
   *
   * NUNCA DUPLICA O PREFIXO: quem editar o campo e salvar de volta o texto
   * inteiro recebe o mesmo texto, e não "LF0042 · LF0042 · 123".
   */
  function documento(code, referenciaExterna) {
    const codigo = formatar(code);
    const externo = String(referenciaExterna || '').trim();
    if (!codigo) return externo;
    if (externo === codigo || externo.startsWith(codigo + SEPARADOR)) return externo;
    return externo ? codigo + SEPARADOR + externo : codigo;
  }

  /**
   * O caminho de volta: só o documento externo, sem o LF.
   *
   * É o que a tela de edição põe dentro do campo — o prefixo aparece ao lado,
   * fixo, porque ele não é do usuário para editar. Sem isto, o campo abriria com
   * "LF0042 · 123" e a primeira correção seria alguém apagando o prefixo à mão.
   */
  function referencia(code, documentoCompleto) {
    const codigo = formatar(code);
    const texto = String(documentoCompleto || '').trim();
    if (!codigo) return texto;
    if (texto === codigo) return '';
    return texto.startsWith(codigo + SEPARADOR) ? texto.slice((codigo + SEPARADOR).length) : texto;
  }

  const api = { PREFIXO, DIGITOS, SEPARADOR, formatar, numero, rotulo, documento, referencia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisLancamentoCodigo = api;
})(typeof window !== 'undefined' ? window : globalThis);
