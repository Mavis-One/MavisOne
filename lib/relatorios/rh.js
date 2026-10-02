/**
 * RELATÓRIOS DO RH.
 *
 * Os valores fixos estão nos CHECKs do banco e em public/modules/hr/subs/rh.js:
 * situação do colaborador ativo | afastado | desligado; tipo de ausência
 * ferias | licenca | afastamento | falta.
 *
 * AUSÊNCIA SEM FIM é ausência em curso — menos a falta, que é de um dia só e
 * cujo fim a tela não obriga a preencher. Sem essa exceção, toda falta lançada
 * sem fim apareceria em todos os períodos dali em diante.
 *
 * CONTROLE DE FÉRIAS: a base é o início das últimas férias já começadas (as
 * agendadas para depois de hoje ainda não aconteceram) ou, sem férias, a
 * admissão. Ativo é quem não foi desligado: o afastado continua contratado e
 * continua com férias a controlar.
 */

const SITUACAO = { ativo: 'Ativo', afastado: 'Afastado', desligado: 'Desligado' };
const TIPO_AUSENCIA = { ferias: 'Férias', licenca: 'Licença', afastamento: 'Afastamento', falta: 'Falta' };
const FIM_DA_AUSENCIA = "coalesce(l.end_date, case when l.kind = 'falta' then l.start_date end)";

const n = (v) => Number(v || 0);

function situacaoDasFerias(meses) {
  if (meses === null || meses === undefined) return '';
  if (meses < 12) return 'Em aquisição';
  if (meses < 24) return 'A conceder';
  return 'Vencida';
}

module.exports = [
  {
    key: 'colaboradores',
    grupo: 'rh',
    titulo: 'Colaboradores',
    filtros: [],
    colunas: [
      { campo: 'nome', rotulo: 'Nome', tipo: 'texto' },
      { campo: 'cpf', rotulo: 'CPF', tipo: 'texto' },
      { campo: 'cargo', rotulo: 'Cargo', tipo: 'texto' },
      { campo: 'departamento', rotulo: 'Departamento', tipo: 'texto' },
      { campo: 'admissao', rotulo: 'Admissão', tipo: 'data' },
      { campo: 'desligamento', rotulo: 'Desligamento', tipo: 'data' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { campo: 'salario', rotulo: 'Salário', tipo: 'moeda' }
    ],
    // O total de salário somaria o último salário de quem já saiu: seria uma
    // folha que não existe.
    totais: [],
    async executar({ sql }) {
      const linhas = await sql(`
        select e.name as nome, coalesce(e.document, '') as cpf, coalesce(p.name, '') as cargo,
               coalesce(d.name, '') as departamento, e.admitted_at as admissao, e.dismissed_at as desligamento,
               e.status, e.salary as salario
          from hr_employees e
          left join hr_positions p on p.id = e.position_id
          left join hr_departments d on d.id = e.department_id
         order by case e.status when 'ativo' then 0 when 'afastado' then 1 else 2 end, e.name`);
      return linhas.map((l) => ({
        nome: l.nome, cpf: l.cpf, cargo: l.cargo, departamento: l.departamento,
        admissao: l.admissao, desligamento: l.desligamento,
        situacao: SITUACAO[l.status] || l.status || '',
        salario: l.salario === null ? null : n(l.salario)
      }));
    }
  },

  {
    key: 'afastamentos-e-ferias',
    grupo: 'rh',
    titulo: 'Afastamentos e Férias',
    filtros: ['periodo'],
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'colaborador', rotulo: 'Colaborador', tipo: 'texto' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'inicio', rotulo: 'Início', tipo: 'data' },
      { campo: 'fim', rotulo: 'Fim', tipo: 'data' },
      { campo: 'dias', rotulo: 'Dias', tipo: 'inteiro' }
    ],
    totais: ['dias'],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(e.name, '') as colaborador, l.kind, l.start_date as inicio, ${FIM_DA_AUSENCIA} as fim,
               (${FIM_DA_AUSENCIA} - l.start_date + 1)::int as dias
          from hr_leaves l
          left join hr_employees e on e.id = l.employee_id
         where ($2 = '' or l.start_date <= $2::date)
           and ($1 = '' or ${FIM_DA_AUSENCIA} is null or ${FIM_DA_AUSENCIA} >= $1::date)
         order by l.start_date, 1`, [f.de, f.ate]);
      return linhas.map((l) => ({
        colaborador: l.colaborador, tipo: TIPO_AUSENCIA[l.kind] || l.kind || '',
        inicio: l.inicio, fim: l.fim, dias: l.dias
      }));
    }
  },

  {
    key: 'controle-de-ferias',
    grupo: 'rh',
    titulo: 'Controle de Férias',
    filtros: [],
    colunas: [
      { campo: 'colaborador', rotulo: 'Colaborador', tipo: 'texto' },
      { campo: 'admissao', rotulo: 'Admissão', tipo: 'data' },
      { campo: 'ultimasFerias', rotulo: 'Últimas férias', tipo: 'data' },
      { campo: 'meses', rotulo: 'Meses desde a base', tipo: 'inteiro', semTotal: true },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: [],
    async executar({ sql, f }) {
      const linhas = await sql(`
        with ferias as (
          select employee_id, max(start_date) as ultimas
            from hr_leaves
           where kind = 'ferias' and start_date <= $1::date
           group by employee_id)
        select e.name as colaborador, e.admitted_at as admissao, fe.ultimas,
               (extract(year from age($1::date, coalesce(fe.ultimas, e.admitted_at))) * 12
                + extract(month from age($1::date, coalesce(fe.ultimas, e.admitted_at))))::int as meses
          from hr_employees e
          left join ferias fe on fe.employee_id = e.id
         where coalesce(e.status, 'ativo') <> 'desligado'
           and (e.dismissed_at is null or e.dismissed_at > $1::date)
         order by meses desc nulls last, e.name`, [f.hoje]);
      return linhas.map((l) => ({
        colaborador: l.colaborador, admissao: l.admissao, ultimasFerias: l.ultimas,
        meses: l.meses, situacao: situacaoDasFerias(l.meses)
      }));
    }
  }
];
