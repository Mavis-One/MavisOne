-- ============================================================================
-- FASE DM — OS ARQUIVOS DE SPED GERADOS, GUARDADOS
-- ============================================================================
--
-- A tela "Gerar SPED" passa a listar o que já foi gerado, como as telas de SPED
-- dos outros sistemas fazem, e a lista existe por um motivo além de conforto:
--
-- O SALDO CREDOR É RECALCULADO a cada geração (fase DL), desde a competência
-- inicial. Se alguém corrigir uma nota de agosto em novembro, o SPED de
-- setembro gerado de novo sai diferente do que foi ENTREGUE. Guardar o arquivo
-- é o que permite responder "o que foi que nós mandamos?" — com o arquivo, e
-- não com uma reconstrução dele.
--
-- O arquivo é guardado inteiro (bytea, Latin-1, uns 250 KB por mês por
-- estabelecimento) e com o sha256, para conferir que o baixado hoje é o gerado
-- naquele dia. Não há rota de exclusão: é histórico de escrituração fiscal.
-- ============================================================================

create table if not exists sped_arquivos (
  id text primary key,
  estabelecimento_id uuid not null references estabelecimento(id) on delete restrict,
  competencia char(7) not null,
  -- COD_FIN do 0000: false = 0 (remessa original), true = 1 (retificadora).
  retificadora boolean not null default false,
  nome_arquivo text not null,
  conteudo bytea not null,
  linhas integer not null,
  bytes integer not null,
  sha256 char(64) not null,
  documentos integer not null default 0,
  icms_recolher numeric(15,2) not null default 0,
  -- O resumo e os avisos daquela geração: o que a tela mostrou quando gerou.
  resumo jsonb not null default '{}'::jsonb,
  gerado_por text,
  gerado_por_nome text not null default '',
  gerado_em timestamptz not null default now()
);

alter table sped_arquivos drop constraint if exists sped_arquivos_competencia_check;
alter table sped_arquivos add constraint sped_arquivos_competencia_check
  check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

create index if not exists idx_sped_arquivos_estabelecimento
  on sped_arquivos (estabelecimento_id, gerado_em desc);

alter table if exists sped_arquivos enable row level security;

comment on table sped_arquivos is
  'Fase DM - cada SPED gerado, guardado inteiro: o saldo credor e recalculado a cada geracao, e o arquivo entregue nao pode depender de uma reconstrucao.';
