// CATEGORIAS DE VENDA — a lista.
//
// Classifica a VENDA ("Varejo", "Atacado", "Bonificação"), não o que se vende.
// Até a fase AS este campo do pedido era preenchido com as categorias de
// PRODUTO do Estoque — o cadastro que havia à mão. Ver a migração fase-as.
//
// Reusa a fábrica de lista do módulo Estoque. Ela está sob `MavisStock` por
// onde nasceu, não por ser de estoque: monta o par lista+formulário a partir de
// uma descrição, e duplicá-la aqui seria manter duas cópias da mesma tabela.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.sales = window.MavisSubscreenRegistry.sales || {};

window.MavisSubscreenRegistry.sales.sales_categories = window.MavisStock.makeListScreen({
  modulo: 'sales',
  title: 'Categorias de Vendas',
  subtitle: 'Como a VENDA é classificada — varejo, atacado, bonificação. Diferente da categoria do produto, que diz o que se vende.',
  endpoint: '/api/sales/categories',
  listKey: 'categories',
  newSub: 'new_sales_category',
  newLabel: 'Nova categoria',
  editStateKey: 'salesEditCategoryId',
  columns: [
    { label: 'Categoria', render: (item) => window.MavisStock.escape(item.name) },
    { label: 'Código', render: (item) => window.MavisStock.escape(item.code || '-') },
    // Quantos pedidos usam. É o que decide se a categoria pode ser excluída ou
    // se deve ser inativada — e o servidor recusa a exclusão de uma em uso,
    // então mostrar o número aqui evita o clique que já nasce recusado.
    {
      label: 'Pedidos',
      render: (item) => (item.pedidos
        ? window.MavisStock.badge(`${item.pedidos} ${item.pedidos === 1 ? 'pedido' : 'pedidos'}`, 'info')
        : '<span class="muted">nenhum</span>')
    },
    { label: 'Status', render: (item) => window.MavisStock.statusBadge(item.status) }
  ]
});
