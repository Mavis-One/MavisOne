-- ============================================================================
-- FASE ES — TRAVA DE PAGAMENTO ANTES DA NF-e
-- ============================================================================
--
-- Pedido do usuário (19/10/2026): o desenho "Fluxo de Faturamento com
-- confirmação de pagamento antes da NF-e", adaptado ao fluxo que já existe. A
-- NF-e de um pedido só é transmitida quando o recebimento dos títulos dele
-- atinge a política configurada; quem tem a permissão pode emitir mesmo assim,
-- com motivo. A regra mora em lib/faturamento-gate.js; aqui ficam só o que ela
-- precisa guardar:
--
--   - a POLÍTICA (uma linha só): integral (padrão), entrada ou percentual;
--   - a PERMISSÃO por usuário de emitir sem o pagamento confirmado (como a de
--     alterar vendas de outros, fase EQ). O administrador pode sempre.
-- ============================================================================

alter table if exists users add column if not exists pode_emitir_nfe_sem_pagamento boolean not null default false;

comment on column users.pode_emitir_nfe_sem_pagamento is
  'Fase ES: pode emitir a NF-e de um pedido antes de o pagamento estar confirmado ("Emitir mesmo assim", com motivo).';

create table if not exists faturamento_config (
  id smallint primary key default 1 check (id = 1),
  politica text not null default 'integral' check (politica in ('integral', 'entrada', 'percentual')),
  percentual numeric(5,2) not null default 100 check (percentual > 0 and percentual <= 100),
  atualizado_em timestamptz not null default now(),
  atualizado_por_nome text
);
alter table faturamento_config enable row level security;

insert into faturamento_config (id) values (1) on conflict (id) do nothing;
