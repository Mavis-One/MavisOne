-- ============================================================================
-- FASE DW — AS OPERAÇÕES FISCAIS PASSAM A SER EDITÁVEIS PELA TELA
-- ============================================================================
--
-- Pedido do usuário (10/10/2026): um botão para modificar e editar as
-- operações fiscais. O catálogo vive em lib/operacaoFiscal.js e continua sendo
-- o PADRÃO; esta tabela guarda só o que alguém alterou pela tela, uma linha por
-- operação. lib/db/operacoes-fiscais.js aplica as linhas por cima do padrão.
--
-- Coluna nula = "usa o padrão do código" para aquele campo. "Restaurar padrão"
-- na tela apaga a linha da operação — é configuração, não documento fiscal.
--
-- A chave não tem FK: as operações não moram no banco. Uma linha cuja chave
-- saiu do código é ignorada ao aplicar (ver aplicarAjustes).
-- ============================================================================

create table if not exists operacao_fiscal_ajuste (
  chave text primary key check (chave ~ '^[A-Z_]+$'),
  rotulo text check (rotulo is null or (btrim(rotulo) <> '' and char_length(rotulo) <= 60)),
  -- natOp: de 1 a 60 caracteres no leiaute da NF-e.
  natureza text check (natureza is null or char_length(natureza) <= 60),
  finalidade smallint check (finalidade is null or finalidade in (1, 2, 3, 4)),
  movimenta_estoque boolean,
  gera_financeiro boolean,
  exige_referencia boolean,
  permite_quantidade_zero boolean,
  permite_valor_zero boolean,
  exige_icms boolean,
  exige_produto_escritural boolean,
  atualizado_por text,
  atualizado_por_nome text,
  atualizado_em timestamptz not null default now()
);

alter table operacao_fiscal_ajuste enable row level security;
