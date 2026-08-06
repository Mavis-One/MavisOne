window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

const TASK_PRIORITY_META = {
  baixa: { label: 'Baixa', tone: 'muted' },
  media: { label: 'Média', tone: 'info' },
  alta: { label: 'Alta', tone: 'danger' }
};

window.MavisSubscreenRegistry.cadastros.agenda = window.MavisCadastros.makeListScreen({
  title: 'Agenda de Tarefas',
  subtitle: 'Tarefas internas com responsável, prazo e prioridade.',
  tableTitle: 'Tarefas',
  endpoint: '/api/cadastros/tasks',
  listKey: 'tasks',
  newSub: 'nova_tarefa',
  newLabel: 'Nova tarefa',
  editStateKey: 'cadastroEditTaskId',
  searchFields: ['title', 'description', 'personName', 'responsibleName'],
  searchPlaceholder: 'Título, descrição, cliente ou responsável',
  filters: [
    {
      name: 'status',
      label: 'Situação',
      type: 'select',
      options: [
        { id: 'pendente', name: 'Pendente' }, { id: 'em-andamento', name: 'Em andamento' },
        { id: 'concluida', name: 'Concluída' }, { id: 'cancelada', name: 'Cancelada' }
      ]
    },
    {
      name: 'priority',
      label: 'Prioridade',
      type: 'select',
      options: [{ id: 'alta', name: 'Alta' }, { id: 'media', name: 'Média' }, { id: 'baixa', name: 'Baixa' }]
    },
    { name: 'responsibleId', label: 'Responsável', type: 'select', options: (meta) => meta.users }
  ],
  columns: [
    { label: 'Tarefa', render: (item) => window.MavisCadastros.escape(item.title) },
    {
      label: 'Prazo',
      render: (item) => {
        if (!item.dueDate) return '-';
        const atrasada = item.dueDate < new Date().toISOString().slice(0, 10)
          && !['concluida', 'cancelada'].includes(item.status);
        const texto = `${window.MavisCadastros.formatDate(item.dueDate)}${item.dueTime ? ` ${window.MavisCadastros.escape(item.dueTime)}` : ''}`;
        return atrasada ? window.MavisCadastros.badge(`${texto} (atrasada)`, 'danger') : texto;
      }
    },
    {
      label: 'Prioridade',
      render: (item) => {
        const meta = TASK_PRIORITY_META[item.priority] || TASK_PRIORITY_META.media;
        return window.MavisCadastros.badge(meta.label, meta.tone);
      }
    },
    { label: 'Responsável', render: (item) => window.MavisCadastros.escape(item.responsibleName || '-') },
    { label: 'Cliente', render: (item) => window.MavisCadastros.escape(item.personName || '-') },
    { label: 'Situação', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
