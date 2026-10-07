/**
 * RELATÓRIOS DE VENDAS.
 *
 * "Venda" aqui é sempre o pedido VENDIDO e que não é movimentação interna
 * (lib/relatorios/comum.js), recortado pelo escopo de quem pede: o vendedor
 * comum só vê as próprias vendas (lib/relatorios-escopo.js), e o filtro de
 * vendedor da tela não passa disso.
 *
 * Custo é o do cadastro HOJE (products.cost_price). O item do pedido não
 * guarda o custo da época, então rentabilidade de venda antiga usa o custo
 * atual — por isso a coluna se chama "Custo atual".
 */

const salesStatus = require('../../public/modules/shared/sales_status');
const { STATUS_VENDIDO, filialSql, nomeDaFilialSql, ehVendaSql, parametrosDeVenda, SALDO_DO_RAZAO, nomeDoDepositoSql } = require('./comum');

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const ITENS = `cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as it`;
const QTD = `coalesce(nullif(it->>'quantity', '')::numeric, 0)`;
const TOTAL_ITEM = `coalesce(nullif(it->>'total', '')::numeric, 0)`;

/**
 * O WHERE comum das vendas, a partir do parâmetro `primeiro`:
 * status vendidos, sem movimentação interna, escopo de vendedor, filial e
 * período (de/ate vazios = sem limite).
 */
function filtroDeVendas(ctx, primeiro = 1, { comPeriodo = true, status = STATUS_VENDIDO } = {}) {
  const p = parametrosDeVenda(ctx);
  const i = primeiro;
  const partes = [
    `o.status = any($${i}::text[])`,
    ehVendaSql('o'),
    `($${i + 1}::text[] is null or o.seller_id = any($${i + 1}::text[]))`,
    `($${i + 2} = '' or ${filialSql('o')} = $${i + 2})`
  ];
  const parametros = [status, p.vendedores, p.filial];
  if (comPeriodo) {
    partes.push(`($${i + 3} = '' or o.date >= $${i + 3}::date)`, `($${i + 4} = '' or o.date <= $${i + 4}::date)`);
    parametros.push(ctx.f.de, ctx.f.ate);
  }
  return { where: partes.join(' and '), parametros };
}

/** Curva ABC: classe A até 80% do acumulado, B até 95%, o resto C. */
function comCurvaAbc(linhas, campoValor) {
  const total = linhas.reduce((s, l) => s + n(l[campoValor]), 0);
  let acumulado = 0;
  return linhas.map((l, indice) => {
    const percentual = total ? (n(l[campoValor]) / total) * 100 : 0;
    const antes = acumulado;
    acumulado += percentual;
    return {
      posicao: indice + 1,
      ...l,
      percentual: r2(percentual),
      acumulado: r2(acumulado),
      classe: antes < 80 ? 'A' : antes < 95 ? 'B' : 'C'
    };
  });
}

const FILTROS_DE_VENDA = ['periodo', 'vendedor', 'filial'];

