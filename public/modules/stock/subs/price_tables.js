window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.price_tables = window.MavisStock.makeListScreen({
  title: 'Tabelas de Preços',
  subtitle: 'Markup aplica um percentual sobre o custo; preço fixo usa o valor definido por produto.',
  endpoint: '/api/stock/price-tables',
  listKey: 'priceTables',
  newSub: 'new_price_table',
  newLabel: 'Nova tabela',
  editStateKey: 'stockEditPriceTableId',
  columns: [
    { label: 'Tabela', render: (item) => window.MavisStock.escape(item.name) },
    { label: 'Código', render: (item) => window.MavisStock.escape(item.code || '-') },
    {
      label: 'Tipo',
      render: (item) => (item.type === 'fixo'
        ? window.MavisStock.badge('Preço fixo', 'info')
        : window.MavisStock.badge(`Markup ${Number(item.markupPercent || 0).toFixed(2)}%`, 'success'))
    },
    { label: 'Produtos com preço', render: (item) => String(item.itemCount || 0) },
    {
      label: 'Vigência',
      render: (item) => (item.validFrom || item.validTo
        ? `${window.MavisStock.formatDate(item.validFrom)} → ${window.MavisStock.formatDate(item.validTo)}`
        : 'Sem prazo')
    },
    { label: 'Status', render: (item) => window.MavisStock.statusBadge(item.status) }
  ]
});
