/**
 * RELATÓRIOS DO CRM.
 *
 * "Comprou" é ter pedido VENDIDO (comum.js: STATUS_VENDIDO, e sem transferência
 * nem remessa) — orçamento e pedido cancelado não fazem de ninguém cliente
 * ativo. O cliente do pedido é client_supplier_id → people; pedido sem vínculo
 * conta pelo nome digitado, senão o "CONSUMIDOR NÃO IDENTIFICADO" do Viper
 * sumiria das contas.
 *
 * O vendedor restringe o que entra: quem só vê as próprias vendas vê só os
 * clientes e o faturamento dos próprios pedidos.
 *
 * Os contatos ainda moram no db.json (data.contacts); a pessoa vinculada a um
 * contato pode estar em people ou em cnpjs, como no diretório do Cadastros.
 */

const { ehVendaSql, parametrosDeVenda } = require('./comum');

const n = (v) => Number(v || 0);
const TELEFONE = `coalesce(nullif(btrim(pe.phone), ''), nullif(btrim(pe.extra->>'mobilePhone'), ''), nullif(btrim(pe.extra->>'whatsapp'), ''), '')`;
const VALOR_DO_PEDIDO = 'coalesce(o.total_amount, o.amount, 0)';

function cidadeUf(cidade, uf) {
  const c = String(cidade || '').trim();
  const u = String(uf || '').trim().toUpperCase();
  return c && u ? `${c}/${u}` : (c || u);
}

/** "aaaa-mm-dd" do aniversário num ano; 29/02 vira 28/02 em ano não bissexto. */
function aniversarioNoAno(mes, dia, ano) {
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const d = mes === 2 && dia === 29 && !bissexto ? 28 : dia;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A primeira vez que o aniversário cai dentro do período, ou null. O ano do
 * nascimento não entra: o período de dezembro a janeiro pega os dois meses.
 */
function aniversarioNoPeriodo(nascimento, de, ate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(nascimento || '').trim());
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano += 1) {
    const data = aniversarioNoAno(mes, dia, ano);
    if (data >= de && data <= ate) return data;
  }
  return null;
}

