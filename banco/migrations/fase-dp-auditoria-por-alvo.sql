-- ============================================================================
-- FASE DP — A AUDITORIA CONSULTADA PELO REGISTRO, E NÃO SÓ PELA DATA
-- ============================================================================
--
-- A tela do produto passa a mostrar quem mudou o preço e quando (VM-PLT-04),
-- lendo `audit_logs` por `target_id`. O único índice era por data, então cada
-- abertura da tela varreria a tabela inteira, que agora ganha uma linha por
-- produto a cada preço alterado (o Gestor de Preços altera centenas de uma vez).
-- ============================================================================

create index if not exists idx_audit_logs_alvo on audit_logs (target_id, at desc);
