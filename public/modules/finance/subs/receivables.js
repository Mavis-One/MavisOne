window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

window.MavisSubscreenRegistry.finance.receivables = async function renderFinanceReceivables(ctx) {
  const { content, data } = ctx;

  const receivables = (data.finance || []).filter((entry) => String(entry.type || '').toLowerCase() === 'sale');

  content.innerHTML = `
    <div class="panel">
      <h3>Contas a receber</h3>
      <table class="table">
        <thead><tr><th>Referencia</th><th>Descricao</th><th>Valor</th><th>Status</th><th>Metodo</th></tr></thead>
        <tbody>
          ${receivables.map((entry) => `<tr><td>${entry.referenceId || '-'}</td><td>${entry.description || '-'}</td><td>R$ ${Number(entry.amount || 0).toFixed(2)}</td><td>${entry.status || '-'}</td><td>${entry.method || '-'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
};
