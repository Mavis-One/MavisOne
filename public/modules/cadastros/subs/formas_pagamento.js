window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

const PAYMENT_TYPE_LABELS = {
  dinheiro: 'Dinheiro', pix: 'PIX', 'cartao-credito': 'Cartão de crédito',
  'cartao-debito': 'Cartão de débito', boleto: 'Boleto', transferencia: 'Transferência',
  cheque: 'Cheque', crediario: 'Crediário', outro: 'Outro'
};

window.MavisSubscreenRegistry.cadastros.formas_pagamento = window.MavisCadastros.makeListScreen({
  title: 'Formas de Pagamento',
  subtitle: 'Como o dinheiro entra e sai: parcelas, taxa e prazo de recebimento.',
  tableTitle: 'Formas de pagamento cadastradas',
  endpoint: '/api/cadastros/payment-methods',
  listKey: 'paymentMethods',
  newSub: 'nova_forma_pagamento',
  newLabel: 'Nova forma de pagamento',
  editStateKey: 'cadastroEditPaymentMethodId',
  searchFields: ['name', 'code'],
  filters: [
    {
      name: 'type',
      label: 'Tipo',
      type: 'select',
      options: Object.entries(PAYMENT_TYPE_LABELS).map(([id, name]) => ({ id, name }))
    },
    { name: 'status', label: 'Status', type: 'select', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
  ],
  columns: [
    {
      label: 'Forma de pagamento',
      render: (item) => `${window.MavisCadastros.escape(item.name)}${item.isDefault ? ` ${window.MavisCadastros.badge('Padrão', 'info')}` : ''}`
    },
    { label: 'Código', render: (item) => window.MavisCadastros.escape(item.code || '-') },
    { label: 'Tipo', render: (item) => window.MavisCadastros.escape(PAYMENT_TYPE_LABELS[item.type] || item.type) },
    { label: 'Parcelas', render: (item) => `até ${Number(item.installmentsMax || 1)}x` },
    { label: 'Taxa', render: (item) => `${Number(item.feePercent || 0).toFixed(2)}%` },
    { label: 'Recebimento', render: (item) => `${Number(item.daysToReceive || 0)} dia(s)` },
    { label: 'Conta bancária', render: (item) => window.MavisCadastros.escape(item.bankAccountName || '-') },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
