window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_cashback = window.MavisCadastros.makeFormScreen({
  // O que esta tela lê da meta de Cadastros, e só isso: ela pede só estas
  // partes. Leitura nova da meta tem de entrar aqui — sem isso o select
  // fica vazio (scripts/test-meta-das-telas-de-cadastro.js cobra).
  metaPartes: ['products'],
  title: 'Nova Regra de CashBack',
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
