-- ---------------------------------------------------------------------------
-- Fase O — pedido faturado gera contas a receber
--
-- Até aqui, faturar um pedido mexia no estoque e parava por aí: o Financeiro
-- nunca ficava sabendo. Quem quisesse a receita tinha que lançar à mão, e
-- pedido cancelado deixava a cobrança viva.
--
-- `finance_applied` é a irmã de `stock_applied`: marca que aquele pedido JÁ
-- gerou as parcelas. Sem ela, salvar de novo um pedido já faturado geraria
-- cobrança dobrada — e cobrança dobrada é o tipo de erro que chega no cliente.
--
-- As parcelas saem da aba "Pagamentos" do pedido quando ela estiver preenchida
-- (uma conta a receber por linha, com a forma e o vencimento combinados); sem
-- nada preenchido, sai uma parcela única no total da venda. O vínculo é o
-- `reference_id` do lançamento, que guarda o id do pedido.
--
-- quotes recebe a coluna junto porque orders e quotes compartilham o mesmo
-- construtor de linha no código — orçamento nunca fatura, então lá ela fica
-- sempre falsa.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists finance_applied boolean not null default false;
alter table if exists quotes add column if not exists finance_applied boolean not null default false;

-- O cancelamento de um pedido procura as parcelas dele por reference_id.
create index if not exists idx_financial_entries_reference_id on financial_entries (reference_id);
