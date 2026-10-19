/**
 * A TRAVA DE PAGAMENTO ANTES DA NF-e (19/10/2026).
 *
 * Pedido do usuário: o desenho "Fluxo de Faturamento com confirmação de
 * pagamento antes da NF-e", adaptado ao fluxo que já existe (Aprovar → títulos
 * a receber → conciliação → Gerar NF-e; o estoque continua saindo na
 * autorização). Decidido com ele:
 *
 *   - vale só para a NF-e (modelo 55) de um PEDIDO. A NFC-e do balcão, a nota
 *     avulsa, a devolução, o complemento e o pedido sem títulos (categoria que
 *     não gera financeiro) ficam de fora;
 *   - "recebido" é qualquer baixa no título — a da conciliação bancária e a
 *     manual do Financeiro (o dinheiro do caixa não tem extrato);
 *   - o título de CARTÃO com NSU conta como recebido: o crédito em 10x não pode
 *     travar a nota até a última parcela cair na conta;
 *   - a venda a prazo (boleto, crediário) só sai com "Emitir mesmo assim", de
 *     quem tem a permissão — e o motivo fica na auditoria.
 *
 * ESTA É A REGRA, E SÓ ELA: recebe os títulos já lidos e a política, devolve a
 * decisão. Ler o banco, saber quem pode forçar e recusar a emissão é de quem
 * chama (server.js). Pura, para o teste conferir cada caso sem banco.
 *
 * AS POLÍTICAS (Configurações › Liberação da NF-e):
 *   integral   — 100% do pedido recebido (o padrão);
 *   entrada    — a primeira parcela (a de vencimento mais cedo) recebida;
 *   percentual — pelo menos N% do pedido recebido.
 *
 * TOLERÂNCIA DE MEIO CENTAVO, e só ela: é ruído de arredondamento (três
 * parcelas de 33,33 num pedido de 100,00). Pagamento a menos de verdade — um
 * centavo que seja — continua travando.
 */
'use strict';

const POLITICAS = ['integral', 'entrada', 'percentual'];
const TOLERANCIA_EM_CENTAVOS = 0.5;

const centavos = (valor) => Math.round(Number(valor || 0) * 100);
const reais = (emCentavos) => Math.round(emCentavos) / 100;

/** A política gravada, ou a padrão (integral). Percentual fora de 1–100 vira 100. */
function normalizarPolitica(config) {
  const politica = POLITICAS.includes(String(config && config.politica)) ? config.politica : 'integral';
  const pct = Number(config && config.percentual);
  const percentual = Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : 100;
  return { politica, percentual };
}

/**
 * O quanto de UM título conta como recebido. `titulo`:
 *   { valor, recebido, quitado, cartaoComNsu, cancelado, vencimento }
 * Quitado conta inteiro; cartão com NSU também; senão, o que as baixas somam
 * (nunca mais que o valor do título).
 */
function recebidoDoTitulo(titulo) {
  const valor = centavos(titulo.valor);
  if (titulo.quitado || titulo.cartaoComNsu) return valor;
  return Math.min(valor, Math.max(0, centavos(titulo.recebido)));
}

/**
 * A decisão para um pedido. Devolve:
 *   { aplica, liberado, politica, percentual, total, recebido, exigido, falta, estagio }
 * `aplica` falso = pedido sem título nenhum (categoria que não gera financeiro,
 * ou pedido ainda não aprovado): não há o que esperar, a trava não se mete.
 */
function avaliarLiberacao({ titulos, config } = {}) {
  const { politica, percentual } = normalizarPolitica(config);
  const vivos = (Array.isArray(titulos) ? titulos : [])
    .filter((t) => t && !t.cancelado && centavos(t.valor) > 0);
  if (!vivos.length) {
    return { aplica: false, liberado: true, politica, percentual, total: 0, recebido: 0, exigido: 0, falta: 0, estagio: '' };
  }
  const total = vivos.reduce((s, t) => s + centavos(t.valor), 0);
  const recebido = vivos.reduce((s, t) => s + recebidoDoTitulo(t), 0);
  let exigido;
  let atingido;
  if (politica === 'entrada') {
    // A ENTRADA é o título que vence primeiro (empate: a ordem em que vieram).
    const primeiro = vivos
      .map((t, i) => ({ t, i }))
      .sort((a, b) => String(a.t.vencimento || '').localeCompare(String(b.t.vencimento || '')) || a.i - b.i)[0].t;
    exigido = centavos(primeiro.valor);
    atingido = recebidoDoTitulo(primeiro);
  } else {
    exigido = politica === 'percentual' ? Math.round(total * percentual / 100) : total;
    atingido = recebido;
  }
  const liberado = atingido + TOLERANCIA_EM_CENTAVOS >= exigido;
  return {
    aplica: true,
    liberado,
    politica,
    percentual,
    total: reais(total),
    recebido: reais(recebido),
    exigido: reais(exigido),
    falta: reais(Math.max(0, exigido - atingido)),
    estagio: liberado ? 'liberado_nf' : 'aguardando_pagamento'
  };
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** A frase da recusa, com os números (a tela mostra esta mesma). */
function mensagemDaTrava(resultado) {
  const r = resultado || {};
  const regra = r.politica === 'entrada'
    ? 'a entrada (1ª parcela) recebida'
    : (r.politica === 'percentual' ? `${String(r.percentual).replace('.', ',')}% do pedido recebido` : 'o pedido inteiro recebido');
  return `Pagamento do pedido não confirmado: recebido ${brl(r.recebido)} de ${brl(r.total)}; `
    + `a NF-e exige ${regra} (falta ${brl(r.falta)}). `
    + 'Ela sai quando o Financeiro confirmar o recebimento (conciliação ou baixa).';
}

module.exports = {
  POLITICAS, TOLERANCIA_EM_CENTAVOS,
  normalizarPolitica, recebidoDoTitulo, avaliarLiberacao, mensagemDaTrava
};
