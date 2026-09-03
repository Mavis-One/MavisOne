-- ============================================================================
-- FASE AY — o Documento começa com LF{número}, e a descrição antiga ganha
--           a natureza que faltava
-- ============================================================================
--
-- PARTE 1: O LANCAMENTO QUE FICOU SEM NUMERO
-- -------------------------------------------
-- A fase AT numerou tudo que existia quando ela foi ESCRITA. Num banco onde ela
-- so foi APLICADA depois, o que nasceu no meio do caminho ficou com code nulo —
-- e um lancamento sem numero nao pode ter documento comecando por LF, que e'
-- justamente o que a parte 2 vai fazer. Sobraria uma linha fora do padrao sem
-- ninguem sabendo por que.
--
-- NEXTVAL, e nao row_number(): a sequence ja passou do numero desses registros,
-- e row_number() entregaria numeros baixos que podem estar ocupados pelo indice
-- unico. O numero fica fora de ordem cronologica — melhor do que colidir.
update financial_entries
set code = nextval('financial_entries_code_seq')
where code is null;

-- ----------------------------------------------------------------------------
-- PARTE 2: O CAMPO DOCUMENTO
-- ----------------------------------------------------------------------------
-- Foi pedido assim: "para cada lançamento financeiro o documento comece com
-- LF{número de documento} para manter padronizado".
--
-- COMEÇA com o número, e não é SUBSTITUÍDO por ele. O que o campo guarda hoje —
-- o código do pedido, o número da NF-e, a chave de acesso de 44 dígitos — é o
-- documento EXTERNO, e é por ele que uma pessoa liga a conta a pagar à nota do
-- fornecedor na conferência. Trocar apagaria o único lugar onde essa ligação
-- está escrita.
--
--   antes:  000000123
--   depois: LF0042 · 000000123
--
--   antes:  (vazio)
--   depois: LF0042
--
-- NADA DE CÓDIGO DEPENDE DESSE CAMPO POR IGUALDADE. Foi conferido antes de
-- mexer: a conciliação bancária casa por `matched_entry_id`, gravado no clique
-- de uma pessoa (ver a rota /conciliar), e a busca do Financeiro procura em
-- descrição, id e nome da contraparte — nunca no documento. O campo é lido por
-- gente, e prefixá-lo não quebra leitura nenhuma.
--
-- REPETIR É SEGURO: a condição pula quem já tem o próprio código na frente.
--
-- `lpad(code, greatest(4, length))` e não `lpad(code, 4)`: o lpad do Postgres
-- TRUNCA quando o texto é maior que o alvo — a partir de LF10000 o campo viraria
-- "LF1000", um número de outro lançamento. O padStart do JavaScript (que gera os
-- novos) não trunca, e os dois precisam concordar.
with numerados as (
  select
    id,
    'LF' || lpad(code::text, greatest(4, length(code::text)), '0') as codigo,
    coalesce(document, '') as doc
  from financial_entries
  where code is not null
)
update financial_entries e
set document = case when n.doc = '' then n.codigo else n.codigo || ' · ' || n.doc end
from numerados n
where e.id = n.id
  and n.doc <> n.codigo
  and n.doc not like n.codigo || ' · %';

-- ----------------------------------------------------------------------------
-- PARTE 3: A DESCRIÇÃO DOS LANÇAMENTOS ANTIGOS
-- ----------------------------------------------------------------------------
-- A fase AX passou a escrever "Receita de venda · Pedido 1042 · NF-e 123" nos
-- lançamentos NOVOS. Os que já existiam continuaram dizendo só "Pedido 1042" —
-- sem a informação que a fase inteira existiu para dar: se aquela linha é
-- dinheiro entrando ou saindo.
--
-- ESTA MIGRAÇÃO SÓ ACRESCENTA O PREFIXO. Não reescreve o resto.
--
-- O formato completo novo é "Despesa de compra · Ordem OC0007"; o antigo era
-- "Ordem de Compra OC0007 - Fornecedor Alfa". Transformar um no outro em SQL
-- exigiria separar o nome do fornecedor do código da ordem por texto livre — e
-- um separador que erra uma vez corrompe um registro financeiro em silêncio. O
-- prefixo acrescenta o que faltava sem apostar em nada.
--
-- SÓ O QUE O SISTEMA ESCREVEU. As condições exigem vínculo com pedido/nota
-- (`reference_id` ou `nfe_id`) e o formato exato que as origens geravam. Texto
-- que uma pessoa digitou não é tocado: a descrição de um lançamento manual é
-- dela, e "corrigir" o texto de alguém porque o formato mudou é pior do que a
-- descrição fora do padrão.
--
-- CONTRATOS FICAM DE FORA por consequência disso: as parcelas de contrato
-- descrevem-se com o título do contrato ("Aluguel galpão — 2026-09"), que não
-- casa com nenhum dos formatos abaixo.
--
-- REPETIR É SEGURO: a última condição pula o que já tem natureza na frente.
update financial_entries
set description = 'Receita de venda · ' || description
where (coalesce(reference_id, '') <> '' or coalesce(nfe_id, '') <> '')
  and lower(type) in ('receita', 'sale')
  and (description ~ '^Pedido [0-9]' or description ~ '^NF-e ')
  and description !~ '^(Receita|Despesa|Transferência) ';

update financial_entries
set description = 'Despesa de compra · ' || description
where (coalesce(reference_id, '') <> '' or coalesce(nfe_id, '') <> '')
  and lower(type) in ('despesa', 'purchase')
  and (description ~ '^Ordem de Compra ' or description ~ '^NF-e ')
  and description !~ '^(Receita|Despesa|Transferência) ';
