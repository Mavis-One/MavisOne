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
const dataBr = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const mesAno = (iso) => `${MESES[Number(String(iso).slice(5, 7)) - 1]}/${String(iso).slice(0, 4)}`;
/** Variação em %, contra o valor anterior; sem anterior, não há variação. */
const variacao = (atual, anterior) => (n(anterior) ? r2(((n(atual) - n(anterior)) / Math.abs(n(anterior))) * 100) : null);

/**
 * A BAIXA (`p`) na conta `$c`: receita entra, despesa sai. A transferência só
 * mexe quando há conta escolhida — sai da origem e entra no destino; sem conta
 * ela é dinheiro trocando de bolso, e o saldo da empresa não muda.
 */
const MOVIMENTO_NA_CONTA = (c) => `(case when e.type = 'RECEITA' then p.amount
  when e.type = 'DESPESA' then -p.amount
  when e.type = 'TRANSFERENCIA' and $${c} <> '' and e.target_bank_account_id = $${c} then p.amount
  when e.type = 'TRANSFERENCIA' and $${c} <> '' then -p.amount
  else 0 end)`;
const NA_CONTA = (c) => `($${c} = '' or coalesce(p.bank_account_id, e.bank_account_id) = $${c}
  or (e.type = 'TRANSFERENCIA' and e.target_bank_account_id = $${c}))`;

/**
 * O saldo ANTES do dia `$2`: o saldo inicial das contas mais tudo o que foi
 * baixado nelas até a véspera. `$1` é a conta ('' = todas). Sem dia, só o
 * saldo inicial — o relatório então começa do primeiro movimento.
 */
const SALDO_ANTERIOR = `
  select coalesce((select sum(coalesce(b.initial_balance, 0)) from bank_accounts b where ($1 = '' or b.id = $1)), 0)
       + coalesce((select sum(${MOVIMENTO_NA_CONTA(1)})
                     from financial_payments p join financial_entries e on e.id = p.entry_id
                    where $2 <> '' and p.date < $2::date and ${CANCELADO} and ${NA_CONTA(1)}), 0) as saldo`;

/**
 * O período com que o DRE compara. Começando no dia 1, o mês: setembro contra
 * agosto, e 1 a 2 de outubro contra 1 a 2 de setembro. Mais de um mês, o mesmo
 * recorte do ano anterior (o trimestre contra o trimestre). Fora isso, o mesmo
 * número de dias logo antes.
 */
function periodoAnterior(de, ate) {
  const iso = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const ultimoDia = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
  const [a1, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  if (d1 === 1) {
    const meses = (a2 - a1) * 12 + (m2 - m1) + 1;
    const fimDoMes = d2 === ultimoDia(a2, m2);
    if (meses > 1) {
      return [iso(a1 - 1, m1, 1), iso(a2 - 1, m2, fimDoMes ? ultimoDia(a2 - 1, m2) : Math.min(d2, ultimoDia(a2 - 1, m2)))];
    }
    const [ap, mp] = m1 === 1 ? [a1 - 1, 12] : [a1, m1 - 1];
    return [iso(ap, mp, 1), iso(ap, mp, fimDoMes ? ultimoDia(ap, mp) : Math.min(d2, ultimoDia(ap, mp)))];
  }
  const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86400000) + 1;
  return [new Date(Date.parse(de) - dias * 86400000).toISOString().slice(0, 10), new Date(Date.parse(de) - 86400000).toISOString().slice(0, 10)];
}

