window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.catalogs = window.MavisStock.makeListScreen({
  title: 'Catálogos de Produtos',
  subtitle: 'Conjuntos de produtos com uma tabela de preços associada.',
  endpoint: '/api/stock/catalogs',
  listKey: 'catalogs',
  newSub: 'new_catalog',
  newLabel: 'Novo catálogo',
  editStateKey: 'stockEditCatalogId',
  searchFields: ['name', 'code', 'description'],
  columns: [
    { label: 'Catálogo', render: (item) => window.MavisStock.escape(item.name) },
    { label: 'Código', render: (item) => window.MavisStock.escape(item.code || '-') },
    { label: 'Tabela de preços', render: (item) => window.MavisStock.escape(item.priceTableName || 'Preço de venda do produto') },
    { label: 'Produtos', render: (item) => String(item.productCount || 0) },
    { label: 'Status', render: (item) => window.MavisStock.statusBadge(item.status) }
  ]
});
