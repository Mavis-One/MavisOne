window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_cashback = window.MavisCadastros.makeFormScreen({
  title: 'Nova Regra de CashBack',
  subtitle: 'Cada produto pode ter uma regra ativa por vez — inative a anterior para criar outra.',
  entityLabel: 'regra',
  endpoint: '/api/cadastros/product-cashbacks',
  itemKey: 'cashback',
  listSub: 'cashback',
  editStateKey: 'cadastroEditCashbackId',
  sections: [
    {
      title: 'Produto',
      fields: [
        { name: 'productId', label: 'Produto', type: 'select', required: true, options: (meta) => meta.products },
        { name: 'status', label: 'Status', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
      ]
    },
    {
      title: 'Regra',
      description: 'No tipo percentual o valor é limitado a 100%.',
      fields: [
        {
          name: 'type',
          label: 'Tipo de cashback',
          type: 'select',
          empty: null,
          default: 'percentual',
          options: [{ id: 'percentual', name: 'Percentual sobre a venda' }, { id: 'valor', name: 'Valor fixo' }]
        },
        { name: 'value', label: 'Valor do cashback', type: 'number', step: '0.01', min: 0, required: true },
        { name: 'minPurchase', label: 'Compra mínima', type: 'number', step: '0.01', min: 0, default: 0 }
      ]
    },
    {
      title: 'Vigência',
      fields: [
        { name: 'validFrom', label: 'Válido de', type: 'date' },
        { name: 'validTo', label: 'Válido até', type: 'date' }
      ]
    },
    {
      title: 'Observações',
      columns: 1,
      fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
    }
  ]
});
