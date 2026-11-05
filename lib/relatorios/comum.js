/**
 * O QUE OS RELATÓRIOS DE VENDA TÊM EM COMUM — e que não pode ser reescrito em
 * cada um, senão cada relatório chamaria de "venda" uma coisa diferente.
 *
 * VENDIDO é o pedido em que a mercadoria saiu (baixaEstoque no catálogo de
 * status): faturado, aprovado sem faturamento e parcialmente faturado. A lista
 * sai de sales_status.js, onde cada status é definido; status novo que baixe
 * estoque entra sozinho.
 *
 * MOVIMENTAÇÃO INTERNA (transferência entre filiais e remessa) não é venda, e
 * só a categoria diz isso (ver lib/filial-da-venda.js, ehMovimentacaoInterna):
 * em 2026 ela era 37,7% do que a linha "Pedidos" somava. O SQL aqui repete a
 * mesma regra — radical "transfer" ou "remessa", sem caixa.
 *
 * A FILIAL é o texto depois da última "/" da categoria, comparado sem acento e
 * sem caixa (chaveDaFilial). `company_id` está vazio em todos os pedidos.
 */

const salesStatus = require('../../public/modules/shared/sales_status');
const { chaveDaFilial } = require('../filial-da-venda');
const { EMPRESAS_DA_LISTAGEM } = require('../importacao-nfe-viper');

const STATUS_VENDIDO = salesStatus.CATALOGO
  .filter((s) => s.tipo === 'order' && s.baixaEstoque && !s.cancelado)
  .map((s) => s.value);

const SEM_ACENTO_DE = 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ';
const SEM_ACENTO_PARA = 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC';

/** Expressão SQL: a chave da filial de um pedido (vazia quando não há "/"). */
function filialSql(alias = 'o') {
  return `(case when position('/' in coalesce(${alias}.category, '')) > 0
    then lower(btrim(regexp_replace(translate(regexp_replace(${alias}.category, '^.*/', ''), '${SEM_ACENTO_DE}', '${SEM_ACENTO_PARA}'), '\\s+', ' ', 'g')))
    else '' end)`;
}

/**
 * A EMPRESA ONDE O PEDIDO FOI FATURADO (05/11/2026, pedido do usuário: "quero
 * que apareça as empresas aonde os pedidos foram faturados") — o CNPJ, só
 * dígitos, ou '' quando não se sabe. O sufixo da categoria (filialSql) é a LOJA
 * da venda e não diz isso: medido no banco, metade dos pedidos "Marcolla" saiu
 * com NF-e da Matriz, e quase todos os "Electric" e os "Kaccau" também.
 *
 * Em ordem, o primeiro que houver:
 *   1. a NF-e autorizada do pedido, emitida por este sistema (nfe);
 *   2. o documento fiscal ligado ao pedido (a NF-e importada do Viper);
 *   3. a Empresa do pedido (orders.company_id) — a NF-e do pedido é obrigada a
 *      sair dela (prepararNfeParaTransmitir);
 *   4. o pedido do Viper: a observação da importação diz "Empresa: SAL INFINITY
 *      ELECTRIC LTDA | ..." — a empresa do pedido lá. O nome vira o CNPJ pelo
 *      mapa da importação (EMPRESAS_DA_LISTAGEM); empresa que não é do MavisONE
 *      (KACCAU ELETRIC, SAL INFINITY BY BLUMENAU) volta como "viper:NOME".
 * `empresas` = data.companies (moram no db.json): o id vira o CNPJ por um mapa
 * escrito na consulta — só id e CNPJ que passam no formato, sem aspa possível;
 * os nomes do Viper são constantes deste código.
 */
const NOME_DA_EMPRESA_NO_VIPER = (alias) => `upper(btrim(regexp_replace(btrim(substring(${alias}.note from 'Empresa: ([^|]+)')), '\\.+$', '')))`;
const VALORES_DO_VIPER = Object.entries(EMPRESAS_DA_LISTAGEM).map(([nome, cnpj]) => `('${nome}', '${cnpj}')`).join(', ');

