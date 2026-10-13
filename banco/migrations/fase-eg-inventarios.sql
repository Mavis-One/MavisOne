-- ============================================================================
-- FASE EG — INVENTÁRIOS (o retrato do estoque numa data, guardado)
-- ============================================================================
--
-- Pedido do usuário (13/10/2026): "implemente o inventário", a partir da
-- planilha da tela Inventários do Viper — Empresa | Ano | Data de referência |
-- Gerado em | Itens | Valor total | Valoração | Usuário. O exemplo de lá: SAL
-- INFINITY ELECTRIC, referência 12/10/2026, 1.027 itens, R$ 756.452,97 a custo
-- médio.
--
-- O QUE É, E O QUE NÃO É
-- ----------------------
-- É o Livro de Inventário: quanto havia de cada produto, em todos os depósitos
-- de UMA empresa, no fim do dia de referência, e quanto isso valia. Gerado, ele
-- FICA — com quantidade, custo e valor de cada item gravados —, porque é um
-- documento sobre uma data passada. Recalcular a cada abertura daria outro
-- número no dia em que alguém lançasse um movimento retroativo, e o inventário
-- entregue ao contador deixaria de ser o que foi entregue.
--
-- Não confundir com Contagens de Estoque (fase CU): a contagem é a folha de
-- quem foi ao galpão e AJUSTA o saldo; o inventário só lê o razão e não mexe em
-- nada.
--
-- Os campos de quantidade e custo seguem o razão (stock_movements): 4 casas de
-- quantidade e 6 de custo unitário. O Bloco H do SPED (H005/H010) usa 3 e 6; o
-- arredondamento para o leiaute é do gerador, não deste registro.
-- ============================================================================

create sequence if not exists inventarios_code_seq as bigint start with 1;

create table if not exists inventarios (
  id text primary key,
  code text not null,

  -- A empresa (filial) do cadastro de Vendas — o mesmo que deposits.company_id
  -- aponta (fase AW). Sem FK: `companies` mora no data/db.json. O nome vai
  -- junto, gravado, para o inventário continuar legível se o cadastro mudar.
  company_id text not null check (btrim(company_id) <> ''),
  company_name text not null default '',
  company_document text not null default '',

  data_referencia date not null,

  -- 'custo_medio': médio ponderado móvel calculado do razão até a data;
  -- 'custo_cadastro': o custo de hoje no cadastro do produto. Ver
  -- lib/custo-medio.js.
  valoracao text not null default 'custo_medio'
    check (valoracao in ('custo_medio', 'custo_cadastro')),

  -- MOT_INV do registro H005: 01 final do período, 02 mudança de forma de
  -- tributação, 03 baixa cadastral/paralisação, 04 alteração de regime de
  -- pagamento, 05 determinação dos fiscos, 06 controle de mercadoria com ST.
  motivo text not null default '01' check (motivo in ('01', '02', '03', '04', '05', '06')),

  -- Os depósitos que entraram, como estavam na geração (id e nome).
  depositos jsonb not null default '[]'::jsonb,

  itens integer not null default 0,
  quantidade_total numeric(18, 4) not null default 0,
  valor_total numeric(18, 2) not null default 0,
  note text not null default '',

  -- Sem FK para users, como nas fases AP/AQ/AR: quem gerou tem de sobreviver à
  -- exclusão de quem gerou.
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_inventarios_empresa_data on inventarios (company_id, data_referencia desc);

create table if not exists inventario_itens (
  id bigserial primary key,
  -- FK com cascade: o item é parte do documento, e não histórico de nada.
  inventario_id text not null references inventarios (id) on delete cascade,

  product_id text not null,
  -- Gravados na geração, pelo mesmo motivo do nome da empresa.
  sku text not null default '',
  product_name text not null default '',
  ncm text not null default '',
  unidade text not null default '',

  quantidade numeric(18, 4) not null,
  custo_unitario numeric(18, 6) not null default 0,
  valor numeric(18, 2) not null default 0,

  -- De onde o custo saiu: 'medio' (do razão), 'cadastro' (produto sem entrada
  -- com custo até a data, ou valoração pelo cadastro) ou 'sem_custo'.
  origem_custo text not null default 'medio'
    check (origem_custo in ('medio', 'cadastro', 'sem_custo'))
);

create index if not exists idx_inventario_itens_inventario on inventario_itens (inventario_id);

-- RLS, pela mesma razão da fase AF (ver o cabeçalho de lá e scripts/test-rls.js).
alter table if exists inventarios enable row level security;
alter table if exists inventario_itens enable row level security;
