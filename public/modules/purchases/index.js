window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.purchases = async function renderPurchases(ctx) {
  const { api, state } = ctx;
  const data = await api('/api/purchases');
  const sub = state.activeSub || 'new_purchase';

  const registry = window.MavisSubscreenRegistry.purchases || {};
  const renderer = registry[sub] || registry.new_purchase;
  if (!registry[sub]) {
    state.activeSub = 'new_purchase';
  }
  if (!renderer) return;

  await renderer({ ...ctx, data });
};