function empresaDoPedidoSql(alias, empresas) {
  const mapa = {};
  for (const c of empresas || []) {
    const id = String((c && c.id) || '');
    const cnpj = String((c && (c.cnpj || c.document)) || '').replace(/\D/g, '');
    if (/^[A-Za-z0-9_-]{1,80}$/.test(id) && cnpj.length === 14) mapa[id] = cnpj;
  }
  return `coalesce(
    (select regexp_replace(e.cnpj, '\\D', '', 'g') from nfe n join estabelecimento e on e.id = n.estabelecimento_id
      where n.order_id = ${alias}.id and upper(n.status) = 'AUTORIZADO' order by n.data_emissao desc nulls last limit 1),
    (case when coalesce(${alias}.nfe_id, '') <> '' then
      (select regexp_replace(e.cnpj, '\\D', '', 'g') from nfe n join estabelecimento e on e.id = n.estabelecimento_id
        where n.id::text = ${alias}.nfe_id and upper(n.status) = 'AUTORIZADO' limit 1) end),
    (select regexp_replace(e.cnpj, '\\D', '', 'g') from fiscal_documentos fd join estabelecimento e on e.id = fd.estabelecimento_id
      where fd.order_id = ${alias}.id and fd.sentido = 'SAIDA' and fd.situacao = 'REGULAR' order by fd.data_emissao desc nulls last limit 1),
    nullif('${JSON.stringify(mapa)}'::jsonb ->> coalesce(${alias}.company_id, ''), ''),
    (case when ${alias}.note like 'Importado do ViperERP%' and position('Empresa: ' in ${alias}.note) > 0 then
      (select coalesce(m.cnpj, 'viper:' || x.nome)
         from (select ${NOME_DA_EMPRESA_NO_VIPER(alias)} as nome) x
         left join (values ${VALORES_DO_VIPER}) as m(nome, cnpj) on m.nome = x.nome
        where coalesce(x.nome, '') <> '') end),
    '')`;
}

/** O valor do filtro: CNPJ (só dígitos), "viper:NOME", SEM_EMPRESA ou ''. */
const SEM_EMPRESA = 'sem-empresa';
function empresaPedida(valor) {
  const s = String(valor || '').trim();
  if (s === SEM_EMPRESA) return SEM_EMPRESA;
  // Empresa que só existe no Viper: o nome, em maiúsculas, como a consulta o monta.
  if (/^viper:/i.test(s)) {
    const nome = s.slice(6).toUpperCase().replace(/\s+/g, ' ').trim();
    return /^[A-Z0-9 &().,-]{2,80}$/.test(nome) ? `viper:${nome}` : '';
  }
  const cnpj = s.replace(/\D/g, '');
  return cnpj.length === 14 ? cnpj : '';
}

/**
 * CNPJ -> nome da empresa, para a coluna e para a lista do filtro: o nome
 * fantasia do estabelecimento; sem estabelecimento, o da empresa do cadastro
 * (`empresas` = data.companies); "viper:NOME" -> "NOME (só no Viper)".
 */
async function nomesDasEmpresas(sql, empresas = []) {
  const linhas = await sql(`select regexp_replace(cnpj, '\\D', '', 'g') as cnpj,
                                   coalesce(nullif(btrim(nome_fantasia), ''), razao_social) as nome
                              from estabelecimento`);
  const nomes = new Map();
  for (const c of empresas || []) {
    const cnpj = String((c && (c.cnpj || c.document)) || '').replace(/\D/g, '');
    const nome = String((c && (c.tradeName || c.fantasia || c.nomeFantasia || c.name)) || '').trim();
    if (cnpj.length === 14 && nome) nomes.set(cnpj, nome);
  }
  for (const l of linhas) if (l.nome) nomes.set(l.cnpj, l.nome);
  return {
    get(chave) {
      const k = String(chave || '');
      if (k.startsWith('viper:')) return `${k.slice(6)} (só no Viper)`;
      return nomes.get(k) || (k ? k.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '');
    },
    todos: () => [...nomes.entries()].map(([id, nome]) => ({ id, name: nome }))
  };
}

