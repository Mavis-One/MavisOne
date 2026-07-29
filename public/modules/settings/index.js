window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.settings = async function renderSettings(ctx) {
  const { api, state } = ctx;
  const data = await api('/api/settings');
  const sub = state.activeSub || 'company';

  const registry = window.MavisSubscreenRegistry.settings || {};
  const allowedSubs = ['company', 'users'];
  const targetSub = allowedSubs.includes(sub) ? sub : 'company';
  const renderer = registry[targetSub] || registry.company;
  if (targetSub !== sub) {
    state.activeSub = targetSub;
  }
  if (!renderer) return;

  await renderer({ ...ctx, data });
};
