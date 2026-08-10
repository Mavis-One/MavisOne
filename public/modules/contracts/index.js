window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.contracts = async function renderContracts(ctx) {
  const { state } = ctx;
  const registry = window.MavisSubscreenRegistry.contracts || {};
  const sub = registry[state.activeSub] ? state.activeSub : 'contratos';
  if (sub !== state.activeSub) state.activeSub = sub;
  if (!registry[sub]) return;
  await registry[sub](ctx);
};
