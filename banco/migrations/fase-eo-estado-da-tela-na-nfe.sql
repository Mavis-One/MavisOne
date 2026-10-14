-- ============================================================================
-- FASE EO — A NOTA RECUSADA VOLTA À EMISSÃO COMO ESTAVA
-- ============================================================================
--
-- Pedido do usuário (14/10/2026): "quando uma nota fiscal der erro, mostrar o
-- motivo do erro em pop up e me permita entrar dentro dela pra conseguir
-- editar o que já foi feito".
--
-- `payload_enviado` é o que foi à Focus, no formato dela: não diz o que a
-- tela tinha (aba aberta, valores fiscais editados, transporte, cobrança).
-- Esta coluna guarda o estado da tela de emissão no momento de emitir — o
-- mesmo formato da nota em edição (fase EL) —, e é ele que "Corrigir nota"
-- devolve à emissão. Notas anteriores ficam vazias: para elas a correção
-- remonta destinatário e itens a partir do payload_enviado.
--
-- Nada é apagado: a nota com erro continua no histórico (nunca excluir
-- documento fiscal); a corrigida sai como nova emissão.
-- ============================================================================

alter table nfe
  add column if not exists estado_da_tela jsonb;

comment on column nfe.estado_da_tela is
  'Estado da tela de emissão ao emitir (formato da nota em edição, fase EL). Usado para corrigir nota com erro.';
