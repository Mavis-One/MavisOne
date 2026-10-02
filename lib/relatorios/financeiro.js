/**
 * RELATÓRIOS DO FINANCEIRO.
 *
 * Previsto é o lançamento pelo VENCIMENTO; realizado é a BAIXA
 * (financial_payments) pela data em que entrou ou saiu. Lançamento cancelado
 * não entra em nada. "Em aberto" é o valor menos o que já foi baixado, porque
 * o lançamento parcial conta como aberto só no que falta.
 */

const CANCELADO = "coalesce(e.status, '') not in ('cancelado', 'cancelled', 'canceled')";
const ABERTO = "e.status in ('pending', 'pendente', 'parcial')";
const PAGO_POR_LANCAMENTO = `left join (select entry_id, sum(amount) as pago from financial_payments group by entry_id) pg on pg.entry_id = e.id`;
const LIMITE_DE_CREDITO = `(case
  when coalesce(p.extra->>'creditLimit', '') ~ '^[0-9]{1,3}(\\.[0-9]{3})*,[0-9]+$' then replace(replace(p.extra->>'creditLimit', '.', ''), ',', '.')::numeric
  when coalesce(p.extra->>'creditLimit', '') ~ '^[0-9]+([.,][0-9]+)?$' then replace(p.extra->>'creditLimit', ',', '.')::numeric
  else 0 end)`;

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;

