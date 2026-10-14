// CAMPOS DE VALOR NO PADRÃO BRASILEIRO (13/10/2026).
//
// Pedido do usuário: "padronize os campos de valores para que os valores se
// ajustem automaticamente, seja por cópia e cola ou digitação; coloque sempre
// em unidade qualquer dígito, no padrão xx,xx; xxx,xx; x.xxx,xx".
//
// O QUE O CAMPO FAZ
//   - Digitando: cada dígito entra como REAIS (unidade), não centavos —
//     "1500" aparece "1.500". A vírgula (ou o ponto do teclado numérico) abre
//     os centavos, no máximo dois. O ponto de milhar é posto sozinho.
//   - Saindo do campo: completa os centavos — "1.500" vira "1.500,00".
//   - Colando: aceita "R$ 1.500,50", "1500.5", "1.500,50", "1,500.50"... e
//     mostra "1.500,50".
//
// O RESTO DO SISTEMA NÃO MUDA. A tela mostra "1.500,50", mas `campo.value`
// (e o FormData do formulário) continuam devolvendo "1500.5" — o número puro
// que todas as telas já liam com Number(). Quem grava `campo.value = 1500.5`
// vê o campo formatado. Por isso nenhuma conta, gravação ou teste precisou
// mudar.
//
// QUAIS CAMPOS: todo <input type="number" step="0.01"> (o jeito como os campos
// de dinheiro foram escritos no sistema inteiro) e qualquer um marcado com
// data-dinheiro. FICAM DE FORA percentuais (alíquota, markup, MVA, redução,
// desconto %) e quantidades — pelo nome/atributos ou pelo "%" no rótulo — e
// qualquer campo marcado com data-nao-dinheiro.
//
// Carregado ANTES do app.js (ver index.html), como o maiusculas.js: as escutas
// ficam no documento e valem para toda tela, inclusive as que ainda vão existir.
(function (raiz) {
  // Percentual, quantidade, medida e código (a origem da mercadoria, 0 a 8, na
  // aba Impostos da NF-e): têm step 0.01, mas não são R$.
  const NAO_E_DINHEIRO = /aliquota|percent|markup|mva|reducao|quantidade|qtd|quantity|liters|litros|peso|weight|horas|hours|origem/i;
  const SELETOR = 'input[type="number"][step="0.01"], input[data-dinheiro]';
  const MAX_DIGITOS_INTEIROS = 13;

  const agruparMilhar = (digitos) => digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  /** O texto enquanto se digita: "1500" -> "1.500"; "1500,5" -> "1.500,5". */
  function formatarDigitando(texto, permitirNegativo) {
    const t = String(texto == null ? '' : texto);
    const negativo = Boolean(permitirNegativo) && /^\s*-/.test(t);
    const virgula = t.indexOf(',');
    let inteiro = (virgula < 0 ? t : t.slice(0, virgula)).replace(/\D/g, '').slice(0, MAX_DIGITOS_INTEIROS);
    const decimal = virgula < 0 ? null : t.slice(virgula + 1).replace(/\D/g, '').slice(0, 2);
    inteiro = inteiro.replace(/^0+(?=\d)/, '');
    if (decimal !== null && inteiro === '') inteiro = '0';
    if (inteiro === '' && decimal === null) return negativo ? '-' : '';
    return (negativo ? '-' : '') + agruparMilhar(inteiro) + (decimal !== null ? ',' + decimal : '');
  }

  /** "1.500,5" -> "1500.5" (o que `value` devolve). Vazio -> "". */
  function paraNumero(texto) {
    const limpo = String(texto == null ? '' : texto).trim().replace(/\./g, '').replace(',', '.').replace(/\.$/, '');
    if (limpo === '' || limpo === '-') return '';
    const n = Number(limpo);
    return Number.isFinite(n) ? String(n) : '';
  }

  /** 1500.5 -> "1.500,50". */
  function formatar(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return '';
    const [inteiro, decimal] = Math.abs(n).toFixed(2).split('.');
    return (n < 0 ? '-' : '') + agruparMilhar(inteiro) + ',' + decimal;
  }

  /** Completa os centavos ao sair do campo: "1.500" -> "1.500,00". */
  function completar(texto) {
    const numero = paraNumero(texto);
    return numero === '' ? '' : formatar(numero);
  }

  /**
   * Um valor COLADO, em qualquer formato, como número (ou null).
   *
   * O separador decimal é decidido pelo texto: com ponto E vírgula, o último
   * é o decimal ("1.500,50" e "1,500.50"); só vírgula uma vez, é decimal (o
   * nosso padrão); só ponto uma vez, é decimal — menos quando seguido de três
   * dígitos ("1.500" é mil e quinhentos); separador repetido é milhar.
   */
  function deColagem(texto) {
    const t = String(texto == null ? '' : texto).replace(/[^\d.,-]/g, '');
    if (!/\d/.test(t)) return null;
    const negativo = /^-/.test(t);
    const corpo = t.replace(/-/g, '');
    const pontos = (corpo.match(/\./g) || []).length;
    const virgulas = (corpo.match(/,/g) || []).length;
    let decimal = null;
    if (pontos && virgulas) {
      decimal = corpo.lastIndexOf(',') > corpo.lastIndexOf('.') ? ',' : '.';
    } else if (virgulas === 1) {
      decimal = ',';
    } else if (pontos === 1) {
      decimal = /\.\d{3}$/.test(corpo) ? null : '.';
    }
    let normal;
    if (decimal) {
      const i = corpo.lastIndexOf(decimal);
      normal = corpo.slice(0, i).replace(/[.,]/g, '') + '.' + corpo.slice(i + 1).replace(/[.,]/g, '');
    } else {
      normal = corpo.replace(/[.,]/g, '');
    }
    const n = Math.round(Number(normal) * 100) / 100;
    if (!Number.isFinite(n)) return null;
    return negativo ? -n : n;
  }

  /** O que um `campo.value = x` vira na tela. */
  function textoDoValor(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    if (typeof valor === 'number') return formatar(valor);
    const s = String(valor).trim();
    if (s === '') return '';
    // "1234.56" (o formato que as telas sempre gravaram) é número direto.
    if (/^-?\d+(\.\d+)?$/.test(s)) return formatar(Number(s));
    const n = deColagem(s);
    return n === null ? '' : formatar(n);
  }

  // ------------------------------------------------------------- navegador
  const temDom = typeof document !== 'undefined' && typeof HTMLInputElement !== 'undefined';
  const nativo = temDom ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') : null;
  const lerTela = (el) => nativo.get.call(el);
  const escreverTela = (el, texto) => nativo.set.call(el, texto);

  function candidato(el) {
    if (!el || el.tagName !== 'INPUT' || el.__dinheiro) return false;
    if (el.closest('[data-nao-dinheiro]')) return false;
    if (el.hasAttribute('data-dinheiro')) return true;
    const pistas = [el.name, el.id, el.className, ...Object.values(el.dataset || {})].join(' ');
    if (NAO_E_DINHEIRO.test(pistas)) return false;
    const rotulo = el.closest('label');
    if (rotulo && rotulo.textContent.includes('%')) return false;
    return true;
  }

  const permiteNegativo = (el) => {
    const min = el.getAttribute('min');
    return min === null || min === '' || Number(min) < 0;
  };

  // Sem o type="number", o navegador deixa de conferir min/max sozinho: a
  // conferência continua, pela validade do próprio campo.
  function validar(el) {
    const texto = el.value;
    let erro = '';
    if (texto !== '') {
      const n = Number(texto);
      const min = el.getAttribute('min');
      const max = el.getAttribute('max');
      if (min !== null && min !== '' && n < Number(min)) erro = `O valor mínimo é ${formatar(min)}.`;
      else if (max !== null && max !== '' && n > Number(max)) erro = `O valor máximo é ${formatar(max)}.`;
    }
    el.setCustomValidity(erro);
  }

  function ativar(el) {
    if (!candidato(el)) return;
    el.__dinheiro = true;
    const inicial = lerTela(el);
    el.setAttribute('data-dinheiro-ativo', '');
    el.setAttribute('type', 'text');
    el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return paraNumero(lerTela(el)); },
      set(v) { escreverTela(el, textoDoValor(v)); validar(el); }
    });
    Object.defineProperty(el, 'valueAsNumber', {
      configurable: true,
      get() { const s = el.value; return s === '' ? NaN : Number(s); }
    });
    escreverTela(el, textoDoValor(inicial));
    validar(el);
  }

  function ativarTodos(raiz) {
    if (!raiz) return;
    if (raiz.matches && raiz.matches(SELETOR)) ativar(raiz);
    if (raiz.querySelectorAll) raiz.querySelectorAll(SELETOR).forEach(ativar);
  }

  /** Reformata o que está na tela mantendo o cursor no mesmo dígito. */
  function reformatar(el) {
    const bruto = lerTela(el);
    let pos = bruto.length;
    try { pos = el.selectionStart == null ? bruto.length : el.selectionStart; } catch (e) { /* sem seleção */ }
    const significativos = bruto.slice(0, pos).replace(/[^\d,-]/g, '').length;
    const novo = formatarDigitando(bruto, permiteNegativo(el));
    if (novo !== bruto) {
      escreverTela(el, novo);
      let i = 0;
      let contados = 0;
      while (i < novo.length && contados < significativos) {
        if (/[\d,-]/.test(novo[i])) contados += 1;
        i += 1;
      }
      try { if (document.activeElement === el) el.setSelectionRange(i, i); } catch (e) { /* idem */ }
    }
    validar(el);
  }

  function ligar(doc) {
    // O ponto do teclado numérico (e de quem digita "1500.50") vira a vírgula
    // dos centavos — o ponto de milhar quem põe é o campo. Uma segunda vírgula
    // é ignorada.
    doc.addEventListener('beforeinput', (evento) => {
      const el = evento.target;
      if (!el || !el.__dinheiro || evento.inputType !== 'insertText' || !evento.data) return;
      if (evento.data !== '.' && evento.data !== ',') return;
      evento.preventDefault();
      const texto = lerTela(el);
      const ini = el.selectionStart;
      const fim = el.selectionEnd;
      if ((texto.slice(0, ini) + texto.slice(fim)).includes(',')) return;
      el.setRangeText(',', ini, fim, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, true);

    // Captura: roda ANTES das escutas da tela, que já leem o valor arrumado.
    doc.addEventListener('input', (evento) => {
      if (evento.target && evento.target.__dinheiro && !evento.isComposing) reformatar(evento.target);
    }, true);

    doc.addEventListener('paste', (evento) => {
      const el = evento.target;
      if (!el || !el.__dinheiro) return;
      const colado = (evento.clipboardData || window.clipboardData).getData('text');
      const n = deColagem(colado);
      evento.preventDefault();
      if (n === null) return;
      const texto = lerTela(el);
      const tudo = el.selectionStart === 0 && el.selectionEnd === texto.length;
      if (tudo || texto === '') {
        escreverTela(el, formatar(n));
      } else {
        el.setRangeText(String(Math.abs(n)).replace('.', ','), el.selectionStart, el.selectionEnd, 'end');
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, true);

    doc.addEventListener('focusout', (evento) => {
      const el = evento.target;
      if (!el || !el.__dinheiro) return;
      const completo = completar(lerTela(el));
      if (completo !== lerTela(el)) escreverTela(el, completo);
      validar(el);
    }, true);

    // `new FormData(form)` lê o que está na TELA ("1.500,50"), sem passar por
    // `value`. O evento formdata deixa trocar pelo número antes de a tela ler.
    doc.addEventListener('formdata', (evento) => {
      const form = evento.target;
      if (!form || !form.elements) return;
      const porNome = new Map();
      Array.from(form.elements).forEach((el) => {
        if (!el.__dinheiro || !el.name || el.disabled) return;
        if (!porNome.has(el.name)) porNome.set(el.name, []);
        porNome.get(el.name).push(el.value);
      });
      porNome.forEach((valores, nome) => {
        evento.formData.delete(nome);
        valores.forEach((v) => evento.formData.append(nome, v));
      });
    }, true);

    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver((mudancas) => {
        mudancas.forEach((m) => m.addedNodes.forEach((no) => { if (no.nodeType === 1) ativarTodos(no); }));
      }).observe(doc.documentElement, { childList: true, subtree: true });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => ativarTodos(doc));
    else ativarTodos(doc);
  }

  const api = { formatarDigitando, paraNumero, formatar, completar, deColagem, textoDoValor, candidato, NAO_E_DINHEIRO, SELETOR };
  if (temDom && nativo && typeof document !== 'undefined' && document.documentElement) ligar(document);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisCampoDinheiro = api;
})(typeof window !== 'undefined' ? window : globalThis);
