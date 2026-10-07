window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

// O retorno estimado vem pronto do servidor, que cruza a regra com o preço de
// venda atual do produto (que mora no Supabase).
window.MavisSubscreenRegistry.cadastros.cashback = window.MavisCadastros.makeListScreen({
  // Esta tela não lê nada da meta de Cadastros, então não a pede (era 1,4 MB
  // por abertura). Se passar a ler, declare a parte aqui —
  // scripts/test-meta-das-telas-de-cadastro.js cobra.
  metaPartes: [],
  title: 'CashBack por Produto',
  tableTitle: 'Regras de cashback',
  endpoint: '/api/cadastros/product-cashbacks',
  listKey: 'cashbacks',
  newSub: 'novo_cashback',
  newLabel: 'Nova regra',
  editStateKey: 'cadastroEditCashbackId',
  searchFields: ['productName', 'productSku'],
  searchPlaceholder: 'Produto ou SKU',
  filters: [
    { name: 'type', label: 'Tipo', type: 'select', options: [{ id: 'percentual', name: 'Percentual' }, { id: 'valor', name: 'Valor fixo' }] },
    { name: 'status', label: 'Status', type: 'select', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
  ],
  columns: [
    { label: 'Produto', render: (item) => window.MavisCadastros.escape(item.productName) },
    { label: 'SKU', render: (item) => window.MavisCadastros.escape(item.productSku || '-') },
    { label: 'Preço de venda', render: (item) => window.MavisCadastros.formatBRL(item.salePrice) },
    {
      label: 'Cashback',
      render: (item) => (item.type === 'percentual'
        ? `${Number(item.value || 0).toFixed(2)}%`
        : window.MavisCadastros.formatBRL(item.value))
    },
    { label: 'Retorno estimado', render: (item) => window.MavisCadastros.formatBRL(item.estimatedReturn) },
    { label: 'Compra mínima', render: (item) => (Number(item.minPurchase) > 0 ? window.MavisCadastros.formatBRL(item.minPurchase) : '-') },
    {
      label: 'Vigência',
      render: (item) => (item.validFrom || item.validTo
        ? `${window.MavisCadastros.formatDate(item.validFrom)} → ${window.MavisCadastros.formatDate(item.validTo)}`
        : 'Sem prazo')
    },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
