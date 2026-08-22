// Grupos de Produtos de um Pedido/Orçamento — FONTE ÚNICA.
//
// Mora em public/ para o navegador carregar por <script>, e o server.js faz
// require() do mesmo arquivo. É de propósito, como em sales_totals: se a tela
// agrupasse de um jeito e o servidor de outro, o usuário veria três grupos e o
// sistema gravaria dois.
//
// DECISÃO DE MODELO: o grupo é METADADO sobre a lista PLANA de itens, e não um
// nível a mais dentro dela.
//
//   items:  [ {..., groupId: 'g1'}, {..., groupId: 'g2'} ]
//   groups: [ {id:'g1', name:'...', ordem:0}, {id:'g2', ...} ]
//
// O pedido inteiro já é lido como uma lista plana de itens em muitos lugares —
// baixa de estoque, reserva, totais, payload da NF-e, tabela de preços. Aninhar
// os itens dentro dos grupos obrigaria todos eles a saber de grupo para somar
// uma quantidade, e cada um que esquecesse passaria a ignorar tudo que não
// estivesse no primeiro grupo. Um campo a mais no item é ignorado por quem não
// se importa, que é a maioria.
(function (raiz) {
  const NOME_PADRAO = 'Grupo de Produtos Padrão';

  // O nome padrão é numerado a partir de 1 e com dois dígitos, como no sistema
  // de referência: "Grupo de Produtos Padrão - 01".
  function nomePadrao(posicao) {
    return NOME_PADRAO + ' - ' + String(posicao + 1).padStart(2, '0');
  }

  // Ids gerados aqui, e não no banco: o grupo nasce na tela, antes de existir
  // pedido nenhum, e o item precisa apontar para ele desde o primeiro clique.
  function novoId(semente) {
    const base = 'grp-' + String(semente === undefined ? '' : semente);
    return base + '-' + Math.random().toString(36).slice(2, 8);
  }

  function textoLimpo(v, limite) {
    return String(v === null || v === undefined ? '' : v).trim().slice(0, limite || 60);
  }

  /**
   * Devolve { groups, items } coerentes entre si. É a função que os dois lados
   * chamam antes de gravar e antes de desenhar.
   *
   * Garantias:
   *
   * 1. sempre existe ao menos UM grupo. Pedido sem grupo nenhum deixaria os
   *    itens sem onde aparecer, e a tela mostraria um pedido vazio que na
   *    verdade tem produtos;
   * 2. todo item aponta para um grupo que existe. Item órfão — grupo excluído,
   *    pedido antigo de antes desta fase, importação — vai para o PRIMEIRO
   *    grupo em vez de sumir;
   * 3. a ordem dos grupos é sequencial e sem buracos;
   * 4. grupo sem nome recebe o nome padrão da sua posição.
   */
  function normalizarGrupos(rawGroups, rawItems) {
    const items = Array.isArray(rawItems) ? rawItems.slice() : [];
    let groups = (Array.isArray(rawGroups) ? rawGroups : [])
      .filter((g) => g && typeof g === 'object')
      .map((g, i) => ({
        id: textoLimpo(g.id, 40) || novoId(i),
        name: textoLimpo(g.name),
        ordem: Number.isFinite(Number(g.ordem)) ? Number(g.ordem) : i
      }))
      .sort((a, b) => a.ordem - b.ordem)
      // O nome padrão só é decidido DEPOIS de ordenar: pela posição final, não
      // pela de origem. Batizar antes fazia o grupo que veio em segundo no
      // JSON, mas é o primeiro na tela, chamar-se "- 02".
      .map((g, i) => ({ ...g, name: g.name || nomePadrao(i), ordem: i }));

    // Id repetido faria dois grupos disputarem os mesmos itens, e mover um item
    // entre eles não teria efeito visível.
    const vistos = new Set();
    groups = groups.map((g, i) => {
      if (vistos.has(g.id)) return { ...g, id: novoId(i) };
      vistos.add(g.id);
      return g;
    });

    if (!groups.length) groups = [{ id: novoId(0), name: nomePadrao(0), ordem: 0 }];

    const existentes = new Set(groups.map((g) => g.id));
    const primeiro = groups[0].id;
    const itensComGrupo = items.map((item) => {
      const atual = textoLimpo(item && item.groupId, 40);
      return Object.assign({}, item, { groupId: existentes.has(atual) ? atual : primeiro });
    });

    return { groups, items: itensComGrupo };
  }

  // Os itens de um grupo, na ordem em que estão na lista plana — é essa ordem
  // que a tela mostra e que o "mover para cima" muda.
  function itensDoGrupo(items, groupId) {
    return (Array.isArray(items) ? items : []).filter((item) => item && item.groupId === groupId);
  }

  // Total do grupo: mesma conta do total de produtos, restrita ao grupo. Aceita
  // `total` já calculado (é assim que vem do servidor) ou quantidade × preço.
  function totalDoGrupo(items, groupId) {
    const soma = itensDoGrupo(items, groupId).reduce((acc, item) => {
      const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
      const total = item.total !== undefined ? n(item.total) : n(item.quantity) * n(item.unitPrice);
      return acc + total;
    }, 0);
    return Math.round(soma * 100) / 100;
  }

  const api = { NOME_PADRAO, nomePadrao, novoId, normalizarGrupos, itensDoGrupo, totalDoGrupo };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisSalesGrupos = api;
})(typeof window !== 'undefined' ? window : null);
