-- ============================================================================
-- FASE FE — TRANSFERÊNCIA ENTRE PORTADORES: CRÉDITO É RECEITA, DÉBITO É DESPESA
-- ============================================================================
--
-- Pedido do usuário (28/10/2026), com o print do Plano de Contas
-- ("TRANSFERENCIA ENTRE PORTADORES CREDITO — Receita" e "...DEBITO —
-- Despesa"): "verifique crédito e débito, pois está puxando errado nos
-- relatórios; preciso que crédito puxe receita e débito puxe despesa".
--
-- O motivo: os relatórios do Financeiro separam pelo TIPO do lançamento
-- (e.type), e a tela deixava escolher qualquer plano de contas em qualquer
-- tipo — uma despesa lançada com o plano "...CREDITO" caía em Contas a Pagar.
-- Os próximos já nascem certos (shared/lancamento_obrigatorios.js,
-- tipoPeloPlano, na tela e no servidor); os já gravados passam aqui.
--
-- A regra é a mesma do código: no plano cujo nome tem "TRANSFERENCIA ENTRE
-- PORTADORES", CREDITO é receita, DEBITO é despesa e, sem uma das duas
-- palavras, vale o tipo cadastrado no plano. Só receita e despesa mudam
-- (a transferência entre contas tem origem e destino, e não muda). Pode rodar
-- de novo: o que já está certo não é tocado.
-- ============================================================================

with plano as (
  select id,
         upper(translate(name, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                               'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) as nome,
         lower(coalesce(type, '')) as tipo
    from financial_categories
), certo as (
  select id,
         case when nome ~ '\mCREDITO\M' then 'RECEITA'
              when nome ~ '\mDEBITO\M' then 'DESPESA'
              when tipo = 'receita' then 'RECEITA'
              when tipo = 'despesa' then 'DESPESA'
         end as tipo
    from plano
   where nome like '%TRANSFERENCIA ENTRE PORTADORES%'
)
update financial_entries e
   set type = c.tipo,
       updated_at = now()
  from certo c
 where e.category_id = c.id
   and c.tipo is not null
   and e.type in ('RECEITA', 'DESPESA')
   and e.type <> c.tipo;
