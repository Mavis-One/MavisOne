-- ============================================================================
-- FASE EU — A LISTA DE TRANSIÇÕES DO BANCO EM DIA COM A DO SISTEMA
-- ============================================================================
--
-- Defeito achado em 19/10/2026, pelo log do VPS de 17/10: uma NF-e foi
-- cancelada e o pedido dela não voltou a "Pedido Não Faturado" — o gatilho
-- orders_status_guarda recusou: "Transicao de status invalida:
-- pedido-faturado nao vira pedido-nao-faturado".
--
-- A volta faturado -> não faturado existe no sistema desde a fase BF
-- (04/09/2026), e foi acrescentada EDITANDO a fase-aj, que já tinha rodado.
-- Migração só roda uma vez por nome: os bancos que já tinham a fase-aj (o do
-- VPS e o local, "adotada" em 15/09) ficaram com a lista antiga. O banco
-- local também não tinha o par — conferido na mesma data.
--
-- Esta regrava a lista inteira, igual a TRANSICOES de
-- public/modules/shared/sales_status.js (scripts/test-transicoes-status.js
-- confere par a par contra a migração MAIS NOVA que grava a lista). Mudou a
-- lista? Migração nova — editar uma que já rodou não chega aos bancos.
--
-- O pedido que ficou faturado com a nota cancelada é refeito pelo servidor
-- ao subir (refazerDesfaturamentosQueFalharam), olhando o razão: em 17/10 o
-- estoque já tinha voltado antes da recusa.
-- ============================================================================

delete from sales_status_transicao;
insert into sales_status_transicao (de, para) values
  ('orcamento', 'pedido'),
  ('orcamento', 'orcamento-aprovado'),
  ('orcamento', 'orcamento-reprovado'),
  ('orcamento-aprovado', 'pedido'),
  ('orcamento-aprovado', 'orcamento-reprovado'),
  ('pedido', 'pedido-nao-faturado'),
  ('pedido', 'pedido-pre-faturado'),
  ('pedido', 'pedido-faturado'),
  ('pedido', 'pedido-aprovado-sem-faturamento'),
  ('pedido', 'pedido-parcialmente-faturado'),
  ('pedido', 'pedido-cancelado'),
  ('pedido-nao-faturado', 'pedido'),
  ('pedido-nao-faturado', 'pedido-pre-faturado'),
  ('pedido-nao-faturado', 'pedido-faturado'),
  ('pedido-nao-faturado', 'pedido-aprovado-sem-faturamento'),
  ('pedido-nao-faturado', 'pedido-cancelado'),
  ('pedido-pre-faturado', 'pedido-faturado'),
  ('pedido-pre-faturado', 'pedido-parcialmente-faturado'),
  ('pedido-pre-faturado', 'pedido-nao-faturado'),
  ('pedido-pre-faturado', 'pedido-cancelado'),
  ('pedido-parcialmente-faturado', 'pedido-faturado'),
  ('pedido-parcialmente-faturado', 'pedido-cancelado'),
  ('pedido-faturado', 'pedido-cancelado'),
  ('pedido-faturado', 'pedido-nao-faturado'),
  ('pedido-aprovado-sem-faturamento', 'pedido-cancelado');
