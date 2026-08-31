-- ---------------------------------------------------------------------------
-- Fase AF — RLS: trancar a porta publica do PostgREST
--
-- POR QUE ISTO NAO E "filtro por empresa"
--
-- O sistema conecta no Supabase com a chave SERVICE_ROLE (lib/db/client.js), e
-- essa chave IGNORA RLS por completo. Nenhuma politica escrita aqui vai
-- filtrar uma query nossa. Quem separa empresa continua sendo o codigo, no
-- portao de permissoes — e e la que essa regra deve ser lida e corrigida.
--
-- O QUE ISTO RESOLVE, ENTAO
--
-- Um projeto Supabase expoe o PostgREST na internet, e a chave "anon" e
-- publica por natureza (ela nasceu para ir dentro do navegador). Com RLS
-- DESLIGADA, os papeis anon e authenticated enxergam as tabelas do schema
-- public. Ou seja: hoje qualquer um com essa chave le users, people, orders,
-- nfe e certificado_digital.
--
-- Conferido em 22/08/2026: zero "enable row level security" e zero
-- "create policy" no schema. E so o servidor fala com o Supabase — nao existe
-- cliente Supabase no navegador (conferido em public/), entao ligar RLS nao
-- quebra tela nenhuma.
--
-- O DESENHO
--
-- Liga RLS nas 77 tabelas e NAO cria politica permissiva. Sem politica, o
-- Postgres nega tudo para anon e authenticated; service_role passa por cima,
-- como sempre passou. O app continua identico e a porta da rua fecha.
--
-- Se um dia alguma tela falar direto com o Supabase (usando o Auth dele), ai
-- sim entram politicas por usuario — e ai existira um auth.uid() para elas
-- consultarem, coisa que hoje nao existe.
--
-- A LISTA E CONFERIDA, NAO CHUTADA
--
-- Os nomes saem de um levantamento contra o banco. A primeira sonda usou
-- head:true e o PostgREST engoliu o erro de tabela inexistente: deu "78 de 78
-- existem", incluindo uma tabela "em" que na verdade veio de um comentario em
-- portugues ("ALTER TABLE em nfe_itens"). Refeita sem head:true, sobraram 77.
--
-- COMO VOLTAR ATRAS
--
--   alter table <nome> disable row level security;
--
-- Nao mexe em dado nenhum: so liga uma trava, tabela a tabela, reversivel do
-- mesmo jeito.
-- ---------------------------------------------------------------------------
alter table if exists access_logs enable row level security;
alter table if exists account_balances enable row level security;
alter table if exists audit_logs enable row level security;
alter table if exists bank_accounts enable row level security;
alter table if exists bank_cards enable row level security;
alter table if exists bank_transactions enable row level security;
alter table if exists card_transactions enable row level security;
alter table if exists certificado_digital enable row level security;
alter table if exists cfop enable row level security;
alter table if exists classificacao_tributaria enable row level security;
alter table if exists cnpjs enable row level security;
alter table if exists contract_templates enable row level security;
alter table if exists contract_types enable row level security;
alter table if exists contracts enable row level security;
alter table if exists cost_centers enable row level security;
alter table if exists crm_connection enable row level security;
alter table if exists csosn enable row level security;
alter table if exists cst_ibs_cbs enable row level security;
alter table if exists cst_icms enable row level security;
alter table if exists cst_ipi enable row level security;
alter table if exists cst_pis_cofins enable row level security;
alter table if exists declaracao_importacao enable row level security;
alter table if exists deposits enable row level security;
alter table if exists di_adicao enable row level security;
alter table if exists empresa enable row level security;
alter table if exists estabelecimento enable row level security;
alter table if exists financial_categories enable row level security;
alter table if exists financial_entries enable row level security;
alter table if exists financial_institutions enable row level security;
alter table if exists financial_payments enable row level security;
alter table if exists fleet_maintenances enable row level security;
alter table if exists fleet_refuels enable row level security;
alter table if exists fleet_vehicles enable row level security;
alter table if exists grupo_economico enable row level security;
alter table if exists hr_departments enable row level security;
alter table if exists hr_employee_categories enable row level security;
alter table if exists hr_employee_types enable row level security;
alter table if exists hr_employees enable row level security;
alter table if exists hr_leaves enable row level security;
alter table if exists hr_positions enable row level security;
alter table if exists hr_time_entries enable row level security;
alter table if exists hr_work_schedules enable row level security;
alter table if exists import_logs enable row level security;
alter table if exists nfe enable row level security;
alter table if exists nfe_arquivos enable row level security;
alter table if exists nfe_eventos enable row level security;
alter table if exists nfe_items enable row level security;
alter table if exists nfes enable row level security;
alter table if exists open_finance_audit_logs enable row level security;
alter table if exists open_finance_connections enable row level security;
alter table if exists open_finance_webhook_events enable row level security;
alter table if exists orders enable row level security;
alter table if exists origem_mercadoria enable row level security;
alter table if exists pcp_bom enable row level security;
alter table if exists pcp_entries enable row level security;
alter table if exists pcp_orders enable row level security;
alter table if exists pcp_quality_checks enable row level security;
alter table if exists pcp_sectors enable row level security;
alter table if exists pcp_statuses enable row level security;
alter table if exists people enable row level security;
alter table if exists permissions enable row level security;
alter table if exists product_class_assignments enable row level security;
alter table if exists product_class_value_assignments enable row level security;
alter table if exists product_class_values enable row level security;
alter table if exists product_classes enable row level security;
alter table if exists products enable row level security;
alter table if exists purchases enable row level security;
alter table if exists quotes enable row level security;
alter table if exists regra_fiscal enable row level security;
alter table if exists role_permissions enable row level security;
alter table if exists roles enable row level security;
alter table if exists sales enable row level security;
alter table if exists serie_nfe enable row level security;
alter table if exists settings enable row level security;
alter table if exists user_permissions enable row level security;
alter table if exists user_roles enable row level security;
alter table if exists users enable row level security;

-- Conferencia no proprio SQL Editor: esta consulta tem que voltar VAZIA.
--
--   select tablename from pg_tables
--    where schemaname = 'public' and rowsecurity = false;
