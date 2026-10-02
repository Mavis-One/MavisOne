-- ============================================================================
-- FASE DN — O CFOP DA ENTRADA, A PARTIR DO CFOP DO FORNECEDOR
-- ============================================================================
--
-- A nota do fornecedor traz o CFOP DELE (5102, venda). A escrituração de quem
-- recebe usa o da ENTRADA (1102, compra para comercialização). A conversão é
-- uma escolha da empresa — o mesmo 5102 é 1102 para revender e 1556 para uso e
-- consumo — e por isso mora numa tabela, e não em código.
--
-- DE ONDE VEIO A PRIMEIRA CARGA: a regra "COMPRA DE MERCADORIA" do sistema
-- anterior (ERP VIP), 18 sub-condições de CFOP, exportadas em 01/10/2026. Lá
-- cada uma dizia "5102 ou 6102 -> x102", com o x resolvido pela UF. Aqui cada
-- linha é explícita: 5102 -> 1102 e 6102 -> 2102. Explícito porque o x
-- escondia exatamente o erro que a carga encontrou — seis conversões que
-- resultavam em CFOP inexistente (ver scripts/carregar-regras-fiscais-vip.js).
--
-- Sem linha para um CFOP, vale a regra de sempre (lib/sped-documento.js,
-- cfopDeEntrada): troca o primeiro dígito e converte venda com ST em 1403.
-- ============================================================================

create table if not exists cfop_conversao_entrada (
  id text primary key,
  empresa_id uuid not null references empresa(id) on delete restrict,
  -- O CFOP que vem na nota do fornecedor (saída para ele: 5, 6 ou 7).
  cfop_origem char(4) not null,
  -- O CFOP com que a entrada é escriturada aqui (1, 2 ou 3).
  cfop_entrada char(4) not null,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por_nome text not null default ''
);

alter table cfop_conversao_entrada drop constraint if exists cfop_conversao_entrada_origem_check;
alter table cfop_conversao_entrada add constraint cfop_conversao_entrada_origem_check
  check (cfop_origem ~ '^[567][0-9]{3}$');

alter table cfop_conversao_entrada drop constraint if exists cfop_conversao_entrada_entrada_check;
alter table cfop_conversao_entrada add constraint cfop_conversao_entrada_entrada_check
  check (cfop_entrada ~ '^[123][0-9]{3}$');

create unique index if not exists idx_cfop_conversao_entrada_unica
  on cfop_conversao_entrada (empresa_id, cfop_origem);

alter table if exists cfop_conversao_entrada enable row level security;

comment on table cfop_conversao_entrada is
  'Fase DN - CFOP do fornecedor -> CFOP de entrada, por empresa. Primeira carga: a regra COMPRA DE MERCADORIA do ERP VIP (01/10/2026).';
