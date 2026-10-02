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
      { campo: 'codigo', rotulo: 'Código', tipo: 'inteiro', semTotal: true },
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
    key: 'apontamentos-de-producao',
    grupo: 'pcp',
    titulo: 'Produção Apontada',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'op', rotulo: 'OP', tipo: 'inteiro', semTotal: true },
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
  }
];
