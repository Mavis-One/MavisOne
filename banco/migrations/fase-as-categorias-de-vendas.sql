-- ============================================================================
-- FASE AS — Categoria de venda vira cadastro próprio
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- O campo "Categoria" do pedido era preenchido com a lista de CATEGORIAS DE
-- PRODUTO do Estoque:
--
--   options: (meta.productCategories || []).map((c) => ({ value: c.name, ... }))
--
-- Não foi descuido: o comentário na rota conta que antes era texto livre, e
-- apontar para um cadastro existente foi o que se tinha à mão. Só que os dois
-- catálogos respondem perguntas diferentes. "Parafusos" classifica o que se
-- vende; "Varejo", "Atacado", "Bonificação", "Garantia" classificam a venda.
-- Misturados, nenhum relatório fecha por nenhum dos dois critérios — e a lista
-- de categorias de produto cresce com nomes que não são produto nenhum.
--
-- POR QUE UMA TABELA, E NÃO MAIS UMA COLEÇÃO NO data/db.json
-- -----------------------------------------------------------
-- As irmãs dela (productCategories, priceTables, saleStatuses) moram no
-- db.json, então a consistência pediria o arquivo. A correção pede o banco.
--
-- Esta categoria é referenciada por `orders`, que é tabela do Postgres. Catálogo
-- em arquivo referenciado por linha em tabela é exatamente a divisão que a fase
-- AP desfez no razão de estoque: sem transação, sem o pg_dump enxergar, e com
-- duas requisições simultâneas apagando o trabalho uma da outra ao reescrever o
-- arquivo inteiro.
--
-- POR QUE `orders.category` CONTINUA GUARDANDO O NOME
-- ----------------------------------------------------
-- Porque já guarda, e há pedidos gravados assim. Trocar para o id exigiria
-- reescrever o histórico e mudar o filtro da lista de vendas, que compara
-- texto — duas mudanças que não têm a ver com o pedido "criar a tela".
--
-- O preço disso está dito em voz alta: renomear uma categoria NÃO renomeia nos
-- pedidos antigos. A tela avisa quem for renomear.
--
-- A SEMEADURA VEM DOS PEDIDOS, NÃO DAS CATEGORIAS DE PRODUTO
-- -----------------------------------------------------------
-- Copiar productCategories para cá levaria junto o erro que esta fase corrige.
-- O que se copia é o que os pedidos REALMENTE usam hoje — e só isso, porque é
-- só isso que precisa continuar aparecendo no formulário. Sem essa semeadura,
-- um pedido categorizado "Parafusos" abriria com o campo em branco (o valor
-- sobrevive no campo oculto, mas quem edita vê vazio e acha que se perdeu).

create table if not exists sales_categories (
  id            text primary key,
  name          text not null,
  code          text not null default '',
  -- 'ativo' | 'inativo'. Inativa some do formulário e continua no histórico —
  -- excluir uma categoria em uso deixaria pedidos apontando para um nome que
  -- ninguém mais sabe de onde veio.
  status        text not null default 'ativo',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- "Varejo" e "varejo" são a mesma categoria, e é justamente a duplicata por
-- caixa que o texto livre criava. O índice é sobre lower(name) porque comparar
-- no aplicativo deixaria passar as duas quando gravadas ao mesmo tempo.
create unique index if not exists idx_sales_categories_nome
  on sales_categories (lower(name));

create index if not exists idx_sales_categories_status on sales_categories (status);

-- ----------------------------------------------------------------------------
-- Semeadura: o que os pedidos já usam
-- ----------------------------------------------------------------------------
-- `on conflict do nothing` contra o índice de nome: rodar a migração duas vezes
-- não pode duplicar nem falhar. E o distinct é sobre o nome em minúsculas para
-- que "Revenda" e "revenda", se existirem os dois no histórico, virem UMA.
insert into sales_categories (id, name, notes)
select
  'cat-venda-' || md5(lower(trim(o.category))),
  min(trim(o.category)),
  'Criada a partir dos pedidos que já usavam este nome (fase AS).'
from orders o
where coalesce(trim(o.category), '') <> ''
group by lower(trim(o.category))
on conflict do nothing;

-- RLS: ver o cabeçalho da fase-af.
alter table if exists sales_categories enable row level security;
