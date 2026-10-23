-- ============================================================================
-- FASE FD — CONTA A PAGAR A PRAZO VENCE EM DIA ÚTIL
-- ============================================================================
--
-- Pedido do usuário (23/10/2026): "tudo que for colocado no sistema com
-- vencimento para sábado, domingo e/ou feriados nacionais brasileiros seja
-- jogado para o próximo dia útil" — "apenas contas a pagar com intuito de
-- parcelamento ou a prazo; tudo que for à vista não entra nisso".
--
-- A regra mora no código (public/modules/shared/dia_util.js), e é aplicada ao
-- gravar o título (lib/db/financeiro.js). Aqui, os títulos que JÁ EXISTEM:
-- conta a pagar (DESPESA), a prazo (vence depois da data do lançamento), EM
-- ABERTO (pendente ou parcial), com vencimento em sábado, domingo ou feriado.
-- Os pagos e os cancelados ficam como estão: são história.
--
-- As funções abaixo são TEMPORÁRIAS (pg_temp): existem só nesta transação. O
-- calendário de verdade é o do arquivo JS — uma segunda cópia permanente no
-- banco divergiria dele no primeiro ajuste. A conta é a mesma, linha a linha:
-- os fixos da lei, 20/11 desde 2024, Sexta-feira Santa, Carnaval e Corpus
-- Christi (calendário bancário), a partir da Páscoa de Meeus/Jones/Butcher.
-- ============================================================================

create function pg_temp.pascoa(ano int) returns date language plpgsql immutable as $$
declare
  a int := ano % 19; b int := ano / 100; c int := ano % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(ano, mes, dia);
end $$;

create function pg_temp.eh_dia_util(dia date) returns boolean language plpgsql immutable as $$
declare
  ano int := extract(year from dia)::int;
  p date := pg_temp.pascoa(ano);
  md text := to_char(dia, 'MM-DD');
begin
  if extract(isodow from dia) in (6, 7) then return false; end if;
  if md in ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25') then return false; end if;
  if md = '11-20' and ano >= 2024 then return false; end if;
  if dia in (p - 48, p - 47, p - 2, p + 60) then return false; end if;
  return true;
end $$;

create function pg_temp.proximo_dia_util(dia date) returns date language plpgsql immutable as $$
declare
  d date := dia;
  n int := 0;
begin
  while not pg_temp.eh_dia_util(d) and n < 15 loop
    d := d + 1;
    n := n + 1;
  end loop;
  return d;
end $$;

update financial_entries
   set due_date = pg_temp.proximo_dia_util(due_date),
       updated_at = now()
 where type = 'DESPESA'
   and status in ('pending', 'parcial')
   and date is not null and due_date is not null
   and due_date > date
   and not pg_temp.eh_dia_util(due_date);
