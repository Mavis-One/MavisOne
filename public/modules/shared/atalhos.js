// Botão "Atalhos" da barra superior.
//
// PARA QUE SERVE
// --------------
// Cadastrar um cliente no meio de um pedido hoje custa: sair da venda, abrir
// Cadastros, preencher a ficha inteira, voltar, reabrir o pedido, refazer o que
// já estava digitado. O atalho corta isso — a janela flutuante grava o mínimo
// necessário e devolve a pessoa para a tela em que ela estava.
//
// DUAS CATEGORIAS, DE PROPÓSITO DIFERENTE
//
//   CRIAR (destacado, com ícone) — abre janela flutuante SEM sair da tela.
//   São formulários curtos: só o que a lei ou o sistema exigem para o registro
//   existir. O resto se completa depois, na tela cheia do cadastro.
//
//   IR PARA (texto simples) — navega. Não tem por que abrir em janela: são
//   listas, e lista em modal fica apertada.
//
// O QUE O ATALHO NÃO FAZ: cadastro completo. Um cliente criado aqui nasce com
// documento, nome e contato; endereço de entrega, condição de pagamento e
// limite de crédito continuam na tela de Cadastros. Tentar caber tudo aqui
// transformaria o atalho na mesma tela de que ele existe para fugir.
window.MavisAtalhos = (function () {
  const ICONES = {
    cliente: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    fornecedor: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"></rect><path d="M16 8h4l3 3v5h-7Z"></path><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>',
    produto: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
    lancamento: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>'
  };

  const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

  const soDigitos = (v) => String(v || '').replace(/\D/g, '');
  const hoje = () => new Date().toISOString().slice(0, 10);

  // Campos das janelas. `linha` agrupa os campos numa mesma faixa do formulário.
  const CAMPOS_PESSOA = [
    // documento: true liga a máscara e a validação de CPF/CNPJ na janela,
    // as mesmas do Cadastro de Pessoas. O "só números" saiu do hint porque o
    // campo agora formata sozinho.
    { name: 'document', label: 'CPF / CNPJ', required: true, linha: 1, documento: true },
    { name: 'name', label: 'Nome', required: true, linha: 1 },
    { name: 'email', label: 'E-mail', type: 'email', linha: 2 },
    { name: 'phone', label: 'Telefone', linha: 2, mascara: 'telefone' },
    // O ENDEREÇO COM OS NOMES DO CADASTRO (07/10/2026). A janela mandava
    // `address`, `number` e `complement`, e o cadastro de pessoas, o pedido e a
    // NF-e leem `street`, `streetNumber` e `addressComplement` (é o que as 6.492
    // pessoas da base têm). O número digitado aqui ia para uma chave que
    // ninguém lia: o cliente nascia sem número, e a nota dele travava depois.
    //
    // Obrigatório porque a nota não sai sem endereço — o servidor já recusava
    // sem logradouro, cidade, UF e CEP; número e bairro a NF-e também exige.
    // O CEP preenche o resto (ver ligarConsultaCep).
    { name: 'zipCode', label: 'CEP', required: true, linha: 3, mascara: 'cep' },
    { name: 'street', label: 'Logradouro', required: true, linha: 3 },
    { name: 'streetNumber', label: 'Número', required: true, linha: 3 },
    { name: 'addressComplement', label: 'Complemento', linha: 4 },
    { name: 'neighborhood', label: 'Bairro', required: true, linha: 4 },
    { name: 'city', label: 'Cidade', required: true, linha: 4 },
    // Começa vazio: com "AC" marcado de saída, quem não reparava gravava o
    // cliente no Acre.
    { name: 'state', label: 'UF', type: 'select', opcoes: UFS, vazio: 'UF', required: true, linha: 4 },
    // O código IBGE da cidade vem do CEP ou do CNPJ e é o que a NF-e usa para o
    // município; ninguém o digita.
    { name: 'ibgeCityCode', type: 'hidden', linha: 4 }
  ];

  // O CLIENTE PEDE A INSCRIÇÃO ESTADUAL, E PEDE OBRIGATÓRIA.
  //
  // É ela que decide, na hora de emitir a NF-e, se o destinatário é
  // contribuinte de ICMS — e com isso o indicador de IE e o DIFAL. Cliente
  // cadastrado sem a resposta é nota que trava na emissão, longe de quem
  // cadastrou. "ISENTO" é a resposta de quem não é contribuinte (pessoa
  // física, quase sempre); o que conta como contribuinte é a regra de
  // shared/inscricao_estadual.js, a mesma do servidor.
  //
  // Só o cliente: o fornecedor criado à mão continua como estava, e o que
  // entra por XML já traz a IE do emitente.
  //
  // SÓ PARA CNPJ (07/10/2026). Pessoa física não tem I.E.: o campo fica travado
  // até o documento ser um CNPJ, e com CPF vai vazio — que, pela regra de
  // shared/inscricao_estadual.js, é "não contribuinte", o indicador 9 que a
  // nota de pessoa física leva. `soCnpj` é o que a janela usa para isso.
  const CAMPO_IE = {
    name: 'stateRegistration', label: 'Inscrição Estadual (I.E.)', required: true, soCnpj: true, linha: 1,
    ie: true, placeholder: 'Números ou ISENTO', hint: 'Só para CNPJ. ISENTO quando a empresa não é contribuinte de ICMS'
  };
  // O cliente também exige telefone (pedido da loja em 07/10/2026): é por ele
  // que se fala com quem comprou.
  const CAMPOS_CLIENTE = CAMPOS_PESSOA.flatMap((campo) => {
    if (campo.name === 'name') return [campo, CAMPO_IE];
    if (campo.name === 'phone') return [{ ...campo, required: true }];
    return [campo];
  });

  const ATALHOS_CRIAR = [
    {
      id: 'novo_cliente', label: 'Novo Cliente', icone: ICONES.cliente, modulo: 'cadastros',
      titulo: 'Cliente', endpoint: '/api/cadastros/pessoas', campos: CAMPOS_CLIENTE,
      consultaCnpj: true,
      // O papel é o que separa cliente de fornecedor na mesma tabela de pessoas.
      extras: { roles: ['Cliente'], status: 'ativo' },
      sucesso: (r) => `Cliente "${r.person?.name || ''}" cadastrado.`
    },
    {
      id: 'novo_fornecedor', label: 'Novo Fornecedor', icone: ICONES.fornecedor, modulo: 'cadastros',
      titulo: 'Fornecedor', endpoint: '/api/cadastros/pessoas', campos: CAMPOS_PESSOA,
      consultaCnpj: true,
      extras: { roles: ['Fornecedor'], status: 'ativo' },
      sucesso: (r) => `Fornecedor "${r.person?.name || ''}" cadastrado.`
    },
    {
      id: 'novo_produto', label: 'Novo Produto', icone: ICONES.produto, modulo: 'stock',
      titulo: 'Produto', endpoint: '/api/stock/products',
      campos: [
        { name: 'name', label: 'Nome do produto', required: true, linha: 1 },
        { name: 'sku', label: 'SKU', required: true, linha: 1 },
        { name: 'unit', label: 'Unidade', valor: 'UN', linha: 1 },
        { name: 'costPrice', label: 'Custo (R$)', type: 'number', step: '0.01', min: 0, valor: '0', linha: 2 },
        { name: 'salePrice', label: 'Preço de venda (R$)', type: 'number', step: '0.01', min: 0, valor: '0', linha: 2 },
        // NCM e origem entram aqui porque sem eles a emissão de NF-e para com
        // "Nenhuma regra fiscal encontrada" — e descobrir isso na hora de
        // emitir é tarde demais.
        { name: 'ncm', label: 'NCM', linha: 3, hint: '8 dígitos — exigido para emitir NF-e', mascara: 'ncm' },
        { name: 'origem', label: 'Origem', type: 'select', valor: '0', linha: 3,
          opcoes: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
          rotulos: { 0: '0 — Nacional', 1: '1 — Importação direta', 2: '2 — Mercado interno', 3: '3 — Nacional > 40% importado', 4: '4 — Processos básicos', 5: '5 — Nacional <= 40% importado', 6: '6 — Importada sem similar', 7: '7 — Mercado interno sem similar', 8: '8 — Nacional > 70% importado' } }
      ],
      extras: { status: 'ativo', stockQuantity: 0 },
      sucesso: () => 'Produto cadastrado.'
    },
    {
      id: 'novo_lancamento', label: 'Novo Lançamento', icone: ICONES.lancamento, modulo: 'finance',
      titulo: 'Lançamento', endpoint: '/api/finance/entries',
      campos: [
        { name: 'type', label: 'Tipo', type: 'select', valor: 'DESPESA', linha: 1,
          opcoes: ['DESPESA', 'RECEITA'], rotulos: { DESPESA: 'Despesa', RECEITA: 'Receita' } },
        { name: 'description', label: 'Descrição', required: true, linha: 1 },
        { name: 'amount', label: 'Valor (R$)', type: 'number', step: '0.01', min: 0, required: true, linha: 2 },
        { name: 'date', label: 'Data', type: 'date', valorHoje: true, linha: 2 },
        { name: 'dueDate', label: 'Vencimento', type: 'date', valorHoje: true, linha: 2 },
        { name: 'document', label: 'Documento', linha: 3, hint: 'Nota, boleto, recibo' },
        { name: 'note', label: 'Observação', type: 'textarea', linha: 4 }
      ],
      extras: {},
      sucesso: () => 'Lançamento registrado.'
    }
  ];

  // Navegação. Sem janela flutuante: lista em modal fica apertada, e o usuário
  // quer justamente sair para aquela tela.
  const ATALHOS_IR = [
    { label: 'Listagem de NF-e Emitidas', modulo: 'finance', sub: 'nfe_emitidas' },
    { label: 'Novo Pedido', modulo: 'sales', sub: 'new_sale' },
    { label: 'Listagem de Pedidos e Orçamentos', modulo: 'sales', sub: 'orders_quotes' },
    { label: 'Listagem de Produtos', modulo: 'stock', sub: 'products' },
    { label: 'Listagem de Movimentações', modulo: 'stock', sub: 'movements' }
  ];

  // O atalho só aparece para quem pode usá-lo. Mostrar e receber "Sem permissão"
  // ao clicar seria pior do que não mostrar.
  const permitidos = (temAcesso) => ({
    criar: ATALHOS_CRIAR.filter((a) => temAcesso(a.modulo)),
    ir: ATALHOS_IR.filter((a) => temAcesso(a.modulo))
  });

  function campoHtml(campo, escapeHtml) {
    const valor = campo.valorHoje ? hoje() : (campo.valor ?? '');
    const obrigatorio = campo.required ? 'required' : '';
    const dica = campo.hint ? ` title="${escapeHtml(campo.hint)}"` : '';
    let controle;
    if (campo.type === 'hidden') {
      return `<input type="hidden" name="${campo.name}" value="${escapeHtml(valor)}" />`;
    }
    if (campo.type === 'select') {
      const opcaoVazia = campo.vazio ? `<option value="">${escapeHtml(campo.vazio)}</option>` : '';
      controle = `<select name="${campo.name}" ${obrigatorio}>${opcaoVazia}${campo.opcoes.map((o) => {
        const rotulo = campo.rotulos ? (campo.rotulos[o] ?? o) : o;
        return `<option value="${escapeHtml(o)}" ${String(valor) === String(o) ? 'selected' : ''}>${escapeHtml(rotulo)}</option>`;
      }).join('')}</select>`;
    } else if (campo.type === 'textarea') {
      controle = `<textarea name="${campo.name}" rows="2"></textarea>`;
    } else {
      const passo = campo.step ? `step="${campo.step}"` : '';
      const min = campo.min !== undefined ? `min="${campo.min}"` : '';
      const doc = campo.documento ? `data-documento="${campo.documento === true ? '' : campo.documento}"` : '';
      // Mesmo nome das outras duas fábricas (Estoque e Cadastros).
      const mascara = campo.mascara ? `data-campo="${campo.mascara}"` : '';
      const exemplo = campo.placeholder ? `placeholder="${escapeHtml(campo.placeholder)}"` : '';
      controle = `<input type="${campo.type || 'text'}" name="${campo.name}" value="${escapeHtml(valor)}" ${passo} ${min} ${doc} ${mascara} ${exemplo} ${obrigatorio} />`;
    }
    return `
      <label class="atalho-campo"${dica}>
        <span>${escapeHtml(campo.label)}${campo.required ? ' *' : ''}</span>
        ${controle}
      </label>`;
  }

  // Preenche só o que está vazio: o que a pessoa digitou vale mais do que o
  // cadastro da Receita ou dos Correios. Dispara `input` para a máscara do campo
  // (telefone, CEP) formatar o que chegou cru da consulta.
  function preencherSeVazio(raiz) {
    return (nome, valor) => {
      const campo = raiz.querySelector(`[name="${nome}"]`);
      if (!campo || !valor || String(campo.value || '').trim()) return;
      if (campo.tagName === 'SELECT' && ![...campo.options].some((o) => o.value === valor)) return;
      campo.value = valor;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    };
  }

  // CEP -> endereço (07/10/2026). A janela pedia o CEP e não fazia nada com ele;
  // o cadastro completo já consultava. Com 8 dígitos, ao completar a digitação
  // ou ao sair do campo, busca pela mesma rota /api/cep e preenche logradouro,
  // bairro, cidade, UF e o código IBGE. O número fica com a pessoa: o CEP não o
  // tem.
  function ligarConsultaCep(raiz, api, showToast) {
    const cep = raiz.querySelector('[name="zipCode"]');
    if (!cep) return;
    let ultimo = '';
    const consultar = async () => {
      const digitos = soDigitos(cep.value);
      if (digitos.length !== 8 || digitos === ultimo) return;
      ultimo = digitos;
      try {
        const resposta = await api(`/api/cep/${digitos}`);
        const e = resposta.address || {};
        const preencher = preencherSeVazio(raiz);
        preencher('street', e.street);
        preencher('neighborhood', e.neighborhood);
        preencher('city', e.city);
        preencher('state', e.state);
        preencher('ibgeCityCode', e.ibgeCityCode);
        raiz.querySelector('[name="streetNumber"]')?.focus();
      } catch (erro) {
        ultimo = '';
        showToast?.(erro.message || 'Não foi possível consultar o CEP.', 'warning');
      }
    };
    cep.addEventListener('blur', consultar);
    cep.addEventListener('input', () => { if (soDigitos(cep.value).length === 8) consultar(); });
  }

  // A I.E. só abre quando o documento é um CNPJ (14 dígitos); com CPF fica
  // travada e vazia. Ver CAMPO_IE.
  function ligarIeSoParaCnpj(raiz) {
    const doc = raiz.querySelector('[name="document"]');
    const ie = raiz.querySelector('[name="stateRegistration"]');
    if (!doc || !ie) return;
    const atualizar = () => {
      const ehCnpj = soDigitos(doc.value).length === 14;
      ie.disabled = !ehCnpj;
      ie.required = ehCnpj;
      if (!ehCnpj) ie.value = '';
      ie.placeholder = ehCnpj ? 'Números ou ISENTO' : 'Só para CNPJ';
    };
    doc.addEventListener('input', atualizar);
    atualizar();
  }

  function fechar() {
    document.getElementById('atalhoModal')?.remove();
    document.removeEventListener('keydown', aoTeclar);
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') fechar();
  }

  function abrirJanela(atalho, ctx) {
    const { api, showToast, escapeHtml } = ctx;
    fechar();

    // Agrupa os campos por `linha` para o formulário não virar uma coluna só.
    const linhas = [];
    atalho.campos.forEach((campo) => {
      const indice = campo.linha || 1;
      (linhas[indice] = linhas[indice] || []).push(campo);
    });

    const overlay = document.createElement('div');
    overlay.id = 'atalhoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg atalho-modal" role="dialog" aria-modal="true" aria-label="Novo ${escapeHtml(atalho.titulo)}">
        <div class="atalho-modal-head">
          <span class="atalho-modal-icone">${atalho.icone}</span>
          <div>
            <p class="muted">NOVO</p>
            <h3>${escapeHtml(atalho.titulo)}</h3>
          </div>
          <button type="button" class="icon-btn atalho-fechar" id="atalhoFechar" title="Fechar" aria-label="Fechar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>
          </button>
        </div>
        <form id="atalhoForm" class="atalho-form">
          ${linhas.filter(Boolean).map((campos) => `
            <div class="atalho-linha">${campos.map((campo) => campoHtml(campo, escapeHtml)).join('')}</div>
          `).join('')}
          <p class="atalho-erro" id="atalhoErro" hidden></p>
          <div class="atalho-acoes">
            <button type="button" class="secondary" id="atalhoCancelar">Cancelar</button>
            <button type="submit">Cadastrar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    // Clique no fundo fecha; clique dentro do formulário, não.
    overlay.addEventListener('click', (evento) => { if (evento.target === overlay) fechar(); });
    document.addEventListener('keydown', aoTeclar);
    document.getElementById('atalhoFechar')?.addEventListener('click', fechar);
    document.getElementById('atalhoCancelar')?.addEventListener('click', fechar);
    window.MavisDocumento?.ligarTodos(overlay);

    // Consulta de CNPJ na Receita, igual à do Cadastro de Pessoas: preenche
    // razão social, contato e endereço. É o que torna o atalho de fato um
    // atalho — sem isso, cadastrar uma empresa aqui é digitar tudo à mão.
    const campoDoc = overlay.querySelector('[data-documento]');
    if (campoDoc && atalho.consultaCnpj) {
      const preencher = preencherSeVazio(overlay);
      window.MavisDocumento.ligarConsultaCnpj(campoDoc, {
        api,
        showToast,
        // Só busca sozinho enquanto o formulário está em branco; pela lupa,
        // busca sempre.
        devePreencherSozinho: () => !String(overlay.querySelector('[name="name"]')?.value || '').trim(),
        aoEncontrar: (dados) => {
          preencher('name', dados.razaoSocial || dados.nomeFantasia);
          preencher('email', dados.email);
          preencher('phone', dados.telefone);
          preencher('zipCode', dados.cep);
          preencher('street', dados.logradouro);
          preencher('streetNumber', dados.numero);
          preencher('addressComplement', dados.complemento);
          preencher('neighborhood', dados.bairro);
          preencher('city', dados.municipio);
          preencher('ibgeCityCode', dados.codigoMunicipioIbge);
          const uf = overlay.querySelector('[name="state"]');
          // O UF é um <select>: só troca se a sigla existir na lista.
          if (uf && dados.uf && [...uf.options].some((o) => o.value === dados.uf)) uf.value = dados.uf;
        }
      });
    }

    ligarConsultaCep(overlay, api, showToast);
    ligarIeSoParaCnpj(overlay);

    overlay.querySelector('input, select')?.focus();

    document.getElementById('atalhoForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const botao = evento.target.querySelector('button[type="submit"]');
      if (botao.disabled) return;
      const erroEl = document.getElementById('atalhoErro');
      erroEl.hidden = true;

      const dados = new FormData(evento.target);
      const payload = { ...atalho.extras };
      // Erro ao lado do campo, antes de mandar, para o que a janela declara
      // obrigatório: o `required` do navegador barra o vazio, mas deixa passar
      // o espaço em branco — e a I.E. tem forma (números ou ISENTO). O que a
      // ROTA exige além disso (endereço, cidade, UF, CEP) continua vindo como
      // 400 do servidor, como sempre veio: a janela não marca esses campos.
      const recusar = (campo, mensagem) => {
        erroEl.hidden = false;
        erroEl.textContent = mensagem;
        overlay.querySelector(`[name="${campo.name}"]`)?.focus();
      };
      for (const campo of atalho.campos) {
        let valor = dados.get(campo.name) ?? '';
        if (campo.name === 'document') valor = soDigitos(valor);
        // I.E. de CPF não existe: vai vazia e não é cobrada (ver CAMPO_IE).
        if (campo.soCnpj && soDigitos(dados.get('document')).length !== 14) {
          payload[campo.name] = '';
          continue;
        }
        if (campo.required && !String(valor).trim()) return recusar(campo, `Informe ${campo.label}.`);
        if (campo.ie) {
          // Regra de shared/inscricao_estadual.js — a mesma que o servidor usa
          // para decidir se o cliente é contribuinte.
          const ie = window.MavisInscricaoEstadual;
          if (!ie.valida(valor)) return recusar(campo, 'Inscrição Estadual inválida: informe só os números, ou ISENTO.');
          valor = ie.normalizar(valor);
        }
        payload[campo.name] = campo.type === 'number' ? Number(valor || 0) : valor;
      }

      botao.disabled = true;
      botao.textContent = 'Cadastrando…';
      try {
        const resposta = await api(atalho.endpoint, { method: 'POST', body: JSON.stringify(payload) });
        showToast(atalho.sucesso(resposta), 'success');
        fechar();
        // NÃO redesenha a tela de trás: o ponto do atalho é não perder o que
        // estava sendo preenchido. Quem precisa do registro novo num select
        // reabre aquele campo — as listas de apoio são buscadas a cada abertura.
      } catch (erro) {
        erroEl.hidden = false;
        erroEl.textContent = erro.message || 'Não foi possível cadastrar.';
        botao.disabled = false;
        botao.textContent = 'Cadastrar';
      }
    });
  }

  // HTML do botão + menu, para o renderApp injetar na barra superior.
  function barraHtml(escapeHtml, temAcesso) {
    const { criar, ir } = permitidos(temAcesso);
    if (!criar.length && !ir.length) return '';
    return `
      <div class="atalhos-wrap">
        <button type="button" class="atalhos-btn" id="atalhosBtn" aria-expanded="false" aria-haspopup="true">
          ATALHOS
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="atalhos-menu" id="atalhosMenu" hidden role="menu">
          ${criar.map((a) => `
            <button type="button" class="atalho-item atalho-item-criar" data-criar="${a.id}" role="menuitem">
              <span class="atalho-item-icone">${a.icone}</span>
              <span>${escapeHtml(a.label)}</span>
            </button>
          `).join('')}
          ${criar.length && ir.length ? '<div class="atalhos-separador"></div>' : ''}
          ${ir.map((a, i) => `
            <button type="button" class="atalho-item atalho-item-ir" data-ir="${i}" role="menuitem">${escapeHtml(a.label)}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Os listeners de documento são registrados UMA vez, no primeiro ligar().
  //
  // `ligar` roda a cada renderApp(), e renderApp é chamado em toda navegação —
  // são mais de vinte pontos no app.js. Registrar aqui acumularia um par de
  // listeners por tela visitada, cada um preso a um menu que já saiu do DOM.
  // Por isso eles buscam o menu pelo id na hora do evento, em vez de guardar
  // uma referência: o elemento é outro depois de cada render.
  let documentoLigado = false;

  const menuAtual = () => document.getElementById('atalhosMenu');
  const botaoAtual = () => document.getElementById('atalhosBtn');

  function fecharMenu() {
    const menu = menuAtual();
    if (menu) menu.hidden = true;
    botaoAtual()?.setAttribute('aria-expanded', 'false');
  }

  function ligarDocumentoUmaVez() {
    if (documentoLigado) return;
    documentoLigado = true;
    // Clique em qualquer lugar fora fecha — senão o menu fica aberto por cima
    // da tela toda vez que alguém desiste dele.
    document.addEventListener('click', (evento) => {
      const menu = menuAtual();
      if (!menu || menu.hidden) return;
      if (menu.contains(evento.target)) return;
      if (botaoAtual()?.contains(evento.target)) return;
      fecharMenu();
    });
    document.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape') fecharMenu();
    });
  }

  function ligar(ctx) {
    const { temAcesso, irPara } = ctx;
    const botao = document.getElementById('atalhosBtn');
    const menu = document.getElementById('atalhosMenu');
    if (!botao || !menu) return;

    // O menu é redesenhado a cada render: começa fechado, sempre.
    menu.hidden = true;
    botao.setAttribute('aria-expanded', 'false');

    botao.addEventListener('click', (evento) => {
      evento.stopPropagation();
      menu.hidden = !menu.hidden;
      botao.setAttribute('aria-expanded', String(!menu.hidden));
    });
    ligarDocumentoUmaVez();

    const { criar, ir } = permitidos(temAcesso);
    menu.querySelectorAll('[data-criar]').forEach((item) => {
      item.addEventListener('click', () => {
        fecharMenu();
        const atalho = criar.find((a) => a.id === item.dataset.criar);
        if (atalho) abrirJanela(atalho, ctx);
      });
    });
    menu.querySelectorAll('[data-ir]').forEach((item) => {
      item.addEventListener('click', () => {
        fecharMenu();
        const destino = ir[Number(item.dataset.ir)];
        if (destino) irPara(destino.modulo, destino.sub);
      });
    });
  }

  return { ATALHOS_CRIAR, ATALHOS_IR, barraHtml, ligar, abrirJanela, fechar };
})();
