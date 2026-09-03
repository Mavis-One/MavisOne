// ORIGENS DE VENDA — a lista.
//
// Diz POR ONDE a venda chegou: balcão, televendas, e-commerce, indicação. É a
// outra metade da classificação — a categoria (sales_categories.js) diz O QUE a
// venda é, varejo ou atacado. As duas convivem na mesma venda: um atacado que
// entrou por televendas.
//
// Até a fase AZ esta lista era uma constante dentro do public/app.js, com seis
// nomes e sem tela. Quem vendia por WhatsApp escolhia "Venda Direta" e a
// pergunta "de onde vêm minhas vendas?" passava a ter uma resposta só. Ver a
// migração fase-az.
//
// Reusa a fábrica de lista do módulo Estoque, como as categorias — ela monta o
// par lista+formulário a partir de uma descrição, e duplicá-la aqui seria
// manter duas cópias da mesma tabela.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.sales = window.MavisSubscreenRegistry.sales || {};

window.MavisSubscreenRegistry.sales.sales_origins = window.MavisStock.makeListScreen({
  modulo: 'sales',
  title: 'Origens de Venda',
  subtitle: 'Por onde a venda chegou — balcão, televendas, e-commerce, indicação. Diferente da categoria, que diz o que a venda é.',
  endpoint: '/api/sales/origins',
  listKey: 'origins',
  newSub: 'new_sales_origin',
  newLabel: 'Nova origem',
  editStateKey: 'salesEditOriginId',
  columns: [
    { label: 'Origem', render: (item) => window.MavisStock.escape(item.name) },
    { label: 'Código', render: (item) => window.MavisStock.escape(item.code || '-') },
    // Quantos registros usam. É o que decide se a origem pode ser excluída ou
    // se deve ser inativada — e o servidor recusa a exclusão de uma em uso,
    // então mostrar o número aqui evita o clique que já nasce recusado.
    //
    // PEDIDOS E ORÇAMENTOS SOMADOS: as duas tabelas guardam sale_origin, e
    // contar só uma diria "ninguém usa" sobre uma origem viva em vinte
    // orçamentos.
    {
      label: 'Em uso',
      render: (item) => (item.usos
        ? window.MavisStock.badge(`${item.usos} ${item.usos === 1 ? 'registro' : 'registros'}`, 'info')
        : '<span class="muted">nenhum</span>')
    },
    { label: 'Status', render: (item) => window.MavisStock.statusBadge(item.status) }
  ]
});
