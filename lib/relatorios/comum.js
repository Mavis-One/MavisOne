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

/** O nome da filial como aparece (sem normalizar), para exibir. */
function nomeDaFilialSql(alias = 'o') {
  return `(case when position('/' in coalesce(${alias}.category, '')) > 0
    then btrim(regexp_replace(${alias}.category, '^.*/', '')) else '' end)`;
}

/** Expressão SQL verdadeira quando o pedido É venda (não é movimentação interna). */
function ehVendaSql(alias = 'o') {
  return `coalesce(${alias}.category, '') !~* '(transfer|remessa)'`;
}

/**
 * Os parâmetros que todo relatório de venda passa: status vendidos, vendedores
 * permitidos (null = todos; [] = nenhum) e a filial pedida (chave, ou '').
 */
function parametrosDeVenda(ctx) {
  return {
    status: STATUS_VENDIDO,
    vendedores: ctx.vendedores === undefined ? null : ctx.vendedores,
    filial: chaveDaFilial(ctx.f && ctx.f.filial)
  };
}

module.exports = { STATUS_VENDIDO, filialSql, nomeDaFilialSql, ehVendaSql, parametrosDeVenda, chaveDaFilial };
