-- ============================================================================
-- FASE AT — o lançamento financeiro ganha número próprio (LF)
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- O lançamento não tinha número. A tela de edição se identificava assim:
--
--   <p>Editando ${String(editEntry.id).slice(-8)}</p>
--
-- Isto é, os oito últimos caracteres do id interno: "41196-9q1". Não é número
-- de nada — é um pedaço de um identificador que ninguém dita ao telefone, não
-- ordena, não se procura e não cabe num comprovante.
--
-- `document` NÃO SERVIA PARA ISSO, e continua não servindo: ele guarda o
-- documento de FORA (o boleto do fornecedor, a nota, o contrato). Reaproveitá-lo
-- como número interno apagaria a informação que só existe ali.
--
-- POR QUE UMA SEQUENCE, E NÃO max(code)+1
-- ----------------------------------------
-- Mesma correção que a fase AP fez no razão de estoque e a AQ nas compras:
-- max+1 lido no Node reusa número depois de uma exclusão e gera o mesmo duas
-- vezes quando dois lançamentos nascem ao mesmo tempo. Número de documento
-- repetido é pior do que número nenhum: dois papéis diferentes dizendo ser o
-- mesmo.
--
-- A ORDEM DO BACKFILL É CRONOLÓGICA, e a escolha importa
-- -------------------------------------------------------
-- Numerar histórico é decidir o que o número significa. Ordenar por `created_at`
-- (quando o lançamento entrou no sistema) faz LF0001 ser o primeiro lançamento
-- registrado — que é o que qualquer pessoa espera de um número sequencial, e o
-- que mantém a ordem estável se alguém corrigir uma data de vencimento depois.
--
-- Ordenar por `date` ou `due_date` seria numerar por competência, e aí um
-- lançamento retroativo criado hoje receberia um número do meio da série,
-- deslocando os outros — ou, pior, criando um segundo LF0001.
--
-- O desempate é por `id`, que é único: sem ele, dois lançamentos criados no
-- mesmo instante trocariam de número a cada vez que a migração rodasse.

-- Nulo é permitido de propósito: o backfill logo abaixo preenche os que
-- existem, e o `not null` só poderia entrar depois de garantir que TODA rota de
-- criação passou a numerar. Uma coluna obrigatória numa tabela viva derruba a
-- gravação de quem ainda não foi atualizado — e a gravação que derruba aqui é a
-- de contas a pagar.
alter table if exists financial_entries
  add column if not exists code integer;

create sequence if not exists financial_entries_code_seq as integer start with 1;

-- O número é único, e é o índice que garante. Conferir na aplicação deixaria
-- duas requisições simultâneas passarem pela checagem antes de qualquer uma
-- gravar. `where code is not null` para os lançamentos antigos que porventura
-- fiquem sem número não colidirem entre si.
create unique index if not exists idx_financial_entries_code
  on financial_entries (code) where code is not null;

-- ----------------------------------------------------------------------------
-- Backfill: numera o que já existe, em ordem de entrada no sistema
-- ----------------------------------------------------------------------------
-- `where code is null` faz a migração ser repetível: rodar duas vezes não
-- renumera o que já tem número.
with ordenados as (
  select id, row_number() over (order by created_at, id) as n
  from financial_entries
  where code is null
)
update financial_entries e
set code = o.n
from ordenados o
where e.id = o.id;

-- A sequence continua DEPOIS do último número entregue. Sem isto, o próximo
-- lançamento nasceria com LF0001 e esbarraria no índice único — e o erro
-- apareceria na primeira conta a pagar de quem aplicou a migração, não aqui.
select setval(
  'financial_entries_code_seq',
  greatest(coalesce((select max(code) from financial_entries), 0), 1),
  (select count(*) > 0 from financial_entries where code is not null)
);
