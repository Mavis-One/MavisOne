window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.nova_tarefa = window.MavisCadastros.makeFormScreen({
  title: 'Nova Tarefa',
  subtitle: 'Ao marcar como concluída, a data de conclusão é registrada automaticamente.',
  entityLabel: 'tarefa',
  endpoint: '/api/cadastros/tasks',
  itemKey: 'task',
  listSub: 'agenda',
  editStateKey: 'cadastroEditTaskId',
  sections: [
    {
      title: 'Tarefa',
      fields: [
        { name: 'title', label: 'Título', required: true },
        {
          name: 'priority',
          label: 'Prioridade',
          type: 'select',
          empty: null,
          default: 'media',
          options: [{ id: 'baixa', name: 'Baixa' }, { id: 'media', name: 'Média' }, { id: 'alta', name: 'Alta' }]
        },
        {
          name: 'status',
          label: 'Situação',
          type: 'select',
          empty: null,
          default: 'pendente',
          options: [
            { id: 'pendente', name: 'Pendente' }, { id: 'em-andamento', name: 'Em andamento' },
            { id: 'concluida', name: 'Concluída' }, { id: 'cancelada', name: 'Cancelada' }
          ]
        }
      ]
    },
    {
      title: 'Prazo e responsáveis',
      fields: [
        { name: 'dueDate', label: 'Data limite', type: 'date' },
        { name: 'dueTime', label: 'Hora limite', type: 'time' },
        { name: 'responsibleId', label: 'Responsável', type: 'select', empty: 'Nenhum', options: (meta) => meta.users },
        { name: 'personId', label: 'Cliente/empresa relacionada', type: 'select', empty: 'Nenhuma', options: (meta) => meta.directory }
      ]
    },
    {
      title: 'Detalhes',
      columns: 1,
      fields: [
        { name: 'description', label: 'Descrição', type: 'textarea', full: true },
        { name: 'notes', label: 'Observações', type: 'textarea', full: true, rows: 2 }
      ]
    }
  ]
});
