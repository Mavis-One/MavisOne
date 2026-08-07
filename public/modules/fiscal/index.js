window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.fiscal = async function renderFiscal(ctx) {
  const { state } = ctx;
  const registry = window.MavisSubscreenRegistry.fiscal || {};
  const sub = state.activeSub || 'tabelas';
  const renderer = registry[sub];
  // Sub-tela desconhecida cai na primeira do módulo, em vez de deixar a área
  // de conteúdo em branco.
  if (!renderer) {
    state.activeSub = 'tabelas';
    if (registry.tabelas) await registry.tabelas(ctx);
    return;
  }
  await renderer(ctx);
};
