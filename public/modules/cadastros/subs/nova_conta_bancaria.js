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
        { name: 'status', label: 'Status', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
        // Fase CD: DE QUEM e' a conta. E' daqui que sai a regra padrao de quem
        // pode usa-la — sem dono, a conta vale para todo mundo, que e' como
        // toda conta anterior a esta fase esta'.
        //
        // `empty` diz "Sem dono" em vez de "Selecione": vazio aqui e' uma
        // escolha legitima e comum (conta da casa, caixa interno), e nao um
        // campo que a pessoa esqueceu de preencher.
        {
          name: 'estabelecimentoId',
          label: 'Estabelecimento',
          type: 'select',
          empty: 'Sem dono — vale para todos',
          hint: 'Quem pode usar esta conta sai daqui. Configurações › Contas por Estabelecimento ajusta caso a caso.',
          options: (meta) => (meta.estabelecimentos || []).map((e) => ({
            id: e.id,
            name: `${e.nomeFantasia || e.razaoSocial}${String(e.tipo || '').toUpperCase() === 'MATRIZ' ? ' (matriz)' : ''}`
          }))
        }
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
