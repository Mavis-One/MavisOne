window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const FINANCE_SUB_KEYS = ['dashboard', 'lancamentos', 'novo_lancamento', 'nfe_emitidas', 'nova_nfe_avulsa', 'extrato_open_finance', 'emitir_nfe_focus'];

const FINANCE_ROADMAP = {};

async function renderFinanceComingSoon(ctx) {
  const { content, state, loadModule } = ctx;
  const info = FINANCE_ROADMAP[state.activeSub] || { label: 'Esta página', phase: 'uma próxima fase' };

  content.innerHTML = `
    <div class="panel finance-coming-soon">
      <div class="finance-coming-soon-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4l2.5 2.5"></path></svg>
      </div>
      <h3>${info.label}</h3>
      <p class="muted">Esta página do módulo Financeiro está planejada para a <strong>${info.phase}</strong> da implementação e ainda não está disponível.</p>
      <button type="button" class="secondary" id="financeComingSoonBack">Voltar ao Dashboard</button>
    </div>
  `;

  document.getElementById('financeComingSoonBack')?.addEventListener('click', () => {
    state.activeSub = 'dashboard';
    loadModule('finance');
  });
}

window.MavisModuleRegistry.finance = async function renderFinance(ctx) {
  const { state } = ctx;
  const sub = state.activeSub || 'dashboard';
  const targetSub = FINANCE_SUB_KEYS.includes(sub) ? sub : 'dashboard';
  if (targetSub !== sub) {
    state.activeSub = targetSub;
  }

  const registry = window.MavisSubscreenRegistry.finance || {};
  const renderer = registry[targetSub] || renderFinanceComingSoon;
  await renderer(ctx);
};
