-- ============================================================================
-- FASE EX — A TRAVA DE PAGAMENTO DA NF-e DESLIGADA (o novo padrão)
-- ============================================================================
--
-- Pedido do usuário (20/10/2026), depois do deploy da fase ES, sobre o aviso
-- "Pagamento do pedido não confirmado ... a NF-e exige o pedido inteiro
-- recebido" e a janela "Emitir mesmo assim": "corrija isso, não quero que
-- apareça".
--
-- A trava não sai do sistema: ganha a política 'desligada', que passa a ser a
-- padrão e a gravada. Com ela, a regra não se aplica a pedido nenhum
-- (lib/faturamento-gate.js) — sem aviso, sem "Emitir mesmo assim", sem selo
-- de pagamento — e a NF-e sai como antes da fase ES. Religar é escolher outra
-- política em Configurações › Liberação da NF-e.
-- ============================================================================

alter table if exists faturamento_config drop constraint if exists faturamento_config_politica_check;
alter table if exists faturamento_config add constraint faturamento_config_politica_check
  check (politica in ('desligada', 'integral', 'entrada', 'percentual'));
alter table if exists faturamento_config alter column politica set default 'desligada';

update faturamento_config
   set politica = 'desligada',
       atualizado_em = now(),
       atualizado_por_nome = 'Fase EX (pedido do usuário: trava desligada)'
 where id = 1;
