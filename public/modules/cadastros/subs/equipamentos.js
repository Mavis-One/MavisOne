window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.equipamentos = window.MavisCadastros.makeListScreen({
  title: 'Equipamentos',
  subtitle: 'Máquinas e equipamentos, próprios ou em posse de clientes. A garantia é contada a partir da NF-e que vendeu — passe o mouse sobre a data para ver a conta.',
  tableTitle: 'Equipamentos cadastrados',
  endpoint: '/api/cadastros/equipments',
  listKey: 'equipments',
  newSub: 'novo_equipamento',
  newLabel: 'Novo equipamento',
  editStateKey: 'cadastroEditEquipmentId',
  searchFields: ['name', 'code', 'serialNumber', 'model', 'brand', 'personName', 'nfeNumero'],
  searchPlaceholder: 'Nome, série, modelo ou cliente',
  filters: [
    { name: 'brand', label: 'Marca' },
    { name: 'model', label: 'Modelo' },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' },
        { id: 'manutencao', name: 'Em manutenção' }, { id: 'baixado', name: 'Baixado' }
      ]
    }
  ],
  columns: [
    { label: 'Equipamento', render: (item) => window.MavisCadastros.escape(item.name) },
    { label: 'Nº de série', render: (item) => window.MavisCadastros.escape(item.serialNumber || '-') },
    { label: 'Marca/Modelo', render: (item) => window.MavisCadastros.escape([item.brand, item.model].filter(Boolean).join(' / ') || '-') },
    { label: 'Cliente', render: (item) => window.MavisCadastros.escape(item.personName || '-') },
    { label: 'Depósito', render: (item) => window.MavisCadastros.escape(item.depositName || '-') },
    { label: 'NF-e', render: (item) => window.MavisCadastros.escape(item.nfeNumero || '-') },
    {
      // A GARANTIA VEM COM O PORQUE (fase BB). Sem ele o usuario ve uma data e
      // nao tem como conferir se esta certa — e data que ninguem consegue
      // conferir volta a ser data em que ninguem confia. O `title` e' onde ele
      // cabe sem estourar a coluna.
      //
      // SEM GARANTIA NAO E' VENCIDA: a maquina que nunca teve garantia e a que
      // teve e acabou pedem conversas diferentes com o cliente, e pintar as duas
      // de vermelho apaga a diferenca. Ver shared/garantia.js.
      label: 'Garantia',
      render: (item) => {
        const porque = window.MavisCadastros.escape(item.warrantyPorque || '');
        if (item.warrantySituacao === 'sem-garantia') {
          return `<span class="muted" title="${porque}">sem garantia</span>`;
        }
        const dias = item.warrantyDiasRestantes;
        const rotulo = window.MavisCadastros.formatDate(item.warrantyUntil);
        const tom = item.warrantySituacao === 'vencida' ? 'danger' : (dias !== null && dias <= 30 ? 'warning' : 'success');
        return `<span title="${porque}">${window.MavisCadastros.badge(rotulo, tom)}</span>`;
      }
    },
    { label: 'Status', render: (item) => window.MavisCadastros.statusBadge(item.status) }
  ]
});
