-- ============================================================================
-- FASE CD — qual conta bancária cada estabelecimento pode usar
-- ============================================================================
--
-- O QUE ISTO RESOLVE
-- ------------------
-- Hoje toda conta bancária aparece para todo mundo. Numa empresa com matriz e
-- filiais isso está errado nos dois sentidos: a filial enxerga (e pode lançar
-- em) a conta da matriz, e nada no sistema sabe dizer de quem é cada conta.
--
-- A regra pedida é assimétrica de propósito:
--
--   MATRIZ  → pode usar TODAS as contas, inclusive as das filiais.
--   FILIAL  → NÃO pode usar a conta da matriz.
--   FILIAL  → pode usar as contas das OUTRAS filiais livremente.
--
-- POR QUE A CONTA PRECISA DE UM DONO
-- ----------------------------------
-- `bank_accounts.estabelecimento_id` já existia — veio da sincronização Open
-- Finance, que grava de qual estabelecimento é a conexão. A tela de cadastro
-- nunca preencheu essa coluna, então hoje TODA conta é órfã. Sem dono, a regra
-- acima não tem de onde sair: "a conta da matriz" é uma frase sobre o dono.
--
-- Esta fase passa a preencher a coluna pela tela. E conta órfã continua
-- valendo, com um significado explícito: é conta DA CASA, e todo mundo usa.
-- Inventar um dono para as contas que já existem seria afirmar uma coisa que
-- ninguém disse.
--
-- A TABELA GUARDA A DECISÃO, NÃO A REGRA
-- --------------------------------------
-- `conta_estabelecimento` é uma lista de permissão: cada linha diz "este
-- estabelecimento pode usar esta conta". Mas uma lista de permissão pura tem um
-- problema no primeiro dia — com a tabela vazia, NINGUÉM pode usar NADA, e o
-- Financeiro para.
--
-- Por isso a ausência tem significado, e o significado é POR CONTA:
--
--   conta SEM nenhuma linha  → ainda não foi configurada; vale a regra padrão
--   conta COM alguma linha   → vale exatamente o que está marcado
--
-- Isso resolve três coisas de uma vez. Conta nova criada meses depois, por
-- qualquer caminho (cadastro, Open Finance), nasce seguindo a regra em vez de
-- nascer inutilizável. Desmarcar tudo volta ao padrão em vez de criar uma conta
-- que ninguém pode usar — e "conta que não deve mais ser usada" já tem resposta
-- própria no sistema, que é inativar (`bank_accounts.ativo`). E quem abrir a
-- tela vê quais contas alguém decidiu à mão e quais estão no automático.
--
-- O CONTEXTO: DE QUAL ESTABELECIMENTO É ESTA OPERAÇÃO
-- ---------------------------------------------------
-- A regra só morde se, na hora de escolher a conta, o sistema souber por qual
-- estabelecimento a pessoa está agindo. Isso não existia:
--
--   users.estabelecimento_id           — o estabelecimento padrão da pessoa.
--                                        É o que entra preenchido no lançamento.
--   users.pode_trocar_estabelecimento  — pode lançar por OUTRO estabelecimento
--                                        além do seu. Falso por padrão; quem
--                                        administra o sistema pode sempre.
--   financial_entries.estabelecimento_id — de qual estabelecimento é o
--                                        lançamento. Sem isto, a conferência
--                                        não teria contra o que conferir na
--                                        hora de editar um lançamento antigo.
--
-- Os três são NULOS nas linhas que já existem, e nulo aqui quer dizer "não
-- informado" — não "matriz". Um lançamento sem estabelecimento não é conferido
-- contra a regra, porque não há pergunta a fazer: ele é de antes da regra
-- existir. Preencher para trás com a matriz seria inventar um fato.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A LISTA DE PERMISSÃO
-- ---------------------------------------------------------------------------
create table if not exists conta_estabelecimento (
  -- `text` porque bank_accounts.id é text (o createId da casa), e `uuid`
  -- porque estabelecimento.id é uuid. São duas convenções diferentes já
  -- existentes; uniformizá-las seria outra migração, muito maior.
  bank_account_id    text not null references bank_accounts(id)    on delete cascade,
  estabelecimento_id uuid not null references estabelecimento(id)  on delete cascade,
  criado_em          timestamptz not null default now(),
  -- A chave é o par. Marcar duas vezes a mesma combinação é a mesma decisão.
  primary key (bank_account_id, estabelecimento_id)
);

-- A pergunta quente é "quais contas este estabelecimento pode usar?", feita a
-- cada abertura do formulário de lançamento. A chave primária serve à pergunta
-- inversa (é `bank_account_id` primeiro), então esta é a outra ponta.
create index if not exists idx_conta_estab_por_estabelecimento
  on conta_estabelecimento (estabelecimento_id);

comment on table conta_estabelecimento is
  'Quais contas bancárias cada estabelecimento pode usar. Conta SEM nenhuma '
  'linha aqui segue a regra padrão (matriz usa todas; filial não usa a da '
  'matriz; filiais compartilham entre si) — ver lib/contas-por-estabelecimento '
  'e a tela Configurações > Contas por Estabelecimento (fase CD).';

-- ---------------------------------------------------------------------------
-- 2. O CONTEXTO DE QUEM LANÇA
-- ---------------------------------------------------------------------------
alter table if exists users
  add column if not exists estabelecimento_id uuid references estabelecimento(id),
  add column if not exists pode_trocar_estabelecimento boolean not null default false;

comment on column users.estabelecimento_id is
  'Estabelecimento padrão da pessoa: é o que entra preenchido no lançamento '
  'financeiro e o que filtra a lista de contas. NULO = não informado (fase CD).';

comment on column users.pode_trocar_estabelecimento is
  'Pode lançar por outro estabelecimento além do seu. Quem administra o '
  'sistema pode sempre, independente desta coluna (fase CD).';

-- ---------------------------------------------------------------------------
-- 3. DE QUEM É O LANÇAMENTO
-- ---------------------------------------------------------------------------
alter table if exists financial_entries
  add column if not exists estabelecimento_id uuid references estabelecimento(id);

comment on column financial_entries.estabelecimento_id is
  'De qual estabelecimento é este lançamento. NULO nos lançamentos anteriores '
  'à fase CD: eles não são conferidos contra a regra de contas, porque não há '
  'pergunta a fazer. Preencher para trás com a matriz inventaria um fato.';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Como em toda tabela deste schema: ligada e sem policy. Só o servidor fala com
-- o banco, e ele usa o dono da conexão, que ignora RLS. Uma conexão que
-- aparecesse depois — um cliente no navegador, uma ferramenta de BI — não lê
-- nada por acidente.
alter table if exists conta_estabelecimento enable row level security;
