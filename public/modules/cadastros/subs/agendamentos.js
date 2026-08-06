window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

const APPOINTMENT_TYPE_LABELS = {
  visita: 'Visita', reuniao: 'Reunião', instalacao: 'Instalação',
  manutencao: 'Manutenção', entrega: 'Entrega', outro: 'Outro'
};

window.MavisSubscreenRegistry.cadastros.agendamentos = window.MavisCadastros.makeListScreen({
  title: 'Agendamentos',
  subtitle: 'Compromissos com clientes. O sistema avisa se o responsável já tem outro no mesmo horário.',
  tableTitle: 'Agendamentos',
  endpoint: '/api/cadastros/appointments',
  listKey: 'appointments',
  newSub: 'novo_agendamento',
  newLabel: 'Novo agendamento',
  editStateKey: 'cadastroEditAppointmentId',
  searchFields: ['title', 'personName', 'responsibleName', 'location'],
  searchPlaceholder: 'Título, cliente, responsável ou local',
  filters: [
    {
      name: 'type',
      label: 'Tipo',
      type: 'select',
      options: Object.entries(APPOINTMENT_TYPE_LABELS).map(([id, name]) => ({ id, name }))
    },
    {
      name: 'status',
      label: 'Situação',
      type: 'select',
      options: [
        { id: 'agendado', name: 'Agendado' }, { id: 'confirmado', name: 'Confirmado' },
        { id: 'realizado', name: 'Realizado' }, { id: 'cancelado', name: 'Cancelado' }
      ]
    },
    { name: 'responsibleId', label: 'Responsável', type: 'select', options: (meta) => meta.users },
    { name: 'date', label: 'Data' }
  ],
  columns: [
    {
      label: 'Quando',
      render: (item) => {
        const horario = [item.startTime, item.endTime].filter(Boolean).join(' - ');
        return `${window.MavisCadastros.formatDate(item.date)}${horario ? ` <span class="muted">${window.MavisCadastros.escape(horario)}</span>` : ''}`;
      }
    },
    { label: 'Compromisso', render: (item) => window.MavisCadastros.escape(item.title) },
    { label: 'Tipo', render: (item) => window.MavisCadastros.escape(APPOINTMENT_TYPE_LABELS[item.type] || item.type) },
    { label: 'Cliente', render: (item) => window.MavisCadastros.escape(item.personName || '-') },
    { label: 'Responsável', render: (item) => window.MavisCadastros.escape(item.responsibleName || '-') },
    { label: 'Local', render: (item) => window.MavisCadastros.escape(item.location || '-') },
    { label: 'Situação', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
