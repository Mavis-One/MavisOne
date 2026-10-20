window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// LIBERAÇÃO DA NF-e (fase ES, 19/10/2026). Quanto do pedido precisa estar
// recebido para a NF-e dele sair: integral (o padrão), a entrada ou um
// percentual. A regra é lib/faturamento-gate.js; quem grava é o administrador.
window.MavisSubscreenRegistry.settings.liberacao_nfe = async function renderLiberacaoNfe(ctx) {
  const { content, api, showToast, escapeHtml } = ctx;
  let dados;
  try {
    dados = await api('/api/settings/faturamento');
  } catch (error) {
    content.innerHTML = `<div class="panel"><p class="muted">${escapeHtml(error.message || 'Erro ao carregar a liberação da NF-e.')}</p></div>`;
    return;
  }
  const config = dados.config || { politica: 'desligada', percentual: 100 };
  const podeEditar = dados.podeEditar === true;
  const OPCOES = [
    // 20/10/2026 (fase EX): o padrão. A NF-e sai sem conferir o pagamento.
    { valor: 'desligada', rotulo: 'Desligada — a NF-e sai sem conferir o pagamento' },
    { valor: 'integral', rotulo: 'Integral — o pedido inteiro recebido' },
    { valor: 'entrada', rotulo: 'Entrada — a 1ª parcela recebida' },
    { valor: 'percentual', rotulo: 'Percentual — parte do pedido recebida' }
  ];

  function render() {
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div><h3>Liberação da NF-e</h3></div>
        </div>
        <form id="liberacaoNfeForm" class="form-grid liberacao-nfe-form">
          <label>Política
            <select name="politica" ${podeEditar ? '' : 'disabled'}>
              ${OPCOES.map((o) => `<option value="${o.valor}" ${config.politica === o.valor ? 'selected' : ''}>${escapeHtml(o.rotulo)}</option>`).join('')}
            </select>
          </label>
          <label id="liberacaoNfePercentual" ${config.politica === 'percentual' ? '' : 'hidden'}>Percentual recebido (%)
            <input type="number" name="percentual" min="1" max="100" step="0.01" value="${Number(config.percentual || 100)}" ${podeEditar ? '' : 'disabled'} />
          </label>
          ${podeEditar ? '<div class="finance-actions-row"><button type="submit">Salvar</button></div>' : ''}
        </form>
      </div>
    `;
    const form = document.getElementById('liberacaoNfeForm');
    form.querySelector('[name="politica"]').addEventListener('change', (event) => {
      document.getElementById('liberacaoNfePercentual').hidden = event.target.value !== 'percentual';
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const botao = form.querySelector('button[type="submit"]');
      if (botao) botao.disabled = true;
      try {
        const resposta = await api('/api/settings/faturamento', {
          method: 'PUT',
          body: JSON.stringify({ politica: formData.get('politica'), percentual: Number(formData.get('percentual') || 100) })
        });
        Object.assign(config, resposta.config || {});
        showToast('Liberação da NF-e salva.', 'success');
        render();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar a liberação da NF-e.', 'error');
        if (botao) botao.disabled = false;
      }
    });
  }
  render();
};
