// ORIGENS DE VENDA — o formulário. Cria e edita.
//
// Ver o cabeçalho de sales_origins.js e o da migração fase-az.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.sales = window.MavisSubscreenRegistry.sales || {};

window.MavisSubscreenRegistry.sales.new_sales_origin = window.MavisStock.makeFormScreen({
  modulo: 'sales',
  title: 'Nova Origem de Venda',
  // O aviso sobre renomear fica aqui, e não só na resposta do servidor: quem
  // vai renomear lê isto ANTES de digitar. O registro guarda o NOME da origem,
  // não o id — renomear não reescreve os pedidos e orçamentos antigos.
  subtitle: 'Por onde a venda chegou (balcão, televendas, e-commerce, indicação). Atenção ao renomear: o registro guarda o nome, então pedidos e orçamentos antigos continuam com o nome anterior.',
  endpoint: '/api/sales/origins',
  itemKey: 'origin',
  listSub: 'sales_origins',
  editStateKey: 'salesEditOriginId',
  needsMeta: false,
  fields: [
    { name: 'name', label: 'Nome', required: true },
    { name: 'code', label: 'Código' },
    // Inativar é o caminho normal para uma origem que saiu de uso: some do
    // formulário de venda e o histórico continua explicável. Excluir só
    // funciona quando nenhum registro a usa — o servidor recusa o resto.
    { name: 'status', label: 'Status', type: 'select', empty: null, options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  rows: [[0, 1], [2], [3]]
});
