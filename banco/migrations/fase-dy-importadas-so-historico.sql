-- ============================================================================
-- FASE DY — AS NF-e IMPORTADAS DO VIPER SÃO SÓ HISTÓRICO
-- ============================================================================
--
-- Decisão do usuário (11/10/2026): TODAS as notas importadas do sistema
-- anterior ficam como histórico, inclusive as 2.661 da matriz que vieram com
-- chave e itens. Os SPEDs desses meses já foram entregues pelo Viper; o
-- MavisONE não as escritura.
--
-- Elas continuam com chave, itens e impostos para consulta e para os
-- relatórios — só saem do arquivo (`escriturar = false`, ver a fase DX).
--
-- O update cobre o banco em que a importação já rodou com o código da fase DX
-- (que marcava as completas como escrituráveis). A trava abaixo impede que uma
-- importada volte a ser escriturada por qualquer caminho.
-- ============================================================================

update fiscal_documentos
   set escriturar = false, atualizado_em = now()
 where origem = 'IMPORTACAO' and escriturar;

alter table fiscal_documentos drop constraint if exists fiscal_documentos_importada_nao_escritura_check;
alter table fiscal_documentos add constraint fiscal_documentos_importada_nao_escritura_check
  check (origem <> 'IMPORTACAO' or not escriturar);
