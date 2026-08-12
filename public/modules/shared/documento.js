// CPF e CNPJ — implementação ÚNICA, usada por todas as telas.
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// A máscara e a validação de documento moravam dentro do app.js e só a tela de
// Cadastro de Pessoas as usava. Todo o resto do sistema — colaborador no RH,
// destinatário da NF-e, titular da conta bancária, estabelecimento no Fiscal,
// atalho de Novo Cliente — tinha um <input> cru: aceitava letras, aceitava
// CPF de 9 dígitos, e gravava "12345678901" ao lado de "123.456.789-01" como
// se fossem documentos diferentes.
//
// Copiar a função para cada tela resolveria hoje e divergiria na primeira
// correção feita só de um lado. Então a implementação é esta, e o app.js
// delega para cá em vez de manter a sua.
//
// Carregado ANTES do app.js (ver index.html), porque é ele quem delega.
window.MavisDocumento = (function () {
  const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');

  // Formata para exibição: 000.000.000-00 ou 00.000.000/0000-00. Decide pelo
  // tamanho, então serve para os dois sem perguntar qual é.
  function formatar(valor) {
    const digitos = soDigitos(valor).slice(0, 14);
    if (digitos.length <= 11) {
      return digitos
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }
    return digitos
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  /**
   * Máscara enquanto se digita.
   *
   * `tipo` limita o tamanho: 'cnpj' (ou 'pessoa-juridica') corta em 14, 'cpf'
   * corta em 11. Sem tipo, quem manda é o que já foi digitado — passou de 11,
   * vira CNPJ. É o que permite um campo só aceitar os dois.
   */
  function mascarar(valor, tipo = '') {
    const digitos = soDigitos(valor);
    const ehCnpj = tipo === 'cnpj' || tipo === 'pessoa-juridica' || digitos.length > 11;
    const soCpf = tipo === 'cpf' || tipo === 'pessoa-fisica';
    if (soCpf) return formatar(digitos.slice(0, 11));
    return formatar(digitos.slice(0, ehCnpj ? 14 : 11));
  }

  function tipoDe(valor) {
    const digitos = soDigitos(valor);
    if (digitos.length === 11) return 'cpf';
    if (digitos.length === 14) return 'cnpj';
    return '';
  }

  function validoCpf(valor) {
    const limpo = soDigitos(valor);
    // Sequência repetida passa no cálculo dos dígitos, mas não é CPF: 111.111.111-11
    // é o erro de digitação mais comum e a SEFAZ recusa.
    if (limpo.length !== 11 || /^(\d)\1{10}$/.test(limpo)) return false;
    const digito = (base, fator) => {
      const total = base.split('').reduce((soma, d) => soma + Number(d) * fator--, 0);
      const resto = total % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    const d1 = digito(limpo.slice(0, 9), 10);
    const d2 = digito(limpo.slice(0, 10), 11);
    return limpo === `${limpo.slice(0, 9)}${d1}${d2}`;
  }

  function validoCnpj(valor) {
    const limpo = soDigitos(valor);
    if (limpo.length !== 14 || /^(\d)\1{13}$/.test(limpo)) return false;
    const digito = (base, pesos) => {
      const total = base.split('').reduce((soma, d, i) => soma + Number(d) * pesos[i], 0);
      const resto = total % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    const d1 = digito(limpo.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = digito(limpo.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return limpo === `${limpo.slice(0, 12)}${d1}${d2}`;
  }

  function valido(valor) {
    const digitos = soDigitos(valor);
    if (digitos.length === 11) return validoCpf(digitos);
    if (digitos.length === 14) return validoCnpj(digitos);
    return false;
  }

  /**
   * Liga um <input> ao comportamento completo.
   *
   * `tipo` pode ser 'cpf', 'cnpj' ou vazio (aceita os dois).
   * `obrigatorio` decide se vazio é erro — em muitos cadastros o documento é
   * opcional, e marcar em vermelho um campo que ninguém precisa preencher
   * treina o usuário a ignorar o vermelho.
   *
   * A validação roda no BLUR, não a cada tecla: acusar "CPF inválido" no
   * terceiro dígito é ruído, porque ainda vai ficar inválido por mais oito.
   */
  function ligar(input, { tipo = '', obrigatorio = false, tipoGetter = null } = {}) {
    if (!input || input.dataset.documentoLigado === '1') return;
    input.dataset.documentoLigado = '1';

    // Na tela de Cadastro de Pessoas o tipo vem de um select que o usuário
    // troca (física/jurídica), então precisa ser lido na hora, não fixado aqui.
    const tipoAtual = () => (tipoGetter ? tipoGetter() : tipo) || '';

    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('maxlength', tipo === 'cpf' ? '14' : '18');
    if (!input.getAttribute('placeholder')) {
      input.setAttribute('placeholder', tipo === 'cpf' ? '000.000.000-00' : tipo === 'cnpj' ? '00.000.000/0000-00' : 'CPF ou CNPJ');
    }
    // Valor que já veio do banco costuma estar sem máscara.
    if (input.value) input.value = mascarar(input.value, tipoAtual());

    // O aviso vai para o <label>, não para o wrapper da lupa: dentro dele
    // o texto empurraria a lupa para baixo do campo.
    const caixaDoAviso = () => input.closest('label') || input.parentElement;

    input.addEventListener('input', () => {
      input.value = mascarar(input.value, tipoAtual());
      // Enquanto corrige, o vermelho sai — senão fica aceso enquanto a pessoa
      // ainda está digitando o que vai deixá-lo válido.
      input.classList.remove('documento-invalido');
      const aviso = caixaDoAviso()?.querySelector('.documento-erro');
      if (aviso) aviso.remove();
    });

    input.addEventListener('blur', () => {
      const digitos = soDigitos(input.value);
      const vazio = digitos.length === 0;
      const ok = vazio ? !obrigatorio : valido(digitos);
      input.classList.toggle('documento-invalido', !ok);
      const anterior = caixaDoAviso()?.querySelector('.documento-erro');
      if (anterior) anterior.remove();
      if (!ok && caixaDoAviso()) {
        const span = document.createElement('span');
        span.className = 'documento-erro';
        const soAceitaCpf = tipoAtual() === 'cpf' || tipoAtual() === 'pessoa-fisica';
        const soAceitaCnpj = tipoAtual() === 'cnpj' || tipoAtual() === 'pessoa-juridica';
        const esperado = soAceitaCpf ? 'CPF tem 11 dígitos' : soAceitaCnpj ? 'CNPJ tem 14 dígitos' : 'CPF tem 11 e CNPJ tem 14';
        span.textContent = vazio
          ? 'Informe o documento.'
          : digitos.length !== 11 && digitos.length !== 14
            ? `${digitos.length} dígito(s) — ${esperado}.`
            : `${tipoDe(digitos) === 'cpf' ? 'CPF' : 'CNPJ'} inválido: os dígitos verificadores não conferem.`;
        caixaDoAviso().appendChild(span);
      }
    });
  }

  /**
   * Liga todos os campos marcados com data-documento dentro de um container.
   *
   * Chamar depois de desenhar a tela. É seguro chamar de novo: `ligar` ignora
   * input já ligado, então re-render não empilha listeners.
   */
  function ligarTodos(raiz) {
    const escopo = raiz || document;
    escopo.querySelectorAll('[data-documento]').forEach((input) => {
      ligar(input, {
        tipo: input.dataset.documento || '',
        obrigatorio: input.hasAttribute('required')
      });
    });
  }

  // O e-mail e o telefone vêm da Receita em dois formatos diferentes conforme
  // o provedor: uma lista de contatos, ou campos soltos no payload cru.
  function contatoOficial(oficial, tipos, camposCrus) {
    const contatos = Array.isArray(oficial?.contatos) ? oficial.contatos : [];
    const daLista = contatos.find((c) => tipos.includes(String(c?.type || '').toLowerCase()))?.value;
    const doCru = camposCrus.map((campo) => oficial?.raw?.[campo]).find(Boolean);
    return String(daLista || doCru || '').trim();
  }

  // Consulta oficial pelo CNPJ. Devolve os campos já com nomes de negócio —
  // cada tela mapeia para os seus, que têm nomes diferentes em cada módulo.
  async function consultarCnpj(api, valor) {
    const digitos = soDigitos(valor);
    if (digitos.length !== 14) throw new Error('Informe um CNPJ com 14 dígitos para consultar.');
    if (!validoCnpj(digitos)) throw new Error('CNPJ inválido: os dígitos verificadores não conferem.');
    const resposta = await api(`/api/cnpj/${digitos}`);
    const oficial = resposta.officialData || {};
    const endereco = oficial.endereco || {};
    return {
      documento: digitos,
      razaoSocial: oficial.razaoSocial || '',
      nomeFantasia: oficial.nomeFantasia || '',
      enderecoCompleto: oficial.enderecoCompleto || '',
      logradouro: endereco.logradouro || '',
      numero: endereco.numero || '',
      complemento: endereco.complemento || '',
      bairro: endereco.bairro || '',
      municipio: endereco.cidade || '',
      uf: endereco.estado || '',
      cep: endereco.cep || '',
      // SÓ de codigo_municipio_ibge. A BrasilAPI devolve TAMBÉM um
      // `codigo_municipio`, que é o código SIAFI/TOM — para Brasília ele vale
      // 9701 e o IBGE vale 5300108. É o IBGE que vai na NF-e; trocar os dois
      // faz a SEFAZ rejeitar a nota por município inválido.
      codigoMunicipioIbge: String(oficial?.raw?.codigo_municipio_ibge || ''),
      email: contatoOficial(oficial, ['email'], ['email']),
      telefone: contatoOficial(oficial, ['phone', 'telefone', 'celular'], ['ddd_telefone_1', 'ddd_telefone_2', 'ddd_fax']),
      situacaoCadastral: oficial.situacaoCadastral || '',
      cnaePrincipal: oficial.cnaePrincipal || '',
      bruto: oficial
    };
  }

  /**
   * Liga a consulta de CNPJ a um campo de documento.
   *
   * Coloca a lupa ao lado (mesma da tela de Cadastro de Pessoas) e dispara
   * sozinho ao sair do campo com um CNPJ válido — foi o que faltou: digitar o
   * CNPJ e nada acontecer não avisa que existe uma consulta.
   *
   * `aoEncontrar(dados)` recebe os campos já normalizados; quem preenche é a
   * tela, porque o nome de cada campo muda de módulo para módulo.
   *
   * `devePreencherSozinho()` existe para NÃO sobrescrever o que a pessoa já
   * digitou: a busca automática só roda enquanto o formulário está em branco.
   * Pela lupa, roda sempre — aí o pedido foi explícito.
   */
  function ligarConsultaCnpj(input, { api, showToast, aoEncontrar, devePreencherSozinho } = {}) {
    if (!input || !api || input.dataset.consultaCnpjLigada === '1') return;
    input.dataset.consultaCnpjLigada = '1';

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'documento-lupa';
    botao.title = 'Consultar CNPJ na Receita';
    botao.setAttribute('aria-label', 'Consultar CNPJ na Receita');
    botao.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';

    // Envolve SÓ o input. Posicionar a lupa em relação ao <label> a deixaria
    // torta: o label inclui o texto do rótulo acima do campo, e ainda cresce
    // quando o aviso de documento inválido aparece embaixo.
    const caixa = document.createElement('div');
    caixa.className = 'documento-com-lupa';
    input.insertAdjacentElement('beforebegin', caixa);
    caixa.appendChild(input);
    caixa.appendChild(botao);

    const atualizarBotao = () => {
      botao.disabled = soDigitos(input.value).length !== 14;
    };
    atualizarBotao();
    input.addEventListener('input', atualizarBotao);

    let consultando = false;
    async function consultar({ automatica }) {
      if (consultando) return;
      const digitos = soDigitos(input.value);
      if (digitos.length !== 14 || !validoCnpj(digitos)) {
        if (!automatica) showToast?.('Informe um CNPJ válido de 14 dígitos para consultar.', 'warning');
        return;
      }
      if (automatica && devePreencherSozinho && !devePreencherSozinho()) return;

      consultando = true;
      botao.disabled = true;
      botao.classList.add('is-carregando');
      try {
        const dados = await consultarCnpj(api, digitos);
        aoEncontrar?.(dados);
        showToast?.(`Dados de ${dados.razaoSocial || 'CNPJ'} carregados.`, 'success');
      } catch (erro) {
        // Falha de consulta não invalida o CNPJ digitado: a Receita cai, o
        // limite da API estoura, e o documento continua certo.
        showToast?.(erro.message || 'Não foi possível consultar o CNPJ.', 'error');
      } finally {
        consultando = false;
        botao.classList.remove('is-carregando');
        atualizarBotao();
      }
    }

    botao.addEventListener('click', () => consultar({ automatica: false }));
    // Sair do campo com CNPJ válido busca sozinho — é o comportamento que se
    // espera ao colar um CNPJ e passar para o próximo campo.
    input.addEventListener('blur', () => {
      setTimeout(() => consultar({ automatica: true }), 60);
    });
  }

  return {
    soDigitos, formatar, mascarar, tipoDe,
    valido, validoCpf, validoCnpj,
    ligar, ligarTodos, consultarCnpj, ligarConsultaCnpj
  };
})();
