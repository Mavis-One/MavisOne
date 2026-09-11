window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

const BANK_ACCOUNT_TYPE_LABELS = {
  corrente: 'Conta corrente', poupanca: 'Poupança', pagamento: 'Conta pagamento',
  caixa: 'Caixa interno', investimento: 'Investimento'
};

// Mesma coleção que o Financeiro usa nos lançamentos — por isso a exclusão é
// bloqueada quando há movimento vinculado.
window.MavisSubscreenRegistry.cadastros.contas_bancarias = window.MavisCadastros.makeListScreen({
  title: 'Contas Bancárias',
  subtitle: 'Contas usadas nos lançamentos e baixas do Financeiro.',
  tableTitle: 'Contas cadastradas',
  endpoint: '/api/cadastros/bank-accounts',
  listKey: 'bankAccounts',
  newSub: 'nova_conta_bancaria',
  newLabel: 'Nova conta bancária',
  editStateKey: 'cadastroEditBankAccountId',
  searchFields: ['name', 'bank', 'agency', 'number', 'holder'],
  searchPlaceholder: 'Nome, banco, agência ou titular',
  filters: [
    { name: 'bank', label: 'Banco' },
    {
      name: 'type',
      label: 'Tipo',
      type: 'select',
      options: Object.entries(BANK_ACCOUNT_TYPE_LABELS).map(([id, name]) => ({ id, name }))
    },
    { name: 'status', label: 'Status', type: 'select', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
  ],
  columns: [
    { label: 'Conta', render: (item) => window.MavisCadastros.escape(item.name) },
    { label: 'Banco', render: (item) => window.MavisCadastros.escape([item.bankCode, item.bank].filter(Boolean).join(' - ') || '-') },
    {
      label: 'Agência / Conta',
      render: (item) => {
        const agency = [item.agency, item.agencyDigit].filter(Boolean).join('-');
        const number = [item.number, item.numberDigit].filter(Boolean).join('-');
        return window.MavisCadastros.escape([agency, number].filter(Boolean).join(' / ') || '-');
      }
    },
    { label: 'Tipo', render: (item) => window.MavisCadastros.escape(BANK_ACCOUNT_TYPE_LABELS[item.type] || item.type || '-') },
    // Fase CD: de quem e' a conta. Fica na lista porque e' o que explica por que
    // uma conta aparece para uns e nao para outros — sem a coluna, a pergunta
    // "cade a conta X?" nao teria onde ser respondida.
    {
      label: 'Estabelecimento',
      render: (item, meta) => {
        if (!item.estabelecimentoId) return '<span class="muted">Todos</span>';
        const dono = ((meta && meta.estabelecimentos) || []).find((e) => e.id === item.estabelecimentoId);
        if (!dono) return '<span class="muted">-</span>';
        const ehMatriz = String(dono.tipo || '').toUpperCase() === 'MATRIZ';
        return window.MavisCadastros.escape(dono.nomeFantasia || dono.razaoSocial)
          + ` <span class="chip-estab ${ehMatriz ? 'is-matriz' : ''}">${ehMatriz ? 'matriz' : 'filial'}</span>`;
      }
    },
    { label: 'Titular', render: (item) => window.MavisCadastros.escape(item.holder || '-') },
    { label: 'Saldo inicial', render: (item) => window.MavisCadastros.formatBRL(item.initialBalance) },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
