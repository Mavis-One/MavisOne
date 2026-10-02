/**
 * RELATÓRIOS DO FISCAL.
 *
 * Duas fontes, e cada relatório diz a sua:
 *
 *   · `nfe` é a TRANSMISSÃO — toda nota que passou pela Focus, em qualquer
 *     estado (rascunho, erro, autorizada, cancelada). É a lista de "NF-e
 *     Emitidas" e a dos eventos.
 *
 *   · `fiscal_documentos` é a ESCRITURAÇÃO — o documento com imposto por item,
 *     o mesmo que o SPED lê. Itens, faturamento e CFOP saem daqui, só da saída
 *     de emissão própria, e sem o documento que não vale (cancelado, denegado,
 *     inutilizado): somá-lo seria faturar a nota que a SEFAZ desfez.
 *
 * As datas com hora (`timestamptz`) viram dia no fuso do Brasil, como no SPED.
 */

const FUSO = 'America/Sao_Paulo';

const SAIDA_PROPRIA_VALIDA = `d.emissao_propria and d.sentido = 'SAIDA'
  and d.situacao not in ('CANCELADO', 'CANCELADO_EXTEMPORANEO', 'DENEGADO', 'INUTILIZADO')`;

// O vocabulário da tela NF-e Emitidas, para o status da transmissão.
const SITUACOES_DA_NFE = {
  RASCUNHO: 'Rascunho',
  PROCESSANDO: 'Processando',
  AUTORIZADO: 'Autorizada',
  ERRO: 'Erro',
  CANCELADO: 'Cancelada',
  DENEGADO: 'Denegada',
  INUTILIZADO: 'Inutilizada'
};

const TIPOS_DE_EVENTO = { CCE: 'Carta de Correção', CANCELAMENTO: 'Cancelamento', INUTILIZACAO: 'Inutilização' };

/** Período em que cada ponta pode vir vazia ('' = sem limite daquele lado). */
const noPeriodo = (expr, de, ate) => `($${de} = '' or ${expr} >= $${de}::date) and ($${ate} = '' or ${expr} <= $${ate}::date)`;

/** Número de nota em texto: "10" viria antes de "9" na ordem alfabética. */
const ORDEM_DO_NUMERO = (alias) => `case when ${alias}.numero ~ '^[0-9]{1,18}$' then ${alias}.numero::bigint end, ${alias}.numero`;

const n = (v) => Number(v || 0);
const textoDe = (v) => (v === null || v === undefined ? '' : String(v));
const nota = (numero, serie) => (textoDe(serie) ? `${textoDe(numero)}/${textoDe(serie)}` : textoDe(numero));

const NOME_DO_ESTABELECIMENTO = "coalesce(nullif(btrim(es.nome_fantasia), ''), es.razao_social, 'Sem estabelecimento')";

