const { banco, createId, assertNoError } = require('./client');

function mapProductRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    stockQuantity: Number(row.stock_quantity || 0),
    costPrice: Number(row.cost_price || 0),
    salePrice: Number(row.sale_price || 0),
    ncm: row.ncm || '',
    cest: row.cest || '',
    unidadeComercial: row.unidade_comercial || '',
    unidadeTributavel: row.unidade_tributavel || '',
    ean: row.ean || '',
    origem: row.origem === null || row.origem === undefined ? null : Number(row.origem),
    numeroFci: row.numero_fci || '',
    // Fase CP — como a empresa tributa este produto. É o critério que a regra
    // fiscal usa no lugar de uma regra por NCM, e chega até
    // `resolverRegraFiscal` por aqui: sem estar no mapa, a coluna existiria no
    // banco e o motor nunca a veria.
    grupoTributarioId: row.grupo_tributario_id || '',
    // Item que só existe para compor documento fiscal (complemento de ICMS).
    // Nunca é mercadoria: não entra em lista de produto nem em pedido.
    tipoProdutoFiscal: row.tipo_produto_fiscal || 'NORMAL',
    escritural: row.tipo_produto_fiscal === 'ESCRITURAL',
    // Default true por coluna ausente (migração não rodada) OU por valor nulo:
    // o comportamento de sempre é movimentar e faturar.
    movimentaEstoque: row.movimenta_estoque !== false,
    geraFinanceiro: row.gera_financeiro !== false
  };
}

// Colunas fiscais do produto (Fase C do schema). Ficam separadas porque só
// entram na gravação quando o chamador realmente mandou o campo: `upsertProduct`
// é chamado também pela baixa de estoque de um pedido, que passa o produto
// inteiro sem intenção de mexer em NCM — e por quem só mexe em preço.
//
// `undefined` = não mandou, não escreve. Isso importa: escrever `null` por
// omissão apagaria o NCM do produto na primeira venda faturada, e a emissão
// seguinte pararia com "Nenhuma regra fiscal encontrada".
const COLUNAS_FISCAIS = {
  ncm: 'ncm',
  cest: 'cest',
  unidadeComercial: 'unidade_comercial',
  unidadeTributavel: 'unidade_tributavel',
  ean: 'ean',
  origem: 'origem',
  numeroFci: 'numero_fci',
  grupoTributarioId: 'grupo_tributario_id'
};

function camposFiscaisDoProduto(payload) {
  const row = {};
  for (const [chave, coluna] of Object.entries(COLUNAS_FISCAIS)) {
    if (payload[chave] === undefined) continue;
    const valor = payload[chave];
    if (chave === 'origem') {
      row[coluna] = valor === '' || valor === null ? null : Number(valor);
      continue;
    }
    const texto = String(valor ?? '').trim();
    row[coluna] = texto === '' ? null : texto;
  }
  return row;
}

/**
 * Lista de MERCADORIAS.
 *
 * Produto escritural fica de FORA por padrão, e isso é deliberado: ele não é
 * mercadoria. Apareceria no Estoque com saldo zero que nunca muda, entraria no
 * seletor de item de um pedido, contaria na valorização do estoque e poderia
 * ser vendido por engano — um item que existe só para carregar imposto numa
 * nota complementar.
 *
 * O padrão é FECHADO em vez de filtrado em cada tela: são treze pontos que
 * listam produto, e esquecer um deixaria o escritural vazando exatamente onde
 * ninguém olhou. Quem realmente precisa dele — a resolução do item escritural
 * na emissão — pede explicitamente.
 */
async function getProducts({ incluirEscriturais = false } = {}) {
  const { data, error } = await banco.from('products').select('*').order('name', { ascending: true });
  assertNoError(error, 'getProducts');
  const lista = (data || []).map(mapProductRow);
  return incluirEscriturais ? lista : lista.filter((p) => !p.escritural);
}

