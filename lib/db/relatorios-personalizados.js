/**
 * RELATÓRIOS PERSONALIZADOS no banco (fase DQ).
 *
 * Daqui saem e entram linhas e nada mais: o que pode ser gravado é conferido
 * antes, em lib/relatorios/personalizado.js (validarDefinicao), e quem pode
 * ver, editar ou excluir é decidido na rota.
 */
const { consultar } = require('./conexao');
const { createId } = require('../criar-id');

const iso = (v) => (v instanceof Date ? v.toISOString() : (v ? String(v) : ''));

function mapear(row) {
  return {
    id: row.id,
    nome: row.nome,
    fonte: row.fonte,
    colunas: Array.isArray(row.colunas) ? row.colunas : [],
    filtros: Array.isArray(row.filtros) ? row.filtros : [],
    ordem: Array.isArray(row.ordem) ? row.ordem : [],
    compartilhado: row.compartilhado !== false,
    criadoPor: row.criado_por || '',
    criadoPorNome: row.criado_por_nome || '',
    criadoEm: iso(row.criado_em),
    atualizadoEm: iso(row.atualizado_em),
    ultimaExecucao: iso(row.ultima_execucao)
  };
}

async function listar() {
  const { rows } = await consultar('select * from relatorio_personalizado order by lower(nome), criado_em');
  return rows.map(mapear);
}

async function buscar(id) {
  const { rows } = await consultar('select * from relatorio_personalizado where id = $1', [id]);
  return rows[0] ? mapear(rows[0]) : null;
}

async function criar(def, user) {
  const { rows } = await consultar(
    `insert into relatorio_personalizado (id, nome, fonte, colunas, filtros, ordem, compartilhado, criado_por, criado_por_nome)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9)
     returning *`,
    [createId('rel'), def.nome, def.fonte, JSON.stringify(def.colunas), JSON.stringify(def.filtros), JSON.stringify(def.ordem),
      def.compartilhado, (user && user.id) || null, (user && (user.name || user.username)) || null]
  );
  return mapear(rows[0]);
}

async function atualizar(id, def) {
  const { rows } = await consultar(
    `update relatorio_personalizado
        set nome = $2, fonte = $3, colunas = $4::jsonb, filtros = $5::jsonb, ordem = $6::jsonb,
            compartilhado = $7, atualizado_em = now()
      where id = $1
      returning *`,
    [id, def.nome, def.fonte, JSON.stringify(def.colunas), JSON.stringify(def.filtros), JSON.stringify(def.ordem), def.compartilhado]
  );
  return rows[0] ? mapear(rows[0]) : null;
}

async function excluir(id) {
  const { rowCount } = await consultar('delete from relatorio_personalizado where id = $1', [id]);
  return rowCount > 0;
}

/** A "Data Última Sincronização" do Viper: quando o relatório rodou pela última vez. */
async function marcarExecucao(id) {
  await consultar('update relatorio_personalizado set ultima_execucao = now() where id = $1', [id]);
}

module.exports = { listar, buscar, criar, atualizar, excluir, marcarExecucao };
