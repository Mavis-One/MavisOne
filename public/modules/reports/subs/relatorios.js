window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.reports = window.MavisSubscreenRegistry.reports || {};

// As quatro telas de Relatórios vivem no mesmo arquivo porque compartilham o
// mesmo cabeçalho, o mesmo seletor de período e a mesma fonte de dados — separá-las
// em quatro arquivos duplicaria os três.

const REL_GRANULARIDADES = [
  { chave: 'day', rotulo: 'Diário' },
  { chave: 'week', rotulo: 'Semanal' },
  { chave: 'month', rotulo: 'Mensal' },
  { chave: 'year', rotulo: 'Anual' }
];

function relBRL(valor) {
  // financeFormatBRL vem do módulo Financeiro e é o formato usado no resto do
  // sistema; o fallback existe só para o caso de o script não ter carregado.
  if (typeof financeFormatBRL === 'function') return financeFormatBRL(valor);
  return `R$ ${Number(valor || 0).toFixed(2)}`;
}

// Cabeçalho comum: título do relatório + escolha do período. O período só
// aparece onde muda alguma coisa (os relatórios com série no tempo).
function relCabecalho(ctx, titulo, descricao, comPeriodo) {
  const { escapeHtml, granularidade } = ctx;
  return `
    <section class="panel workspace-head">
      <div>
        <strong>${escapeHtml(titulo)}</strong>
        <p class="muted">${escapeHtml(descricao)}</p>
      </div>
      ${comPeriodo ? `
        <div class="finance-granularity-group" role="tablist">
          ${REL_GRANULARIDADES.map((g) => `<button type="button" class="finance-pill finance-pill-sm ${g.chave === granularidade ? 'active' : ''}" data-rel-granularidade="${g.chave}">${g.rotulo}</button>`).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

function relLigarPeriodo(ctx) {
  const { content, state, loadModule } = ctx;
  content.querySelectorAll('[data-rel-granularidade]').forEach((botao) => {
    botao.addEventListener('click', () => {
      state.reportsGranularidade = botao.dataset.relGranularidade;
      loadModule('reports');
    });
  });
}

function relTabelaVazia(mensagem) {
  return `<tr><td colspan="9" class="muted">${mensagem}</td></tr>`;
}

// --- Relatório de Vendas ---------------------------------------------------
window.MavisSubscreenRegistry.reports.vendas = async function relVendas(ctx) {
  const { content, dados, escapeHtml } = ctx;
  const v = dados.vendas || {};
  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, 'Relatório de Vendas', 'Pedidos, orçamentos e faturamento no recorte escolhido.', true)}
      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'blue', label: 'Pedidos', value: String(v.totalPedidos || 0), sub: relBRL(v.valorPedidos) })}
        ${financeStatCard({ tone: 'purple', label: 'Orçamentos', value: String(v.totalOrcamentos || 0), sub: relBRL(v.valorOrcamentos) })}
        ${financeStatCard({ tone: 'green', label: 'Faturados', value: String(v.pedidosFaturados || 0) })}
        ${financeStatCard({ tone: 'red', label: 'Pendentes', value: String(v.pedidosPendentes || 0) })}
        ${financeStatCard({ tone: 'teal', label: 'Ticket médio', value: relBRL(v.ticketMedio) })}
      </div>
      <section class="panel finance-panel-stripe-chart">
        <h3>Evolução</h3>
        <div class="finance-chart-legend">
          <span><i class="finance-legend-dot finance-legend-pedidos"></i> Pedidos</span>
          <span><i class="finance-legend-dot finance-legend-orcamentos"></i> Orçamentos</span>
        </div>
        <div class="finance-chart-wrap">
          ${financeBuildChartSvg(dados.serieVendas || [], escapeHtml, [
            { key: 'pedidos', cssClass: 'finance-chart-line-blue' },
            { key: 'orcamentos', cssClass: 'finance-chart-line-purple' }
          ])}
        </div>
      </section>
    </div>
  `;
  relLigarPeriodo(ctx);
};

// --- Relatório Financeiro --------------------------------------------------
window.MavisSubscreenRegistry.reports.financeiro = async function relFinanceiro(ctx) {
  const { content, dados, escapeHtml } = ctx;
  const pagar = dados.financeiro?.contasAPagar || {};
  const receber = dados.financeiro?.contasAReceber || {};
  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, 'Relatório Financeiro', 'Receitas, despesas e o que está em aberto.', true)}
      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'green', label: 'A receber', value: relBRL(receber.total), sub: `Vencidas ${relBRL(receber.vencidas)}` })}
        ${financeStatCard({ tone: 'red', label: 'A pagar', value: relBRL(pagar.total), sub: `Vencidas ${relBRL(pagar.vencidas)}` })}
        ${financeStatCard({ tone: 'blue', label: 'Recebido', value: relBRL(receber.recebidas) })}
        ${financeStatCard({ tone: 'purple', label: 'Pago', value: relBRL(pagar.pagas) })}
      </div>
      <section class="panel finance-panel-stripe-chart">
        <h3>Fluxo no período</h3>
        <div class="finance-chart-legend">
          <span><i class="finance-legend-dot finance-legend-receita"></i> Receitas</span>
          <span><i class="finance-legend-dot finance-legend-despesa"></i> Despesas</span>
          <span><i class="finance-legend-line"></i> Saldo</span>
        </div>
        <div class="finance-chart-wrap">
          ${financeBuildChartSvg(dados.serieFinanceiro || [], escapeHtml)}
        </div>
      </section>
    </div>
  `;
  relLigarPeriodo(ctx);
};

