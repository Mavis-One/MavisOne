// Núcleo do módulo Estoque: cadastros auxiliares, movimentações, transferências
// entre depósitos, tabelas de preço e catálogos.
//
// Onde cada coisa mora:
//   - O CADASTRO do produto (nome, SKU, custo, venda, quantidade total) continua
//     no Supabase, tabela "products", via lib/db/estoque.js. É a fonte da verdade
//     do saldo TOTAL, porque Vendas/NF-e já leem de lá.
//   - Tudo que é novo aqui (categorias, movimentações, depósitos, tabelas de
//     preço, catálogos e os campos extras do produto) mora em data/db.json, do
//     mesmo jeito que Financeiro e Depósitos já fazem.
//   - O saldo POR DEPÓSITO é derivado das movimentações; o saldo total do
//     Supabase é atualizado a cada movimentação (ver applyStockDelta em server.js).
//   - A RESERVA (prometido em pedido aberto) é derivada dos pedidos, em
//     lib/reservas.js — não é saldo, é compromisso, e por isso não vira
//     movimento nenhum até o faturamento.
const reservasLib = require('./reservas');

// Fonte única — ver lib/criar-id.js. Esta cópia ficou para trás no Math.random
// quando a de lib/db/client.js passou para crypto.
const { createId } = require('./criar-id');

