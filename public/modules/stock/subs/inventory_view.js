window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// A FOLHA DE UM INVENTÁRIO (fase EG): o que foi gravado na geração, item por
// item. Não recalcula nada — é o documento como saiu. Sem entrada de menu, de
// propósito: precisa de um inventário escolhido na lista (como a conferência
// de carga).
window.MavisSubscreenRegistry.stock.inventory_view = async function renderStockInventoryView(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const S = window.MavisStock;

  function voltar() {
    state.stockInventoryId = '';
    state.activeSub = 'inventories';
    loadModule('stock');
  }

  const id = state.stockInventoryId || '';
  if (!id) return voltar();

  let inventario;
  let itens;
  try {
    const res = await api(`/api/stock/inventories/${encodeURIComponent(id)}`);
    inventario = res.inventory;
    itens = res.items || [];
  } catch (error) {
    showToast(error.message || 'Inventário não encontrado.', 'error');
    return voltar();
  }

  const VALORACAO = { custo_medio: 'Custo médio', custo_cadastro: 'Custo do cadastro' };
  // Quantidade com vírgula e milhar (3.250,09): S.formatQty devolve o ponto do JS.
  const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  const ORIGEM = {
    medio: ['Médio', 'success'],
    cadastro: ['Cadastro', 'warning'],
    sem_custo: ['Sem custo', 'danger']
  };
  const contagem = { medio: 0, cadastro: 0, sem_custo: 0 };
  itens.forEach((i) => { contagem[i.origemCusto] = (contagem[i.origemCusto] || 0) + 1; });
  let busca = '';

  function linhasFiltradas() {
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter((i) => `${i.sku} ${i.productName} ${i.ncm}`.toLowerCase().includes(termo));
  }

  function htmlTabela() {
    const linhas = linhasFiltradas();
    const somaQtd = linhas.reduce((t, i) => t + i.quantidade, 0);
    const valor = linhas.reduce((t, i) => t + i.valor, 0);
    return `
      <table class="table">
        <thead>
          <tr><th>SKU</th><th>Produto</th><th>NCM</th><th>Un.</th><th class="rel-num">Quantidade</th><th class="rel-num">Custo unitário</th><th class="rel-num">Valor</th><th>Custo</th></tr>
        </thead>
        <tbody>
          ${linhas.length === 0 ? S.emptyRow(8, 'Nenhum item.') : linhas.map((i) => {
            const selo = ORIGEM[i.origemCusto] || [i.origemCusto, 'muted'];
            return `
              <tr>
                <td>${S.escape(i.sku || '-')}</td>
                <td style="white-space:normal; min-width:240px;">${S.escape(i.productName)}</td>
                <td>${S.escape(i.ncm || '-')}</td>
                <td>${S.escape(i.unidade || '-')}</td>
                <td class="rel-num">${qtd(i.quantidade)}</td>
                <td class="rel-num">${Number(i.custoUnitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                <td class="rel-num">${S.formatBRL(i.valor)}</td>
                <td>${S.badge(selo[0], selo[1])}</td>
              </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <th colspan="4">${linhas.length.toLocaleString('pt-BR')} item(ns)${busca ? ' (filtrados)' : ''}</th>
            <th class="rel-num">${qtd(Math.round(somaQtd * 1e4) / 1e4)}</th>
            <th></th>
            <th class="rel-num">${S.formatBRL(valor)}</th>
            <th></th>
          </tr>
        </tfoot>
      </table>`;
  }

  const gerado = inventario.createdAt ? new Date(inventario.createdAt) : null;
  const geradoEm = gerado && !Number.isNaN(gerado.getTime())
    ? `${gerado.toLocaleDateString('pt-BR')} às ${gerado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : '-';

  content.innerHTML = `
    <div class="panel">
      ${S.pageHead(
        `Inventário ${inventario.code}`,
        `${inventario.companyName} · referência ${S.formatDate(inventario.dataReferencia)}`,
        `<span class="inv-sem-impressao" style="display:contents;">
          <button type="button" class="secondary" id="invVoltar">Voltar</button>
          <button type="button" class="secondary" id="invImprimir">Imprimir</button>
          <button type="button" id="invExportar">Excel (CSV)</button>
        </span>`
      )}
      <div class="row">
        <div><strong>${Number(inventario.itens).toLocaleString('pt-BR')}</strong><p class="muted">Itens</p></div>
        <div><strong>${qtd(inventario.quantidadeTotal)}</strong><p class="muted">Unidades</p></div>
        <div><strong>${S.formatBRL(inventario.valorTotal)}</strong><p class="muted">Valor total</p></div>
        <div><strong>${S.escape(VALORACAO[inventario.valoracao] || inventario.valoracao)}</strong><p class="muted">Valoração</p></div>
      </div>
      <p class="muted">
        Gerado em ${geradoEm} por ${S.escape(inventario.createdByName || '-')} · motivo ${S.escape(inventario.motivo)}
        · depósitos: ${S.escape((inventario.depositos || []).map((d) => d.name).join(', ') || '-')}
        ${inventario.companyDocument ? ` · CNPJ ${S.escape(inventario.companyDocument)}` : ''}
      </p>
      ${inventario.valoracao === 'custo_medio' && (contagem.cadastro || contagem.sem_custo) ? `
        <p class="muted">${contagem.cadastro} item(ns) valorado(s) pelo custo do cadastro (sem entrada com custo até a data)${contagem.sem_custo ? ` e ${contagem.sem_custo} sem custo nenhum` : ''}.</p>` : ''}
      ${inventario.note ? `<p class="muted">Observação: ${S.escape(inventario.note)}</p>` : ''}
    </div>

    <div class="panel">
      <div class="inv-sem-impressao" style="margin-bottom:10px;">
        <input type="search" id="invBusca" placeholder="Buscar por SKU, produto ou NCM" style="max-width:360px;">
      </div>
      <div class="table-scroll" id="invTabela">${htmlTabela()}</div>
    </div>
  `;

  // Quem chega da lista vem rolado para baixo (a prévia fica no fim dela).
  window.scrollTo(0, 0);
  document.getElementById('invVoltar')?.addEventListener('click', voltar);
  document.getElementById('invImprimir')?.addEventListener('click', () => window.print());
  document.getElementById('invBusca')?.addEventListener('input', (event) => {
    busca = event.target.value || '';
    document.getElementById('invTabela').innerHTML = htmlTabela();
  });

  document.getElementById('invExportar')?.addEventListener('click', async () => {
    let url = null;
    try {
      const resposta = await fetch(`/api/stock/inventories/${encodeURIComponent(id)}/export`, {
        headers: { 'x-auth-token': (typeof getSessionToken === 'function' ? getSessionToken() : '') || '' }
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        showToast(corpo.error || `Não consegui exportar (HTTP ${resposta.status}).`, 'error');
        return;
      }
      const nome = (/filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') || '') || [])[1]
        || `inventario-${inventario.code}.csv`;
      url = URL.createObjectURL(await resposta.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (erro) {
      showToast(erro.message || 'Não consegui exportar.', 'error');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  });
};
