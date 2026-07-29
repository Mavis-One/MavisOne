window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.finance = async function renderFinance(ctx) {
  const { api, state } = ctx;
  const data = await api('/api/finance');
  const sub = state.activeSub || 'payables';

  const registry = window.MavisSubscreenRegistry.finance || {};
  const allowedSubs = ['payables', 'receivables'];
  const targetSub = allowedSubs.includes(sub) ? sub : 'payables';
  const renderer = registry[targetSub] || registry.payables;
  if (targetSub !== sub) {
    state.activeSub = targetSub;
  }
  if (!renderer) return;

  await renderer({ ...ctx, data });
};
