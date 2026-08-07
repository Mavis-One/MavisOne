-- =============================================================================
-- CONSOLIDADO — este arquivo só junta as migrações abaixo para colar de uma
--  vez; quem manda são os arquivos de fase, e o verificador ignora este aqui.
--  MIGRAÇÕES PENDENTES — gerado por scripts/verificar-migracoes.js
--
--  Cole tudo de uma vez no SQL Editor do Supabase e execute.
--  Cada instrução usa "if not exists" / "if exists": rodar duas vezes não
--  causa dano, e a ordem entre os blocos já está correta.
--
--  O que estava faltando (varredura de hoje):
--    Fase H — campos financeiros do Pedido/Orçamento (desconto, frete, comissões)
--    Fase I — seção "Informações Gerais"
--    Fase J — cabeçalho da aba Dados (origem, categoria, tabela de preços)
--    Fase K — abas Pagamentos, Entrega e Termos
--    Fase N — NF-e no Supabase: FK das parcelas + índices
--    Fase O — pedido faturado gera contas a receber
--
--  Sem elas o sistema funciona, mas DESCARTA em silêncio tudo que for digitado
--  nesses campos — é o que está acontecendo hoje.
-- =============================================================================

-- >>> fase-h-campos-financeiros.sql
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


-- >>> fase-i-informacoes-gerais.sql
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


-- >>> fase-j-cabecalho-dados.sql
-- ---------------------------------------------------------------------------
-- Fase J — cabeçalho da aba "Dados" do Pedido/Orçamento
--
-- Classificação da venda que o formulário passou a pedir junto de cliente,
-- empresa, depósito e vendedor: origem da venda (venda direta, televendas,
-- e-commerce...), categoria e tabela de preços.
--
-- sale_origin nasce com 'Venda Direta' porque é o caso normal — os registros
-- antigos, criados antes deste campo existir, ficam classificados assim em vez
-- de aparecerem em branco na tela.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists sale_origin text not null default 'Venda Direta';
alter table if exists orders add column if not exists category text not null default '';
alter table if exists orders add column if not exists price_table text not null default '';

alter table if exists quotes add column if not exists sale_origin text not null default 'Venda Direta';
alter table if exists quotes add column if not exists category text not null default '';
alter table if exists quotes add column if not exists price_table text not null default '';


-- >>> fase-k-abas-pagamento-entrega.sql
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


-- >>> fase-n-nfe-no-supabase.sql
-- ---------------------------------------------------------------------------
-- Fase N — NF-e sai do data/db.json e passa a viver no Supabase
--
-- As tabelas `nfes` e `nfe_items` já existiam desde a Fase A, sem nenhuma rota
-- usando. Agora emitir, listar, abrir e cancelar NF-e passa pelo banco.
--
-- Com a nota no Supabase, a FK que a Fase M precisou derrubar volta: uma
-- parcela só pode apontar para uma NF-e que exista de verdade. É a checagem que
-- impede parcela órfã — e parcela órfã de documento fiscal é exatamente o tipo
-- de inconsistência que ninguém percebe até a conferência do contador.
--
-- O `not valid` é de propósito: valida da migração para frente sem varrer as
-- linhas antigas, para o caso de haver parcela gravada durante a janela em que
-- a Fase M rodou e esta ainda não. Para exigir a checagem também no passado
-- (recomendado depois de conferir que não sobrou nada), rode:
--
--   alter table financial_entries validate constraint financial_entries_nfe_id_fkey;
--
-- Se essa validação acusar erro, existe parcela apontando para NF-e que não
-- está no banco — investigue antes de forçar.
-- ---------------------------------------------------------------------------
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

alter table if exists financial_entries
  add constraint financial_entries_nfe_id_fkey
  foreign key (nfe_id) references nfes (id)
  not valid;

-- A listagem de NF-e ordena por data e filtra por status; os itens são sempre
-- buscados por nota.
create index if not exists idx_nfes_date on nfes (date desc);
create index if not exists idx_nfes_status on nfes (status);


-- >>> fase-o-pedido-gera-financeiro.sql
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
