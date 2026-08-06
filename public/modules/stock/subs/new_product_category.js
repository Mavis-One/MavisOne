window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_product_category = window.MavisStock.makeFormScreen({
  title: 'Nova Categoria de Produtos',
  subtitle: 'Categorias são usadas para filtrar produtos e agrupar relatórios.',
  endpoint: '/api/stock/product-categories',
  itemKey: 'category',
  listSub: 'product_categories',
  editStateKey: 'stockEditProductCategoryId',
  needsMeta: true,
  fields: [
    { name: 'name', label: 'Nome', required: true },
    { name: 'code', label: 'Código' },
    { name: 'parentId', label: 'Categoria pai', type: 'select', empty: 'Nenhuma (categoria raiz)', options: (meta) => meta.productCategories },
    { name: 'status', label: 'Status', type: 'select', empty: null, options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  rows: [[0, 1], [2, 3], [4]]
});
