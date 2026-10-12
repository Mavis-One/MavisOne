-- ============================================================================
-- FASE EB — TEMPO DE PRODUÇÃO POR MODELO E PROGRAMAÇÃO DO DIA (PCP)
-- ============================================================================
--
-- Pedido do usuário (12/10/2026): cada modelo de scooter tem um tempo de
-- montagem diferente (uns 40 minutos, outros 1h30), e o dia de produção tem
-- uma jornada (ex.: 8 horas) que é preenchida MISTURANDO modelos até fechar o
-- dia. A "capacidade por hora" do setor (fase W) não serve: é um número só
-- para o setor inteiro.
--
-- Decisões dele:
--   - UM tempo por modelo (produto), não por setor nem por variação;
--   - a jornada tem um padrão por setor e é AJUSTÁVEL por dia (sábado 4h,
--     hora extra 10h).
--
-- Tabelas:
--   pcp_tempos_produto  minutos de produção de UMA unidade de cada produto
--   pcp_jornadas        a jornada de um dia, quando foge do padrão do setor
--   pcp_programacao     o que se planeja produzir em cada dia (e setor)
-- E o setor ganha `jornada_horas`, a jornada padrão. `capacidade_hora` fica no
-- banco (não se apaga dado), mas sai da tela.
-- ============================================================================

-- ----------------------------------------------------- TEMPO POR PRODUTO
create table if not exists pcp_tempos_produto (
  id text primary key,
  -- Um tempo por produto: o UNIQUE é a regra, e não só a tela.
  product_id text not null unique references products(id) on delete cascade,
  minutos numeric(10,2) not null check (minutos > 0),
  notes text,
  created_at timestamptz not null default now()
);
alter table pcp_tempos_produto enable row level security;

-- ------------------------------------------------- JORNADA PADRÃO DO SETOR
alter table if exists pcp_sectors add column if not exists jornada_horas numeric(5,2)
  check (jornada_horas is null or (jornada_horas >= 0 and jornada_horas <= 24));

-- ------------------------------------------------ JORNADA AJUSTADA NO DIA
-- Sem setor = a programação "geral" (fábrica sem setores cadastrados).
create table if not exists pcp_jornadas (
  id text primary key,
  sector_id text references pcp_sectors(id) on delete cascade,
  date date not null,
  horas numeric(5,2) not null check (horas >= 0 and horas <= 24),
  created_at timestamptz not null default now()
);
-- Um ajuste por dia e setor. `coalesce` porque dois NULL não colidem num
-- UNIQUE comum, e o "geral" (sem setor) também só pode ter um por dia.
create unique index if not exists idx_pcp_jornada_dia on pcp_jornadas (coalesce(sector_id, ''), date);
alter table pcp_jornadas enable row level security;

-- --------------------------------------------------- PROGRAMAÇÃO DO DIA
create table if not exists pcp_programacao (
  id text primary key,
  date date not null,
  sector_id text references pcp_sectors(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  quantidade numeric(14,4) not null check (quantidade > 0),
  -- Opcional: de qual OP saem estas unidades.
  order_id text references pcp_orders(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pcp_programacao_dia on pcp_programacao (date, sector_id);
alter table pcp_programacao enable row level security;
