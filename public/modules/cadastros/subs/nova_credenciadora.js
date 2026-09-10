window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

// UMA CAIXA POR BANDEIRA, e não uma multi-seleção, porque a fábrica de
// formulários dos Cadastros não tem esse tipo de campo — ela conhece texto,
// número, select, textarea e checkbox. Dez caixas resolvem sem mexer na
// fábrica, e o servidor remonta o array `brands` a partir delas (ver a rota).
const CREDENCIADORA_CAIXAS_DE_BANDEIRA = [
  ['bandeira01', 'Visa'], ['bandeira02', 'Mastercard'], ['bandeira03', 'American Express'],
  ['bandeira04', 'Sorocred'], ['bandeira05', 'Diners Club'], ['bandeira06', 'Elo'],
  ['bandeira07', 'Hipercard'], ['bandeira08', 'Aura'], ['bandeira09', 'Cabal'],
  ['bandeira99', 'Outros']
].map(([name, label]) => ({ name, label, type: 'checkbox' }));

window.MavisSubscreenRegistry.cadastros.nova_credenciadora = window.MavisCadastros.makeFormScreen({
  title: 'Nova Credenciadora de Cartão',
  subtitle: 'O CNPJ vai para a SEFAZ no grupo do cartão da NF-e — confira antes de salvar.',
  entityLabel: 'credenciadora',
  endpoint: '/api/cadastros/card-acquirers',
  itemKey: 'cardAcquirer',
  listSub: 'credenciadoras',
  editStateKey: 'cadastroEditCardAcquirerId',
  sections: [
    {
      title: 'Identificação',
      description: 'Quem processa o cartão e repassa o dinheiro. A mesma credenciadora '
        + 'atende várias formas de pagamento e várias lojas — cadastre uma vez só.',
      fields: [
        { name: 'name', label: 'Nome', required: true, hint: 'Ex.: Rede, Cielo, Stone' },
        {
          name: 'cnpj', label: 'CNPJ da credenciadora', required: true, documento: true,
          hint: 'É este número que vai em pag/detPag/card/CNPJ da NF-e. CNPJ inválido volta como rejeição depois de transmitir.'
        },
        { name: 'status', label: 'Status', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
      ]
    }
  ],
  tabs: [
    {
      key: 'bandeiras',
      label: 'Bandeiras',
      sections: [
        {
          title: 'Bandeiras aceitas',
          description: 'Deixe todas desmarcadas para não restringir. Marcar limita o que o '
            + 'vendedor pode escolher no pedido — útil quando o contrato com a credenciadora não cobre todas.',
          fields: CREDENCIADORA_CAIXAS_DE_BANDEIRA
        }
      ]
    },
    {
      key: 'observacoes',
      label: 'Observações',
      sections: [
        {
          title: 'Observações',
          columns: 1,
          fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
        }
      ]
    }
  ]
});
