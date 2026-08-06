window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_agendamento = window.MavisCadastros.makeFormScreen({
  title: 'Novo Agendamento',
  subtitle: 'O horário final precisa ser depois do inicial, e o responsável não pode ter dois compromissos sobrepostos.',
  entityLabel: 'agendamento',
  endpoint: '/api/cadastros/appointments',
  itemKey: 'appointment',
  listSub: 'agendamentos',
  editStateKey: 'cadastroEditAppointmentId',
  sections: [
    {
      title: 'Compromisso',
      fields: [
        { name: 'title', label: 'Título', required: true },
        {
          name: 'type',
          label: 'Tipo',
          type: 'select',
          empty: null,
          default: 'visita',
          options: [
            { id: 'visita', name: 'Visita' }, { id: 'reuniao', name: 'Reunião' },
            { id: 'instalacao', name: 'Instalação' }, { id: 'manutencao', name: 'Manutenção' },
            { id: 'entrega', name: 'Entrega' }, { id: 'outro', name: 'Outro' }
          ]
        },
        {
          name: 'status',
          label: 'Situação',
          type: 'select',
          empty: null,
          default: 'agendado',
          options: [
            { id: 'agendado', name: 'Agendado' }, { id: 'confirmado', name: 'Confirmado' },
            { id: 'realizado', name: 'Realizado' }, { id: 'cancelado', name: 'Cancelado' }
          ]
        }
      ]
    },
    {
      title: 'Data e horário',
      fields: [
        { name: 'date', label: 'Data', type: 'date', required: true },
        { name: 'startTime', label: 'Início', type: 'time' },
        { name: 'endTime', label: 'Término', type: 'time' }
      ]
    },
    {
      title: 'Envolvidos',
      fields: [
        { name: 'personId', label: 'Cliente/empresa', type: 'select', empty: 'Nenhum', options: (meta) => meta.directory },
        { name: 'responsibleId', label: 'Responsável', type: 'select', empty: 'Nenhum', options: (meta) => meta.users },
        { name: 'location', label: 'Local' }
      ]
    },
    {
      title: 'Observações',
      columns: 1,
      fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
    }
  ]
});
