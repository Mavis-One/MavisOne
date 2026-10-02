/**
 * RELATÓRIOS DE SERVIÇOS: os equipamentos e as garantias.
 *
 * A situação da garantia sai de public/modules/shared/garantia.js, a mesma
 * regra da tela de Equipamentos: o dia do vencimento ainda está na garantia, e
 * sem data não é "vencida" — é "sem garantia", que é outra conversa com o
 * cliente.
 *
 * O cliente do equipamento (person_id) pode estar em people ou em cnpjs, como
 * no diretório do Cadastros. "Equipamentos de Clientes" lista só os que têm
 * cliente; o equipamento próprio da empresa não é de cliente nenhum.
 * Equipamento baixado não tem garantia a vencer que interesse a alguém.
 */

const garantia = require('../../public/modules/shared/garantia');

const CLIENTE = "coalesce(pe.name, cj.name, '')";
const JUNTA_CLIENTE = `left join people pe on pe.id = nullif(e.person_id, '')
          left join cnpjs cj on cj.id = nullif(e.person_id, '')`;
const SITUACAO = { vigente: 'Em garantia', vencida: 'Vencida', 'sem-garantia': 'Sem garantia' };

module.exports = [
  {
    key: 'equipamentos-de-clientes',
    grupo: 'servicos',
    titulo: 'Equipamentos de Clientes',
    filtros: [],
    colunas: [
      { campo: 'equipamento', rotulo: 'Equipamento', tipo: 'texto' },
      { campo: 'codigo', rotulo: 'Código', tipo: 'texto' },
      { campo: 'serie', rotulo: 'Nº de série', tipo: 'texto' },
      { campo: 'modelo', rotulo: 'Modelo', tipo: 'texto' },
      { campo: 'marca', rotulo: 'Marca', tipo: 'texto' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'compra', rotulo: 'Compra', tipo: 'data' },
      { campo: 'garantiaAte', rotulo: 'Garantia até', tipo: 'data' },
      { campo: 'garantia', rotulo: 'Garantia', tipo: 'texto' }
    ],
    totais: [],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(e.name, '') as equipamento, coalesce(e.code, '') as codigo,
               coalesce(e.serial_number, '') as serie, coalesce(e.model, '') as modelo,
               coalesce(e.brand, '') as marca, ${CLIENTE} as cliente,
               e.purchase_date as compra, e.warranty_until as garantia_ate
          from equipments e
          ${JUNTA_CLIENTE}
         where coalesce(e.person_id, '') <> ''
         order by 6, 1`);
      return linhas.map((l) => ({
        equipamento: l.equipamento, codigo: l.codigo, serie: l.serie, modelo: l.modelo, marca: l.marca,
        cliente: l.cliente, compra: l.compra, garantiaAte: l.garantia_ate,
        garantia: SITUACAO[garantia.situacao(l.garantia_ate, f.hoje)]
      }));
    }
  },

  {
    key: 'garantias-a-vencer',
    grupo: 'servicos',
    titulo: 'Garantias a Vencer',
    filtros: ['dias'],
    diasPadrao: 30,
    colunas: [
      { campo: 'equipamento', rotulo: 'Equipamento', tipo: 'texto' },
      { campo: 'serie', rotulo: 'Nº de série', tipo: 'texto' },
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      { campo: 'garantiaAte', rotulo: 'Garantia até', tipo: 'data' },
      { campo: 'diasRestantes', rotulo: 'Dias restantes', tipo: 'inteiro', semTotal: true }
    ],
    totais: [],
    async executar({ sql, f }) {
      const linhas = await sql(`
        select coalesce(e.name, '') as equipamento, coalesce(e.serial_number, '') as serie,
               ${CLIENTE} as cliente,
               coalesce(nullif(btrim(pe.phone), ''), nullif(btrim(pe.extra->>'mobilePhone'), ''), nullif(btrim(cj.phone), ''), '') as telefone,
               e.warranty_until as garantia_ate, (e.warranty_until - $1::date)::int as dias
          from equipments e
          ${JUNTA_CLIENTE}
         where e.warranty_until between $1::date and $1::date + $2::int
           and coalesce(e.status, '') <> 'baixado'
         order by e.warranty_until, 1`, [f.hoje, f.dias]);
      return linhas.map((l) => ({
        equipamento: l.equipamento, serie: l.serie, cliente: l.cliente, telefone: l.telefone,
        garantiaAte: l.garantia_ate, diasRestantes: l.dias
      }));
    }
  }
];
