/**
 * RELATÓRIOS DO ESTOQUE.
 *
 * O saldo por depósito sai do RAZÃO (stock_movements), somado com sinal: saída
 * negativa, todo o resto positivo — a mesma conta de movementSignedQuantity em
 * lib/stock-core.js. Dois relatórios que somassem o razão de jeitos diferentes
 * mostrariam dois saldos para o mesmo depósito.
 *
 * `deposit_id` sem linha em `deposits` é balde, não depósito: vazio é o saldo
 * sem depósito (movimento antigo, de antes do módulo) e '__transito__' é a
 * carga que saiu da origem e ainda não foi conferida no destino.
 *
 * "Vendido" é o pedido em status que baixa estoque, fora transferência e
 * remessa (ver comum.js). Os itens moram em orders.items (jsonb).
 */

const { STATUS_VENDIDO, ehVendaSql, SALDO_DO_RAZAO: SALDO, nomeDoDepositoSql: nomeDoDeposito } = require('./comum');

const salesStatus = require('../../public/modules/shared/sales_status');

const DEPOSITO_DO_RAZAO = "coalesce(m.deposit_id, '')";

/** Os status cujo pedido segura estoque (lib/reservas.js lê a mesma regra). */
const STATUS_QUE_RESERVA = salesStatus.CATALOGO.filter((s) => salesStatus.reservaEstoque(s.value)).map((s) => s.value);

/** Período em que cada ponta pode vir vazia ('' = sem limite daquele lado). */
const noPeriodo = (expr, de, ate) => `($${de} = '' or ${expr} >= $${de}::date) and ($${ate} = '' or ${expr} <= $${ate}::date)`;

// Quantidade do item como número. Um item gravado com texto no lugar do número
// vira zero em vez de derrubar o relatório inteiro.
const QUANTIDADE_DO_ITEM = `case when (i->>'quantity') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (i->>'quantity')::numeric else 0 end`;

/** Cada item de pedido VENDIDO: produto, data do pedido e quantidade. `$1` = status vendidos. */
const ITENS_VENDIDOS = `
  select i->>'productId' as product_id, o.date, ${QUANTIDADE_DO_ITEM} as quantidade
    from orders o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i
   where o.status = any($1::text[]) and ${ehVendaSql('o')}`;

// De onde o movimento veio — o mesmo vocabulário da tela de Movimentações.
const ORIGENS = {
  'saldo-inicial': 'Saldo inicial',
  'entrada-nfe': 'Entrada de NF-e',
  'ordem-de-compra': 'Ordem de compra',
  purchase: 'Compra',
  order: 'Pedido',
  producao: 'Produção',
  contagem: 'Contagem',
  transferencia: 'Transferência'
};

const SITUACOES_DA_CONTAGEM = { aberta: 'Aberta', fechada: 'Fechada', cancelada: 'Cancelada' };

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const numeroOuNulo = (v) => (v === null || v === undefined ? null : Number(v));

