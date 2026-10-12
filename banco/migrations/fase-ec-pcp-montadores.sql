-- ============================================================================
-- FASE EC — ORDENS PARA MONTADORES SEPARADOS (PCP)
-- ============================================================================
--
-- Pedido do usuário (12/10/2026): "uma tela para PCP, para colocar ordens
-- para montadores separados". Decidido com ele:
--   - montador é PESSOA do Cadastros com o papel "Montador" (como o
--     Representante e o Vendedor) — não precisa estar no RH;
--   - a tela mostra o dia de CADA montador (jornada, ocupado, sobra) e é ali
--     que se distribuem modelos/OPs;
--   - imprime a folha de cada montador.
--
-- Reaproveita a Programação do Dia (fase EB): o item programado ganha o
-- montador, e a jornada ajustada do dia passa a poder ser de um montador.
--
-- `montador_id` guarda o id de people (ou cnpjs, montador terceirizado PJ),
-- que são texto e moram em duas tabelas: sem chave estrangeira, como
-- pcp_orders.representante_id (fase DZ).
-- ============================================================================

alter table if exists pcp_programacao add column if not exists montador_id text;
create index if not exists idx_pcp_programacao_montador on pcp_programacao (date, montador_id)
  where montador_id is not null;

-- A jornada ajustada pode ser do setor (fase EB) OU de um montador.
alter table if exists pcp_jornadas add column if not exists montador_id text;
drop index if exists idx_pcp_jornada_dia;
create unique index if not exists idx_pcp_jornada_dia_montador
  on pcp_jornadas (coalesce(sector_id, ''), coalesce(montador_id, ''), date);
