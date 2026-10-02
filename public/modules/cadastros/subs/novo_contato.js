window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_contato = window.MavisCadastros.makeFormScreen({
  title: 'Novo Contato',
  entityLabel: 'contato',
  endpoint: '/api/cadastros/contacts',
  itemKey: 'contact',
  listSub: 'contatos',
  editStateKey: 'cadastroEditContactId',
  sections: [
    {
      title: 'Identificação',
      fields: [
        { name: 'name', label: 'Nome do contato', required: true },
        { name: 'personId', label: 'Pessoa/empresa vinculada', type: 'select', empty: 'Nenhuma', options: (meta) => meta.directory },
        { name: 'status', label: 'Status', type: 'select', empty: null, options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }], default: 'ativo' }
      ]
    },
    {
      title: 'Função',
      fields: [
        { name: 'role', label: 'Cargo' },
        { name: 'department', label: 'Setor' },
        { name: 'birthDate', label: 'Aniversário', type: 'date' }
      ]
    },
    {
      title: 'Contato',
      fields: [
        { name: 'email', label: 'E-mail', type: 'email' },
        { name: 'phone', label: 'Telefone', mascara: 'telefone' },
        { name: 'mobilePhone', label: 'Celular', mascara: 'telefone' },
        { name: 'whatsapp', label: 'WhatsApp', mascara: 'telefone' }
      ]
    },
    {
      title: 'Observações',
      columns: 1,
      fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
    }
  ]
});
