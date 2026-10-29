-- ============================================================================
-- FASE FH — EMPRÉSTIMOS / FINANCIAMENTOS: O LANÇAMENTO TEM O TIPO DO PLANO
-- ============================================================================
--
-- Print do usuário (29/10/2026): parcela de empréstimo com o plano
-- "EMPRESTIMOS / FINANCIAMENTOS - DEBITO" e o aviso "o lançamento será gravado
-- como Receita" — "verifique e resolva, já estou pedindo desde ontem". A fase
-- FG (28/10) inverteu os dois planos pelo nome (CREDITO despesa, DEBITO
-- receita), contra o cadastro que o usuário fez (CREDITO Receita, DEBITO
-- Despesa).
--
-- Desde hoje vale o tipo cadastrado no plano (shared/lancamento_obrigatorios.js,
-- tipoPeloPlano; e trocar o tipo no Plano de Contas troca o dos lançamentos).
-- Esta migração desfaz a FG nos já gravados: cada lançamento dos planos de
-- empréstimo com CREDITO/DEBITO no nome volta ao tipo do plano. O plano sem
-- uma das duas palavras (o "EMPRESTIMOS / FINANCIAMENTOS" do Viper) não é
-- tocado, nem plano com tipo "ambos". Só receita e despesa mudam (a
-- transferência entre contas não). Pode rodar de novo: o que já está certo
-- não é tocado.
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
   where nome ~ '\mEMPRESTIMOS?\s*/\s*FINANCIAMENTOS?\M'
     and nome ~ '\m(CREDITO|DEBITO)\M'
     and tipo is not null
)
update financial_entries e
   set type = c.tipo,
       updated_at = now()
  from certo c
 where e.category_id = c.id
   and e.type in ('RECEITA', 'DESPESA')
   and e.type <> c.tipo;
