window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// Cada subtela do Estoque busca os próprios dados (mesmo padrão do Financeiro),
// então este arquivo só resolve qual renderizador chamar.
const STOCK_SUB_KEYS = [
  'price_manager',
  'movements', 'new_movement',
  'transfers', 'new_transfer',
  'products', 'new_product', 'product_status',
  'deposits', 'new_deposit',
  'price_tables', 'new_price_table',
  'catalogs', 'new_catalog',
  'product_categories', 'new_product_category',
  'movement_categories', 'new_movement_category'
];

window.MavisModuleRegistry.stock = async function renderStock(ctx) {
  const { state } = ctx;
  const sub = state.activeSub || 'products';
  const targetSub = STOCK_SUB_KEYS.includes(sub) ? sub : 'products';
  if (targetSub !== sub) {
    state.activeSub = targetSub;
  }

  const registry = window.MavisSubscreenRegistry.stock || {};
  const renderer = registry[targetSub] || registry.products;
  if (!renderer) return;

  await renderer(ctx);
};
