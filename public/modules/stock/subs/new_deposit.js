window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

window.MavisSubscreenRegistry.stock.new_deposit = window.MavisStock.makeFormScreen({
  title: 'Novo Depósito',
  subtitle: 'Depósitos com movimentações não podem ser excluídos.',
  endpoint: '/api/stock/deposits',
  itemKey: 'deposit',
  listSub: 'deposits',
  editStateKey: 'stockEditDepositId',
  // needsMeta para a lista de filiais chegar ao campo Empresa.
  needsMeta: true,
  fields: [
    { name: 'name', label: 'Nome', required: true },
    { name: 'code', label: 'Código' },
    { name: 'status', label: 'Status', type: 'select', empty: null, options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] },
    // A FILIAL DONA DO DEPOSITO (fase CK).
    //
    // A coluna e a conferencia existem desde a fase AW, e Vendas ja usa: ao
    // escolher a empresa no pedido, o campo Deposito passa a oferecer os
    // depositos DELA. Faltava o campo aqui — o vinculo so podia ser gravado por
    // SQL, e um recurso que so o banco alcanca e um recurso que nao existe.
    //
    // "Todas as filiais" (vazio) e uma escolha legitima e e o padrao: um galpao
    // central serve a rede inteira, e obrigar a escolher uma filial mentiria
    // sobre ele. E' tambem o que mantem de pe os depositos ja cadastrados sem
    // empresa — ver o teste da fase AW: deposito sem loja continua aparecendo.
    {
      name: 'companyId',
      label: 'Filial (empresa dona do depósito)',
      type: 'select',
      empty: 'Todas as filiais',
      options: (meta) => (meta && meta.companies) || [],
      hint: 'Em branco, o depósito serve a qualquer filial. Escolhida, ele passa a ser oferecido só nas vendas dessa filial.'
    },
    { name: 'manager', label: 'Responsável' },
    { name: 'address', label: 'Endereço' },
    { name: 'city', label: 'Cidade' },
    { name: 'state', label: 'UF', mascara: 'uf' },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  rows: [[0, 1, 2], [3], [4, 5], [6, 7], [8]]
});
