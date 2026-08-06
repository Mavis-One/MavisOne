window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.contatos = window.MavisCadastros.makeListScreen({
  title: 'Contatos',
  subtitle: 'Pessoas de contato vinculadas aos cadastros de pessoa física e jurídica.',
  tableTitle: 'Contatos cadastrados',
  endpoint: '/api/cadastros/contacts',
  listKey: 'contacts',
  newSub: 'novo_contato',
  newLabel: 'Novo contato',
  editStateKey: 'cadastroEditContactId',
  searchFields: ['name', 'email', 'phone', 'role', 'personName'],
  searchPlaceholder: 'Nome, e-mail, telefone ou cargo',
  filters: [
    { name: 'role', label: 'Cargo' },
    { name: 'department', label: 'Setor' },
    { name: 'status', label: 'Status', type: 'select', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
  ],
  columns: [
    { label: 'Contato', render: (item) => window.MavisCadastros.escape(item.name) },
    { label: 'Vinculado a', render: (item) => window.MavisCadastros.escape(item.personName || '-') },
    { label: 'Cargo', render: (item) => window.MavisCadastros.escape(item.role || '-') },
    { label: 'Setor', render: (item) => window.MavisCadastros.escape(item.department || '-') },
    { label: 'E-mail', render: (item) => window.MavisCadastros.escape(item.email || '-') },
    { label: 'Telefone', render: (item) => window.MavisCadastros.escape(item.phone || item.mobilePhone || '-') },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
