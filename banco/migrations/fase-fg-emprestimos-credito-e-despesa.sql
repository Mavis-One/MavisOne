-- ============================================================================
-- FASE FG — EMPRÉSTIMOS / FINANCIAMENTOS: CRÉDITO É DESPESA, DÉBITO É RECEITA
-- ============================================================================
--
-- Pedido do usuário (28/10/2026), com o print do Plano de Contas
-- ("EMPRESTIMOS / FINANCIAMENTOS - CREDITO — Receita" e "...DEBITO —
-- Despesa"): "o lançamento de crédito está saindo como receita ao invés de
-- despesa". Perguntado, escolheu "crédito = despesa": nesses planos o
-- lançamento com "...CREDITO" é sempre despesa e o com "...DEBITO" é sempre
-- receita, seja qual for a tela em que foi lançado ou o tipo cadastrado no
-- plano.
--
-- Os próximos já nascem certos (shared/lancamento_obrigatorios.js,
-- tipoPeloPlano, na tela e no servidor); os já gravados passam aqui. O plano
-- sem uma das duas palavras (o "EMPRESTIMOS / FINANCIAMENTOS" do Viper) não é
-- tocado, e o tipo cadastrado nos planos também não. Só receita e despesa
-- mudam (a transferência entre contas não). Pode rodar de novo: o que já está
-- certo não é tocado.
-- ============================================================================

with plano as (
  select id,
         upper(translate(name, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                               'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) as nome
    from financial_categories
), certo as (
  select id,
         case when nome ~ '\mCREDITO\M' then 'DESPESA'
              when nome ~ '\mDEBITO\M' then 'RECEITA'
         end as tipo
    from plano
   where nome ~ '\mEMPRESTIMOS?\s*/\s*FINANCIAMENTOS?\M'
)
update financial_entries e
   set type = c.tipo,
       updated_at = now()
  from certo c
 where e.category_id = c.id
   and c.tipo is not null
   and e.type in ('RECEITA', 'DESPESA')
   and e.type <> c.tipo;
