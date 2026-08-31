/**
 * O CLIENTE DO BANCO — mesma porta, fundação nova.
 *
 * Este arquivo exporta exatamente o que sempre exportou: { supabase, createId,
 * assertNoError }. Os 15 módulos de lib/db, o server.js e os scripts continuam
 * fazendo require('./client') e chamando .from().select().eq() como sempre
 * fizeram. O que mudou é o que existe atrás: em vez de HTTP para o PostgREST
 * do Supabase, SQL direto num Postgres que roda em Docker.
 *
 * POR QUE O OBJETO AINDA SE CHAMA `supabase`
 * ------------------------------------------
 * Porque renomear em 230 lugares seria um diff que ninguém consegue revisar,
 * misturado com a mudança que de fato importa. O nome fica para uma limpeza
 * própria, depois que a troca de banco estiver provada em uso. Enquanto isso,
 * ele é um nome herdado — e este comentário é o aviso de que já não descreve
 * o que a coisa é.
 *
 * O QUE SUMIU
 * -----------
 * O Storage. Anexo de pedido agora mora numa tabela do próprio banco (ver
 * lib/db/anexos.js e a fase-am). Qualquer código que ainda tente usar
 * supabase.storage encontra um erro que diz para onde ir — em vez de um
 * "undefined is not a function" que não ensina nada.
 */

const { Consulta } = require('./consulta');
const { consultar, fecharPool } = require('./conexao');
const { citar } = require('./consulta');

/**
 * Chama uma função do banco. Existe uma no sistema: next_cadastro_code().
 *
 * O supabase-js devolve, para função que retorna um valor só, o VALOR — não uma
 * linha com uma coluna. lib/db/cadastros.js conta com isso (`return data` e usa
 * como string). Desembrulhar aqui mantém o contrato.
 */
async function rpc(nome, argumentos = {}) {
  try {
    const chaves = Object.keys(argumentos || {});
    // Argumentos vão nomeados (=>), como o PostgREST fazia: assim a ordem em
    // que o objeto foi escrito não importa, e um argumento novo na função não
    // desloca os outros.
    const parametros = chaves.map((chave, indice) => `${citar(chave)} => $${indice + 1}`);
    const valores = chaves.map((chave) => argumentos[chave]);
    const resultado = await consultar(`select * from ${citar(nome)}(${parametros.join(', ')})`, valores);
    const linhas = resultado.rows || [];

    if (!linhas.length) return { data: null, error: null };
    const colunas = Object.keys(linhas[0]);
    // Uma linha e uma coluna = escalar. É o caso do next_cadastro_code.
    if (linhas.length === 1 && colunas.length === 1) return { data: linhas[0][colunas[0]], error: null };
    return { data: linhas, error: null };
  } catch (erro) {
    return { data: null, error: { code: erro.code || null, message: erro.message || String(erro), details: erro.detail || null, hint: erro.hint || null } };
  }
}

const semStorage = () => {
  throw new Error(
    'O Storage do Supabase não existe mais. Anexo de pedido agora é tabela no Postgres — ' +
    'use lib/db/anexos.js (migração supabase/migrations/fase-am-anexos-no-banco.sql).'
  );
};

const supabase = {
  from(tabela) { return new Consulta(tabela); },
  rpc,
  get storage() { return semStorage(); }
};

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertNoError(error, context) {
  if (error) {
    const err = new Error(`${context}: ${error.message}`);
    err.cause = error;
    throw err;
  }
}

module.exports = { supabase, createId, assertNoError, fecharPool };
