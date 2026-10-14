/**
 * A NOTA EM EDIÇÃO, SALVA ANTES DE EMITIR (fase EL, 14/10/2026).
 *
 * É o estado da tela de emissão (destinatário, itens, impostos editados,
 * transporte, cobrança, observações), e não documento fiscal — ver a migração
 * fase-el. Uma por pedido ("pedido:<id>") e uma avulsa por usuário
 * ("avulsa:<id do usuário>").
 */
const { consultar } = require('./conexao');

function chaveDoRascunho({ pedidoId, userId }) {
  return pedidoId ? `pedido:${pedidoId}` : `avulsa:${userId || ''}`;
}

async function lerRascunho(chave) {
  const { rows } = await consultar(
    `select chave, pedido_id, user_name, dados, atualizado_em from nfe_rascunho_emissao where chave = $1`, [chave]);
  const r = rows[0];
  if (!r) return null;
  return { chave: r.chave, pedidoId: r.pedido_id || '', userName: r.user_name || '', dados: r.dados || {}, atualizadoEm: r.atualizado_em };
}

async function salvarRascunho({ chave, pedidoId, userId, userName, dados }) {
  await consultar(
    `insert into nfe_rascunho_emissao (chave, pedido_id, user_id, user_name, dados, atualizado_em)
     values ($1, $2, $3, $4, $5::jsonb, now())
     on conflict (chave) do update set pedido_id = excluded.pedido_id, user_id = excluded.user_id,
       user_name = excluded.user_name, dados = excluded.dados, atualizado_em = now()`,
    [chave, pedidoId || null, userId || null, userName || '', JSON.stringify(dados || {})]);
  return lerRascunho(chave);
}

async function apagarRascunho(chave) {
  const { rowCount } = await consultar('delete from nfe_rascunho_emissao where chave = $1', [chave]);
  return rowCount;
}

module.exports = { chaveDoRascunho, lerRascunho, salvarRascunho, apagarRascunho };
