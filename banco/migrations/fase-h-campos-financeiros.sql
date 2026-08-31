-- ---------------------------------------------------------------------------
-- Fase H — campos financeiros do Pedido/Orçamento
--
-- O formulário passou a ter descontos combinados (% + R$), frete com as chaves
-- "fixar" e "cobrar do comprador", despesas gerais, taxa de montagem, serviços
-- e comissões. Sem estas colunas os valores eram calculados na tela e perdidos
-- ao salvar — o registro reabria com os campos zerados.
--
-- discount_total, seller_commission, agent_commission e total_weight são
-- derivados: guardados para relatório e conferência histórica, mas sempre
-- recalculados pelo servidor a cada gravação (o cliente nunca dita o total).
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists freight_fixed boolean not null default false;
alter table if exists orders add column if not exists charge_freight_to_buyer boolean not null default true;
alter table if exists orders add column if not exists general_expenses numeric not null default 0;
alter table if exists orders add column if not exists assembly_fee numeric not null default 0;
alter table if exists orders add column if not exists services_amount numeric not null default 0;
alter table if exists orders add column if not exists seller_commission_percent numeric not null default 0;
alter table if exists orders add column if not exists agent_commission_percent numeric not null default 0;
alter table if exists orders add column if not exists discount_total numeric not null default 0;
alter table if exists orders add column if not exists seller_commission numeric not null default 0;
alter table if exists orders add column if not exists agent_commission numeric not null default 0;
alter table if exists orders add column if not exists total_weight numeric not null default 0;

alter table if exists quotes add column if not exists freight_fixed boolean not null default false;
alter table if exists quotes add column if not exists charge_freight_to_buyer boolean not null default true;
alter table if exists quotes add column if not exists general_expenses numeric not null default 0;
alter table if exists quotes add column if not exists assembly_fee numeric not null default 0;
alter table if exists quotes add column if not exists services_amount numeric not null default 0;
alter table if exists quotes add column if not exists seller_commission_percent numeric not null default 0;
alter table if exists quotes add column if not exists agent_commission_percent numeric not null default 0;
alter table if exists quotes add column if not exists discount_total numeric not null default 0;
alter table if exists quotes add column if not exists seller_commission numeric not null default 0;
alter table if exists quotes add column if not exists agent_commission numeric not null default 0;
alter table if exists quotes add column if not exists total_weight numeric not null default 0;
