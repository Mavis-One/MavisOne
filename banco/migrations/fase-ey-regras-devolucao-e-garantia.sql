-- ============================================================================
-- FASE EY — REGRAS FISCAIS DE DEVOLUÇÃO E DE GARANTIA
-- ============================================================================
--
-- Pedido do usuário (20/10/2026): "faça duas novas regras fiscais se baseando
-- nas que já existem para fazer: devolução e garantia". Decidido com ele:
--
--   - DEVOLUÇÃO é a de COMPRA ao fornecedor (NF-e de saída que refere a nota
--     de compra): da regra de venda, 5102 vira 5202 e 5405 vira 5411;
--   - GARANTIA é a peça/produto que vai ao cliente em garantia (operação nova,
--     lib/operacaoFiscal.js: sai do estoque, sem conta a receber, refere a nota
--     de venda): CFOP 5949;
--   - a tributação (CST/CSOSN, alíquota, PIS/COFINS, IBS/CBS, grupo de ST) é
--     COPIADA da regra de venda de cada empresa — Plus e Electric, cada uma no
--     seu regime. A conferir com o contador; editável em Fiscal › Regras.
--
-- Copia de toda regra de VENDA que tenha o CFOP de origem, empresa por
-- empresa. Rodar de novo não duplica (mesma empresa, operação, CFOP, grupo de
-- ST, NCM, UF, dentro do estado e CSOSN).
-- ============================================================================

-- 1. As listas de operação do banco passam a aceitar GARANTIA.
alter table regra_fiscal drop constraint if exists regra_fiscal_tipo_operacao_check;
alter table regra_fiscal add constraint regra_fiscal_tipo_operacao_check
  check (tipo_operacao in ('VENDA','TRANSFERENCIA','REMESSA','RETORNO',
                            'DEVOLUCAO','BONIFICACAO','GARANTIA','ENTRADA_IMPORTACAO',
                            'COMPLEMENTO_ICMS'));

alter table if exists sales_categories drop constraint if exists sales_categories_operacao_fiscal_check;
alter table if exists sales_categories add constraint sales_categories_operacao_fiscal_check
  check (operacao_fiscal is null or operacao_fiscal in ('VENDA','TRANSFERENCIA','REMESSA','RETORNO',
                                                        'DEVOLUCAO','BONIFICACAO','GARANTIA'));

-- 2. As regras, copiadas das de venda.
with novas (tipo, de, para) as (
  values
    ('DEVOLUCAO', '5102', '5202'), ('DEVOLUCAO', '6102', '6202'),
    ('DEVOLUCAO', '5405', '5411'), ('DEVOLUCAO', '6403', '6411'), ('DEVOLUCAO', '6404', '6411'),
    ('GARANTIA',  '5102', '5949'), ('GARANTIA',  '6102', '6949'),
    ('GARANTIA',  '5405', '5949'), ('GARANTIA',  '6403', '6949'), ('GARANTIA',  '6404', '6949')
)
insert into regra_fiscal (
  empresa_id, ncm, origem, tipo_operacao, uf_destino, dentro_do_estado, destinatario_contribuinte, cfop,
  csosn, cst_icms, modalidade_bc_icms, aliquota_icms, reducao_bc_icms, cst_icms_st, mva_st, aliquota_icms_st,
  cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cst_ipi, aliquota_ipi, codigo_enquadramento_ipi,
  prioridade, vigencia_inicio, vigencia_fim, observacao_fisco, aliquota_interna_uf_destino, aliquota_fcp_uf_destino,
  cst_ibs_cbs, class_trib, aliquota_ibs, aliquota_cbs, aliquota_ibs_uf, aliquota_ibs_mun, codigo_beneficio_fiscal,
  icms_motivo_desoneracao, grupo_tributario_id
)
select
  v.empresa_id, v.ncm, v.origem, n.tipo, v.uf_destino, v.dentro_do_estado, v.destinatario_contribuinte, n.para,
  v.csosn, v.cst_icms, v.modalidade_bc_icms, v.aliquota_icms, v.reducao_bc_icms, v.cst_icms_st, v.mva_st, v.aliquota_icms_st,
  v.cst_pis, v.aliquota_pis, v.cst_cofins, v.aliquota_cofins, v.cst_ipi, v.aliquota_ipi, v.codigo_enquadramento_ipi,
  v.prioridade, v.vigencia_inicio, v.vigencia_fim, v.observacao_fisco, v.aliquota_interna_uf_destino, v.aliquota_fcp_uf_destino,
  v.cst_ibs_cbs, v.class_trib, v.aliquota_ibs, v.aliquota_cbs, v.aliquota_ibs_uf, v.aliquota_ibs_mun, v.codigo_beneficio_fiscal,
  v.icms_motivo_desoneracao, v.grupo_tributario_id
from regra_fiscal v
join novas n on n.de = v.cfop
where v.tipo_operacao = 'VENDA'
  and not exists (
    select 1 from regra_fiscal x
     where x.tipo_operacao = n.tipo and x.cfop = n.para
       and x.empresa_id is not distinct from v.empresa_id
       and x.grupo_tributario_id is not distinct from v.grupo_tributario_id
       and x.ncm is not distinct from v.ncm
       and x.uf_destino is not distinct from v.uf_destino
       and x.dentro_do_estado is not distinct from v.dentro_do_estado
       and x.csosn is not distinct from v.csosn
  );
