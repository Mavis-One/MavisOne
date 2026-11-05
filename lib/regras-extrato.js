/**
 * AS REGRAS DO EXTRATO (04/11/2026).
 *
 * Pedido do usuário: o que nunca tem título — tarifa, IOF, juros, transferência
 * entre contas, aplicação e resgate — não deve ficar para conciliar à mão. Uma
 * regra diz "a descrição contém TARIFA" e o que fazer:
 *
 *   · lancar  — cria o lançamento (plano de contas, centro de custo e
 *               estabelecimento da regra), dá a baixa e concilia;
 *   · ignorar — marca a movimentação como ignorada (transferência entre as
 *               próprias contas, aplicação, resgate).
 *
 * Só vale para movimentação que NÃO casou com título nem virou sugestão: a
 * regra é o último passo da conciliação automática, nunca passa por cima de um
 * título. Entre duas regras que servem, vale a de texto mais longo (a mais
 * específica: "TARIFA PIX" antes de "TARIFA").
 *
 * Mora fora do server.js para o teste rodar sem subir o servidor
 * (scripts/test-regras-extrato.js). As regras ficam no db.json, ao lado das
 * movimentações do extrato.
 */
'use strict';

const TIPOS = ['entrada', 'saida', 'ambos'];
const ACOES = ['lancar', 'ignorar'];

const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

const limpo = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * O que veio da tela vira regra, ou { erro }. Não confere se o plano, o centro
 * e o estabelecimento existem — isso é do servidor, que tem o cadastro.
 */
function validarRegra(payload = {}) {
  const texto = limpo(payload.texto, 120);
  if (normalizar(texto).length < 3) return { erro: 'Informe o texto que a descrição do extrato contém (3 letras ou mais).' };
  const tipo = TIPOS.includes(payload.tipo) ? payload.tipo : '';
  if (!tipo) return { erro: 'Escolha se a regra vale para entrada, saída ou as duas.' };
  const acao = ACOES.includes(payload.acao) ? payload.acao : '';
  if (!acao) return { erro: 'Escolha o que a regra faz: lançar e conciliar, ou ignorar.' };
  if (acao === 'lancar' && tipo === 'ambos') {
    return { erro: 'Para lançar, a regra é de entrada ou de saída: o lançamento é uma receita ou uma despesa.' };
  }
  const category = limpo(payload.category, 80);
  if (acao === 'lancar' && !category) return { erro: 'Escolha o plano de contas do lançamento.' };
  return {
    regra: {
      texto,
      tipo,
      acao,
      category: acao === 'lancar' ? category : '',
      costCenter: acao === 'lancar' ? limpo(payload.costCenter, 80) : '',
      estabelecimentoId: acao === 'lancar' ? limpo(payload.estabelecimentoId, 80) : '',
      bankAccountId: limpo(payload.bankAccountId, 80),
      descricao: acao === 'lancar' ? limpo(payload.descricao, 200) : '',
      ativa: payload.ativa !== false
    }
  };
}

/** A regra que vale para a movimentação { description, type, bankAccountId }, ou null. */
function regraQueCasa(regras, tx) {
  const descricao = normalizar(tx && tx.description);
  if (!descricao) return null;
  const tipo = tx.type === 'entrada' ? 'entrada' : 'saida';
  const servem = (regras || []).filter((r) => r && r.ativa !== false
    && (r.tipo === 'ambos' || r.tipo === tipo)
    && (!r.bankAccountId || String(r.bankAccountId) === String(tx.bankAccountId || ''))
    && normalizar(r.texto).length >= 3
    && descricao.includes(normalizar(r.texto)));
  // A mais específica: o texto mais longo; empate, a de conta definida.
  servem.sort((a, b) => normalizar(b.texto).length - normalizar(a.texto).length
    || Number(Boolean(b.bankAccountId)) - Number(Boolean(a.bankAccountId)));
  return servem[0] || null;
}

module.exports = { TIPOS, ACOES, normalizar, validarRegra, regraQueCasa };
