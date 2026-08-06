window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// Mesma coleção usada pela tela de Depósitos em Cadastros — aqui ela aparece
// dentro do Estoque, que é onde os depósitos são efetivamente usados.
window.MavisSubscreenRegistry.stock.deposits = window.MavisStock.makeListScreen({
  title: 'Depósitos',
  subtitle: 'Locais físicos de armazenagem. O saldo de cada produto é controlado por depósito.',
  endpoint: '/api/stock/deposits',
  listKey: 'deposits',
  newSub: 'new_deposit',
  newLabel: 'Novo depósito',
  editStateKey: 'stockEditDepositId',
  searchFields: ['name', 'code', 'city', 'manager'],
  searchPlaceholder: 'Nome, código, cidade ou responsável',
  columns: [
    { label: 'Depósito', render: (item) => window.MavisStock.escape(item.name) },
    { label: 'Código', render: (item) => window.MavisStock.escape(item.code || '-') },
    { label: 'Cidade/UF', render: (item) => window.MavisStock.escape([item.city, item.state].filter(Boolean).join('/') || '-') },
    { label: 'Responsável', render: (item) => window.MavisStock.escape(item.manager || '-') },
    { label: 'Status', render: (item) => window.MavisStock.statusBadge(item.status) }
  ]
});
