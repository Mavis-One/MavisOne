-- ============================================================================
-- FASE ED — BAIXA DE MONTAGEM (PCP) QUE MOVIMENTA O ESTOQUE DE DESMONTADAS
-- ============================================================================
--
-- Pedido do usuário (12/10/2026): "um botão para dar baixa conforme o pessoal
-- montar, e essa baixa tem que movimentar o estoque de desmontadas".
-- Decidido com ele:
--   - a scooter desmontada é o MESMO produto, guardado num depósito de
--     desmontadas; montar = transferir a quantidade montada desse depósito
--     para o depósito de montadas;
--   - a baixa é PARCIAL: o montador recebeu 6, montou 3, dá baixa em 3.
--
-- pcp_baixas guarda cada baixa com os dois movimentos de estoque que ela
-- gerou (para o estorno saber o que desfazer). pcp_programacao ganha o total
-- montado da linha, mantido na MESMA transação da baixa e dos movimentos.
-- pcp_config guarda os dois depósitos (uma linha só).
-- ============================================================================

alter table if exists pcp_programacao add column if not exists quantidade_montada numeric(14,4) not null default 0
  check (quantidade_montada >= 0);

create table if not exists pcp_baixas (
  id text primary key,
  -- Linha com baixa ATIVA não sai (a rota recusa: desfaça antes). Com todas
  -- as baixas desfeitas ela pode sair, e as baixas ficam como histórico.
  programacao_id text references pcp_programacao(id) on delete set null,
  date date not null,
  product_id text not null references products(id),
  quantidade numeric(14,4) not null check (quantidade > 0),
  montador_id text,
  origem_deposit_id text not null,
  destino_deposit_id text not null,
  class_value_id text,
  movimento_saida_id text,
  movimento_entrada_id text,
  -- Estorno: os movimentos contrários são gravados e a baixa fica marcada
  -- (não se apaga — o razão de estoque é história).
  estornada_em timestamptz,
  estornada_por_nome text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pcp_baixas_programacao on pcp_baixas (programacao_id);
create index if not exists idx_pcp_baixas_dia on pcp_baixas (date);
alter table pcp_baixas enable row level security;

create table if not exists pcp_config (
  id smallint primary key default 1 check (id = 1),
  deposito_desmontadas_id text,
  deposito_montadas_id text,
  atualizado_em timestamptz not null default now()
);
alter table pcp_config enable row level security;
