/**
 * A LISTA DE PERMISSÃO ENTRE CONTA BANCÁRIA E ESTABELECIMENTO (fase CD).
 *
 * Tabela de duas colunas e nenhuma regra: a regra mora em
 * public/modules/shared/contas_por_estabelecimento.js, lida também pelo
 * navegador. Aqui só se lê e se grava o que alguém decidiu.
 *
 * A GRAVAÇÃO É UM TROCA-TUDO, e não um "adiciona/remove"
 * -----------------------------------------------------
 * A tela manda a matriz inteira, e esta camada apaga o que havia e grava o que
 * veio, numa transação. É o formato certo para uma tela de marcar caixas: o que
 * a pessoa vê ao clicar em Salvar é exatamente o estado final, sem depender de
 * o servidor adivinhar quais caixas mudaram desde que a tela carregou.
 *
 * Sem a transação, uma falha no meio deixaria a matriz pela metade — e "pela
 * metade" aqui significa contas que ninguém mais pode usar, descobertas uma a
 * uma por quem for lançar.
 */
const { banco, assertNoError } = require('./client');
const { emTransacao } = require('./conexao');

function mapVinculoRow(row) {
  if (!row) return null;
  return {
    contaId: row.bank_account_id,
    estabelecimentoId: row.estabelecimento_id,
    criadoEm: row.criado_em
  };
}

/**
 * Todos os vínculos. A tabela tem uma linha por par marcado — com 10 contas e 5
 * estabelecimentos são no máximo 50 linhas, então não há o que paginar.
 */
async function listarVinculos() {
  const { data, error } = await banco.from('conta_estabelecimento').select('*');
  assertNoError(error, 'listarVinculos');
  return (data || []).map(mapVinculoRow);
}

/**
 * Substitui a matriz inteira. `pares` é [{ contaId, estabelecimentoId }].
 *
 * Devolve quantas linhas ficaram, que é o que a tela mostra na confirmação —
 * um número vindo do banco, e não a contagem do que a tela achou que mandou.
 */
async function salvarVinculos(pares) {
  // Par repetido viraria violação da chave primária. Acontece de verdade:
  // duas marcações da mesma caixa numa tela que rerenderiza.
  const unicos = new Map();
  for (const par of pares || []) {
    const contaId = String((par && par.contaId) || '').trim();
    const estabelecimentoId = String((par && par.estabelecimentoId) || '').trim();
    if (!contaId || !estabelecimentoId) continue;
    unicos.set(`${contaId} ${estabelecimentoId}`, { contaId, estabelecimentoId });
  }

  await emTransacao(async (cliente) => {
    await cliente.query('delete from conta_estabelecimento');
    for (const { contaId, estabelecimentoId } of unicos.values()) {
      await cliente.query(
        'insert into conta_estabelecimento (bank_account_id, estabelecimento_id) values ($1, $2)',
        [contaId, estabelecimentoId]
      );
    }
  });

  return unicos.size;
}

/**
 * Tira uma conta da configuração manual: ela volta a seguir a regra padrão.
 * É o "voltar ao automático" de uma linha só, sem mexer nas outras.
 */
async function limparConta(contaId) {
  const { error } = await banco.from('conta_estabelecimento').delete().eq('bank_account_id', contaId);
  assertNoError(error, 'limparConta');
}

module.exports = { listarVinculos, salvarVinculos, limparConta };
