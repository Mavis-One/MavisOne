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

const salesStatus = require('../../public/modules/shared/sales_status');
const { STATUS_VENDIDO, filialSql, nomeDaFilialSql, chaveDaFilial, pedidoImportadoSql } = require('./comum');

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
    titulo: 'NF-e e NFC-e Emitidas',
    filtros: ['periodo', 'estabelecimento'],
    periodoPadrao: 'mes',
    // O Viper tinha "NF-e Emitidas" e "NFC-e Emitidas" no menu, as duas para a
    // mesma tela; aqui é uma só, e o modelo é escolha.
    escolhas: [
      { campo: 'modelo', rotulo: 'Modelo', itens: [['todos', 'NF-e e NFC-e'], ['55', 'NF-e (55)'], ['65', 'NFC-e (65)']] },
      { campo: 'situacao', rotulo: 'Situação', itens: [['todas', 'Todas'], ['AUTORIZADO', 'Autorizadas'], ['CANCELADO', 'Canceladas'], ['ERRO', 'Com erro'], ['DENEGADO', 'Denegadas'], ['RASCUNHO', 'Rascunhos']] }
    ],
    colunas: [
      { campo: 'modelo', rotulo: 'Modelo', tipo: 'texto' },
      { campo: 'numero', rotulo: 'Número', tipo: 'texto' },
      { campo: 'serie', rotulo: 'Série', tipo: 'texto' },
      { campo: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { campo: 'estabelecimento', rotulo: 'Estabelecimento', tipo: 'texto' },
      { campo: 'destinatario', rotulo: 'Destinatário', tipo: 'texto' },
      { campo: 'documento', rotulo: 'CPF/CNPJ', tipo: 'texto' },
      { campo: 'natureza', rotulo: 'Natureza', tipo: 'texto' },
      { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
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
        select n.modelo, n.numero, n.serie, (coalesce(n.data_emissao, n.criado_em) at time zone '${FUSO}')::date as emissao,
               ${NOME_DO_ESTABELECIMENTO} as estabelecimento,
               coalesce(n.destinatario_nome, '') as destinatario, coalesce(n.destinatario_documento, '') as documento,
               coalesce(n.natureza_operacao, '') as natureza, o.code as pedido, n.valor_total as valor, n.status
          from nfe n
          left join estabelecimento es on es.id = n.estabelecimento_id
          left join orders o on o.id = n.order_id
         where ${noPeriodo(`(coalesce(n.data_emissao, n.criado_em) at time zone '${FUSO}')::date`, 1, 2)}
           and ($3 = '' or n.estabelecimento_id::text = $3)
           and ($4 = 'todos' or coalesce(n.modelo, 55)::text = $4)
           and ($5 = 'todas' or n.status = $5)
         order by 4, n.modelo, n.serie, n.numero`, [f.de, f.ate, f.estabelecimentoId, f.modelo, f.situacao]);
      return linhas.map((l) => ({
        modelo: Number(l.modelo) === 65 ? 'NFC-e' : 'NF-e',
        numero: textoDe(l.numero), serie: textoDe(l.serie), emissao: l.emissao, estabelecimento: l.estabelecimento,
        destinatario: l.destinatario, documento: l.documento, natureza: l.natureza, pedido: l.pedido, valor: n(l.valor),
        valorAutorizado: l.status === 'AUTORIZADO' ? n(l.valor) : null,
        situacao: SITUACOES_DA_NFE[l.status] || textoDe(l.status)
      }));
    }
  },

  {
    key: 'nfe-itens',
    grupo: 'fiscal',
    titulo: 'Itens das NF-e',
    filtros: ['periodo', 'estabelecimento'],
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
           and ($3 = '' or d.estabelecimento_id::text = $3)
         order by d.data_emissao, d.serie, ${ORDEM_DO_NUMERO('d')}, i.numero`, [f.de, f.ate, f.estabelecimentoId]);
      return linhas.map((l) => ({
        nota: nota(l.numero, l.serie), emissao: l.emissao, item: l.item, descricao: l.descricao,
        ncm: l.ncm, cfop: l.cfop, quantidade: n(l.quantidade), valor: n(l.valor)
      }));
    }
  },

  {
    key: 'nfe-analitica',
    grupo: 'fiscal',
    titulo: 'NF-e Analítica',
    filtros: ['periodo', 'estabelecimento'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'nota', rotulo: 'Nota', tipo: 'texto' },
      { campo: 'modelo', rotulo: 'Modelo', tipo: 'texto' },
      { campo: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { campo: 'destinatario', rotulo: 'Destinatário', tipo: 'texto' },
      { campo: 'uf', rotulo: 'UF', tipo: 'texto' },
      { campo: 'item', rotulo: 'Item', tipo: 'inteiro', semTotal: true },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { campo: 'ncm', rotulo: 'NCM', tipo: 'texto' },
      { campo: 'cfop', rotulo: 'CFOP', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'desconto', rotulo: 'Desconto', tipo: 'moeda' },
      { campo: 'frete', rotulo: 'Frete', tipo: 'moeda' },
      { campo: 'cstIcms', rotulo: 'CST/CSOSN', tipo: 'texto' },
      { campo: 'baseIcms', rotulo: 'Base ICMS', tipo: 'moeda' },
      { campo: 'icms', rotulo: 'ICMS', tipo: 'moeda' },
      { campo: 'baseIcmsSt', rotulo: 'Base ICMS-ST', tipo: 'moeda' },
      { campo: 'icmsSt', rotulo: 'ICMS-ST', tipo: 'moeda' },
      { campo: 'fcp', rotulo: 'FCP', tipo: 'moeda' },
      { campo: 'fcpSt', rotulo: 'FCP-ST', tipo: 'moeda' },
      { campo: 'difal', rotulo: 'DIFAL', tipo: 'moeda' },
      { campo: 'ipi', rotulo: 'IPI', tipo: 'moeda' },
      { campo: 'pis', rotulo: 'PIS', tipo: 'moeda' },
      { campo: 'cofins', rotulo: 'COFINS', tipo: 'moeda' },
      { campo: 'ibs', rotulo: 'IBS', tipo: 'moeda' },
      { campo: 'cbs', rotulo: 'CBS', tipo: 'moeda' }
    ],
    totais: 'numericas',
    // Item a item, com o imposto de cada um: o que o SPED lê (escrituração,
    // fiscal_item_tributos), e não o que a tela calculou. Um tributo por item
    // no máximo (índice único item_id + tributo), então a soma por tributo é
    // o próprio valor.
    async executar({ sql, f }) {
      const TRIBUTO = (nome, campo) => `sum(case when t.tributo = '${nome}' then t.${campo} else 0 end)`;
      const linhas = await sql(`
        select d.numero, d.serie, d.modelo, d.data_emissao as emissao, coalesce(pa.nome, '') as destinatario,
               coalesce(pa.uf, '') as uf, i.numero as item, coalesce(i.descricao, '') as descricao,
               coalesce(btrim(i.ncm), '') as ncm, coalesce(btrim(i.cfop), '') as cfop,
               i.quantidade, i.valor_total as valor, coalesce(i.valor_desconto, 0) as desconto, coalesce(i.valor_frete, 0) as frete,
               coalesce(max(case when t.tributo = 'ICMS' then t.cst end), '') as cst_icms,
               ${TRIBUTO('ICMS', 'base_calculo')} as base_icms, ${TRIBUTO('ICMS', 'valor')} as icms,
               ${TRIBUTO('ICMS_ST', 'base_calculo')} as base_icms_st, ${TRIBUTO('ICMS_ST', 'valor')} as icms_st,
               ${TRIBUTO('FCP', 'valor')} as fcp, ${TRIBUTO('FCP_ST', 'valor')} as fcp_st, ${TRIBUTO('ICMS_DIFAL', 'valor')} as difal,
               ${TRIBUTO('IPI', 'valor')} as ipi, ${TRIBUTO('PIS', 'valor')} as pis, ${TRIBUTO('COFINS', 'valor')} as cofins,
               ${TRIBUTO('IBS', 'valor')} as ibs, ${TRIBUTO('CBS', 'valor')} as cbs
          from fiscal_documentos d
          join fiscal_documento_itens i on i.documento_id = d.id
          left join fiscal_item_tributos t on t.item_id = i.id
          left join fiscal_participantes pa on pa.id = d.participante_id
         where ${SAIDA_PROPRIA_VALIDA} and ${noPeriodo('d.data_emissao', 1, 2)}
           and ($3 = '' or d.estabelecimento_id::text = $3)
         group by d.id, i.id, pa.nome, pa.uf
         order by d.data_emissao, d.serie, ${ORDEM_DO_NUMERO('d')}, i.numero`, [f.de, f.ate, f.estabelecimentoId]);
      return linhas.map((l) => ({
        nota: nota(l.numero, l.serie), modelo: String(l.modelo) === '65' ? 'NFC-e' : 'NF-e', emissao: l.emissao,
        destinatario: l.destinatario, uf: l.uf, item: l.item, descricao: l.descricao, ncm: l.ncm, cfop: l.cfop,
        quantidade: n(l.quantidade), valor: n(l.valor), desconto: n(l.desconto), frete: n(l.frete), cstIcms: l.cst_icms,
        baseIcms: n(l.base_icms), icms: n(l.icms), baseIcmsSt: n(l.base_icms_st), icmsSt: n(l.icms_st), fcp: n(l.fcp), fcpSt: n(l.fcp_st),
        difal: n(l.difal), ipi: n(l.ipi), pis: n(l.pis), cofins: n(l.cofins), ibs: n(l.ibs), cbs: n(l.cbs)
      }));
    }
  },

  {
    key: 'faturamento-fiscal',
    grupo: 'fiscal',
    titulo: 'Faturamento Fiscal',
    filtros: ['periodo', 'estabelecimento'],
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
           and ($3 = '' or d.estabelecimento_id::text = $3)
         group by d.estabelecimento_id, 1
         order by 1`, [f.de, f.ate, f.estabelecimentoId]);
      return linhas.map((l) => ({
        estabelecimento: l.estabelecimento, notas: l.notas, valorTotal: n(l.valor_total), baseIcms: n(l.base_icms),
        icms: n(l.icms), icmsSt: n(l.icms_st), ipi: n(l.ipi), pis: n(l.pis), cofins: n(l.cofins)
      }));
    }
  },

  {
    key: 'pedidos-x-nfe',
    grupo: 'fiscal',
    titulo: 'Pedidos x NF-e',
    filtros: ['periodo', 'filial'],
    periodoPadrao: 'mes',
    escolhas: [{ campo: 'mostrar', rotulo: 'Mostrar', itens: [['todos', 'Todos os pedidos vendidos'], ['sem-nota', 'Sem nota autorizada'], ['com-diferenca', 'Nota com valor diferente']] }],
    colunas: [
      { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'filial', rotulo: 'Filial', tipo: 'texto' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'situacaoPedido', rotulo: 'Situação do pedido', tipo: 'texto' },
      { campo: 'nota', rotulo: 'Nota', tipo: 'texto' },
      { campo: 'situacaoNota', rotulo: 'Situação da nota', tipo: 'texto' },
      { campo: 'valorPedido', rotulo: 'Valor do pedido', tipo: 'moeda' },
      { campo: 'valorNota', rotulo: 'Valor da nota', tipo: 'moeda' },
      { campo: 'diferenca', rotulo: 'Diferença', tipo: 'moeda' }
    ],
    totais: ['valorPedido', 'valorNota', 'diferenca'],
    // O Faturamento Fiscal do Viper: cada pedido vendido ao lado da nota que
    // o acompanha. Entra também a transferência e a remessa, que não são
    // venda mas saem com nota. A nota do pedido é a autorizada mais recente
    // (o pedido pode ter uma cancelada e outra reemitida); a diferença só
    // existe com nota autorizada. Pedido dispensado de documento fiscal não é
    // "sem nota": a dispensa foi decidida e registrada. Nem o pedido importado
    // do Viper, cuja nota (se houve) foi emitida lá.
    async executar({ sql, f }) {
      const linhas = await sql(`
        with notas as (
          select distinct on (x.pedido_id) x.pedido_id, x.modelo, x.numero, x.serie, x.status, x.valor_total
            from (
              select n.order_id as pedido_id, n.* from nfe n where coalesce(n.order_id, '') <> ''
              union all
              select o.id, n.* from orders o join nfe n on n.id::text = o.nfe_id where coalesce(o.nfe_id, '') <> ''
            ) x
           order by x.pedido_id, (x.status = 'AUTORIZADO') desc, x.criado_em desc)
        select o.code as pedido, o.date as data, ${nomeDaFilialSql('o')} as filial,
               coalesce(c.name, o.client_supplier_name, o.customer, '') as cliente, o.status,
               coalesce(o.dispensa_documento_fiscal, false) as dispensado, ${pedidoImportadoSql('o')} as importado,
               nt.modelo, nt.numero, nt.serie, nt.status as status_nota, nt.valor_total as valor_nota,
               coalesce(o.total_amount, o.amount, 0) as valor_pedido
          from orders o
          left join notas nt on nt.pedido_id = o.id
          left join people c on c.id = o.client_supplier_id
         where o.status = any($1::text[])
           and ($2 = '' or o.date >= $2::date) and ($3 = '' or o.date <= $3::date)
           and ($4 = '' or ${filialSql('o')} = $4)
         order by o.date, o.code`, [STATUS_VENDIDO, f.de, f.ate, chaveDaFilial(f.filial)]);
      return linhas
        .map((l) => {
          const autorizada = l.status_nota === 'AUTORIZADO';
          let situacaoNota = l.status_nota ? (SITUACOES_DA_NFE[l.status_nota] || textoDe(l.status_nota)) : 'Sem nota';
          if (!autorizada && l.dispensado) situacaoNota = 'Dispensado';
          else if (!l.status_nota && l.importado) situacaoNota = 'Pedido do Viper';
          const valorNota = autorizada ? n(l.valor_nota) : null;
          return {
            pedido: l.pedido, data: l.data, filial: l.filial, cliente: l.cliente, situacaoPedido: salesStatus.rotulo(l.status),
            nota: l.numero !== null && l.numero !== undefined ? `${Number(l.modelo) === 65 ? 'NFC-e' : 'NF-e'} ${nota(l.numero, l.serie)}` : '',
            situacaoNota, valorPedido: n(l.valor_pedido), valorNota,
            diferenca: autorizada ? Math.round((n(l.valor_nota) - n(l.valor_pedido)) * 100) / 100 : null,
            semNota: !autorizada && !l.dispensado && !(l.importado && !l.status_nota)
          };
        })
        .filter((l) => {
          if (f.mostrar === 'sem-nota') return l.semNota;
          if (f.mostrar === 'com-diferenca') return l.diferenca !== null && Math.abs(l.diferenca) > 0.01;
          return true;
        })
        .map(({ semNota, ...linha }) => linha);
    }
  },

  {
    key: 'resumo-por-cfop',
    grupo: 'fiscal',
    titulo: 'Resumo por CFOP',
    filtros: ['periodo', 'estabelecimento'],
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
           and ($3 = '' or d.estabelecimento_id::text = $3)
         group by 1
         order by 1`, [f.de, f.ate, f.estabelecimentoId]);
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
