window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

// Os códigos são os da tabela `tBand` da NF-e, e os nomes acompanham. Guardar o
// código da SEFAZ, e não um nome interno, evita tradução no meio do caminho: o
// que está no cadastro é o que vai no XML.
const CREDENCIADORA_BANDEIRAS = {
  '01': 'Visa', '02': 'Mastercard', '03': 'American Express', '04': 'Sorocred',
  '05': 'Diners Club', '06': 'Elo', '07': 'Hipercard', '08': 'Aura',
  '09': 'Cabal', '99': 'Outros'
};

// Quem processa o cartão. O CNPJ daqui vai em pag/detPag/card/CNPJ da NF-e —
// sem ele a SEFAZ rejeita a nota com o código 225, que é falha de schema e só
// aparece DEPOIS de transmitir.
window.MavisSubscreenRegistry.cadastros.credenciadoras = window.MavisCadastros.makeListScreen({
  title: 'Credenciadoras de Cartão',
  subtitle: 'Rede, Cielo, Stone. O CNPJ daqui é o que a NF-e exige no grupo do cartão.',
  tableTitle: 'Credenciadoras cadastradas',
  endpoint: '/api/cadastros/card-acquirers',
  listKey: 'cardAcquirers',
  newSub: 'nova_credenciadora',
  newLabel: 'Nova credenciadora',
  editStateKey: 'cadastroEditCardAcquirerId',
  searchFields: ['name', 'cnpj'],
  searchPlaceholder: 'Nome ou CNPJ',
  filters: [
    { name: 'status', label: 'Status', type: 'select', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
  ],
  columns: [
    { label: 'Credenciadora', render: (item) => window.MavisCadastros.escape(item.name) },
    {
      label: 'CNPJ',
      render: (item) => {
        const d = String(item.cnpj || '').replace(/\D/g, '');
        if (d.length !== 14) return window.MavisCadastros.escape(item.cnpj || '-');
        return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
      }
    },
    {
      label: 'Bandeiras',
      // Vazio significa "não restringe", e é diferente de "nenhuma": dizer isso
      // por extenso evita que alguém saia procurando o cadastro que falta.
      render: (item) => window.MavisCadastros.escape(
        (item.brands || []).length
          ? item.brands.map((c) => CREDENCIADORA_BANDEIRAS[c] || c).join(', ')
          : 'Todas'
      )
    },
    {
      label: 'Formas que usam',
      // O número aqui evita o clique de excluir que já nasce recusado — mesma
      // ideia da coluna de usos na tela de Origens de Venda.
      render: (item) => window.MavisCadastros.escape(
        (item.formas || []).length ? item.formas.join(', ') : '-'
      )
    },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
