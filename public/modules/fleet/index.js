window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// Despachante padrão dos módulos novos: acha a tela pedida no registro e,
// quando não acha, cai na primeira do módulo em vez de deixar o conteúdo em
// branco. Frota, RH, PCP e Contratos usam exatamente este mesmo corpo.
window.MavisModuleRegistry.fleet = async function renderFleet(ctx) {
  const { state } = ctx;
  const registry = window.MavisSubscreenRegistry.fleet || {};
  const sub = registry[state.activeSub] ? state.activeSub : 'veiculos';
  if (sub !== state.activeSub) state.activeSub = sub;
  if (!registry[sub]) return;
  await registry[sub](ctx);
};
