window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.nova_empresa = window.MavisCadastros.makeFormScreen({
  title: 'Nova Empresa',
  subtitle: 'O CNPJ é validado ao salvar e não pode se repetir em outra empresa.',
  entityLabel: 'empresa',
  endpoint: '/api/cadastros/companies',
  itemKey: 'company',
  listSub: 'empresas',
  editStateKey: 'cadastroEditCompanyId',
  sections: [
    {
      title: 'Identificação',
      fields: [
        { name: 'name', label: 'Razão social', required: true },
        { name: 'tradeName', label: 'Nome fantasia' },
        { name: 'document', label: 'CNPJ', attrs: 'inputmode="numeric" maxlength="18"' }
      ]
    },
    {
      title: 'Situação',
      fields: [
        {
          name: 'taxRegime',
          label: 'Regime tributário',
          type: 'select',
          empty: null,
          default: 'simples',
          options: [
            { id: 'simples', name: 'Simples Nacional' }, { id: 'presumido', name: 'Lucro Presumido' },
            { id: 'real', name: 'Lucro Real' }, { id: 'mei', name: 'MEI' }
          ]
        },
        { name: 'status', label: 'Status', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
      ]
    }
  ],
  tabs: [
    {
      key: 'fiscal',
      label: 'Inscrições e contato',
      sections: [
        {
          title: 'Inscrições',
          fields: [
            { name: 'stateRegistration', label: 'Inscrição estadual' },
            { name: 'municipalRegistration', label: 'Inscrição municipal' }
          ]
        },
        {
          title: 'Contato',
          fields: [
            { name: 'email', label: 'E-mail', type: 'email' },
            { name: 'phone', label: 'Telefone' }
          ]
        }
      ]
    },
    {
      key: 'endereco',
      label: 'Endereço',
      sections: [
        {
          title: 'Endereço',
          fields: [
            { name: 'zipCode', label: 'CEP', attrs: 'inputmode="numeric" maxlength="9" placeholder="99999-999"' },
            { name: 'address', label: 'Logradouro' },
            { name: 'addressNumber', label: 'Número' },
            { name: 'neighborhood', label: 'Bairro' },
            { name: 'city', label: 'Cidade' },
            { name: 'state', label: 'UF' }
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
