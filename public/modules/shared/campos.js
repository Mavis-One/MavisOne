// Telefone, CEP, UF e placa — comportamento ÚNICO, usado por todas as telas.
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// É o mesmo motivo do documento.js, e a varredura de 14/08/2026 mediu o
// estrago: 7 campos de telefone no sistema, TODOS <input type="text"> cru —
// aceitavam "abc", aceitavam 3 dígitos, e o RH gravava "(47) 99999-0000" ao
// lado de "47999990000" como se fossem telefones diferentes. CEP tinha 3
// tratamentos, UF tinha 5 (de campo livre a select com as 27), e placa nenhum.
//
// A regra aqui é a do documento.js, de propósito, para que o usuário aprenda
// UMA vez como o sistema reclama: máscara enquanto digita, validação no BLUR
// (acusar erro no terceiro dígito é ruído), aviso em texto abaixo do campo e
// borda vermelha — nunca um alerta que interrompe.
//
// Carregado ANTES do app.js (ver index.html).
window.MavisCampos = (function () {
  const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');

  const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

  // ---------------------------------------------------------------- TELEFONE
  // Fixo tem 10 dígitos com DDD, celular tem 11. Menos que isso é digitação
  // incompleta; mais, é engano. Não aceitamos número sem DDD: o telefone vai
  // para a NF-e e para o cadastro do cliente, e "99990000" não liga de lugar
  // nenhum.
  function mascararTelefone(valor) {
    const d = soDigitos(valor).slice(0, 11);
    if (d.length <= 2) return d.replace(/^(\d{0,2})/, '($1');
    if (d.length <= 6) return d.replace(/^(\d{2})(\d{0,4})/, '($1) $2');
    if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
  }
  function telefoneValido(valor) {
    const d = soDigitos(valor);
    if (d.length !== 10 && d.length !== 11) return false;
    if (/^(\d)\1+$/.test(d)) return false;              // 00000000000 não é telefone
    if (Number(d.slice(0, 2)) < 11) return false;       // não existe DDD abaixo de 11
    if (d.length === 11 && d[2] !== '9') return false;  // celular brasileiro começa com 9
    return true;
  }

  // --------------------------------------------------------------------- CEP
  function mascararCep(valor) {
    const d = soDigitos(valor).slice(0, 8);
    return d.length > 5 ? d.replace(/^(\d{5})(\d{0,3})/, '$1-$2') : d;
  }
  const cepValido = (valor) => soDigitos(valor).length === 8 && !/^(\d)\1{7}$/.test(soDigitos(valor));

  // ---------------------------------------------------------------------- UF
  const mascararUf = (valor) => String(valor || '').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
  const ufValida = (valor) => UFS.includes(mascararUf(valor));

  // ------------------------------------------------------------------- PLACA
  // Os dois formatos convivem e vão conviver por anos: o antigo AAA0000 e o
  // Mercosul AAA0A00. Recusar o antigo tiraria do sistema a frota que já está
  // na rua.
  const mascararPlaca = (valor) => String(valor || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 7);
  function placaValida(valor) {
    const p = mascararPlaca(valor);
    return /^[A-Z]{3}\d{4}$/.test(p) || /^[A-Z]{3}\d[A-Z]\d{2}$/.test(p);
  }

  // ------------------------------------------------------ só dígitos, N casas
  const soNumeros = (valor, max) => soDigitos(valor).slice(0, max);

  // Cada tipo declara como se comporta. `digitos` liga o teclado numérico do
  // celular; `erro` recebe o que foi digitado e devolve a frase — devolver
  // vazio significa "está certo".
  const TIPOS = {
    telefone: {
      mascara: mascararTelefone, valido: telefoneValido, maxlength: 15, digitos: true,
      placeholder: '(00) 00000-0000',
      erro: (v) => {
        const d = soDigitos(v);
        if (d.length < 10) return `${d.length} dígito(s) — telefone tem 10 com DDD, 11 se for celular.`;
        if (Number(d.slice(0, 2)) < 11) return 'DDD inválido: não existe DDD abaixo de 11.';
        if (d.length === 11 && d[2] !== '9') return 'Celular com 11 dígitos começa com 9 depois do DDD.';
        return 'Telefone inválido.';
      }
    },
    cep: {
      mascara: mascararCep, valido: cepValido, maxlength: 9, digitos: true,
      placeholder: '00000-000',
      erro: (v) => `${soDigitos(v).length} dígito(s) — o CEP tem 8.`
    },
    uf: {
      mascara: mascararUf, valido: ufValida, maxlength: 2, digitos: false,
      placeholder: 'UF',
      erro: (v) => `"${mascararUf(v)}" não é uma UF. Use a sigla de 2 letras (ex.: SC).`
    },
    placa: {
      mascara: mascararPlaca, valido: placaValida, maxlength: 7, digitos: false,
      placeholder: 'AAA0A00',
      erro: () => 'Placa inválida: use AAA0000 (antiga) ou AAA0A00 (Mercosul).'
    },
    ncm: {
      mascara: (v) => soNumeros(v, 8), valido: (v) => soDigitos(v).length === 8, maxlength: 8, digitos: true,
      placeholder: '8 dígitos',
      erro: (v) => `${soDigitos(v).length} dígito(s) — o NCM tem 8.`
    },
    cest: {
      mascara: (v) => soNumeros(v, 7), valido: (v) => soDigitos(v).length === 7, maxlength: 7, digitos: true,
      placeholder: '7 dígitos',
      erro: (v) => `${soDigitos(v).length} dígito(s) — o CEST tem 7.`
    },
    'cnpj-raiz': {
      mascara: (v) => soNumeros(v, 8), valido: (v) => soDigitos(v).length === 8, maxlength: 8, digitos: true,
      placeholder: '8 dígitos',
      erro: (v) => `${soDigitos(v).length} dígito(s) — a raiz do CNPJ tem 8 (o CNPJ sem a filial e sem os verificadores).`
    }
  };

  /**
   * Liga um <input> ao comportamento do tipo.
   *
   * `obrigatorio` decide se vazio é erro. Campo opcional em vermelho treina o
   * usuário a ignorar o vermelho — mesma regra do documento.js.
   */
  function ligar(input, tipoNome, { obrigatorio = false } = {}) {
    const tipo = TIPOS[tipoNome];
    if (!input || !tipo || input.dataset.campoLigado === '1') return;
    input.dataset.campoLigado = '1';

    if (tipo.digitos) input.setAttribute('inputmode', 'numeric');
    input.setAttribute('maxlength', String(tipo.maxlength));
    input.setAttribute('autocomplete', 'off');
    if (!input.getAttribute('placeholder')) input.setAttribute('placeholder', tipo.placeholder);
    // Valor vindo do banco costuma estar sem máscara.
    if (input.value) input.value = tipo.mascara(input.value);

    const caixa = () => input.closest('label') || input.parentElement;
    const limparAviso = () => caixa()?.querySelector('.campo-erro')?.remove();

    input.addEventListener('input', () => {
      const posicaoNoFim = input.selectionStart === input.value.length;
      input.value = tipo.mascara(input.value);
      // Digitar no meio de um campo mascarado joga o cursor para o fim se a
      // gente reposicionar sempre; só forçamos quando ele JÁ estava no fim.
      if (posicaoNoFim) input.setSelectionRange(input.value.length, input.value.length);
      input.classList.remove('campo-invalido');
      limparAviso();
    });

    input.addEventListener('blur', () => {
      const vazio = String(input.value || '').trim() === '';
      const ok = vazio ? !obrigatorio : tipo.valido(input.value);
      input.classList.toggle('campo-invalido', !ok);
      limparAviso();
      if (!ok && caixa()) {
        const span = document.createElement('span');
        span.className = 'campo-erro';
        span.textContent = vazio ? 'Preencha este campo.' : tipo.erro(input.value);
        caixa().appendChild(span);
      }
    });
  }

  /**
   * Liga todos os campos marcados com data-campo dentro de um container.
   * Seguro chamar de novo: `ligar` ignora input já ligado.
   */
  function ligarTodos(raiz) {
    const escopo = raiz || document;
    escopo.querySelectorAll('[data-campo]').forEach((input) => {
      ligar(input, input.dataset.campo, { obrigatorio: input.hasAttribute('required') });
    });
    // O documento tem módulo próprio, mas quem chama quer "ligue os campos
    // desta tela" — ter de lembrar dos dois é exatamente como um deles fica
    // para trás.
    window.MavisDocumento?.ligarTodos(escopo);
  }

  /**
   * Liga sozinho tudo que entrar no DOM.
   *
   * Sem isto, cada tela precisaria lembrar de chamar ligarTodos depois de cada
   * render — e várias re-renderizam por conta própria (trocar de aba, salvar um
   * item da lista, abrir um formulário embutido). Foi assim que os 7 campos de
   * telefone ficaram crus: ninguém era contra validá-los, só não havia um lugar
   * que garantisse a chamada.
   *
   * Idempotente e barato: o observador só varre o que foi inserido, e `ligar`
   * ignora campo já ligado.
   */
  function observar(alvo) {
    const raiz = alvo || document.body;
    if (!raiz || raiz.dataset?.camposObservados === '1') return;
    if (raiz.dataset) raiz.dataset.camposObservados = '1';
    ligarTodos(raiz);
    new MutationObserver((mutacoes) => {
      for (const m of mutacoes) {
        for (const no of m.addedNodes) {
          if (no.nodeType !== 1) continue;
          if (no.matches?.('[data-campo], [data-documento]')) ligarTodos(no.parentElement || raiz);
          else if (no.querySelector?.('[data-campo], [data-documento]')) ligarTodos(no);
        }
      }
    }).observe(raiz, { childList: true, subtree: true });
  }

  const api = {
    soDigitos, UFS,
    mascararTelefone, telefoneValido,
    mascararCep, cepValido,
    mascararUf, ufValida,
    mascararPlaca, placaValida,
    TIPOS, ligar, ligarTodos, observar
  };

  // Liga sozinho, aqui dentro, e NÃO a partir de quem carrega este arquivo.
  //
  // A primeira versão chamava observar() lá do router.js, que o index.html
  // carrega ANTES deste arquivo: `window.MavisCampos?.observar(...)` encontrava
  // undefined, o `?.` engolia a chamada sem erro nenhum e nada ficava ligado.
  // O sintoma era o pior possível — telefone continuava aceitando letras, o
  // teste de fonte passava (o campo ESTAVA marcado) e só o navegador acusava.
  //
  // Aqui não há essa dependência: o arquivo que define é o mesmo que liga, e
  // espera o DOM existir antes de observar o body.
  if (typeof document !== 'undefined') {
    const iniciar = () => api.observar(document.body);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
  }

  return api;
})();
