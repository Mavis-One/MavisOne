window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// Telas novas do módulo Cadastros. As antigas (Pessoas: list/register/edit e
// Depósitos) continuam no app.js — quando a sub-tela é uma delas, este módulo
// devolve false e o router deixa o fluxo legado assumir.
const CADASTROS_LEGACY_SUBS = ['list', 'register', 'edit', 'deposits', 'deposits_register', 'deposits_edit'];

window.MavisModuleRegistry.cadastros = async function renderCadastros(ctx) {
  const { state } = ctx;
  const sub = state.activeSub || 'list';
  if (CADASTROS_LEGACY_SUBS.includes(sub)) return false;

  const registry = window.MavisSubscreenRegistry.cadastros || {};
  const renderer = registry[sub];
  if (!renderer) return false;

  await renderer(ctx);
  return true;
};
