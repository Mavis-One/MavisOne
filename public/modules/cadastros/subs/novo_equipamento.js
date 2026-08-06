window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_equipamento = window.MavisCadastros.makeFormScreen({
  title: 'Novo Equipamento',
  subtitle: 'O número de série, quando informado, não pode se repetir.',
  entityLabel: 'equipamento',
  endpoint: '/api/cadastros/equipments',
  itemKey: 'equipment',
  listSub: 'equipamentos',
  editStateKey: 'cadastroEditEquipmentId',
  sections: [
    {
      title: 'Identificação',
      fields: [
        { name: 'name', label: 'Nome do equipamento', required: true },
        { name: 'code', label: 'Código interno' },
        { name: 'serialNumber', label: 'Número de série' }
      ]
    },
    {
      title: 'Especificação',
      fields: [
        { name: 'brand', label: 'Marca' },
        { name: 'model', label: 'Modelo' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          empty: null,
          default: 'ativo',
          options: [
            { id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' },
            { id: 'manutencao', name: 'Em manutenção' }, { id: 'baixado', name: 'Baixado' }
          ]
        }
      ]
    }
  ],
  tabs: [
    {
      key: 'localizacao',
      label: 'Localização',
      sections: [
        {
          title: 'Onde está o equipamento',
          fields: [
            { name: 'personId', label: 'Cliente/proprietário', type: 'select', empty: 'Nenhum', options: (meta) => meta.directory },
            { name: 'depositId', label: 'Depósito', type: 'select', empty: 'Nenhum', options: (meta) => meta.deposits },
            { name: 'location', label: 'Localização física', hint: 'Ex.: sala 2, rack B' }
          ]
        }
      ]
    },
    {
      key: 'aquisicao',
      label: 'Aquisição e garantia',
      sections: [
        {
          title: 'Aquisição',
          description: 'A garantia não pode terminar antes da data de aquisição.',
          fields: [
            { name: 'purchaseDate', label: 'Data de aquisição', type: 'date' },
            { name: 'warrantyUntil', label: 'Garantia até', type: 'date' },
            { name: 'purchaseValue', label: 'Valor de aquisição', type: 'number', step: '0.01', min: 0 }
          ]
        },
        {
          title: 'Observações',
          columns: 1,
          fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
        }
      ]
    }
  ]
});
