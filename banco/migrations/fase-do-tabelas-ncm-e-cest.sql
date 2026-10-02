-- ============================================================================
-- FASE DO — AS TABELAS OFICIAIS DE NCM E CEST, para auditar o cadastro
-- ============================================================================
--
-- Sem elas, "NCM inexistente" e "CEST incompatível com o NCM" não se conferem:
-- o cadastro aceita qualquer oito dígitos. E a conferência ficou urgente com a
-- reforma: a varredura do sistema anterior achou NCM de ALIMENTO em produto de
-- bicicleta (0101.29.00, cavalos vivos, numa capa de painel), e NCM de alimento
-- é o que dá alíquota reduzida ou zero de IBS/CBS.
--
-- As duas são carregadas por scripts/carregar-tabelas-ncm-cest.js, das fontes
-- oficiais — nenhuma linha delas é digitada aqui:
--
--   NCM   Portal Único Siscomex (Receita Federal), a nomenclatura vigente em JSON
--   CEST  Convênio ICMS 142/2018 (CONFAZ), os anexos por segmento, só a redação
--         vigente
-- ============================================================================

create table if not exists fiscal_ncm (
  codigo char(8) primary key,
  -- A descrição do próprio código ("-- Outros") e a montada com a dos códigos
  -- pais ("Cavalos, asininos e muares, vivos. › Cavalos › Outros"): a curta
  -- sozinha não diz nada.
  descricao text not null,
  descricao_completa text not null,
  data_inicio date,
  data_fim date
);

create table if not exists fiscal_cest (
  cest char(7) primary key,
  segmento char(2) not null,
  segmento_nome text,
  descricao text not null,
  -- Os NCMs que o convênio lista para o CEST, como PREFIXOS só de dígitos:
  -- '87116000' (o código), '8714' (a posição inteira), '33' (o capítulo). Lista
  -- vazia = o convênio não restringe (os CEST "999 — outros").
  ncm_prefixos text[] not null default '{}'
);

create index if not exists idx_fiscal_cest_segmento on fiscal_cest (segmento);

-- De onde veio cada carga, para a tela dizer "NCM vigente em 02/10/2026,
-- Resolução Gecex nº 926/2026" em vez de deixar a dúvida.
create table if not exists fiscal_tabela_carga (
  tabela text primary key,
  versao text,
  fonte text not null,
  linhas integer not null,
  carregado_em timestamptz not null default now()
);

alter table fiscal_tabela_carga drop constraint if exists fiscal_tabela_carga_tabela_check;
alter table fiscal_tabela_carga add constraint fiscal_tabela_carga_tabela_check
  check (tabela in ('NCM', 'CEST'));

alter table if exists fiscal_ncm enable row level security;
alter table if exists fiscal_cest enable row level security;
alter table if exists fiscal_tabela_carga enable row level security;

comment on table fiscal_ncm is 'Fase DO - nomenclatura NCM vigente (Siscomex), carregada por scripts/carregar-tabelas-ncm-cest.js.';
comment on table fiscal_cest is 'Fase DO - CEST x NCM do Convenio ICMS 142/2018 (CONFAZ), redacao vigente.';
