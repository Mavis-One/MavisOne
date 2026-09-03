-- ============================================================================
-- FASE AQ — Compras ganha um documento: cotação e ordem viram a mesma coisa
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- A tabela `purchases` guarda UM PRODUTO POR LINHA: product_id, quantity,
-- cost_price. Não há tabela de itens e não há nada que ligue duas linhas.
--
-- Comprar dez produtos de um fornecedor eram dez registros soltos. O sistema
-- não sabia dizer "esta compra" — sabia dizer "estas dez compras que por acaso
-- têm o mesmo fornecedor e a mesma data". Não havia frete (é da compra, não do
-- item), não havia desconto no total, não havia prazo de entrega, não havia
-- status além de `pendente`, e a tela dava baixa no estoque no ato: não existia
-- o intervalo entre PEDIR e RECEBER, que é justamente onde uma compra vive.
--
-- Cotação não existia de forma alguma. (O `quotes` do banco é orçamento de
-- VENDA — outro módulo, outro documento.)
--
-- POR QUE UMA TABELA SÓ, E NÃO purchase_quotes + purchase_orders
-- ---------------------------------------------------------------
-- Porque Vendas já resolveu isto e a decisão está escrita no catálogo de
-- status: eram duas telas ("Novo Pedido" e "Novo Orçamento") com o mesmo
-- formulário e só o tipo mudando, e viraram uma, onde o STATUS decide o tipo.
--
-- A cotação e a ordem têm os mesmos campos, os mesmos itens e os mesmos totais.
-- O que muda é em que ponto da vida o documento está. Duas tabelas obrigariam a
-- COPIAR a cotação para virar ordem — e cópia é onde o histórico se perde: a
-- ordem não saberia mais de que cotação nasceu, e corrigir um item na ordem
-- deixaria a cotação mentindo para sempre.
--
-- Aqui, aprovar uma cotação é mudar o status. O documento é o mesmo, e a
-- trajetória dele fica inteira num registro só.
--
-- POR QUE items É jsonb, E NÃO purchase_order_items
-- --------------------------------------------------
-- Para ser igual a `orders.items`, que já é jsonb. Os itens de um documento não
-- são consultados por fora dele — ninguém pergunta "em que compras entrou o
-- produto X" para a tabela de itens; pergunta para o razão de estoque, que é
-- quem guarda o que de fato entrou. Item de ordem é INTENÇÃO; movimento de
-- estoque é FATO. Separar tabela para a intenção seria dar a ela um peso que
-- ela não tem.
--
-- POR QUE NÃO HÁ CHAVE ESTRANGEIRA PARA supplier_id NEM PARA deposit_id
-- ---------------------------------------------------------------------
-- Mesma razão da fase AP: documento é histórico, e histórico sobrevive ao
-- cadastro. Excluir um fornecedor não pode apagar a prova de que se comprou
-- dele. O nome viaja junto (supplier_name) para a lista continuar legível
-- depois que o cadastro morreu.
--
-- O QUE ESTA FASE NÃO FAZ
-- -----------------------
-- Não mexe em `purchases`. A tabela antiga continua onde está, com os dados que
-- tem: migrar linha solta para documento exigiria adivinhar quais linhas eram a
-- mesma compra, e adivinhar histórico é pior do que deixá-lo quieto. A tela
-- "Histórico de Compras" continua lendo dela.

-- ----------------------------------------------------------------------------
-- O documento
-- ----------------------------------------------------------------------------
create table if not exists purchase_orders (
  id                text primary key,
  -- Redundante com o status de propósito: o status manda, mas filtrar a lista
  -- de Cotações por `type` é um índice, e por status seria um IN com seis
  -- valores que cresce toda vez que alguém acrescenta um status.
  type              text not null default 'quote',
  status            text not null default 'cotacao',
  code              integer,

  supplier_id       text,
  supplier_name     text not null default '',
  company_id        text,
  -- Onde a mercadoria entra quando a ordem for recebida. '' é valor, não
  -- ausência: significa "sem depósito", o mesmo balde da fase AP.
  deposit_id        text not null default '',

  date              date not null,
  -- Quando o fornecedor prometeu. É o que separa uma ordem atrasada de uma
  -- ordem em dia, e não existia antes.
  delivery_date     date,
  note              text,

  items             jsonb not null default '[]'::jsonb,
  items_total       numeric not null default 0,
  -- Frete, despesas e desconto são do DOCUMENTO, não do item: rateá-los por
  -- item na hora de gravar perderia o valor que o fornecedor de fato cobrou.
  freight           numeric not null default 0,
  other_expenses    numeric not null default 0,
  discount_amount   numeric not null default 0,
  total_amount      numeric not null default 0,

  -- Os dois efeitos, gravados no documento e não deduzidos do status: o status
  -- pode mudar depois, e o que já aconteceu não desacontece. É o mesmo par que
  -- orders.stock_applied guarda em Vendas.
  stock_applied     boolean not null default false,
  finance_applied   boolean not null default false,
  -- A nota de entrada que materializou esta ordem, quando houver. É ela que
  -- impede a entrada em dobro: se a nota já moveu o estoque, receber a ordem
  -- não move de novo. Sem FK pelo mesmo motivo dos outros ids.
  entrada_nfe_id    text,

  created_by        text,
  created_by_name   text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Numeração pela sequence, e não por max+1 no Node: max+1 reusa número depois
-- de uma exclusão e repete quando duas pessoas gravam ao mesmo tempo. Mesma
-- correção que a fase AP fez no código do movimento de estoque.
create sequence if not exists purchase_orders_code_seq as integer start with 1;

create index if not exists idx_purchase_orders_type on purchase_orders (type);
create index if not exists idx_purchase_orders_status on purchase_orders (status);
create index if not exists idx_purchase_orders_supplier on purchase_orders (supplier_id);
create index if not exists idx_purchase_orders_date on purchase_orders (date desc);
create index if not exists idx_purchase_orders_entrada on purchase_orders (entrada_nfe_id);

-- RLS: ver o cabeçalho da fase-af. O app conecta como DONO das tabelas e passa
-- por cima, então ligar aqui não muda o comportamento de hoje — é a camada que
-- continua de pé se este banco for publicado de novo.
alter table if exists purchase_orders enable row level security;
