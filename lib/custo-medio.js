/**
 * CUSTO MÉDIO PONDERADO MÓVEL, A PARTIR DO RAZÃO (fase EG, 13/10/2026).
 *
 * O sistema não guardava custo médio: o produto tem um custo só, o do cadastro,
 * sem histórico. O inventário do Viper é valorado a custo médio, e o número dele
 * só é comparável com o daqui se o daqui for calculado do mesmo jeito.
 *
 * O razão já tem o necessário: cada movimento guarda `unit_cost`. Quem grava
 * custo de verdade é a entrada de compra (ordem recebida, NF-e de entrada), a
 * contagem (com o custo do cadastro) e o lançamento manual. A venda grava 0 — e
 * o estorno da venda também —, e isso não é custo zero: é "sem custo".
 *
 * AS REGRAS, por produto, na ordem do razão:
 *   - transferência (transfer_id preenchido) não entra: moveu entre depósitos,
 *     não comprou nem consumiu nada, e o custo médio é do PRODUTO, não do
 *     depósito;
 *   - entrada com custo > 0: médio = (saldo × médio + qtd × custo) ÷ (saldo + qtd).
 *     Com o saldo zerado ou negativo antes dela, o médio passa a ser o custo da
 *     entrada — saldo negativo não tem valor que valha a pena ponderar;
 *   - entrada sem custo: soma ao saldo pelo médio corrente (não mexe nele);
 *   - saída: tira do saldo pelo médio corrente (não mexe nele).
 *
 * Produto que nunca teve entrada com custo até a data fica SEM médio (null), e
 * quem chama decide o que usar — o inventário cai para o custo do cadastro e
 * marca a linha.
 */
'use strict';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {Array<{productId, type, quantity, unitCost, transferId}>} movimentos
 *   já em ordem cronológica (data, depois ordem de lançamento).
 * @returns {Map<string, number|null>} médio por produto.
 */
function custoMedioPorProduto(movimentos) {
  const estado = new Map();
  for (const m of movimentos || []) {
    if (String(m.transferId || '')) continue;
    const id = String(m.productId || '');
    if (!id) continue;
    let e = estado.get(id);
    if (!e) {
      e = { saldo: 0, medio: null };
      estado.set(id, e);
    }
    const qtd = num(m.quantity);
    if (qtd <= 0) continue;
    if (m.type === 'saida') {
      e.saldo -= qtd;
      continue;
    }
    const custo = num(m.unitCost);
    if (custo > 0) {
      e.medio = e.saldo > 0 && e.medio !== null
        ? (e.saldo * e.medio + qtd * custo) / (e.saldo + qtd)
        : custo;
    }
    e.saldo += qtd;
  }
  const medios = new Map();
  for (const [id, e] of estado) medios.set(id, e.medio === null ? null : Math.round(e.medio * 1e6) / 1e6);
  return medios;
}

module.exports = { custoMedioPorProduto };