module.exports = [
  {
    key: 'nfe-emitidas',
    grupo: 'fiscal',
    titulo: 'NF-e Emitidas',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'numero', rotulo: 'Número', tipo: 'texto' },
      { campo: 'serie', rotulo: 'Série', tipo: 'texto' },
      { campo: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { campo: 'estabelecimento', rotulo: 'Estabelecimento', tipo: 'texto' },
      { campo: 'destinatario', rotulo: 'Destinatário', tipo: 'texto' },
      { campo: 'documento', rotulo: 'CPF/CNPJ', tipo: 'texto' },
      { campo: 'natureza', rotulo: 'Natureza', tipo: 'texto' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda', semTotal: true },
      // A lista traz toda nota transmitida, inclusive cancelada e com erro, mas
      // o total soma só a autorizada: somar a cancelada seria faturar o que a
      // SEFAZ desfez.
      { campo: 'valorAutorizado', rotulo: 'Valor autorizado', tipo: 'moeda' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: ['valorAutorizado'],
    async executar({ sql, f }) {
      // Rascunho ainda não tem data de emissão: entra pelo dia em que nasceu.
      const linhas = await sql(`
        select n.numero, n.serie, (coalesce(n.data_emissao, n.criado_em) at time zone '${FUSO}')::date as emissao,
               ${NOME_DO_ESTABELECIMENTO} as estabelecimento,
               coalesce(n.destinatario_nome, '') as destinatario, coalesce(n.destinatario_documento, '') as documento,
               coalesce(n.natureza_operacao, '') as natureza, n.valor_total as valor, n.status
          from nfe n
          left join estabelecimento es on es.id = n.estabelecimento_id
         where ${noPeriodo(`(coalesce(n.data_emissao, n.criado_em) at time zone '${FUSO}')::date`, 1, 2)}
         order by 3, n.serie, n.numero`, [f.de, f.ate]);
      return linhas.map((l) => ({
        numero: textoDe(l.numero), serie: textoDe(l.serie), emissao: l.emissao, estabelecimento: l.estabelecimento,
        destinatario: l.destinatario, documento: l.documento, natureza: l.natureza, valor: n(l.valor),
        valorAutorizado: l.status === 'AUTORIZADO' ? n(l.valor) : null,
        situacao: SITUACOES_DA_NFE[l.status] || textoDe(l.status)
      }));
    }
  },

  {
    key: 'nfe-itens',
    grupo: 'fiscal',
    titulo: 'Itens das NF-e',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'nota', rotulo: 'Nota', tipo: 'texto' },
      { campo: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { campo: 'item', rotulo: 'Item', tipo: 'inteiro', semTotal: true },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { campo: 'ncm', rotulo: 'NCM', tipo: 'texto' },
      { campo: 'cfop', rotulo: 'CFOP', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }
    ],
    totais: ['quantidade', 'valor'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select d.numero, d.serie, d.data_emissao as emissao, i.numero as item, coalesce(i.descricao, '') as descricao,
               coalesce(btrim(i.ncm), '') as ncm, coalesce(btrim(i.cfop), '') as cfop,
               i.quantidade, i.valor_total as valor
          from fiscal_documentos d
          join fiscal_documento_itens i on i.documento_id = d.id
         where ${SAIDA_PROPRIA_VALIDA} and ${noPeriodo('d.data_emissao', 1, 2)}
         order by d.data_emissao, d.serie, ${ORDEM_DO_NUMERO('d')}, i.numero`, [f.de, f.ate]);
      return linhas.map((l) => ({
        nota: nota(l.numero, l.serie), emissao: l.emissao, item: l.item, descricao: l.descricao,
        ncm: l.ncm, cfop: l.cfop, quantidade: n(l.quantidade), valor: n(l.valor)
      }));
    }
  },

  {
    key: 'faturamento-fiscal',
    grupo: 'fiscal',
    titulo: 'Faturamento Fiscal',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'estabelecimento', rotulo: 'Estabelecimento', tipo: 'texto' },
      { campo: 'notas', rotulo: 'Notas', tipo: 'inteiro' },
      { campo: 'valorTotal', rotulo: 'Valor total', tipo: 'moeda' },
      { campo: 'baseIcms', rotulo: 'Base ICMS', tipo: 'moeda' },
      { campo: 'icms', rotulo: 'ICMS', tipo: 'moeda' },
      { campo: 'icmsSt', rotulo: 'ICMS-ST', tipo: 'moeda' },
      { campo: 'ipi', rotulo: 'IPI', tipo: 'moeda' },
      { campo: 'pis', rotulo: 'PIS', tipo: 'moeda' },
      { campo: 'cofins', rotulo: 'COFINS', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select ${NOME_DO_ESTABELECIMENTO} as estabelecimento, count(*)::int as notas,
               sum(d.valor_total) as valor_total, sum(d.valor_bc_icms) as base_icms, sum(d.valor_icms) as icms,
               sum(d.valor_icms_st) as icms_st, sum(d.valor_ipi) as ipi, sum(d.valor_pis) as pis,
               sum(d.valor_cofins) as cofins
          from fiscal_documentos d
          left join estabelecimento es on es.id = d.estabelecimento_id
         where ${SAIDA_PROPRIA_VALIDA} and ${noPeriodo('d.data_emissao', 1, 2)}
         group by d.estabelecimento_id, 1
         order by 1`, [f.de, f.ate]);
      return linhas.map((l) => ({
        estabelecimento: l.estabelecimento, notas: l.notas, valorTotal: n(l.valor_total), baseIcms: n(l.base_icms),
        icms: n(l.icms), icmsSt: n(l.icms_st), ipi: n(l.ipi), pis: n(l.pis), cofins: n(l.cofins)
      }));
    }
  },

  {
    key: 'resumo-por-cfop',
    grupo: 'fiscal',
    titulo: 'Resumo por CFOP',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'cfop', rotulo: 'CFOP', tipo: 'texto' },
      { campo: 'itens', rotulo: 'Itens', tipo: 'inteiro' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'baseIcms', rotulo: 'Base ICMS', tipo: 'moeda' },
      { campo: 'icms', rotulo: 'ICMS', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      // Um tributo por item no máximo (índice único item_id + tributo), então
      // o join não duplica o item. ICMS é só o próprio: ST e DIFAL são outras
      // linhas de tributo.
      const linhas = await sql(`
        select coalesce(btrim(i.cfop), '') as cfop, count(*)::int as itens, sum(i.valor_total) as valor,
               sum(coalesce(t.base_calculo, 0)) as base_icms, sum(coalesce(t.valor, 0)) as icms
          from fiscal_documentos d
          join fiscal_documento_itens i on i.documento_id = d.id
          left join fiscal_item_tributos t on t.item_id = i.id and t.tributo = 'ICMS'
         where ${SAIDA_PROPRIA_VALIDA} and ${noPeriodo('d.data_emissao', 1, 2)}
         group by 1
         order by 1`, [f.de, f.ate]);
      return linhas.map((l) => ({ cfop: l.cfop, itens: l.itens, valor: n(l.valor), baseIcms: n(l.base_icms), icms: n(l.icms) }));
    }
  },

  {
    key: 'eventos-de-nfe',
    grupo: 'fiscal',
    titulo: 'Eventos de NF-e',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'nota', rotulo: 'Nota', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: [],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select (ev.criado_em at time zone '${FUSO}')::date as data, ev.tipo,
               n.numero, n.serie, n.referencia, ev.payload_enviado, coalesce(ev.status, '') as status
          from nfe_eventos ev
          left join nfe n on n.id = ev.nfe_id
         where ${noPeriodo(`(ev.criado_em at time zone '${FUSO}')::date`, 1, 2)}
         order by ev.criado_em`, [f.de, f.ate]);
      return linhas.map((l) => {
        // A inutilização não tem nota: queima uma faixa de números, que só
        // existe no que foi enviado à Focus.
        let numero = '';
        if (l.numero !== null && l.numero !== undefined) numero = nota(l.numero, l.serie);
        else if (l.referencia) numero = l.referencia;
        else if (l.payload_enviado) {
          const p = l.payload_enviado;
          const inicial = textoDe(p.numero_inicial ?? p.numeroInicial);
          const final = textoDe(p.numero_final ?? p.numeroFinal);
          const faixa = inicial === final ? inicial : `${inicial} a ${final}`;
          numero = nota(faixa, p.serie);
        }
        return { data: l.data, tipo: TIPOS_DE_EVENTO[l.tipo] || textoDe(l.tipo), nota: numero, situacao: l.status };
      });
    }
  }
];
