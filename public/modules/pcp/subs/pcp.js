window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.pcp = window.MavisSubscreenRegistry.pcp || {};

// As telas de PCP. O apoio (/api/pcp/meta) traz os produtos do Estoque, as
// ordens já abertas, os setores, os status cadastrados e o quadro de pessoal
// do RH — para os selects não pedirem que ninguém digite id.
(function (C) {
  const R = window.MavisSubscreenRegistry.pcp;
  const base = { module: 'pcp', metaEndpoint: '/api/pcp/meta' };
  // As telas SEM seletor de produto (setores, status, qualidade, apontamentos)
  // dispensam o catálogo: era `select *` dos 5.561 produtos, 440 KB, para elas
  // lerem setores, status, ordens e o quadro de pessoal. O padrão (`base`)
  // continua mandando — tela nova nasce com o seletor cheio.
  const baseSemProdutos = { ...base, metaEndpoint: '/api/pcp/meta?produtos=0' };
  // A ordem de produção mostra e escolhe o REPRESENTANTE (fase DZ): pessoa do
  // Cadastros com esse papel. Só estas telas pedem a lista, que custa a
  // leitura do cadastro inteiro.
  const baseComRepresentantes = { ...base, metaEndpoint: '/api/pcp/meta?representantes=1' };

  // ETAPAS são fixas: é por elas que o código sabe que a ordem terminou. Os
  // STATUS que a empresa cadastra ("Aguardando matéria-prima", "Em setup",
  // "Parada por manutenção") vivem dentro de uma etapa e só rotulam. Trocar
  // isto por texto livre quebraria na primeira vez que alguém digitasse
  // "Concluída " com espaço no fim.
  const ETAPAS_OP = [
    { id: 'aberta', name: 'Aberta' },
    { id: 'em_producao', name: 'Em produção' },
    { id: 'concluida', name: 'Concluída' },
    { id: 'cancelada', name: 'Cancelada' }
  ];
  const TOM_STATUS = { aberta: 'info', em_producao: 'warning', concluida: 'success', cancelada: 'muted' };

  const RESULTADOS_QUALIDADE = [
    { id: 'aprovado', name: 'Aprovado' },
    { id: 'aprovado_com_ressalva', name: 'Aprovado com ressalva' },
    { id: 'reprovado', name: 'Reprovado' }
  ];
  const TOM_RESULTADO = { aprovado: 'success', aprovado_com_ressalva: 'warning', reprovado: 'danger' };

  const nomeDe = (lista, id) => C.escape((lista || []).find((x) => x.id === id)?.name || '-');
  const nomeProduto = (item, meta) => nomeDe(meta.products, item.productId);
  const nomeOrdem = (item, meta) => nomeDe(meta.orders, item.orderId);
  const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

  // ------------------------------------------------------ Ordens de produção
  R.ordens = C.makeListScreen({
    ...baseComRepresentantes,
    title: 'Ordens de Produção',
    tableTitle: 'Ordens',
    endpoint: '/api/pcp/orders',
    listKey: 'orders',
    newSub: 'nova_ordem',
    newLabel: 'Nova ordem',
    editStateKey: 'pcpEditOrderId',
    searchFields: ['notes'],
    searchPlaceholder: 'Observação',
    filters: [
      { name: 'status', label: 'Etapa', type: 'select', options: ETAPAS_OP },
      { name: 'sectorId', label: 'Setor', type: 'select', options: (meta) => meta.sectors || [] },
      { name: 'statusId', label: 'Status', type: 'select', options: (meta) => meta.statuses || [] },
      { name: 'representanteId', label: 'Representante', type: 'select', options: (meta) => meta.representantes || [] }
    ],
    columns: [
      { label: 'OP', render: (i) => `<strong>${C.escape(i.code || i.id.slice(-6))}</strong>` },
      { label: 'Produto', render: nomeProduto },
      { label: 'Setor', render: (i, meta) => nomeDe(meta.sectors, i.sectorId) },
      { label: 'Representante', render: (i, meta) => nomeDe(meta.representantes, i.representanteId) },
      { label: 'Previsto', render: (i) => qtd(i.quantity) },
      { label: 'Produzido', render: (i) => qtd(i.quantityDone) },
      // Saldo é derivado: guardar também o restante criaria um número que pode
      // discordar dos outros dois.
      { label: 'Falta', render: (i) => qtd(Math.max(0, Number(i.quantity || 0) - Number(i.quantityDone || 0))) },
      { label: 'Entrega', render: (i) => C.formatDate(i.dueDate) },
      // Mostra o status cadastrado quando existe; sem ele, a etapa crua. A cor
      // sempre vem da etapa — é ela que diz o que a ordem realmente é.
      {
        label: 'Situação',
        render: (i, meta) => C.badge(
          nomeDe(meta.statuses, i.statusId) !== '-'
            ? nomeDe(meta.statuses, i.statusId)
            : (ETAPAS_OP.find((s) => s.id === i.status)?.name || i.status),
          TOM_STATUS[i.status] || 'muted'
        )
      }
    ]
  });

  R.nova_ordem = C.makeFormScreen({
    ...baseComRepresentantes,
    title: 'Nova Ordem Produção',
    entityLabel: 'ordem',
    endpoint: '/api/pcp/orders',
    itemKey: 'order',
    listSub: 'ordens',
    editStateKey: 'pcpEditOrderId',
    sections: [
      {
        title: 'Ordem',
        fields: [
          { name: 'code', label: 'Número da OP', type: 'number', min: 1 },
          { name: 'productId', label: 'Produto', type: 'select', required: true, options: (meta) => meta.products || [] },
          { name: 'sectorId', label: 'Setor', type: 'select', empty: 'Sem setor', options: (meta) => meta.sectors || [] },
          { name: 'representanteId', label: 'Representante', type: 'select', empty: 'Sem representante', options: (meta) => meta.representantes || [] }
        ]
      },
      {
        title: 'Situação',
        fields: [
          { name: 'status', label: 'Etapa', type: 'select', empty: null, default: 'aberta', options: ETAPAS_OP },
          { name: 'statusId', label: 'Status', type: 'select', empty: 'Usar a etapa', options: (meta) => meta.statuses || [] }
        ]
      },
      {
        title: 'Quantidades e prazo',
        fields: [
          { name: 'quantity', label: 'Quantidade prevista', type: 'number', step: '0.0001', min: 0, default: 0 },
          { name: 'startDate', label: 'Início', type: 'date' },
          { name: 'dueDate', label: 'Entrega', type: 'date' }
        ]
      },
      { title: 'Observação', columns: 1, fields: [{ name: 'notes', label: 'Observação', type: 'textarea', full: true }] }
    ]
  });

  // ---------------------------------------------------------- Representantes
  // Fase DZ. O representante é PESSOA (ou empresa) do Cadastros com o papel
  // "Representante" — decisão do usuário, para o mesmo cadastro servir depois
  // a vendas e notas. Por isso esta tela não tem formulário próprio: o
  // cadastro exige documento e endereço completos, e uma segunda cópia do
  // formulário de Pessoas divergiria dele. "+ Novo representante" abre o
  // formulário do Cadastros com o papel já marcado; o lápis abre o cadastro.
  R.representantes = async function renderRepresentantes(ctx) {
    const { content, api, showToast, state, renderApp, loadModule } = ctx;
    state.cadastroDraft = state.cadastroDraft || {};
    let lista = [];
    try {
      lista = (await api('/api/pcp/meta?produtos=0&representantes=1')).representantes || [];
    } catch (erro) {
      showToast(erro.message || 'Erro ao carregar os representantes.', 'error');
    }
    let busca = state.cadastroDraft.pcpRepresentantesBusca || '';
    const podeCadastrar = typeof window.hasModuleAccess !== 'function' || window.hasModuleAccess('cadastros');

    const abrirNoCadastros = (people, sub) => {
      state.activeModule = 'cadastros';
      state.selectedModule = null;
      state.cadastroDraft = { ...state.cadastroDraft, activeType: 'people', people };
      state.activeSub = sub;
      renderApp();
      loadModule('cadastros');
    };

    function render() {
      const termo = C.normalizeText ? C.normalizeText(busca) : String(busca).toLowerCase();
      const visiveis = lista.filter((r) => !termo || [r.name, r.document, r.phone, r.email, r.city]
        .some((v) => (C.normalizeText ? C.normalizeText(v) : String(v || '').toLowerCase()).includes(termo)));
      content.innerHTML = `
        <div class="panel cadastros-shell">
          ${C.pageHead('Representantes', '', '', podeCadastrar
            ? '<button type="button" class="success" id="pcpRepresentanteNovo">+ Novo representante</button>'
            : '')}
          <section class="cadastro-section">
            <div class="cadastro-section-header">
              <div>
                <h4>Representantes</h4>
                <p>${visiveis.length} de ${lista.length} registro(s).</p>
              </div>
            </div>
            <div class="cadastro-section-body">
              <label class="cadastro-field">
                <span>Busca</span>
                <input id="pcpRepresentanteBusca" value="${C.escape(busca)}" placeholder="Nome, documento, telefone ou cidade" />
              </label>
              <div class="table-scroll">
                <table class="table table-actions">
                  <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th><th>E-mail</th><th>Cidade</th><th>Situação</th><th>Ações</th></tr></thead>
                  <tbody>
                    ${visiveis.length === 0
                      ? `<tr><td colspan="7" class="muted" style="text-align:center; padding:24px;">${lista.length === 0 ? 'Nenhum representante cadastrado ainda.' : 'Nenhum representante para esta busca.'}</td></tr>`
                      : visiveis.map((r) => `
                        <tr>
                          <td><strong>${C.escape(r.name || '-')}</strong></td>
                          <td>${C.escape(r.document || '-')}</td>
                          <td>${C.escape(r.phone || '-')}</td>
                          <td>${C.escape(r.email || '-')}</td>
                          <td>${C.escape(r.city || '-')}</td>
                          <td>${C.statusBadge(r.active === false ? 'inativo' : 'ativo')}</td>
                          <td>${podeCadastrar ? `<button type="button" class="icon-button edit" data-representante="${C.escape(r.id)}" data-kind="${C.escape(r.kind)}" title="Editar no Cadastros">${C.editIcon}</button>` : ''}</td>
                        </tr>
                      `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      `;

      const campoBusca = document.getElementById('pcpRepresentanteBusca');
      campoBusca?.addEventListener('input', () => {
        busca = campoBusca.value;
        state.cadastroDraft.pcpRepresentantesBusca = busca;
        const fim = campoBusca.selectionEnd;
        render();
        const novo = document.getElementById('pcpRepresentanteBusca');
        novo?.focus();
        try { novo?.setSelectionRange(fim, fim); } catch (_) { /* sem seleção */ }
      });

      document.getElementById('pcpRepresentanteNovo')?.addEventListener('click', () => {
        abrirNoCadastros({ roles: ['Representante'], status: 'ativo' }, 'register');
      });

      // A edição abre com o registro INTEIRO, buscado pelo id — mesma regra da
      // lista de Pessoas: salvar a partir da linha resumida gravaria vazio por
      // cima do endereço e dos contatos.
      content.querySelectorAll('[data-representante]').forEach((botao) => {
        botao.addEventListener('click', async () => {
          const id = botao.dataset.representante;
          const ehEmpresa = botao.dataset.kind === 'cnpj';
          try {
            const resposta = await api(ehEmpresa
              ? `/api/cadastros/cnpjs/${encodeURIComponent(id)}`
              : `/api/cadastros/pessoas/${encodeURIComponent(id)}`);
            const registro = ehEmpresa ? resposta.cnpj : resposta.person;
            if (!registro) throw new Error('Cadastro não encontrado.');
            abrirNoCadastros(ehEmpresa
              ? { ...registro, kind: 'cnpj', type: 'pessoa-juridica', error: '', documentMessage: '' }
              : { ...registro, kind: 'people', error: '', documentMessage: '' }, 'edit');
          } catch (erro) {
            showToast(erro.message || 'Não foi possível abrir o cadastro.', 'error');
          }
        });
      });
    }

    render();
  };

  // ------------------------------------------------------------------ Setores
  R.setores = C.makeListScreen({
    ...baseSemProdutos,
    title: 'Setores PCP',
    tableTitle: 'Setores',
    endpoint: '/api/pcp/sectors',
    listKey: 'sectors',
    newSub: 'novo_setor',
    newLabel: 'Novo setor',
    editStateKey: 'pcpEditSectorId',
    searchFields: ['name', 'description'],
    searchPlaceholder: 'Nome do setor',
    columns: [
      { label: 'Seq.', render: (i) => `<strong>${Number(i.sequencia || 0)}</strong>` },
      { label: 'Setor', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Responsável', render: (i, meta) => nomeDe(meta.employees, i.responsibleId) },
      { label: 'Capacidade', render: (i) => (i.capacidadeHora ? `${qtd(i.capacidadeHora)}/h` : '-') },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ]
  });

  R.novo_setor = C.makeFormScreen({
    ...baseSemProdutos,
    title: 'Novo Setor PCP',
    entityLabel: 'setor',
    endpoint: '/api/pcp/sectors',
    itemKey: 'sector',
    listSub: 'setores',
    editStateKey: 'pcpEditSectorId',
    sections: [
      {
        title: 'Identificação',
        fields: [
          { name: 'name', label: 'Nome do setor', required: true },
          { name: 'sequencia', label: 'Sequência no fluxo', type: 'number', step: '1', min: 0, default: 0 },
          { name: 'responsibleId', label: 'Responsável', type: 'select', empty: 'Sem responsável', options: (meta) => meta.employees || [] }
        ]
      },
      {
        title: 'Capacidade',
        fields: [
          { name: 'capacidadeHora', label: 'Capacidade por hora', type: 'number', step: '0.0001', min: 0 },
          { name: 'active', label: 'Setor ativo', type: 'checkbox', default: true }
        ]
      },
      {
        title: 'Observações',
        columns: 1,
        fields: [{ name: 'description', label: 'Descrição', type: 'textarea', full: true }]
      }
    ]
  });

  // -------------------------------------------------------------- Status PCP
  R.status_pcp = C.makeInlineRegisterScreen({
    ...baseSemProdutos,
    // Esta tela não lê nada da meta do módulo: não a pede (scripts/
    // test-meta-das-telas-de-cadastro.js cobra). Se passar a ler, tire a linha.
    metaEndpoint: null,
    title: 'Status PCP',
    tableTitle: 'Status de produção',
    entityLabel: 'status',
    endpoint: '/api/pcp/statuses',
    listKey: 'statuses',
    itemKey: 'status',
    searchFields: ['name', 'description'],
    searchPlaceholder: 'Nome do status',
    filters: [{ name: 'etapa', label: 'Etapa', type: 'select', options: ETAPAS_OP }],
    columns: [
      { label: 'Ordem', render: (i) => `<strong>${Number(i.ordem || 0)}</strong>` },
      { label: 'Status', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Etapa', render: (i) => C.badge(nomeDe(ETAPAS_OP, i.etapa), TOM_STATUS[i.etapa] || 'muted') },
      { label: 'Padrão', render: (i) => (i.isDefault ? C.badge('Padrão', 'info') : '-') },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ],
    formColumns: 4,
    fields: [
      { name: 'name', label: 'Nome do status', required: true },
      { name: 'etapa', label: 'Etapa do fluxo', type: 'select', empty: null, default: 'em_producao', options: ETAPAS_OP },
      { name: 'ordem', label: 'Ordem de exibição', type: 'number', step: '1', min: 0, default: 0 },
      { name: 'color', label: 'Cor' },
      { name: 'isDefault', label: 'Status padrão da etapa', type: 'checkbox' },
      { name: 'active', label: 'Status ativo', type: 'checkbox', default: true },
      { name: 'description', label: 'Descrição', type: 'textarea', rows: 2, full: true }
    ]
  });

  // ---------------------------------------------------- Controle de qualidade
  R.qualidade = C.makeInlineRegisterScreen({
    ...baseSemProdutos,
    title: 'Controle Qualidade',
    tableTitle: 'Inspeções',
    entityLabel: 'inspeção',
    endpoint: '/api/pcp/quality-checks',
    listKey: 'qualityChecks',
    itemKey: 'qualityCheck',
    searchFields: ['motivo', 'notes'],
    searchPlaceholder: 'Motivo ou observação',
    filters: [
      { name: 'resultado', label: 'Resultado', type: 'select', options: RESULTADOS_QUALIDADE },
      { name: 'sectorId', label: 'Setor', type: 'select', options: (meta) => meta.sectors || [] }
    ],
    columns: [
      { label: 'Data', render: (i) => C.formatDate(i.date) },
      { label: 'Ordem', render: nomeOrdem },
      { label: 'Setor', render: (i, meta) => nomeDe(meta.sectors, i.sectorId) },
      { label: 'Inspecionado', render: (i) => qtd(i.quantidadeInspecionada) },
      { label: 'Aprovado', render: (i) => qtd(i.quantidadeAprovada) },
      {
        label: 'Reprovado',
        render: (i) => {
          const reprovado = Math.max(0, Number(i.quantidadeInspecionada || 0) - Number(i.quantidadeAprovada || 0));
          return reprovado > 0 ? `<strong style="color:var(--danger-text);">${qtd(reprovado)}</strong>` : '0';
        }
      },
      { label: 'Resultado', render: (i) => C.badge(nomeDe(RESULTADOS_QUALIDADE, i.resultado), TOM_RESULTADO[i.resultado] || 'muted') },
      { label: 'Inspetor', render: (i, meta) => nomeDe(meta.employees, i.inspectorId) }
    ],
    formColumns: 4,
    fields: [
      { name: 'orderId', label: 'Ordem de produção', type: 'select', required: true, options: (meta) => meta.orders || [] },
      { name: 'sectorId', label: 'Setor', type: 'select', empty: 'Sem setor', options: (meta) => meta.sectors || [] },
      { name: 'date', label: 'Data', type: 'date', required: true },
      { name: 'inspectorId', label: 'Inspetor', type: 'select', empty: 'Não informado', options: (meta) => meta.employees || [] },
      { name: 'quantidadeInspecionada', label: 'Quantidade inspecionada', type: 'number', step: '0.0001', min: 0, default: 0 },
      { name: 'quantidadeAprovada', label: 'Quantidade aprovada', type: 'number', step: '0.0001', min: 0, default: 0 },
      { name: 'resultado', label: 'Resultado', type: 'select', empty: null, default: 'aprovado', options: RESULTADOS_QUALIDADE },
      { name: 'motivo', label: 'Motivo da reprovação' },
      { name: 'notes', label: 'Observação', type: 'textarea', rows: 2, full: true }
    ]
  });

  // ----------------------------------------------------- Estrutura (ficha técnica)
  R.estrutura = C.makeListScreen({
    ...base,
    title: 'Estrutura de Produto',
    tableTitle: 'Itens de estrutura',
    endpoint: '/api/pcp/bom',
    listKey: 'bom',
    newSub: 'nova_estrutura',
    newLabel: 'Novo item',
    editStateKey: 'pcpEditBomId',
    columns: [
      { label: 'Produto', render: nomeProduto },
      { label: 'Componente', render: (i, meta) => C.escape((meta.products || []).find((p) => p.id === i.componentId)?.name || '-') },
      { label: 'Quantidade', render: (i) => qtd(i.quantity) },
      { label: 'Perda', render: (i) => `${Number(i.lossPercent || 0).toFixed(2)}%` }
    ]
  });

  R.nova_estrutura = C.makeFormScreen({
    ...base,
    title: 'Novo Item de Estrutura',
    entityLabel: 'item',
    endpoint: '/api/pcp/bom',
    itemKey: 'bomItem',
    listSub: 'estrutura',
    editStateKey: 'pcpEditBomId',
    sections: [
      {
        title: 'Vínculo',
        fields: [
          { name: 'productId', label: 'Produto final', type: 'select', required: true, options: (meta) => meta.products || [] },
          { name: 'componentId', label: 'Componente', type: 'select', required: true, options: (meta) => meta.products || [] },
          { name: 'quantity', label: 'Quantidade', type: 'number', step: '0.0001', min: 0, default: 1 },
          { name: 'lossPercent', label: 'Perda (%)', type: 'number', step: '0.01', min: 0, default: 0 }
        ]
      }
    ]
  });

  // ------------------------------------------------------------- Apontamentos
  R.apontamentos = C.makeListScreen({
    ...baseSemProdutos,
    title: 'Apontamentos',
    tableTitle: 'Apontamentos',
    endpoint: '/api/pcp/entries',
    listKey: 'entries',
    newSub: 'novo_apontamento',
    newLabel: 'Novo apontamento',
    editStateKey: 'pcpEditEntryId',
    searchFields: ['notes'],
    columns: [
      { label: 'Data', render: (i) => C.formatDate(i.date) },
      { label: 'Ordem', render: nomeOrdem },
      { label: 'Quantidade', render: (i) => `<strong>${qtd(i.quantity)}</strong>` },
      { label: 'Observação', render: (i) => C.escape(i.notes || '-') }
    ]
  });

  R.novo_apontamento = C.makeFormScreen({
    ...baseSemProdutos,
    title: 'Novo Apontamento',
    entityLabel: 'apontamento',
    endpoint: '/api/pcp/entries',
    itemKey: 'entry',
    listSub: 'apontamentos',
    editStateKey: 'pcpEditEntryId',
    sections: [
      {
        title: 'Produção',
        fields: [
          { name: 'orderId', label: 'Ordem de produção', type: 'select', required: true, options: (meta) => meta.orders || [] },
          { name: 'date', label: 'Data', type: 'date', required: true },
          { name: 'quantity', label: 'Quantidade produzida', type: 'number', step: '0.0001', min: 0, default: 0 }
        ]
      },
      { title: 'Observação', columns: 1, fields: [{ name: 'notes', label: 'Observação', type: 'textarea', full: true }] }
    ]
  });
})(window.MavisCadastros);
