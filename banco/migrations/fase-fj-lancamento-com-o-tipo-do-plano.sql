-- ============================================================================
-- FASE FJ — TODO LANÇAMENTO TEM O TIPO DO SEU PLANO DE CONTAS
-- ============================================================================
--
-- Print do usuário (05/11/2026): "conta contábil rendimento de aplicação é
-- receita, porém está aparecendo como despesa". Fora a transferência entre
-- portadores e os empréstimos (fases FE e FH), valia o tipo escolhido na tela:
-- o rendimento lançado em Contas a Pagar, ou com Despesa marcado, era gravado
-- como despesa.
--
-- Desde hoje o plano cadastrado como Receita faz receita, e como Despesa,
-- despesa (shared/lancamento_obrigatorios.js, tipoPeloPlano; e trocar o tipo no
-- Plano de Contas troca o dos lançamentos). Esta migração acerta os já
-- gravados: cada lançamento que discorda do tipo do seu plano passa a tê-lo.
--
-- Ficam de fora: plano "ambos" (quem lança escolhe), a transferência entre
-- contas, o lançamento vinculado a pedido ou compra (reference_id; segue a
-- origem) e os planos das duas regras próprias — TRANSFERENCIA ENTRE
-- PORTADORES (pelo nome) e EMPRESTIMOS / FINANCIAMENTOS (fase FH). Medido no
-- banco local em 05/11/2026: dos 27.355 lançamentos com plano receita/despesa,
-- nenhum discordava — o que esta migração muda é o que foi lançado errado
-- desde então. Pode rodar de novo: o que já está certo não é tocado.
-- ============================================================================

with plano as (
  select id,
         upper(translate(name, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                               'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) as nome,
         case lower(coalesce(type, '')) when 'receita' then 'RECEITA' when 'despesa' then 'DESPESA' end as tipo
    from financial_categories
), certo as (
  select id, tipo
    from plano
   where tipo is not null
     and nome !~ 'TRANSFERENCIA ENTRE PORTADORES'
     and nome !~ '\mEMPRESTIMOS?\s*/\s*FINANCIAMENTOS?\M'
)
update financial_entries e
   set type = c.tipo,
       updated_at = now()
  from certo c
 where e.category_id = c.id
   and e.type in ('RECEITA', 'DESPESA')
   and e.type <> c.tipo
   and coalesce(e.reference_id, '') = '';
