window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRegistry.settings = async function renderSettings(ctx) {
  const { api, state } = ctx;
  const data = await api('/api/settings');
  // 'company' saiu da lista: era a tela dos três campos que ninguém lia, e o
  // que ela tinha de útil (a integração da Focus) mudou para a tela fiscal.
  // Uma sessão antiga com activeSub='company' guardado cai no padrão abaixo,
  // em vez de abrir uma tela em branco.
  const sub = state.activeSub || 'fiscal';

  const registry = window.MavisSubscreenRegistry.settings || {};
  const allowedSubs = ['users', 'users_register', 'users_edit', 'fiscal', 'access_control', 'access_logs'];
  const targetSub = allowedSubs.includes(sub) ? sub : 'fiscal';
  const renderer = registry[targetSub] || registry.fiscal;
  if (targetSub !== sub) {
    state.activeSub = targetSub;
  }
  if (!renderer) return;

  await renderer({ ...ctx, data });
};
