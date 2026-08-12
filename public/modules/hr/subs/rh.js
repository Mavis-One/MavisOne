window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.hr = window.MavisSubscreenRegistry.hr || {};

// As telas de RH. Mesma base das outras: fábricas de lista e formulário, com o
// apoio vindo de /api/hr/meta (profissões, departamentos, expedientes, tipos,
// categorias e colaboradores para os selects).
//
// Três formatos de tela, e a escolha entre eles é por tamanho do cadastro:
//   - lista + formulário separados  → Colaborador, Expediente (campo demais)
//   - lista com formulário embutido → Departamento, Tipo, Categoria, Profissão
//   - lista + formulário separados  → Ausência e Ponto (já existiam)
(function (C) {
  const R = window.MavisSubscreenRegistry.hr;
  const base = { module: 'hr', metaEndpoint: '/api/hr/meta' };

  const STATUS_COLAB = [
    { id: 'ativo', name: 'Ativo' },
    { id: 'afastado', name: 'Afastado' },
    { id: 'desligado', name: 'Desligado' }
  ];
  const TIPO_AUSENCIA = [
    { id: 'ferias', name: 'Férias' },
    { id: 'licenca', name: 'Licença' },
    { id: 'afastamento', name: 'Afastamento' },
    { id: 'falta', name: 'Falta' }
  ];
  // Base de cálculo do salário. Sem isto, "salário 3000" é ambíguo entre
  // R$ 3.000 por mês e R$ 3.000 por hora — e o erro só aparece na folha.
  const BASE_CALCULO = [
    { id: 'mensal', name: 'Mensal' },
    { id: 'hora', name: 'Por hora' },
    { id: 'dia', name: 'Por dia' },
    { id: 'comissao', name: 'Comissão' }
  ];
  const ESCALAS = [
    { id: 'seg-sex', name: 'Segunda a sexta' },
    { id: 'seg-sab', name: 'Segunda a sábado' },
    { id: '12x36', name: 'Escala 12x36' },
    { id: '5x1', name: 'Escala 5x1' },
    { id: '6x1', name: 'Escala 6x1' },
    { id: 'personalizada', name: 'Personalizada' }
  ];

  const nomeDe = (lista, id) => C.escape((lista || []).find((x) => x.id === id)?.name || '-');
  const nomeProfissao = (item, meta) => nomeDe(meta.positions, item.positionId);
  const nomeColaborador = (item, meta) => nomeDe(meta.employees, item.employeeId);
  const hora = (v) => (v ? String(v).slice(0, 5) : '-');
  const simNao = (v) => C.badge(v ? 'Sim' : 'Não', v ? 'success' : 'muted');

  // ------------------------------------------------------------ Colaboradores
  R.colaboradores = C.makeListScreen({
    ...base,
    title: 'Colaboradores',
    subtitle: 'O quadro de pessoal, com cargo, admissão e situação.',
    tableTitle: 'Colaboradores',
    endpoint: '/api/hr/employees',
    listKey: 'employees',
    newSub: 'novo_colaborador',
    newLabel: 'Novo colaborador',
    editStateKey: 'hrEditEmployeeId',
    searchFields: ['name', 'document', 'email'],
    searchPlaceholder: 'Nome, documento ou e-mail',
    filters: [
      { name: 'status', label: 'Situação', type: 'select', options: STATUS_COLAB },
      { name: 'departmentId', label: 'Departamento', type: 'select', options: (meta) => meta.departments || [] },
      { name: 'employeeTypeId', label: 'Tipo', type: 'select', options: (meta) => meta.employeeTypes || [] }
    ],
    columns: [
      { label: 'Nome', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Profissão', render: nomeProfissao },
      { label: 'Departamento', render: (i, meta) => nomeDe(meta.departments, i.departmentId) },
      { label: 'Tipo', render: (i, meta) => nomeDe(meta.employeeTypes, i.employeeTypeId) },
      { label: 'Expediente', render: (i, meta) => nomeDe(meta.workSchedules, i.workScheduleId) },
      { label: 'Admissão', render: (i) => C.formatDate(i.admittedAt) },
      { label: 'Situação', render: (i) => C.statusBadge(i.status) }
    ]
  });

  R.novo_colaborador = C.makeFormScreen({
    ...base,
    title: 'Novo Colaborador',
    subtitle: 'Desligar alguém é preencher a data de saída e mudar a situação — não excluir o registro.',
    entityLabel: 'colaborador',
    endpoint: '/api/hr/employees',
    itemKey: 'employee',
    listSub: 'colaboradores',
    editStateKey: 'hrEditEmployeeId',
    sections: [
      {
        title: 'Identificação',
        fields: [
          { name: 'name', label: 'Nome', required: true },
          // Colaborador é pessoa física: trava em CPF para não aceitar 14 dígitos.
          { name: 'document', label: 'CPF', attrs: 'data-documento="cpf"' },
          { name: 'positionId', label: 'Profissão', type: 'select', empty: 'Sem profissão', options: (meta) => meta.positions || [] }
        ]
      },
      {
        title: 'Lotação e vínculo',
        description: 'Departamento diz ONDE trabalha; tipo diz SOB QUE VÍNCULO; categoria diz COMO é remunerado; expediente diz EM QUE HORÁRIO.',
        columns: 4,
        fields: [
          { name: 'departmentId', label: 'Departamento', type: 'select', empty: 'Sem departamento', options: (meta) => meta.departments || [] },
          { name: 'employeeTypeId', label: 'Tipo de colaborador', type: 'select', empty: 'Não informado', options: (meta) => meta.employeeTypes || [] },
          { name: 'employeeCategoryId', label: 'Categoria', type: 'select', empty: 'Não informada', options: (meta) => meta.employeeCategories || [] },
          { name: 'workScheduleId', label: 'Expediente', type: 'select', empty: 'Sem expediente', options: (meta) => meta.workSchedules || [] }
        ]
      },
      {
        title: 'Contrato',
        fields: [
          { name: 'admittedAt', label: 'Admissão', type: 'date' },
          { name: 'dismissedAt', label: 'Desligamento', type: 'date' },
          { name: 'salary', label: 'Salário (R$)', type: 'number', step: '0.01', min: 0, hint: 'Na base da categoria: mensal, por hora ou por dia.' },
          { name: 'status', label: 'Situação', type: 'select', empty: null, default: 'ativo', options: STATUS_COLAB }
        ]
      },
      {
        title: 'Contato',
        fields: [
          { name: 'email', label: 'E-mail', type: 'email' },
          { name: 'phone', label: 'Telefone' }
        ]
      }
    ]
  });

  // ------------------------------------------------------------ Departamentos
  R.departamentos = C.makeInlineRegisterScreen({
    ...base,
    title: 'Departamentos',
    subtitle: 'Os setores da empresa. Excluir um departamento NÃO exclui quem trabalha nele — o colaborador apenas fica sem lotação.',
    tableTitle: 'Departamentos',
    entityLabel: 'departamento',
    endpoint: '/api/hr/departments',
    listKey: 'departments',
    itemKey: 'department',
    searchFields: ['name', 'description', 'costCenter'],
    searchPlaceholder: 'Nome ou centro de custo',
    columns: [
      { label: 'Departamento', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Responsável', render: (i, meta) => nomeDe(meta.employees, i.managerId) },
      { label: 'Centro de custo', render: (i) => C.escape(i.costCenter || '-') },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ],
    fields: [
      { name: 'name', label: 'Nome do departamento', required: true },
      { name: 'managerId', label: 'Responsável', type: 'select', empty: 'Sem responsável', options: (meta) => meta.employees || [] },
      { name: 'costCenter', label: 'Centro de custo', hint: 'Como aparece no Financeiro.' },
      { name: 'description', label: 'Descrição', type: 'textarea', rows: 2, full: true },
      { name: 'active', label: 'Departamento ativo', type: 'checkbox', default: true }
    ]
  });

  // --------------------------------------------------------------- Expedientes
  R.expedientes = C.makeListScreen({
    ...base,
    title: 'Expedientes',
    subtitle: 'A jornada CONTRATADA de cada escala. É contra ela que o registro de ponto é comparado para apurar atraso e hora extra.',
    tableTitle: 'Expedientes',
    endpoint: '/api/hr/work-schedules',
    listKey: 'workSchedules',
    newSub: 'novo_expediente',
    newLabel: 'Novo expediente',
    editStateKey: 'hrEditScheduleId',
    searchFields: ['name', 'description'],
    searchPlaceholder: 'Nome do expediente',
    columns: [
      { label: 'Expediente', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Escala', render: (i) => nomeDe(ESCALAS, i.diasSemana) },
      { label: 'Horário', render: (i) => C.escape(`${hora(i.entrada)} às ${hora(i.saida)}`) },
      { label: 'Intervalo', render: (i) => C.escape(i.saidaAlmoco || i.voltaAlmoco ? `${hora(i.saidaAlmoco)} às ${hora(i.voltaAlmoco)}` : 'sem intervalo') },
      { label: 'Carga semanal', render: (i) => (i.cargaSemanal ? `${Number(i.cargaSemanal)}h` : '-') },
      { label: 'Tolerância', render: (i) => `${Number(i.toleranciaMinutos ?? 0)} min` },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ]
  });

  R.novo_expediente = C.makeFormScreen({
    ...base,
    title: 'Novo Expediente',
    subtitle: 'Isto define o horário que a pessoa DEVE cumprir. O que ela realmente marcou fica em Registro de Ponto — são registros diferentes de propósito, e é a comparação entre os dois que produz atraso e hora extra.',
    entityLabel: 'expediente',
    endpoint: '/api/hr/work-schedules',
    itemKey: 'workSchedule',
    listSub: 'expedientes',
    editStateKey: 'hrEditScheduleId',
    sections: [
      {
        title: 'Identificação',
        fields: [
          { name: 'name', label: 'Nome do expediente', required: true, hint: 'Ex.: Administrativo, Produção 1º turno' },
          { name: 'diasSemana', label: 'Escala', type: 'select', empty: 'Não informada', options: ESCALAS },
          { name: 'cargaSemanal', label: 'Carga semanal (horas)', type: 'number', step: '0.5', min: 0, hint: 'O número do contrato: 44, 40, 30, 20.' }
        ]
      },
      {
        title: 'Horário',
        description: 'Deixe o intervalo em branco para jornada sem pausa — abaixo de 6 horas diárias a lei não exige.',
        columns: 4,
        fields: [
          { name: 'entrada', label: 'Entrada', type: 'time' },
          { name: 'saidaAlmoco', label: 'Saída para intervalo', type: 'time' },
          { name: 'voltaAlmoco', label: 'Volta do intervalo', type: 'time' },
          { name: 'saida', label: 'Saída', type: 'time' }
        ]
      },
      {
        title: 'Regras',
        fields: [
          { name: 'toleranciaMinutos', label: 'Tolerância (minutos)', type: 'number', step: '1', min: 0, default: 5, hint: 'A CLT trata até 5 min por marcação, 10 no dia, como não computáveis.' },
          { name: 'active', label: 'Expediente ativo', type: 'checkbox', default: true }
        ]
      },
      {
        title: 'Observações',
        columns: 1,
        fields: [{ name: 'description', label: 'Descrição', type: 'textarea', full: true }]
      }
    ]
  });

  // ---------------------------------------------------- Tipos de colaborador
  R.tipos_colaborador = C.makeInlineRegisterScreen({
    ...base,
    title: 'Tipo Colaboradores',
    subtitle: 'O VÍNCULO: CLT, PJ, estágio, jovem aprendiz, temporário, autônomo. É diferente da categoria, que diz como a pessoa é remunerada.',
    tableTitle: 'Tipos de colaborador',
    entityLabel: 'tipo',
    endpoint: '/api/hr/employee-types',
    listKey: 'employeeTypes',
    itemKey: 'employeeType',
    searchFields: ['name', 'description'],
    searchPlaceholder: 'Nome do tipo',
    columns: [
      { label: 'Tipo', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Registro em carteira', render: (i) => simNao(i.registroClt !== false) },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ],
    fields: [
      { name: 'name', label: 'Nome do tipo', required: true, hint: 'Ex.: CLT, PJ, Estágio' },
      { name: 'registroClt', label: 'Tem registro em carteira', type: 'checkbox', default: true },
      { name: 'active', label: 'Tipo ativo', type: 'checkbox', default: true },
      { name: 'description', label: 'Descrição', type: 'textarea', rows: 2, full: true }
    ]
  });

  // ------------------------------------------------ Categorias de colaborador
  R.categorias_colaborador = C.makeInlineRegisterScreen({
    ...base,
    title: 'Categoria Colaboradores',
    subtitle: 'A FORMA DE REMUNERAÇÃO: mensalista, horista, diarista, comissionado. A base de cálculo diz o que o salário cadastrado significa.',
    tableTitle: 'Categorias de colaborador',
    entityLabel: 'categoria',
    endpoint: '/api/hr/employee-categories',
    listKey: 'employeeCategories',
    itemKey: 'employeeCategory',
    searchFields: ['name', 'description'],
    searchPlaceholder: 'Nome da categoria',
    columns: [
      { label: 'Categoria', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'Base de cálculo', render: (i) => nomeDe(BASE_CALCULO, i.baseCalculo || 'mensal') },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ],
    fields: [
      { name: 'name', label: 'Nome da categoria', required: true, hint: 'Ex.: Mensalista, Horista' },
      { name: 'baseCalculo', label: 'Base de cálculo', type: 'select', empty: null, default: 'mensal', options: BASE_CALCULO },
      { name: 'active', label: 'Categoria ativa', type: 'checkbox', default: true },
      { name: 'description', label: 'Descrição', type: 'textarea', rows: 2, full: true }
    ]
  });

  // ---------------------------------------------------------------- Profissões
  // Era "Cargos". A tabela continua hr_positions — renomear no banco custaria
  // uma migração de dados para trocar uma palavra que só aparece na tela.
  R.profissoes = C.makeInlineRegisterScreen({
    ...base,
    title: 'Profissões',
    subtitle: 'Profissões e faixas salariais do quadro. Excluir uma profissão NÃO exclui quem a exerce: o colaborador apenas fica sem profissão.',
    tableTitle: 'Profissões',
    entityLabel: 'profissão',
    endpoint: '/api/hr/positions',
    listKey: 'positions',
    itemKey: 'position',
    searchFields: ['name', 'description', 'cbo'],
    searchPlaceholder: 'Nome ou CBO',
    columns: [
      { label: 'Profissão', render: (i) => `<strong>${C.escape(i.name || '-')}</strong>` },
      { label: 'CBO', render: (i) => C.escape(i.cbo || '-') },
      { label: 'Faixa salarial', render: (i) => (i.salaryMin || i.salaryMax ? `${C.formatBRL(i.salaryMin)} a ${C.formatBRL(i.salaryMax)}` : '-') },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Situação', render: (i) => C.statusBadge(i.active === false ? 'inativo' : 'ativo') }
    ],
    formColumns: 4,
    fields: [
      { name: 'name', label: 'Nome da profissão', required: true },
      { name: 'cbo', label: 'CBO', hint: 'Classificação Brasileira de Ocupações — exigido pelo eSocial.' },
      { name: 'salaryMin', label: 'Salário mínimo (R$)', type: 'number', step: '0.01', min: 0 },
      { name: 'salaryMax', label: 'Salário máximo (R$)', type: 'number', step: '0.01', min: 0 },
      { name: 'description', label: 'Descrição / atribuições', type: 'textarea', rows: 2, full: true },
      { name: 'active', label: 'Profissão ativa', type: 'checkbox', default: true }
    ]
  });

  // ------------------------------------------------------ Férias e ausências
  R.ferias = C.makeListScreen({
    ...base,
    title: 'Férias e Afastamentos',
    subtitle: 'Férias, licenças, afastamentos e faltas registradas.',
    tableTitle: 'Ausências',
    endpoint: '/api/hr/leaves',
    listKey: 'leaves',
    newSub: 'nova_ausencia',
    newLabel: 'Nova ausência',
    editStateKey: 'hrEditLeaveId',
    searchFields: ['notes'],
    searchPlaceholder: 'Observação',
    filters: [{ name: 'kind', label: 'Tipo', type: 'select', options: TIPO_AUSENCIA }],
    columns: [
      { label: 'Colaborador', render: nomeColaborador },
      { label: 'Tipo', render: (i) => C.badge(TIPO_AUSENCIA.find((t) => t.id === i.kind)?.name || i.kind, i.kind === 'ferias' ? 'success' : 'info') },
      { label: 'Início', render: (i) => C.formatDate(i.startDate) },
      { label: 'Fim', render: (i) => C.formatDate(i.endDate) },
      { label: 'Observação', render: (i) => C.escape(i.notes || '-') }
    ]
  });

  R.nova_ausencia = C.makeFormScreen({
    ...base,
    title: 'Nova Ausência',
    subtitle: 'Deixe o fim em branco enquanto a ausência não tiver data de retorno.',
    entityLabel: 'ausência',
    endpoint: '/api/hr/leaves',
    itemKey: 'leave',
    listSub: 'ferias',
    editStateKey: 'hrEditLeaveId',
    sections: [
      {
        title: 'Ausência',
        fields: [
          { name: 'employeeId', label: 'Colaborador', type: 'select', required: true, options: (meta) => meta.employees || [] },
          { name: 'kind', label: 'Tipo', type: 'select', required: true, empty: null, default: 'ferias', options: TIPO_AUSENCIA },
          { name: 'startDate', label: 'Início', type: 'date', required: true },
          { name: 'endDate', label: 'Fim', type: 'date' }
        ]
      },
      { title: 'Observação', columns: 1, fields: [{ name: 'notes', label: 'Observação', type: 'textarea', full: true }] }
    ]
  });

  // --------------------------------------------------------------------- Ponto
  R.ponto = C.makeListScreen({
    ...base,
    title: 'Registro de Ponto',
    subtitle: 'Marcações por colaborador e dia. Só uma linha por pessoa em cada data.',
    tableTitle: 'Marcações',
    endpoint: '/api/hr/time-entries',
    listKey: 'timeEntries',
    newSub: 'novo_ponto',
    newLabel: 'Novo registro',
    editStateKey: 'hrEditTimeEntryId',
    searchFields: ['notes'],
    columns: [
      { label: 'Data', render: (i) => C.formatDate(i.date) },
      { label: 'Colaborador', render: nomeColaborador },
      { label: 'Entrada', render: (i) => hora(i.entrada) },
      { label: 'Saída almoço', render: (i) => hora(i.saidaAlmoco) },
      { label: 'Volta almoço', render: (i) => hora(i.voltaAlmoco) },
      { label: 'Saída', render: (i) => hora(i.saida) },
      { label: 'Observação', render: (i) => C.escape(i.notes || '-') }
    ]
  });

  R.novo_ponto = C.makeFormScreen({
    ...base,
    title: 'Novo Registro de Ponto',
    subtitle: 'O banco recusa dois registros do mesmo colaborador na mesma data.',
    entityLabel: 'registro',
    endpoint: '/api/hr/time-entries',
    itemKey: 'timeEntry',
    listSub: 'ponto',
    editStateKey: 'hrEditTimeEntryId',
    sections: [
      {
        title: 'Dia',
        fields: [
          { name: 'employeeId', label: 'Colaborador', type: 'select', required: true, options: (meta) => meta.employees || [] },
          { name: 'date', label: 'Data', type: 'date', required: true }
        ]
      },
      {
        title: 'Marcações',
        columns: 4,
        fields: [
          { name: 'entrada', label: 'Entrada', type: 'time' },
          { name: 'saidaAlmoco', label: 'Saída almoço', type: 'time' },
          { name: 'voltaAlmoco', label: 'Volta almoço', type: 'time' },
          { name: 'saida', label: 'Saída', type: 'time' }
        ]
      },
      { title: 'Observação', columns: 1, fields: [{ name: 'notes', label: 'Observação', type: 'textarea', full: true }] }
    ]
  });
})(window.MavisCadastros);
