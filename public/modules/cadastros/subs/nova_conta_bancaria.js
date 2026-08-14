window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.nova_conta_bancaria = window.MavisCadastros.makeFormScreen({
  title: 'Nova Conta Bancária',
  subtitle: 'Banco, agência e número não podem se repetir em outra conta.',
  entityLabel: 'conta',
  endpoint: '/api/cadastros/bank-accounts',
  itemKey: 'bankAccount',
  listSub: 'contas_bancarias',
  editStateKey: 'cadastroEditBankAccountId',
  sections: [
    {
      title: 'Identificação',
      description: 'O nome é o que aparece nos lançamentos do Financeiro.',
      fields: [
        { name: 'name', label: 'Nome da conta', required: true, hint: 'Ex.: Banco do Brasil - CC' },
        {
          name: 'type',
          label: 'Tipo',
          type: 'select',
          empty: null,
          default: 'corrente',
          options: [
            { id: 'corrente', name: 'Conta corrente' }, { id: 'poupanca', name: 'Poupança' },
            { id: 'pagamento', name: 'Conta pagamento' }, { id: 'caixa', name: 'Caixa interno' },
            { id: 'investimento', name: 'Investimento' }
          ]
        },
        { name: 'status', label: 'Status', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
      ]
    },
    {
      title: 'Dados bancários',
      fields: [
        { name: 'bankCode', label: 'Código do banco', hint: 'Ex.: 001' },
        { name: 'bank', label: 'Banco' },
        { name: 'agency', label: 'Agência' },
        { name: 'agencyDigit', label: 'Dígito da agência' },
        { name: 'number', label: 'Número da conta' },
        { name: 'numberDigit', label: 'Dígito da conta' }
      ]
    }
  ],
  tabs: [
    {
      key: 'titular',
      label: 'Titular e PIX',
      sections: [
        {
          title: 'Titularidade',
          fields: [
            { name: 'holder', label: 'Titular' },
            { name: 'document', label: 'CPF/CNPJ do titular', documento: true },
            { name: 'pixKey', label: 'Chave PIX' }
          ]
        }
      ]
    },
    {
      key: 'saldo',
      label: 'Saldo e observações',
      sections: [
        {
          title: 'Saldo',
          fields: [
            { name: 'initialBalance', label: 'Saldo inicial', type: 'number', step: '0.01', default: 0 }
          ]
        },
        {
          title: 'Observações',
          columns: 1,
          fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
        }
      ]
    }
  ]
});
