window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.pcp = async function renderPcp(ctx) {
  const { state } = ctx;
  const registry = window.MavisSubscreenRegistry.pcp || {};
  const sub = registry[state.activeSub] ? state.activeSub : 'painel';
  if (sub !== state.activeSub) state.activeSub = sub;
  if (!registry[sub]) return;
  await registry[sub](ctx);
};
