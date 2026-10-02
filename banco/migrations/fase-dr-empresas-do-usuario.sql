-- ============================================================================
-- FASE DR — AS EMPRESAS DO USUÁRIO
-- ============================================================================
--
-- A ficha do usuário passou a ter a grade "Empresas do Usuário" do Viper: uma
-- chave por estabelecimento. Até aqui a fase CD só sabia dizer duas coisas —
-- "lança só pelo seu" (pode_trocar_estabelecimento = false) ou "lança por
-- qualquer um" (true). Liberar a Marcolla e Araquari para quem é do Centro, e
-- nenhuma outra, não tinha onde ficar.
--
-- O QUE CADA COLUNA DIZ, DEPOIS DESTA FASE
--   estabelecimento_id           o principal: entra preenchido no lançamento.
--   estabelecimentos_liberados   os OUTROS pelos quais a pessoa pode lançar.
--   pode_trocar_estabelecimento  "Todas": qualquer um, inclusive filial que
--                                for cadastrada depois. Continua valendo como
--                                antes, então ninguém perde acesso com a fase.
--
-- Vazio é o estado de todo mundo hoje e quer dizer "só o principal" — que é
-- exatamente o que pode_trocar = false já dizia.
-- ============================================================================

alter table if exists users
  add column if not exists estabelecimentos_liberados uuid[] not null default '{}';

comment on column users.estabelecimentos_liberados is
  'Outros estabelecimentos pelos quais a pessoa pode lançar, além do principal '
  '(estabelecimento_id). Vazio = só o principal. pode_trocar_estabelecimento = '
  'true continua liberando todos (fase DR).';
