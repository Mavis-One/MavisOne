window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.nova_forma_pagamento = window.MavisCadastros.makeFormScreen({
  title: 'Nova Forma de Pagamento',
  subtitle: 'Marcar como padrão remove o padrão da forma anterior.',
  entityLabel: 'forma de pagamento',
  endpoint: '/api/cadastros/payment-methods',
  itemKey: 'paymentMethod',
  listSub: 'formas_pagamento',
  editStateKey: 'cadastroEditPaymentMethodId',
  sections: [
    {
      title: 'Identificação',
      fields: [
        { name: 'name', label: 'Nome', required: true },
        { name: 'code', label: 'Código' },
        {
          name: 'type',
          label: 'Tipo',
          type: 'select',
          empty: null,
          default: 'dinheiro',
          options: [
            { id: 'dinheiro', name: 'Dinheiro' }, { id: 'pix', name: 'PIX' },
            { id: 'cartao-credito', name: 'Cartão de crédito' }, { id: 'cartao-debito', name: 'Cartão de débito' },
            { id: 'boleto', name: 'Boleto' }, { id: 'transferencia', name: 'Transferência' },
            { id: 'cheque', name: 'Cheque' }, { id: 'crediario', name: 'Crediário' }, { id: 'outro', name: 'Outro' }
          ]
        }
      ]
    },
    {
      title: 'Condições',
      description: 'Usado para calcular parcelas e a previsão de recebimento.',
      fields: [
        { name: 'installmentsMax', label: 'Máximo de parcelas', type: 'number', min: 1, default: 1 },
        { name: 'feePercent', label: 'Taxa (%)', type: 'number', step: '0.01', min: 0, default: 0 },
        { name: 'daysToReceive', label: 'Prazo de recebimento (dias)', type: 'number', min: 0, default: 0 }
      ]
    },
    {
      title: 'Destino e situação',
      fields: [
        { name: 'bankAccountId', label: 'Conta bancária', type: 'select', empty: 'Nenhuma', options: (meta) => meta.bankAccounts },
        { name: 'status', label: 'Status', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
        { name: 'isDefault', label: 'Forma de pagamento padrão', type: 'checkbox' }
      ]
    },
    {
      title: 'Observações',
      columns: 1,
      fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
    }
  ]
});