module.exports = [
  { key: 'pedidos', grupo: 'vendas', titulo: 'Pedidos', especial: 'vendas' },
  { key: 'vendas-por-vendedor', grupo: 'vendas', titulo: 'Vendas por Vendedor', especial: 'vendedores' },

  {
    key: 'pedidos-faturados',
    grupo: 'vendas',
    titulo: 'Pedidos Faturados',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'filial', rotulo: 'Filial', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'nfe', rotulo: 'NF-e', tipo: 'texto' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'recebido', rotulo: 'Recebido', tipo: 'moeda' },
      { campo: 'aReceber', rotulo: 'A receber', tipo: 'moeda' }
    ],
    totais: ['valor', 'recebido', 'aReceber'],
    // O recebido segue o Financeiro: a soma das baixas dos lançamentos que o
    // pedido gerou, ou o valor inteiro no lançamento marcado pago sem baixa
    // (o legado do Viper). A receber é o que falta desses lançamentos — e não
    // o total do pedido menos o recebido: pedido sem financeiro não deve nada
    // a ninguém, só não foi lançado (ver Consistência nos Valores de Venda).
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        with financeiro as (
          select e.reference_id,
                 sum(case when pg.pago is not null then pg.pago when e.status = 'paid' then e.amount else 0 end) as recebido,
                 sum(case when e.status = 'paid' then 0 else greatest(e.amount - coalesce(pg.pago, 0), 0) end) as a_receber
            from financial_entries e
            left join (select entry_id, sum(amount) as pago from financial_payments group by entry_id) pg on pg.entry_id = e.id
           where e.type = 'RECEITA' and coalesce(e.status, '') not in ('cancelado', 'cancelled', 'canceled')
           group by e.reference_id)
        select o.code as pedido, o.date as data,
               coalesce(c.name, o.client_supplier_name, o.customer, '') as cliente,
               coalesce(v.name, '') as vendedor, ${nomeDaFilialSql('o')} as filial,
               o.status, (o.nfe_id is not null and o.nfe_id <> '') as tem_nfe,
               coalesce(o.total_amount, o.amount, 0) as valor,
               coalesce(fi.recebido, 0) as recebido, coalesce(fi.a_receber, 0) as a_receber
          from orders o
          left join financeiro fi on fi.reference_id = o.id
          left join people c on c.id = o.client_supplier_id
          left join people v on v.id = o.seller_id
         where ${where}
         order by o.date, o.code`, parametros);
      return linhas.map((l) => ({
        pedido: l.pedido, data: l.data, cliente: l.cliente, vendedor: l.vendedor, filial: l.filial,
        situacao: salesStatus.rotulo(l.status), nfe: l.tem_nfe ? 'Sim' : 'Não', valor: n(l.valor),
        recebido: n(l.recebido), aReceber: n(l.a_receber)
      }));
    }
  },

  {
    key: 'itens-dos-pedidos',
    grupo: 'vendas',
    titulo: 'Itens dos Pedidos',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'filial', rotulo: 'Filial', tipo: 'texto' },
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'ncm', rotulo: 'NCM', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'unitario', rotulo: 'Unitário', tipo: 'moeda', semTotal: true },
      { campo: 'total', rotulo: 'Total', tipo: 'moeda' },
      { campo: 'custo', rotulo: 'Custo atual', tipo: 'moeda' },
      { campo: 'margem', rotulo: 'Margem %', tipo: 'percentual' }
    ],
    totais: ['quantidade', 'total', 'custo'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        select o.code as pedido, o.date as data,
               coalesce(c.name, o.client_supplier_name, o.customer, '') as cliente,
               coalesce(v.name, '') as vendedor, ${nomeDaFilialSql('o')} as filial,
               coalesce(pr.sku, it->>'sku', '') as sku, coalesce(pr.name, it->>'name', '') as produto,
               coalesce(btrim(pr.ncm), '') as ncm,
               ${QTD} as quantidade, coalesce(nullif(it->>'unitPrice', '')::numeric, 0) as unitario, ${TOTAL_ITEM} as total,
               ${QTD} * coalesce(pr.cost_price, 0) as custo
          from orders o ${ITENS}
          left join products pr on pr.id = it->>'productId'
          left join people c on c.id = o.client_supplier_id
          left join people v on v.id = o.seller_id
         where ${where}
         order by o.date, o.code`, parametros);
      return linhas.map((l) => ({
        ...l, quantidade: n(l.quantidade), unitario: n(l.unitario), total: n(l.total), custo: r2(l.custo),
        margem: n(l.total) ? r2(((n(l.total) - n(l.custo)) / n(l.total)) * 100) : null
      }));
    }
  },

  {
    key: 'curva-abc-produtos',
    grupo: 'vendas',
    titulo: 'Curva ABC de Produtos',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'ano',
    // O Viper tinha duas telas, uma pelo custo e outra pelo valor de venda;
    // aqui é a mesma curva, e a escolha diz o que ela classifica.
    escolhas: [{ campo: 'base', rotulo: 'Classificar por', itens: [['faturamento', 'Faturamento'], ['custo', 'Custo das vendas'], ['quantidade', 'Quantidade']] }],
    colunas: [
      { campo: 'posicao', rotulo: '#', tipo: 'inteiro', semTotal: true },
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' },
      { campo: 'custo', rotulo: 'Custo atual', tipo: 'moeda' },
      { campo: 'saldo', rotulo: 'Saldo em estoque', tipo: 'quantidade' },
      { campo: 'percentual', rotulo: '%', tipo: 'percentual' },
      { campo: 'acumulado', rotulo: '% acumulado', tipo: 'percentual' },
      { campo: 'classe', rotulo: 'Classe', tipo: 'texto' }
    ],
    totais: ['quantidade', 'faturamento', 'custo'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        select coalesce(pr.sku, max(it->>'sku'), '') as sku, coalesce(pr.name, max(it->>'name'), '') as produto,
               sum(${QTD}) as quantidade, sum(${TOTAL_ITEM}) as faturamento,
               sum(${QTD} * coalesce(pr.cost_price, 0)) as custo, max(pr.stock_quantity) as saldo
          from orders o ${ITENS}
          left join products pr on pr.id = it->>'productId'
         where ${where}
         group by coalesce(it->>'productId', it->>'name'), pr.sku, pr.name`, parametros);
      const base = ctx.f.base;
      const ordenadas = linhas
        .map((l) => ({ sku: l.sku, produto: l.produto, quantidade: n(l.quantidade), faturamento: n(l.faturamento), custo: r2(l.custo), saldo: l.saldo === null ? null : n(l.saldo) }))
        .filter((l) => l[base] > 0)
        .sort((a, b) => b[base] - a[base] || a.produto.localeCompare(b.produto, 'pt-BR'));
      return comCurvaAbc(ordenadas, base);
    }
  },

  {
    key: 'curva-abc-clientes',
    grupo: 'vendas',
    titulo: 'Curva ABC de Clientes',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'posicao', rotulo: '#', tipo: 'inteiro', semTotal: true },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' },
      { campo: 'percentual', rotulo: '%', tipo: 'percentual' },
      { campo: 'acumulado', rotulo: '% acumulado', tipo: 'percentual' },
      { campo: 'classe', rotulo: 'Classe', tipo: 'texto' }
    ],
    totais: ['pedidos', 'faturamento'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        select coalesce(c.name, max(o.client_supplier_name), max(o.customer), 'Sem cliente') as cliente,
               count(*)::int as pedidos, sum(coalesce(o.total_amount, o.amount, 0)) as faturamento
          from orders o
          left join people c on c.id = o.client_supplier_id
         where ${where}
         group by coalesce(o.client_supplier_id, o.client_supplier_name, o.customer), c.name
        having sum(coalesce(o.total_amount, o.amount, 0)) > 0
         order by faturamento desc`, parametros);
      return comCurvaAbc(linhas.map((l) => ({ cliente: l.cliente, pedidos: l.pedidos, faturamento: n(l.faturamento) })), 'faturamento');
    }
  },

  {
    key: 'ranking-de-produtos',
    grupo: 'vendas',
    titulo: 'Ranking de Vendas',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'mes',
    // O Ranking do Viper era de CLIENTES; o daqui nasceu de produtos. Os dois
    // ficam, e a escolha diz qual.
    escolhas: [{ campo: 'por', rotulo: 'Ranking de', itens: [['produtos', 'Produtos'], ['clientes', 'Clientes']] }],
    colunas: [
      { campo: 'posicao', rotulo: '#', tipo: 'inteiro', semTotal: true },
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' }
    ],
    totais: ['quantidade', 'faturamento'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      if (ctx.f.por === 'clientes') {
        const linhas = await ctx.sql(`
          select coalesce(c.name, max(o.client_supplier_name), max(o.customer), 'Sem cliente') as cliente,
                 count(*)::int as pedidos, sum(coalesce(o.total_amount, o.amount, 0)) as faturamento
            from orders o
            left join people c on c.id = o.client_supplier_id
           where ${where}
           group by coalesce(o.client_supplier_id, o.client_supplier_name, o.customer), c.name
           order by faturamento desc, 1`, parametros);
        return {
          colunas: [
            { campo: 'posicao', rotulo: '#', tipo: 'inteiro', semTotal: true },
            { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
            { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
            { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' }
          ],
          linhas: linhas.map((l, i) => ({ posicao: i + 1, cliente: l.cliente, pedidos: l.pedidos, faturamento: n(l.faturamento) }))
        };
      }
      const linhas = await ctx.sql(`
        select coalesce(pr.sku, max(it->>'sku'), '') as sku, coalesce(pr.name, max(it->>'name'), '') as produto,
               sum(${QTD}) as quantidade, count(distinct o.id)::int as pedidos, sum(${TOTAL_ITEM}) as faturamento
          from orders o ${ITENS}
          left join products pr on pr.id = it->>'productId'
         where ${where}
         group by coalesce(it->>'productId', it->>'name'), pr.sku, pr.name
         order by quantidade desc, faturamento desc`, parametros);
      return linhas.map((l, i) => ({ posicao: i + 1, sku: l.sku, produto: l.produto, quantidade: n(l.quantidade), pedidos: l.pedidos, faturamento: n(l.faturamento) }));
    }
  },

  {
    key: 'itens-por-vendedor',
    grupo: 'vendas',
    titulo: 'Itens por Vendedor',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' }
    ],
    totais: ['quantidade', 'faturamento'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        select coalesce(v.name, 'Sem vendedor') as vendedor,
               coalesce(pr.sku, max(it->>'sku'), '') as sku, coalesce(pr.name, max(it->>'name'), '') as produto,
               sum(${QTD}) as quantidade, sum(${TOTAL_ITEM}) as faturamento
          from orders o ${ITENS}
          left join products pr on pr.id = it->>'productId'
          left join people v on v.id = o.seller_id
         where ${where}
         group by 1, coalesce(it->>'productId', it->>'name'), pr.sku, pr.name
         order by 1, faturamento desc`, parametros);
      return linhas.map((l) => ({ vendedor: l.vendedor, sku: l.sku, produto: l.produto, quantidade: n(l.quantidade), faturamento: n(l.faturamento) }));
    }
  },

  {
    key: 'condensado-por-mes',
    grupo: 'vendas',
    titulo: 'Condensado de Vendas por Mês',
    filtros: ['ano', 'vendedor', 'filial'],
    colunas: [
      { campo: 'mes', rotulo: 'Mês', tipo: 'texto' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'clientes', rotulo: 'Clientes', tipo: 'inteiro', semTotal: true },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' },
      { campo: 'ticketMedio', rotulo: 'Ticket médio', tipo: 'moeda', semTotal: true }
    ],
    totais: ['pedidos', 'faturamento'],
    // O ano como faixa de datas, e não `extract(year ...) = $1`: `o.date` é
    // `date`, então é o mesmo conjunto de pedidos, e o planejador passa a usar
    // o histograma da coluna em vez de chutar 0,5% (ver o Fluxo Mensal em
    // financeiro.js). 38 -> 27 ms, as mesmas 12 linhas.
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx, 2, { comPeriodo: false });
      const linhas = await ctx.sql(`
        select m.mes, coalesce(x.pedidos, 0) as pedidos, coalesce(x.clientes, 0) as clientes, coalesce(x.faturamento, 0) as faturamento
          from generate_series(1, 12) as m(mes)
          left join (
            select extract(month from o.date)::int as mes, count(*)::int as pedidos,
                   count(distinct coalesce(o.client_supplier_id, o.client_supplier_name))::int as clientes,
                   sum(coalesce(o.total_amount, o.amount, 0)) as faturamento
              from orders o
             where o.date >= make_date($1::int, 1, 1) and o.date < make_date($1::int + 1, 1, 1) and ${where}
             group by 1) x on x.mes = m.mes
         order by m.mes`, [ctx.f.ano, ...parametros]);
      return linhas.map((l) => ({
        mes: `${MESES[l.mes - 1]}/${ctx.f.ano}`, pedidos: l.pedidos, clientes: l.clientes, faturamento: n(l.faturamento),
        ticketMedio: l.pedidos ? r2(n(l.faturamento) / l.pedidos) : null
      }));
    }
  },

  {
    key: 'condensado-por-filial',
    grupo: 'vendas',
    titulo: 'Condensado de Vendas por Filial',
    filtros: ['periodo', 'vendedor'],
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'filial', rotulo: 'Filial', tipo: 'texto' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' },
      { campo: 'ticketMedio', rotulo: 'Ticket médio', tipo: 'moeda', semTotal: true },
      { campo: 'participacao', rotulo: '% do total', tipo: 'percentual' }
    ],
    totais: ['pedidos', 'faturamento'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas({ ...ctx, f: { ...ctx.f, filial: '' } });
      const linhas = await ctx.sql(`
        select coalesce(nullif(${nomeDaFilialSql('o')}, ''), 'Sem filial') as filial, count(*)::int as pedidos,
               sum(coalesce(o.total_amount, o.amount, 0)) as faturamento
          from orders o
         where ${where}
         group by 1
         order by faturamento desc`, parametros);
      const total = linhas.reduce((s, l) => s + n(l.faturamento), 0);
      return linhas.map((l) => ({
        filial: l.filial, pedidos: l.pedidos, faturamento: n(l.faturamento),
        ticketMedio: l.pedidos ? r2(n(l.faturamento) / l.pedidos) : null,
        participacao: total ? r2((n(l.faturamento) / total) * 100) : null
      }));
    }
  },

  {
    key: 'condensado-por-produto',
    grupo: 'vendas',
    titulo: 'Condensado de Vendas por Produto',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade vendida', tipo: 'quantidade' },
      { campo: 'custoUnitario', rotulo: 'Custo atual', tipo: 'moeda', semTotal: true },
      { campo: 'custo', rotulo: 'Custo das vendas', tipo: 'moeda' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' },
      { campo: 'lucro', rotulo: 'Lucro', tipo: 'moeda' },
      { campo: 'margem', rotulo: 'Margem %', tipo: 'percentual' }
    ],
    totais: 'numericas',
    // O que vendeu e quanto ainda tem: como no Condensado do Viper, uma coluna
    // de saldo por depósito, do razão (comum.js, SALDO_DO_RAZAO). Só entram os
    // depósitos que têm saldo de algum dos produtos listados; a coluna de um
    // depósito vazio seria uma fileira de zeros.
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const vendidos = await ctx.sql(`
        select max(it->>'productId') as product_id,
               coalesce(pr.sku, max(it->>'sku'), '') as sku, coalesce(pr.name, max(it->>'name'), '') as produto,
               sum(${QTD}) as quantidade, sum(${TOTAL_ITEM}) as faturamento,
               coalesce(max(pr.cost_price), 0) as custo_unitario, sum(${QTD} * coalesce(pr.cost_price, 0)) as custo
          from orders o ${ITENS}
          left join products pr on pr.id = it->>'productId'
         where ${where}
         group by coalesce(it->>'productId', it->>'name'), pr.sku, pr.name
         order by sum(${TOTAL_ITEM}) desc, 3`, parametros);
      const ids = vendidos.map((v) => v.product_id).filter(Boolean);
      const saldos = ids.length ? await ctx.sql(`
        select m.product_id, coalesce(m.deposit_id, '') as deposito_id, ${nomeDoDepositoSql('d', 'm.deposit_id')} as deposito,
               sum(${SALDO_DO_RAZAO}) as saldo
          from stock_movements m
          left join deposits d on d.id = m.deposit_id
         where m.product_id = any($1::text[])
         group by 1, 2, 3
        having sum(${SALDO_DO_RAZAO}) <> 0`, [ids]) : [];
      const depositos = new Map();
      const porProduto = new Map();
      for (const s of saldos) {
        depositos.set(s.deposito_id, s.deposito);
        if (!porProduto.has(s.product_id)) porProduto.set(s.product_id, {});
        porProduto.get(s.product_id)[s.deposito_id] = n(s.saldo);
      }
      const colunasDeDeposito = [...depositos.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
        .map(([id, nome], i) => ({ id, coluna: { campo: `dep${i + 1}`, rotulo: nome, tipo: 'quantidade' } }));
      const base = module.exports.find((r) => r.key === 'condensado-por-produto').colunas;
      return {
        colunas: [
          ...base,
          ...colunasDeDeposito.map((c) => c.coluna),
          { campo: 'estoque', rotulo: 'Estoque total', tipo: 'quantidade' },
          { campo: 'valorEmEstoque', rotulo: 'Valor em estoque', tipo: 'moeda' }
        ],
        linhas: vendidos.map((v) => {
          const doProduto = porProduto.get(v.product_id) || {};
          const estoque = Math.round(Object.values(doProduto).reduce((s, q) => s + q, 0) * 1000) / 1000;
          const custo = r2(v.custo);
          const lucro = r2(n(v.faturamento) - custo);
          const linha = {
            sku: v.sku, produto: v.produto, quantidade: n(v.quantidade), custoUnitario: n(v.custo_unitario), custo,
            faturamento: n(v.faturamento), lucro, margem: n(v.faturamento) ? r2((lucro / n(v.faturamento)) * 100) : null
          };
          for (const c of colunasDeDeposito) linha[c.coluna.campo] = doProduto[c.id] || 0;
          linha.estoque = estoque;
          linha.valorEmEstoque = r2(estoque * n(v.custo_unitario));
          return linha;
        })
      };
    }
  },

  {
    key: 'vendas-por-origem',
    grupo: 'vendas',
    titulo: 'Vendas por Origem',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'origem', rotulo: 'Origem', tipo: 'texto' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' },
      { campo: 'ticketMedio', rotulo: 'Ticket médio', tipo: 'moeda', semTotal: true }
    ],
    totais: ['pedidos', 'faturamento'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        select coalesce(nullif(o.sale_origin, ''), 'Sem origem') as origem, count(*)::int as pedidos,
               sum(coalesce(o.total_amount, o.amount, 0)) as faturamento
          from orders o
         where ${where}
         group by 1
         order by faturamento desc`, parametros);
      return linhas.map((l) => ({ origem: l.origem, pedidos: l.pedidos, faturamento: n(l.faturamento), ticketMedio: l.pedidos ? r2(n(l.faturamento) / l.pedidos) : null }));
    }
  },

  {
    key: 'vendas-por-grupo-de-clientes',
    grupo: 'vendas',
    titulo: 'Vendas por Grupo de Clientes',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'grupo', rotulo: 'Grupo', tipo: 'texto' },
      { campo: 'clientes', rotulo: 'Clientes', tipo: 'inteiro' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' },
      { campo: 'ticketMedio', rotulo: 'Ticket médio', tipo: 'moeda', semTotal: true },
      { campo: 'participacao', rotulo: '% do total', tipo: 'percentual' }
    ],
    totais: ['clientes', 'pedidos', 'faturamento'],
    // O grupo é o do cadastro do cliente (people.extra.group, o campo Grupo da
    // ficha). Pedido sem cliente cadastrado não tem grupo.
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        select coalesce(nullif(btrim(c.extra->>'group'), ''), 'Sem grupo') as grupo,
               count(distinct coalesce(nullif(o.client_supplier_id, ''), 'nome:' || coalesce(o.client_supplier_name, o.customer, '')))::int as clientes,
               count(*)::int as pedidos, sum(coalesce(o.total_amount, o.amount, 0)) as faturamento
          from orders o
          left join people c on c.id = o.client_supplier_id
         where ${where}
         group by 1
         order by faturamento desc`, parametros);
      const total = linhas.reduce((s, l) => s + n(l.faturamento), 0);
      return linhas.map((l) => ({
        grupo: l.grupo, clientes: l.clientes, pedidos: l.pedidos, faturamento: n(l.faturamento),
        ticketMedio: l.pedidos ? r2(n(l.faturamento) / l.pedidos) : null,
        participacao: total ? r2((n(l.faturamento) / total) * 100) : null
      }));
    }
  },

  {
    key: 'rentabilidade-por-produto',
    grupo: 'vendas',
    titulo: 'Rentabilidade por Produto',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'receita', rotulo: 'Receita', tipo: 'moeda' },
      { campo: 'custo', rotulo: 'Custo atual', tipo: 'moeda' },
      { campo: 'lucro', rotulo: 'Lucro', tipo: 'moeda' },
      { campo: 'margem', rotulo: 'Margem %', tipo: 'percentual' }
    ],
    totais: ['quantidade', 'receita', 'custo', 'lucro'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        select coalesce(pr.sku, max(it->>'sku'), '') as sku, coalesce(pr.name, max(it->>'name'), '') as produto,
               sum(${QTD}) as quantidade, sum(${TOTAL_ITEM}) as receita,
               sum(${QTD} * coalesce(pr.cost_price, 0)) as custo
          from orders o ${ITENS}
          left join products pr on pr.id = it->>'productId'
         where ${where}
         group by coalesce(it->>'productId', it->>'name'), pr.sku, pr.name
         order by receita desc`, parametros);
      return linhas.map((l) => {
        const lucro = r2(n(l.receita) - n(l.custo));
        return { sku: l.sku, produto: l.produto, quantidade: n(l.quantidade), receita: n(l.receita), custo: r2(l.custo), lucro, margem: n(l.receita) ? r2((lucro / n(l.receita)) * 100) : null };
      });
    }
  },

  {
    key: 'rentabilidade-por-vendedor',
    grupo: 'vendas',
    titulo: 'Rentabilidade por Vendedor',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'valor', rotulo: 'Valor vendido', tipo: 'moeda' },
      { campo: 'custo', rotulo: 'Custo atual', tipo: 'moeda' },
      { campo: 'lucro', rotulo: 'Lucro', tipo: 'moeda' },
      { campo: 'margem', rotulo: 'Margem %', tipo: 'percentual' }
    ],
    totais: 'numericas',
    // A Lucratividade por Pedido somada por vendedor: a mesma conta (o custo
    // atual de cada item), para os dois relatórios fecharem um com o outro.
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      const linhas = await ctx.sql(`
        with custos as (
          select o.id, sum(${QTD} * coalesce(pr.cost_price, 0)) as custo
            from orders o ${ITENS}
            left join products pr on pr.id = it->>'productId'
           where ${where}
           group by o.id)
        select coalesce(v.name, 'Sem vendedor') as vendedor, count(*)::int as pedidos,
               sum(coalesce(o.total_amount, o.amount, 0)) as valor, sum(coalesce(cs.custo, 0)) as custo
          from orders o
          left join custos cs on cs.id = o.id
          left join people v on v.id = o.seller_id
         where ${where}
         group by 1
         order by valor desc`, parametros);
      return linhas.map((l) => {
        const lucro = r2(n(l.valor) - n(l.custo));
        return { vendedor: l.vendedor, pedidos: l.pedidos, valor: n(l.valor), custo: r2(l.custo), lucro, margem: n(l.valor) ? r2((lucro / n(l.valor)) * 100) : null };
      });
    }
  },

  {
    key: 'lucratividade-por-pedido',
    grupo: 'vendas',
    titulo: 'Lucratividade por Pedido',
    filtros: FILTROS_DE_VENDA,
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'valor', rotulo: 'Valor do pedido', tipo: 'moeda' },
      { campo: 'custo', rotulo: 'Custo atual', tipo: 'moeda' },
      { campo: 'lucro', rotulo: 'Lucro', tipo: 'moeda' },
      { campo: 'margem', rotulo: 'Margem %', tipo: 'percentual' }
    ],
    totais: ['valor', 'custo', 'lucro'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx);
      // O custo de todos os itens numa passada só, e não uma subconsulta por
      // pedido: com 13 mil pedidos a versão por pedido levava 15 s.
      const linhas = await ctx.sql(`
        with custos as (
          select o.id, sum(${QTD} * coalesce(pr.cost_price, 0)) as custo
            from orders o ${ITENS}
            left join products pr on pr.id = it->>'productId'
           where ${where}
           group by o.id)
        select o.code as pedido, o.date as data,
               coalesce(c.name, o.client_supplier_name, o.customer, '') as cliente, coalesce(v.name, '') as vendedor,
               coalesce(o.total_amount, o.amount, 0) as valor, coalesce(cs.custo, 0) as custo
          from orders o
          left join custos cs on cs.id = o.id
          left join people c on c.id = o.client_supplier_id
          left join people v on v.id = o.seller_id
         where ${where}
         order by o.date, o.code`, parametros);
      return linhas.map((l) => {
        const lucro = r2(n(l.valor) - n(l.custo));
        return { pedido: l.pedido, data: l.data, cliente: l.cliente, vendedor: l.vendedor, valor: n(l.valor), custo: r2(l.custo), lucro, margem: n(l.valor) ? r2((lucro / n(l.valor)) * 100) : null };
      });
    }
  },

  {
    key: 'relacionamento-de-clientes',
    grupo: 'vendas',
    titulo: 'Relacionamento de Clientes',
    filtros: FILTROS_DE_VENDA,
    colunas: [
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'primeiraCompra', rotulo: 'Primeira compra', tipo: 'data' },
      { campo: 'ultimaCompra', rotulo: 'Última compra', tipo: 'data' },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'total', rotulo: 'Total comprado', tipo: 'moeda' },
      { campo: 'ticketMedio', rotulo: 'Ticket médio', tipo: 'moeda', semTotal: true },
      { campo: 'intervaloMedio', rotulo: 'Intervalo médio (dias)', tipo: 'inteiro', semTotal: true },
      { campo: 'diasSemComprar', rotulo: 'Dias sem comprar', tipo: 'inteiro', semTotal: true }
    ],
    totais: ['pedidos', 'total'],
    async executar(ctx) {
      const { where, parametros } = filtroDeVendas(ctx, 2);
      const linhas = await ctx.sql(`
        select coalesce(c.name, max(o.client_supplier_name), max(o.customer), 'Sem cliente') as cliente,
               min(o.date) as primeira, max(o.date) as ultima, count(*)::int as pedidos,
               sum(coalesce(o.total_amount, o.amount, 0)) as total,
               ($1::date - max(o.date))::int as dias_sem
          from orders o
          left join people c on c.id = o.client_supplier_id
         where ${where}
         group by coalesce(o.client_supplier_id, o.client_supplier_name, o.customer), c.name
         order by total desc`, [ctx.f.hoje, ...parametros]);
      return linhas.map((l) => {
        const dias = (Date.parse(l.ultima) - Date.parse(l.primeira)) / 86400000;
        return {
          cliente: l.cliente, primeiraCompra: l.primeira, ultimaCompra: l.ultima, pedidos: l.pedidos, total: n(l.total),
          ticketMedio: l.pedidos ? r2(n(l.total) / l.pedidos) : null,
          intervaloMedio: l.pedidos > 1 ? Math.round(dias / (l.pedidos - 1)) : null,
          diasSemComprar: l.dias_sem
        };
      });
    }
  },

  {
    key: 'orcamentos',
    grupo: 'vendas',
    titulo: 'Orçamentos',
    filtros: ['periodo', 'vendedor'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'codigo' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'validade', rotulo: 'Validade', tipo: 'data' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }
    ],
    totais: ['valor'],
    async executar(ctx) {
      const { vendedores } = parametrosDeVenda(ctx);
      const linhas = await ctx.sql(`
        select q.code as codigo, q.date as data, q.due_date as validade,
               coalesce(c.name, q.client_supplier_name, q.customer, '') as cliente, coalesce(v.name, '') as vendedor,
               q.status, coalesce(q.total_amount, q.amount, 0) as valor
          from quotes q
          left join people c on c.id = q.client_supplier_id
          left join people v on v.id = q.seller_id
         where ($1::text[] is null or q.seller_id = any($1::text[]))
           and ($2 = '' or q.date >= $2::date) and ($3 = '' or q.date <= $3::date)
         order by q.date, q.code`, [vendedores, ctx.f.de, ctx.f.ate]);
      return linhas.map((l) => ({
        codigo: l.codigo, data: l.data, validade: l.validade, cliente: l.cliente, vendedor: l.vendedor,
        situacao: salesStatus.rotulo(l.status), valor: n(l.valor)
      }));
    }
  },

  {
    key: 'precificacao',
    grupo: 'vendas',
    titulo: 'Precificação',
    filtros: [],
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'custo', rotulo: 'Custo', tipo: 'moeda', semTotal: true },
      { campo: 'venda', rotulo: 'Preço de venda', tipo: 'moeda', semTotal: true },
      { campo: 'margem', rotulo: 'Margem R$', tipo: 'moeda', semTotal: true },
      { campo: 'margemPercentual', rotulo: 'Margem %', tipo: 'percentual' },
      { campo: 'markup', rotulo: 'Markup %', tipo: 'percentual' }
    ],
    totais: [],
    async executar({ sql }) {
      const linhas = await sql(`
        select sku, name as produto, coalesce(cost_price, 0) as custo, coalesce(sale_price, 0) as venda
          from products
         where coalesce(tipo_produto_fiscal, 'NORMAL') <> 'ESCRITURAL'
         order by name`);
      return linhas.map((l) => {
        const custo = n(l.custo);
        const venda = n(l.venda);
        return {
          sku: l.sku, produto: l.produto, custo, venda,
          margem: venda ? r2(venda - custo) : null,
          margemPercentual: venda ? r2(((venda - custo) / venda) * 100) : null,
          markup: venda && custo ? r2(((venda - custo) / custo) * 100) : null
        };
      });
    }
  },

  {
    key: 'consistencia-dos-valores',
    grupo: 'vendas',
    titulo: 'Consistência nos Valores de Venda',
    filtros: ['periodo'],
    escolhas: [{ campo: 'conferir', rotulo: 'Conferir', itens: [['pedido', 'Total do pedido x itens'], ['financeiro', 'Pedido x financeiro']] }],
    colunas: [
      { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'somaDosItens', rotulo: 'Soma dos itens', tipo: 'moeda', semTotal: true },
      { campo: 'totalDosItens', rotulo: 'Total de itens gravado', tipo: 'moeda', semTotal: true },
      { campo: 'totalCalculado', rotulo: 'Total calculado', tipo: 'moeda', semTotal: true },
      { campo: 'totalGravado', rotulo: 'Total gravado', tipo: 'moeda', semTotal: true },
      { campo: 'diferenca', rotulo: 'Diferença', tipo: 'moeda' }
    ],
    totais: ['diferenca'],
    // Só lista o que NÃO fecha. O vendedor comum confere só os próprios pedidos.
    //
    // PEDIDO: o total é itens − desconto + frete + despesas + montagem +
    // serviços. Medido em 02/10/2026: 20 dos 14.016 pedidos não fecham.
    //
    // FINANCEIRO, como a Consistência do Viper: o pedido que gera financeiro
    // (faturado) deve ter lançado a receber o seu total, e o que não gera
    // (cancelado, aprovado sem faturamento) não deve ter nada lançado. Medido
    // em 02/10/2026: 564 faturados com valor diferente e 15 sem lançamento.
    async executar({ sql, f, vendedores }) {
      if (f.conferir === 'financeiro') {
        const linhas = await sql(`
          with financeiro as (
            select reference_id, sum(amount) as lancado, count(*)::int as lancamentos
              from financial_entries
             where type = 'RECEITA' and coalesce(status, '') not in ('cancelado', 'cancelled', 'canceled')
             group by reference_id)
          select o.code as pedido, o.date as data, coalesce(o.client_supplier_name, o.customer, '') as cliente, o.status,
                 coalesce(o.total_amount, 0) as total, coalesce(fi.lancado, 0) as lancado, coalesce(fi.lancamentos, 0) as lancamentos
            from orders o
            left join financeiro fi on fi.reference_id = o.id
           where ($1 = '' or o.date >= $1::date) and ($2 = '' or o.date <= $2::date)
             and ($3::text[] is null or o.seller_id = any($3::text[]))
           order by o.date, o.code`, [f.de, f.ate, vendedores]);
        return {
          colunas: [
            { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
            { campo: 'data', rotulo: 'Data', tipo: 'data' },
            { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
            { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
            { campo: 'totalDoPedido', rotulo: 'Total do pedido', tipo: 'moeda' },
            { campo: 'esperado', rotulo: 'Esperado no financeiro', tipo: 'moeda' },
            { campo: 'lancado', rotulo: 'Lançado a receber', tipo: 'moeda' },
            { campo: 'lancamentos', rotulo: 'Lançamentos', tipo: 'inteiro', semTotal: true },
            { campo: 'diferenca', rotulo: 'Diferença', tipo: 'moeda' }
          ],
          linhas: linhas
            .map((l) => {
              const esperado = salesStatus.geraFinanceiro(l.status) ? n(l.total) : 0;
              return {
                pedido: l.pedido, data: l.data, cliente: l.cliente, situacao: salesStatus.rotulo(l.status),
                totalDoPedido: n(l.total), esperado, lancado: n(l.lancado), lancamentos: l.lancamentos,
                diferenca: r2(n(l.lancado) - esperado)
              };
            })
            .filter((l) => Math.abs(l.diferenca) > 0.01)
        };
      }
      const linhas = await sql(`
        select o.code as pedido, o.date as data, coalesce(o.client_supplier_name, o.customer, '') as cliente, o.status,
               coalesce((select sum(coalesce(nullif(i->>'total', '')::numeric, 0)) from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) i), 0) as soma_itens,
               coalesce(o.items_total, 0) as itens_gravado,
               coalesce(o.items_total, 0) - coalesce(o.discount_total, 0) + coalesce(o.freight, 0) + coalesce(o.general_expenses, 0)
                 + coalesce(o.assembly_fee, 0) + coalesce(o.services_amount, 0) as calculado,
               coalesce(o.total_amount, 0) as gravado
          from orders o
         where o.status <> 'pedido-cancelado'
           and ($1 = '' or o.date >= $1::date) and ($2 = '' or o.date <= $2::date)
           and ($3::text[] is null or o.seller_id = any($3::text[]))`, [f.de, f.ate, vendedores]);
      return linhas
        .filter((l) => Math.abs(n(l.gravado) - n(l.calculado)) > 0.01 || Math.abs(n(l.soma_itens) - n(l.itens_gravado)) > 0.01)
        .map((l) => ({
          pedido: l.pedido, data: l.data, cliente: l.cliente, situacao: salesStatus.rotulo(l.status),
          somaDosItens: n(l.soma_itens), totalDosItens: n(l.itens_gravado), totalCalculado: r2(l.calculado), totalGravado: n(l.gravado),
          diferenca: r2(n(l.gravado) - n(l.calculado))
        }))
        .sort((a, b) => String(a.data).localeCompare(String(b.data)));
    }
  }
];
