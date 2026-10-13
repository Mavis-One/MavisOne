window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// INVENTÁRIOS (fase EG).
//
// A tela Inventários do Viper: cada linha é o retrato do estoque de UMA empresa
// (todos os depósitos dela) no fim de um dia, com o valor pela valoração
// escolhida. Gerado, fica gravado — é um documento sobre uma data passada, e
// não pode mudar de número quando alguém lança um movimento retroativo.
//
// Gerar passa por uma PRÉVIA: a mesma conta, sem gravar, mostrando o total e o
// que ficou de fora (saldo negativo, produto sem custo). É ali que se descobre
// que a empresa errada foi escolhida, antes de existir um INV a excluir.
//
// Não confundir com Contagens de Estoque: a contagem ajusta o saldo; o
// inventário só lê.
window.MavisSubscreenRegistry.stock.inventories = async function renderStockInventories(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  // Sem `produtos`: esta tela não tem seletor de produto (ver Stock.loadMeta).
  const meta = await S.loadMeta(api, showToast, { produtos: false });
  const empresas = meta.companies || [];
  const filters = { companyId: '', ano: '' };
  let formAberto = false;
  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const form = { companyId: '', dataReferencia: hojeIso, valoracao: 'custo_medio', motivo: '01', note: '' };

  const VALORACAO = { custo_medio: 'Custo médio', custo_cadastro: 'Custo do cadastro' };
  // Quantidade com vírgula e milhar (3.250,09): S.formatQty devolve o ponto do JS.
  const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  // MOT_INV do H005 (Bloco H do SPED).
  const MOTIVOS = [
    { id: '01', name: '01 — No final no período' },
    { id: '02', name: '02 — Na mudança de forma de tributação da mercadoria' },
    { id: '03', name: '03 — Na solicitação da baixa cadastral, paralisação temporária e outras situações' },
    { id: '04', name: '04 — Na alteração de regime de pagamento' },
    { id: '05', name: '05 — Por determinação dos fiscos' },
    { id: '06', name: '06 — Para controle das mercadorias sujeitas ao regime de substituição tributária' }
  ];

  const formatarInstante = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  async function fetchInventarios() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    try {
      const res = await api(`/api/stock/inventories?${params.toString()}`);
      return res.inventories || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar os inventários.', 'error');
      return [];
    }
  }

  function abrir(id) {
    state.stockInventoryId = id;
    state.activeSub = 'inventory_view';
    loadModule('stock');
  }

  function lerFormulario() {
    const el = document.getElementById('invForm');
    if (!el) return;
    const dados = new FormData(el);
    Object.keys(form).forEach((k) => { form[k] = String(dados.get(k) ?? form[k]); });
  }

  function htmlPrevia(p) {
    const origem = p.pelaOrigem || {};
    const avisos = [];
    if (p.repetido) {
      avisos.push(`Já existe o <strong>${S.escape(p.repetido)}</strong> desta empresa nesta data, com a mesma valoração. Exclua-o antes de gerar de novo.`);
    }
    if (p.valoracao === 'custo_medio' && origem.cadastro > 0) {
      avisos.push(`${origem.cadastro} produto(s) sem entrada com custo até a data: valorados pelo <strong>custo do cadastro</strong>.`);
    }
    if (origem.semCusto > 0) {
      avisos.push(`${origem.semCusto} produto(s) <strong>sem custo nenhum</strong> (nem no cadastro): entram com valor zero.`);
    }
    if ((p.negativos || []).length) {
      avisos.push(`${p.negativos.length} produto(s) com <strong>saldo negativo</strong> nessa data ficaram de fora — inventário é o que existe na prateleira:`
        + `<ul style="margin:6px 0 0 18px;">${p.negativos.slice(0, 15).map((n) =>
          `<li>${S.escape(n.sku ? n.sku + ' — ' : '')}${S.escape(n.productName)}: ${qtd(n.quantidade)}</li>`).join('')}`
        + `${p.negativos.length > 15 ? `<li>… e mais ${p.negativos.length - 15}</li>` : ''}</ul>`);
    }
    return `
      <div class="panel" id="invPrevia">
        <h4 style="margin-top:0;">Prévia — nada foi gravado ainda</h4>
        <div class="row">
          <div><strong>${Number(p.itens).toLocaleString('pt-BR')}</strong><p class="muted">Itens</p></div>
          <div><strong>${qtd(p.quantidadeTotal)}</strong><p class="muted">Unidades</p></div>
          <div><strong>${S.formatBRL(p.valorTotal)}</strong><p class="muted">Valor total (${S.escape(VALORACAO[p.valoracao] || p.valoracao)})</p></div>
        </div>
        <p class="muted">${S.escape(p.companyName)} · referência ${S.formatDate(p.dataReferencia)} · depósitos: ${S.escape((p.depositos || []).map((d) => d.name).join(', '))}</p>
        ${avisos.map((a) => `<p class="muted">• ${a}</p>`).join('')}
        <div class="finance-actions-row">
          <button type="button" id="invGravar" ${p.repetido || !p.itens ? 'disabled' : ''}>Gerar inventário</button>
        </div>
      </div>
    `;
  }

  function htmlFormulario() {
    return `
      <div class="panel">
        <h4 style="margin-top:0;">Gerar inventário</h4>
        <form id="invForm" class="form-grid">
          <div class="row">
            <label>Empresa<select name="companyId" required>${S.options(empresas, form.companyId)}</select></label>
            <label>Data de referência<input type="date" name="dataReferencia" value="${S.escape(form.dataReferencia)}" max="${hojeIso}" required></label>
            <label>Valoração
              <select name="valoracao">
                ${Object.entries(VALORACAO).map(([id, nome]) => `<option value="${id}" ${form.valoracao === id ? 'selected' : ''}>${nome}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="row">
            <label>Motivo do inventário<select name="motivo">${S.options(MOTIVOS, form.motivo, { empty: null })}</select></label>
            <label>Observação<input type="text" name="note" maxlength="500" value="${S.escape(form.note)}"></label>
          </div>
          <p class="muted">Soma o saldo de todos os depósitos da empresa no fim do dia escolhido.
            Custo médio: médio ponderado das entradas com custo até essa data (compras, notas de entrada, contagens);
            o produto sem nenhuma entrada com custo usa o custo do cadastro.</p>
          <div class="finance-actions-row">
            <button type="submit">Ver prévia</button>
            <button type="button" class="secondary" id="invFechar">Fechar</button>
          </div>
        </form>
      </div>
      <div id="invPreviaCaixa"></div>
    `;
  }

  async function render() {
    const inventarios = await fetchInventarios();
    const anoAtual = hoje.getFullYear();
    const anos = [];
    for (let a = anoAtual; a >= anoAtual - 6; a -= 1) anos.push({ id: String(a), name: String(a) });

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead(
          'Inventários',
          'O estoque de cada empresa numa data, valorado e guardado.',
          '<button type="button" id="invNovo">Gerar inventário</button>'
        )}
        <form id="invFiltros" class="form-grid">
          <div class="row">
            <label>Empresa<select name="companyId">${S.options(empresas, filters.companyId, { empty: 'Todas' })}</select></label>
            <label>Ano<select name="ano">${S.options(anos, filters.ano, { empty: 'Todos' })}</select></label>
          </div>
          <div class="finance-actions-row">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="invLimpar">Limpar</button>
          </div>
        </form>
      </div>

      ${formAberto ? htmlFormulario() : ''}

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr><th>Código</th><th>Empresa</th><th>Ano</th><th>Data de referência</th><th>Gerado em</th><th>Itens</th><th>Valor total</th><th>Valoração</th><th>Usuário</th><th>Ações</th></tr>
            </thead>
            <tbody>
              ${inventarios.length === 0 ? S.emptyRow(10, 'Nenhum inventário gerado.') : inventarios.map((inv) => `
                <tr>
                  <td>${S.escape(inv.code)}</td>
                  <td style="white-space:normal; min-width:180px;">${S.escape(inv.companyName)}</td>
                  <td>${inv.ano || '-'}</td>
                  <td>${S.formatDate(inv.dataReferencia)}</td>
                  <td>${formatarInstante(inv.createdAt)}</td>
                  <td>${Number(inv.itens || 0).toLocaleString('pt-BR')}</td>
                  <td class="rel-num">${S.formatBRL(inv.valorTotal)}</td>
                  <td>${S.escape(VALORACAO[inv.valoracao] || inv.valoracao)}</td>
                  <td>${S.escape(inv.createdByName || '-')}</td>
                  <td>
                    <button type="button" class="secondary" data-abrir="${S.escape(inv.id)}">Ver</button>
                    <button type="button" class="icon-button" data-excluir="${S.escape(inv.id)}" data-codigo="${S.escape(inv.code)}" title="Excluir inventário">${S.trashIcon}</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:12px;">${inventarios.length} inventário(s).</p>
      </div>
    `;

    document.getElementById('invNovo')?.addEventListener('click', () => {
      formAberto = true;
      render();
    });
    document.getElementById('invFechar')?.addEventListener('click', () => {
      formAberto = false;
      render();
    });

    // Mudou qualquer campo, a prévia mostrada deixa de ser a do formulário.
    document.getElementById('invForm')?.addEventListener('change', () => {
      const caixa = document.getElementById('invPreviaCaixa');
      if (caixa) caixa.innerHTML = '';
    });

    document.getElementById('invForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      lerFormulario();
      const botao = event.target.querySelector('button[type="submit"]');
      if (botao) botao.disabled = true;
      try {
        const res = await api('/api/stock/inventories', {
          method: 'POST',
          body: JSON.stringify({ ...form, simular: true })
        });
        const caixa = document.getElementById('invPreviaCaixa');
        caixa.innerHTML = htmlPrevia(res.previa);
        document.getElementById('invGravar')?.addEventListener('click', gravar);
      } catch (error) {
        showToast(error.message || 'Erro ao calcular a prévia.', 'error');
      } finally {
        if (botao) botao.disabled = false;
      }
    });

    async function gravar(event) {
      event.target.disabled = true;
      lerFormulario();
      try {
        const res = await api('/api/stock/inventories', { method: 'POST', body: JSON.stringify(form) });
        showToast(`Inventário ${res.inventory.code} gerado.`, 'success');
        formAberto = false;
        abrir(res.inventory.id);
      } catch (error) {
        showToast(error.message || 'Erro ao gerar o inventário.', 'error');
        event.target.disabled = false;
      }
    }

    document.getElementById('invFiltros')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const dados = new FormData(event.target);
      Object.keys(filters).forEach((k) => { filters[k] = dados.get(k) || ''; });
      render();
    });
    document.getElementById('invLimpar')?.addEventListener('click', () => {
      Object.keys(filters).forEach((k) => { filters[k] = ''; });
      render();
    });

    content.querySelectorAll('[data-abrir]').forEach((btn) => {
      btn.addEventListener('click', () => abrir(btn.dataset.abrir));
    });

    content.querySelectorAll('[data-excluir]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmado = await confirmModal(
          `Excluir o inventário ${btn.dataset.codigo}? O estoque não muda — o inventário só lia o razão —,`
          + ' e dá para gerar de novo para a mesma data.'
        );
        if (!confirmado) return;
        try {
          await api(`/api/stock/inventories/${encodeURIComponent(btn.dataset.excluir)}`, { method: 'DELETE' });
          showToast('Inventário excluído.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir o inventário.', 'error');
        }
      });
    });
  }

  await render();
};
