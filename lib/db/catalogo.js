/**
 * O CATÁLOGO — o que o banco sabe sobre si mesmo, lido uma vez.
 *
 * O PostgREST monta as consultas sabendo o schema de cor: ele lê o catálogo do
 * Postgres ao subir e é por isso que `.upsert(linha)` sem mais nada sabe qual é
 * a chave primária, e que `select('*, nfe(...)')` sabe por qual coluna as duas
 * tabelas se ligam. A camada compatível precisa da mesma informação, pelo mesmo
 * motivo, e é isto aqui.
 *
 * TRÊS PERGUNTAS, E O QUE QUEBRA SEM CADA UMA
 * -------------------------------------------
 * 1. TIPO DE CADA COLUNA — para saber quais são json/jsonb.
 *    Sem isso: `update({ dashboard_pins: [1,2] })` numa coluna jsonb. O driver
 *    `pg` vê um array JavaScript e monta um ARRAY LITERAL do Postgres ("{1,2}"),
 *    não um JSON. A gravação falha com erro de sintaxe — ou pior, numa coluna
 *    de texto, grava "{1,2}" e ninguém percebe. É o caso real de users,
 *    orders.items, orders.payments e quotes.
 *
 * 2. CHAVE PRIMÁRIA DE CADA TABELA — para o upsert.
 *    `upsert(linha)` sem `onConflict` significa, no PostgREST, "conflito na
 *    chave primária". Em SQL isso é um ON CONFLICT (col) explícito: sem saber a
 *    coluna, não há como escrever o comando.
 *
 * 3. CHAVES ESTRANGEIRAS — para o select com relacionamento embutido.
 *    Existe exatamente um no sistema hoje (nfe_eventos → nfe), e ele não diz
 *    por qual coluna liga; quem sabe é o catálogo.
 *
 * POR QUE LER UMA VEZ E GUARDAR
 * -----------------------------
 * Schema não muda com o sistema no ar — muda quando alguém roda uma migração e
 * reinicia. Consultar information_schema a cada query seria dobrar o número de
 * idas ao banco para responder algo que não muda. Um processo novo relê tudo.
 *
 * O QUE ACONTECE COM TABELA QUE NÃO EXISTE
 * ----------------------------------------
 * Nada, aqui. O catálogo não valida nome de tabela: quem faz isso é o Postgres,
 * na hora, com o erro 42P01 — que é exatamente o código que lib/db/rbac.js já
 * trata para descobrir se uma migração ainda não rodou. Barrar antes tiraria
 * dele a informação que ele espera.
 */

const { consultar } = require('./conexao');

let promessaCatalogo = null;

async function carregar() {
  const colunas = await consultar(`
    select table_name, column_name, data_type, udt_name
      from information_schema.columns
     where table_schema = 'public'
  `);

  const chaves = await consultar(`
    select tc.table_name, kcu.column_name, kcu.ordinal_position
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema = tc.table_schema
     where tc.table_schema = 'public'
       and tc.constraint_type = 'PRIMARY KEY'
     order by tc.table_name, kcu.ordinal_position
  `);

  // As FKs saem do pg_constraint e não do information_schema porque ali a
  // ligação coluna-a-coluna vem pronta, sem o join triplo que o padrão exige.
  const estrangeiras = await consultar(`
    select
      origem.relname   as tabela,
      destino.relname  as tabela_destino,
      col_origem.attname  as coluna,
      col_destino.attname as coluna_destino
    from pg_constraint c
    join pg_class origem   on origem.oid  = c.conrelid
    join pg_class destino  on destino.oid = c.confrelid
    join pg_namespace n    on n.oid = origem.relnamespace
    join lateral unnest(c.conkey, c.confkey) as par(origem_num, destino_num) on true
    join pg_attribute col_origem  on col_origem.attrelid  = c.conrelid  and col_origem.attnum  = par.origem_num
    join pg_attribute col_destino on col_destino.attrelid = c.confrelid and col_destino.attnum = par.destino_num
    where c.contype = 'f' and n.nspname = 'public'
  `);

  const tipos = new Map();      // "tabela.coluna" -> udt_name (json, jsonb, text, ...)
  const primarias = new Map();  // tabela -> [colunas]
  const ligacoes = new Map();   // "tabela->destino" -> { coluna, colunaDestino }

  for (const linha of colunas.rows) {
    tipos.set(`${linha.table_name}.${linha.column_name}`, String(linha.udt_name || linha.data_type).toLowerCase());
  }
  for (const linha of chaves.rows) {
    if (!primarias.has(linha.table_name)) primarias.set(linha.table_name, []);
    primarias.get(linha.table_name).push(linha.column_name);
  }
  for (const linha of estrangeiras.rows) {
    // Só a primeira coluna de cada par interessa: o embutido do PostgREST é
    // sempre por uma FK simples, e FK composta não aparece em select embutido.
    const chave = `${linha.tabela}->${linha.tabela_destino}`;
    if (!ligacoes.has(chave)) ligacoes.set(chave, { coluna: linha.coluna, colunaDestino: linha.coluna_destino });
  }

  return { tipos, primarias, ligacoes };
}

function obterCatalogo() {
  // Guarda a PROMESSA, não o resultado: dez consultas disparadas juntas na
  // subida do servidor compartilham uma leitura só do catálogo, em vez de
  // dispararem dez.
  if (!promessaCatalogo) {
    promessaCatalogo = carregar().catch((erro) => {
      // Falha na leitura não pode ficar grudada na memória: a próxima consulta
      // tem que poder tentar de novo (banco que ainda estava subindo, por ex.).
      promessaCatalogo = null;
      throw erro;
    });
  }
  return promessaCatalogo;
}

function esquecerCatalogo() {
  promessaCatalogo = null;
}

/** O tipo cru da coluna ('jsonb', 'text', 'numeric'...), ou null se desconhecida. */
function tipoDaColuna(catalogo, tabela, coluna) {
  return catalogo.tipos.get(`${tabela}.${coluna}`) || null;
}

function ehColunaJson(catalogo, tabela, coluna) {
  const tipo = tipoDaColuna(catalogo, tabela, coluna);
  return tipo === 'json' || tipo === 'jsonb';
}

/** As colunas da chave primária. Lista vazia = tabela sem PK (ou inexistente). */
function chavePrimaria(catalogo, tabela) {
  return catalogo.primarias.get(tabela) || [];
}

/** Como `tabela` liga em `destino`, ou null se não houver FK entre as duas. */
function ligacao(catalogo, tabela, destino) {
  return catalogo.ligacoes.get(`${tabela}->${destino}`) || null;
}

module.exports = {
  obterCatalogo,
  esquecerCatalogo,
  tipoDaColuna,
  ehColunaJson,
  chavePrimaria,
  ligacao
};