function stockError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeStatus(value, fallback = 'ativo') {
  const status = String(value ?? fallback).trim().toLowerCase();
  return ['ativo', 'inativo'].includes(status) ? status : fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nameById(list, id) {
  if (!id) return '';
  const found = (list || []).find((item) => item.id === id);
  return found ? found.name : '';
}

// Garante que todas as coleções do Estoque existam no db.json.
function ensureStockCollections(data) {
  data.productCategories = Array.isArray(data.productCategories) ? data.productCategories : [];
  data.movementCategories = Array.isArray(data.movementCategories) ? data.movementCategories : [];
  data.stockMovements = Array.isArray(data.stockMovements) ? data.stockMovements : [];
  data.stockTransfers = Array.isArray(data.stockTransfers) ? data.stockTransfers : [];
  data.priceTables = Array.isArray(data.priceTables) ? data.priceTables : [];
  data.productCatalogs = Array.isArray(data.productCatalogs) ? data.productCatalogs : [];
  data.productMeta = data.productMeta && typeof data.productMeta === 'object' && !Array.isArray(data.productMeta)
    ? data.productMeta
    : {};
  return data;
}

// ----------------------------------------------------------------------------
// Saldos
// ----------------------------------------------------------------------------

// Toda alteração de estoque (inclusive as duas pernas de uma transferência)
// vira um registro em stockMovements, então o saldo por depósito é sempre a
// soma das movimentações daquele par produto/depósito.
function movementSignedQuantity(movement) {
  const qty = toNumber(movement.quantity);
  return String(movement.type).toLowerCase() === 'saida' ? -qty : qty;
}

function depositBalance(data, productId, depositId) {
  return (data.stockMovements || [])
    .filter((m) => m.productId === productId && m.depositId === depositId)
    .reduce((sum, m) => sum + movementSignedQuantity(m), 0);
}

/**
 * O BALDE DE TRÂNSITO (fase CZ): mercadoria que saiu da origem e ainda não foi
 * conferida no destino.
 *
 * É um `deposit_id`, e de propósito NÃO é uma linha em `deposits`:
 *
 *   · o saldo por depósito é a soma dos movimentos daquele id, então este balde
 *     já soma certo, já entra na guarda de saldo negativo do
 *     commitStockMovements e já aparece no razão — sem matemática nova;
 *
 *   · toda tela monta seletor a partir de `data.deposits`, e
 *     `assertMovementIsPossible` recusa depósito que não esteja lá. Logo o
 *     trânsito é inescolhível de graça: ninguém lança movimento manual nele,
 *     ninguém o define como padrão de produto, ninguém o exclui. Uma linha em
 *     `deposits` obrigaria a escrever cada uma dessas guardas, e a que faltasse
 *     seria a que alguém acharia.
 *
 * Mesmo desenho do balde de saldo não alocado (`deposit_id === ''`), que já
 * funciona assim há muito tempo. Este só tem nome.
 */
const DEPOSITO_EM_TRANSITO = '__transito__';
const ROTULO_EM_TRANSITO = 'Em trânsito';

/** Quanto deste produto está viajando agora. */
function transitBalance(data, productId) {
  return depositBalance(data, productId, DEPOSITO_EM_TRANSITO);
}

/**
 * O nome de um depósito para a tela, já sabendo do trânsito.
 *
 * `nameById(data.deposits, '__transito__')` devolveria vazio, e a lista de
 * movimentações mostraria a perna da transferência com o depósito em branco —
 * indistinguível do saldo não alocado, que é outra coisa.
 */
function depositLabel(data, depositId) {
  if (depositId === DEPOSITO_EM_TRANSITO) return ROTULO_EM_TRANSITO;
  return nameById(data.deposits, depositId);
}

/**
 * Saldo de um VALOR de classe (uma cor), opcionalmente num depósito.
 *
 * MESMA SOMA do saldo por depósito, com um filtro a mais. É isto que impede a
 * inconsistência que a especificação proíbe: os dois números saem do mesmo
 * razão, então não têm como divergir. Uma tabela de saldo por cor seria um
 * terceiro número, atualizado por outro caminho, livre para discordar.
 */
function classValueBalance(data, productId, classValueId, depositId) {
  return (data.stockMovements || [])
    .filter((m) => m.productId === productId
      && m.classValueId === classValueId
      && (!depositId || m.depositId === depositId))
    .reduce((sum, m) => sum + movementSignedQuantity(m), 0);
}

/**
 * Quebra do saldo por valor de classe.
 *
 * Varre o RAZÃO, e não a lista de valores atribuídos ao produto: uma cor que
 * saiu do cadastro mas ainda tem saldo precisa aparecer, senão o total do
 * produto não fecha com a soma das cores e ninguém descobre onde sumiu.
 *
 * `semClasse` é o saldo dos movimentos sem cor nenhuma — o que existia antes
 * de o produto passar a controlar por classe. Escondê-lo faria o total do
 * produto parecer errado.
 */
function classBalances(data, productId, depositId) {
  const movimentos = (data.stockMovements || []).filter((m) => m.productId === productId
    && (!depositId || m.depositId === depositId));
  const porValor = new Map();
  let semClasse = 0;
  for (const m of movimentos) {
    const assinado = movementSignedQuantity(m);
    if (!m.classValueId) {
      semClasse += assinado;
      continue;
    }
    porValor.set(m.classValueId, (porValor.get(m.classValueId) || 0) + assinado);
  }
  return {
    valores: [...porValor.entries()].map(([classValueId, quantity]) => ({ classValueId, quantity })),
    semClasse,
    total: [...porValor.values()].reduce((s, v) => s + v, 0) + semClasse
  };
}

// Saldo de cada depósito para um produto + o que ainda não foi alocado em
// depósito nenhum (produtos antigos, criados antes deste módulo existir).
function productBalances(data, product) {
  // PRODUTO SEM MOVIMENTO NENHUM — a maioria do catálogo, e o caso de todo
  // produto quando serializarProdutos (abaixo) entrega só a fatia dele.
  //
  // Cada depósito dá 0 e nenhuma cor: é EXATAMENTE o que as varreduras abaixo
  // devolveriam para um razão vazio. `reduce` de lista vazia com inicial 0 é 0
  // (nunca -0), e a quebra por cor de um Map vazio é []. O atalho só pula a
  // montagem de quatro arrays e um Map por depósito — com 10 depósitos e 5.560
  // produtos, eram 220 mil objetos jogados fora a cada abertura da lista.
  if (!(data.stockMovements || []).length) {
    const total = toNumber(product.stockQuantity);
    const balances = (data.deposits || []).map((deposit) => ({
      depositId: deposit.id,
      depositName: deposit.name,
      quantity: 0,
      classes: []
    }));
    return { balances, allocated: 0, inTransit: 0, unallocated: total - 0 - 0, total };
  }
  const balances = (data.deposits || []).map((deposit) => ({
    depositId: deposit.id,
    depositName: deposit.name,
    quantity: depositBalance(data, product.id, deposit.id),
    // Quebra por cor DENTRO do depósito. É o número que a transferência
    // precisa: saber que existem 8 pretos não diz de qual galpão dá para
    // tirá-los, e transferir do galpão errado é recusado só no envio.
    classes: classBalances(data, product.id, deposit.id).valores
  }));
  const allocated = balances.reduce((sum, b) => sum + b.quantity, 0);
  const total = toNumber(product.stockQuantity);
  // O TRÂNSITO SAI DO "NÃO ALOCADO" (fase CZ).
  //
  // `unallocated` é `total - allocated`, e `allocated` só soma depósitos que
  // têm linha em `deposits`. Sem descontar o trânsito aqui, a carga que está na
  // estrada apareceria como saldo NÃO ALOCADO — que significa outra coisa
  // (produto antigo, cadastrado antes de o módulo existir) e é tratado de outro
  // jeito pela guarda de saldo negativo. Duas coisas diferentes no mesmo
  // número, e a tela dizendo "sem depósito" para mercadoria que tem destino,
  // data e conferência marcada.
  const inTransit = transitBalance(data, product.id);
  return { balances, allocated, inTransit, unallocated: total - allocated - inTransit, total };
}

// ----------------------------------------------------------------------------
// Produtos (Supabase) + campos extras (db.json)
// ----------------------------------------------------------------------------

// Os campos que ficam no db.json local são os enumerados em buildProductMeta,
// abaixo. NCM, CEST, EAN, origem e unidades NÃO estão entre eles: têm coluna
// própria em `products` (Fase C do schema) e são lidos pela emissão de NF-e,
// que consulta o Supabase direto e não enxerga o arquivo local. Enquanto
// estavam só aqui, a nota saía sem NCM e a regra fiscal nunca casava. Os
// valores antigos continuam sendo lidos do meta como fallback em
// serializeProduct, e a primeira gravação do produto os move para a coluna.
//
// Havia aqui uma constante PRODUCT_META_FIELDS com essa mesma lista, exportada
// e nunca importada: uma segunda fonte da verdade que podia divergir de
// buildProductMeta sem ninguém notar.

function productMeta(data, productId) {
  return (data.productMeta || {})[productId] || {};
}

/**
 * A SITUAÇÃO DO PRODUTO, SEM PASSAR PELOS DEPÓSITOS.
 *
 * Para quem só quer saber se o produto está zerado ou abaixo do mínimo — é o
 * caso do painel de pendências do sino, que conta produtos e não mostra
 * nenhum. Serializar o produto inteiro ali montava 25 campos para ler um, e
 * chamar productBalances fazia a rota depender de `data.deposits`, que ela não
 * tem motivo para carregar.
 *
 * O NÚMERO É O MESMO: em productBalances, `total` é exatamente
 * `toNumber(product.stockQuantity)` — a quebra por depósito não entra na
 * conta. Está escrito aqui, e não no chamador, para o dia em que essa
 * definição mudar: aí muda num lugar.
 */
function productSituation(data, product) {
  return productStockSituation(productMeta(data, product.id), toNumber(product.stockQuantity));
}

function buildProductMeta(body, current = {}) {
  return {
    categoryId: body.categoryId ?? current.categoryId ?? '',
    status: normalizeStatus(body.status ?? current.status),
    unit: String(body.unit ?? current.unit ?? 'UN').trim() || 'UN',
    minStock: toNumber(body.minStock ?? current.minStock, 0),
    maxStock: toNumber(body.maxStock ?? current.maxStock, 0),
    defaultDepositId: body.defaultDepositId ?? current.defaultDepositId ?? '',
    brand: String(body.brand ?? current.brand ?? '').trim(),
    location: String(body.location ?? current.location ?? '').trim(),
    notes: String(body.notes ?? current.notes ?? '').trim(),
    updatedAt: new Date().toISOString()
  };
}

// "Abaixo do mínimo" só faz sentido quando o mínimo foi configurado (> 0).
function productStockSituation(meta, total) {
  if (total <= 0) return 'zerado';
  const min = toNumber(meta.minStock);
  if (min > 0 && total <= min) return 'abaixo-minimo';
  const max = toNumber(meta.maxStock);
  if (max > 0 && total > max) return 'acima-maximo';
  return 'normal';
}

/**
 * `reservas` é OPCIONAL e vem de lib/reservas.js. Quando não vem, `reserved` e
 * `available` saem como `null` — e não como zero. Zero diria "não há nada
 * reservado", que é uma afirmação; null diz "não foi calculado", que é a
 * verdade. A rota que não paga o custo de ler os pedidos não pode alegar o
 * contrário para a tela.
 */
function serializeProduct(product, data, reservas) {
  const meta = productMeta(data, product.id);
  const { balances, unallocated, inTransit, total } = productBalances(data, product);
  const margin = toNumber(product.costPrice) > 0
    ? ((toNumber(product.salePrice) - toNumber(product.costPrice)) / toNumber(product.costPrice)) * 100
    : 0;
  return {
    id: product.id,
    name: product.name,
    sku: product.sku || '',
    costPrice: toNumber(product.costPrice),
    salePrice: toNumber(product.salePrice),
    margin,
    stockQuantity: total,
    categoryId: meta.categoryId || '',
    categoryName: nameById(data.productCategories, meta.categoryId),
    status: normalizeStatus(meta.status),
    // Meta primeiro, COLUNA como reserva. O cadastro grava a unidade nos dois
    // lugares a cada salvamento, entao para quem passou pela tela os dois
    // concordam. Quem NAO passou pela tela sao os produtos que entraram por
    // importacao direta no banco: tem a coluna preenchida e meta nenhuma.
    //
    // Sem a reserva, a importacao do Viper caia toda em 'UN': 5.476 produtos
    // na tela como UN quando 1.795 deles eram PC, MT, CT, KG, LT, PAR... Nao
    // dava erro nenhum, so mentia a unidade de um produto em cada tres.
    unit: meta.unit || product.unidadeComercial || 'UN',
    // Coluna primeiro, meta como fallback: produto cadastrado antes de os
    // campos fiscais irem para o Supabase continua exibindo o que tinha, e a
    // próxima gravação o move para a coluna. Sem migração de dados.
    ean: product.ean || meta.ean || '',
    ncm: product.ncm || meta.ncm || '',
    cest: product.cest || '',
    unidadeTributavel: product.unidadeTributavel || meta.unit || product.unidadeComercial || 'UN',
    numeroFci: product.numeroFci || '',
    // Fase CP — o grupo tributário sai daqui para a tela de produtos e para a
    // classificação em lote. Sem estar na serialização, a coluna existiria no
    // banco e a tela não teria como mostrar nem filtrar por ela.
    grupoTributarioId: product.grupoTributarioId || '',
    // Fase CS — os cinco campos que só o produto responde na NF-e. Sem estarem
    // aqui, a tela de produtos não conseguiria mostrá-los nem devolvê-los ao
    // salvar, e o cadastro os perderia a cada gravação.
    cstIpi: product.cstIpi || '',
    // `?? null`, não `|| 0`: alíquota 0 com CST de imune é informação.
    aliquotaIpi: product.aliquotaIpi ?? null,
    codigoExTipi: product.codigoExTipi || '',
    // Três estados preservados: null = não declarado, e é o que faz a nota
    // omitir o indEscala em vez de afirmar algo sobre o produto.
    escalaRelevante: product.escalaRelevante ?? null,
    cnpjFabricante: product.cnpjFabricante || '',
    // 0 é "Nacional" e é um valor legítimo — `||` o transformaria em null.
    origem: product.origem === null || product.origem === undefined ? null : Number(product.origem),
    minStock: toNumber(meta.minStock),
    maxStock: toNumber(meta.maxStock),
    defaultDepositId: meta.defaultDepositId || '',
    defaultDepositName: nameById(data.deposits, meta.defaultDepositId),
    brand: meta.brand || '',
    location: meta.location || '',
    notes: meta.notes || '',
    situation: productStockSituation(meta, total),
    balances,
    // Saldo por valor de classe (cor). Vem do MESMO razão que produz
    // `balances`, então os dois não podem discordar. O nome de cada valor é
    // resolvido por quem exibe — o catálogo vive no Supabase e buscá-lo aqui
    // seria uma consulta por produto listado.
    classBalances: classBalances(data, product.id),
    // Prometido em pedido aberto e ainda não baixado. `available` pode ficar
    // negativo: promessa acima do saldo é um fato, e cortar em zero esconderia
    // o rombo de quem precisa vê-lo.
    reserved: reservas ? reservasLib.reservado(reservas, product.id) : null,
    available: reservas ? reservasLib.disponivel(total, reservas, product.id) : null,
    unallocated,
    // Fase CZ — mercadoria que saiu da origem e ainda nao foi conferida no
    // destino. SEPARADO de `unallocated` de proposito: sem isto a carga que
    // esta na estrada apareceria como "sem deposito", que significa outra coisa
    // (produto antigo, de antes do modulo) e e' tratada de outro jeito pela
    // guarda de saldo negativo.
    inTransit
  };
}

/**
 * SERIALIZAR MUITOS PRODUTOS DE UMA VEZ — o razão é varrido UMA vez.
 *
 * serializeProduct é feito para UM produto: productBalances varre o razão
 * inteiro duas vezes por depósito (depositBalance + classBalances) e mais duas
 * (a quebra por cor do total e o trânsito). Com 10 depósitos são 22 varreduras
 * do razão POR PRODUTO; nos 5.560 do catálogo, 122 mil. O custo era produtos ×
 * depósitos × movimentos, e o terceiro fator só cresce — cada item faturado
 * vira um movimento. Medido com a função antiga e o razão crescendo:
 *
 *     59 movimentos (hoje) ...    119–162 ms   ->  21–30 ms
 *     1.000 ..................    1,2–2,0 s    ->  29–54 ms
 *     5.000 ..................    7,8–14,7 s   ->  62–108 ms
 *     20.000 .................    104,7 s      ->  76–154 ms
 *
 * Tudo isso dentro do event loop, a cada abertura da lista de Produtos, do
 * Painel do Estoque e do Gestor de Preços: enquanto calculava, ninguém mais era
 * atendido.
 *
 * Aqui o razão é agrupado por produto numa passada, e cada produto recebe uma
 * VISÃO de `data` em que stockMovements é só a fatia dele, NA ORDEM ORIGINAL.
 * As funções de saldo não mudam uma linha: todas já filtram por productId, então
 * o filtro vira no-op, e a ordem preservada mantém a ordem de `valores` em
 * classBalances (primeira aparição) e a ordem das somas em ponto flutuante. A
 * resposta sai byte a byte igual — o teste test-serializar-produtos.js compara
 * as duas com razão sintético cobrindo cada ramo.
 *
 * Object.create(data), e não um objeto montado à mão: a visão herda TUDO de
 * `data` (productMeta, productCategories, deposits...). Uma lista explícita de
 * chaves deixaria de fora a próxima que serializeProduct passar a ler — e ela
 * leria undefined em silêncio.
 *
 * SÓ PARA LEITURA EM LOTE. Quem valida saldo antes de gravar continua chamando
 * depositBalance/classValueBalance com o `data` inteiro: lá o razão muda dentro
 * da requisição (registrarMovimentoEstoque empilha), e um índice montado antes
 * ficaria velho. Por isso é uma função nova, e não um cache dentro de
 * depositBalance.
 */
const SEM_MOVIMENTO = Object.freeze([]);

function serializarProdutos(produtos, data, reservas) {
  const porProduto = new Map();
  for (const movimento of (data.stockMovements || [])) {
    const lista = porProduto.get(movimento.productId);
    if (lista) lista.push(movimento);
    else porProduto.set(movimento.productId, [movimento]);
  }
  return (produtos || []).map((product) => {
    const doProduto = Object.create(data);
    doProduto.stockMovements = porProduto.get(product.id) || SEM_MOVIMENTO;
    return serializeProduct(product, doProduto, reservas);
  });
}

// ----------------------------------------------------------------------------
// Movimentações e transferências
// ----------------------------------------------------------------------------

function serializeMovement(movement, data, productsById) {
  const product = productsById.get(movement.productId);
  return {
    id: movement.id,
    code: movement.code,
    date: movement.date,
    type: movement.type,
    productId: movement.productId,
    productName: product ? product.name : '(produto removido)',
    productSku: product ? product.sku : '',
    depositId: movement.depositId,
    // depositLabel e nao nameById: a perna do transito tem deposit_id
    // '__transito__', que nao tem linha em `deposits` e sairia em BRANCO --
    // indistinguivel do saldo nao alocado, que e' outra coisa (fase CZ).
    depositName: depositLabel(data, movement.depositId),
    classId: movement.classId || '',
    classValueId: movement.classValueId || '',
    // O NOME da cor vem de fora (catálogo no Supabase); aqui fica só o id, e
    // quem lista resolve o nome. Buscar o catálogo por movimento seria uma
    // consulta por linha da tabela.
    quantity: toNumber(movement.quantity),
    unitCost: toNumber(movement.unitCost),
    totalCost: toNumber(movement.quantity) * toNumber(movement.unitCost),
    categoryId: movement.categoryId || '',
    categoryName: nameById(data.movementCategories, movement.categoryId),
    document: movement.document || '',
    note: movement.note || '',
    transferId: movement.transferId || '',
    origin: movement.origin || 'manual',
    createdByName: movement.createdByName || '',
    createdAt: movement.createdAt
  };
}

function serializeTransfer(transfer, data, productsById) {
  const product = productsById.get(transfer.productId);
  return {
    id: transfer.id,
    code: transfer.code,
    // A CARGA a que esta linha pertence (fase CZ). Sem ele a tela de
    // conferencia nao sai da linha clicada para o caminhao inteiro.
    batchId: transfer.batchId || '',
    date: transfer.date,
    productId: transfer.productId,
    productName: product ? product.name : '(produto removido)',
    productSku: product ? product.sku : '',
    originDepositId: transfer.originDepositId,
    originDepositName: depositLabel(data, transfer.originDepositId),
    destinationDepositId: transfer.destinationDepositId,
    destinationDepositName: depositLabel(data, transfer.destinationDepositId),
    // Mesmo acordo do movimento: aqui vai o id, e quem lista resolve o nome
    // pelo catálogo que já veio no meta da tela.
    classId: transfer.classId || '',
    classValueId: transfer.classValueId || '',
    quantity: toNumber(transfer.quantity),
    // ---- fase CZ: trânsito e conferência ----------------------------------
    // 'recebida' como padrão porque é o que toda transferência do histórico é:
    // antes desta fase, sair e chegar eram o mesmo instante.
    status: transfer.status || 'recebida',
    receivedQuantity: toNumber(transfer.receivedQuantity ?? transfer.quantity),
    // DERIVADO, e não gravado — mesma razão do "Falta" na lista de ordens de
    // produção: um terceiro número guardado pode discordar dos outros dois.
    pendingQuantity: Math.max(0, toNumber(transfer.quantity)
      - toNumber(transfer.receivedQuantity ?? transfer.quantity)),
    sentAt: transfer.sentAt || '',
    receivedAt: transfer.receivedAt || '',
    receivedByName: transfer.receivedByName || '',
    note: transfer.note || '',
    createdByName: transfer.createdByName || '',
    createdAt: transfer.createdAt
  };
}

// Código sequencial por coleção (MOV-0001, TRA-0001), só para leitura humana.
function nextSequentialCode(list, prefix) {
  const numbers = (list || [])
    .map((item) => Number(String(item.code || '').split('-')[1]))
    .filter((n) => Number.isFinite(n));
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

// ----------------------------------------------------------------------------
// Cadastros auxiliares — CRUD genérico
// ----------------------------------------------------------------------------
// Cada entrada descreve uma coleção simples: como validar/montar o registro e
// quando o registro não pode ser excluído por estar em uso.

const STOCK_COLLECTIONS = {
  'product-categories': {
    key: 'productCategories',
    prefix: 'pcat',
    itemKey: 'category',
    listKey: 'categories',
    notFound: 'Categoria não encontrada.',
    build(body, current, data) {
      const name = String(body.name ?? current?.name ?? '').trim();
      if (!name) throw stockError('Informe o nome da categoria.');
      const parentId = String(body.parentId ?? current?.parentId ?? '').trim();
      if (parentId && current && parentId === current.id) {
        throw stockError('Uma categoria não pode ser pai dela mesma.');
      }
      if (parentId && !(data.productCategories || []).some((c) => c.id === parentId)) {
        throw stockError('Categoria pai não encontrada.');
      }
      return {
        name,
        code: String(body.code ?? current?.code ?? '').trim(),
        parentId,
        status: normalizeStatus(body.status ?? current?.status),
        notes: String(body.notes ?? current?.notes ?? '').trim()
      };
    },
    serialize(item, data) {
      return { ...item, parentName: nameById(data.productCategories, item.parentId) };
    },
    inUse(id, data) {
      if (Object.values(data.productMeta || {}).some((meta) => meta.categoryId === id)) {
        return 'Existem produtos vinculados a esta categoria.';
      }
      if ((data.productCategories || []).some((c) => c.parentId === id)) {
        return 'Existem subcategorias vinculadas a esta categoria.';
      }
      return null;
    }
  },

  'movement-categories': {
    key: 'movementCategories',
    prefix: 'mcat',
    itemKey: 'category',
    listKey: 'categories',
    notFound: 'Categoria de movimentação não encontrada.',
    build(body, current) {
      const name = String(body.name ?? current?.name ?? '').trim();
      if (!name) throw stockError('Informe o nome da categoria.');
      const kindRaw = String(body.kind ?? current?.kind ?? 'ambos').trim().toLowerCase();
      const kind = ['entrada', 'saida', 'ambos'].includes(kindRaw) ? kindRaw : 'ambos';
      return {
        name,
        code: String(body.code ?? current?.code ?? '').trim(),
        kind,
        affectsCost: body.affectsCost ?? current?.affectsCost ?? false,
        status: normalizeStatus(body.status ?? current?.status),
        notes: String(body.notes ?? current?.notes ?? '').trim()
      };
    },
    inUse(id, data) {
      return (data.stockMovements || []).some((m) => m.categoryId === id)
        ? 'Existem movimentações usando esta categoria.'
        : null;
    }
  },

  deposits: {
    key: 'deposits',
    prefix: 'dep',
    itemKey: 'deposit',
    listKey: 'deposits',
    notFound: 'Depósito não encontrado.',
    build(body, current) {
      const name = String(body.name ?? current?.name ?? '').trim();
      if (!name) throw stockError('Informe o nome do depósito.');
      return {
        name,
        code: String(body.code ?? current?.code ?? '').trim(),
        status: String(body.status ?? current?.status ?? 'ativo').trim() || 'ativo',
        address: String(body.address ?? current?.address ?? '').trim(),
        city: String(body.city ?? current?.city ?? '').trim(),
        state: String(body.state ?? current?.state ?? '').trim(),
        manager: String(body.manager ?? current?.manager ?? '').trim(),
        notes: String(body.notes ?? current?.notes ?? '').trim()
      };
    },
    inUse(id, data) {
      if ((data.stockMovements || []).some((m) => m.depositId === id)) {
        return 'Existem movimentações neste depósito.';
      }
      if (Object.values(data.productMeta || {}).some((meta) => meta.defaultDepositId === id)) {
        return 'Existem produtos usando este depósito como padrão.';
      }
      if ((data.equipments || []).some((item) => item.depositId === id)) {
        return 'Existem equipamentos alocados neste depósito.';
      }
      return null;
    }
  },

  'price-tables': {
    key: 'priceTables',
    prefix: 'ptab',
    itemKey: 'priceTable',
    listKey: 'priceTables',
    notFound: 'Tabela de preços não encontrada.',
    build(body, current) {
      const name = String(body.name ?? current?.name ?? '').trim();
      if (!name) throw stockError('Informe o nome da tabela.');
      const typeRaw = String(body.type ?? current?.type ?? 'markup').trim().toLowerCase();
      const type = ['markup', 'fixo'].includes(typeRaw) ? typeRaw : 'markup';
      const markupPercent = toNumber(body.markupPercent ?? current?.markupPercent, 0);
      if (type === 'markup' && markupPercent <= -100) {
        throw stockError('O percentual não pode zerar ou inverter o preço (use um valor maior que -100%).');
      }
      // Itens só valem para tabela de preço fixo; markup calcula em cima do produto.
      const rawItems = Array.isArray(body.items) ? body.items : (current?.items || []);
      const items = rawItems
        .filter((item) => item && item.productId)
        .map((item) => ({ productId: String(item.productId), price: toNumber(item.price) }));
      return {
        name,
        code: String(body.code ?? current?.code ?? '').trim(),
        type,
        markupPercent,
        validFrom: String(body.validFrom ?? current?.validFrom ?? '').trim(),
        validTo: String(body.validTo ?? current?.validTo ?? '').trim(),
        status: normalizeStatus(body.status ?? current?.status),
        notes: String(body.notes ?? current?.notes ?? '').trim(),
        items
      };
    },
    serialize(item) {
      return { ...item, itemCount: (item.items || []).length };
    },
    inUse(id, data) {
      return (data.productCatalogs || []).some((c) => c.priceTableId === id)
        ? 'Existem catálogos vinculados a esta tabela de preços.'
        : null;
    }
  },

  catalogs: {
    key: 'productCatalogs',
    prefix: 'cat',
    itemKey: 'catalog',
    listKey: 'catalogs',
    notFound: 'Catálogo não encontrado.',
    build(body, current, data) {
      const name = String(body.name ?? current?.name ?? '').trim();
      if (!name) throw stockError('Informe o nome do catálogo.');
      const priceTableId = String(body.priceTableId ?? current?.priceTableId ?? '').trim();
      if (priceTableId && !(data.priceTables || []).some((t) => t.id === priceTableId)) {
        throw stockError('Tabela de preços não encontrada.');
      }
      const productIds = Array.isArray(body.productIds)
        ? [...new Set(body.productIds.filter(Boolean).map(String))]
        : (current?.productIds || []);
      return {
        name,
        code: String(body.code ?? current?.code ?? '').trim(),
        description: String(body.description ?? current?.description ?? '').trim(),
        priceTableId,
        status: normalizeStatus(body.status ?? current?.status),
        productIds
      };
    },
    serialize(item, data) {
      return {
        ...item,
        priceTableName: nameById(data.priceTables, item.priceTableId),
        productCount: (item.productIds || []).length
      };
    },
    inUse() {
      return null;
    }
  }
};

// Preço final de um produto dentro de uma tabela: item fixo tem prioridade;
// senão aplica o markup sobre o custo; sem nada disso, é o preço de venda.
function priceForProduct(priceTable, product) {
  if (!priceTable) return toNumber(product.salePrice);
  const item = (priceTable.items || []).find((i) => i.productId === product.id);
  if (item) return toNumber(item.price);
  if (priceTable.type === 'markup') {
    return toNumber(product.costPrice) * (1 + toNumber(priceTable.markupPercent) / 100);
  }
  return toNumber(product.salePrice);
}

// ----------------------------------------------------------------------------
// FILA DE PENDÊNCIAS DE CADASTRO
// ----------------------------------------------------------------------------
//
// O QUE ESTAVA FORA DO ERP
// ------------------------
// A importação do ERP anterior trouxe 5.475 produtos, e 3.078 deles (56% do
// catálogo) chegaram com preço de venda 0. Conferido no banco, não estimado.
//
// Achá-los era impossível pela tela. Produtos filtra por categoria, depósito,
// status e situação — e "situação" olha `minStock`/`maxStock`, que estão vazios
// para 5.474 dos 5.475 produtos, então "Zerado" devolve o catálogo inteiro. O
// Gestor de Preços, que é a ferramenta para CORRIGIR o preço, filtrava só por
// nome ou SKU: para chegar aos 3.078 era preciso saber de antemão o nome deles.
//
// A consequência é a planilha. Enquanto a lista não existe dentro do sistema,
// ela existe fora — e a planilha não sabe quando o produto foi corrigido.
//
// POR QUE UM PREDICADO SÓ, E NÃO UM `if` EM CADA ROTA
// ---------------------------------------------------
// Porque são duas rotas que respondem a mesma pergunta para a mesma pessoa:
// Produtos mostra a fila e o Gestor de Preços a resolve. Se as duas
// implementassem "sem preço" por conta própria, a contagem de uma deixaria de
// bater com as linhas da outra — e quem confia no número da primeira concluiria
// que a segunda perdeu produtos.
//
// CUSTO 0 NÃO É ERRO, É PENDÊNCIA
// -------------------------------
// Brinde, bonificação e amostra têm custo 0 de verdade. Nada aqui recusa nada
// nem corrige nada: é uma lista para alguém OLHAR. É por isso que o filtro vive
// na listagem e não numa validação de gravação — transformar isto em regra
// travaria o cadastro legítimo do brinde.
const PENDENCIAS_DE_CADASTRO = {
  'sem-preco': { rotulo: 'Sem preço de venda', testar: (p) => !(toNumber(p.salePrice) > 0) },
  'sem-custo': { rotulo: 'Sem custo', testar: (p) => !(toNumber(p.costPrice) > 0) },
  'sem-ncm': { rotulo: 'Sem NCM', testar: (p) => !String(p.ncm || '').trim() }
};

/**
 * `chave` vazia devolve true (nada a filtrar). 'qualquer' é o OU de todas — é
 * a fila completa, e é o valor que a tela oferece primeiro, porque a pergunta
 * de quem abre a tela é "o que falta cadastrar?", não "o que falta de NCM?".
 *
 * Chave desconhecida também devolve true, de propósito: um parâmetro digitado
 * errado na URL não pode devolver "nenhum produto encontrado", que se lê como
 * "o cadastro está completo".
 */
function temPendenciaDeCadastro(produtoSerializado, chave) {
  if (!chave) return true;
  if (chave === 'qualquer') {
    return Object.values(PENDENCIAS_DE_CADASTRO).some((p) => p.testar(produtoSerializado));
  }
  const pendencia = PENDENCIAS_DE_CADASTRO[chave];
  if (!pendencia) return true;
  return pendencia.testar(produtoSerializado);
}

module.exports = {
  createId,
  stockError,
  normalizeStatus,
  toNumber,
  todayStr,
  nameById,
  ensureStockCollections,
  movementSignedQuantity,
  depositBalance,
  DEPOSITO_EM_TRANSITO,
  ROTULO_EM_TRANSITO,
  transitBalance,
  depositLabel,
  classValueBalance,
  classBalances,
  productBalances,
  productMeta,
  // Para quem precisa SO' da situacao, sem tocar em deposito nenhum (o painel
  // de pendências do sino).
  productSituation,
  buildProductMeta,
  serializeProduct,
  // Para quem serializa o catálogo inteiro (lista, painel e Gestor de Preços):
  // o razão indexado por produto. Ver o bloco da função.
  serializarProdutos,
  serializeMovement,
  serializeTransfer,
  nextSequentialCode,
  priceForProduct,
  PENDENCIAS_DE_CADASTRO,
  temPendenciaDeCadastro,
  STOCK_COLLECTIONS
};
