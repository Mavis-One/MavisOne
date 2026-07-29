window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

window.MavisSubscreenRegistry.finance.payables = async function renderFinancePayables(ctx) {
  const { content, data, api, showToast, loadModule } = ctx;

  content.innerHTML = `
    <div class="panel">
      <h3>Conciliacao financeira</h3>
      <p class="muted">Cada venda gera um lancamento financeiro ligado ao mesmo registro.</p>
      <table class="table">
        <thead><tr><th>Tipo</th><th>Referencia</th><th>Descricao</th><th>Valor</th><th>Status</th></tr></thead>
        <tbody>
          ${data.finance.map((entry) => `<tr><td>${entry.type}</td><td>${entry.referenceId}</td><td>${entry.description}</td><td>R$ ${entry.amount.toFixed(2)}</td><td>${entry.status}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <h3>Adicionar lancamento</h3>
      <form id="financeForm" class="form-grid">
        <div class="row">
          <label>Tipo<select name="type"><option value="sale">Venda</option><option value="purchase">Compra</option></select></label>
          <label>Referencia<input name="referenceId" /></label>
          <label>Valor<input name="amount" type="number" step="0.01" required value="0" /></label>
        </div>
        <div class="row">
          <label>Descricao<input name="description" /></label>
          <label>Status<select name="status"><option value="paid">Pago</option><option value="pending">Pendente</option></select></label>
          <label>Metodo<input name="method" value="Dinheiro" /></label>
        </div>
        <button type="submit">Salvar lancamento</button>
      </form>
    </div>
  `;

  document.getElementById('financeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      await api('/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          type: formData.get('type'),
          referenceId: formData.get('referenceId'),
          description: formData.get('description'),
          amount: Number(formData.get('amount')),
          status: formData.get('status'),
          method: formData.get('method')
        })
      });
      showToast('Lancamento financeiro salvo com sucesso.', 'success');
      loadModule('finance');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar lancamento financeiro.', 'error');
    }
  });
};
