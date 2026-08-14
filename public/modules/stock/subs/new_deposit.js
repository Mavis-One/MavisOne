window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_deposit = window.MavisStock.makeFormScreen({
  title: 'Novo Depósito',
  subtitle: 'Depósitos com movimentações não podem ser excluídos.',
  endpoint: '/api/stock/deposits',
  itemKey: 'deposit',
  listSub: 'deposits',
  editStateKey: 'stockEditDepositId',
  fields: [
    { name: 'name', label: 'Nome', required: true },
    { name: 'code', label: 'Código' },
    { name: 'status', label: 'Status', type: 'select', empty: null, options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
    { name: 'manager', label: 'Responsável' },
    { name: 'address', label: 'Endereço' },
    { name: 'city', label: 'Cidade' },
    { name: 'state', label: 'UF', mascara: 'uf' },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  rows: [[0, 1, 2], [3, 4], [5, 6], [7]]
});
