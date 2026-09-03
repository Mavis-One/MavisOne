window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// Telas novas do módulo Vendas. TODAS as outras continuam no app.js — Vendas é
// um dos módulos mais antigos e ainda é desenhado lá inteiro.
//
// Este arquivo devolve `false` quando a sub-tela não é dele, e o router deixa o
// fluxo legado assumir. É o mesmo mecanismo que Cadastros usa; ver o comentário
// em public/modules/router.js.
//
// É assim, e não migrando Vendas de uma vez, porque mover uma tela por vez
// deixa cada passo verificável. Migrar as nove juntas seria um diff em que
// nenhuma delas está realmente lida.
window.MavisModuleRegistry.sales = async function renderSales(ctx) {
  const { state } = ctx;
  const registry = window.MavisSubscreenRegistry.sales || {};
  const renderer = registry[state.activeSub];
  if (!renderer) return false;
  await renderer(ctx);
  return true;
};
