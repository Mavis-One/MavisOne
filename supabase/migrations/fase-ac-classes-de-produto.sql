-- ---------------------------------------------------------------------------
-- Fase AC — CLASSES DE PRODUTO (a primeira é COR)
--
-- O PROBLEMA
-- ----------
-- Um mesmo produto existe em cores diferentes, e cada cor tem o próprio
-- saldo. Sem isso, as saídas são: cadastrar quatro produtos ("Godzilla Preto",
-- "Godzilla Branco"...), o que quadruplica o cadastro e quebra qualquer
-- relatório por produto; ou controlar a cor no papel, e o estoque do sistema
-- deixa de valer.
--
-- O DESENHO
-- ---------
--   product_classes                  a classe em si (COR, e amanhã VOLTAGEM)
--   product_class_values             os valores dela (Preto, Branco, ...)
--   product_class_assignments        quais classes ESTE produto usa
--   product_class_value_assignments  quais valores ESTE produto oferece
--
-- Duas camadas de propósito: o catálogo é global (a cor "Preto" é a mesma para
-- todo mundo) e a atribuição é por produto (nem todo produto vem em preto).
-- Sem a separação, cadastrar uma cor nova exigiria repetir a linha em cada
-- produto que a usa.
--
-- O QUE ESTE ARQUIVO NÃO CRIA, E POR QUÊ
-- --------------------------------------
-- A especificação pedia `product_stock_classes`, com o saldo por cor gravado.
-- Aqui o saldo por depósito NÃO é gravado: ele é derivado da soma do razão de
-- movimentos (ver depositBalance em lib/stock-core.js). Uma tabela de saldo
-- por cor seria um TERCEIRO número, capaz de discordar do razão e de
-- products.stock_quantity — exatamente a inconsistência que o §8 da própria
-- especificação proíbe.
--
-- O saldo por cor vem da mesma soma que já produz o saldo por depósito, com a
-- cor gravada no movimento. Dois números que saem do mesmo cálculo não têm
-- como divergir.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ================================ CLASSES ==================================
create table if not exists product_classes (
  id text primary key,
  -- NULO = vale para todas as empresas, que é o caso de COR.
  -- `products` não tem empresa: um produto é global neste sistema. Uma classe
  -- obrigatoriamente por empresa deixaria produto global apontando para classe
  -- de uma empresa só — inconsistência sem dono.
  company_id text,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duas classes "COR" na mesma empresa seriam indistinguíveis nas telas.
-- `coalesce` porque NULL nunca é igual a NULL num índice único: sem ele, dez
-- classes globais chamadas COR passariam.
create unique index if not exists idx_product_classes_nome
  on product_classes (coalesce(company_id, ''), lower(name));

-- ============================ VALORES DA CLASSE =============================
create table if not exists product_class_values (
  id text primary key,
  -- RESTRICT, não CASCADE: apagar a classe COR levaria junto todo o histórico
  -- de qual cor cada movimento teve.
  class_id text not null references product_classes(id) on delete restrict,
  name text not null,
  -- Código curto para etiqueta e importação ("PT", "BR"). Opcional: obrigar
  -- um código para cadastrar uma cor é atrito sem retorno.
  code text,
  -- Espaço para o que a cor precisar depois: {"hex": "#000000"}.
  metadata jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- §21.1 — "Preto" e "preto" na mesma classe seriam duas cores para o sistema e
-- uma só para quem vende.
create unique index if not exists idx_product_class_values_nome
  on product_class_values (class_id, lower(name));
create unique index if not exists idx_product_class_values_codigo
  on product_class_values (class_id, upper(code)) where code is not null;
create index if not exists idx_product_class_values_classe
  on product_class_values (class_id, active);

-- ===================== CLASSES QUE O PRODUTO UTILIZA ========================
create table if not exists product_class_assignments (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  class_id text not null references product_classes(id) on delete restrict,
  -- Obriga escolher um valor na venda? COR de um produto que só existe em
  -- preto não precisa ser escolhida.
  required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- §21.2 — a mesma classe duas vezes no mesmo produto daria duas listas de cor
-- na tela de venda.
create unique index if not exists idx_product_class_assign_unico
  on product_class_assignments (product_id, class_id);
create index if not exists idx_product_class_assign_produto
  on product_class_assignments (product_id, active);

-- CASCADE no produto e RESTRICT na classe, de propósito: excluir um produto
-- deve limpar as atribuições dele; excluir uma classe usada por qualquer
-- produto tem de ser recusado (§21.5).

-- ===================== VALORES QUE O PRODUTO OFERECE =========================
create table if not exists product_class_value_assignments (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  class_id text not null references product_classes(id) on delete restrict,
  class_value_id text not null references product_class_values(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_product_class_value_assign_unico
  on product_class_value_assignments (product_id, class_value_id);
create index if not exists idx_product_class_value_assign_produto
  on product_class_value_assignments (product_id, class_id, active);

-- ============================== SEMENTE: COR ================================
-- A classe COR e as cores mais comuns já entram cadastradas: exigir que o
-- usuário crie "Preto" antes de poder usar a funcionalidade é atrito no
-- primeiro minuto. O `hex` alimenta a bolinha de cor na tela.
insert into product_classes (id, name, description) values
  ('pclass_cor', 'COR', 'Cor do produto. Cada cor tem saldo de estoque próprio.')
on conflict (id) do update set name = excluded.name, description = excluded.description;

insert into product_class_values (id, class_id, name, code, metadata) values
  ('pcval_cor_preto',    'pclass_cor', 'Preto',    'PT', '{"hex":"#111827"}'),
  ('pcval_cor_branco',   'pclass_cor', 'Branco',   'BR', '{"hex":"#F9FAFB"}'),
  ('pcval_cor_vermelho', 'pclass_cor', 'Vermelho', 'VM', '{"hex":"#DC2626"}'),
  ('pcval_cor_azul',     'pclass_cor', 'Azul',     'AZ', '{"hex":"#2563EB"}'),
  ('pcval_cor_cinza',    'pclass_cor', 'Cinza',    'CZ', '{"hex":"#6B7280"}')
on conflict (id) do update set
  name = excluded.name, code = excluded.code, metadata = excluded.metadata;
