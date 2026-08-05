window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.stock = async function renderStock(ctx) {
  const { api, state } = ctx;
  const data = await api('/api/stock');
  const sub = state.activeSub || 'products';

  const registry = window.MavisSubscreenRegistry.stock || {};
  const allowedSubs = ['products', 'movements'];
  const targetSub = allowedSubs.includes(sub) ? sub : 'products';
  const renderer = registry[targetSub] || registry.products;
  if (targetSub !== sub) {
    state.activeSub = targetSub;
  }
  if (!renderer) return;

  await renderer({ ...ctx, data });
};
