window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_movement_category = window.MavisStock.makeFormScreen({
  title: 'Nova Categoria de Movimentações',
  subtitle: 'Define o motivo que aparece nas movimentações de estoque.',
  endpoint: '/api/stock/movement-categories',
  itemKey: 'category',
  listSub: 'movement_categories',
  editStateKey: 'stockEditMovementCategoryId',
  fields: [
    { name: 'name', label: 'Nome', required: true },
    { name: 'code', label: 'Código' },
    {
      name: 'kind',
      label: 'Aplica-se a',
      type: 'select',
      empty: null,
      options: [{ id: 'ambos', name: 'Entrada e saída' }, { id: 'entrada', name: 'Somente entrada' }, { id: 'saida', name: 'Somente saída' }]
    },
    { name: 'status', label: 'Status', type: 'select', empty: null, options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  rows: [[0, 1], [2, 3], [4]]
});
