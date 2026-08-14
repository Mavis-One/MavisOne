-- =============================================================================
-- CONSOLIDADO — este arquivo só junta as migrações abaixo para colar de uma
--  vez; quem manda são os arquivos de fase, e o verificador ignora este aqui.
--  MIGRAÇÕES PENDENTES — conferido com scripts/verificar-migracoes.js
--
--  Cole tudo de uma vez no SQL Editor do Supabase e execute.
--  Cada instrução usa "if not exists": rodar duas vezes não causa dano.
--
--  O QUE ESTÁ FALTANDO (varredura de 14/08/2026):
--    Fase V — DIFAL e FCP do estado de destino na regra fiscal
--
--  ISTO NÃO É "degrada em silêncio": está QUEBRADO na cara.
--  lib/db/fiscal.js grava as duas colunas em toda regra fiscal, e elas não
--  existem no banco. A tela Regras Fiscais devolve erro em qualquer tentativa
--  de salvar:
--
--      createRegraFiscal: Could not find the 'aliquota_fcp_uf_destino'
--      column of 'regra_fiscal' in the schema cache
--
--  E o estrago não para nessa tela: é a regra fiscal que casa o item com a
--  tributação na hora de emitir. Sem conseguir cadastrar nenhuma regra, a
--  emissão de NF-e está bloqueada por baixo.
--
--  Depois de rodar, confirme com:  npm run migracoes
-- =============================================================================

-- >>> fase-v-difal-e-pagamento.sql
-- ---------------------------------------------------------------------------
-- Fase V — DIFAL e crédito do Simples na regra fiscal
--
-- 1. DIFAL (EC 87/2015). Venda interestadual para quem NÃO é contribuinte deve
--    a diferença entre a alíquota interna do estado de DESTINO e a
--    interestadual. Para calcular é preciso saber a alíquota interna do outro
--    estado, que varia por UF e por produto — são 27 estados que mudam de
--    alíquota por lei estadual, então é dado, não código.
--
--    Simples Nacional está DISPENSADO do DIFAL (ADI 5.464 do STF), por isso o
--    payload só monta a partilha quando a regra usa CST, não CSOSN.
--
-- 2. FCP no destino. Alguns estados cobram Fundo de Combate à Pobreza por cima
--    do DIFAL, com percentual próprio. Mesmo motivo: é dado.
-- ---------------------------------------------------------------------------

-- Alíquota interna do estado de DESTINO, para o cálculo do DIFAL. Fica NULL
-- em regra de operação interna e em regra de Simples Nacional — nos dois casos
-- não há partilha a calcular.
alter table regra_fiscal add column if not exists aliquota_interna_uf_destino numeric(5,2);

-- Percentual do Fundo de Combate à Pobreza do estado de destino.
alter table regra_fiscal add column if not exists aliquota_fcp_uf_destino numeric(5,2);
