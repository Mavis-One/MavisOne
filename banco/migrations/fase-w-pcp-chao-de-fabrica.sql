-- ---------------------------------------------------------------------------
-- Fase W — chão de fábrica no PCP
--
-- A Fase R deu ao PCP o essencial: ordem de produção, ficha técnica e
-- apontamento. Falta o que diz ONDE a ordem está sendo feita, EM QUE ETAPA ela
-- se encontra no fluxo da empresa, e se o que saiu está BOM.
--
--   pcp_sectors         — setores/centros de trabalho, na ordem do fluxo
--   pcp_statuses        — os status que a empresa usa, além das 4 etapas fixas
--   pcp_quality_checks  — inspeção de qualidade por ordem
--
-- POR QUE STATUS É TABELA E A ETAPA CONTINUA FIXA
-- ------------------------------------------------
-- pcp_orders.status tem CHECK com quatro valores (aberta, em_producao,
-- concluida, cancelada) e o código depende deles: é por "concluida" que se sabe
-- que a ordem terminou. Trocar isso por texto livre quebraria toda a lógica na
-- primeira vez que alguém digitasse "Concluída " com espaço no fim.
--
-- Então são DUAS coisas: a ETAPA (fixa, do código) e o STATUS (cadastrado, da
-- empresa). "Aguardando matéria-prima", "Em setup", "Parada por manutenção"
-- são status diferentes que vivem todos na etapa "em_producao". Cada status
-- declara a que etapa pertence, e é a etapa que manda no comportamento.
--
-- Mesmo desenho do catálogo de status de Pedido/Orçamento em Vendas.
--
-- Rodar DEPOIS de fase-r-modulos-novos.sql (referencia pcp_orders) e de
-- fase-u-rh-organizacional.sql não é necessário — hr_employees já existe na R.
-- ---------------------------------------------------------------------------

-- =============================== SETORES ====================================
create table if not exists pcp_sectors (
  id text primary key,
  name text not null,
  description text,
  -- Quem responde pelo setor. SET NULL: desligar o encarregado não pode
  -- apagar o setor junto com ele.
  responsible_id text references hr_employees(id) on delete set null,
  -- Posição do setor na linha (1 = primeiro). É o que permite listar o fluxo
  -- na ordem em que a peça caminha, em vez de em ordem alfabética.
  sequencia integer not null default 0,
  -- Quanto o setor produz por hora, na unidade do produto. Serve para estimar
  -- prazo; fica em branco quando o setor não tem ritmo constante.
  capacidade_hora numeric(14,4),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcp_setor_fluxo on pcp_sectors (sequencia, name);

-- ================================ STATUS ====================================
create table if not exists pcp_statuses (
  id text primary key,
  name text not null,
  -- A etapa do fluxo a que este status pertence. É ela que o código lê; o
  -- nome acima é só o rótulo que a empresa escolheu.
  etapa text not null default 'em_producao'
    check (etapa in ('aberta', 'em_producao', 'concluida', 'cancelada')),
  description text,
  -- Cor do badge na lista de ordens. Texto livre porque é valor de CSS.
  color text,
  ordem integer not null default 0,
  -- Status com que uma ordem nova nasce. Só um por etapa faz sentido, mas a
  -- unicidade é responsabilidade da tela — constraint parcial aqui obrigaria
  -- a mexer no banco toda vez que a regra mudasse.
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcp_status_ordem on pcp_statuses (etapa, ordem);

-- ========================= CONTROLE DE QUALIDADE ============================
create table if not exists pcp_quality_checks (
  id text primary key,
  -- CASCADE: apagar a ordem apaga as inspeções dela, como já acontece com os
  -- apontamentos. A inspeção não existe fora da ordem.
  order_id text not null references pcp_orders(id) on delete cascade,
  sector_id text references pcp_sectors(id) on delete set null,
  date date not null,
  inspector_id text references hr_employees(id) on delete set null,
  quantidade_inspecionada numeric(14,4) not null default 0,
  -- Só a aprovada é guardada. A reprovada é a diferença, e gravar as duas
  -- criaria um terceiro número que pode discordar dos outros dois — mesma
  -- razão de "Falta" ser derivado na lista de ordens.
  quantidade_aprovada numeric(14,4) not null default 0,
  resultado text not null default 'aprovado'
    check (resultado in ('aprovado', 'aprovado_com_ressalva', 'reprovado')),
  -- O que foi encontrado. Em reprovação é o campo que explica a decisão, e é
  -- o que a auditoria de qualidade vai ler meses depois.
  motivo text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcp_qc_ordem on pcp_quality_checks (order_id, date desc);
create index if not exists idx_pcp_qc_resultado on pcp_quality_checks (resultado, date desc);

-- ==================== VÍNCULOS NA ORDEM DE PRODUÇÃO =========================
-- SET NULL nos dois: excluir um setor ou um status não pode apagar a ordem.
-- A ordem só perde a classificação, e a etapa (coluna status) continua de pé —
-- é ela que o código lê.
alter table pcp_orders add column if not exists sector_id text
  references pcp_sectors(id) on delete set null;
alter table pcp_orders add column if not exists status_id text
  references pcp_statuses(id) on delete set null;

create index if not exists idx_pcp_orders_setor on pcp_orders (sector_id);
