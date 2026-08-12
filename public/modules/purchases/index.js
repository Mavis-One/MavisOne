window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.purchases = async function renderPurchases(ctx) {
  const { api, state } = ctx;
  const data = await api('/api/purchases');
  const sub = state.activeSub || 'painel';

  const registry = window.MavisSubscreenRegistry.purchases || {};
  const renderer = registry[sub] || registry.painel;
  if (!registry[sub]) {
    state.activeSub = 'painel';
  }
  if (!renderer) return;

  await renderer({ ...ctx, data });
};
