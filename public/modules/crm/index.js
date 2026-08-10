window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.crm = async function renderCrm(ctx) {
  const { state } = ctx;
  const registry = window.MavisSubscreenRegistry.crm || {};
  const sub = registry[state.activeSub] ? state.activeSub : 'conexao';
  if (sub !== state.activeSub) state.activeSub = sub;
  if (!registry[sub]) return;
  await registry[sub](ctx);
};
