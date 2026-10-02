/**
 * RELATÓRIOS DE COMPRAS.
 *
 * O que entrou de verdade é a NOTA DE ENTRADA (nfe_entrada, o XML do
 * fornecedor), pela data de emissão. A ordem de compra é o compromisso, e só
 * entra no relatório dela: somá-la às notas contaria duas vezes a mercadoria
 * que veio com nota.
 *
 * Cotação e ordem são o mesmo registro em purchase_orders; quem separa é o
 * `type` ('quote' ou 'order'), que o servidor grava a partir do status (ver
 * public/modules/shared/purchase_status.js).
 */

const purchaseStatus = require('../../public/modules/shared/purchase_status');

const SITUACOES_DA_ENTRADA = { LANCADA: 'Lançada', REVISAR: 'A revisar' };

/** Período em que cada ponta pode vir vazia ('' = sem limite daquele lado). */
const noPeriodo = (expr, de, ate) => `($${de} = '' or ${expr} >= $${de}::date) and ($${ate} = '' or ${expr} <= $${ate}::date)`;

/** Número de nota é texto: "10" viria antes de "9" na ordem alfabética. */
const ORDEM_DO_NUMERO = (alias) => `case when ${alias}.numero ~ '^[0-9]{1,18}$' then ${alias}.numero::bigint end, ${alias}.numero`;

const n = (v) => Number(v || 0);
const simNao = (v) => (v ? 'Sim' : 'Não');
const nota = (numero, serie) => (serie ? `${numero}/${serie}` : String(numero || ''));