/**
 * QUANTOS produtos a lista mostra — sem trazer nenhum.
 *
 * POR QUE SÃO DUAS CONTAGENS, E NÃO UM `neq`
 * ------------------------------------------
 * `escritural` não é coluna: vem de `tipo_produto_fiscal === 'ESCRITURAL'`
 * (ver mapProductRow), e essa coluna é NULLABLE. Um `neq('tipo_produto_fiscal',
 * 'ESCRITURAL')` vira `<> 'ESCRITURAL'` no SQL, e comparação com NULL dá NULL —
 * a linha some da contagem. Mas em JavaScript `null === 'ESCRITURAL'` é false,
 * então `getProducts()` a INCLUI. As duas respostas discordariam, e o número na
 * tela ficaria menor que a lista, sem nada explicando a diferença.
 *
 * Total menos escriturais não tem esse problema: o `eq` só casa com quem é, e o
 * NULL fica no total — exatamente como o filtro em JavaScript faz.
 */
async function contarProducts({ incluirEscriturais = false } = {}) {
  const { count: total, error } = await banco.from('products').select('*', { count: 'exact', head: true });
  assertNoError(error, 'contarProducts');
  if (incluirEscriturais) return total || 0;
  const { count: escriturais, error: erroEscriturais } = await banco
    .from('products').select('*', { count: 'exact', head: true }).eq('tipo_produto_fiscal', 'ESCRITURAL');
  assertNoError(erroEscriturais, 'contarProducts/escriturais');
  return (total || 0) - (escriturais || 0);
}

async function getProductById(id) {
  const { data, error } = await banco.from('products').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getProductById');
  return mapProductRow(data);
}

async function upsertProduct(payload) {
  const id = payload.id || createId('prod');
  const row = {
    id,
    name: payload.name,
    sku: payload.sku,
    stock_quantity: Number(payload.stockQuantity || 0),
    cost_price: Number(payload.costPrice || 0),
    sale_price: Number(payload.salePrice || 0),
    ...camposFiscaisDoProduto(payload)
  };
  const { error } = await banco.from('products').upsert(row);
  assertNoError(error, 'upsertProduct');
  return mapProductRow(row);
}

/**
 * SÓ O CUSTO, SEM ENCOSTAR NO SALDO.
 *
 * upsertProduct grava a linha inteira, inclusive stock_quantity. Quem quer
 * mudar o custo de um produto que ACABOU de ser comprado tem em mãos o objeto
 * lido ANTES da compra — mandá-lo de volta regrava o total antigo por cima.
 *
 * Enquanto o total e o razão eram somados no mesmo lugar isso passava
 * despercebido, porque a ordem das duas escritas acertava o resultado por
 * acaso. Com a fase AP o total virou `stock_quantity + delta` dentro de uma
 * transação, e regravar o absoluto aqui é exatamente a corrida que aquela fase
 * removeu: duas compras simultâneas leem 100, as duas escrevem 100, e a soma de
 * uma delas some sem erro nenhum.
 *
 * Custo é decisão de quem lança; saldo é consequência do razão. São duas
 * escritas diferentes porque são duas decisões diferentes.
 */
async function atualizarCusto(id, costPrice) {
  const { error } = await banco.from('products').update({ cost_price: Number(costPrice || 0) }).eq('id', id);
  assertNoError(error, 'atualizarCusto');
}

// Erro 23503 = violação de FK (Postgres). No schema atual, quem tem FK real
// pra products(id) é di_adicao (Declaração de Importação, raro na prática),
// além de sales/purchases — estas últimas já recebem dados de verdade desde a
// migração de Vendas/Compras pro Supabase.
function assertNoForeignKeyError(error, context, friendlyMessage) {
  if (error && error.code === '23503') {
    const err = new Error(friendlyMessage);
    err.status = 409;
    throw err;
  }
  assertNoError(error, context);
}

async function deleteProduct(id) {
  const { error } = await banco.from('products').delete().eq('id', id);
  assertNoForeignKeyError(error, 'deleteProduct', 'Não é possível excluir: este produto está vinculado a notas fiscais emitidas.');
  return true;
}

// Só o saldo — usado pelas movimentações de estoque, que não devem tocar em
// nome/SKU/preços do produto.
async function updateProductStock(id, stockQuantity) {
  const { error } = await banco
    .from('products')
    .update({ stock_quantity: Number(stockQuantity || 0) })
    .eq('id', id);
  assertNoError(error, 'updateProductStock');
  return true;
}

module.exports = { getProducts, contarProducts, getProductById, upsertProduct, atualizarCusto, deleteProduct, updateProductStock };
