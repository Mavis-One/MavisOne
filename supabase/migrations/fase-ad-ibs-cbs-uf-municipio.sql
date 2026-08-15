-- ---------------------------------------------------------------------------
-- Fase AD — IBS separado por UF e por Município na regra fiscal
--
-- POR QUE
--
-- A fase-z criou `aliquota_ibs` como um número só. A API da Focus NFe não
-- aceita assim: ela pede os dois lados separados, porque o IBS tem DOIS
-- destinatários com competências distintas —
--
--     ibs_uf_aliquota   -> pIBSUF   (competência do estado)
--     ibs_mun_aliquota  -> pIBSMun  (competência do município)
--
-- Dividir um total ao meio no código resolveria 2026 por coincidência (as
-- alíquotas de teste são 0,05% + 0,05%) e passaria a mentir no primeiro ano em
-- que estado e município divergirem — que é o desenho da LC 214/2025. Alíquota
-- é dado, não regra de código: são 27 estados e 5.570 municípios legislando.
--
-- MEDIDO EM HOMOLOGAÇÃO (14/08/2026): sem os campos de IBS/CBS no payload, a
-- SEFAZ recusa TODA nota com "1115 — Rejeicao: IBS/CBS não informado".
--
-- `aliquota_ibs` (o total da fase-z) fica de pé, sem uso pelo payload: apagar
-- coluna não tem volta, e o custo de mantê-la é zero. Não havia nenhuma regra
-- fiscal cadastrada quando isto rodou, então não há dado a converter.
-- ---------------------------------------------------------------------------

-- Competência do ESTADO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_uf numeric(7,4);

-- Competência do MUNICÍPIO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_mun numeric(7,4);
