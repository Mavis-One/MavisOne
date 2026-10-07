window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

// UMA CAIXA POR BANDEIRA, e não uma multi-seleção, porque a fábrica de
// formulários dos Cadastros não tem esse tipo de campo — ela conhece texto,
// número, select, textarea e checkbox. Dez caixas resolvem sem mexer na
// fábrica, e o servidor remonta o array `brands` a partir delas (ver a rota).
//
// A LISTA VEM DO CATÁLOGO COMPARTILHADO, e não escrita aqui. Ela estava
// duplicada — esta cópia e a de lib/db/adquirentes.js, que valida o que entra.
// Acrescentar uma bandeira em uma só faria o cadastro descartar em silêncio o
// que a tela oferece, ou a tela não saber desenhar o que o cadastro aceita.
const CREDENCIADORA_CAIXAS_DE_BANDEIRA = window.MavisBandeiraCartao.CATALOGO
  .map(({ codigo, nome }) => ({ name: `bandeira${codigo}`, label: nome, type: 'checkbox' }));

window.MavisSubscreenRegistry.cadastros.nova_credenciadora = window.MavisCadastros.makeFormScreen({
  // Esta tela não lê nada da meta de Cadastros, então não a pede (era 1,4 MB
  // por abertura). Se passar a ler, declare a parte aqui —
  // scripts/test-meta-das-telas-de-cadastro.js cobra.
  metaPartes: [],
  title: 'Nova Credenciadora de Cartão',
  entityLabel: 'credenciadora',
  endpoint: '/api/cadastros/card-acquirers',
  itemKey: 'cardAcquirer',
  listSub: 'credenciadoras',
  editStateKey: 'cadastroEditCardAcquirerId',
  sections: [
    {
      title: 'Identificação',
      fields: [
        { name: 'name', label: 'Nome', required: true },
        { name: 'cnpj', label: 'CNPJ da credenciadora', required: true, documento: true },
        { name: 'status', label: 'Status', type: 'select', empty: null, default: 'ativo', options: [{ id: 'ativo', name: 'Ativo' }, { id: 'inativo', name: 'Inativo' }] }
      ]
    }
  ],
  tabs: [
    {
      key: 'bandeiras',
      label: 'Bandeiras',
      sections: [
        {
          title: 'Bandeiras aceitas',
          fields: CREDENCIADORA_CAIXAS_DE_BANDEIRA
        }
      ]
    },
    {
      key: 'observacoes',
      label: 'Observações',
      sections: [
        {
          title: 'Observações',
          columns: 1,
          fields: [{ name: 'notes', label: 'Observações', type: 'textarea', full: true }]
        }
      ]
    }
  ]
});
