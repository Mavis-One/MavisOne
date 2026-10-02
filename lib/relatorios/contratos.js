/**
 * RELATÓRIOS DE CONTRATOS.
 *
 * Situação rascunho | ativo | suspenso | encerrado e ciclo único | mensal |
 * trimestral | semestral | anual (CHECKs do banco). A parte é o nome gravado no
 * contrato — é o que a tela mostra —, e o cadastro vinculado só cobre o
 * contrato que ficou sem nome.
 *
 * OS LANÇAMENTOS do contrato são os que /api/contracts/billing gerou: o vínculo
 * é financial_entries.reference_id = contracts.id. Cliente gera RECEITA e
 * fornecedor gera DESPESA, por isso a coluna Tipo — somar as duas sem dizer
 * qual é qual daria um total que não é nem receita nem despesa. "Pago" segue o
 * Financeiro: a soma das baixas, ou o valor inteiro no lançamento marcado pago
 * sem baixa registrada (o legado). Lançamento cancelado não entra.
 */

const CICLO = { unico: 'Único', mensal: 'Mensal', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };
const SITUACAO = { rascunho: 'Rascunho', ativo: 'Ativo', suspenso: 'Suspenso', encerrado: 'Encerrado' };
const PARTE = "coalesce(nullif(btrim(c.party_name), ''), pe.name, cj.name, '')";
const JUNTA_PARTE = `left join people pe on pe.id = nullif(c.party_id, '')
          left join cnpjs cj on cj.id = nullif(c.party_id, '')`;
const CANCELADO = "coalesce(e.status, '') not in ('cancelado', 'cancelled', 'canceled')";

const n = (v) => Number(v || 0);

function situacaoDoLancamento(l, hoje) {
  const status = String(l.status || '').toLowerCase();
  if (status === 'paid') return l.tipo === 'DESPESA' ? 'Pago' : 'Recebido';
  if (status === 'parcial') return 'Parcial';
  if (status === 'pending' || status === 'pendente') return l.vencimento && l.vencimento < hoje ? 'Vencido' : 'Pendente';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pendente';
}

module.exports = [
  {
    key: 'contratos',
    grupo: 'contratos',
    titulo: 'Contratos',
    filtros: [],
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'inteiro', semTotal: true },
      { campo: 'titulo', rotulo: 'Título', tipo: 'texto' },
      { campo: 'parte', rotulo: 'Parte', tipo: 'texto' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'inicio', rotulo: 'Início', tipo: 'data' },
      { campo: 'fim', rotulo: 'Fim', tipo: 'data' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'ciclo', rotulo: 'Ciclo de cobrança', tipo: 'texto' },
      { campo: 'renovacao', rotulo: 'Renovação automática', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: ['valor'],
    async executar({ sql }) {
      const linhas = await sql(`
        select c.code as codigo, coalesce(c.title, '') as titulo, ${PARTE} as parte, coalesce(t.name, '') as tipo,
               c.start_date as inicio, c.end_date as fim, c.value as valor, c.billing_cycle, c.auto_renew, c.status
          from contracts c
          left join contract_types t on t.id = c.type_id
          ${JUNTA_PARTE}
         order by c.code nulls last, c.title`);
      return linhas.map((l) => ({
        codigo: l.codigo, titulo: l.titulo, parte: l.parte, tipo: l.tipo, inicio: l.inicio, fim: l.fim,
        valor: n(l.valor), ciclo: CICLO[l.billing_cycle] || l.billing_cycle || '',
        renovacao: l.auto_renew ? 'Sim' : 'Não', situacao: SITUACAO[l.status] || l.status || ''
      }));
    }
  },

  {
    key: 'vencimentos-de-contratos',
    grupo: 'contratos',
    titulo: 'Vencimentos de Contratos',
    filtros: ['dias'],
    diasPadrao: 60,
    colunas: [
      { campo: 'codigo', rotulo: 'Código', tipo: 'inteiro', semTotal: true },
      { campo: 'titulo', rotulo: 'Título', tipo: 'texto' },
      { campo: 'parte', rotulo: 'Parte', tipo: 'texto' },
      { campo: 'fim', rotulo: 'Fim', tipo: 'data' },
      { campo: 'diasParaVencer', rotulo: 'Dias para vencer', tipo: 'inteiro', semTotal: true },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }
    ],
    totais: ['valor'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select c.code as codigo, coalesce(c.title, '') as titulo, ${PARTE} as parte, c.end_date as fim,
               (c.end_date - $1::date)::int as dias, c.value as valor
          from contracts c
          ${JUNTA_PARTE}
         where c.status = 'ativo' and c.end_date between $1::date and $1::date + $2::int
         order by c.end_date, c.code nulls last`, [f.hoje, f.dias]);
      return linhas.map((l) => ({
        codigo: l.codigo, titulo: l.titulo, parte: l.parte, fim: l.fim, diasParaVencer: l.dias, valor: n(l.valor)
      }));
    }
  },

  {
    key: 'lancamentos-de-contratos',
    grupo: 'contratos',
    titulo: 'Lançamentos de Contratos',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'contrato', rotulo: 'Contrato', tipo: 'texto' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'pago', rotulo: 'Pago', tipo: 'moeda' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: ['valor', 'pago'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select concat_ws(' · ', c.code::text, nullif(c.title, '')) as contrato, e.type as tipo,
               e.due_date as vencimento, e.amount as valor, e.status,
               case when pg.pago is not null then pg.pago
                    when lower(coalesce(e.status, '')) = 'paid' then e.amount
                    else 0 end as pago
          from financial_entries e
          join contracts c on c.id = e.reference_id
          left join (select entry_id, sum(amount) as pago from financial_payments group by entry_id) pg on pg.entry_id = e.id
         where ${CANCELADO}
           and ($1 = '' or e.due_date >= $1::date) and ($2 = '' or e.due_date <= $2::date)
         order by e.due_date, c.code nulls last`, [f.de, f.ate]);
      return linhas.map((l) => ({
        contrato: l.contrato, tipo: l.tipo === 'DESPESA' ? 'A pagar' : 'A receber',
        vencimento: l.vencimento, valor: n(l.valor), pago: n(l.pago),
        situacao: situacaoDoLancamento(l, f.hoje)
      }));
    }
  }
];
