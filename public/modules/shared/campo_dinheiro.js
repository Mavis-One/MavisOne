// CAMPOS DE VALOR NO PADRÃO BRASILEIRO (13/10/2026).
//
// Pedido do usuário: "padronize os campos de valores para que os valores se
// ajustem automaticamente, seja por cópia e cola ou digitação; coloque sempre
// em unidade qualquer dígito, no padrão xx,xx; xxx,xx; x.xxx,xx".
//
// O QUE O CAMPO FAZ (desde 16/10/2026, pedido do usuário: "todos os valores
// fiquem em 0,00, e toda edição e modificação comece pelos centavos ao invés
// de começar pelos reais e a vírgula deve se manter")
//   - Mostra sempre o valor com centavos; o campo vazio mostra "0,00".
//   - Digitando: cada dígito entra pelos CENTAVOS e empurra os outros para a
//     esquerda — "5" -> "0,05", "50" -> "0,50", "500" -> "5,00",
//     "150000" -> "1.500,00". Apagar tira o último dígito ("5,00" -> "0,50").
//     A vírgula fica onde está: digitar vírgula ou ponto não faz nada. O
//     ponto de milhar é posto sozinho. (Até 16/10 o dígito entrava como reais.)
//   - Colando: aceita "R$ 1.500,50", "1500.5", "1.500,50", "1,500.50"... e
//     mostra "1.500,50".
//   - O "0,00" do campo VAZIO continua vazio para quem lê (`value` = ""):
//     filtro de valor, preço a prazo e preço mínimo distinguem "não
//     informado" de zero, e mostrar 0,00 não pode virar um zero gravado.
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

  const ZERO = '0,00';

  /**
   * O texto enquanto se digita, PELOS CENTAVOS: os dígitos, na ordem, são o
   * valor em centavos — "5" -> "0,05"; "1.500,505" (um 5 digitado depois de
   * "1.500,50") -> "15.005,05"; sem dígito, "0,00". O sinal: cada "-" digitado
   * troca, onde o campo aceita negativo.
   */
  function formatarDigitando(texto, permitirNegativo) {
    const t = String(texto == null ? '' : texto);
    const negativo = Boolean(permitirNegativo) && (t.match(/-/g) || []).length % 2 === 1;
    const digitos = t.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITOS_INTEIROS + 2).padStart(3, '0');
    return (negativo ? '-' : '') + agruparMilhar(digitos.slice(0, -2)) + ',' + digitos.slice(-2);
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
    // __vazio: a tela mostra "0,00", mas ninguém informou valor (16/10/2026).
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return el.__vazio ? '' : paraNumero(lerTela(el)); },
      set(v) { mostrar(el, textoDoValor(v)); validar(el); }
    });
    Object.defineProperty(el, 'valueAsNumber', {
      configurable: true,
      get() { const s = el.value; return s === '' ? NaN : Number(s); }
    });
    mostrar(el, textoDoValor(inicial));
    validar(el);
  }

  /** Escreve um valor já formatado; sem valor, "0,00" e vazio para quem lê. */
  function mostrar(el, texto) {
    el.__vazio = texto === '';
    escreverTela(el, texto === '' ? semValor(el) : texto);
  }

  // O VAZIO QUE TEM SIGNIFICADO PRÓPRIO (16/10/2026). Campo com dica que não
  // é "0,00" — "manter" no Alterar em massa da NF-e, o preço base na tabela de
  // preços — fica vazio, mostrando a dica: ali vazio é "não mexer"/"usar o
  // base", e um "0,00" na tela pareceria zerar o valor.
  function semValor(el) {
    const dica = String(el.getAttribute('placeholder') || '').trim();
    return dica && dica !== ZERO ? '' : ZERO;
  }

  function ativarTodos(raiz) {
    if (!raiz) return;
    if (raiz.matches && raiz.matches(SELETOR)) ativar(raiz);
    if (raiz.querySelectorAll) raiz.querySelectorAll(SELETOR).forEach(ativar);
  }

  /**
   * Reformata o que está na tela, pelos centavos. O cursor fica com os mesmos
   * dígitos à DIREITA dele — o valor cresce para a esquerda, e no fim do campo
   * (o caso de sempre) ele continua no fim.
   */
  function reformatar(el) {
    const bruto = lerTela(el);
    let pos = bruto.length;
    try { pos = el.selectionStart == null ? bruto.length : el.selectionStart; } catch (e) { /* sem seleção */ }
    const aDireita = bruto.slice(pos).replace(/\D/g, '').length;
    // Apagou tudo: volta a ser "não informado", como o campo que nasce vazio.
    el.__vazio = !/\d/.test(bruto);
    const novo = el.__vazio && semValor(el) === '' ? '' : formatarDigitando(bruto, permiteNegativo(el));
    if (novo !== bruto) escreverTela(el, novo);
    let i = novo.length;
    let contados = 0;
    while (i > 0 && contados < aDireita) {
      i -= 1;
      if (/\d/.test(novo[i])) contados += 1;
    }
    try { if (document.activeElement === el) el.setSelectionRange(i, i); } catch (e) { /* sem seleção */ }
    validar(el);
  }

  function ligar(doc) {
    // ENTRAR NO CAMPO SELECIONA O VALOR (14/10/2026). O campo mostra sempre os
    // centavos ("0,00"), aceita no máximo dois, e o clique deixa o cursor no
    // fim: cada dígito digitado ali era descartado e o campo parecia travado
    // (queixa do usuário nos valores dos pagamentos do pedido). Ao entrar, os
    // ",00" saem e o valor fica selecionado — digitar substitui; a saída do
    // campo devolve os centavos (focusout, abaixo).
    // Desde 16/10/2026 os ",00" ficam (a vírgula não sai do lugar): o valor
    // só fica selecionado, e o primeiro dígito o substitui pelos centavos.
    doc.addEventListener('focusin', (evento) => {
      const el = evento.target;
      if (!el || !el.__dinheiro || el.readOnly || el.disabled) return;
      try { el.select(); } catch (e) { /* sem seleção */ }
      // O mouseup do próprio clique desfaria a seleção: ele é ignorado uma vez.
      el.__selecionarNoClique = true;
    }, true);
    doc.addEventListener('mouseup', (evento) => {
      const el = evento.target;
      if (!el || !el.__selecionarNoClique) return;
      el.__selecionarNoClique = false;
      evento.preventDefault();
    }, true);
    doc.addEventListener('keydown', (evento) => {
      if (evento.target && evento.target.__selecionarNoClique) evento.target.__selecionarNoClique = false;
    }, true);

    // A vírgula é fixa (16/10/2026): vírgula e ponto digitados não fazem nada
    // — "1500,50" digitado vira 1.500,50 pelos dígitos, do mesmo jeito.
    doc.addEventListener('beforeinput', (evento) => {
      const el = evento.target;
      if (!el || !el.__dinheiro || evento.inputType !== 'insertText' || !evento.data) return;
      if (evento.data === '.' || evento.data === ',') evento.preventDefault();
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
      // O valor colado é o valor inteiro (16/10/2026): pelos centavos, colar
      // no meio de outro número não tem leitura que faça sentido.
      mostrar(el, formatar(n));
      // A escuta de input reformata pelos dígitos — que já são os do valor.
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, true);

    doc.addEventListener('focusout', (evento) => {
      const el = evento.target;
      if (!el || !el.__dinheiro) return;
      const tela = lerTela(el);
      const completo = el.__vazio ? semValor(el) : (completar(tela) || semValor(el));
      if (completo !== tela) escreverTela(el, completo);
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

  const api = { ZERO, formatarDigitando, paraNumero, formatar, completar, deColagem, textoDoValor, candidato, NAO_E_DINHEIRO, SELETOR };
  if (temDom && nativo && typeof document !== 'undefined' && document.documentElement) ligar(document);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisCampoDinheiro = api;
})(typeof window !== 'undefined' ? window : globalThis);
