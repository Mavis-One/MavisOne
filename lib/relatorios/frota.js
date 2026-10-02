/**
 * RELATÓRIOS DA FROTA.
 *
 * A despesa do veículo é abastecimento (fleet_refuels.total) mais manutenção
 * (fleet_maintenances.cost), pela data do registro. Os KM RODADOS são a maior
 * menos a menor leitura de odômetro registrada no período, somando as duas
 * tabelas: é o que se sabe do quanto o veículo andou sem confiar no odômetro
 * do cadastro, que só avança. Uma leitura só não mede distância nenhuma, e
 * então não há R$/km.
 */

const VEICULO = "coalesce(nullif(concat_ws(' · ', nullif(v.plate, ''), nullif(v.description, '')), ''), 'Veículo removido')";
const TIPO_MANUTENCAO = { preventiva: 'Preventiva', corretiva: 'Corretiva' };

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const ouNulo = (v) => (v === null || v === undefined ? null : Number(v));

module.exports = [
  {
    key: 'abastecimentos',
    grupo: 'frota',
    titulo: 'Abastecimentos',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'veiculo', rotulo: 'Veículo', tipo: 'texto' },
      { campo: 'litros', rotulo: 'Litros', tipo: 'quantidade' },
      { campo: 'total', rotulo: 'Total', tipo: 'moeda' },
      { campo: 'precoLitro', rotulo: 'R$/litro', tipo: 'moeda', semTotal: true },
      { campo: 'odometro', rotulo: 'Odômetro', tipo: 'numero', semTotal: true },
      { campo: 'posto', rotulo: 'Posto', tipo: 'texto' }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select a.date as data, ${VEICULO} as veiculo, a.liters as litros, a.total, a.odometer as odometro,
               coalesce(a.station, '') as posto
          from fleet_refuels a
          left join fleet_vehicles v on v.id = a.vehicle_id
         where ($1 = '' or a.date >= $1::date) and ($2 = '' or a.date <= $2::date)
         order by a.date, 2, a.odometer nulls last`, [f.de, f.ate]);
      return linhas.map((l) => ({
        data: l.data, veiculo: l.veiculo, litros: n(l.litros), total: n(l.total),
        precoLitro: n(l.litros) > 0 ? Math.round((n(l.total) / n(l.litros)) * 1000) / 1000 : null,
        odometro: ouNulo(l.odometro), posto: l.posto
      }));
    }
  },

  {
    key: 'manutencoes',
    grupo: 'frota',
    titulo: 'Manutenções',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'veiculo', rotulo: 'Veículo', tipo: 'texto' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
      { campo: 'custo', rotulo: 'Custo', tipo: 'moeda' },
      { campo: 'odometro', rotulo: 'Odômetro', tipo: 'numero', semTotal: true }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        select m.date as data, ${VEICULO} as veiculo, m.kind, coalesce(m.description, '') as descricao,
               coalesce(m.supplier_name, '') as fornecedor, m.cost as custo, m.odometer as odometro
          from fleet_maintenances m
          left join fleet_vehicles v on v.id = m.vehicle_id
         where ($1 = '' or m.date >= $1::date) and ($2 = '' or m.date <= $2::date)
         order by m.date, 2`, [f.de, f.ate]);
      return linhas.map((l) => ({
        data: l.data, veiculo: l.veiculo, tipo: TIPO_MANUTENCAO[l.kind] || l.kind || '',
        descricao: l.descricao, fornecedor: l.fornecedor, custo: n(l.custo), odometro: ouNulo(l.odometro)
      }));
    }
  },

  {
    key: 'despesas-por-veiculo',
    grupo: 'frota',
    titulo: 'Despesas por Veículo',
    filtros: ['periodo'],
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'veiculo', rotulo: 'Veículo', tipo: 'texto' },
      { campo: 'abastecimentos', rotulo: 'Abastecimentos (R$)', tipo: 'moeda' },
      { campo: 'manutencoes', rotulo: 'Manutenções (R$)', tipo: 'moeda' },
      { campo: 'total', rotulo: 'Total', tipo: 'moeda' },
      { campo: 'litros', rotulo: 'Litros', tipo: 'quantidade' },
      { campo: 'km', rotulo: 'Km rodados', tipo: 'numero' },
      { campo: 'custoKm', rotulo: 'R$/km', tipo: 'moeda', semTotal: true }
    ],
    totais: 'numericas',
    async executar({ sql, f }) {
      const linhas = await sql(`
        with registros as (
          select vehicle_id, total as abastecimento, 0 as manutencao, liters as litros, odometer
            from fleet_refuels
           where ($1 = '' or date >= $1::date) and ($2 = '' or date <= $2::date)
          union all
          select vehicle_id, 0, cost, 0, odometer
            from fleet_maintenances
           where ($1 = '' or date >= $1::date) and ($2 = '' or date <= $2::date))
        select ${VEICULO} as veiculo,
               sum(coalesce(r.abastecimento, 0)) as abastecimentos, sum(coalesce(r.manutencao, 0)) as manutencoes,
               sum(coalesce(r.litros, 0)) as litros,
               max(r.odometer) filter (where r.odometer > 0) - min(r.odometer) filter (where r.odometer > 0) as km
          from registros r
          left join fleet_vehicles v on v.id = r.vehicle_id
         group by r.vehicle_id, 1
         order by sum(coalesce(r.abastecimento, 0)) + sum(coalesce(r.manutencao, 0)) desc, 1`, [f.de, f.ate]);
      return linhas.map((l) => {
        const total = r2(n(l.abastecimentos) + n(l.manutencoes));
        const km = ouNulo(l.km);
        return {
          veiculo: l.veiculo, abastecimentos: n(l.abastecimentos), manutencoes: n(l.manutencoes), total,
          litros: n(l.litros), km, custoKm: km > 0 ? Math.round((total / km) * 100) / 100 : null
        };
      });
    }
  }
];
