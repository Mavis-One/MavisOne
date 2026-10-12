// TUDO O QUE O USUÁRIO DIGITA OU INCLUI FICA EM MAIÚSCULA (12/10/2026).
//
// Pedido do usuário: "todas as informações que os usuários cadastrarem fiquem
// em letra maiúscula ... independente do caps lock ... em todo o sistema".
// O cadastro tinha "Alexandra maske" ao lado de "ALVIM RATHUNDE FILHO", e a
// busca, os relatórios e a NF-e repetiam a bagunça.
//
// COMO: três escutas no DOCUMENTO, e não em cada campo — assim vale para toda
// tela que existe e para as que ainda vão existir, sem ninguém lembrar:
//   1. ao DIGITAR (input): o valor vira maiúscula na hora, sem pular o cursor;
//   2. ao SALVAR (submit e clique em botão, na fase de captura — antes de a
//      tela ler os campos): converte o que entrou sem digitação, como o
//      endereço que o CEP preenche sozinho;
//   3. ao sair do campo (blur), pelo mesmo motivo do 2.
//
// O QUE FICA DE FORA, e cada item quebraria algo se entrasse:
//   - senha (o login compara exatamente: "Abc123" viraria "ABC123");
//   - usuário do login, pelo mesmo motivo;
//   - e-mail, URL/site/link (o link do mapa no cadastro), tokens e chaves
//     (Focus, CSC, integração), PIX, senha do certificado — identificadores
//     técnicos, não texto;
//   - busca e filtro — não é cadastro;
//   - número, data e afins (não têm letra);
//   - qualquer campo marcado com data-sem-maiuscula (a saída explícita).
//
// Carregado ANTES do app.js (ver index.html), como o campos.js.
window.MavisMaiusculas = (function () {
  const TIPOS_DE_TEXTO = new Set(['', 'text', 'tel']);
  // Nome, id, autocomplete ou placeholder que dizem "isto não é texto livre".
  // `url` e `link` em qualquer posição (logoUrl, mapLink): endereço da web tem
  // diferença entre maiúscula e minúscula, e o link do mapa quebraria.
  const SENSIVEL = /senha|password|passw|e-?mail|token|csc|secret|segredo|url|link|maps|http|www|site|webhook|usuario|username|login|apikey|api_key|certificado|\bpix\b|chave_?pix|instagram|busca|buscar|search|filtro|filtrar|filter|pesquis/i;

  function elegivel(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') {
      // segue para as exclusões abaixo
    } else if (tag === 'INPUT') {
      if (!TIPOS_DE_TEXTO.has(String(el.getAttribute('type') || '').toLowerCase())) return false;
    } else {
      return false;
    }
    if (el.closest('[data-sem-maiuscula], #loginForm')) return false;
    if (el.classList.contains('searchable-select-input') || el.classList.contains('workspace-filter')) return false;
    const pistas = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder')].filter(Boolean).join(' ');
    return !SENSIVEL.test(pistas);
  }

  /** Converte o valor sem pular o cursor (maiúscula não muda o tamanho em pt-BR). */
  function converter(el) {
    const valor = el.value;
    const maiusculo = valor.toLocaleUpperCase('pt-BR');
    if (maiusculo === valor) return false;
    let inicio = null;
    let fim = null;
    try { inicio = el.selectionStart; fim = el.selectionEnd; } catch (e) { /* tipo sem seleção */ }
    el.value = maiusculo;
    const focado = typeof document !== 'undefined' && document.activeElement === el;
    if (typeof inicio === 'number' && focado && maiusculo.length === valor.length) {
      try { el.setSelectionRange(inicio, fim); } catch (e) { /* idem */ }
    }
    return true;
  }

  /** Converte todos os campos elegíveis dentro de um container. */
  function converterTodos(raiz) {
    if (!raiz || !raiz.querySelectorAll) return 0;
    let n = 0;
    raiz.querySelectorAll('input, textarea').forEach((el) => { if (elegivel(el) && converter(el)) n += 1; });
    return n;
  }

  function ligar(doc) {
    // Durante a composição (acento por tecla morta, teclado do celular), o
    // valor ainda está sendo montado: converter no meio quebra o "á". Converte
    // quando a composição termina.
    doc.addEventListener('input', (evento) => {
      if (evento.isComposing) return;
      if (elegivel(evento.target)) converter(evento.target);
    });
    doc.addEventListener('compositionend', (evento) => {
      if (elegivel(evento.target)) converter(evento.target);
    });
    doc.addEventListener('blur', (evento) => {
      if (elegivel(evento.target)) converter(evento.target);
    }, true);
    // Antes de a tela ler os campos: captura, e não bolha, para rodar ANTES do
    // listener do próprio formulário ou do botão.
    doc.addEventListener('submit', (evento) => { converterTodos(evento.target); }, true);
    doc.addEventListener('click', (evento) => {
      const botao = evento.target && evento.target.closest && evento.target.closest('button, input[type="submit"], [role="button"]');
      if (!botao) return;
      converterTodos(botao.closest('form, .modal, .modal-overlay, .panel, #moduleContent') || doc);
    }, true);
  }

  const api = { elegivel, converter, converterTodos, ligar, SENSIVEL };
  if (typeof document !== 'undefined') ligar(document);
  return api;
})();
