window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

/**
 * AS SUBTELAS QUE NÃO PRECISAM DO CATÁLOGO (fase DG).
 *
 * `/api/purchases` é chamada aqui, uma vez, para qualquer subtela de Compras —
 * e leva o catálogo de produtos e o diretório de pessoas porque UMA delas monta
 * um formulário com os dois. Medido nesta base:
 *
 *     products ..... 2.545 KB   (5.475 itens)
 *     directory .... 1.476 KB   (6.492 pessoas)
 *     resposta ..... 4.026 KB  ->  557 KB no fio
 *
 * Quem abre o Painel de Compras para ver quatro números pagava isso.
 *
 * A LISTA É DE QUEM **NÃO** PRECISA, e não de quem precisa. As duas dariam a
 * mesma resposta hoje; elas diferem no dia em que alguém criar a oitava subtela.
 * Com a lista de quem precisa, a nova não estaria nela, a requisição sairia com
 * `formulario=0` e o seletor de produto apareceria VAZIO — e "nenhum produto
 * cadastrado" é do tipo de erro em que a pessoa acredita. Com esta lista, a
 * subtela nova recebe o catálogo: fica tão lenta quanto era antes, e correta.
 *
 * Conferido subtela por subtela: só `new_purchase_order` lê `data.products` e
 * `data.directory`. As outras leem `data.purchases` ou nem leem `data`, e
 * `entrada_nfe` busca produtos pela própria rota (`/api/stock/products`) quando
 * precisa.
 *
 * A LISTA É DE CHAVES, NÃO DE ARQUIVOS. O roteador abaixo compara a CHAVE da
 * subtela (`efetiva`), e `purchase_documents` é o nome do ARQUIVO que registra
 * duas chaves: `purchase_quotes` e `purchase_orders`. Com só o nome do arquivo
 * aqui, as duas pediam o catálogo inteiro — 1.037 KB a cada abertura — sem ler
 * `data`: elas buscam `/api/purchases/documentos?tipo=`. O nome do arquivo
 * fica na lista porque não custa nada e tira a dúvida de quem procurar por ele;
 * quem confere é test-carregamento-de-telas.js, que agora mede pelas chaves.
 */
const PURCHASES_SEM_CATALOGO = new Set([
  'painel',
  'purchase_history',
  'purchase_documents',
  'purchase_quotes',
  'purchase_orders',
  'suppliers',
  'entrada_nfe'
]);

window.MavisModuleRegistry.purchases = async function renderPurchases(ctx) {
  const { api, state } = ctx;

  // A SUBTELA É RESOLVIDA ANTES DA REQUISIÇÃO, e não depois.
  //
  // Resolvida depois, a requisição já teria saído sem saber para quem — que é
  // exatamente como esta rota chegou a carregar 4 MB para o Painel. É a mesma
  // lição da lista de Vendas: quem decide o recorte decide antes de pedir.
  //
  // `registry[sub] || registry.painel` é o desvio que já existia: subtela não
  // registrada cai no Painel. O recorte segue a tela que VAI renderizar, e não
  // a que foi pedida — senão uma chave inválida na URL pediria o catálogo para
  // desenhar o Painel.
  const registry = window.MavisSubscreenRegistry.purchases || {};
  const pedida = state.activeSub || 'painel';
  const efetiva = registry[pedida] ? pedida : 'painel';
  if (!registry[pedida]) {
    state.activeSub = 'painel';
  }

  const params = PURCHASES_SEM_CATALOGO.has(efetiva) ? '?formulario=0' : '';
  const data = await api(`/api/purchases${params}`);

  const renderer = registry[efetiva];
  if (!renderer) return;

  await renderer({ ...ctx, data });
};