module.exports = [
  { key: 'valor-em-estoque', grupo: 'estoque', titulo: 'Valor em Estoque', especial: 'estoque' },

  {
    key: 'estoque-por-deposito',
    grupo: 'estoque',
    titulo: 'Estoque por Depósito',
    filtros: ['deposito'],
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'deposito', rotulo: 'Depósito', tipo: 'texto' },
      { campo: 'saldo', rotulo: 'Saldo', tipo: 'quantidade' },
      { campo: 'custo', rotulo: 'Custo', tipo: 'moeda', semTotal: true },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }
    ],
    totais: ['saldo', 'valor'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        with saldos as (
          select m.product_id, ${DEPOSITO_DO_RAZAO} as deposit_id, sum(${SALDO}) as saldo,
                 max(m.product_name) as nome_no_razao
            from stock_movements m
           where ($1 = '' or m.deposit_id = $1)
           group by 1, 2
          having sum(${SALDO}) <> 0)
        select coalesce(p.sku, '') as sku, coalesce(p.name, s.nome_no_razao, '') as produto,
               ${nomeDoDeposito('d', 's.deposit_id')} as deposito,
               s.saldo, coalesce(p.cost_price, 0) as custo
          from saldos s
          left join products p on p.id = s.product_id
          left join deposits d on d.id = s.deposit_id
         order by 2, 3`, [f.depositoId]);
      return linhas.map((l) => ({
        sku: l.sku, produto: l.produto, deposito: l.deposito,
        saldo: n(l.saldo), custo: n(l.custo), valor: r2(n(l.saldo) * n(l.custo))
      }));
    }
  },

  {
    key: 'estoque-disponivel',
    grupo: 'estoque',
    titulo: 'Estoque Disponível e Reservado',
    filtros: [],
    escolhas: [{ campo: 'mostrar', rotulo: 'Mostrar', itens: [['reservados', 'Só com reserva'], ['negativos', 'Só disponível negativo'], ['todos', 'Todos com saldo ou reserva']] }],
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'saldo', rotulo: 'Saldo', tipo: 'quantidade' },
      { campo: 'reservado', rotulo: 'Reservado', tipo: 'quantidade' },
      { campo: 'disponivel', rotulo: 'Disponível', tipo: 'quantidade' },
      { campo: 'pedidos', rotulo: 'Pedidos que reservam', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: ['saldo', 'reservado', 'disponivel'],
    // O Status dos Produtos do Viper. A reserva é a de lib/reservas.js: o item
    // de pedido que ainda não baixou estoque, não é orçamento e não foi
    // cancelado (sales_status.js, reservaEstoque) — derivada dos pedidos, sem
    // tabela própria. Disponível = saldo − reservado, e pode ficar negativo de
    // propósito: é o estoque prometido além do que existe.
    async executar({ sql, f, data }) {
      const linhas = await sql(`
        with reservas as (
          select i->>'productId' as product_id, sum(${QUANTIDADE_DO_ITEM}) as reservado,
                 string_agg(distinct o.code::text, ', ') as pedidos
            from orders o
            cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i
           where o.status = any($1::text[]) and coalesce(i->>'productId', '') <> ''
           group by 1
          having sum(${QUANTIDADE_DO_ITEM}) > 0)
        select p.id, coalesce(p.sku, '') as sku, p.name as produto, coalesce(p.stock_quantity, 0) as saldo,
               coalesce(r.reservado, 0) as reservado, coalesce(r.pedidos, '') as pedidos
          from products p
          left join reservas r on r.product_id = p.id
         where coalesce(r.reservado, 0) > 0 or coalesce(p.stock_quantity, 0) <> 0
         order by p.name, p.sku`, [STATUS_QUE_RESERVA]);
      const minimos = (data && data.productMeta) || {};
      return linhas
        .map((l) => {
          const disponivel = r3(n(l.saldo) - n(l.reservado));
          const minimo = n(minimos[l.id] && minimos[l.id].minStock);
          let situacao = '';
          if (disponivel < 0) situacao = 'Prometido além do saldo';
          else if (minimo > 0 && disponivel <= minimo) situacao = 'Abaixo do mínimo';
          return { sku: l.sku, produto: l.produto, saldo: n(l.saldo), reservado: n(l.reservado), disponivel, pedidos: l.pedidos, situacao };
        })
        .filter((l) => {
          if (f.mostrar === 'reservados') return l.reservado > 0;
          if (f.mostrar === 'negativos') return l.disponivel < 0;
          return true;
        });
    }
  },

  {
    key: 'movimentacoes',
    grupo: 'estoque',
    titulo: 'Movimentações',
    filtros: ['periodo', 'deposito'],
    periodoPadrao: 'mes',
    escolhas: [{ campo: 'tipo', rotulo: 'Tipo', itens: [['todos', 'Entradas e saídas'], ['entrada', 'Só entradas'], ['saida', 'Só saídas']] }],
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'codigo', rotulo: 'Código', tipo: 'texto' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'deposito', rotulo: 'Depósito', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'custoUnitario', rotulo: 'Custo unitário', tipo: 'moeda', semTotal: true },
      { campo: 'origem', rotulo: 'Origem', tipo: 'texto' },
      { campo: 'observacao', rotulo: 'Observação', tipo: 'texto' },
      { campo: 'usuario', rotulo: 'Usuário', tipo: 'texto' }
    ],
    totais: ['quantidade'],
    async executar({ sql, f }) {
      // A quantidade sai COM SINAL (saída negativa), como na tela: o total da
      // coluna é então o quanto o estoque andou no período.
      const linhas = await sql(`
        select m.date as data, coalesce(m.code, '') as codigo, m.type as tipo,
               coalesce(p.sku, '') as sku, coalesce(p.name, nullif(m.product_name, ''), '') as produto,
               ${nomeDoDeposito('d', 'm.deposit_id')} as deposito,
               ${SALDO} as quantidade, coalesce(m.unit_cost, 0) as custo_unitario,
               coalesce(m.origin, '') as origem, coalesce(m.transfer_id, '') as transfer_id,
               coalesce(nullif(m.motivo, ''), nullif(m.note, ''), nullif(m.document, ''), '') as observacao,
               coalesce(m.created_by_name, '') as usuario
          from stock_movements m
          left join products p on p.id = m.product_id
          left join deposits d on d.id = m.deposit_id
         where ${noPeriodo('m.date', 1, 2)}
           and ($3 = '' or m.deposit_id = $3)
           -- Entrada é tudo o que não é saída: a mesma divisão do saldo.
           and ($4 = 'todos' or ($4 = 'saida') = (m.type = 'saida'))
         order by m.date, m.created_at, m.code`, [f.de, f.ate, f.depositoId, f.tipo]);
      return linhas.map((l) => ({
        data: l.data, codigo: l.codigo, tipo: l.tipo === 'saida' ? 'Saída' : 'Entrada',
        sku: l.sku, produto: l.produto, deposito: l.deposito,
        quantidade: n(l.quantidade), custoUnitario: n(l.custo_unitario),
        origem: l.transfer_id ? 'Transferência' : (ORIGENS[l.origem] || 'Manual'),
        observacao: l.observacao, usuario: l.usuario
      }));
    }
  },

  {
    key: 'estoque-critico',
    grupo: 'estoque',
    titulo: 'Estoque Crítico',
    filtros: [],
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'saldo', rotulo: 'Saldo', tipo: 'quantidade' },
      { campo: 'minimo', rotulo: 'Mínimo', tipo: 'quantidade' },
      { campo: 'falta', rotulo: 'Falta', tipo: 'quantidade' }
    ],
    totais: ['falta'],
    async executar({ sql, data }) {
      // O mínimo ainda mora no db.json (productMeta), e só vale quando foi
      // cadastrado: mínimo zero não torna produto nenhum crítico.
      const minimos = Object.entries((data && data.productMeta) || {})
        .map(([id, meta]) => [id, n(meta && meta.minStock)])
        .filter(([, minimo]) => minimo > 0);
      if (!minimos.length) return [];
      const linhas = await sql(`
        select coalesce(p.sku, '') as sku, p.name as produto,
               coalesce(p.stock_quantity, 0) as saldo, m.minimo
          from unnest($1::text[], $2::numeric[]) as m(id, minimo)
          join products p on p.id = m.id
         -- <= e não <: é a regra de "abaixo do mínimo" da tela de produtos
         -- (stock-core.js, productStockSituation). Os dois têm de concordar.
         where coalesce(p.stock_quantity, 0) <= m.minimo
         order by m.minimo - coalesce(p.stock_quantity, 0) desc, p.name`,
      [minimos.map(([id]) => id), minimos.map(([, minimo]) => minimo)]);
      return linhas.map((l) => ({
        sku: l.sku, produto: l.produto, saldo: n(l.saldo), minimo: n(l.minimo), falta: r3(n(l.minimo) - n(l.saldo))
      }));
    }
  },

  {
    key: 'produtos-sem-saida',
    grupo: 'estoque',
    titulo: 'Produtos sem Saída',
    filtros: ['dias'],
    diasPadrao: 90,
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'saldo', rotulo: 'Saldo', tipo: 'quantidade' },
      { campo: 'custo', rotulo: 'Custo', tipo: 'moeda', semTotal: true },
      { campo: 'valorParado', rotulo: 'Valor parado', tipo: 'moeda' },
      { campo: 'ultimaVenda', rotulo: 'Última venda', tipo: 'data' }
    ],
    totais: ['saldo', 'valorParado'],
    async executar({ sql, f }) {
      // Sem saída = nenhuma venda nos últimos `dias` dias, hoje incluído. A
      // última venda é de qualquer época, para mostrar há quanto tempo parou.
      const linhas = await sql(`
        with vendas as (
          select v.product_id, max(v.date) as ultima from (${ITENS_VENDIDOS}) v group by 1)
        select coalesce(p.sku, '') as sku, p.name as produto, p.stock_quantity as saldo,
               coalesce(p.cost_price, 0) as custo, v.ultima
          from products p
          left join vendas v on v.product_id = p.id
         where coalesce(p.stock_quantity, 0) > 0
           and (v.ultima is null or v.ultima <= $2::date - $3::int)
         order by p.stock_quantity * coalesce(p.cost_price, 0) desc, p.name`, [STATUS_VENDIDO, f.hoje, f.dias]);
      return linhas.map((l) => ({
        sku: l.sku, produto: l.produto, saldo: n(l.saldo), custo: n(l.custo),
        valorParado: r2(n(l.saldo) * n(l.custo)), ultimaVenda: l.ultima || null
      }));
    }
  },

  {
    key: 'saidas-x-receitas',
    grupo: 'estoque',
    titulo: 'Saídas de Estoque x Receitas',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'dia', rotulo: 'Data', tipo: 'data' },
      { campo: 'saidas', rotulo: 'Saídas (quantidade)', tipo: 'quantidade' },
      { campo: 'custoDasSaidas', rotulo: 'Custo das saídas', tipo: 'moeda' },
      { campo: 'vendas', rotulo: 'Vendas do dia', tipo: 'moeda' },
      { campo: 'receitas', rotulo: 'Receitas lançadas', tipo: 'moeda' }
    ],
    totais: 'numericas',
    // Dia a dia, o que saiu do estoque ao lado do que foi vendido e do que foi
    // lançado a receber: o dia com venda e sem saída é a venda que não baixou
    // estoque, e o contrário é a saída sem venda. O custo da saída é o do
    // movimento, ou o do cadastro quando o movimento não guardou.
    async executar({ sql, f }) {
      const linhas = await sql(`
        with saidas as (
          select m.date as dia, sum(m.quantity) as quantidade,
                 sum(m.quantity * coalesce(nullif(m.unit_cost, 0), p.cost_price, 0)) as custo
            from stock_movements m
            left join products p on p.id = m.product_id
           where m.type = 'saida' and ($2 = '' or m.date >= $2::date) and ($3 = '' or m.date <= $3::date)
           group by 1),
        vendas as (
          select o.date as dia, sum(coalesce(o.total_amount, o.amount, 0)) as valor
            from orders o
           where o.status = any($1::text[]) and ${ehVendaSql('o')}
             and ($2 = '' or o.date >= $2::date) and ($3 = '' or o.date <= $3::date)
           group by 1),
        receitas as (
          select e.date as dia, sum(e.amount) as valor
            from financial_entries e
           where e.type = 'RECEITA' and coalesce(e.status, '') not in ('cancelado', 'cancelled', 'canceled')
             and ($2 = '' or e.date >= $2::date) and ($3 = '' or e.date <= $3::date)
           group by 1),
        dias as (select dia from saidas union select dia from vendas union select dia from receitas)
        select d.dia, coalesce(s.quantidade, 0) as saidas, coalesce(s.custo, 0) as custo,
               coalesce(v.valor, 0) as vendas, coalesce(r.valor, 0) as receitas
          from dias d
          left join saidas s on s.dia = d.dia
          left join vendas v on v.dia = d.dia
          left join receitas r on r.dia = d.dia
         where d.dia is not null
         order by d.dia`, [STATUS_VENDIDO, f.de, f.ate]);
      return linhas.map((l) => ({ dia: l.dia, saidas: n(l.saidas), custoDasSaidas: r2(l.custo), vendas: n(l.vendas), receitas: n(l.receitas) }));
    }
  },

  {
    key: 'dados-fiscais-produtos',
    grupo: 'estoque',
    titulo: 'Dados Fiscais dos Produtos',
    filtros: [],
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'ncm', rotulo: 'NCM', tipo: 'texto' },
      { campo: 'cest', rotulo: 'CEST', tipo: 'texto' },
      { campo: 'origem', rotulo: 'Origem', tipo: 'texto' },
      { campo: 'unidade', rotulo: 'Unidade', tipo: 'texto' },
      { campo: 'unidadeTributavel', rotulo: 'Unidade tributável', tipo: 'texto' },
      { campo: 'ean', rotulo: 'EAN', tipo: 'texto' },
      { campo: 'grupoTributario', rotulo: 'Grupo tributário', tipo: 'texto' },
      { campo: 'cstIpi', rotulo: 'CST IPI', tipo: 'texto' },
      { campo: 'aliquotaIpi', rotulo: 'IPI %', tipo: 'percentual' }
    ],
    totais: [],
    async executar({ sql }) {
      // `origem` 0 é "Nacional", valor legítimo: só nulo vira vazio.
      const linhas = await sql(`
        select coalesce(p.sku, '') as sku, p.name as produto,
               coalesce(btrim(p.ncm), '') as ncm, coalesce(btrim(p.cest), '') as cest,
               coalesce(p.origem::text, '') as origem, coalesce(p.unidade_comercial, '') as unidade,
               coalesce(p.unidade_tributavel, '') as unidade_tributavel, coalesce(btrim(p.ean), '') as ean,
               coalesce(g.nome, '') as grupo_tributario, coalesce(btrim(p.cst_ipi), '') as cst_ipi, p.aliquota_ipi
          from products p
          left join grupo_tributario g on g.id = p.grupo_tributario_id
         order by p.name, p.sku`);
      return linhas.map((l) => ({
        sku: l.sku, produto: l.produto, ncm: l.ncm, cest: l.cest, origem: l.origem,
        unidade: l.unidade, unidadeTributavel: l.unidade_tributavel, ean: l.ean, grupoTributario: l.grupo_tributario,
        cstIpi: l.cst_ipi, aliquotaIpi: l.aliquota_ipi === null ? null : n(l.aliquota_ipi)
      }));
    }
  },

  {
    key: 'previsao-de-compra',
    grupo: 'estoque',
    titulo: 'Previsão de Compra',
    filtros: ['dias'],
    diasPadrao: 90,
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'vendido', rotulo: 'Vendido', tipo: 'quantidade' },
      { campo: 'mediaDiaria', rotulo: 'Média diária', tipo: 'numero', semTotal: true },
      { campo: 'saldo', rotulo: 'Saldo', tipo: 'quantidade' },
      { campo: 'cobertura', rotulo: 'Cobertura (dias)', tipo: 'numero', semTotal: true },
      { campo: 'comprar', rotulo: 'Comprar', tipo: 'quantidade' }
    ],
    totais: ['vendido', 'saldo', 'comprar'],
    async executar({ sql, f }) {
      // A janela é a mesma de Produtos sem Saída: os últimos `dias` dias, hoje
      // incluído. Comprar é o que falta para cobrir outros `dias` dias no
      // mesmo ritmo.
      const linhas = await sql(`
        with vendido as (
          select v.product_id, sum(v.quantidade) as vendido
            from (${ITENS_VENDIDOS}) v
           where v.date > $2::date - $3::int and v.date <= $2::date
           group by 1)
        select coalesce(p.sku, '') as sku, p.name as produto, vd.vendido,
               coalesce(p.stock_quantity, 0) as saldo
          from vendido vd
          join products p on p.id = vd.product_id
         where vd.vendido > 0
         order by p.name`, [STATUS_VENDIDO, f.hoje, f.dias]);
      return linhas
        .map((l) => {
          const vendido = n(l.vendido);
          const saldo = n(l.saldo);
          const media = vendido / f.dias;
          return {
            sku: l.sku, produto: l.produto, vendido, mediaDiaria: r3(media), saldo,
            cobertura: media > 0 ? Math.round((saldo / media) * 10) / 10 : null,
            comprar: Math.max(0, Math.ceil(r3(media * f.dias - saldo)))
          };
        })
        .sort((a, b) => b.comprar - a.comprar || a.produto.localeCompare(b.produto, 'pt-BR'));
    }
  },

  {
    key: 'inventario',
    grupo: 'estoque',
    titulo: 'Inventário',
    filtros: ['data', 'deposito'],
    colunas: [
      { campo: 'sku', rotulo: 'SKU', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'ncm', rotulo: 'NCM', tipo: 'texto' },
      { campo: 'unidade', rotulo: 'Unidade', tipo: 'texto' },
      { campo: 'saldo', rotulo: 'Saldo', tipo: 'quantidade' },
      { campo: 'custo', rotulo: 'Custo', tipo: 'moeda', semTotal: true },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }
    ],
    totais: ['saldo', 'valor'],
    async executar({ sql, f }) {
      // O saldo é o do razão NA DATA (inclusive); o custo é o de hoje, porque
      // o custo não tem histórico.
      const linhas = await sql(`
        with saldos as (
          select m.product_id, sum(${SALDO}) as saldo, max(m.product_name) as nome_no_razao
            from stock_movements m
           where m.date <= $1::date and ($2 = '' or m.deposit_id = $2)
           group by 1
          having sum(${SALDO}) <> 0)
        select coalesce(p.sku, '') as sku, coalesce(p.name, s.nome_no_razao, '') as produto,
               coalesce(btrim(p.ncm), '') as ncm, coalesce(p.unidade_comercial, '') as unidade,
               s.saldo, coalesce(p.cost_price, 0) as custo
          from saldos s
          left join products p on p.id = s.product_id
         order by 2, 1`, [f.data, f.depositoId]);
      return linhas.map((l) => ({
        sku: l.sku, produto: l.produto, ncm: l.ncm, unidade: l.unidade,
        saldo: n(l.saldo), custo: n(l.custo), valor: r2(n(l.saldo) * n(l.custo))
      }));
    }
  },

  {
    key: 'composicao-de-produtos',
    grupo: 'estoque',
    titulo: 'Composição de Produtos',
    filtros: [],
    colunas: [
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'componente', rotulo: 'Componente', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'perda', rotulo: 'Perda %', tipo: 'percentual' },
      { campo: 'custoComponente', rotulo: 'Custo do componente', tipo: 'moeda', semTotal: true },
      { campo: 'custo', rotulo: 'Custo', tipo: 'moeda' }
    ],
    totais: ['custo'],
    async executar({ sql }) {
      const linhas = await sql(`
        select coalesce(p.name, b.product_id) as produto, coalesce(c.name, b.component_id) as componente,
               coalesce(b.quantity, 0) as quantidade, coalesce(b.loss_percent, 0) as perda,
               coalesce(c.cost_price, 0) as custo_componente
          from pcp_bom b
          left join products p on p.id = b.product_id
          left join products c on c.id = b.component_id
         order by 1, 2`);
      return linhas.map((l) => ({
        produto: l.produto, componente: l.componente, quantidade: n(l.quantidade), perda: n(l.perda),
        custoComponente: n(l.custo_componente),
        custo: r2(n(l.quantidade) * (1 + n(l.perda) / 100) * n(l.custo_componente))
      }));
    }
  },

  {
    key: 'contagens-de-estoque',
    grupo: 'estoque',
    titulo: 'Contagens de Estoque',
    filtros: ['periodo'],
    colunas: [
      { campo: 'contagem', rotulo: 'Contagem', tipo: 'texto' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'deposito', rotulo: 'Depósito', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'esperado', rotulo: 'Esperado', tipo: 'quantidade' },
      { campo: 'contado', rotulo: 'Contado', tipo: 'quantidade' },
      { campo: 'ajuste', rotulo: 'Ajuste', tipo: 'quantidade' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select c.code as contagem, c.date as data, ${nomeDoDeposito('d', 'c.deposit_id')} as deposito,
               c.status, coalesce(p.name, nullif(i.product_name, ''), '') as produto,
               i.expected_quantity as esperado, i.counted_quantity as contado, i.adjustment as ajuste
          from stock_counts c
          join stock_count_items i on i.count_id = c.id
          left join deposits d on d.id = c.deposit_id
          left join products p on p.id = i.product_id
         where ${noPeriodo('c.date', 1, 2)}
         order by c.date, c.code, 5`, [f.de, f.ate]);
      // Contado nulo é item ainda não contado — diferente de contado zero.
      return linhas.map((l) => ({
        contagem: l.contagem, data: l.data, deposito: l.deposito,
        situacao: SITUACOES_DA_CONTAGEM[l.status] || l.status || '', produto: l.produto,
        esperado: numeroOuNulo(l.esperado), contado: numeroOuNulo(l.contado), ajuste: numeroOuNulo(l.ajuste)
      }));
    }
  },

  {
    key: 'transferencias',
    grupo: 'estoque',
    titulo: 'Transferências entre Depósitos',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'texto' },
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { campo: 'origem', rotulo: 'Origem', tipo: 'texto' },
      { campo: 'destino', rotulo: 'Destino', tipo: 'texto' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'quantidade' },
      { campo: 'recebido', rotulo: 'Recebido', tipo: 'quantidade' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: ['quantidade', 'recebido'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select t.code as codigo, t.date as data, coalesce(p.name, t.product_id) as produto,
               ${nomeDoDeposito('dor', 't.origin_deposit_id')} as origem,
               ${nomeDoDeposito('dde', 't.destination_deposit_id')} as destino,
               t.quantity as quantidade, coalesce(t.received_quantity, 0) as recebido, t.status
          from stock_transfers t
          left join products p on p.id = t.product_id
          left join deposits dor on dor.id = t.origin_deposit_id
          left join deposits dde on dde.id = t.destination_deposit_id
         where ${noPeriodo('t.date', 1, 2)}
         order by t.date, t.code`, [f.de, f.ate]);
      // Mesmo vocabulário da tela de Transferências: enviada sem nada conferido
      // está em trânsito; com parte conferida, é parcial.
      return linhas.map((l) => {
        let situacao = 'Recebida';
        if (l.status === 'enviada') situacao = n(l.recebido) > 0 ? 'Parcial' : 'Em trânsito';
        return {
          codigo: l.codigo, data: l.data, produto: l.produto, origem: l.origem, destino: l.destino,
          quantidade: n(l.quantidade), recebido: n(l.recebido), situacao
        };
      });
    }
  }
];
