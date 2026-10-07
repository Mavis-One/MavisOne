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
    // Fase CS — os campos que só o PRODUTO pode responder na NF-e. IPI vence a
    // regra quando declarado aqui (a classificação da TIPI é do produto, não da
    // operação); EX TIPI e escala/fabricante não têm outra fonte possível.
    cstIpi: row.cst_ipi || '',
    // `?? null` e não `|| 0`: alíquota 0 com CST de IPI é informação (imune,
    // isento), e virar "não preenchido" faria a nota sair sem o grupo do IPI.
    aliquotaIpi: row.aliquota_ipi === null || row.aliquota_ipi === undefined ? null : Number(row.aliquota_ipi),
    codigoExTipi: row.codigo_ex_tipi || '',
    // TRÊS estados, e não dois: null = não declarado, e é o que faz o payload
    // OMITIR o indEscala em vez de afirmar algo sobre os 5.475 produtos.
    escalaRelevante: row.escala_relevante === null || row.escala_relevante === undefined ? null : Boolean(row.escala_relevante),
    cnpjFabricante: row.cnpj_fabricante || '',
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
  grupoTributarioId: 'grupo_tributario_id',
  // Fase CS
  cstIpi: 'cst_ipi',
  aliquotaIpi: 'aliquota_ipi',
  codigoExTipi: 'codigo_ex_tipi',
  escalaRelevante: 'escala_relevante',
  cnpjFabricante: 'cnpj_fabricante'
};

// Campos que NÃO são texto, e cada um por uma razão diferente. Passar qualquer
// um deles pelo `String(...).trim()` do caminho comum produziria o defeito
// escrito ao lado.
const NUMERICOS_FISCAIS = new Set(['origem', 'aliquotaIpi']);
const BOOLEANOS_FISCAIS = new Set(['escalaRelevante']);
const SO_DIGITOS_FISCAIS = new Set(['cnpjFabricante']);

