-- ---------------------------------------------------------------------------
-- Fase I — seção "Informações Gerais" do Pedido/Orçamento
--
-- O formulário ganhou um bloco de acompanhamento abaixo dos descontos e
-- despesas: hora do cadastro, status/contato do cliente, código da ordem de
-- compra do cliente, os três e-mails de envio, data de aprovação, pedido
-- relacionado, número da revisão e a chave "Gerar Ordem de Serviço".
--
-- updated_by_name guarda quem fez a última alteração ("Alterado por" na tela);
-- a data correspondente já vinha de updated_at.
--
-- approval_date é `date` e aceita null — o campo fica vazio até o orçamento ser
-- aprovado, e string vazia não faz cast para date no Postgres.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists registration_time text not null default '';
alter table if exists orders add column if not exists client_status text not null default '';
alter table if exists orders add column if not exists client_contact text not null default '';
alter table if exists orders add column if not exists customer_po_code text not null default '';
alter table if exists orders add column if not exists recipient_email text not null default '';
alter table if exists orders add column if not exists billing_recipient_email text not null default '';
alter table if exists orders add column if not exists commercial_recipient_email text not null default '';
alter table if exists orders add column if not exists approval_date date;
alter table if exists orders add column if not exists related_order_code numeric not null default 0;
alter table if exists orders add column if not exists revision_number numeric not null default 0;
alter table if exists orders add column if not exists generate_service_order boolean not null default false;
alter table if exists orders add column if not exists updated_by_name text not null default '';

alter table if exists quotes add column if not exists registration_time text not null default '';
alter table if exists quotes add column if not exists client_status text not null default '';
alter table if exists quotes add column if not exists client_contact text not null default '';
alter table if exists quotes add column if not exists customer_po_code text not null default '';
alter table if exists quotes add column if not exists recipient_email text not null default '';
alter table if exists quotes add column if not exists billing_recipient_email text not null default '';
alter table if exists quotes add column if not exists commercial_recipient_email text not null default '';
alter table if exists quotes add column if not exists approval_date date;
alter table if exists quotes add column if not exists related_order_code numeric not null default 0;
alter table if exists quotes add column if not exists revision_number numeric not null default 0;
alter table if exists quotes add column if not exists generate_service_order boolean not null default false;
alter table if exists quotes add column if not exists updated_by_name text not null default '';
