window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

// CENTROS DE CUSTO (fase EK, 14/10/2026). Pedido do usuário: o usuário do
// Financeiro cria o centro de custo, dá o nome e vincula as empresas/filiais
// em que ele vale. No lançamento, o campo Centro de custo mostra os centros da
// empresa do lançamento (e os sem empresa, que valem para todas).
window.MavisSubscreenRegistry.finance.centros_de_custo = async function renderCentrosDeCusto(ctx) {
  const { content, api, showToast, escapeHtml, state } = ctx;
  // Veio do "+" do lançamento: abre já no formulário de novo, com a empresa
  // do lançamento marcada, e ao salvar (ou cancelar) volta para ele.
  const vindoDoLancamento = window.MavisRascunhoLancamento && window.MavisRascunhoLancamento.espera(state, 'costCenter');

  let centros = [];
  let estabelecimentos = [];
  let editando = null; // null = fechado; {} = novo; centro = editando
  if (state.centroDeCustoNovo) {
    editando = { name: '', estabelecimentoIds: state.centroDeCustoNovo.estabelecimentoIds || [] };
    state.centroDeCustoNovo = null;
  }

  const nomeDoEstab = (e) => {
    const nome = e.nomeFantasia || e.razaoSocial || 'Sem nome';
    return String(e.tipo || '').toUpperCase() === 'MATRIZ' ? `${nome} (matriz)` : nome;
  };
  const nomePorId = (id) => {
    const e = estabelecimentos.find((x) => x.id === id);
    return e ? nomeDoEstab(e) : 'Empresa removida';
  };

  async function carregar() {
    try {
      const meta = await api('/api/finance/meta?produtos=0&diretorio=0');
      centros = meta.costCenters || [];
      estabelecimentos = meta.estabelecimentos || [];
    } catch (erro) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar os centros de custo: ${escapeHtml(erro.message || '')}</p></div>`;
      return false;
    }
    return true;
  }

  function formulario() {
    if (!editando) return '';
    const marcadas = new Set(editando.estabelecimentoIds || []);
    return `
      <form id="ccForm" class="cadastro-section">
        <div class="cadastro-section-header"><h4>${editando.id ? 'Editar centro de custo' : 'Novo centro de custo'}</h4></div>
        <div class="cadastro-section-body">
          <label>Nome<input name="name" required maxlength="120" value="${escapeHtml(editando.name || '')}" /></label>
          <fieldset class="cc-empresas">
            <legend>Empresas</legend>
            ${estabelecimentos.map((e) => `
              <label class="cc-empresa">
                <input type="checkbox" name="estabelecimentoIds" value="${escapeHtml(e.id)}" ${marcadas.has(e.id) ? 'checked' : ''} />
                ${escapeHtml(nomeDoEstab(e))}
              </label>`).join('')}
          </fieldset>
          <div class="cadastro-list-actions">
            <button type="submit">Salvar</button>
            <button type="button" class="secondary" id="ccCancelar">Cancelar</button>
          </div>
        </div>
      </form>`;
  }

  function desenhar() {
    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Centros de Custo</h3>
          <p class="muted">${centros.length} centro${centros.length === 1 ? '' : 's'} de custo</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="ccNovo">+ Novo Centro de Custo</button>
        </div>
      </div>
      ${formulario()}
      <div class="panel">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Nome</th><th>Empresas</th><th></th></tr></thead>
            <tbody>
              ${centros.length ? centros.map((c) => `
                <tr>
                  <td>${escapeHtml(c.name)}</td>
                  <td>${(c.estabelecimentoIds || []).length
                    ? c.estabelecimentoIds.map((id) => escapeHtml(nomePorId(id))).join(', ')
                    : '<span class="muted">Todas</span>'}</td>
                  <td><button type="button" class="secondary" data-cc-editar="${escapeHtml(c.id)}">Editar</button></td>
                </tr>`).join('') : '<tr><td colspan="3" class="muted">Nenhum centro de custo cadastrado.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
    ligar();
  }

  function ligar() {
    document.getElementById('ccNovo')?.addEventListener('click', () => {
      editando = { name: '', estabelecimentoIds: [] };
      desenhar();
      document.querySelector('#ccForm [name=name]')?.focus();
    });
    content.querySelectorAll('[data-cc-editar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editando = { ...(centros.find((c) => c.id === btn.dataset.ccEditar) || {}) };
        desenhar();
        document.getElementById('ccForm')?.scrollIntoView({ block: 'center' });
      });
    });
    document.getElementById('ccCancelar')?.addEventListener('click', () => {
      if (vindoDoLancamento && !editando.id && window.MavisRascunhoLancamento.voltar(ctx, '')) return;
      editando = null;
      desenhar();
    });
    document.getElementById('ccForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const botao = evento.target.querySelector('button[type=submit]');
      if (botao?.disabled) return;
      if (botao) botao.disabled = true;
      const dados = new FormData(evento.target);
      const corpo = { name: String(dados.get('name') || '').trim(), estabelecimentoIds: dados.getAll('estabelecimentoIds') };
      try {
        let criado = null;
        if (editando.id) {
          await api(`/api/finance/cost-centers/${encodeURIComponent(editando.id)}`, { method: 'PUT', body: JSON.stringify(corpo) });
        } else {
          criado = (await api('/api/finance/cost-centers', { method: 'POST', body: JSON.stringify(corpo) })).costCenter;
        }
        showToast('Centro de custo salvo.', 'success');
        if (criado && vindoDoLancamento && window.MavisRascunhoLancamento.voltar(ctx, criado.id)) return;
        editando = null;
        if (await carregar()) desenhar();
      } catch (erro) {
        showToast(erro.message || 'Erro ao salvar o centro de custo.', 'error');
        if (botao) botao.disabled = false;
      }
    });
  }

  if (await carregar()) {
    desenhar();
    if (editando) document.querySelector('#ccForm [name=name]')?.focus();
  }
};
