/**
 * ORIGENS DA VENDA no banco. Tabela da fase-az: `sales_origins`.
 *
 * Diz POR ONDE a venda chegou — balcão, televendas, e-commerce, indicação — e
 * não O QUE ela é. Isso é a categoria (fase AS), e as duas convivem na mesma
 * venda: um atacado que entrou por televendas.
 *
 * Até a fase AZ a lista era uma constante dentro do public/app.js, sem tela.
 * Ver o cabeçalho da migração.
 *
 * EXCLUIR É DIFERENTE DE INATIVAR:
 *
 *   inativar — some do formulário, continua no histórico. É o que se quer em
 *              99% dos casos.
 *   excluir  — só quando ninguém usou. `orders.sale_origin` guarda o NOME, não
 *              o id, então apagar uma origem em uso deixaria pedidos com um
 *              texto que nenhuma tela sabe mais de onde veio.
 */

const { banco, createId, assertNoError } = require('./client');
const { consultar } = require('./conexao');

function mapOrigem(row) {
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
  let consulta = banco.from('sales_origins').select('*');
  if (apenasAtivas) consulta = consulta.eq('status', 'ativo');
  const { data, error } = await consulta.order('name', { ascending: true });
  assertNoError(error, 'listarOrigensVenda');
  return (data || []).map(mapOrigem);
}

async function obter(id) {
  const { data, error } = await banco.from('sales_origins').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'obterOrigemVenda');
  return mapOrigem(data);
}

function normalizar(payload) {
  const name = String(payload.name || '').trim();
  if (!name) {
    const erro = new Error('Informe o nome da origem.');
    erro.status = 400;
    throw erro;
  }
  return {
    name,
    code: String(payload.code || '').trim(),
    // Qualquer coisa fora do par vira 'ativo': um status inventado esconderia a
    // origem do formulário sem que nenhuma tela explicasse por quê.
    status: payload.status === 'inativo' ? 'inativo' : 'ativo',
    notes: String(payload.notes || '').trim()
  };
}

/**
 * O erro de nome duplicado vem do BANCO (índice único sobre lower(name)) e é
 * traduzido aqui. Conferir antes com um select seria uma checagem que duas
 * requisições simultâneas atravessam: as duas leem "não existe", as duas
 * gravam.
 */
function traduzirDuplicata(erro, name) {
  const codigo = erro && (erro.code || (erro.cause && erro.cause.code));
  const texto = String((erro && erro.message) || '');
  if (codigo === '23505' || /idx_sales_origins_nome|duplicate key/i.test(texto)) {
    const claro = new Error(`Já existe uma origem de venda chamada "${name}". Nomes iguais só mudando maiúsculas contam como o mesmo.`);
    claro.status = 409;
    return claro;
  }
  return erro;
}

async function criar(payload) {
  const dados = normalizar(payload);
  const id = createId('origven');
  try {
    const { error } = await banco.from('sales_origins').insert({ id, ...dados });
    assertNoError(error, 'criarOrigemVenda');
  } catch (erro) {
    throw traduzirDuplicata(erro, dados.name);
  }
  return obter(id);
}

async function atualizar(id, payload) {
  const dados = normalizar(payload);
  try {
    const { error } = await banco.from('sales_origins')
      .update({ ...dados, updated_at: new Date().toISOString() })
      .eq('id', id);
    assertNoError(error, 'atualizarOrigemVenda');
  } catch (erro) {
    throw traduzirDuplicata(erro, dados.name);
  }
  return obter(id);
}

/**
 * Quantos registros usam esta origem.
 *
 * PEDIDOS **E** ORÇAMENTOS, e é a diferença para a categoria de venda: as duas
 * tabelas têm `sale_origin`, e contar só uma diria "ninguém usa" sobre uma
 * origem presente em vinte orçamentos — que a exclusão apagaria em silêncio.
 *
 * Consulta crua porque a comparação é por NOME e sem diferenciar maiúsculas —
 * é assim que o valor foi gravado, e um `eq` exato deixaria de achar o registro
 * que ficou com "balcão" enquanto a origem se chama "Balcão".
 */
async function registrosQueUsam(nome) {
  const { rows } = await consultar(
    `select
       (select count(*) from orders where lower(trim(sale_origin)) = lower(trim($1)))::int as pedidos,
       (select count(*) from quotes where lower(trim(sale_origin)) = lower(trim($1)))::int as orcamentos`,
    [String(nome || '')]
  );
  const { pedidos, orcamentos } = rows[0];
  return { pedidos, orcamentos, total: pedidos + orcamentos };
}

/**
 * O USO DE VÁRIAS ORIGENS NUMA CONSULTA SÓ (fase DS).
 *
 * A lista de manutenção (GET /api/sales/origins) chamava `registrosQueUsam`
 * uma vez por origem, em fila: cada chamada varre `orders` inteira (a
 * comparação por `lower(trim(...))` não usa índice). Seis origens, seis
 * varreduras — 84 ms; e cada origem nova seria mais uma. Aqui as duas tabelas
 * são agrupadas UMA vez e cada nome é casado com o grupo dele: 15 ms.
 *
 * A COMPARAÇÃO É A MESMA, letra a letra: `lower(trim(sale_origin))` do lado do
 * registro e `lower(trim(nome))` do lado da origem — o grupo de um é
 * exatamente o conjunto que o `count(*) where ...` do outro contava.
 *
 * Devolve na MESMA ORDEM dos nomes recebidos (o `with ordinality`), um objeto
 * por nome, no formato de `registrosQueUsam`. `registrosQueUsam` continua
 * existindo para quem pergunta de uma origem só (excluir, renomear).
 */
async function registrosQueUsamCada(nomes) {
  const lista = (nomes || []).map((nome) => String(nome || ''));
  if (!lista.length) return [];
  const { rows } = await consultar(
    `with p as (select lower(trim(sale_origin)) as k, count(*)::int as n from orders group by 1),
          q as (select lower(trim(sale_origin)) as k, count(*)::int as n from quotes group by 1)
     select coalesce(p.n, 0)::int as pedidos, coalesce(q.n, 0)::int as orcamentos
       from unnest($1::text[]) with ordinality as x(nome, i)
       left join p on p.k = lower(trim(x.nome))
       left join q on q.k = lower(trim(x.nome))
      order by x.i`,
    [lista]
  );
  return rows.map(({ pedidos, orcamentos }) => ({ pedidos, orcamentos, total: pedidos + orcamentos }));
}

async function excluir(id) {
  const origem = await obter(id);
  if (!origem) return false;
  const uso = await registrosQueUsam(origem.name);
  if (uso.total > 0) {
    const partes = [];
    if (uso.pedidos) partes.push(`${uso.pedidos} ${uso.pedidos === 1 ? 'pedido' : 'pedidos'}`);
    if (uso.orcamentos) partes.push(`${uso.orcamentos} ${uso.orcamentos === 1 ? 'orçamento' : 'orçamentos'}`);
    const erro = new Error(
      `${partes.join(' e ')} ${uso.total === 1 ? 'usa' : 'usam'} a origem "${origem.name}". `
      + 'Marque como inativa em vez de excluir: assim ela some do formulário e o histórico continua explicável.'
    );
    erro.status = 409;
    throw erro;
  }
  const { error } = await banco.from('sales_origins').delete().eq('id', id);
  assertNoError(error, 'excluirOrigemVenda');
  return true;
}

module.exports = { listar, obter, criar, atualizar, excluir, registrosQueUsam, registrosQueUsamCada };