module.exports = [
  {
    key: 'notas-de-entrada',
    grupo: 'compras',
    titulo: 'Notas de Entrada',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'numero', rotulo: 'Número', tipo: 'texto' },
      { campo: 'serie', rotulo: 'Série', tipo: 'texto' },
      { campo: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
      { campo: 'cnpj', rotulo: 'CNPJ', tipo: 'texto' },
      { campo: 'natureza', rotulo: 'Natureza', tipo: 'texto' },
      { campo: 'valorProdutos', rotulo: 'Valor dos produtos', tipo: 'moeda' },
      { campo: 'valorTotal', rotulo: 'Valor total', tipo: 'moeda' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'estoque', rotulo: 'Estoque', tipo: 'texto' },
      { campo: 'financeiro', rotulo: 'Financeiro', tipo: 'texto' }
    ],
    totais: ['valorProdutos', 'valorTotal'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(e.numero, '') as numero, coalesce(e.serie, '') as serie, e.data_emissao as emissao,
               e.emitente_nome as fornecedor, e.emitente_documento as cnpj,
               coalesce(e.natureza_operacao, '') as natureza,
               e.valor_produtos, e.valor_total, e.status, e.movimentou_estoque, e.gerou_financeiro
          from nfe_entrada e
         where ${noPeriodo('e.data_emissao', 1, 2)}
         order by e.data_emissao, ${ORDEM_DO_NUMERO('e')}`, [f.de, f.ate]);
      return linhas.map((l) => ({
        numero: l.numero, serie: l.serie, emissao: l.emissao, fornecedor: l.fornecedor, cnpj: l.cnpj,
        natureza: l.natureza, valorProdutos: n(l.valor_produtos), valorTotal: n(l.valor_total),
        situacao: SITUACOES_DA_ENTRADA[l.status] || l.status || '',
        estoque: simNao(l.movimentou_estoque), financeiro: simNao(l.gerou_financeiro)
      }));
    }
  },

  {
    key: 'itens-das-notas-de-entrada',
    grupo: 'compras',
    titulo: 'Itens das Notas de Entrada',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'nota', rotulo: 'Nota', tipo: 'texto' },
      { campo: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
      { campo: 'item', rotulo: 'Item', tipo: 'inteiro', semTotal: true },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto vinculado', tipo: 'texto' },
      { campo: 'ncm', rotulo: 'NCM', tipo: 'texto' },
      { campo: 'cfop', rotulo: 'CFOP', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'valorUnitario', rotulo: 'Valor unitário', tipo: 'moeda', semTotal: true },
      { campo: 'total', rotulo: 'Total', tipo: 'moeda' }
    ],
    totais: ['quantidade', 'total'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(e.numero, '') as numero, coalesce(e.serie, '') as serie, e.data_emissao as emissao,
               e.emitente_nome as fornecedor, it.numero as item, it.descricao,
               p.sku, p.name as produto, coalesce(it.ncm, '') as ncm, coalesce(it.cfop, '') as cfop,
               it.quantidade, it.valor_unitario, it.valor_total
          from nfe_entrada_item it
          join nfe_entrada e on e.id = it.entrada_id
          left join products p on p.id = it.product_id
         where ${noPeriodo('e.data_emissao', 1, 2)}
         order by e.data_emissao, ${ORDEM_DO_NUMERO('e')}, it.numero`, [f.de, f.ate]);
      return linhas.map((l) => ({
        nota: nota(l.numero, l.serie), emissao: l.emissao, fornecedor: l.fornecedor, item: l.item,
        descricao: l.descricao,
        produto: l.produto ? [l.sku, l.produto].filter(Boolean).join(' · ') : '',
        ncm: l.ncm, cfop: l.cfop, quantidade: n(l.quantidade), valorUnitario: n(l.valor_unitario), total: n(l.valor_total)
      }));
    }
  },

  {
    key: 'ordens-de-compra',
    grupo: 'compras',
    titulo: 'Ordens de Compra',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'codigo' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
      { campo: 'previsaoEntrega', rotulo: 'Previsão de entrega', tipo: 'data' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'total', rotulo: 'Total', tipo: 'moeda' }
    ],
    totais: ['total'],
    async executar({ sql, f }) {
      // Só o que é ORDEM: a cotação ('quote') ainda é pergunta de preço.
      const linhas = await sql(`
        select po.code as codigo, po.date as data,
               coalesce(nullif(po.supplier_name, ''), pe.name, '') as fornecedor,
               po.delivery_date as previsao_entrega, po.status, po.total_amount as total
          from purchase_orders po
          left join people pe on pe.id = po.supplier_id
         where po.type = 'order' and ${noPeriodo('po.date', 1, 2)}
         order by po.date, po.code`, [f.de, f.ate]);
      return linhas.map((l) => ({
        codigo: l.codigo, data: l.data, fornecedor: l.fornecedor, previsaoEntrega: l.previsao_entrega || null,
        situacao: purchaseStatus.rotulo(l.status), total: n(l.total)
      }));
    }
  },

  {
    key: 'compras-por-fornecedor',
    grupo: 'compras',
    titulo: 'Compras por Fornecedor',
    filtros: ['periodo'],
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
      { campo: 'cnpj', rotulo: 'CNPJ', tipo: 'texto' },
      { campo: 'notas', rotulo: 'Notas', tipo: 'inteiro' },
      { campo: 'valorTotal', rotulo: 'Valor total', tipo: 'moeda' },
      { campo: 'primeiraNota', rotulo: 'Primeira nota', tipo: 'data' },
      { campo: 'ultimaNota', rotulo: 'Última nota', tipo: 'data' },
      { campo: 'intervaloMedio', rotulo: 'Intervalo médio (dias)', tipo: 'inteiro', semTotal: true },
      { campo: 'diasSemComprar', rotulo: 'Dias desde a última', tipo: 'inteiro', semTotal: true }
    ],
    totais: ['notas', 'valorTotal'],
    // Agrupa pelo CNPJ, que não muda; o nome é o da nota mais recente. O
    // intervalo médio e os dias desde a última são a "Periodicidade" do Viper,
    // do lado do fornecedor (a do cliente está em Relacionamento de Clientes).
    async executar({ sql, f }) {
      const linhas = await sql(`
        select (array_agg(e.emitente_nome order by e.data_emissao desc nulls last, e.criado_em desc))[1] as fornecedor,
               e.emitente_documento as cnpj, count(*)::int as notas,
               sum(e.valor_total) as valor_total, min(e.data_emissao) as primeira_nota, max(e.data_emissao) as ultima_nota,
               ($3::date - max(e.data_emissao))::int as dias_sem
          from nfe_entrada e
         where ${noPeriodo('e.data_emissao', 1, 2)}
         group by e.emitente_documento
         order by valor_total desc`, [f.de, f.ate, f.hoje]);
      return linhas.map((l) => {
        const dias = l.primeira_nota && l.ultima_nota ? (Date.parse(l.ultima_nota) - Date.parse(l.primeira_nota)) / 86400000 : 0;
        return {
          fornecedor: l.fornecedor, cnpj: l.cnpj, notas: l.notas, valorTotal: n(l.valor_total),
          primeiraNota: l.primeira_nota || null, ultimaNota: l.ultima_nota || null,
          intervaloMedio: l.notas > 1 ? Math.round(dias / (l.notas - 1)) : null,
          diasSemComprar: l.dias_sem
        };
      });
    }
  },

  {
    key: 'consistencia-das-compras',
    grupo: 'compras',
    titulo: 'Consistência nos Valores da Compra',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    escolhas: [{ campo: 'mostrar', rotulo: 'Mostrar', itens: [['divergentes', 'Só as que não fecham'], ['sem-financeiro', 'Notas sem financeiro'], ['todas', 'Todas']] }],
    colunas: [
      { campo: 'nota', rotulo: 'Nota', tipo: 'texto' },
      { campo: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
      { campo: 'valorTotal', rotulo: 'Valor da nota', tipo: 'moeda' },
      { campo: 'financeiro', rotulo: 'Gerou financeiro', tipo: 'texto' },
      { campo: 'lancado', rotulo: 'Lançado a pagar', tipo: 'moeda' },
      { campo: 'lancamentos', rotulo: 'Lançamentos', tipo: 'inteiro', semTotal: true },
      { campo: 'diferenca', rotulo: 'Diferença', tipo: 'moeda' }
    ],
    totais: ['valorTotal', 'lancado', 'diferenca'],
    // A nota de entrada contra as contas a pagar que ela gerou
    // (financial_entries.reference_id = nfe_entrada.id, gravado na entrada).
    // Nota que gerou financeiro deve ter lançado o valor dela; a que não gerou,
    // nada. "Sem financeiro" lista a nota que ninguém lançou — a compra que
    // pode estar faltando no contas a pagar.
    async executar({ sql, f }) {
      const linhas = await sql(`
        with financeiro as (
          select reference_id, sum(amount) as lancado, count(*)::int as lancamentos
            from financial_entries
           where type = 'DESPESA' and coalesce(status, '') not in ('cancelado', 'cancelled', 'canceled')
           group by reference_id)
        select coalesce(e.numero, '') as numero, coalesce(e.serie, '') as serie, e.data_emissao as emissao,
               e.emitente_nome as fornecedor, e.valor_total, e.gerou_financeiro,
               coalesce(fi.lancado, 0) as lancado, coalesce(fi.lancamentos, 0) as lancamentos
          from nfe_entrada e
          left join financeiro fi on fi.reference_id = e.id
         where ${noPeriodo('e.data_emissao', 1, 2)}
         order by e.data_emissao, ${ORDEM_DO_NUMERO('e')}`, [f.de, f.ate]);
      return linhas
        .map((l) => {
          const esperado = l.gerou_financeiro ? n(l.valor_total) : 0;
          return {
            nota: nota(l.numero, l.serie), emissao: l.emissao, fornecedor: l.fornecedor, valorTotal: n(l.valor_total),
            financeiro: simNao(l.gerou_financeiro), lancado: n(l.lancado), lancamentos: l.lancamentos,
            diferenca: Math.round((n(l.lancado) - esperado) * 100) / 100
          };
        })
        .filter((l) => {
          if (f.mostrar === 'divergentes') return Math.abs(l.diferenca) > 0.01;
          if (f.mostrar === 'sem-financeiro') return l.lancamentos === 0;
          return true;
        });
    }
  },

  {
    key: 'produtos-por-fornecedor',
    grupo: 'compras',
    titulo: 'Produtos por Fornecedor',
    filtros: ['periodo'],
    colunas: [
      { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade comprada', tipo: 'quantidade' },
      { campo: 'ultimoPreco', rotulo: 'Último preço', tipo: 'moeda', semTotal: true },
      { campo: 'ultimaCompra', rotulo: 'Última compra', tipo: 'data' }
    ],
    totais: ['quantidade'],
    async executar({ sql, f }) {
      // Só item vinculado a produto: sem vínculo não há produto a agrupar.
      const linhas = await sql(`
        select (array_agg(e.emitente_nome order by e.data_emissao desc nulls last, e.criado_em desc))[1] as fornecedor,
               coalesce(p.sku, '') as sku, coalesce(p.name, '') as produto,
               sum(it.quantidade) as quantidade,
               (array_agg(it.valor_unitario order by e.data_emissao desc nulls last, e.criado_em desc, it.numero desc))[1] as ultimo_preco,
               max(e.data_emissao) as ultima_compra
          from nfe_entrada_item it
          join nfe_entrada e on e.id = it.entrada_id
          join products p on p.id = it.product_id
         where ${noPeriodo('e.data_emissao', 1, 2)}
         group by e.emitente_documento, p.id
         order by 1, 3`, [f.de, f.ate]);
      return linhas.map((l) => ({
        fornecedor: l.fornecedor, sku: l.sku, produto: l.produto, quantidade: n(l.quantidade),
        ultimoPreco: n(l.ultimo_preco), ultimaCompra: l.ultima_compra || null
      }));
    }
  }
];
