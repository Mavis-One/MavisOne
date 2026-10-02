window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.product_categories = window.MavisStock.makeListScreen({
  title: 'Categorias de Produtos',
  endpoint: '/api/stock/product-categories',
  listKey: 'categories',
  newSub: 'new_product_category',
  newLabel: 'Nova categoria',
  editStateKey: 'stockEditProductCategoryId',
  columns: [
    { label: 'Categoria', render: (item) => window.MavisStock.escape(item.name) },
    { label: 'Código', render: (item) => window.MavisStock.escape(item.code || '-') },
    { label: 'Categoria pai', render: (item) => window.MavisStock.escape(item.parentName || '-') },
    { label: 'Status', render: (item) => window.MavisStock.statusBadge(item.status) }
  ]
});