/** O nome da filial como aparece (sem normalizar), para exibir. */
function nomeDaFilialSql(alias = 'o') {
  return `(case when position('/' in coalesce(${alias}.category, '')) > 0
    then btrim(regexp_replace(${alias}.category, '^.*/', '')) else '' end)`;
}

/** Expressão SQL verdadeira quando o pedido É venda (não é movimentação interna). */
//
// FASE EF (13/10/2026): a categoria CADASTRADA diz por si — só a de finalidade
// "venda" é venda; o nome do pedido casa inteiro ou sem a filial (o que vem
// depois da última "/"). A NÃO cadastrada segue pelo texto, como sempre — é a
// mesma regra de lib/filial-da-venda.js (ehMovimentacaoInterna).
function ehVendaSql(alias = 'o') {
  const cat = `coalesce(${alias}.category, '')`;
  return `coalesce(
    (select sc.finalidade = 'venda' from sales_categories sc
      where lower(trim(sc.name)) in (lower(trim(${cat})), lower(trim(regexp_replace(${cat}, '\\s*/[^/]*$', ''))))
      order by (lower(trim(sc.name)) = lower(trim(${cat}))) desc limit 1),
    ${cat} !~* '(transfer|remessa)')`;
}

/**
 * Os parâmetros que todo relatório de venda passa: status vendidos, vendedores
 * permitidos (null = todos; [] = nenhum) e a filial pedida (chave, ou '').
 */
function parametrosDeVenda(ctx) {
  return {
    status: STATUS_VENDIDO,
    vendedores: ctx.vendedores === undefined ? null : ctx.vendedores,
    // Desde 05/11/2026 o filtro "filial" é a EMPRESA ONDE O PEDIDO FOI
    // FATURADO (empresaDoPedidoSql): o CNPJ, ou SEM_EMPRESA.
    filial: empresaPedida(ctx.f && ctx.f.filial)
  };
}

/** A condição do filtro de empresa, com o parâmetro `$n` do valor pedido. */
function filtroDeEmpresaSql(alias, parametro, empresas) {
  return `(${parametro} = '' or ${empresaDoPedidoSql(alias, empresas)} = (case when ${parametro} = '${SEM_EMPRESA}' then '' else ${parametro} end))`;
}

/**
 * O SALDO NO RAZÃO (stock_movements, alias `m`): saída negativa, todo o resto
 * positivo — a mesma conta de movementSignedQuantity em lib/stock-core.js. Mora
 * aqui porque Estoque e Vendas (o condensado por produto) somam o mesmo razão,
 * e dois jeitos de somar dariam dois saldos para o mesmo depósito.
 */
const SALDO_DO_RAZAO = "case when m.type = 'saida' then -m.quantity else m.quantity end";

/**
 * O nome do depósito, já sabendo dos baldes do razão: `deposit_id` vazio é o
 * saldo sem depósito (movimento de antes do módulo) e '__transito__' é a carga
 * que saiu da origem e ainda não foi conferida no destino. `alias` é o join em
 * deposits.
 */
const nomeDoDepositoSql = (alias, idSql) => `coalesce(${alias}.name, case when coalesce(${idSql}, '') = '' then 'Sem depósito' else 'Em trânsito' end)`;

/**
 * O pedido que veio do Viper na migração: a carga gravou created_by_name =
 * 'Importação Viper' (os 14.864 pedidos em 02/10/2026). A nota fiscal dele,
 * quando houve, foi emitida no Viper, e não está na tabela `nfe`.
 */
const pedidoImportadoSql = (alias = 'o') => `coalesce(${alias}.created_by_name, '') = 'Importação Viper'`;

module.exports = {
  STATUS_VENDIDO, filialSql, nomeDaFilialSql, ehVendaSql, parametrosDeVenda, chaveDaFilial, SALDO_DO_RAZAO, nomeDoDepositoSql,
  pedidoImportadoSql, empresaDoPedidoSql, empresaPedida, filtroDeEmpresaSql, nomesDasEmpresas, SEM_EMPRESA,
  nomeDaEmpresaNoViperSql: NOME_DA_EMPRESA_NO_VIPER, EMPRESAS_DA_LISTAGEM
};