module.exports = [
  {
    key: 'clientes-sem-comprar',
    grupo: 'crm',
    titulo: 'Clientes sem Comprar',
    filtros: ['dias'],
    diasPadrao: 180,
    colunas: [
      { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      { campo: 'cidade', rotulo: 'Cidade/UF', tipo: 'texto' },
      { campo: 'ultimaCompra', rotulo: 'Última compra', tipo: 'data' },
      { campo: 'diasSemComprar', rotulo: 'Dias sem comprar', tipo: 'inteiro', semTotal: true },
      { campo: 'pedidos', rotulo: 'Pedidos', tipo: 'inteiro' },
      { campo: 'totalComprado', rotulo: 'Total comprado', tipo: 'moeda' }
    ],
    totais: ['pedidos', 'totalComprado'],
    async executar(ctx) {
      const { sql, f } = ctx;
      const p = parametrosDeVenda(ctx);
      const linhas = await sql(`
        with compras as (
          select coalesce(nullif(o.client_supplier_id, ''), 'nome:' || coalesce(o.client_supplier_name, o.customer, '')) as chave,
                 max(nullif(o.client_supplier_id, '')) as pessoa_id,
                 max(coalesce(nullif(o.client_supplier_name, ''), o.customer, '')) as nome,
                 max(o.date) as ultima, count(*)::int as pedidos, sum(${VALOR_DO_PEDIDO}) as total
            from orders o
           where o.status = any($1::text[]) and ${ehVendaSql('o')}
             and ($2::text[] is null or o.seller_id = any($2::text[]))
           group by 1)
        select coalesce(pe.name, nullif(c.nome, ''), 'Sem cliente') as cliente, ${TELEFONE} as telefone,
               coalesce(pe.city, '') as cidade, coalesce(pe.state, '') as uf,
               c.ultima, ($3::date - c.ultima)::int as dias, c.pedidos, c.total
          from compras c
          left join people pe on pe.id = c.pessoa_id
         where c.ultima < $3::date - $4::int
         order by c.ultima desc, 1`, [p.status, p.vendedores, f.hoje, f.dias]);
      return linhas.map((l) => ({
        cliente: l.cliente, telefone: l.telefone, cidade: cidadeUf(l.cidade, l.uf),
        ultimaCompra: l.ultima, diasSemComprar: l.dias, pedidos: l.pedidos, totalComprado: n(l.total)
      }));
    }
  },

  {
    key: 'aniversariantes',
    grupo: 'crm',
    titulo: 'Aniversariantes',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'nome', rotulo: 'Nome', tipo: 'texto' },
      { campo: 'pessoa', rotulo: 'Pessoa vinculada', tipo: 'texto' },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      { campo: 'email', rotulo: 'E-mail', tipo: 'texto' },
      { campo: 'aniversario', rotulo: 'Aniversário', tipo: 'texto' }
    ],
    totais: [],
    async executar({ sql, f, data }) {
      // Só uma das pontas preenchida: a outra fecha o mesmo ano.
      const de = f.de || (f.ate ? `${f.ate.slice(0, 4)}-01-01` : `${f.hoje.slice(0, 4)}-01-01`);
      const ate = f.ate || `${de.slice(0, 4)}-12-31`;
      const achados = ((data && data.contacts) || [])
        .filter((c) => c && c.status !== 'inativo')
        .map((c) => ({ contato: c, quando: aniversarioNoPeriodo(c.birthDate, de, ate) }))
        .filter((a) => a.quando);
      if (!achados.length) return [];

      const ids = [...new Set(achados.map((a) => a.contato.personId).filter(Boolean))];
      const nomes = new Map();
      if (ids.length) {
        const pessoas = await sql(`
          select id, name from people where id = any($1::text[])
          union all
          select id, name from cnpjs where id = any($1::text[])`, [ids]);
        for (const p of pessoas) nomes.set(p.id, p.name || '');
      }

      return achados
        .sort((a, b) => (a.quando === b.quando
          ? String(a.contato.name || '').localeCompare(String(b.contato.name || ''), 'pt-BR')
          : (a.quando < b.quando ? -1 : 1)))
        .map(({ contato: c, quando }) => ({
          nome: String(c.name || ''),
          pessoa: nomes.get(c.personId) || '',
          telefone: String(c.phone || c.mobilePhone || c.whatsapp || ''),
          email: String(c.email || ''),
          aniversario: `${quando.slice(8, 10)}/${quando.slice(5, 7)}`
        }));
    }
  },

  {
    key: 'clientes-por-cidade',
    grupo: 'crm',
    titulo: 'Clientes por Cidade',
    filtros: ['periodo'],
    periodoPadrao: 'ano',
    colunas: [
      { campo: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { campo: 'uf', rotulo: 'UF', tipo: 'texto' },
      { campo: 'cadastrados', rotulo: 'Clientes cadastrados', tipo: 'inteiro' },
      { campo: 'compraram', rotulo: 'Clientes que compraram', tipo: 'inteiro' },
      { campo: 'faturamento', rotulo: 'Faturamento', tipo: 'moeda' }
    ],
    totais: 'numericas',
    async executar(ctx) {
      const { sql, f } = ctx;
      const p = parametrosDeVenda(ctx);
      const linhas = await sql(`
        with cadastro as (
          select coalesce(nullif(btrim(pe.city), ''), 'Sem cidade') as cidade, upper(coalesce(btrim(pe.state), '')) as uf,
                 count(*)::int as cadastrados
            from people pe
           where coalesce(pe.extra->'roles', '[]'::jsonb) ? 'Cliente'
           group by 1, 2),
        vendas as (
          select coalesce(nullif(btrim(pe.city), ''), 'Sem cidade') as cidade, upper(coalesce(btrim(pe.state), '')) as uf,
                 count(distinct coalesce(nullif(o.client_supplier_id, ''), 'nome:' || coalesce(o.client_supplier_name, o.customer, '')))::int as compraram,
                 sum(${VALOR_DO_PEDIDO}) as faturamento
            from orders o
            left join people pe on pe.id = nullif(o.client_supplier_id, '')
           where o.status = any($1::text[]) and ${ehVendaSql('o')}
             and ($2::text[] is null or o.seller_id = any($2::text[]))
             and ($3 = '' or o.date >= $3::date) and ($4 = '' or o.date <= $4::date)
           group by 1, 2)
        select coalesce(c.cidade, v.cidade) as cidade, coalesce(c.uf, v.uf) as uf,
               coalesce(c.cadastrados, 0) as cadastrados, coalesce(v.compraram, 0) as compraram,
               coalesce(v.faturamento, 0) as faturamento
          from cadastro c
          full join vendas v on v.cidade = c.cidade and v.uf = c.uf
         order by faturamento desc, cadastrados desc, 1`, [p.status, p.vendedores, f.de, f.ate]);
      return linhas.map((l) => ({
        cidade: l.cidade, uf: l.uf, cadastrados: l.cadastrados, compraram: l.compraram, faturamento: n(l.faturamento)
      }));
    }
  }
];
