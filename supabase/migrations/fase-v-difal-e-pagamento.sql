-- ---------------------------------------------------------------------------
-- Fase V — DIFAL e crédito do Simples na regra fiscal
--
-- Preparação para o primeiro teste em homologação com emitente em SANTA
-- CATARINA operando em Simples Nacional e Lucro Presumido.
--
-- O QUE FALTAVA E POR QUÊ
--
-- 1. DIFAL (EC 87/2015). Venda interestadual para quem NÃO é contribuinte —
--    consumidor final pessoa física em outro estado — deve a diferença entre a
--    alíquota interna do estado de DESTINO e a interestadual, e essa diferença
--    pertence ao destino. Para calcular é preciso saber a alíquota interna do
--    outro estado, que varia por UF e por produto. Não dá para embutir no
--    código: são 27 estados que mudam de alíquota por lei estadual. Fica como
--    campo da regra, que já é cadastrada por UF de destino.
--
--    Simples Nacional está DISPENSADO do DIFAL (ADI 5.464 do STF), por isso o
--    payload só monta a partilha quando a regra usa CST, não CSOSN.
--
-- 2. FCP no destino. Alguns estados cobram Fundo de Combate à Pobreza por
--    cima do DIFAL, com percentual próprio e lista própria de produtos. Mesmo
--    motivo do item 1: é dado, não regra de código.
--
-- 3. Crédito de ICMS do Simples. CSOSN 101 e 201 são "com permissão de
--    crédito" e a nota precisa declarar o percentual que o destinatário pode
--    aproveitar. O percentual é o da faixa do Simples da empresa e já existe
--    em empresa.aliquota_credito_icms_sn (Fase C) — o que faltava era o
--    payload usá-lo, e isso é código, não banco.
-- ---------------------------------------------------------------------------

-- Alíquota interna do estado de DESTINO, para o cálculo do DIFAL. Fica NULL
-- em regra de operação interna e em regra de Simples Nacional — nos dois casos
-- não há partilha a calcular.
alter table regra_fiscal add column if not exists aliquota_interna_uf_destino numeric(5,2);

-- Percentual do Fundo de Combate à Pobreza do estado de destino.
alter table regra_fiscal add column if not exists aliquota_fcp_uf_destino numeric(5,2);
