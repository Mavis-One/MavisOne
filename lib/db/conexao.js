/**
 * A CONEXÃO COM O POSTGRES — e os tipos que ela devolve.
 *
 * Este arquivo substitui o createClient() do Supabase. O que ele tem de
 * diferente de um `new Pool()` qualquer é a segunda metade: os PARSERS DE TIPO.
 *
 * POR QUE MEXER NOS PARSERS EM VEZ DE ACEITAR O PADRÃO DO DRIVER
 * --------------------------------------------------------------
 * O resto do sistema (os 15 módulos de lib/db) foi escrito contra o PostgREST,
 * que entrega tudo como JSON. O driver `pg` entrega objetos JavaScript nativos,
 * e nos poucos pontos em que os dois discordam a diferença é SILENCIOSA — o
 * dado chega, só chega diferente. Três casos, todos medidos neste schema:
 *
 *   bytea      PostgREST manda a string "\x4d5a...". O `pg` manda um Buffer.
 *              lib/db/fiscal.js faz String(row.conteudo).replace(/^\\x/,'') e
 *              lê hexadecimal — num Buffer isso vira lixo em UTF-8, e o XML da
 *              NF-e sai corrompido sem ninguém reclamar.
 *
 *   date       PostgREST manda "2026-08-31". O `pg` monta um Date na meia-noite
 *              LOCAL — que em qualquer fuso a oeste de Greenwich é o dia
 *              anterior às 21h. Vencimento de parcela andaria um dia.
 *
 *   numeric    PostgREST manda número JSON. O `pg` manda string, porque numeric
 *              não cabe em double sem perder precisão. "100.00" + 50 daria
 *              "100.0050" numa soma de valores.
 *
 * A regra deste arquivo é uma só: DEVOLVER O QUE O POSTGREST DEVOLVIA. Não é o
 * formato mais bonito — é o formato contra o qual o sistema inteiro já foi
 * escrito e testado. Mudar os dois lados de uma vez seria trocar uma migração
 * verificável por uma caçada a bug.
 *
 * O numeric vira Number aqui, então: sim, dinheiro passa por double. Isso NÃO é
 * uma regressão — é exatamente o que já acontecia com o PostgREST, e a conta
 * fiscal de verdade é feita em lib/calcularTributos.js, que arredonda a cada
 * passo. Se um dia o sistema precisar de precisão exata em repouso, o lugar de
 * resolver é lá e no schema (numeric na conta, não em double), não aqui.
 */

const { Pool, types } = require('pg');

// OIDs dos tipos do Postgres. Números fixos no catálogo do banco, não mudam
// entre versões — por isso podem ser constantes e não uma consulta.
const OID = {
  BYTEA: 17,
  INT8: 20,
  FLOAT4: 700,
  FLOAT8: 701,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  NUMERIC: 1700
};

/**
 * bytea: entrega o texto cru do Postgres, que já é "\x<hex>" — o mesmo formato
 * que o PostgREST usava. Sem parser, o driver montaria um Buffer.
 */
types.setTypeParser(OID.BYTEA, (texto) => texto);

/**
 * date: string "AAAA-MM-DD", sem fuso e sem Date. Uma data de vencimento não
 * tem hora nem fuso; transformá-la em instante é inventar informação que o
 * banco não guardou, e a invenção sempre erra para o lado do dia anterior.
 */
types.setTypeParser(OID.DATE, (texto) => texto);

/**
 * timestamptz: ISO 8601 com Z, como o PostgREST. O texto cru do Postgres vem
 * como "2026-08-31 15:00:00+00" (espaço no lugar do T), que new Date() em Node
 * até aceita, mas que quebra qualquer código que corte a string. Normalizar
 * aqui deixa uma forma só circulando no sistema.
 */
function paraIso(texto) {
  if (!texto) return texto;
  const instante = new Date(texto);
  // "infinity" e "-infinity" são timestamps válidos no Postgres e viram Invalid
  // Date. Devolver o texto cru é melhor do que devolver null: preserva o dado.
  return Number.isNaN(instante.getTime()) ? texto : instante.toISOString();
}
types.setTypeParser(OID.TIMESTAMPTZ, paraIso);