async function saldoAnterior(sql, contaId, dia) {
  const [linha] = await sql(SALDO_ANTERIOR, [contaId || '', dia || '']);
  return r2(linha && linha.saldo);
}

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
                 sum(case when e.type = 'DESPESA' then p.amount else 0 end) as pago,
                 sum(${MOVIMENTO_NA_CONTA(3)}) as movimento
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO}
             and ${NA_CONTA(3)}
           group by 1)
        select coalesce(previsto.dia, realizado.dia) as dia,
               coalesce(a_receber, 0) as a_receber, coalesce(a_pagar, 0) as a_pagar,
               coalesce(recebido, 0) as recebido, coalesce(pago, 0) as pago, coalesce(movimento, 0) as movimento
          from previsto full join realizado on realizado.dia = previsto.dia
         order by 1`, [f.de, f.ate, f.contaId]);
      // O ACUMULADO PARTE DO SALDO QUE AS CONTAS TINHAM ANTES DO PERÍODO. Partir
      // do zero dizia que a empresa começou o mês sem dinheiro nenhum.
      let acumulado = await saldoAnterior(sql, f.contaId, f.de);
      return linhas.map((l) => {
        // O saldo do dia é o que entrou menos o que saiu — com a transferência
        // entre contas, quando há conta escolhida.
        const saldoDia = r2(l.movimento);
        acumulado = r2(acumulado + saldoDia);
        return { dia: l.dia, aReceber: n(l.a_receber), aPagar: n(l.a_pagar), recebido: n(l.recebido), pago: n(l.pago), saldoDia, saldoAcumulado: acumulado };
      });
    }
  },

  {
    key: 'fluxo-sintetico-por-dia',
    grupo: 'financeiro',
    titulo: 'Fluxo Sintético por Dia',
    filtros: ['data', 'dias', 'conta'],
    diasPadrao: 90,
    colunas: [
      { campo: 'dia', rotulo: 'Data', tipo: 'texto' },
      { campo: 'entrada', rotulo: 'Entrada do dia', tipo: 'moeda' },
      { campo: 'entradaAcumulada', rotulo: 'Entrada acumulada', tipo: 'moeda', semTotal: true },
      { campo: 'saida', rotulo: 'Saída do dia', tipo: 'moeda' },
      { campo: 'saidaAcumulada', rotulo: 'Saída acumulada', tipo: 'moeda', semTotal: true },
      { campo: 'saldo', rotulo: 'Saldo projetado', tipo: 'moeda', semTotal: true }
    ],
    totais: ['entrada', 'saida'],
    // A projeção: o saldo das contas na data, mais o que ainda falta receber,
    // menos o que ainda falta pagar, dia a dia pelo vencimento. Só o que está
    // EM ABERTO entra — o que já foi baixado está no saldo das contas, e
    // somá-lo de novo contaria o mesmo dinheiro duas vezes.
    //
    // O Viper projetava até 2046 (os recorrentes sem fim) e mostrava valores
    // sem arredondar; aqui a janela é a de `dias`, e tudo sai em centavos.
    async executar({ sql, f }) {
      const VALOR = 'greatest(e.amount - coalesce(pg.pago, 0), 0)';
      const [abertos, saldoInicial] = await Promise.all([
        sql(`
          select case when e.due_date < $1::date then null else e.due_date end as dia,
                 sum(case when e.type = 'RECEITA' then ${VALOR} else 0 end) as entrada,
                 sum(case when e.type = 'DESPESA' then ${VALOR} else 0 end) as saida
            from financial_entries e ${PAGO_POR_LANCAMENTO}
           where ${ABERTO} and e.type in ('RECEITA', 'DESPESA')
             and e.due_date <= $1::date + $2::int
             and ($3 = '' or e.bank_account_id = $3)
           group by 1
           order by 1 nulls first`, [f.data, f.dias, f.contaId]),
        // O saldo é o do FIM do dia: a baixa de hoje já está nele, e o que
        // venceu hoje e ainda está aberto entra na linha do dia.
        saldoAnterior(sql, f.contaId, new Date(Date.parse(f.data) + 86400000).toISOString().slice(0, 10))
      ]);
      let entradaAcumulada = 0;
      let saidaAcumulada = 0;
      let saldo = saldoInicial;
      const linhas = [{ dia: `Saldo das contas em ${dataBr(f.data)}`, entrada: null, entradaAcumulada: null, saida: null, saidaAcumulada: null, saldo }];
      for (const l of abertos) {
        const entrada = r2(l.entrada);
        const saida = r2(l.saida);
        if (!entrada && !saida) continue;
        entradaAcumulada = r2(entradaAcumulada + entrada);
        saidaAcumulada = r2(saidaAcumulada + saida);
        saldo = r2(saldo + entrada - saida);
        // O vencido em aberto vem numa linha só, antes do primeiro dia: é o que
        // já devia ter entrado ou saído e ainda está pendurado.
        linhas.push({ dia: l.dia ? dataBr(l.dia) : `Vencido antes de ${dataBr(f.data)}`, entrada, entradaAcumulada, saida, saidaAcumulada, saldo });
      }
      return linhas;
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
      { campo: 'codigo', rotulo: 'Lançamento', tipo: 'codigo' },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { campo: 'pessoa', rotulo: 'Cliente/Fornecedor', tipo: 'texto' },
      { campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
      { campo: 'centroDeCusto', rotulo: 'Centro de custo', tipo: 'texto' },
      { campo: 'documento', rotulo: 'Documento', tipo: 'texto' },
      { campo: 'entrada', rotulo: 'Entrada', tipo: 'moeda' },
      { campo: 'saida', rotulo: 'Saída', tipo: 'moeda' }
    ],
    totais: ['entrada', 'saida'],
    async executar({ sql, f }) {
      // A transferência aparece nas DUAS pontas: saída na conta de origem e
      // entrada na de destino. Sem conta escolhida, as duas linhas se anulam,
      // e o total continua sendo o que a empresa recebeu e pagou.
      const movimentos = await sql(`
        with baixas as (
          select p.date, p.created_at, e.code, e.type, e.description, e.client_supplier_name, e.category_id,
                 e.cost_center_id, e.document, coalesce(p.bank_account_id, e.bank_account_id) as conta_id,
                 case when e.type = 'RECEITA' then p.amount else 0 end as entrada,
                 case when e.type in ('DESPESA', 'TRANSFERENCIA') then p.amount else 0 end as saida
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO}
          union all
          select p.date, p.created_at, e.code, e.type, e.description, e.client_supplier_name, e.category_id,
                 e.cost_center_id, e.document, e.target_bank_account_id, p.amount, 0
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where e.type = 'TRANSFERENCIA' and coalesce(e.target_bank_account_id, '') <> ''
             and ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO})
        select x.date as data, coalesce(b.name, '') as conta, x.code as codigo,
               coalesce(x.description, '') as descricao, coalesce(x.client_supplier_name, '') as pessoa,
               coalesce(c.name, case when x.type = 'TRANSFERENCIA' then 'Transferência' else '' end) as categoria,
               coalesce(cc.name, '') as centro, coalesce(x.document, '') as documento,
               x.entrada, x.saida
          from baixas x
          left join bank_accounts b on b.id = x.conta_id
          left join financial_categories c on c.id = x.category_id
          left join cost_centers cc on cc.id = x.cost_center_id
         where ($3 = '' or x.conta_id = $3)
         order by x.date, x.created_at`, [f.de, f.ate, f.contaId]);
      const linhas = movimentos.map((m) => ({
        data: m.data, conta: m.conta, codigo: m.codigo, descricao: m.descricao, pessoa: m.pessoa, categoria: m.categoria,
        centroDeCusto: m.centro, documento: m.documento, entrada: n(m.entrada), saida: n(m.saida)
      }));
      if (!f.contaId) return linhas;

      // COM UMA CONTA ESCOLHIDA, O SALDO. Saldo inicial da conta mais tudo o
      // que foi baixado nela antes do período; sem conta, somar contas
      // diferentes num saldo só não diria nada.
      let saldo = await saldoAnterior(sql, f.contaId, f.de);
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
    key: 'consolidado-por-periodo',
    grupo: 'financeiro',
    titulo: 'Consolidado por Período',
    filtros: ['periodo'],
    periodoPadrao: '12meses',
    escolhas: [{ campo: 'valor', rotulo: 'Valor', itens: [['previsto', 'Previsto (vencimento)'], ['realizado', 'Realizado (baixas)']] }],
    colunas: [
      { campo: 'mes', rotulo: 'Mês', tipo: 'texto' },
      { campo: 'receitas', rotulo: 'Receitas', tipo: 'moeda' },
      { campo: 'variacaoReceitas', rotulo: 'Receitas x mês anterior', tipo: 'percentual' },
      { campo: 'despesas', rotulo: 'Despesas', tipo: 'moeda' },
      { campo: 'variacaoDespesas', rotulo: 'Despesas x mês anterior', tipo: 'percentual' },
      { campo: 'resultado', rotulo: 'Resultado', tipo: 'moeda' },
      { campo: 'variacaoResultado', rotulo: 'Resultado x mês anterior', tipo: 'percentual' }
    ],
    totais: 'numericas',
    // Um mês por linha, todos os meses do período: o mês sem movimento sai
    // zerado, e não some. O Viper ignorava o ano pedido e devolvia 2023.
    async executar({ sql, f }) {
      const ate = f.ate || f.hoje;
      const de = f.de || `${ate.slice(0, 4)}-01-01`;
      const linhas = await sql(`
        with meses as (
          select generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), interval '1 month')::date as mes),
        valores as (
          select date_trunc('month', e.due_date)::date as mes,
                 case when e.type = 'RECEITA' then e.amount else 0 end as receita,
                 case when e.type = 'DESPESA' then e.amount else 0 end as despesa
            from financial_entries e
           where $3 = 'previsto' and e.due_date between $1::date and $2::date and ${CANCELADO}
          union all
          select date_trunc('month', p.date)::date,
                 case when e.type = 'RECEITA' then p.amount else 0 end,
                 case when e.type = 'DESPESA' then p.amount else 0 end
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where $3 = 'realizado' and p.date between $1::date and $2::date and ${CANCELADO})
        select m.mes, coalesce(sum(v.receita), 0) as receitas, coalesce(sum(v.despesa), 0) as despesas
          from meses m
          left join valores v on v.mes = m.mes
         group by m.mes
         order by m.mes`, [de, ate, f.valor]);
      let anterior = null;
      return linhas.map((l) => {
        const atual = { receitas: n(l.receitas), despesas: n(l.despesas), resultado: r2(n(l.receitas) - n(l.despesas)) };
        const linha = {
          mes: mesAno(l.mes),
          receitas: atual.receitas, variacaoReceitas: anterior ? variacao(atual.receitas, anterior.receitas) : null,
          despesas: atual.despesas, variacaoDespesas: anterior ? variacao(atual.despesas, anterior.despesas) : null,
          resultado: atual.resultado, variacaoResultado: anterior ? variacao(atual.resultado, anterior.resultado) : null
        };
        anterior = atual;
        return linha;
      });
    }
  },

  {
    key: 'centro-de-custos',
    grupo: 'financeiro',
    titulo: 'Centro de Custos',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    escolhas: [{ campo: 'valor', rotulo: 'Valor', itens: [['realizado', 'Realizado (baixas)'], ['previsto', 'Previsto (vencimento)']] }],
    colunas: [
      { campo: 'centro', rotulo: 'Centro de custo', tipo: 'texto' },
      { campo: 'receitas', rotulo: 'Receitas', tipo: 'moeda' },
      { campo: 'despesas', rotulo: 'Despesas', tipo: 'moeda' },
      { campo: 'resultado', rotulo: 'Resultado', tipo: 'moeda' },
      { campo: 'participacao', rotulo: '% das despesas', tipo: 'percentual' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        with valores as (
          select e.cost_center_id,
                 case when e.type = 'RECEITA' then p.amount else 0 end as receita,
                 case when e.type = 'DESPESA' then p.amount else 0 end as despesa
            from financial_payments p join financial_entries e on e.id = p.entry_id
           where $3 = 'realizado' and ($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date) and ${CANCELADO}
          union all
          select e.cost_center_id,
                 case when e.type = 'RECEITA' then e.amount else 0 end,
                 case when e.type = 'DESPESA' then e.amount else 0 end
            from financial_entries e
           where $3 = 'previsto' and ($1 = '' or e.due_date >= $1::date) and ($2 = '' or e.due_date <= $2::date) and ${CANCELADO})
        select coalesce(cc.name, 'Sem centro de custo') as centro, sum(v.receita) as receitas, sum(v.despesa) as despesas
          from valores v
          left join cost_centers cc on cc.id = v.cost_center_id
         group by 1
         order by sum(v.despesa) desc, 1`, [f.de, f.ate, f.valor]);
      const totalDespesas = linhas.reduce((s, l) => s + n(l.despesas), 0);
      return linhas.map((l) => ({
        centro: l.centro, receitas: n(l.receitas), despesas: n(l.despesas), resultado: r2(n(l.receitas) - n(l.despesas)),
        participacao: totalDespesas ? r2((n(l.despesas) / totalDespesas) * 100) : null
      }));
    }
  },

  {
    key: 'lancamentos-em-atraso',
    grupo: 'financeiro',
    titulo: 'Lançamentos em Atraso',
    filtros: ['periodo'],
    escolhas: [{ campo: 'tipo', rotulo: 'Tipo', itens: [['todos', 'A receber e a pagar'], ['RECEITA', 'Só a receber'], ['DESPESA', 'Só a pagar']] }],
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'codigo' },
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
         where ${ABERTO} and e.due_date < $1 and e.type in ('RECEITA', 'DESPESA')
           and ($4 = 'todos' or e.type = $4)
           and ($2 = '' or e.due_date >= $2::date) and ($3 = '' or e.due_date <= $3::date)
         order by e.due_date, e.code`, [f.hoje, f.de, f.ate, f.tipo]);
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
    filtros: ['periodo'],
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
    // O período, quando vem, recorta pelo VENCIMENTO (quem deve desde quando);
    // sem período, entra toda dívida vencida.
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
           and ($2 = '' or e.due_date >= $2::date) and ($3 = '' or e.due_date <= $3::date)
         group by 1, 2, 3
         order by em_aberto desc`, [f.hoje, f.de, f.ate]);
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
    escolhas: [
      { campo: 'visao', rotulo: 'Ver', itens: [['resumo', 'Resumo por vendedor'], ['lancamentos', 'Um lançamento por linha']] },
      { campo: 'situacao', rotulo: 'Situação', itens: [['todas', 'Todas'], ['abertos', 'Em aberto'], ['vencidos', 'Vencidos'], ['quitados', 'Quitados']] }
    ],
    colunas: [
      { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
      { campo: 'titulos', rotulo: 'Títulos', tipo: 'inteiro' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'recebido', rotulo: 'Recebido', tipo: 'moeda' },
      { campo: 'emAberto', rotulo: 'Em aberto', tipo: 'moeda' }
    ],
    totais: 'numericas',
    // O vendedor do lançamento é o do PEDIDO que o gerou (reference_id), pelo
    // vencimento. A comissão do Viper fica de fora: comissão está fora do
    // escopo deste sistema.
    async executar({ sql, f, vendedores }) {
      const linhas = await sql(`
        select e.code as codigo, coalesce(v.name, 'Sem vendedor') as vendedor, o.code as pedido,
               coalesce(e.client_supplier_name, '') as cliente, o.date as data_venda, e.due_date as vencimento,
               e.status, e.amount as valor, coalesce(pg.pago, 0) as recebido,
               case when ${ABERTO} then greatest(e.amount - coalesce(pg.pago, 0), 0) else 0 end as em_aberto
          from financial_entries e ${PAGO_POR_LANCAMENTO}
          join orders o on o.id = e.reference_id
          left join people v on v.id = o.seller_id
         where e.type = 'RECEITA' and ${CANCELADO} and ($1 = '' or e.due_date >= $1::date) and ($2 = '' or e.due_date <= $2::date)
           and ($3::text[] is null or o.seller_id = any($3::text[]))
           and ($4 = 'todas'
             or ($4 = 'abertos' and ${ABERTO})
             or ($4 = 'vencidos' and ${ABERTO} and e.due_date < $5::date)
             or ($4 = 'quitados' and e.status = 'paid'))
         order by e.due_date, e.code`, [f.de, f.ate, vendedores, f.situacao, f.hoje]);
      if (f.visao === 'lancamentos') {
        return {
          colunas: [
            { campo: 'codigo', rotulo: 'Lançamento', tipo: 'codigo' },
            { campo: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' },
            { campo: 'pedido', rotulo: 'Pedido', tipo: 'codigo' },
            { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
            { campo: 'dataVenda', rotulo: 'Data da venda', tipo: 'data' },
            { campo: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
            { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
            { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
            { campo: 'recebido', rotulo: 'Recebido', tipo: 'moeda' },
            { campo: 'emAberto', rotulo: 'Em aberto', tipo: 'moeda' }
          ],
          linhas: linhas.map((l) => ({
            codigo: l.codigo, vendedor: l.vendedor, pedido: l.pedido, cliente: l.cliente, dataVenda: l.data_venda,
            vencimento: l.vencimento,
            situacao: l.status === 'paid' ? 'Quitado' : (l.vencimento < f.hoje ? 'Vencido' : (l.status === 'parcial' ? 'Parcial' : 'Em aberto')),
            valor: n(l.valor), recebido: n(l.recebido), emAberto: n(l.em_aberto)
          }))
        };
      }
      const porVendedor = new Map();
      for (const l of linhas) {
        const v = porVendedor.get(l.vendedor) || { vendedor: l.vendedor, titulos: 0, valor: 0, recebido: 0, emAberto: 0 };
        v.titulos += 1;
        v.valor = r2(v.valor + n(l.valor));
        v.recebido = r2(v.recebido + n(l.recebido));
        v.emAberto = r2(v.emAberto + n(l.em_aberto));
        porVendedor.set(l.vendedor, v);
      }
      return [...porVendedor.values()].sort((a, b) => b.valor - a.valor);
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
    // A COMPARAÇÃO, como no Viper: ao lado de cada categoria, o mesmo número
    // no período anterior (periodoAnterior). Só existe com as duas pontas do
    // período: sem uma delas não há o que repetir.
    //
    // Transferência entre contas não é receita nem despesa, e fica de fora.
    async executar({ sql, f }) {
      const [deAnterior, ateAnterior] = f.de && f.ate ? periodoAnterior(f.de, f.ate) : ['', ''];
      const NO_PERIODO = "($1 = '' or p.date >= $1::date) and ($2 = '' or p.date <= $2::date)";
      const NO_ANTERIOR = "(p.date between nullif($3, '')::date and nullif($4, '')::date)";
      const linhas = await sql(`
        select e.type as tipo, coalesce(c.name, 'Sem categoria') as categoria,
               sum(case when ${NO_PERIODO} then (case when e.type = 'RECEITA' then p.amount else -p.amount end) else 0 end) as valor,
               sum(case when ${NO_ANTERIOR} then (case when e.type = 'RECEITA' then p.amount else -p.amount end) else 0 end) as anterior
          from financial_payments p
          join financial_entries e on e.id = p.entry_id
          left join financial_categories c on c.id = e.category_id
         where e.type in ('RECEITA', 'DESPESA') and ${CANCELADO} and ((${NO_PERIODO}) or ${NO_ANTERIOR})
         group by 1, 2
         order by e.type desc, abs(sum(case when ${NO_PERIODO} then p.amount else 0 end)) desc, 2`, [f.de, f.ate, deAnterior, ateAnterior]);
      const receita = linhas.filter((l) => l.tipo === 'RECEITA').reduce((s, l) => s + n(l.valor), 0);
      const base = linhas.map((l) => ({
        tipo: l.tipo === 'RECEITA' ? 'Receita' : 'Despesa',
        categoria: l.categoria,
        valor: n(l.valor),
        sobreReceita: receita ? r2((n(l.valor) / receita) * 100) : null,
        anterior: n(l.anterior),
        diferenca: r2(n(l.valor) - n(l.anterior))
      }));
      if (!deAnterior) return base.map(({ anterior, diferenca, ...resto }) => resto);
      return {
        colunas: [
          ...module.exports.find((r) => r.key === 'dre-do-periodo').colunas,
          { campo: 'anterior', rotulo: `${dataBr(deAnterior)} a ${dataBr(ateAnterior)}`, tipo: 'moeda' },
          { campo: 'diferenca', rotulo: 'Diferença', tipo: 'moeda' }
        ],
        linhas: base
      };
    }
  },

  {
    key: 'dre-anual',
    grupo: 'financeiro',
    titulo: 'DRE Anual (caixa)',
    filtros: ['ano'],
    colunas: [{ campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' }],
    totais: 'numericas',
    // Os 12 meses do ano, o total, e o ano anterior ao lado — a comparação do
    // DRE Anual do Viper (2025 | 2026 | Diferença).
    async executar({ sql, f }) {
      const linhas = await sql(`
        select e.type as tipo, coalesce(c.name, 'Sem categoria') as categoria,
               extract(year from p.date)::int as ano, extract(month from p.date)::int as mes,
               sum(case when e.type = 'RECEITA' then p.amount else -p.amount end) as valor
          from financial_payments p
          join financial_entries e on e.id = p.entry_id
          left join financial_categories c on c.id = e.category_id
         where extract(year from p.date) in ($1::int, $1::int - 1) and e.type in ('RECEITA', 'DESPESA') and ${CANCELADO}
         group by 1, 2, 3, 4`, [f.ano]);
      const porCategoria = new Map();
      for (const l of linhas) {
        const chave = `${l.tipo}|${l.categoria}`;
        if (!porCategoria.has(chave)) {
          const base = { categoria: `${l.tipo === 'RECEITA' ? '(+)' : '(−)'} ${l.categoria}`, tipo: l.tipo, total: 0, anoAnterior: 0 };
          MESES.forEach((_, i) => { base[`m${i + 1}`] = 0; });
          porCategoria.set(chave, base);
        }
        const linha = porCategoria.get(chave);
        if (l.ano === f.ano) {
          linha[`m${l.mes}`] = r2(linha[`m${l.mes}`] + n(l.valor));
          linha.total = r2(linha.total + n(l.valor));
        } else {
          linha.anoAnterior = r2(linha.anoAnterior + n(l.valor));
        }
      }
      const ordenadas = [...porCategoria.values()].sort((a, b) => (a.tipo === b.tipo ? Math.abs(b.total) - Math.abs(a.total) : (a.tipo === 'RECEITA' ? -1 : 1)));
      return {
        colunas: [
          { campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
          ...MESES.map((m, i) => ({ campo: `m${i + 1}`, rotulo: m, tipo: 'moeda' })),
          { campo: 'total', rotulo: `Total ${f.ano}`, tipo: 'moeda' },
          { campo: 'anoAnterior', rotulo: `Total ${f.ano - 1}`, tipo: 'moeda' },
          { campo: 'diferenca', rotulo: 'Diferença', tipo: 'moeda' }
        ],
        linhas: ordenadas.map(({ tipo, ...resto }) => ({ ...resto, diferenca: r2(resto.total - resto.anoAnterior) }))
      };
    }
  }
];
