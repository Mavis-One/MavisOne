window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_status_venda = window.MavisCadastros.makeFormScreen({
  title: 'Novo Status de Venda',
  subtitle: 'A ordem define a posição do status no funil; a cor identifica o pedido nas listas.',
  entityLabel: 'status',
  endpoint: '/api/cadastros/sale-statuses',
  itemKey: 'saleStatus',
  listSub: 'status_venda',
  editStateKey: 'cadastroEditSaleStatusId',
  sections: [
    {
      title: 'Identificação',
      fields: [
        { name: 'name', label: 'Nome do status', required: true },
        { name: 'code', label: 'Código' },
        {
          name: 'kind',
          label: 'Etapa do funil',
          type: 'select',
          empty: null,
          default: 'aberto',
          options: [
            { id: 'aberto', name: 'Aberto' }, { id: 'em-andamento', name: 'Em andamento' },
            { id: 'faturado', name: 'Faturado' }, { id: 'entregue', name: 'Entregue' },
            { id: 'cancelado', name: 'Cancelado' }
          ]
        }
      ]
    },
    {
      title: 'Apresentação',
      fields: [
        { name: 'color', label: 'Cor', type: 'color', default: '#3b82f6' },
        { name: 'order', label: 'Ordem de exibição', type: 'number', min: 0, default: 0 },
        { name: 'status', label: 'Situação', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
        { name: 'isDefault', label: 'Status padrão de novos pedidos', type: 'checkbox' }
      ]
    },
    {
      title: 'Observações',
      columns: 1,
      fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
    }
  ]
});
