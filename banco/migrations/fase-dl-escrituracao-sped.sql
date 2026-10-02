-- ============================================================================
-- FASE DL — A ESCRITURAÇÃO DO SPED: o que o gerador precisa e não tinha onde morar
-- ============================================================================
--
-- O gerador do arquivo existe (lib/sped-gerador.js, provado contra os dez SPEDs
-- que o ViperERP gerou). O que faltava para ele gerar o SPED A PARTIR DESTE
-- SISTEMA era de três tipos, e esta fase cuida dos três:
--
-- 1. DADO QUE NÃO É DE NOTA NENHUMA, e não tinha tabela. O contabilista (0100),
--    o código de receita e o vencimento do ICMS (E116), as respostas do 1010,
--    o saldo credor com que a escrituração DESTE sistema começa, e a decisão
--    sobre o crédito do ICMS das entradas. Uma linha por estabelecimento: a EFD
--    é por CNPJ, e cada filial com inscrição estadual própria entrega a sua.
--
-- 2. DUAS COLUNAS QUE O C100 E O C190 PEDEM E O DOCUMENTO NÃO GUARDAVA:
--    a modalidade do frete (IND_FRT do C100) e, por item, frete, seguro e
--    outras despesas — que entram no VL_OPR do C190 ("somatório do valor das
--    mercadorias, despesas acessórias (frete, seguros e outras despesas
--    acessórias), ICMS_ST, FCP_ST e IPI, deduzidos os descontos").
--
-- 3. NADA DE APURAÇÃO GUARDADA. O saldo credor de um mês é recalculado a partir
--    do mês inicial a cada geração, em vez de gravado. Gravado, ele congelaria o
--    erro do mês em que foi gravado; recalculado, a correção de uma nota antiga
--    chega aos meses seguintes. O preço disso está anotado na tela: um mês já
--    entregue pode mudar se alguém mexer numa nota dele.
-- ============================================================================

create table if not exists sped_configuracao (
  estabelecimento_id uuid primary key references estabelecimento(id) on delete restrict,

  -- 0100 — CONTABILISTA. Campos do registro, com o nome do registro. Só dígitos
  -- em CPF, CNPJ, CEP, telefone e município: o arquivo vai sem máscara.
  contador_nome text,
  contador_cpf text,
  contador_crc text,
  contador_cnpj text,
  contador_cep text,
  contador_endereco text,
  contador_numero text,
  contador_complemento text,
  contador_bairro text,
  contador_telefone text,
  contador_email text,
  contador_codigo_municipio text,

  -- O CRÉDITO DO ICMS DAS ENTRADAS. Sem valor padrão, de propósito.
  --
  -- Os dez SPEDs do ViperERP (dez/2025 a set/2026) declaram crédito 0,00 em
  -- todos os meses, com R$ 252.937,06 de ICMS destacado nas entradas. Ou a
  -- empresa tem um regime que veda o crédito, ou o crédito estava sendo perdido
  -- — e as duas coisas dão impostos diferentes. Um padrão aqui seria este
  -- sistema decidir isso sozinho. Enquanto for nulo, a geração é recusada.
  --
  --   DESTACADO  o crédito é o ICMS destacado na nota de entrada (o Guia)
  --   NENHUM     as entradas são escrituradas sem base e sem ICMS
  credito_icms_entradas text,

  -- E116 — a obrigação do ICMS a recolher. O código de receita é da UF; nos
  -- SPEDs do Viper ele é 144910014 com vencimento no dia 10 do mês seguinte.
  e116_codigo_receita text,
  e116_dia_vencimento smallint,

  -- 1010 — as 13 perguntas "a empresa tem isto?" (exportação, crédito de
  -- cartão, combustível…). {"IND_EXP": "N", …}. As respostas são do contador.
  indicadores_1010 jsonb not null default '{}'::jsonb,

  -- ONDE A ESCRITURAÇÃO DESTE SISTEMA COMEÇA, e com que saldo credor.
  --
  -- O campo 10 do E110 é o campo 14 do E110 do mês anterior. Para o primeiro
  -- mês gerado aqui, o mês anterior é do sistema antigo — e é dele que o saldo
  -- vem (a tela importa o último SPED do Viper e preenche isto).
  competencia_inicial char(7),
  saldo_credor_inicial numeric(15,2),

  -- BLOCO K. O SPED de setembro/2026 do Viper trouxe K100/K200 (estoque
  -- escriturado). Este sistema não tem estoque por estabelecimento com data,
  -- então não gera o K200: se a empresa estiver obrigada, a geração é recusada
  -- e diz por quê, em vez de sair sem o bloco.
  bloco_k_obrigatorio boolean not null default false,

  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  atualizado_por_nome text
);

alter table sped_configuracao drop constraint if exists sped_configuracao_credito_check;
alter table sped_configuracao add constraint sped_configuracao_credito_check
  check (credito_icms_entradas is null or credito_icms_entradas in ('DESTACADO', 'NENHUM'));

alter table sped_configuracao drop constraint if exists sped_configuracao_dia_check;
alter table sped_configuracao add constraint sped_configuracao_dia_check
  check (e116_dia_vencimento is null or e116_dia_vencimento between 1 and 31);

alter table sped_configuracao drop constraint if exists sped_configuracao_competencia_check;
alter table sped_configuracao add constraint sped_configuracao_competencia_check
  check (competencia_inicial is null or competencia_inicial ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

alter table if exists sped_configuracao enable row level security;

comment on table sped_configuracao is
  'Fase DL - o que a EFD ICMS/IPI de um estabelecimento precisa e nao vem de nota: contabilista (0100), E116, 1010, saldo credor inicial e a decisao sobre o credito das entradas.';

-- O IND_FRT do C100. Mesmos códigos do modFrete da NF-e (0 a 4 e 9), que são
-- os da tabela do Guia.
alter table fiscal_documentos add column if not exists modalidade_frete smallint;

-- O que entra no VL_OPR do C190 e não estava no item.
alter table fiscal_documento_itens add column if not exists valor_frete numeric(15,2) not null default 0;
alter table fiscal_documento_itens add column if not exists valor_seguro numeric(15,2) not null default 0;
alter table fiscal_documento_itens add column if not exists valor_outras numeric(15,2) not null default 0;

-- Uma nota emitida pela Focus vira UM documento fiscal, e a escrituração é
-- refeita a cada geração do SPED: sem esta unicidade, duas gerações seguidas
-- escriturariam a mesma nota duas vezes. Idem a entrada.
create unique index if not exists idx_fiscal_documentos_nfe
  on fiscal_documentos (nfe_id) where nfe_id is not null;
create unique index if not exists idx_fiscal_documentos_nfe_entrada
  on fiscal_documentos (nfe_entrada_id) where nfe_entrada_id is not null;
