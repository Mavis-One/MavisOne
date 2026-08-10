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
    { name: 'document', label: 'CPF / CNPJ', required: true, linha: 1, hint: 'Só números' },
    { name: 'name', label: 'Nome', required: true, linha: 1 },
    { name: 'email', label: 'E-mail', type: 'email', linha: 2 },
    { name: 'phone', label: 'Telefone', linha: 2 },
    { name: 'zipCode', label: 'CEP', linha: 3 },
    { name: 'address', label: 'Logradouro', linha: 3 },
    { name: 'number', label: 'Número', linha: 3 },
    { name: 'complement', label: 'Complemento', linha: 4 },
    { name: 'neighborhood', label: 'Bairro', linha: 4 },
    { name: 'city', label: 'Cidade', linha: 4 },
    { name: 'state', label: 'UF', type: 'select', opcoes: UFS, linha: 4 }
  ];

  const ATALHOS_CRIAR = [
    {
      id: 'novo_cliente', label: 'Novo Cliente', icone: ICONES.cliente, modulo: 'cadastros',
      titulo: 'Cliente', endpoint: '/api/cadastros/pessoas', campos: CAMPOS_PESSOA,
      // O papel é o que separa cliente de fornecedor na mesma tabela de pessoas.
      extras: { roles: ['Cliente'], status: 'ativo' },
      sucesso: (r) => `Cliente "${r.person?.name || ''}" cadastrado.`
    },
    {
      id: 'novo_fornecedor', label: 'Novo Fornecedor', icone: ICONES.fornecedor, modulo: 'cadastros',
      titulo: 'Fornecedor', endpoint: '/api/cadastros/pessoas', campos: CAMPOS_PESSOA,
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
        { name: 'ncm', label: 'NCM', linha: 3, hint: '8 dígitos — exigido para emitir NF-e' },
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
    const dica = campo.hint ? `<small class="muted">${escapeHtml(campo.hint)}</small>` : '';
    let controle;
    if (campo.type === 'select') {
      controle = `<select name="${campo.name}" ${obrigatorio}>${campo.opcoes.map((o) => {
        const rotulo = campo.rotulos ? (campo.rotulos[o] ?? o) : o;
        return `<option value="${escapeHtml(o)}" ${String(valor) === String(o) ? 'selected' : ''}>${escapeHtml(rotulo)}</option>`;
      }).join('')}</select>`;
    } else if (campo.type === 'textarea') {
      controle = `<textarea name="${campo.name}" rows="2"></textarea>`;
    } else {
      const passo = campo.step ? `step="${campo.step}"` : '';
      const min = campo.min !== undefined ? `min="${campo.min}"` : '';
      controle = `<input type="${campo.type || 'text'}" name="${campo.name}" value="${escapeHtml(valor)}" ${passo} ${min} ${obrigatorio} />`;
    }
    return `
      <label class="atalho-campo">
        <span>${escapeHtml(campo.label)}${campo.required ? ' *' : ''}</span>
        ${controle}
        ${dica}
      </label>`;
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
    overlay.querySelector('input, select')?.focus();

    document.getElementById('atalhoForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const botao = evento.target.querySelector('button[type="submit"]');
      if (botao.disabled) return;
      const erroEl = document.getElementById('atalhoErro');
      erroEl.hidden = true;

      const dados = new FormData(evento.target);
      const payload = { ...atalho.extras };
      atalho.campos.forEach((campo) => {
        let valor = dados.get(campo.name) ?? '';
        if (campo.name === 'document') valor = soDigitos(valor);
        payload[campo.name] = campo.type === 'number' ? Number(valor || 0) : valor;
      });

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