// --- Relatório de Estoque --------------------------------------------------
window.MavisSubscreenRegistry.reports.estoque = async function relEstoque(ctx) {
  const { content, dados, escapeHtml } = ctx;
  const e = dados.estoque || {};
  const maiores = e.maiores || [];
  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, 'Relatório de Estoque', 'Quanto dinheiro está parado, e em quê.', false)}
      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'blue', label: 'Produtos', value: String(e.totalProdutos || 0) })}
        ${financeStatCard({ tone: 'teal', label: 'Valor em estoque', value: relBRL(e.valorTotal) })}
        ${financeStatCard({ tone: 'red', label: 'Sem saldo', value: String(e.semSaldo || 0) })}
      </div>
      <section class="panel">
        <h3>Maiores valores parados</h3>
        <p class="muted">Custo × quantidade, do maior para o menor.</p>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Produto</th><th>SKU</th><th>Qtd.</th><th>Custo</th><th>Valor parado</th></tr></thead>
            <tbody>
              ${maiores.length ? maiores.map((p) => `
                <tr>
                  <td>${escapeHtml(p.name || '')}</td>
                  <td class="muted">${escapeHtml(p.sku || '')}</td>
                  <td>${p.quantidade}</td>
                  <td>${relBRL(p.custo)}</td>
                  <td><strong>${relBRL(p.valor)}</strong></td>
                </tr>
              `).join('') : relTabelaVazia('Nenhum produto com saldo e custo informados.')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
};

// --- Relatório por Vendedor ------------------------------------------------
window.MavisSubscreenRegistry.reports.vendedores = async function relVendedores(ctx) {
  const { content, dados, escapeHtml } = ctx;
  const lista = [...(dados.vendedores || [])].sort((a, b) => b.valorTotal - a.valorTotal);
  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, 'Relatório por Vendedor', 'Quanto cada vendedor fechou, do maior para o menor.', false)}
      <section class="panel">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Vendedor</th><th>Pedidos</th><th>Valor total</th><th>Ticket médio</th></tr></thead>
            <tbody>
              ${lista.length ? lista.map((s) => `
                <tr>
                  <td>${escapeHtml(s.sellerName || '')}</td>
                  <td>${s.totalPedidos}</td>
                  <td><strong>${relBRL(s.valorTotal)}</strong></td>
                  <td>${relBRL(s.ticketMedio)}</td>
                </tr>
              `).join('') : relTabelaVazia('Nenhum vendedor cadastrado — em Cadastros, marque uma pessoa com o papel "Vendedor".')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
};
