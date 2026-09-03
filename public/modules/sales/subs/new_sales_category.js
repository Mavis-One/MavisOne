// CATEGORIAS DE VENDA — o formulário. Cria e edita.
//
// Ver o cabeçalho de sales_categories.js e o da migração fase-as.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.sales = window.MavisSubscreenRegistry.sales || {};

window.MavisSubscreenRegistry.sales.new_sales_category = window.MavisStock.makeFormScreen({
  modulo: 'sales',
  title: 'Nova Categoria de Vendas',
  // O aviso sobre renomear fica aqui, e não só na resposta do servidor: quem
  // vai renomear lê isto ANTES de digitar. O pedido guarda o NOME da categoria,
  // não o id — renomear não reescreve os pedidos antigos.
  subtitle: 'Classifica a venda (varejo, atacado, bonificação). Atenção ao renomear: o pedido guarda o nome, então os pedidos antigos continuam com o nome anterior.',
  endpoint: '/api/sales/categories',
  itemKey: 'category',
  listSub: 'sales_categories',
  editStateKey: 'salesEditCategoryId',
  needsMeta: false,
  fields: [
    { name: 'name', label: 'Nome', required: true },
    { name: 'code', label: 'Código' },
    // Inativar é o caminho normal para uma categoria que saiu de uso: some do
    // formulário de venda e os pedidos antigos continuam explicáveis. Excluir
    // só funciona quando nenhum pedido a usa — o servidor recusa o resto.
    { name: 'status', label: 'Status', type: 'select', empty: null, options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  rows: [[0, 1], [2], [3]]
});
