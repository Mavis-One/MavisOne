/**
 * CATEGORIAS DE VENDA no banco. Tabela da fase-as: `sales_categories`.
 *
 * Classifica a VENDA ("Varejo", "Atacado", "Bonificação"), não o que se vende —
 * para isso existem as categorias de produto, no Estoque. Ver o cabeçalho da
 * migração: o formulário de venda usava aquelas por falta desta.
 *
 * EXCLUIR É DIFERENTE DE INATIVAR, e as duas existem de propósito:
 *
 *   inativar — some do formulário, continua no histórico. É o que se quer em
 *              99% dos casos: a categoria deixou de ser usada, mas os pedidos
 *              antigos continuam explicáveis.
 *   excluir  — só quando ninguém usou. `orders.category` guarda o NOME, não o
 *              id, então apagar uma categoria em uso deixaria pedidos com um
 *              texto que nenhuma tela sabe mais de onde veio.
 */

const { banco, createId, assertNoError } = require('./client');
const { consultar } = require('./conexao');

function mapCategoria(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code || '',
    status: row.status || 'ativo',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listar({ apenasAtivas = false } = {}) {
  let consulta = banco.from('sales_categories').select('*');
  if (apenasAtivas) consulta = consulta.eq('status', 'ativo');
  const { data, error } = await consulta.order('name', { ascending: true });
  assertNoError(error, 'listarCategoriasVenda');
  return (data || []).map(mapCategoria);
}

async function obter(id) {
  const { data, error } = await banco.from('sales_categories').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'obterCategoriaVenda');
  return mapCategoria(data);
}

function normalizar(payload) {
  const name = String(payload.name || '').trim();
  if (!name) {
    const erro = new Error('Informe o nome da categoria.');
    erro.status = 400;
    throw erro;
  }
  return {
    name,
    code: String(payload.code || '').trim(),
    // Qualquer coisa fora do par vira 'ativo': um status inventado esconderia a
    // categoria do formulário sem que nenhuma tela explicasse por quê.
    status: payload.status === 'inativo' ? 'inativo' : 'ativo',
    notes: String(payload.notes || '').trim()
  };
}

/**
 * O erro de nome duplicado vem do BANCO (índice único sobre lower(name)), e é
 * traduzido aqui. Conferir antes com um select seria uma checagem que duas
 * requisições simultâneas atravessam: as duas leem "não existe", as duas
 * gravam. O índice é quem de fato garante; esta função só troca o código
 * 23505 por uma frase que diz o que fazer.
 */
function traduzirDuplicata(erro, name) {
  const codigo = erro && (erro.code || (erro.cause && erro.cause.code));
  const texto = String((erro && erro.message) || '');
  if (codigo === '23505' || /idx_sales_categories_nome|duplicate key/i.test(texto)) {
    const claro = new Error(`Já existe uma categoria de venda chamada "${name}". Nomes iguais só mudando maiúsculas contam como o mesmo.`);
    claro.status = 409;
    return claro;
  }
  return erro;
}

async function criar(payload) {
  const dados = normalizar(payload);
  const id = createId('catven');
  try {
    const { error } = await banco.from('sales_categories').insert({ id, ...dados });
    assertNoError(error, 'criarCategoriaVenda');
  } catch (erro) {
    throw traduzirDuplicata(erro, dados.name);
  }
  return obter(id);
}

async function atualizar(id, payload) {
  const dados = normalizar(payload);
  try {
    const { error } = await banco.from('sales_categories')
      .update({ ...dados, updated_at: new Date().toISOString() })
      .eq('id', id);
    assertNoError(error, 'atualizarCategoriaVenda');
  } catch (erro) {
    throw traduzirDuplicata(erro, dados.name);
  }
  return obter(id);
}

/**
 * Quantos pedidos usam esta categoria.
 *
 * Consulta crua porque a comparação é por NOME e sem diferenciar maiúsculas —
 * é assim que o valor foi gravado, e um `eq` exato deixaria de achar o pedido
 * que ficou com "varejo" enquanto a categoria se chama "Varejo".
 */
// FASE BO: ORÇAMENTO CONTA TAMBÉM. `quotes` tem a coluna `category` igual a
// `orders`, e a tela de venda é a MESMA para os dois — quem escolhe categoria
// num orçamento grava exatamente no mesmo lugar. Contando só pedidos, a tela
// mostrava "0 usos" numa categoria escolhida em dez orçamentos e a exclusão
// passava, deixando os dez com uma categoria que não existe mais.
async function registrosQueUsam(nome) {
  const { rows } = await consultar(
    `select
       (select count(*) from orders where lower(trim(category)) = lower(trim($1)))::int as pedidos,
       (select count(*) from quotes where lower(trim(category)) = lower(trim($1)))::int as orcamentos`,
    [String(nome || '')]
  );
  const { pedidos, orcamentos } = rows[0];
  return { pedidos, orcamentos, total: pedidos + orcamentos };
}

/** Compatibilidade: quem só quer o número total continua chamando assim. */
async function pedidosQueUsam(nome) {
  return (await registrosQueUsam(nome)).total;
}

async function excluir(id) {
  const categoria = await obter(id);
  if (!categoria) return false;
  const uso = await registrosQueUsam(categoria.name);
  if (uso.total > 0) {
    const partes = [];
    if (uso.pedidos) partes.push(`${uso.pedidos} ${uso.pedidos === 1 ? 'pedido' : 'pedidos'}`);
    if (uso.orcamentos) partes.push(`${uso.orcamentos} ${uso.orcamentos === 1 ? 'orçamento' : 'orçamentos'}`);
    const erro = new Error(
      `${partes.join(' e ')} ${uso.total === 1 ? 'usa' : 'usam'} a categoria "${categoria.name}". `
      + 'Marque como inativa em vez de excluir: assim ela some do formulário e os documentos continuam explicáveis.'
    );
    erro.status = 409;
    throw erro;
  }
  const { error } = await banco.from('sales_categories').delete().eq('id', id);
  assertNoError(error, 'excluirCategoriaVenda');
  return true;
}

module.exports = { listar, obter, criar, atualizar, excluir, pedidosQueUsam, registrosQueUsam };
