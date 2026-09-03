window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_equipamento = window.MavisCadastros.makeFormScreen({
  title: 'Novo Equipamento',
  subtitle: 'O número de série, quando informado, não pode se repetir.',
  entityLabel: 'equipamento',
  endpoint: '/api/cadastros/equipments',
  itemKey: 'equipment',
  listSub: 'equipamentos',
  editStateKey: 'cadastroEditEquipmentId',
  sections: [
    {
      title: 'Identificação',
      fields: [
        { name: 'name', label: 'Nome do equipamento', required: true },
        { name: 'code', label: 'Código interno' },
        { name: 'serialNumber', label: 'Número de série' }
      ]
    },
    {
      title: 'Especificação',
      fields: [
        { name: 'brand', label: 'Marca' },
        { name: 'model', label: 'Modelo' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          empty: null,
          default: 'ativo',
          options: [
            { id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' },
            { id: 'manutencao', name: 'Em manutenção' }, { id: 'baixado', name: 'Baixado' }
          ]
        }
      ]
    }
  ],
  tabs: [
    {
      key: 'localizacao',
      label: 'Localização',
      sections: [
        {
          title: 'Onde está o equipamento',
          fields: [
            { name: 'personId', label: 'Cliente/proprietário', type: 'select', empty: 'Nenhum', options: (meta) => meta.directory },
            { name: 'depositId', label: 'Depósito', type: 'select', empty: 'Nenhum', options: (meta) => meta.deposits },
            { name: 'location', label: 'Localização física', hint: 'Ex.: sala 2, rack B' }
          ]
        }
      ]
    },
    {
      key: 'aquisicao',
      label: 'Aquisição e garantia',
      sections: [
        {
          title: 'Aquisição',
          fields: [
            // A NOTA E' O DOCUMENTO (fase BB). A garantia passou a ser contada a
            // partir da data DELA, e não da data de aquisição — que é o que
            // alguém lembrou de digitar. Sem nota, a de aquisição serve.
            { name: 'nfeId', label: 'NF-e que vendeu', type: 'select', empty: 'Nenhuma', options: (meta) => meta.notasFiscais || [], hint: 'De onde sai a data de início da garantia' },
            { name: 'purchaseDate', label: 'Data de aquisição', type: 'date', hint: 'Usada como início quando não há NF-e' },
            { name: 'purchaseValue', label: 'Valor de aquisição', type: 'number', step: '0.01', min: 0 }
          ]
        },
        {
          title: 'Garantia',
          description: 'No modo "Prazo", a data de término é calculada: N meses a partir da NF-e (ou da data de aquisição, quando não há nota). O modo "Data fixa" existe para garantia negociada — e aí o prazo em meses é ignorado.',
          fields: [
            // SAO MODOS, e nao dois campos convivendo: com os dois valendo, um
            // dia eles discordam e ninguem sabe qual vale. Ver
            // shared/garantia.js.
            {
              name: 'warrantyMode',
              label: 'Como contar',
              type: 'select',
              empty: null,
              default: 'prazo',
              options: [
                { id: 'prazo', name: 'Prazo em meses a partir da nota' },
                { id: 'data', name: 'Data fixa (garantia negociada)' }
              ]
            },
            { name: 'warrantyMonths', label: 'Prazo (meses)', type: 'number', step: '1', min: 0, hint: 'Ex.: 12' },
            { name: 'warrantyUntil', label: 'Garantia até (modo data fixa)', type: 'date' }
          ]
        },
        {
          title: 'Observações',
          columns: 1,
          fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
        }
      ]
    }
  ]
});
