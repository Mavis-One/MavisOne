window.MavisModuleRegistry = window.MavisModuleRegistry || {};

window.MavisModuleRegistry.dashboard = async function renderDashboard(ctx) {
  const { api, content } = ctx;
  const data = await api('/api/dashboard');
  const dashboardPermissions = data.permissions || {};

  content.innerHTML = `
    <div class="cards">
      ${dashboardPermissions.sales ? `<div class="card"><h3>Vendas</h3><p>R$ ${data.salesTotal.toFixed(2)}</p></div>` : ''}
      ${dashboardPermissions.purchases ? `<div class="card"><h3>Compras</h3><p>R$ ${data.purchaseTotal.toFixed(2)}</p></div>` : ''}
      ${(dashboardPermissions.sales || dashboardPermissions.purchases) ? `<div class="card"><h3>Saldo</h3><p>R$ ${data.balance.toFixed(2)}</p></div>` : ''}
      ${(dashboardPermissions.sales && dashboardPermissions.finance) ? `<div class="card"><h3>Conc. pendente</h3><p>${data.pendingReconciliation}</p></div>` : ''}
    </div>
    <div class="panel">
      <h3>Resumo rapido</h3>
      ${dashboardPermissions.stock ? `<p>Produtos cadastrados: ${data.totalProducts}</p>` : ''}
      ${dashboardPermissions.sales ? `<p>Vendas registradas: ${data.totalSales}</p>` : ''}
      ${dashboardPermissions.purchases ? `<p>Compras registradas: ${data.totalPurchases}</p>` : ''}
      ${dashboardPermissions.stock ? `<p>Valor em estoque: R$ ${data.stockValue.toFixed(2)}</p>` : ''}
      ${(!dashboardPermissions.stock && !dashboardPermissions.sales && !dashboardPermissions.purchases) ? '<p>Sem informações disponíveis para os módulos liberados.</p>' : ''}
    </div>
  `;
};
