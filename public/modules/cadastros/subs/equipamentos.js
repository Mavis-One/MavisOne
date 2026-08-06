window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.equipamentos = window.MavisCadastros.makeListScreen({
  title: 'Equipamentos',
  subtitle: 'Máquinas e equipamentos, próprios ou em posse de clientes, com controle de garantia.',
  tableTitle: 'Equipamentos cadastrados',
  endpoint: '/api/cadastros/equipments',
  listKey: 'equipments',
  newSub: 'novo_equipamento',
  newLabel: 'Novo equipamento',
  editStateKey: 'cadastroEditEquipmentId',
  searchFields: ['name', 'code', 'serialNumber', 'model', 'brand', 'personName'],
  searchPlaceholder: 'Nome, série, modelo ou cliente',
  filters: [
    { name: 'brand', label: 'Marca' },
    { name: 'model', label: 'Modelo' },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' },
        { id: 'manutencao', name: 'Em manutenção' }, { id: 'baixado', name: 'Baixado' }
      ]
    }
  ],
  columns: [
    { label: 'Equipamento', render: (item) => window.MavisCadastros.escape(item.name) },
    { label: 'Nº de série', render: (item) => window.MavisCadastros.escape(item.serialNumber || '-') },
    { label: 'Marca/Modelo', render: (item) => window.MavisCadastros.escape([item.brand, item.model].filter(Boolean).join(' / ') || '-') },
    { label: 'Cliente', render: (item) => window.MavisCadastros.escape(item.personName || '-') },
    { label: 'Depósito', render: (item) => window.MavisCadastros.escape(item.depositName || '-') },
    {
      label: 'Garantia',
      render: (item) => {
        if (!item.warrantyUntil) return '-';
        const vencida = item.warrantyUntil < new Date().toISOString().slice(0, 10);
        return window.MavisCadastros.badge(window.MavisCadastros.formatDate(item.warrantyUntil), vencida ? 'danger' : 'success');
      }
    },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
