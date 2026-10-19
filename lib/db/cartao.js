/**
 * AS TABELAS DO CARTÃO (fase ET, 19/10/2026): taxas da credenciadora, fatores
 * do simulador da loja e os PVs. A conta mora em
 * public/modules/shared/cartao_simulador.js; aqui só se lê e se grava.
 *
 * GRAVAR É ACRESCENTAR UMA VIGÊNCIA, NÃO SOBRESCREVER: a taxa ou o fator
 * alterado hoje entra com vigência de hoje, e a venda de ontem continua sendo
 * recalculada com o número de ontem (o simulador pega a vigência mais recente
 * que não passa da data do pedido). Corrigir duas vezes no mesmo dia atualiza
 * a linha do dia.
 */
'use strict';

const { consultar } = require('./conexao');

const dia = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

function mapTaxa(r) {
  return {
    id: String(r.id),
    tabela: r.tabela,
    vigencia: dia(r.vigencia),
    credenciadoraCnpj: r.credenciadora_cnpj || '',
    canal: r.canal,
    bandeira: r.bandeira,
    modalidade: r.modalidade,
    parcelas: Number(r.parcelas),
    taxa: Number(r.taxa),
    prazoDias: r.prazo_dias === null ? null : Number(r.prazo_dias),
    prazoDiasUteis: r.prazo_dias_uteis !== false,
    taxaPorParcela: r.taxa_por_parcela === true,
    atualizadoPor: r.atualizado_por || ''
  };
}

function mapFator(r) {
  return {
    id: String(r.id),
    empresaId: r.empresa_id || '',
    canal: r.canal,
    modalidade: r.modalidade,
    parcelas: Number(r.parcelas),
    fator: Number(r.fator),
    vigencia: dia(r.vigencia),
    atualizadoPor: r.atualizado_por || ''
  };
}

function mapPv(r) {
  return {
    pv: r.pv,
    nome: r.nome,
    empresaId: r.empresa_id || '',
    credenciadoraCnpj: r.credenciadora_cnpj || '',
    ativo: r.ativo !== false
  };
}

/** Tudo de uma vez. Sem a migração (tabelas ausentes), listas vazias. */
async function lerTabelas() {
  try {
    const [taxas, fatores, pvs] = await Promise.all([
      consultar('select * from cartao_taxas order by canal, bandeira, modalidade, parcelas, vigencia'),
      consultar('select * from cartao_fatores order by empresa_id, canal, modalidade, parcelas, vigencia'),
      consultar('select * from cartao_pvs order by nome')
    ]);
    return { taxas: taxas.rows.map(mapTaxa), fatores: fatores.rows.map(mapFator), pvs: pvs.rows.map(mapPv) };
  } catch (erro) {
    if (/cartao_(taxas|fatores|pvs)/.test(String(erro.message || ''))) return { taxas: [], fatores: [], pvs: [] };
    throw erro;
  }
}

/** Fatores alterados: uma vigência nova (hoje) por fator. */
async function gravarFatores(lista, { empresaId = '', vigencia, usuario }) {
  for (const f of lista) {
    await consultar(
      `insert into cartao_fatores (empresa_id, canal, modalidade, parcelas, fator, vigencia, atualizado_por)
       values ($1, $2, $3, $4, $5, $6::date, $7)
       on conflict (empresa_id, canal, modalidade, parcelas, vigencia)
       do update set fator = excluded.fator, atualizado_por = excluded.atualizado_por`,
      [empresaId || '', f.canal, f.modalidade, f.parcelas, f.fator, vigencia, usuario || '']
    );
  }
}

/** Taxas alteradas: uma vigência nova (hoje), na tabela "Ajuste manual". */
async function gravarTaxas(lista, { vigencia, usuario, credenciadoraCnpj = '' }) {
  for (const t of lista) {
    await consultar(
      `insert into cartao_taxas (tabela, vigencia, credenciadora_cnpj, canal, bandeira, modalidade, parcelas, taxa,
                                 prazo_dias, prazo_dias_uteis, taxa_por_parcela, atualizado_por)
       values ('Ajuste manual', $1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (tabela, vigencia, canal, bandeira, modalidade, parcelas)
       do update set taxa = excluded.taxa, prazo_dias = excluded.prazo_dias, prazo_dias_uteis = excluded.prazo_dias_uteis,
                     taxa_por_parcela = excluded.taxa_por_parcela, atualizado_por = excluded.atualizado_por`,
      [vigencia, credenciadoraCnpj, t.canal, t.bandeira, t.modalidade, t.parcelas, t.taxa,
        t.prazoDias === null || t.prazoDias === undefined || t.prazoDias === '' ? null : Number(t.prazoDias),
        t.prazoDiasUteis !== false, t.taxaPorParcela === true, usuario || '']
    );
  }
}

async function gravarPv(pv, { empresaId, ativo }) {
  const { rowCount } = await consultar(
    'update cartao_pvs set empresa_id = $2, ativo = $3 where pv = $1',
    [String(pv || ''), String(empresaId || ''), ativo !== false]
  );
  return rowCount > 0;
}

module.exports = { lerTabelas, gravarFatores, gravarTaxas, gravarPv, mapTaxa, mapFator, mapPv };
