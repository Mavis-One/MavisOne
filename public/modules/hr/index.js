window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.hr = async function renderHr(ctx) {
  const { state } = ctx;
  const registry = window.MavisSubscreenRegistry.hr || {};
  const sub = registry[state.activeSub] ? state.activeSub : 'colaboradores';
  if (sub !== state.activeSub) state.activeSub = sub;
  if (!registry[sub]) return;
  await registry[sub](ctx);
};
