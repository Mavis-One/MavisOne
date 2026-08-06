window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

const SALE_STATUS_KIND_LABELS = {
  aberto: 'Aberto', 'em-andamento': 'Em andamento', faturado: 'Faturado',
  entregue: 'Entregue', cancelado: 'Cancelado'
};

window.MavisSubscreenRegistry.cadastros.status_venda = window.MavisCadastros.makeListScreen({
  title: 'Status de Venda',
  subtitle: 'Etapas pelas quais um pedido passa, com cor e ordem de exibição.',
  tableTitle: 'Status cadastrados',
  endpoint: '/api/cadastros/sale-statuses',
  listKey: 'saleStatuses',
  newSub: 'novo_status_venda',
  newLabel: 'Novo status',
  editStateKey: 'cadastroEditSaleStatusId',
  searchFields: ['name', 'code'],
  filters: [
    {
      name: 'kind',
      label: 'Etapa',
      type: 'select',
      options: Object.entries(SALE_STATUS_KIND_LABELS).map(([id, name]) => ({ id, name }))
    },
    { name: 'status', label: 'Status', type: 'select', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
  ],
  columns: [
    {
      label: 'Status',
      render: (item) => `
        <span style="display:inline-flex; align-items:center; gap:8px;">
          <span style="width:12px; height:12px; border-radius:50%; background:${window.MavisCadastros.escape(item.color || '#3b82f6')}; display:inline-block;"></span>
          ${window.MavisCadastros.escape(item.name)}
          ${item.isDefault ? window.MavisCadastros.badge('Padrão', 'info') : ''}
        </span>
      `
    },
    { label: 'Código', render: (item) => window.MavisCadastros.escape(item.code || '-') },
    { label: 'Etapa', render: (item) => window.MavisCadastros.escape(SALE_STATUS_KIND_LABELS[item.kind] || item.kind) },
    { label: 'Ordem', render: (item) => String(Number(item.order || 0)) },
    { label: 'Situação', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
