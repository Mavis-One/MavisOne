-- ============================================================================
-- FASE BB — o equipamento sai do db.json e a garantia passa a ser contada
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- O cadastro de equipamento tinha um campo "Garantia até": uma DATA QUE ALGUÉM
-- DIGITA. Ninguém digita — e quando digita, digita errado. Meses depois, a
-- pergunta que decide se um conserto é cobrado ("esta máquina está na
-- garantia?") não tem resposta no sistema, e vira a memória de quem vendeu.
--
-- A data existe num documento: a NF-e que vendeu a máquina. A garantia é um
-- PRAZO contado a partir dela, e prazo o vendedor sabe de cor ("12 meses"). A
-- auditoria do ERP anterior achou o mesmo buraco: equipamento de cliente sem
-- vínculo com a venda, e garantia como campo livre.
--
-- POR QUE A TABELA, E POR QUE AGORA
-- ----------------------------------
-- O equipamento morava em data/db.json e apontava para `people`/`cnpjs` e
-- `deposits`, que são tabelas do Postgres. Agora aponta também para a NF-e.
-- Registro em arquivo referenciando quatro tabelas é a divisão que as fases AP,
-- AS e BA desfizeram: sem transação, sem o pg_dump enxergar, e com duas
-- requisições simultâneas apagando o trabalho uma da outra ao reescrever o
-- arquivo inteiro.
--
-- AGORA porque a coleção tem ZERO REGISTROS. É a única janela em que essa
-- mudança não custa migração de dados nenhuma — daqui a um mês custa.
--
-- POR QUE NÃO HÁ CHAVE ESTRANGEIRA PARA A NOTA
-- ---------------------------------------------
-- `nfe_id` aponta ora para `nfe` (a fiscal, uuid), ora para `nfes` (a manual,
-- texto). Uma FK só sabe apontar para uma tabela — mesma situação de
-- `financial_entries.nfe_id`, resolvida do mesmo jeito na fase AE.
--
-- Para pessoa e depósito também não há FK, e por outro motivo: equipamento é
-- histórico de assistência técnica. Excluir um cliente não pode apagar em
-- cascata a prova de qual máquina ele tem.
--
-- OS DOIS MODOS DE GARANTIA
-- --------------------------
--   'prazo' — N meses a partir da nota (ou da aquisição, sem nota). O caso
--             normal, e o que tira a data das mãos de quem cadastra.
--   'data'  — data escrita à mão, para garantia negociada ("estendida até
--             31/12/2027"). Sem esta saída, alguém inventaria um número de
--             meses que não bate com o combinado.
--
-- `warranty_until` continua existindo e passa a ser CALCULADO na gravação, nos
-- dois modos. Ele é coluna, e não conta feita na leitura, porque a pergunta
-- "quais garantias vencem este mês?" é uma consulta — e consulta não roda em
-- cima de um valor que só existe depois de o JavaScript montar a resposta.

create table if not exists equipments (
  id                text primary key,
  name              text not null,
  code              text not null default '',
  serial_number     text not null default '',
  model             text not null default '',
  brand             text not null default '',
  -- Cliente/proprietário: id de `people` OU de `cnpjs`. Sem FK — ver acima.
  person_id         text not null default '',
  deposit_id        text not null default '',
  location          text not null default '',
  purchase_date     date,
  purchase_value    numeric not null default 0,
  -- 'ativo' | 'inativo' | 'manutencao' | 'baixado'
  status            text not null default 'ativo',
  notes             text not null default '',

  -- ---- a garantia (fase BB) ------------------------------------------------
  -- Qual NF-e vendeu esta máquina. É daqui que sai a data de início da
  -- garantia; vazio quando o equipamento não veio de uma venda registrada.
  nfe_id            text not null default '',
  -- 'prazo' | 'data' — ver o cabeçalho.
  warranty_mode     text not null default 'prazo',
  -- O prazo, em meses. Só significa alguma coisa no modo 'prazo'.
  warranty_months   integer,
  -- O resultado, calculado na gravação nos dois modos.
  warranty_until    date,

  created_by        text,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Número de série repetido é o mesmo equipamento cadastrado duas vezes, e é
-- assim que a assistência técnica perde o histórico de uma máquina. O índice é
-- PARCIAL porque série vazia é comum e legítima (equipamento sem plaqueta), e
-- um único NULL não pode bloquear todos os outros.
create unique index if not exists idx_equipments_serie
  on equipments (lower(serial_number)) where serial_number <> '';

create index if not exists idx_equipments_person on equipments (person_id);
create index if not exists idx_equipments_deposit on equipments (deposit_id);
-- A pergunta que a tela de assistência faz: "o que vence este mês?".
create index if not exists idx_equipments_warranty on equipments (warranty_until);

-- RLS: ver o cabeçalho da fase-af.
alter table if exists equipments enable row level security;
