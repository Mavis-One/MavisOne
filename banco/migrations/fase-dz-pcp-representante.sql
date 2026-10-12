-- ============================================================================
-- FASE DZ — REPRESENTANTE NA ORDEM DE PRODUÇÃO
-- ============================================================================
--
-- Pedido do usuário (12/10/2026): "uma tela para adicionar o novo
-- representante nas ordens PCP". Decidido com ele: o representante é uma
-- PESSOA do Cadastros com o papel "Representante" (como o Vendedor), e não uma
-- lista solta do PCP — assim o mesmo cadastro serve depois para vendas e notas.
--
-- A coluna guarda o id da pessoa (people.id ou cnpjs.id, que são texto). Sem
-- chave estrangeira: o representante pode estar em qualquer das duas tabelas,
-- como o cliente do pedido (orders.client_supplier_id).
-- ============================================================================

alter table if exists pcp_orders add column if not exists representante_id text;

create index if not exists idx_pcp_orders_representante on pcp_orders (representante_id)
  where representante_id is not null;