module.exports = [
  { key: 'sintese-financeira', grupo: 'financeiro', titulo: 'Síntese Financeira', especial: 'financeiro' },

  {
    key: 'fluxo-de-caixa',
    grupo: 'financeiro',
    titulo: 'Fluxo de Caixa',
    filtros: ['periodo', 'conta'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'dia', rotulo: 'Data', tipo: 'data' },
      { campo: 'aReceber', rotulo: 'A receber', tipo: 'moeda' },
      { campo: 'aPagar', rotulo: 'A pagar', tipo: 'moeda' },
      { campo: 'recebido', rotulo: 'Recebido', tipo: 'moeda' },
      { campo: 'pago', rotulo: 'Pago', tipo: 'moeda' },
      { campo: 'saldoDia', rotulo: 'Saldo do dia', tipo: 'moeda' },
      { campo: 'saldoAcumulado', rotulo: 'Saldo acumulado', tipo: 'moeda', semTotal: true }
    ],
    totais: ['aReceber', 'aPagar', 'recebido', 'pago', 'saldoDia'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        with previsto as (
          select e.due_date as dia,
                 sum(case when e.type = 'RECEITA' then e.amount else 0 end) as a_receber,
                 sum(case when e.type = 'DESPESA' then e.amount else 0 end) as a_pagar
            from financial_entries e
           where ($1 = '' or e.due_date >= $1::date) and ($2 = '' or e.due_date <= $2::date) and ${CANCELADO}
             and ($3 = '' or e.bank_account_id = $3)
           group by 1),
        realizado as (
          select p.date as dia,
                 sum(case when e.type = 'RECEITA' then p.amount else 0 end) as recebido,
                 sum(case when e.type = 'DESPESA' then p.amount else 0 end) as pago
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO}
             and ($3 = '' or coalesce(p.bank_account_id, e.bank_account_id) = $3)
           group by 1)
        select coalesce(previsto.dia, realizado.dia) as dia,
               coalesce(a_receber, 0) as a_receber, coalesce(a_pagar, 0) as a_pagar,
               coalesce(recebido, 0) as recebido, coalesce(pago, 0) as pago
          from previsto full join realizado on realizado.dia = previsto.dia
         order by 1`, [f.de, f.ate, f.contaId]);
      let acumulado = 0;
      return linhas.map((l) => {
        const saldoDia = r2(n(l.recebido) - n(l.pago));
        acumulado = r2(acumulado + saldoDia);
        return { dia: l.dia, aReceber: n(l.a_receber), aPagar: n(l.a_pagar), recebido: n(l.recebido), pago: n(l.pago), saldoDia, saldoAcumulado: acumulado };
      });
    }
  },

  {
    key: 'fluxo-mensal',
    grupo: 'financeiro',
    titulo: 'Fluxo Mensal',
    filtros: ['ano', 'conta'],
    colunas: [
      { campo: 'mes', rotulo: 'Mês', tipo: 'texto' },
      { campo: 'aReceber', rotulo: 'A receber', tipo: 'moeda' },
      { campo: 'aPagar', rotulo: 'A pagar', tipo: 'moeda' },
      { campo: 'recebido', rotulo: 'Recebido', tipo: 'moeda' },
      { campo: 'pago', rotulo: 'Pago', tipo: 'moeda' },
      { campo: 'resultado', rotulo: 'Resultado', tipo: 'moeda' }
    ],
    totais: ['aReceber', 'aPagar', 'recebido', 'pago', 'resultado'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        with previsto as (
          select extract(month from e.due_date)::int as mes,
                 sum(case when e.type = 'RECEITA' then e.amount else 0 end) as a_receber,
                 sum(case when e.type = 'DESPESA' then e.amount else 0 end) as a_pagar
            from financial_entries e
           where extract(year from e.due_date) = $1 and ${CANCELADO}
             and ($2 = '' or e.bank_account_id = $2)
           group by 1),
        realizado as (
          select extract(month from p.date)::int as mes,
                 sum(case when e.type = 'RECEITA' then p.amount else 0 end) as recebido,
                 sum(case when e.type = 'DESPESA' then p.amount else 0 end) as pago
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where extract(year from p.date) = $1 and ${CANCELADO}
             and ($2 = '' or coalesce(p.bank_account_id, e.bank_account_id) = $2)
           group by 1)
        select m.mes, coalesce(a_receber, 0) as a_receber, coalesce(a_pagar, 0) as a_pagar,
               coalesce(recebido, 0) as recebido, coalesce(pago, 0) as pago
          from generate_series(1, 12) as m(mes)
          left join previsto on previsto.mes = m.mes
          left join realizado on realizado.mes = m.mes
         order by m.mes`, [f.ano, f.contaId]);
      return linhas.map((l) => ({
        mes: `${MESES[l.mes - 1]}/${f.ano}`,
        aReceber: n(l.a_receber), aPagar: n(l.a_pagar), recebido: n(l.recebido), pago: n(l.pago),
        resultado: r2(n(l.recebido) - n(l.pago))
      }));
    }
  },

  {
    key: 'extrato-bancario',
    grupo: 'financeiro',
    titulo: 'Extrato Bancário',
    filtros: ['periodo', 'conta'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'conta', rotulo: 'Conta', tipo: 'texto' },
      { campo: 'codigo', rotulo: 'Lançamento', tipo: 'inteiro', semTotal: true },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { campo: 'pessoa', rotulo: 'Cliente/Fornecedor', tipo: 'texto' },
      { campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
      { campo: 'entrada', rotulo: 'Entrada', tipo: 'moeda' },
      { campo: 'saida', rotulo: 'Saída', tipo: 'moeda' }
    ],
    totais: ['entrada', 'saida'],
    async executar({ sql, f }) {
      const movimentos = await sql(`
        select p.date as data, coalesce(b.name, '') as conta, e.code as codigo,
               coalesce(e.description, '') as descricao, coalesce(e.client_supplier_name, '') as pessoa,
               coalesce(c.name, '') as categoria,
               case when e.type = 'RECEITA' then p.amount else 0 end as entrada,
               case when e.type = 'DESPESA' then p.amount else 0 end as saida
          from financial_payments p
          join financial_entries e on e.id = p.entry_id
          left join bank_accounts b on b.id = coalesce(p.bank_account_id, e.bank_account_id)
          left join financial_categories c on c.id = e.category_id
         where ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO}
           and ($3 = '' or coalesce(p.bank_account_id, e.bank_account_id) = $3)
         order by p.date, p.created_at`, [f.de, f.ate, f.contaId]);
      const linhas = movimentos.map((m) => ({ ...m, entrada: n(m.entrada), saida: n(m.saida) }));
      if (!f.contaId) return linhas;

      // COM UMA CONTA ESCOLHIDA, O SALDO. Saldo inicial da conta mais tudo o
      // que foi baixado nela antes do período; sem conta, somar contas
      // diferentes num saldo só não diria nada.
      const [anterior] = await sql(`
        select coalesce(b.initial_balance, 0)
               + coalesce((select sum(case when e.type = 'RECEITA' then p.amount else -p.amount end)
                             from financial_payments p join financial_entries e on e.id = p.entry_id
                            where $2 <> '' and p.date < $2::date and ${CANCELADO}
                              and coalesce(p.bank_account_id, e.bank_account_id) = $1), 0) as saldo
          from bank_accounts b where b.id = $1`, [f.contaId, f.de]);
      let saldo = n(anterior && anterior.saldo);
      return {
        colunas: [...module.exports.find((r) => r.key === 'extrato-bancario').colunas,
          { campo: 'saldo', rotulo: 'Saldo', tipo: 'moeda', semTotal: true }],
        linhas: linhas.map((l) => {
          saldo = r2(saldo + l.entrada - l.saida);
          return { ...l, saldo };
        })
      };
    }
  },

  {
    key: 'consolidado-por-categoria',
    grupo: 'financeiro',
    titulo: 'Consolidado por Categoria',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
      { campo: 'receitaPrevista', rotulo: 'Receita prevista', tipo: 'moeda' },
      { campo: 'receitaRealizada', rotulo: 'Receita realizada', tipo: 'moeda' },
      { campo: 'despesaPrevista', rotulo: 'Despesa prevista', tipo: 'moeda' },
      { campo: 'despesaRealizada', rotulo: 'Despesa realizada', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        with valores as (
          select e.category_id,
                 case when e.type = 'RECEITA' then e.amount else 0 end as rp, 0 as rr,
                 case when e.type = 'DESPESA' then e.amount else 0 end as dp, 0 as dr
            from financial_entries e
           where ($1 = '' or e.due_date >= $1::date) and ($2 = '' or e.due_date <= $2::date) and ${CANCELADO}
          union all
          select e.category_id, 0, case when e.type = 'RECEITA' then p.amount else 0 end,
                 0, case when e.type = 'DESPESA' then p.amount else 0 end
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO})
        select coalesce(c.name, 'Sem categoria') as categoria,
               sum(rp) as rp, sum(rr) as rr, sum(dp) as dp, sum(dr) as dr
          from valores v
          left join financial_categories c on c.id = v.category_id
         group by 1
         order by 1`, [f.de, f.ate]);
      return linhas.map((l) => ({
        categoria: l.categoria, receitaPrevista: n(l.rp), receitaRealizada: n(l.rr), despesaPrevista: n(l.dp), despesaRealizada: n(l.dr)
      }));
    }
  },

  {
    key: 'centro-de-custos',
    grupo: 'financeiro',
    titulo: 'Centro de Custos',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'centro', rotulo: 'Centro de custo', tipo: 'texto' },
      { campo: 'receitas', rotulo: 'Receitas', tipo: 'moeda' },
      { campo: 'despesas', rotulo: 'Despesas', tipo: 'moeda' },
      { campo: 'resultado', rotulo: 'Resultado', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(cc.name, 'Sem centro de custo') as centro,
               sum(case when e.type = 'RECEITA' then p.amount else 0 end) as receitas,
               sum(case when e.type = 'DESPESA' then p.amount else 0 end) as despesas
          from financial_payments p
          join financial_entries e on e.id = p.entry_id
          left join cost_centers cc on cc.id = e.cost_center_id
         where ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO}
         group by 1
         order by 1`, [f.de, f.ate]);
      return linhas.map((l) => ({ centro: l.centro, receitas: n(l.receitas), despesas: n(l.despesas), resultado: r2(n(l.receitas) - n(l.despesas)) }));
    }
  },

  {
    key: 'lancamentos-em-atraso',
    grupo: 'financeiro',
    titulo: 'Lançamentos em Atraso',
    filtros: ['periodo'],
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'inteiro', semTotal: true },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
      { campo: 'diasAtraso', rotulo: 'Dias de atraso', tipo: 'inteiro', semTotal: true },
      { campo: 'pessoa', rotulo: 'Cliente/Fornecedor', tipo: 'texto' },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'emAberto', rotulo: 'Em aberto', tipo: 'moeda' }
    ],
    totais: ['valor', 'emAberto'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select e.code as codigo, case when e.type = 'RECEITA' then 'A receber' else 'A pagar' end as tipo,
               e.due_date as vencimento, ($1::date - e.due_date)::int as dias,
               coalesce(e.client_supplier_name, '') as pessoa, coalesce(e.description, '') as descricao,
               e.amount as valor, greatest(e.amount - coalesce(pg.pago, 0), 0) as em_aberto
          from financial_entries e ${PAGO_POR_LANCAMENTO}
         where ${ABERTO} and e.due_date < $1
           and ($2 = '' or e.due_date >= $2::date) and ($3 = '' or e.due_date <= $3::date)
         order by e.due_date, e.code`, [f.hoje, f.de, f.ate]);
      return linhas.map((l) => ({
        codigo: l.codigo, tipo: l.tipo, vencimento: l.vencimento, diasAtraso: l.dias,
        pessoa: l.pessoa, descricao: l.descricao, valor: n(l.valor), emAberto: n(l.em_aberto)
      }));
    }
  },

  {
    key: 'inadimplentes',
    grupo: 'financeiro',
    titulo: 'Inadimplentes',
    filtros: [],
    colunas: [
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'documento', rotulo: 'CPF/CNPJ', tipo: 'texto' },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      { campo: 'titulos', rotulo: 'Títulos', tipo: 'inteiro' },
      { campo: 'maisAntigo', rotulo: 'Vencimento mais antigo', tipo: 'data' },
      { campo: 'diasAtraso', rotulo: 'Maior atraso (dias)', tipo: 'inteiro', semTotal: true },
      { campo: 'emAberto', rotulo: 'Em aberto', tipo: 'moeda' }
    ],
    totais: ['titulos', 'emAberto'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(pe.name, e.client_supplier_name, 'Sem cliente') as cliente,
               coalesce(pe.document, '') as documento, coalesce(pe.phone, '') as telefone,
               count(*)::int as titulos, min(e.due_date) as mais_antigo,
               ($1::date - min(e.due_date))::int as dias,
               sum(greatest(e.amount - coalesce(pg.pago, 0), 0)) as em_aberto
          from financial_entries e ${PAGO_POR_LANCAMENTO}
          left join people pe on pe.id = e.client_supplier_id
         where e.type = 'RECEITA' and ${ABERTO} and e.due_date < $1
         group by 1, 2, 3
         order by em_aberto desc`, [f.hoje]);
      return linhas.map((l) => ({
        cliente: l.cliente, documento: l.documento, telefone: l.telefone, titulos: l.titulos,
        maisAntigo: l.mais_antigo, diasAtraso: l.dias, emAberto: n(l.em_aberto)
      }));
    }
  },

  {
    key: 'lancamentos-dos-vendedores',
    grupo: 'financeiro',
    titulo: 'Lançamentos dos Vendedores',
    filtros: ['periodo', 'vendedor'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'titulos', rotulo: 'Títulos', tipo: 'inteiro' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'recebido', rotulo: 'Recebido', tipo: 'moeda' },
      { campo: 'emAberto', rotulo: 'Em aberto', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar({ sql, f, vendedores }) {
      const linhas = await sql(`
        select coalesce(v.name, 'Sem vendedor') as vendedor, count(*)::int as titulos,
               sum(e.amount) as valor, sum(coalesce(pg.pago, 0)) as recebido,
               sum(case when ${ABERTO} then greatest(e.amount - coalesce(pg.pago, 0), 0) else 0 end) as em_aberto
          from financial_entries e ${PAGO_POR_LANCAMENTO}
          join orders o on o.id = e.reference_id
          left join people v on v.id = o.seller_id
         where e.type = 'RECEITA' and ${CANCELADO} and ($1 = '' or e.due_date >= $1::date) and ($2 = '' or e.due_date <= $2::date)
           and ($3::text[] is null or o.seller_id = any($3::text[]))
         group by 1
         order by valor desc`, [f.de, f.ate, vendedores]);
      return linhas.map((l) => ({ vendedor: l.vendedor, titulos: l.titulos, valor: n(l.valor), recebido: n(l.recebido), emAberto: n(l.em_aberto) }));
    }
  },

  {
    key: 'limite-de-credito',
    grupo: 'financeiro',
    titulo: 'Limite de Crédito',
    filtros: [],
    colunas: [
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'documento', rotulo: 'CPF/CNPJ', tipo: 'texto' },
      { campo: 'limite', rotulo: 'Limite', tipo: 'moeda' },
      { campo: 'emAberto', rotulo: 'Em aberto', tipo: 'moeda' },
      { campo: 'disponivel', rotulo: 'Disponível', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar({ sql }) {
      const linhas = await sql(`
        select p.name as cliente, coalesce(p.document, '') as documento, ${LIMITE_DE_CREDITO} as limite,
               coalesce((select sum(greatest(e.amount - coalesce(pg.pago, 0), 0))
                           from financial_entries e ${PAGO_POR_LANCAMENTO}
                          where e.client_supplier_id = p.id and e.type = 'RECEITA' and ${ABERTO}), 0) as em_aberto
          from people p
         where ${LIMITE_DE_CREDITO} > 0
         order by p.name`);
      return linhas.map((l) => ({
        cliente: l.cliente, documento: l.documento, limite: n(l.limite), emAberto: n(l.em_aberto),
        disponivel: r2(n(l.limite) - n(l.em_aberto))
      }));
    }
  },

  {
    key: 'valores-credenciadoras',
    grupo: 'financeiro',
    titulo: 'Valores das Credenciadoras',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'credenciadora', rotulo: 'Credenciadora', tipo: 'texto' },
      { campo: 'bandeira', rotulo: 'Bandeira', tipo: 'texto' },
      { campo: 'transacoes', rotulo: 'Transações', tipo: 'inteiro' },
      { campo: 'bruto', rotulo: 'Valor bruto', tipo: 'moeda' },
      { campo: 'taxa', rotulo: 'Taxa', tipo: 'moeda' },
      { campo: 'liquido', rotulo: 'Valor líquido', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(nullif(e.card_acquirer_name, ''), 'Sem credenciadora') as credenciadora,
               coalesce(nullif(e.card_brand, ''), '—') as bandeira, count(*)::int as transacoes,
               sum(e.amount) as bruto, sum(coalesce(e.fee_amount, 0)) as taxa,
               sum(coalesce(e.net_amount, e.amount - coalesce(e.fee_amount, 0))) as liquido
          from financial_entries e
         where (e.card_acquirer_id is not null or coalesce(e.card_acquirer_name, '') <> '')
           and ${CANCELADO} and ($1 = '' or e.date >= $1::date) and ($2 = '' or e.date <= $2::date)
         group by 1, 2
         order by 1, 2`, [f.de, f.ate]);
      return linhas.map((l) => ({ credenciadora: l.credenciadora, bandeira: l.bandeira, transacoes: l.transacoes, bruto: n(l.bruto), taxa: n(l.taxa), liquido: n(l.liquido) }));
    }
  },

  {
    key: 'dre-do-periodo',
    grupo: 'financeiro',
    titulo: 'DRE do Período (caixa)',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'sobreReceita', rotulo: '% da receita', tipo: 'percentual' }
    ],
    totais: ['valor'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select e.type as tipo, coalesce(c.name, 'Sem categoria') as categoria,
               sum(case when e.type = 'RECEITA' then p.amount else -p.amount end) as valor
          from financial_payments p
          join financial_entries e on e.id = p.entry_id
          left join financial_categories c on c.id = e.category_id
         where ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO}
         group by 1, 2
         order by e.type desc, abs(sum(p.amount)) desc`, [f.de, f.ate]);
      const receita = linhas.filter((l) => l.tipo === 'RECEITA').reduce((s, l) => s + n(l.valor), 0);
      return linhas.map((l) => ({
        tipo: l.tipo === 'RECEITA' ? 'Receita' : 'Despesa',
        categoria: l.categoria,
        valor: n(l.valor),
        sobreReceita: receita ? r2((n(l.valor) / receita) * 100) : null
      }));
    }
  },

  {
    key: 'dre-anual',
    grupo: 'financeiro',
    titulo: 'DRE Anual (caixa)',
    filtros: ['ano'],
    colunas: [{ campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' }],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select e.type as tipo, coalesce(c.name, 'Sem categoria') as categoria,
               extract(month from p.date)::int as mes,
               sum(case when e.type = 'RECEITA' then p.amount else -p.amount end) as valor
          from financial_payments p
          join financial_entries e on e.id = p.entry_id
          left join financial_categories c on c.id = e.category_id
         where extract(year from p.date) = $1 and ${CANCELADO}
         group by 1, 2, 3`, [f.ano]);
      const porCategoria = new Map();
      for (const l of linhas) {
        const chave = `${l.tipo}|${l.categoria}`;
        if (!porCategoria.has(chave)) {
          const base = { categoria: `${l.tipo === 'RECEITA' ? '(+)' : '(−)'} ${l.categoria}`, tipo: l.tipo, total: 0 };
          MESES.forEach((_, i) => { base[`m${i + 1}`] = 0; });
          porCategoria.set(chave, base);
        }
        const linha = porCategoria.get(chave);
        linha[`m${l.mes}`] = r2(linha[`m${l.mes}`] + n(l.valor));
        linha.total = r2(linha.total + n(l.valor));
      }
      const ordenadas = [...porCategoria.values()].sort((a, b) => (a.tipo === b.tipo ? Math.abs(b.total) - Math.abs(a.total) : (a.tipo === 'RECEITA' ? -1 : 1)));
      return {
        colunas: [
          { campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
          ...MESES.map((m, i) => ({ campo: `m${i + 1}`, rotulo: m, tipo: 'moeda' })),
          { campo: 'total', rotulo: `Total ${f.ano}`, tipo: 'moeda' }
        ],
        linhas: ordenadas.map(({ tipo, ...resto }) => resto)
      };
    }
  }
];
