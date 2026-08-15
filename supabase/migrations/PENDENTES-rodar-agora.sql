-- =============================================================================
-- CONSOLIDADO — este arquivo só junta as migrações abaixo para colar de uma
--  vez; quem manda são os arquivos de fase, e o verificador ignora este aqui.
--  MIGRAÇÕES PENDENTES — conferido com scripts/verificar-migracoes.js
--
--  Cole tudo de uma vez no SQL Editor do Supabase e execute.
--  Cada instrução usa "if not exists": rodar duas vezes não causa dano.
--
--  O QUE ESTÁ FALTANDO (varredura de 14/08/2026, à noite):
--    Fase AD — IBS separado por UF e por município na regra fiscal
--
--  POR QUE AGORA: a SEFAZ recusa TODA NF-e sem IBS/CBS. Medido numa emissão
--  real em homologação hoje:
--
--      status_sefaz   1115
--      mensagem       Rejeicao: IBS/CBS não informado
--
--  O resto do caminho já funciona — o certificado assinou e a nota chegou à
--  SEFAZ. O que falta é o payload levar os tributos da Reforma (LC 214/2025),
--  e para isso a regra fiscal precisa guardar a alíquota do IBS separada por
--  competência: o estado e o município legislam a deles de forma independente,
--  e a API da Focus pede os dois (pIBSUF e pIBSMun).
--
--  Depois de rodar, confirme com:  npm run migracoes
-- =============================================================================

-- >>> fase-ad-ibs-cbs-uf-municipio.sql
-- ---------------------------------------------------------------------------
-- Fase AD — IBS separado por UF e por Município na regra fiscal
--
-- A fase-z criou `aliquota_ibs` como um número só. Dividir esse total ao meio
-- no código resolveria 2026 por coincidência (as alíquotas de teste são 0,05%
-- + 0,05%) e passaria a mentir no primeiro ano em que estado e município
-- divergirem — que é o desenho da LC 214/2025.
--
-- `aliquota_ibs` fica de pé, sem uso pelo payload: apagar coluna não tem
-- volta. Não havia nenhuma regra fiscal cadastrada quando isto foi escrito,
-- então não há dado a converter.
-- ---------------------------------------------------------------------------

-- Competência do ESTADO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_uf numeric(7,4);

-- Competência do MUNICÍPIO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_mun numeric(7,4);
