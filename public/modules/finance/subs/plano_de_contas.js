window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

// PLANO DE CONTAS (14/10/2026). Não havia tela: o plano só nascia pelo "+" do
// lançamento, com nome e mais nada. Pedido do usuário: o "+" leva à tela de
// cadastro de verdade. Aqui se cria e se edita (nome e tipo). Não há exclusão:
// os lançamentos apontam para o id.
window.MavisSubscreenRegistry.finance.plano_de_contas = async function renderPlanoDeContas(ctx) {
  const { content, api, showToast, escapeHtml, state } = ctx;
  const TIPOS = [
    { id: 'despesa', nome: 'Despesa' },
    { id: 'receita', nome: 'Receita' },
    { id: 'ambos', nome: 'Receita e despesa' }
  ];
  const nomeDoTipo = (id) => (TIPOS.find((t) => t.id === id) || TIPOS[2]).nome;
  // Veio do "+" do lançamento: abre no formulário de novo, com o tipo do
  // lançamento, e ao salvar (ou cancelar) volta para ele.
  const vindoDoLancamento = window.MavisRascunhoLancamento && window.MavisRascunhoLancamento.espera(state, 'category');

  let planos = [];
  let filtro = '';
  let editando = null; // null = fechado; {} = novo; plano = editando
  if (state.planoDeContasNovo) {
    editando = { name: '', type: state.planoDeContasNovo.type || 'despesa' };
    state.planoDeContasNovo = null;
  }

  async function carregar() {
    try {
      const meta = await api('/api/finance/meta?produtos=0&diretorio=0');
      planos = meta.categories || [];
    } catch (erro) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar o plano de contas: ${escapeHtml(erro.message || '')}</p></div>`;
      return false;
    }
    return true;
  }

  function formulario() {
    if (!editando) return '';
    return `
      <form id="pcForm" class="cadastro-section">
        <div class="cadastro-section-header"><h4>${editando.id ? 'Editar plano de contas' : 'Novo plano de contas'}</h4></div>
        <div class="cadastro-section-body">
          <div class="row">
            <label>Nome<input name="name" required maxlength="120" value="${escapeHtml(editando.name || '')}" /></label>
            <label>Tipo
              <select name="type">
                ${TIPOS.map((t) => `<option value="${t.id}" ${(editando.type || 'despesa') === t.id ? 'selected' : ''}>${t.nome}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="cadastro-list-actions">
            <button type="submit">Salvar</button>
            <button type="button" class="secondary" id="pcCancelar">Cancelar</button>
          </div>
        </div>
      </form>`;
  }

  function linhas() {
    const termo = textoDeBusca(filtro).trim();
    const lista = termo ? planos.filter((p) => textoDeBusca(p.name).includes(termo)) : planos;
    if (!lista.length) return `<tr><td colspan="3" class="muted">${planos.length ? 'Nada encontrado.' : 'Nenhum plano de contas cadastrado.'}</td></tr>`;
    return lista.map((p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(nomeDoTipo(p.type))}</td>
        <td><button type="button" class="secondary" data-pc-editar="${escapeHtml(p.id)}">Editar</button></td>
      </tr>`).join('');
  }

  function desenhar() {
    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Plano de Contas</h3>
          <p class="muted">${planos.length} conta${planos.length === 1 ? '' : 's'}</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="pcNovo">+ Novo Plano de Contas</button>
        </div>
      </div>
      ${formulario()}
      <div class="panel">
        <label class="cadastro-field"><span>Busca</span>
          <input id="pcBusca" type="search" value="${escapeHtml(filtro)}" autocomplete="off" />
        </label>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Nome</th><th>Tipo</th><th></th></tr></thead>
            <tbody id="pcLinhas">${linhas()}</tbody>
          </table>
        </div>
      </div>`;
    ligar();
  }

  function ligar() {
    document.getElementById('pcBusca')?.addEventListener('input', (evento) => {
      filtro = evento.target.value;
      const corpo = document.getElementById('pcLinhas');
      if (corpo) corpo.innerHTML = linhas();
      ligarEditar();
    });
    document.getElementById('pcNovo')?.addEventListener('click', () => {
      editando = { name: '', type: 'despesa' };
      desenhar();
      document.querySelector('#pcForm [name=name]')?.focus();
    });
    ligarEditar();
    document.getElementById('pcCancelar')?.addEventListener('click', () => {
      if (vindoDoLancamento && !editando.id && window.MavisRascunhoLancamento.voltar(ctx, '')) return;
      editando = null;
      desenhar();
    });
    document.getElementById('pcForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const botao = evento.target.querySelector('button[type=submit]');
      if (botao?.disabled) return;
      if (botao) botao.disabled = true;
      const dados = new FormData(evento.target);
      const corpo = { name: String(dados.get('name') || '').trim(), type: dados.get('type') || 'despesa' };
      try {
        let criado = null;
        if (editando.id) {
          await api(`/api/finance/categories/${encodeURIComponent(editando.id)}`, { method: 'PUT', body: JSON.stringify(corpo) });
        } else {
          criado = (await api('/api/finance/categories', { method: 'POST', body: JSON.stringify(corpo) })).category;
        }
        showToast('Plano de contas salvo.', 'success');
        if (criado && vindoDoLancamento && window.MavisRascunhoLancamento.voltar(ctx, criado.id)) return;
        editando = null;
        if (await carregar()) desenhar();
      } catch (erro) {
        showToast(erro.message || 'Erro ao salvar o plano de contas.', 'error');
        if (botao) botao.disabled = false;
      }
    });
  }

  function ligarEditar() {
    content.querySelectorAll('[data-pc-editar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editando = { ...(planos.find((p) => p.id === btn.dataset.pcEditar) || {}) };
        desenhar();
        document.getElementById('pcForm')?.scrollIntoView({ block: 'center' });
      });
    });
  }

  if (await carregar()) {
    desenhar();
    if (editando) document.querySelector('#pcForm [name=name]')?.focus();
  }
};
