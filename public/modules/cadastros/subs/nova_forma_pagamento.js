window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.nova_forma_pagamento = window.MavisCadastros.makeFormScreen({
  // O que esta tela lê da meta de Cadastros, e só isso: ela pede só estas
  // partes. Leitura nova da meta tem de entrar aqui — sem isso o select
  // fica vazio (scripts/test-meta-das-telas-de-cadastro.js cobra).
  metaPartes: ['bankAccounts', 'cardAcquirers'],
  title: 'Nova Forma de Pagamento',
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
        {
          // O CNPJ da credenciadora e' o que a NF-e exige no grupo do cartao
          // (fase BV). Fica na FORMA porque e' ela que representa o contrato:
          // "Cartao de Credito Rede 2-6x" tem uma credenciadora, uma taxa e um
          // prazo. O vendedor escolhe a forma; o CNPJ vai junto.
          name: 'cardAcquirerId', label: 'Credenciadora do cartão', type: 'select',
          empty: 'Nenhuma', options: (meta) => meta.cardAcquirers || []
        },
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
