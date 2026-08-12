/**
 * Reserva de estoque — o que já foi PROMETIDO e ainda não saiu.
 *
 * O BURACO QUE ISTO FECHA
 * -----------------------
 * Estoque só se mexe quando o pedido é faturado (transitionOrderStockEffect).
 * Até lá, o pedido não segura nada: dois vendedores podiam prometer as mesmas
 * 10 unidades a dois clientes, os dois pedidos salvavam sem reclamação, e o
 * segundo faturamento era recusado — depois de o cliente já ter ouvido "sim".
 *
 * A reserva é a ponte entre "prometido" e "baixado".
 *
 * DERIVADA, NÃO GRAVADA
 * ---------------------
 * Não existe tabela de reservas, pelo mesmo motivo de não existir tabela de
 * saldo por depósito nem por cor (ver lib/stock-core.js): seria um número a
 * mais, atualizado por outro caminho, livre para discordar dos pedidos que ele
 * deveria resumir. Um pedido cancelado direto no banco deixaria a reserva presa
 * para sempre. Aqui a reserva É a soma dos pedidos abertos — cancelou, sumiu.
 *
 * QUEM RESERVA
 * ------------
 * Quem é pedido (não orçamento — orçamento é proposta), não está cancelado e
 * ainda não baixou estoque. A regra mora em sales_status.js junto da definição
 * de cada status, porque é lá que se decide o que cada um significa; repetir a
 * lista aqui faria um status novo nascer sem reserva e ninguém notar.
 */
const salesStatus = require('../public/modules/shared/sales_status');

/** Chave de agregação: o mesmo produto em cores diferentes são reservas diferentes. */
function chave(productId, classValueId) {
  return `${productId}|${classValueId || ''}`;
}

/**
 * Soma as reservas dos pedidos.
 *
 * `ignorarPedidoId` existe porque a pergunta que a tela faz é sempre "quanto
 * sobra para MIM": ao editar um pedido, o que ele mesmo já reservava não pode
 * contar como concorrência — senão aumentar de 3 para 4 unidades compararia o
 * novo total contra um saldo do qual as 3 antigas já foram descontadas, e a
 * própria reserva do pedido bloquearia sua edição.
 */
function calcularReservas(orders, { ignorarPedidoId = '' } = {}) {
  const porChave = new Map();
  const porProduto = new Map();
  const pedidos = new Map();

  for (const order of (orders || [])) {
    if (!order || (ignorarPedidoId && order.id === ignorarPedidoId)) continue;
    if (!salesStatus.reservaEstoque(order.status)) continue;
    for (const item of (order.items || [])) {
      const quantidade = Number(item.quantity || 0);
      if (!item.productId || !(quantidade > 0)) continue;
      const k = chave(item.productId, item.classValueId);
      porChave.set(k, (porChave.get(k) || 0) + quantidade);
      porProduto.set(item.productId, (porProduto.get(item.productId) || 0) + quantidade);
      // Guardado para a tela conseguir dizer QUEM reservou. "8 reservados" sem
      // dizer em qual pedido não dá o que fazer a quem precisa liberar.
      if (!pedidos.has(k)) pedidos.set(k, []);
      pedidos.get(k).push({ id: order.id, code: order.code, quantity: quantidade, status: order.status });
    }
  }

  return { porChave, porProduto, pedidos };
}

/** Quanto está reservado de um produto (opcionalmente de uma cor só). */
function reservado(reservas, productId, classValueId) {
  if (!reservas) return 0;
  if (classValueId) return reservas.porChave.get(chave(productId, classValueId)) || 0;
  return reservas.porProduto.get(productId) || 0;
}

/**
 * O número que a venda precisa: saldo menos o que já está prometido.
 *
 * Pode ficar NEGATIVO, e fica de propósito. Estoque prometido além do que
 * existe é um fato — aconteceu antes de a reserva existir, ou por baixa manual
 * depois do pedido. Cortar em zero esconderia o rombo justamente de quem
 * precisa vê-lo para resolver.
 */
function disponivel(saldo, reservas, productId, classValueId) {
  return Number(saldo || 0) - reservado(reservas, productId, classValueId);
}

/** Pedidos que seguram um produto/cor, do maior para o menor. */
function quemReservou(reservas, productId, classValueId) {
  if (!reservas) return [];
  const lista = reservas.pedidos.get(chave(productId, classValueId)) || [];
  return [...lista].sort((a, b) => b.quantity - a.quantity);
}

module.exports = { calcularReservas, reservado, disponivel, quemReservou, chave };
