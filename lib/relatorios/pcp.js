/**
 * RELATÓRIOS DO PCP.
 *
 * A ETAPA da ordem (pcp_orders.status) é fixa e é o que o código lê: aberta,
 * em_producao, concluida, cancelada (CHECK no banco). O status cadastrado pela
 * empresa (status_id → pcp_statuses) só rotula; quando existe, é ele que a
 * Situação mostra — igual à lista de ordens da tela.
 *
 * O consumo segue a mesma conta do apontamento em server.js
 * (aplicarConsumoDeProducao): quantidade apontada × quantidade da ficha ×
 * (1 + perda/100). A ficha é a ATUAL, porque o sistema não versiona BOM — o
 * relatório mostra o que o apontamento baixaria hoje, e é o mesmo que ele
 * baixou enquanto ninguém mexeu na ficha.
 *
 * "Em aberto" é tudo o que não está concluído nem cancelado.
 */

const { SALDO_DO_RAZAO } = require('./comum');

const ETAPAS = { aberta: 'Aberta', em_producao: 'Em produção', concluida: 'Concluída', cancelada: 'Cancelada' };
const PRODUTO = (alias) => `coalesce(nullif(concat_ws(' · ', nullif(${alias}.sku, ''), nullif(${alias}.name, '')), ''), 'Produto removido')`;
const CONSUMO_POR_UNIDADE = 'b.quantity * (1 + coalesce(b.loss_percent, 0) / 100)';

const n = (v) => Number(v || 0);
const r4 = (v) => Math.round(n(v) * 10000) / 10000;
const r2 = (v) => Math.round(n(v) * 100) / 100;

