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

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

// Saldo de cada depósito para um produto + o que ainda não foi alocado em
// depósito nenhum (produtos antigos, criados antes deste módulo existir).
function productBalances(data, product) {
  const balances = (data.deposits || []).map((deposit) => ({
    depositId: deposit.id,
    depositName: deposit.name,
    quantity: depositBalance(data, product.id, deposit.id)
  }));
  const allocated = balances.reduce((sum, b) => sum + b.quantity, 0);
  const total = toNumber(product.stockQuantity);
  return { balances, allocated, unallocated: total - allocated, total };
}

// ----------------------------------------------------------------------------
// Produtos (Supabase) + campos extras (db.json)
// ----------------------------------------------------------------------------

// Campos que ficam no db.json local. NCM, CEST, EAN, origem e unidades saíram
// daqui: eles têm coluna própria em `products` (Fase C do schema) e são lidos
// pela emissão de NF-e, que consulta o Supabase direto e não enxerga o arquivo
// local. Enquanto estavam só aqui, a nota saía sem NCM e a regra fiscal nunca
// casava. Os valores antigos continuam sendo lidos do meta como fallback em
// serializeProduct, e a primeira gravação do produto os move para a coluna.
const PRODUCT_META_FIELDS = [
  'categoryId', 'status', 'unit', 'minStock', 'maxStock',
  'defaultDepositId', 'brand', 'location', 'notes'
];

function productMeta(data, productId) {
  return (data.productMeta || {})[productId] || {};
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

function serializeProduct(product, data) {
  const meta = productMeta(data, product.id);
  const { balances, unallocated, total } = productBalances(data, product);
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
    unit: meta.unit || 'UN',
    // Coluna primeiro, meta como fallback: produto cadastrado antes de os
    // campos fiscais irem para o Supabase continua exibindo o que tinha, e a
    // próxima gravação o move para a coluna. Sem migração de dados.
    ean: product.ean || meta.ean || '',
    ncm: product.ncm || meta.ncm || '',
    cest: product.cest || '',
    unidadeTributavel: product.unidadeTributavel || meta.unit || 'UN',
    numeroFci: product.numeroFci || '',
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
    unallocated
  };
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
    depositName: nameById(data.deposits, movement.depositId),
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
    date: transfer.date,
    productId: transfer.productId,
    productName: product ? product.name : '(produto removido)',
    productSku: product ? product.sku : '',
    originDepositId: transfer.originDepositId,
    originDepositName: nameById(data.deposits, transfer.originDepositId),
    destinationDepositId: transfer.destinationDepositId,
    destinationDepositName: nameById(data.deposits, transfer.destinationDepositId),
    quantity: toNumber(transfer.quantity),
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
  productBalances,
  productMeta,
  buildProductMeta,
  serializeProduct,
  serializeMovement,
  serializeTransfer,
  nextSequentialCode,
  priceForProduct,
  STOCK_COLLECTIONS,
  PRODUCT_META_FIELDS
};
