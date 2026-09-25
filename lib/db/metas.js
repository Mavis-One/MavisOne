/**
 * METAS DE VENDA no banco (fase DC).
 *
 * O cálculo NÃO está aqui: rateio e faixa são regra pura, em lib/metas.js.
 * Deste arquivo saem linhas e nada mais — é a mesma divisão de
 * lib/db/estoque-razao.js e lib/relatorios-vendas.js.
 */
const { consultar } = require('./conexao');
const { createId } = require('../criar-id');

function mapear(row) {
  return {
    id: row.id,
    escopo: row.escopo,
    referenciaId: row.referencia_id,
    // SEMPRE 'YYYY-MM-DD'. O driver devolve Date para coluna `date`, e
    // `toISOString()` cru converteria para UTC — uma competência de
    // 2026-09-01 gravada num fuso a oeste voltaria 2026-08-31, e o rateio
    // atribuiria a meta de setembro a agosto. O recorte de 10 caracteres é
    // sobre a data LOCAL, que é o que a coluna guarda.
    competencia: row.competencia instanceof Date
      ? `${row.competencia.getFullYear()}-${String(row.competencia.getMonth() + 1).padStart(2, '0')}-01`
      : String(row.competencia || '').slice(0, 10),
    valor: Number(row.valor || 0),
    createdByName: row.created_by_name || '',
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || '')
  };
}

/**
 * As metas que tocam um intervalo de competências.
 *
 * Recebe as competências (primeiro dia do mês) de fora, e não o intervalo de
 * datas: quem sabe quais meses um período cobre é lib/metas.js, e refazer essa
 * conta aqui em SQL criaria a segunda regra de rateio.
 */
async function listarPorCompetencias(competencias, escopo) {
  const lista = [...new Set((competencias || []).filter(Boolean))];
  if (!lista.length) return [];
  const params = [lista];
  let sql = 'select * from metas_de_venda where competencia = any($1::date[])';
  if (escopo) {
    params.push(escopo);
    sql += ' and escopo = $2';
  }
  const { rows } = await consultar(`${sql} order by competencia, referencia_id`, params);
  return rows.map(mapear);
}

/** Todas, para a tela de cadastro. Ordenadas do mês mais recente para trás. */
async function listar({ escopo = '', de = '', ate = '' } = {}) {
  const params = [];
  const onde = [];
  if (escopo) { params.push(escopo); onde.push(`escopo = $${params.length}`); }
  if (de) { params.push(de); onde.push(`competencia >= $${params.length}::date`); }
  if (ate) { params.push(ate); onde.push(`competencia <= $${params.length}::date`); }
  const { rows } = await consultar(
    `select * from metas_de_venda${onde.length ? ` where ${onde.join(' and ')}` : ''}
      order by competencia desc, escopo, referencia_id`,
    params
  );
  return rows.map(mapear);
}

/**
 * Grava a meta de um mês.
 *
 * `on conflict` no índice único: salvar de novo o mesmo escopo/referência/mês
 * ATUALIZA o valor em vez de criar um segundo alvo. Sem isto, corrigir a meta de
 * setembro somaria as duas e a loja apareceria com o dobro — a mesma decisão do
 * `salvarItem` da contagem de estoque.
 */
async function salvar({ escopo, referenciaId, competencia, valor, user }) {
  const { rows } = await consultar(
    `insert into metas_de_venda (id, escopo, referencia_id, competencia, valor, created_by, created_by_name)
     values ($1, $2, $3, $4::date, $5, $6, $7)
     on conflict (escopo, referencia_id, competencia) do update
        set valor = excluded.valor,
            updated_at = now()
     returning *`,
    [createId('meta'), String(escopo), String(referenciaId), String(competencia),
      Number(valor || 0), String(user?.id || ''), String(user?.name || '')]
  );
  return mapear(rows[0]);
}

async function remover(id) {
  const { rows } = await consultar('delete from metas_de_venda where id = $1 returning id', [id]);
  return rows.length > 0;
}

module.exports = { listar, listarPorCompetencias, salvar, remover, mapear };
