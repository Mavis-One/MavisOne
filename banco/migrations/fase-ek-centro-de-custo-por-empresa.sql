-- ============================================================================
-- FASE EK — CENTRO DE CUSTO VINCULADO ÀS EMPRESAS
-- ============================================================================
--
-- Pedido do usuário (14/10/2026): o usuário do Financeiro cria o centro de
-- custo, dá o nome e vincula as empresas/filiais (estabelecimentos) em que ele
-- vale. No lançamento, o campo Centro de custo mostra os centros da empresa do
-- lançamento.
--
-- Lista vazia = vale para todas as empresas: é como ficam os centros que já
-- existiam antes desta fase, e eles continuam aparecendo em todo lançamento.
-- Uma coluna de array, e não uma tabela de ligação, porque a lista é pequena
-- (as filiais do grupo) e é sempre lida inteira junto com o centro.
-- ============================================================================

alter table cost_centers
  add column if not exists estabelecimento_ids text[] not null default '{}';

comment on column cost_centers.estabelecimento_ids is
  'Estabelecimentos (empresas/filiais) em que o centro de custo vale. Vazio = todos.';
