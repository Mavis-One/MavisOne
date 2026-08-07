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