function camposFiscaisDoProduto(payload) {
  const row = {};
  for (const [chave, coluna] of Object.entries(COLUNAS_FISCAIS)) {
    if (payload[chave] === undefined) continue;
    const valor = payload[chave];

    if (NUMERICOS_FISCAIS.has(chave)) {
      // Vazio é NULL, e zero é ZERO: alíquota de IPI 0 com CST de imune é
      // informação, e `Number('') === 0` a transformaria em "zero por cento
      // declarado" — que é outra coisa.
      row[coluna] = valor === '' || valor === null ? null : Number(valor);
      continue;
    }

    if (BOOLEANOS_FISCAIS.has(chave)) {
      // TRÊS estados. '' e null viram NULL ("não declarado"), e é isso que faz
      // o indEscala ser OMITIDO da nota em vez de afirmado. `Boolean('false')`
      // seria true, então a comparação é por texto.
      if (valor === '' || valor === null) { row[coluna] = null; continue; }
      row[coluna] = valor === true || valor === 'true' || valor === '1' || valor === 1;
      continue;
    }

    if (SO_DIGITOS_FISCAIS.has(chave)) {
      // A coluna é char(14) com CHECK de 14 dígitos: guardar com pontuação
      // derrubaria o INSERT, e o formulário aceita CNPJ formatado.
      const digitos = String(valor ?? '').replace(/\D/g, '');
      row[coluna] = digitos === '' ? null : digitos;
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
 * A MESMA LISTA DE getProducts, SÓ COM AS COLUNAS QUE QUEM PEDE VAI LER.
 *
 * Os seletores de produto (meta do Estoque, do PCP, o formulário de Compras)
 * liam `select *` dos 5.561 produtos — 23 colunas, ~53 ms — para devolver
 * id, nome e um ou dois preços. Duas colunas custam ~13 ms.
 *
 * TEM DE SAIR NA MESMA ORDEM, e por isso a consulta é a de getProducts com
 * menos colunas, e nada mais:
 *
 *   · `order by name`, sem `where`. O filtro do escritural continua em JS,
 *     depois. Com ele num WHERE (medido na simulação desta mudança), os
 *     produtos de NOME REPETIDO — 218 nomes, 457 produtos — saíram em outra
 *     ordem: a entrada do sort muda, e com ela o desempate que o Postgres faz
 *     entre nomes iguais. Sem WHERE, a leitura é a mesma e o desempate também;
 *     conferido contra getProducts nas colunas de cada chamador. O `order by
 *     name` não tem desempate declarado (nem em getProducts): fixá-lo aqui e não
 *     lá faria as duas listas discordarem justamente nesses 457.
 *   · `tipo_produto_fiscal` vem sempre junto, porque é dele que mapProductRow
 *     deriva `escritural` — sem a coluna, todo produto pareceria mercadoria.
 *
 * Os campos que a coluna não trouxe saem no padrão do mapProductRow (0, '',
 * null). Quem chama recorta para os campos que pediu; nunca devolve o objeto
 * como se fosse o produto inteiro.
 */
async function getProductsResumidos(colunas, { incluirEscriturais = false } = {}) {
  const { data, error } = await banco.from('products')
    .select(`${colunas}, tipo_produto_fiscal`).order('name', { ascending: true });
  assertNoError(error, 'getProductsResumidos');
  const lista = (data || []).map(mapProductRow);
  return incluirEscriturais ? lista : lista.filter((p) => !p.escritural);
}

/**
 * Os produtos destes ids, completos (`select *`), numa consulta só.
 *
 * É getProductById para vários: o contexto de uma escrita de Estoque precisa
 * dos produtos que ela toca, e não dos 5.561. Como getProductById, NÃO filtra
 * os itens só fiscais — a resolução por id é completa (um registro antigo que
 * aponte para um deles continua resolvendo). Sem ordem: quem chama monta um Map.
 */
async function getProductsPorIds(ids) {
  const lista = [...new Set((ids || []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!lista.length) return [];
  const { data, error } = await banco.from('products').select('*').in('id', lista);
  assertNoError(error, 'getProductsPorIds');
  return (data || []).map(mapProductRow);
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

// Os produtos de uma lista de ids, numa consulta, com o MESMO mapeamento de
// getProductById (e, como ele, sem filtrar escritural). Map id -> produto,
// com null para id que não existe — o que getProductById devolveria. É o
// pré-check fiscal que lê assim: um mês tinha 679 getProductById em fila.
//
// SÓ ID EM TEXTO entra no mapa. `products.id` é text, e a chave do Map é o
// valor como veio: um id numérico (5) ficaria na chave 5 com null enquanto a
// linha chega como "5" — e o produto pareceria não existir. Quem não está no
// mapa é lido um a um, por getProductById, como sempre foi.
//
// "EmMapa" no nome porque devolve Map com TODO id pedido (null para o que não
// existe), e não uma lista: quem confere "o produto existe?" precisa disso.
async function getProductsEmMapaPorIds(ids) {
  const lista = [...new Set((ids || []).filter((id) => typeof id === 'string' && id))];
  const porId = new Map(lista.map((id) => [id, null]));
  if (!lista.length) return porId;
  const { data, error } = await banco.from('products').select('*').in('id', lista);
  assertNoError(error, 'getProductsEmMapaPorIds');
  for (const row of data || []) porId.set(row.id, mapProductRow(row));
  return porId;
}

// (Antes de getProductById, e não depois: test-complemento-icms.js confere o
// trecho entre getProductById e upsertProduct.)
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

// mapProductRow: para os recortes do Início (lib/db/painel-inicio.js) devolverem
// o produto com a MESMA forma — inclusive o `escritural` que decide o filtro.
/**
 * VÁRIOS PRODUTOS PELO ID, NUMA IDA SÓ (fase DS).
 *
 * Faturar e cancelar pedido liam produto a produto (`getProductById` em laço,
 * duas vezes por item): 20 itens eram 40 idas em fila, 34,9 ms contra 1,2 ms
 * desta consulta. Devolve um Map id -> produto com o MESMO mapper de
 * getProductById; o id que não existe simplesmente não está no Map, e quem
 * chama decide o que isso significa (é o `null` de getProductById).
 *
 * Escritural vem junto, como em getProductById: quem precisar tirá-lo filtra.
 */
async function getProdutosPorIds(ids) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return new Map();
  const { data, error } = await banco.from('products').select('*').in('id', lista);
  assertNoError(error, 'getProdutosPorIds');
  return new Map((data || []).map((row) => [row.id, mapProductRow(row)]));
}

module.exports = {
  getProducts, mapProductRow, contarProducts, getProductById, getProductsEmMapaPorIds, upsertProduct, atualizarCusto, deleteProduct, updateProductStock,
  getProdutosPorIds,
  // Recortes de leitura: os seletores de produto e o contexto das escritas de
  // Estoque. Ver o bloco de cada uma.
  getProductsResumidos, getProductsPorIds
};
