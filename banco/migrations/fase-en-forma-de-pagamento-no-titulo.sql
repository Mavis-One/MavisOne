-- ============================================================================
-- FASE EN — A FORMA DE PAGAMENTO DO TÍTULO
-- ============================================================================
--
-- Pedido do usuário (14/10/2026): "adicione um campo de formas de pagamento
-- para contas a receber e contas a pagar e lançamentos".
--
-- O id aponta para o cadastro de Formas de Pagamento (Cadastros), que mora no
-- db.json e não no Postgres — por isso não há chave estrangeira, e o NOME vai
-- junto: a lista mostra a forma mesmo que o cadastro seja renomeado ou
-- inativado depois, como o título guarda o nome da credenciadora (fase BX).
--
-- Títulos anteriores ficam vazios. Os que nascem de pedido passam a vir com a
-- forma da parcela.
-- ============================================================================

alter table financial_entries
  add column if not exists payment_method_id text,
  add column if not exists payment_method_name text;

comment on column financial_entries.payment_method_id is
  'Forma de pagamento do título (id do cadastro de Formas de Pagamento, no db.json).';
comment on column financial_entries.payment_method_name is
  'Nome da forma de pagamento na data em que foi escolhida.';
