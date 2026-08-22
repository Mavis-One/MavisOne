-- ---------------------------------------------------------------------------
-- Fase AH — Grupos de Produtos no pedido e no orcamento
--
-- O pedido passa a ter 1..N grupos ("Grupo de Produtos Padrao - 01",
-- renomeavel), cada um com seus itens e seu total.
--
-- MODELO: o grupo e METADADO sobre a lista PLANA de itens que ja existe, e nao
-- um nivel a mais dentro dela.
--
--   items          [ {..., "groupId": "grp-a"}, {..., "groupId": "grp-b"} ]
--   product_groups [ {"id":"grp-a","name":"...","ordem":0}, ... ]
--
-- O pedido inteiro ja e lido como lista plana de itens em muitos lugares --
-- baixa de estoque, reserva, totais, payload da NF-e, tabela de precos.
-- Aninhar os itens dentro dos grupos obrigaria todos eles a saber de grupo so
-- para somar uma quantidade, e cada um que esquecesse passaria a ignorar tudo
-- que nao estivesse no primeiro grupo -- em silencio, que e o pior jeito de
-- errar estoque. Um campo a mais dentro do item e ignorado por quem nao se
-- importa, que e a maioria.
--
-- Esta migracao e ADITIVA: nao mexe em `items`, nao apaga nada e nao muda tipo
-- de coluna. Pedido gravado antes dela continua valido -- fica com
-- product_groups = [] e, na primeira leitura, a normalizacao poe todos os itens
-- num grupo padrao. Nenhum item se perde por nao ter groupId.
--
-- Vale para as DUAS tabelas: orcamento vira pedido sem trocar de tabela, e um
-- orcamento que perdesse os grupos ao ser aprovado seria pior do que nunca
-- te-los tido.
-- ---------------------------------------------------------------------------

alter table if exists orders add column if not exists product_groups jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists product_groups jsonb not null default '[]'::jsonb;

comment on column orders.product_groups is
  'Grupos de produtos do pedido: [{"id","name","ordem"}]. Os itens ficam em `items`, cada um com "groupId" apontando para um destes. Lista vazia = pedido de antes da fase AH; a leitura cria o grupo padrao.';

comment on column quotes.product_groups is
  'Grupos de produtos do orcamento: [{"id","name","ordem"}]. Mesmo formato de orders.product_groups.';
