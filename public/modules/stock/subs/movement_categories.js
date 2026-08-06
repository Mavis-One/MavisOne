window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

const MOVEMENT_KIND_LABELS = { entrada: 'Entrada', saida: 'Saída', ambos: 'Entrada e saída' };

window.MavisSubscreenRegistry.stock.movement_categories = window.MavisStock.makeListScreen({
  title: 'Categorias de Movimentações',
  subtitle: 'Motivos de entrada e saída (compra, venda, perda, ajuste de inventário...).',
  endpoint: '/api/stock/movement-categories',
  listKey: 'categories',
  newSub: 'new_movement_category',
  newLabel: 'Nova categoria',
  editStateKey: 'stockEditMovementCategoryId',
  columns: [
    { label: 'Categoria', render: (item) => window.MavisStock.escape(item.name) },
    { label: 'Código', render: (item) => window.MavisStock.escape(item.code || '-') },
    { label: 'Aplica-se a', render: (item) => window.MavisStock.badge(MOVEMENT_KIND_LABELS[item.kind] || 'Entrada e saída', 'info') },
    { label: 'Status', render: (item) => window.MavisStock.statusBadge(item.status) }
  ]
});
