window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_contato = window.MavisCadastros.makeFormScreen({
  // O que esta tela lê da meta de Cadastros, e só isso: ela pede só estas
  // partes. Leitura nova da meta tem de entrar aqui — sem isso o select
  // fica vazio (scripts/test-meta-das-telas-de-cadastro.js cobra).
  metaPartes: ['directory'],
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