/**
 * timestamp (sem fuso): hoje o schema não tem nenhuma coluna assim — foi
 * conferido. O parser existe para o dia em que alguém criar uma: sem ele, essa
 * coluna sairia como Date e reintroduziria o problema do date. Aqui NÃO se
 * converte para UTC, porque não há fuso para converter: só troca o espaço pelo
 * T e mantém o que o banco guardou.
 */
types.setTypeParser(OID.TIMESTAMP, (texto) => (texto ? String(texto).replace(' ', 'T') : texto));

/**
 * numeric / int8: número, como no JSON do PostgREST. Ver o cabeçalho sobre
 * precisão — a escolha é deliberada e mantém o comportamento de hoje.
 */
const paraNumero = (texto) => (texto === null ? null : Number(texto));
types.setTypeParser(OID.NUMERIC, paraNumero);
types.setTypeParser(OID.INT8, paraNumero);

// Os mesmos parsers valem para as versões em ARRAY dos tipos acima. Sem isto,
// uma coluna numeric[] voltaria com strings dentro enquanto numeric volta com
// números — a incoerência mais difícil de achar que existe.
const OID_ARRAY = { 1001: OID.BYTEA, 1016: OID.INT8, 1182: OID.DATE, 1115: OID.TIMESTAMP, 1185: OID.TIMESTAMPTZ, 1231: OID.NUMERIC };
for (const [oidArray, oidElemento] of Object.entries(OID_ARRAY)) {
  const parseElemento = types.getTypeParser(Number(oidElemento));
  const parseArrayPadrao = types.getTypeParser(Number(oidArray));
  types.setTypeParser(Number(oidArray), (texto) => {
    const lista = parseArrayPadrao(texto);
    return Array.isArray(lista) ? lista.map((item) => (item === null ? null : parseElemento(String(item)))) : lista;
  });
}

/**
 * A URL de conexão. Uma variável só, no formato que todo mundo entende
 * (psql, pg_dump, Portainer), em vez do par URL + chave do Supabase.
 */
function urlDoBanco() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL precisa estar definida nas variáveis de ambiente (veja .env.example).\n' +
      'Para o Postgres em Docker deste repositório, o valor é:\n' +
      '  DATABASE_URL=postgres://mavisone:mavisone@localhost:5432/mavisone'
    );
  }
  return url;
}

let pool = null;

/**
 * O pool é PREGUIÇOSO de propósito: criado na primeira consulta, não no
 * require. Vários scripts do repositório carregam lib/db só para ler o
 * código-fonte (os testes puros fazem exatamente isso) e não devem exigir banco
 * no ar nem DATABASE_URL definida só para serem carregados.
 */
function obterPool() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: urlDoBanco(),
    // O servidor é um processo Node só, com dezenas de rotas curtas. 10 conexões
    // sobram; o padrão do driver também é 10, está explícito para quem for
    // ajustar na VPS saber onde mexer.
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    // Sem isto, uma queda de rede deixa o processo pendurado para sempre numa
    // consulta. 10s é folgado para consulta local e curto para dar erro legível.
    connectionTimeoutMillis: Number(process.env.DATABASE_TIMEOUT_MS || 10000)
  });
  // Um erro num cliente ocioso do pool é evento, não exceção: sem este
  // ouvinte, o Node derruba o processo inteiro quando o banco reinicia.
  pool.on('error', (erro) => {
    console.error('[banco] conexão ociosa caiu:', erro.message);
  });
  return pool;
}

async function consultar(sql, parametros) {
  return obterPool().query(sql, parametros);
}

async function fecharPool() {
  if (!pool) return;
  const atual = pool;
  pool = null;
  await atual.end();
}

module.exports = { obterPool, consultar, fecharPool, urlDoBanco, OID };
