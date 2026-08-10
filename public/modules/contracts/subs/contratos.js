window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.contracts = window.MavisSubscreenRegistry.contracts || {};

// As cinco telas de Contratos. "Vencimentos" é a única que não é lista nem
// formulário: é a mesma lista de contratos vista por outra pergunta — o que
// vence ou renova adiante.
(function (C) {
  const R = window.MavisSubscreenRegistry.contracts;
  const base = { module: 'contracts', metaEndpoint: '/api/contracts/meta' };

  const TIPO_PARTE = [
    { id: 'cliente', name: 'Cliente' },
    { id: 'fornecedor', name: 'Fornecedor' }
  ];
  const CICLOS = [
    { id: 'unico', name: 'Único' },
    { id: 'mensal', name: 'Mensal' },
    { id: 'trimestral', name: 'Trimestral' },
    { id: 'semestral', name: 'Semestral' },
    { id: 'anual', name: 'Anual' }
  ];
  const STATUS = [
    { id: 'rascunho', name: 'Rascunho' },
    { id: 'ativo', name: 'Ativo' },
    { id: 'suspenso', name: 'Suspenso' },
    { id: 'encerrado', name: 'Encerrado' }
  ];
  const TOM_STATUS = { rascunho: 'muted', ativo: 'success', suspenso: 'warning', encerrado: 'muted' };
  const NATUREZAS = [
    { id: 'receita', name: 'Receita' },
    { id: 'despesa', name: 'Despesa' },
    { id: 'ambos', name: 'Ambos' }
  ];
  const TOM_NATUREZA = { receita: 'success', despesa: 'warning', ambos: 'info' };

  const rotuloCiclo = (id) => CICLOS.find((c) => c.id === id)?.name || id || '-';
  const nomeDe = (lista, id) => C.escape((lista || []).find((x) => x.id === id)?.name || '-');

  const HOJE = () => new Date().toISOString().slice(0, 10);
  const diasAte = (data) => {
    if (!data) return null;
    const alvo = new Date(`${String(data).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(alvo.getTime())) return null;
    const hoje = new Date(`${HOJE()}T00:00:00`);
    return Math.round((alvo - hoje) / 86400000);
  };

  // Contrato não se encerra no dia do vencimento — se encerra no prazo de AVISO
  // PRÉVIO antes dele. Passar dessa data é o erro caro deste módulo: o contrato
  // renova sozinho por mais um ciclo inteiro sem ninguém ter decidido. O prazo
  // vem do TIPO, porque varia (30 dias num serviço, 90 numa locação).
  const avisoDoContrato = (contrato, meta) => {
    if (!contrato.endDate || contrato.status === 'encerrado') return null;
    const dias = diasAte(contrato.endDate);
    if (dias === null) return null;
    const tipo = (meta.types || []).find((t) => t.id === contrato.typeId);
    const prazo = Number(tipo?.avisoPreviaDias ?? 30);
    if (dias < 0) return { dias, tom: 'danger', texto: `Venceu há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}` };
    if (dias <= prazo) return { dias, tom: 'warning', texto: `Avisar em ${dias} dia${dias === 1 ? '' : 's'}`, prazo };
    return { dias, tom: 'muted', texto: `Faltam ${dias} dias` };
  };

  const ICONE_DINHEIRO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>';

  // Transforma valor + ciclo + vigência em contas a receber (cliente) ou a
  // pagar (fornecedor). Até aqui o contrato guardava esses três dados e nada
  // os lia — a receita recorrente já contratada, que é a parte mais previsível
  // do fluxo de caixa, simplesmente não aparecia no Financeiro.
  async function gerarFinanceiroDoContrato(contrato, ctx) {
    const { api, showToast, confirmModal, recarregar } = ctx;
    if (contrato.status === 'encerrado' || contrato.status === 'rascunho') {
      showToast(`Contrato ${contrato.status} não gera financeiro.`, 'warning');
      return;
    }
    const lado = contrato.partyKind === 'fornecedor' ? 'contas a PAGAR' : 'contas a RECEBER';
    const horizonte = contrato.endDate
      ? 'até a data de término'
      : 'para os próximos 12 períodos (o contrato não tem data de término)';
    const ok = await confirmModal(
      `Gerar ${lado} de "${contrato.title || 'contrato'}"?\n\n` +
      `Cobrança ${rotuloCiclo(contrato.billingCycle).toLowerCase()} de ${C.formatBRL(contrato.value)}, ${horizonte}.\n\n` +
      'Parcelas que já existem não são duplicadas — rodar de novo só acrescenta o que falta.'
    );
    if (!ok) return;
    try {
      const res = await api('/api/contracts/billing', {
        method: 'POST',
        body: JSON.stringify({ contractId: contrato.id })
      });
      if (!res.criadas) {
        showToast(`Nada a gerar: as ${res.previstas} parcelas deste contrato já existem no Financeiro.`, 'info', 6000);
        return;
      }
      showToast(
        `${res.criadas} parcela${res.criadas === 1 ? '' : 's'} de ${res.tipo === 'DESPESA' ? 'despesa' : 'receita'} criada${res.criadas === 1 ? '' : 's'}` +
        `${res.jaExistiam ? ` (${res.jaExistiam} já existiam)` : ''}.`,
        'success', 6000
      );
      recarregar();
    } catch (error) {
      showToast(error.message || 'Erro ao gerar o financeiro do contrato.', 'error');
    }
  }

  // ---------------------------------------------------------------- Contratos
  R.contratos = C.makeListScreen({
    ...base,
    title: 'Contratos',
    subtitle: 'Contratos com clientes e fornecedores, com valor e vigência.',
    tableTitle: 'Contratos',
    endpoint: '/api/contracts/contracts',
    listKey: 'contracts',
    newSub: 'novo_contrato',
    newLabel: 'Novo contrato',
    editStateKey: 'contractsEditId',
    searchFields: ['title', 'partyName'],
    searchPlaceholder: 'Título ou parte',
    filters: [
      { name: 'status', label: 'Situação', type: 'select', options: STATUS },
      { name: 'partyKind', label: 'Parte', type: 'select', options: TIPO_PARTE },
      { name: 'typeId', label: 'Tipo', type: 'select', options: (meta) => meta.types || [] }
    ],
    rowActions: [{
      icon: ICONE_DINHEIRO,
      title: 'Gerar financeiro do contrato',
      tone: 'edit',
      run: gerarFinanceiroDoContrato
    }],
    columns: [
      { label: 'Contrato', render: (i) => `<strong>${C.escape(i.title || '-')}</strong>` },
      { label: 'Tipo', render: (i, meta) => nomeDe(meta.types, i.typeId) },
      { label: 'Parte', render: (i) => `${C.escape(i.partyName || '-')} ${C.badge(i.partyKind === 'fornecedor' ? 'Fornecedor' : 'Cliente', 'info')}` },
      { label: 'Vigência', render: (i) => `${C.formatDate(i.startDate)} a ${C.formatDate(i.endDate)}` },
      // A coluna que existe para o prazo não passar batido.
      {
        label: 'Aviso prévio',
        render: (i, meta) => {
          const aviso = avisoDoContrato(i, meta);
          return aviso ? C.badge(aviso.texto, aviso.tom) : '-';
        }
      },
      { label: 'Valor', render: (i) => `<strong>${C.formatBRL(i.value)}</strong>` },
      { label: 'Cobrança', render: (i) => C.escape(rotuloCiclo(i.billingCycle)) },
      { label: 'Renova', render: (i) => (i.autoRenew ? C.badge('Automática', 'success') : '-') },
      { label: 'Situação', render: (i) => C.badge(STATUS.find((s) => s.id === i.status)?.name || i.status, TOM_STATUS[i.status] || 'muted') }
    ]
  });

  R.novo_contrato = C.makeFormScreen({
    ...base,
    title: 'Novo Contrato',
    subtitle: 'Cliente gera receita, fornecedor gera despesa — é o que a parte define.',
    entityLabel: 'contrato',
    endpoint: '/api/contracts/contracts',
    itemKey: 'contract',
    listSub: 'contratos',
    editStateKey: 'contractsEditId',
    sections: [
      {
        title: 'Identificação',
        columns: 4,
        fields: [
          { name: 'title', label: 'Título', required: true },
          { name: 'code', label: 'Número', type: 'number', min: 1 },
          { name: 'typeId', label: 'Tipo de contrato', type: 'select', empty: 'Sem tipo', options: (meta) => meta.types || [], hint: 'É o tipo que define o prazo de aviso prévio.' },
          { name: 'status', label: 'Situação', type: 'select', empty: null, default: 'ativo', options: STATUS }
        ]
      },
      {
        title: 'Parte',
        fields: [
          { name: 'partyKind', label: 'Tipo', type: 'select', empty: null, default: 'cliente', options: TIPO_PARTE },
          { name: 'partyId', label: 'Cadastro', type: 'select', empty: 'Não vincular', options: (meta) => meta.directory || [] },
          // Nome livre além do vínculo: contrato com quem ainda não está no
          // cadastro não pode ficar esperando o cadastro existir.
          { name: 'partyName', label: 'Nome da parte', hint: 'Preencha quando não houver cadastro' }
        ]
      },
      {
        title: 'Vigência e valor',
        fields: [
          { name: 'startDate', label: 'Início', type: 'date' },
          { name: 'endDate', label: 'Término', type: 'date' },
          { name: 'value', label: 'Valor (R$)', type: 'number', step: '0.01', min: 0, default: 0 },
          { name: 'billingCycle', label: 'Cobrança', type: 'select', empty: null, default: 'mensal', options: CICLOS },
          { name: 'templateId', label: 'Modelo', type: 'select', empty: 'Nenhum', options: (meta) => meta.templates || [] },
          { name: 'autoRenew', label: 'Renovação automática', type: 'checkbox' }
        ]
      },
      { title: 'Observações', columns: 1, fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }] }
    ]
  });

  // ------------------------------------------------------ Tipos de contratos
  // TIPO não é MODELO. Tipo é a classificação ("Locação de equipamento"),
  // modelo é o texto com as cláusulas. Um tipo pode ter vários modelos ao
  // longo do tempo, e o mesmo modelo pode servir a mais de um tipo.
  R.tipos = C.makeListScreen({
    ...base,
    title: 'Tipos de Contratos',
    subtitle: 'A classificação do contrato — e, principalmente, com quantos dias de antecedência cada uma precisa ser avisada antes de vencer.',
    tableTitle: 'Tipos',
    endpoint: '/api/contracts/types',
    listKey: 'types',
    newSub: 'novo_tipo',
    newLabel: 'Novo tipo',
    editStateKey: 'contractsEditTypeId',
    searchFields: ['name', 'description'],
    searchPlaceholder: 'Nome do tipo',
    filters: [{ name: 'natureza', label: 'Natureza', type: 'select', options: NATUREZAS }],
    columns: [
      { label: 'Ordem', render: (i) => `<strong>${Number(i.ordem || 0)}</strong>` },
      { label: 'Tipo', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Natureza', render: (i) => C.badge(nomeDe(NATUREZAS, i.natureza), TOM_NATUREZA[i.natureza] || 'muted') },
      { label: 'Aviso prévio', render: (i) => `${Number(i.avisoPreviaDias ?? 30)} dias` },
      { label: 'Modelo padrão', render: (i, meta) => nomeDe(meta.templates, i.templateId) },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ]
  });

  R.novo_tipo = C.makeFormScreen({
    ...base,
    title: 'Novo Tipo de Contrato',
    subtitle: 'Excluir um tipo NÃO exclui os contratos classificados nele: eles apenas ficam sem tipo, e passam a usar o aviso prévio padrão de 30 dias.',
    entityLabel: 'tipo',
    endpoint: '/api/contracts/types',
    itemKey: 'type',
    listSub: 'tipos',
    editStateKey: 'contractsEditTypeId',
    sections: [
      {
        title: 'Identificação',
        fields: [
          { name: 'name', label: 'Nome do tipo', required: true, hint: 'Ex.: Prestação de serviço, Locação de equipamento' },
          { name: 'natureza', label: 'Natureza', type: 'select', empty: null, default: 'receita', options: NATUREZAS, hint: 'De que lado do caixa este tipo costuma cair.' },
          { name: 'ordem', label: 'Ordem de exibição', type: 'number', step: '1', min: 0, default: 0 }
        ]
      },
      {
        title: 'Aviso prévio',
        description: 'Contrato não se encerra no dia do vencimento — se encerra no prazo de aviso antes dele. Passar dessa data faz o contrato renovar sozinho por mais um ciclo inteiro sem ninguém ter decidido.',
        fields: [
          { name: 'avisoPreviaDias', label: 'Dias de antecedência', type: 'number', step: '1', min: 0, default: 30, hint: '30 é o mais comum em prestação de serviço; locação costuma pedir 90.' },
          { name: 'templateId', label: 'Modelo padrão', type: 'select', empty: 'Nenhum', options: (meta) => meta.templates || [], hint: 'O texto que costuma acompanhar este tipo.' },
          { name: 'active', label: 'Tipo ativo', type: 'checkbox', default: true }
        ]
      },
      {
        title: 'Descrição',
        columns: 1,
        fields: [{ name: 'description', label: 'Descrição', type: 'textarea', full: true }]
      }
    ]
  });

  // -------------------------------------------------------------- Vencimentos
  // Não é CRUD: é a lista de contratos respondendo "o que vence adiante?".
  R.vencimentos = async function renderVencimentos(ctx) {
    const { content, api, showToast, state, loadModule } = ctx;
    const dias = state.contractsJanelaDias || 90;

    let contratos = [];
    let meta = { types: [] };
    try {
      const [res, apoio] = await Promise.all([
        api('/api/contracts/contracts'),
        api('/api/contracts/meta').catch(() => ({ types: [] }))
      ]);
      contratos = res.contracts || [];
      meta = apoio;
    } catch (error) {
      showToast(error.message || 'Erro ao carregar os contratos.', 'error');
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const limite = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

    // Encerrado não vence: ele já acabou. Sem data de término também não entra,
    // porque não há o que vencer.
    const relevantes = contratos.filter((c) => c.endDate && c.status !== 'encerrado');
    const vencidos = relevantes.filter((c) => String(c.endDate).slice(0, 10) < hoje);
    const aVencer = relevantes
      .filter((c) => String(c.endDate).slice(0, 10) >= hoje && String(c.endDate).slice(0, 10) <= limite)
      .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)));

    // O prazo de aviso prévio de cada TIPO — é ele que decide quando a decisão
    // precisa ser tomada, não a data de vencimento. Um contrato que vence em
    // 80 dias mas exige aviso com 90 já está atrasado hoje, e a janela de
    // "próximos 30/60/90 dias" nunca mostraria isso.
    const dentroDoAviso = relevantes
      .filter((c) => {
        const restantes = diasAte(c.endDate);
        if (restantes === null || restantes < 0) return false;
        const tipo = (meta.types || []).find((t) => t.id === c.typeId);
        return restantes <= Number(tipo?.avisoPreviaDias ?? 30);
      })
      .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)));

    const linha = (c) => `
      <tr>
        <td><strong>${C.escape(c.title || '-')}</strong></td>
        <td>${C.escape(c.partyName || '-')}</td>
        <td>${nomeDe(meta.types, c.typeId)}</td>
        <td>${C.formatDate(c.endDate)}</td>
        <td>${C.formatBRL(c.value)}</td>
        <td>${c.autoRenew ? C.badge('Renova sozinho', 'success') : C.badge('Renovação manual', 'warning')}</td>
      </tr>
    `;
    const cabecalho = '<thead><tr><th>Contrato</th><th>Parte</th><th>Tipo</th><th>Vence em</th><th>Valor</th><th>Renovação</th></tr></thead>';
    const tabela = (linhas) => `<div class="table-scroll"><table class="table">${cabecalho}<tbody>${linhas.map(linha).join('')}</tbody></table></div>`;

    content.innerHTML = `
      <div class="panel cadastros-shell">
        ${C.pageHead('Vencimentos e Renovações', 'Contratos encerrados ficam de fora: não há o que vencer neles.', '', `
          ${[30, 60, 90, 180].map((d) => `<button type="button" class="finance-pill finance-pill-sm ${d === dias ? 'active' : ''}" data-janela="${d}">${d} dias</button>`).join('')}
        `)}

        ${dentroDoAviso.length ? C.section(
          `Precisam de decisão AGORA (${dentroDoAviso.length})`,
          tabela(dentroDoAviso),
          'Já entraram no prazo de aviso prévio do tipo. Passar desta data faz o contrato renovar sozinho por mais um ciclo inteiro.'
        ) : ''}

        ${vencidos.length ? C.section(
          `Já venceram (${vencidos.length})`,
          tabela(vencidos),
          'Passaram da data de término e continuam fora do status "encerrado".'
        ) : ''}

        ${C.section(
          `Vencem nos próximos ${dias} dias (${aVencer.length})`,
          aVencer.length ? tabela(aVencer) : '<p class="muted">Nenhum contrato vence nesta janela.</p>'
        )}
      </div>
    `;

    content.querySelectorAll('[data-janela]').forEach((botao) => {
      botao.addEventListener('click', () => {
        state.contractsJanelaDias = Number(botao.dataset.janela);
        loadModule('contracts');
      });
    });
  };

  // ------------------------------------------------------------------ Modelos
  R.modelos = C.makeListScreen({
    ...base,
    title: 'Modelos de Contrato',
    subtitle: 'Textos-padrão reaproveitados na hora de emitir.',
    tableTitle: 'Modelos',
    endpoint: '/api/contracts/templates',
    listKey: 'templates',
    newSub: 'novo_modelo',
    newLabel: 'Novo modelo',
    editStateKey: 'contractsEditTemplateId',
    searchFields: ['name'],
    columns: [
      { label: 'Modelo', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Tamanho', render: (i) => `${String(i.body || '').length} caractere(s)` },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ]
  });

  R.novo_modelo = C.makeFormScreen({
    ...base,
    title: 'Novo Modelo',
    subtitle: 'Excluir um modelo NÃO exclui os contratos que o usaram: eles ficam sem modelo.',
    entityLabel: 'modelo',
    endpoint: '/api/contracts/templates',
    itemKey: 'template',
    listSub: 'modelos',
    editStateKey: 'contractsEditTemplateId',
    sections: [
      {
        title: 'Modelo',
        columns: 2,
        fields: [
          { name: 'name', label: 'Nome', required: true },
          { name: 'active', label: 'Modelo ativo', type: 'checkbox', default: true }
        ]
      },
      { title: 'Texto', columns: 1, fields: [{ name: 'body', label: 'Texto do contrato', type: 'textarea', rows: 14, full: true }] }
    ]
  });
})(window.MavisCadastros);
