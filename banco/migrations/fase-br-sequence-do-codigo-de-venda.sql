-- ---------------------------------------------------------------------------
-- Fase BR — o numero do pedido e do orcamento sai de uma SEQUENCE
--
-- Ate aqui getNextSalesCode fazia max+1 lendo orders e quotes:
--
--   select code from orders order by code desc limit 1
--   select code from quotes order by code desc limit 1
--   maior + 1
--
-- Entre esse SELECT e o INSERT existe uma janela. Duas requisicoes simultaneas
-- — duas pessoas salvando, ou o mesmo botao clicado duas vezes — leem o mesmo
-- maior e gravam o mesmo numero. Nao ha unique em orders.code nem em
-- quotes.code (idx_orders_code e idx_orders_code sao indices comuns), entao o
-- banco aceita os dois.
--
-- Nada e indexado por `code` — o vinculo entre pedido, NF-e e contas a receber
-- e sempre por `id` —, entao o estrago nao e corrupcao: e' a lista mostrando
-- dois documentos com o mesmo numero, a busca por numero devolvendo dois, e o
-- cliente recebendo duas notas que citam "Pedido 1042".
--
-- A sequence resolve isso porque nextval e' atomico: dois pedidos simultaneos
-- recebem numeros diferentes sem trava nenhuma. E o mesmo desenho que
-- purchase_orders_code_seq (fase AQ) e stock_movements_code_seq (fase AP) ja
-- usam.
--
-- COMECA DEPOIS DO MAIOR NUMERO QUE JA EXISTE, somando os dois tipos: pedido e
-- orcamento compartilham a numeracao, e comecar do 1 repetiria todos os
-- numeros ja gravados.
-- ---------------------------------------------------------------------------

create sequence if not exists sales_code_seq as integer start with 1;

-- setval com o maior de orders/quotes, ou 1000 (o piso que getNextSalesCode
-- sempre usou). `is_called = true` faz o proximo nextval devolver maior+1.
select setval(
  'sales_code_seq',
  greatest(
    coalesce((select max(code) from orders), 0),
    coalesce((select max(code) from quotes), 0),
    1000
  ),
  true
);

comment on sequence sales_code_seq is
  'Numeracao compartilhada de pedidos e orcamentos. nextval e atomico: substitui '
  'o max+1 que abria janela para dois documentos com o mesmo numero (fase BR).';
