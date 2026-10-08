-- ============================================================================
-- FASE DV — REGRAS FISCAIS POR EMPRESA: A PLUS E A ELECTRIC SEPARADAS
-- ============================================================================
--
-- O pedido (08/10/2026): regra fiscal em todas as empresas, matrizes e filiais,
-- e a SAL INFINITY ELECTRIC separada da SAL INFINITY PLUS, porque a situação
-- tributária das duas é diferente.
--
-- COMO O SISTEMA ESCOLHE A REGRA: pela EMPRESA do estabelecimento que emite
-- (regra_fiscal.empresa_id, ver resolverRegraFiscal em lib/db/fiscal.js). A
-- empresa é a raiz do CNPJ; matriz e filiais são estabelecimentos dela. Então:
--
--   SAL INFINITY PLUS, raiz 43792899 — matriz + 9 filiais, LUCRO PRESUMIDO.
--     As 4 regras são as do ERP VIP (fase de 02/10/2026). Elas eram gravadas
--     por um script manual (scripts/carregar-regras-fiscais-vip.js), que rodou
--     no banco local e talvez nunca no de produção — e sem regra a NF-e para
--     em "Nenhuma regra fiscal encontrada". Aqui elas entram SÓ ONDE FALTAM:
--     regra já cadastrada para a mesma operação e grupo não é tocada.
--
--   SAL INFINITY ELECTRIC, raiz 46877837 — SIMPLES NACIONAL (CRT 1). Uma
--     regra, copiada da NF-e 1218 que ela emitiu pelo Viper em 02/10/2026:
--     venda dentro de SC, CFOP 5102, CSOSN 102 em TODOS os itens (inclusive
--     as peças 8714.99.90, que na Plus entram com ST), sem ICMS destacado e sem
--     IPI. Sem grupo, para valer para todo produto — é o que a nota mostra.
--
-- O ESTABELECIMENTO DELA já existe em produção (CNPJ 46.877.837/0001-14 aparece
-- como emitente) e, pela trava estabelecimento_valida_cnpj_raiz, só pode estar
-- numa empresa de raiz 46877837. O que esta fase acerta é essa EMPRESA: regime
-- Simples Nacional e CRT 1 — com outro regime, a nota dela sairia com a
-- tributação de quem não é do Simples — e a regra que faltava.
--
-- A CONFIRMAR COM O CONTADOR (a DANFE não mostra): o CST de PIS/COFINS da
-- Electric. Ficou 49 (outras operações de saída) com alíquota 0, o usual no
-- Simples — o tributo vai no DAS, não na nota. Muda-se na tela de Regras
-- Fiscais, sem código. O IBS/CBS fica fora: em 2026 o grupo é exigido do
-- regime normal, e a nota 1218 foi autorizada sem ele.
--
-- Idempotente: na segunda vez não há empresa para criar, estabelecimento para
-- mover nem regra faltando.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A PLUS: as 4 regras do ERP VIP onde faltarem
-- ---------------------------------------------------------------------------
with plus as (
  select id from empresa where cnpj_raiz = '43792899'
), st as (
  select g.id from grupo_tributario g join plus on g.empresa_id = plus.id
  where g.ativo and g.nome = 'Substituição tributária (ST)'
  limit 1
), regras (tipo, com_st, cfop, cst_icms, modalidade, aliq_icms, cst_pc, aliq_pis, aliq_cofins, cst_ibs_cbs, class_trib, ibs_uf, ibs_mun, ibs, cbs) as (
  values
    ('VENDA',         true,  '5405', '60', null::int, 0::numeric,  '01', 0.65::numeric, 3::numeric, '000', '000001', 0.1::numeric, 0::numeric, 0.1::numeric, 0.9::numeric),
    ('VENDA',         false, '5102', '00', 3,         17,          '01', 0.65,          3,          '000', '000001', 0.1,          0,          0.1,          0.9),
    ('TRANSFERENCIA', true,  '5409', '60', null,      0,           '08', 0,             0,          null,  null,     null,         null,       null,         null),
    ('TRANSFERENCIA', false, '5152', '00', 3,         17,          '08', 0,             0,          null,  null,     null,         null,       null,         null)
)
insert into regra_fiscal (empresa_id, tipo_operacao, grupo_tributario_id, dentro_do_estado, cfop, cst_icms,
  modalidade_bc_icms, aliquota_icms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, prioridade, vigencia_inicio,
  cst_ibs_cbs, class_trib, aliquota_ibs_uf, aliquota_ibs_mun, aliquota_ibs, aliquota_cbs)
select plus.id, r.tipo, case when r.com_st then st.id end, true, r.cfop, r.cst_icms,
  r.modalidade, r.aliq_icms, r.cst_pc, r.aliq_pis, r.cst_pc, r.aliq_cofins, 0, date '2026-10-01',
  r.cst_ibs_cbs, r.class_trib, r.ibs_uf, r.ibs_mun, r.ibs, r.cbs
from plus cross join regras r left join st on true
-- Regra de ST sem o grupo de ST cadastrado não teria a quem se aplicar.
where (not r.com_st or st.id is not null)
  and not exists (
    select 1 from regra_fiscal x
    where x.empresa_id = plus.id and x.tipo_operacao = r.tipo
      and x.grupo_tributario_id is not distinct from (case when r.com_st then st.id end)
      and x.dentro_do_estado is not distinct from true
  );

-- ---------------------------------------------------------------------------
-- 2. A ELECTRIC: empresa própria, no Simples Nacional
-- ---------------------------------------------------------------------------
insert into empresa (cnpj_raiz, razao_social, regime_tributario, crt, observacao_padrao_nfe)
values ('46877837', 'SAL INFINITY ELECTRIC LTDA', 'SIMPLES_NACIONAL', 1,
        'Empresa Optante pelo Simples Nacional. Nao gera direito a credito de IPI e ISS.')
on conflict (cnpj_raiz) do update
  set regime_tributario = 'SIMPLES_NACIONAL',
      crt = 1,
      observacao_padrao_nfe = coalesce(nullif(btrim(empresa.observacao_padrao_nfe), ''), excluded.observacao_padrao_nfe);

-- A regra de venda dela, a da NF-e 1218.
insert into regra_fiscal (empresa_id, tipo_operacao, dentro_do_estado, cfop, csosn,
  aliquota_icms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, prioridade, vigencia_inicio, observacao_fisco)
select e.id, 'VENDA', true, '5102', '102', 0, '49', 0, '49', 0, 0, date '2026-10-01', null
from empresa e
where e.cnpj_raiz = '46877837'
  and not exists (
    select 1 from regra_fiscal x
    where x.empresa_id = e.id and x.tipo_operacao = 'VENDA'
      and x.grupo_tributario_id is null and x.dentro_do_estado is not distinct from true
  );
