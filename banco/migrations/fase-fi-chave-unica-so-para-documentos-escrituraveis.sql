-- ============================================================================
-- FASE FI — O HISTÓRICO IMPORTADO NÃO BLOQUEIA A ESCRITURAÇÃO ATUAL
-- ============================================================================
--
-- As NF-e importadas do Viper são guardadas como histórico e ficam com
-- `escriturar = false` (fase DY). Uma entrada atual pode ter a mesma chave da
-- nota histórica; a unicidade global anterior impedia que ela fosse escriturada
-- no SPED, embora o registro histórico não entre no arquivo.
--
-- A chave continua única entre documentos escrituráveis. Assim não se permite
-- duplicidade no SPED e o histórico pode coexistir com a escrituração atual.
-- ============================================================================

drop index if exists idx_fiscal_documentos_chave;
create unique index idx_fiscal_documentos_chave
  on fiscal_documentos (chave_acesso)
  where chave_acesso is not null and escriturar;
