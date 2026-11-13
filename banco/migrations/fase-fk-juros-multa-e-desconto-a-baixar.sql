-- ============================================================================
-- FASE FK — JUROS, MULTA E DESCONTO COMBINADOS NO TÍTULO, A BAIXAR DEPOIS
-- ============================================================================
--
-- Pedido do usuário (13/11/2026): "preciso de um botão de salvar sem precisar
-- especificamente lançar o título ou editá-lo, pois o juros e ou a multa
-- precisam ser baixados com a conciliação também".
--
-- Juros, multa e desconto só existiam na BAIXA (financial_payments): para
-- guardá-los era preciso registrar o recebimento. E a conciliação do extrato
-- baixava sempre com juros e multa zerados, recusando o crédito de R$ 3.094,65
-- (R$ 2.990,00 + R$ 104,65 de juros) por ser maior que o saldo.
--
-- Agora o título guarda o combinado, ainda não baixado. A conciliação (e a
-- automática) espera o saldo + juros + multa − desconto e, batendo, leva os
-- três para a baixa; o título fica com zero a baixar. `ajuste_combinado` marca a
-- baixa que os levou: estornar ou desconciliar essa baixa devolve o combinado
-- ao título, em vez de perdê-lo.
-- ============================================================================

alter table financial_entries
  add column if not exists juros_a_baixar numeric(14,2) not null default 0,
  add column if not exists multa_a_baixar numeric(14,2) not null default 0,
  add column if not exists desconto_a_baixar numeric(14,2) not null default 0;

alter table financial_entries drop constraint if exists financial_entries_a_baixar_nao_negativo;
alter table financial_entries
  add constraint financial_entries_a_baixar_nao_negativo
  check (juros_a_baixar >= 0 and multa_a_baixar >= 0 and desconto_a_baixar >= 0);

alter table financial_payments
  add column if not exists ajuste_combinado boolean not null default false;
