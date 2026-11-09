'use strict';

/**
 * A HORA DO PEDIDO (09/11/2026, pedido do usuário: "preciso que conste
 * data/hora dos pedidos!").
 *
 * É o campo "Hora" da aba Dados do pedido (orders.registration_time, 'HH:MM'):
 * a tela preenche com a hora em que o pedido foi aberto, e é ela que o pedido
 * impresso já mostrava. Uma regra só, em JavaScript (lista de pedidos, painéis,
 * relatório Pedidos) e em SQL (os relatórios do motor) — as duas têm de dar a
 * mesma resposta, e scripts/test-hora-do-pedido.js confere no banco.
 *
 * `created_at` NÃO serve: nos pedidos do Viper ele foi montado pela importação
 * (a data com 12:00 ou 00:00 quando o Viper não mandou hora).
 *
 * '00:00' é "sem hora": é o que o Viper mandou nos pedidos de set–dez/2025
 * (1.536 no banco local) — loja não vende à meia-noite. Os de outubro/2026
 * vieram sem hora nenhuma (249). Sem hora, sai só a data.
 */

const FORMATO = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** 'HH:MM', ou '' quando o pedido não tem hora. */
function horaDoPedido(valor) {
  const hora = String(valor == null ? '' : valor).trim().slice(0, 5);
  return FORMATO.test(hora) && hora !== '00:00' ? hora : '';
}

/** A mesma regra como expressão SQL; `alias` é a tabela do pedido (orders ou quotes). */
function horaDoPedidoSql(alias = 'o') {
  const hora = `left(btrim(coalesce(${alias}.registration_time, '')), 5)`;
  return `(case when ${hora} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${hora} <> '00:00' then ${hora} else '' end)`;
}

module.exports = { horaDoPedido, horaDoPedidoSql };
