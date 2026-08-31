-- ---------------------------------------------------------------------------
-- Fase K — abas Pagamentos, Entrega e Termos e Condições do Pedido/Orçamento
--
-- São blocos de formulário (plano de conta, forma de pagamento, parcelas,
-- transportadora, endereço de entrega, termos de venda). Guardados como jsonb
-- em vez de ~30 colunas soltas: ninguém filtra pedido por "bairro de entrega",
-- e cada campo novo da tela deixaria de exigir migração.
--
-- O servidor copia chave por chave antes de gravar (salesPaymentInfo,
-- salesPaymentLines e salesDelivery em server.js) — o jsonb não é o objeto cru
-- que veio do navegador.
--
--   payment_info: objeto único   { accountPlan, paymentMethodId, paymentTerm... }
--   payments:     lista          [ { methodId, methodName, dueDate, amount, note } ]
--   delivery:     objeto único   { addressType, carrierId, zipCode, city... }
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists payment_info jsonb not null default '{}'::jsonb;
alter table if exists orders add column if not exists payments jsonb not null default '[]'::jsonb;
alter table if exists orders add column if not exists delivery jsonb not null default '{}'::jsonb;
alter table if exists orders add column if not exists sales_terms text not null default '';

alter table if exists quotes add column if not exists payment_info jsonb not null default '{}'::jsonb;
alter table if exists quotes add column if not exists payments jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists delivery jsonb not null default '{}'::jsonb;
alter table if exists quotes add column if not exists sales_terms text not null default '';
