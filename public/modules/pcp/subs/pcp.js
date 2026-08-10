window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.pcp = window.MavisSubscreenRegistry.pcp || {};

// As telas de PCP. O apoio (/api/pcp/meta) traz os produtos do Estoque, as
// ordens já abertas, os setores, os status cadastrados e o quadro de pessoal
// do RH — para os selects não pedirem que ninguém digite id.
(function (C) {
  const R = window.MavisSubscreenRegistry.pcp;
  const base = { module: 'pcp', metaEndpoint: '/api/pcp/meta' };

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
    ...base,
    title: 'Ordens de Produção',
    subtitle: 'O que está para produzir, em curso e concluído.',
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
      { name: 'statusId', label: 'Status', type: 'select', options: (meta) => meta.statuses || [] }
    ],
    columns: [
      { label: 'OP', render: (i) => `<strong>${C.escape(i.code || i.id.slice(-6))}</strong>` },
      { label: 'Produto', render: nomeProduto },
      { label: 'Setor', render: (i, meta) => nomeDe(meta.sectors, i.sectorId) },
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
    ...base,
    title: 'Nova Ordem Produção',
    subtitle: 'O produzido é somado pelos apontamentos, não digitado aqui — por isso o campo não existe neste formulário.',
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
          { name: 'sectorId', label: 'Setor', type: 'select', empty: 'Sem setor', options: (meta) => meta.sectors || [] }
        ]
      },
      {
        title: 'Situação',
        description: 'A etapa é o que o sistema entende (é por "Concluída" que ele sabe que a ordem terminou). O status é o rótulo que a sua fábrica usa dentro daquela etapa.',
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

  // ------------------------------------------------------------------ Setores
  R.setores = C.makeListScreen({
    ...base,
    title: 'Setores PCP',
    subtitle: 'Os centros de trabalho, na ordem em que a peça caminha pela fábrica. A sequência é o que permite ler a lista como o fluxo, e não em ordem alfabética.',
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
    ...base,
    title: 'Novo Setor PCP',
    subtitle: 'Excluir um setor NÃO exclui as ordens que passaram por ele: a ordem apenas fica sem setor.',
    entityLabel: 'setor',
    endpoint: '/api/pcp/sectors',
    itemKey: 'sector',
    listSub: 'setores',
    editStateKey: 'pcpEditSectorId',
    sections: [
      {
        title: 'Identificação',
        fields: [
          { name: 'name', label: 'Nome do setor', required: true, hint: 'Ex.: Corte, Solda, Pintura, Montagem' },
          { name: 'sequencia', label: 'Sequência no fluxo', type: 'number', step: '1', min: 0, default: 0, hint: '1 = primeiro setor da linha.' },
          { name: 'responsibleId', label: 'Responsável', type: 'select', empty: 'Sem responsável', options: (meta) => meta.employees || [] }
        ]
      },
      {
        title: 'Capacidade',
        fields: [
          { name: 'capacidadeHora', label: 'Capacidade por hora', type: 'number', step: '0.0001', min: 0, hint: 'Na unidade do produto. Deixe em branco se o ritmo não for constante.' },
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
    ...base,
    title: 'Status PCP',
    subtitle: 'Os status que a sua fábrica usa. Cada um pertence a uma ETAPA — é a etapa que o sistema lê para saber se a ordem terminou; o status só rotula. Assim dá para ter "Aguardando matéria-prima", "Em setup" e "Parada por manutenção" todos dentro de "Em produção".',
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
      { name: 'name', label: 'Nome do status', required: true, hint: 'Ex.: Aguardando matéria-prima' },
      { name: 'etapa', label: 'Etapa do fluxo', type: 'select', empty: null, default: 'em_producao', options: ETAPAS_OP },
      { name: 'ordem', label: 'Ordem de exibição', type: 'number', step: '1', min: 0, default: 0 },
      { name: 'color', label: 'Cor', hint: 'Opcional, para destacar na lista.' },
      { name: 'isDefault', label: 'Status padrão da etapa', type: 'checkbox' },
      { name: 'active', label: 'Status ativo', type: 'checkbox', default: true },
      { name: 'description', label: 'Descrição', type: 'textarea', rows: 2, full: true }
    ]
  });

  // ---------------------------------------------------- Controle de qualidade
  R.qualidade = C.makeInlineRegisterScreen({
    ...base,
    title: 'Controle Qualidade',
    subtitle: 'Inspeção por ordem de produção. Só a quantidade APROVADA é guardada — a reprovada é a diferença, pelo mesmo motivo de "Falta" ser derivado na lista de ordens: um terceiro número guardado pode discordar dos outros dois.',
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
      { name: 'quantidadeAprovada', label: 'Quantidade aprovada', type: 'number', step: '0.0001', min: 0, default: 0, hint: 'O que sobra é reprovado — a tela calcula.' },
      { name: 'resultado', label: 'Resultado', type: 'select', empty: null, default: 'aprovado', options: RESULTADOS_QUALIDADE },
      { name: 'motivo', label: 'Motivo da reprovação', hint: 'Obrigatório quando reprova — é o que a auditoria vai ler depois.' },
      { name: 'notes', label: 'Observação', type: 'textarea', rows: 2, full: true }
    ]
  });

  // ----------------------------------------------------- Estrutura (ficha técnica)
  R.estrutura = C.makeListScreen({
    ...base,
    title: 'Estrutura de Produto',
    subtitle: 'O que cada produto consome para ser feito. Um componente não se repete na mesma ficha.',
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
    subtitle: 'A perda é o percentual que se perde no processo e entra no consumo.',
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
    ...base,
    title: 'Apontamentos',
    subtitle: 'O que foi produzido em cada ordem, por data.',
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
    ...base,
    title: 'Novo Apontamento',
    subtitle: 'Excluir a ordem apaga os apontamentos dela junto.',
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