module.exports = [
  {
    key: 'ordens-de-producao',
    grupo: 'pcp',
    titulo: 'Ordens de Produção',
    filtros: ['periodo'],
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'codigo' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'produzida', rotulo: 'Produzida', tipo: 'quantidade' },
      { campo: 'saldo', rotulo: 'Saldo', tipo: 'quantidade' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'inicio', rotulo: 'Início', tipo: 'data' },
      { campo: 'entrega', rotulo: 'Entrega', tipo: 'data' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select o.code as codigo, ${PRODUTO('p')} as produto,
               coalesce(o.quantity, 0) as quantidade, coalesce(o.quantity_done, 0) as produzida,
               o.status, st.name as status_nome, o.start_date as inicio, o.due_date as entrega
          from pcp_orders o
          left join products p on p.id = o.product_id
          left join pcp_statuses st on st.id = o.status_id
         where ($1 = '' or o.start_date >= $1::date) and ($2 = '' or o.start_date <= $2::date)
         order by o.start_date nulls last, o.code nulls last`, [f.de, f.ate]);
      return linhas.map((l) => ({
        codigo: l.codigo, produto: l.produto, quantidade: n(l.quantidade), produzida: n(l.produzida),
        saldo: r4(Math.max(0, n(l.quantidade) - n(l.produzida))),
        situacao: l.status_nome || ETAPAS[l.status] || l.status || '',
        inicio: l.inicio, entrega: l.entrega
      }));
    }
  },

  {
    key: 'previsao-de-producao',
    grupo: 'pcp',
    titulo: 'Previsão de Produção',
    filtros: ['data', 'dias'],
    diasPadrao: 30,
    colunas: [
      { campo: 'inicio', rotulo: 'Início', tipo: 'data' },
      { campo: 'op', rotulo: 'OP', tipo: 'codigo' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'produzida', rotulo: 'Produzida', tipo: 'quantidade' },
      { campo: 'saldo', rotulo: 'Falta produzir', tipo: 'quantidade' },
      { campo: 'entrega', rotulo: 'Entrega', tipo: 'data' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: ['quantidade', 'produzida', 'saldo'],
    // O que está para começar: ordem em aberto com início entre a data e os
    // `dias` seguintes. Ordem sem início entra pela entrega.
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(o.start_date, o.due_date) as inicio, o.code as op, ${PRODUTO('p')} as produto,
               coalesce(o.quantity, 0) as quantidade, coalesce(o.quantity_done, 0) as produzida,
               o.due_date as entrega, o.status, st.name as status_nome
          from pcp_orders o
          left join products p on p.id = o.product_id
          left join pcp_statuses st on st.id = o.status_id
         where coalesce(o.status, '') not in ('concluida', 'cancelada')
           and coalesce(o.start_date, o.due_date) between $1::date and $1::date + $2::int
         order by 1, o.code nulls last`, [f.data, f.dias]);
      return linhas.map((l) => ({
        inicio: l.inicio, op: l.op, produto: l.produto, quantidade: n(l.quantidade), produzida: n(l.produzida),
        saldo: r4(Math.max(0, n(l.quantidade) - n(l.produzida))), entrega: l.entrega,
        situacao: l.status_nome || ETAPAS[l.status] || l.status || ''
      }));
    }
  },

  {
    key: 'apontamentos-de-producao',
    grupo: 'pcp',
    titulo: 'Produção Apontada',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'op', rotulo: 'OP', tipo: 'codigo' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'colaborador', rotulo: 'Colaborador', tipo: 'texto' }
    ],
    totais: ['quantidade'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select a.date as data, o.code as op, ${PRODUTO('p')} as produto, coalesce(a.quantity, 0) as quantidade,
               coalesce(c.name, '') as colaborador
          from pcp_entries a
          left join pcp_orders o on o.id = a.order_id
          left join products p on p.id = o.product_id
          left join hr_employees c on c.id = a.employee_id
         where ($1 = '' or a.date >= $1::date) and ($2 = '' or a.date <= $2::date)
         order by a.date, o.code nulls last, a.created_at`, [f.de, f.ate]);
      return linhas.map((l) => ({ ...l, quantidade: n(l.quantidade) }));
    }
  },

  {
    key: 'materiais-por-op',
    grupo: 'pcp',
    titulo: 'Uso de Materiais por OP',
    filtros: ['periodo'],
    colunas: [
      { campo: 'op', rotulo: 'OP', tipo: 'codigo' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto acabado', tipo: 'texto' },
      { campo: 'material', rotulo: 'Material', tipo: 'texto' },
      { campo: 'unidade', rotulo: 'Un.', tipo: 'texto' },
      { campo: 'previsto', rotulo: 'Previsto', tipo: 'quantidade' },
      { campo: 'utilizado', rotulo: 'Utilizado', tipo: 'quantidade' },
      { campo: 'custoUnitario', rotulo: 'Custo unitário', tipo: 'moeda', semTotal: true },
      { campo: 'custoTotal', rotulo: 'Custo total', tipo: 'moeda' }
    ],
    totais: ['custoTotal'],
    // Previsto é a quantidade da OP pela ficha; utilizado, a quantidade já
    // apontada pela mesma ficha (a conta do apontamento). O custo, como no
    // Viper: na OP concluída, pelo que foi produzido; nas outras, pela previsão.
    async executar({ sql, f }) {
      const linhas = await sql(`
        select o.code as op, o.status, st.name as status_nome, ${PRODUTO('p')} as produto, ${PRODUTO('m')} as material,
               coalesce(m.unidade_comercial, '') as unidade,
               coalesce(o.quantity, 0) * ${CONSUMO_POR_UNIDADE} as previsto,
               coalesce(o.quantity_done, 0) * ${CONSUMO_POR_UNIDADE} as utilizado,
               coalesce(m.cost_price, 0) as custo
          from pcp_orders o
          join pcp_bom b on b.product_id = o.product_id
          left join products p on p.id = o.product_id
          left join products m on m.id = b.component_id
          left join pcp_statuses st on st.id = o.status_id
         where ($1 = '' or o.start_date >= $1::date) and ($2 = '' or o.start_date <= $2::date)
         order by o.start_date nulls last, o.code nulls last, 5`, [f.de, f.ate]);
      return linhas.map((l) => ({
        op: l.op, situacao: l.status_nome || ETAPAS[l.status] || l.status || '', produto: l.produto, material: l.material,
        unidade: l.unidade, previsto: r4(l.previsto), utilizado: r4(l.utilizado), custoUnitario: n(l.custo),
        custoTotal: r2(n(l.custo) * (l.status === 'concluida' ? n(l.utilizado) : n(l.previsto)))
      }));
    }
  },

  {
    key: 'consumo-de-materiais',
    grupo: 'pcp',
    titulo: 'Consumo de Materiais',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'componente', rotulo: 'Componente', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade consumida', tipo: 'quantidade' },
      { campo: 'custoUnitario', rotulo: 'Custo unitário', tipo: 'moeda', semTotal: true },
      { campo: 'custoTotal', rotulo: 'Custo total', tipo: 'moeda' }
    ],
    totais: ['custoTotal'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select ${PRODUTO('m')} as componente, sum(a.quantity * ${CONSUMO_POR_UNIDADE}) as quantidade,
               coalesce(max(m.cost_price), 0) as custo
          from pcp_entries a
          join pcp_orders o on o.id = a.order_id
          join pcp_bom b on b.product_id = o.product_id
          left join products m on m.id = b.component_id
         where ($1 = '' or a.date >= $1::date) and ($2 = '' or a.date <= $2::date)
         group by b.component_id, 1
         order by sum(a.quantity * ${CONSUMO_POR_UNIDADE}) * coalesce(max(m.cost_price), 0) desc, 1`, [f.de, f.ate]);
      return linhas.map((l) => ({
        componente: l.componente, quantidade: r4(l.quantidade), custoUnitario: n(l.custo),
        custoTotal: r2(n(l.quantidade) * n(l.custo))
      }));
    }
  },

  {
    key: 'necessidade-de-materiais',
    grupo: 'pcp',
    titulo: 'Necessidade de Materiais',
    filtros: [],
    colunas: [
      { campo: 'componente', rotulo: 'Componente', tipo: 'texto' },
      { campo: 'necessario', rotulo: 'Necessário', tipo: 'quantidade' },
      { campo: 'estoque', rotulo: 'Saldo em estoque', tipo: 'quantidade' },
      { campo: 'falta', rotulo: 'Falta', tipo: 'quantidade' }
    ],
    totais: [],
    async executar({ sql }) {
      const linhas = await sql(`
        select ${PRODUTO('m')} as componente,
               sum(greatest(coalesce(o.quantity, 0) - coalesce(o.quantity_done, 0), 0) * ${CONSUMO_POR_UNIDADE}) as necessario,
               coalesce(max(m.stock_quantity), 0) as estoque
          from pcp_orders o
          join pcp_bom b on b.product_id = o.product_id
          left join products m on m.id = b.component_id
         where coalesce(o.status, '') not in ('concluida', 'cancelada')
           and coalesce(o.quantity, 0) > coalesce(o.quantity_done, 0)
         group by b.component_id, 1
         order by 1`);
      return linhas
        .map((l) => ({
          componente: l.componente, necessario: r4(l.necessario), estoque: n(l.estoque),
          falta: r4(Math.max(0, n(l.necessario) - n(l.estoque)))
        }))
        .sort((a, b) => b.falta - a.falta || a.componente.localeCompare(b.componente, 'pt-BR'));
    }
  },

  {
    key: 'simulador-de-producao',
    grupo: 'pcp',
    titulo: 'Simulador de Produção',
    filtros: ['deposito'],
    colunas: [
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'componentes', rotulo: 'Componentes na ficha', tipo: 'inteiro', semTotal: true },
      { campo: 'possiveis', rotulo: 'Dá para produzir', tipo: 'quantidade', semTotal: true },
      { campo: 'limitante', rotulo: 'Componente que limita', tipo: 'texto' },
      { campo: 'saldoAcabado', rotulo: 'Saldo do acabado', tipo: 'quantidade', semTotal: true }
    ],
    totais: [],
    // Quantas unidades de cada produto com ficha dá para montar com o estoque
    // de hoje: o componente que acaba primeiro manda (o menor saldo ÷ consumo
    // por unidade, com a perda). Com depósito, o saldo é o do razão naquele
    // depósito; sem, o saldo total do produto — a conta da Necessidade de
    // Materiais.
    async executar({ sql, f }) {
      const linhas = await sql(`
        with saldo_no_deposito as (
          select m.product_id, sum(${SALDO_DO_RAZAO}) as saldo
            from stock_movements m
           where $1 <> '' and m.deposit_id = $1
           group by 1),
        ficha as (
          select b.product_id, ${PRODUTO('c')} as componente, ${CONSUMO_POR_UNIDADE} as por_unidade,
                 case when $1 = '' then coalesce(c.stock_quantity, 0) else coalesce(sd.saldo, 0) end as saldo
            from pcp_bom b
            left join products c on c.id = b.component_id
            left join saldo_no_deposito sd on sd.product_id = b.component_id
           where coalesce(b.quantity, 0) > 0)
        select ${PRODUTO('p')} as produto, count(*)::int as componentes,
               greatest(min(floor(fi.saldo / fi.por_unidade)), 0) as possiveis,
               (array_agg(fi.componente order by fi.saldo / fi.por_unidade, fi.componente))[1] as limitante,
               case when $1 = '' then coalesce(max(p.stock_quantity), 0) else coalesce(max(sa.saldo), 0) end as saldo_acabado
          from ficha fi
          left join products p on p.id = fi.product_id
          left join saldo_no_deposito sa on sa.product_id = fi.product_id
         group by fi.product_id, 1
         order by 3 desc, 1`, [f.depositoId]);
      return linhas.map((l) => ({
        produto: l.produto, componentes: l.componentes, possiveis: n(l.possiveis), limitante: l.limitante, saldoAcabado: n(l.saldo_acabado)
      }));
    }
  },

  {
    key: 'produtos-acabados',
    grupo: 'pcp',
    titulo: 'Produtos Acabados por OP',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'op', rotulo: 'OP', tipo: 'codigo' },
      { campo: 'produto', rotulo: 'Produto acabado', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'produzida', rotulo: 'Produzida', tipo: 'quantidade' },
      { campo: 'custoUnitario', rotulo: 'Custo unitário (ficha)', tipo: 'moeda', semTotal: true },
      { campo: 'custoTotal', rotulo: 'Custo do produzido', tipo: 'moeda' },
      { campo: 'inicio', rotulo: 'Início', tipo: 'data' },
      { campo: 'termino', rotulo: 'Última produção', tipo: 'data' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: ['quantidade', 'produzida', 'custoTotal'],
    // O que saiu pronto, pelo dia da última produção apontada. O custo
    // unitário é o da ficha ATUAL (componentes × custo de hoje, com a perda),
    // pelo mesmo motivo do consumo: a ficha não tem versão.
    async executar({ sql, f }) {
      const linhas = await sql(`
        with custo_da_ficha as (
          select b.product_id, sum(${CONSUMO_POR_UNIDADE} * coalesce(c.cost_price, 0)) as custo
            from pcp_bom b left join products c on c.id = b.component_id
           group by 1),
        producao as (
          select order_id, max(date) as ultima from pcp_entries group by 1)
        select o.code as op, ${PRODUTO('p')} as produto, coalesce(o.quantity, 0) as quantidade,
               coalesce(o.quantity_done, 0) as produzida, coalesce(cf.custo, 0) as custo_unitario,
               o.start_date as inicio, pr.ultima as termino, o.status, st.name as status_nome
          from pcp_orders o
          left join producao pr on pr.order_id = o.id
          left join custo_da_ficha cf on cf.product_id = o.product_id
          left join products p on p.id = o.product_id
          left join pcp_statuses st on st.id = o.status_id
         where coalesce(o.quantity_done, 0) > 0
           and ($1 = '' or pr.ultima >= $1::date) and ($2 = '' or pr.ultima <= $2::date)
         order by pr.ultima nulls last, o.code nulls last`, [f.de, f.ate]);
      return linhas.map((l) => ({
        op: l.op, produto: l.produto, quantidade: n(l.quantidade), produzida: n(l.produzida),
        custoUnitario: r2(l.custo_unitario), custoTotal: r2(n(l.produzida) * n(l.custo_unitario)),
        inicio: l.inicio, termino: l.termino, situacao: l.status_nome || ETAPAS[l.status] || l.status || ''
      }));
    }
  }
];
