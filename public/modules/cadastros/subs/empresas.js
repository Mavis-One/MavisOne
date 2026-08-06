window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

const TAX_REGIME_LABELS = {
  simples: 'Simples Nacional', presumido: 'Lucro Presumido',
  real: 'Lucro Real', mei: 'MEI'
};

function maskCnpjValue(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
  if (digits.length !== 14) return digits || '-';
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

window.MavisSubscreenRegistry.cadastros.empresas = window.MavisCadastros.makeListScreen({
  title: 'Empresas',
  subtitle: 'Empresas do grupo usadas como emitente nos documentos de venda.',
  tableTitle: 'Empresas cadastradas',
  endpoint: '/api/cadastros/companies',
  listKey: 'companies',
  newSub: 'nova_empresa',
  newLabel: 'Nova empresa',
  editStateKey: 'cadastroEditCompanyId',
  searchFields: ['name', 'tradeName', 'document', 'city'],
  searchPlaceholder: 'Razão social, fantasia ou CNPJ',
  filters: [
    { name: 'city', label: 'Cidade' },
    { name: 'state', label: 'UF' },
    {
      name: 'taxRegime',
      label: 'Regime tributário',
      type: 'select',
      options: Object.entries(TAX_REGIME_LABELS).map(([id, name]) => ({ id, name }))
    },
    { name: 'status', label: 'Status', type: 'select', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
  ],
  columns: [
    { label: 'Razão social', render: (item) => window.MavisCadastros.escape(item.name) },
    { label: 'Nome fantasia', render: (item) => window.MavisCadastros.escape(item.tradeName || '-') },
    { label: 'CNPJ', render: (item) => window.MavisCadastros.escape(maskCnpjValue(item.document)) },
    { label: 'Regime', render: (item) => window.MavisCadastros.escape(TAX_REGIME_LABELS[item.taxRegime] || '-') },
    { label: 'Cidade/UF', render: (item) => window.MavisCadastros.escape([item.city, item.state].filter(Boolean).join('/') || '-') },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
