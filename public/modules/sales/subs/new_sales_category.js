// CATEGORIAS DE VENDA — o formulário. Cria e edita.
//
// Ver o cabeçalho de sales_categories.js e o da migração fase-as.
//
// FASE EF (13/10/2026): a categoria diz o que FAZ no sistema — finalidade,
// se altera o estoque, se gera financeiro, a operação fiscal da NF-e do pedido
// e a categoria financeira das contas a receber. A regra que usa esses campos
// está em shared/categoria_venda.js. Deixou de ser a fábrica do Estoque porque
// precisa de uma lista do servidor (categorias financeiras) e de sugerir os
// efeitos ao escolher a finalidade.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.sales = window.MavisSubscreenRegistry.sales || {};

window.MavisSubscreenRegistry.sales.new_sales_category = async function renderNovaCategoriaVenda(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;
  const CV = window.MavisCategoriaVenda;

  const editId = state.salesEditCategoryId || null;
  state.salesEditCategoryId = null;
  let atual = null;
  let financialCategories = [];
  const [, meta] = await Promise.all([
    editId
      ? api(`/api/sales/categories/${encodeURIComponent(editId)}`)
        .then((r) => { atual = r.category; })
        .catch(() => showToast('Não foi possível carregar a categoria para edição.', 'error'))
      : null,
    api('/api/sales/categories/meta').catch(() => ({ financialCategories: [] }))
  ]);
  financialCategories = (meta && meta.financialCategories) || [];

  const v = atual || { name: '', code: '', status: 'ativo', notes: '', finalidade: 'venda', alteraEstoque: true, geraFinanceiro: true, operacaoFiscal: 'VENDA', financialCategoryId: '' };
  const voltar = () => { state.activeSub = 'sales_categories'; loadModule('sales'); };

  content.innerHTML = `
    <div class="panel">
      ${S.pageHead(atual ? `Editar categoria: ${atual.name}` : 'Nova Categoria de Vendas')}
      <form id="categoriaVendaForm" class="form-grid">
        <div class="row">
          <label>Nome<input name="name" required value="${S.escape(v.name)}" /></label>
          <label>Código<input name="code" value="${S.escape(v.code)}" /></label>
          <label>Status<select name="status">${S.options([{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }], v.status, { empty: null })}</select></label>
        </div>
        <div class="row">
          <label>Finalidade<select name="finalidade" id="catVendaFinalidade">${S.options(CV.FINALIDADES, v.finalidade || 'venda', { empty: null })}</select></label>
          <label class="stock-check"><input type="checkbox" name="alteraEstoque" ${v.alteraEstoque !== false ? 'checked' : ''} /> Altera o estoque</label>
          <label class="stock-check"><input type="checkbox" name="geraFinanceiro" ${v.geraFinanceiro !== false ? 'checked' : ''} /> Gera financeiro (contas a receber)</label>
        </div>
        <div class="row">
          <label>Operação fiscal da NF-e<select name="operacaoFiscal">${S.options(CV.OPERACOES, v.operacaoFiscal || '', { empty: 'Venda (padrão)' })}</select></label>
          <label>Categoria financeira das contas a receber<select name="financialCategoryId">${S.options(financialCategories, v.financialCategoryId || '', { empty: 'Nenhuma' })}</select></label>
        </div>
        <div class="row">
          <label>Observações<textarea name="notes" rows="3">${S.escape(v.notes)}</textarea></label>
        </div>
        <div class="finance-actions-row">
          <button type="submit">${atual ? 'Salvar alterações' : 'Salvar'}</button>
          <button type="button" class="secondary" id="catVendaVoltar">Ver lista</button>
        </div>
      </form>
    </div>
  `;

  const form = document.getElementById('categoriaVendaForm');
  document.getElementById('catVendaVoltar')?.addEventListener('click', voltar);

  // A finalidade SUGERE os efeitos numa categoria nova. Na edição não mexe:
  // a pessoa já decidiu, e trocar o rótulo não pode desfazer a escolha calado.
  document.getElementById('catVendaFinalidade')?.addEventListener('change', (e) => {
    if (atual) return;
    const f = CV.finalidade(e.target.value);
    if (!f) return;
    form.querySelector('[name="alteraEstoque"]').checked = f.estoque;
    form.querySelector('[name="geraFinanceiro"]').checked = f.financeiro;
    form.querySelector('[name="operacaoFiscal"]').value = f.operacao || '';
  });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const botao = form.querySelector('button[type="submit"]');
    if (botao.disabled) return;
    const dados = new FormData(form);
    const corpo = {
      name: String(dados.get('name') || '').trim(),
      code: String(dados.get('code') || '').trim(),
      status: dados.get('status'),
      notes: String(dados.get('notes') || '').trim(),
      finalidade: dados.get('finalidade'),
      alteraEstoque: form.querySelector('[name="alteraEstoque"]').checked,
      geraFinanceiro: form.querySelector('[name="geraFinanceiro"]').checked,
      operacaoFiscal: dados.get('operacaoFiscal') || '',
      financialCategoryId: dados.get('financialCategoryId') || ''
    };
    if (!corpo.name) { showToast('Informe o nome da categoria.', 'warning'); return; }
    botao.disabled = true;
    try {
      const r = atual
        ? await api(`/api/sales/categories/${encodeURIComponent(atual.id)}`, { method: 'PUT', body: JSON.stringify(corpo) })
        : await api('/api/sales/categories', { method: 'POST', body: JSON.stringify(corpo) });
      showToast(atual ? 'Categoria atualizada.' : 'Categoria criada.', 'success');
      if (r && r.aviso) showToast(r.aviso, 'warning');
      voltar();
    } catch (erro) {
      botao.disabled = false;
      showToast(erro.message || 'Erro ao salvar a categoria.', 'error');
    }
  });
};
