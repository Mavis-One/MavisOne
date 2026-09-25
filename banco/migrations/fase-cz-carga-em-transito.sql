-- ---------------------------------------------------------------------------
-- Fase CZ — a transferência entre lojas passa a ter trânsito e conferência
--
-- O QUE HAVIA
-- -----------
-- A transferência era INSTANTÂNEA: a saída da origem e a entrada no destino
-- nasciam na mesma transação, com `movement_out_id` e `movement_in_id`
-- gravados juntos. Não havia estado intermediário.
--
-- Para depósitos dentro do mesmo galpão isso está certo — a mercadoria muda de
-- prateleira e pronto. Para 13 lojas, não: a carga que sai do CD aparece no
-- estoque da FILIAL 08 ANTES DE O CAMINHÃO SAIR. Três consequências, todas
-- silenciosas:
--
--   1. a filial vende o que ainda está na estrada, e o cliente descobre no
--      balcão;
--   2. a origem já não responde pela mercadoria, e o destino ainda não a tem
--      fisicamente — ninguém é o dono durante a viagem;
--   3. perda no caminho não existe como fato. Ela reaparece meses depois como
--      falta na contagem da filial, sem data e sem carga a que atribuí-la.
--
-- O TERCEIRO ESTADO, E ONDE A MERCADORIA FICA
-- -------------------------------------------
-- Enviar move da origem para um BALDE DE TRÂNSITO; receber move do trânsito
-- para o destino. São quatro movimentos no razão, não dois, e o total do
-- produto nunca muda em nenhum dos dois passos — a mercadoria existe durante a
-- viagem, e um sistema que a faz desaparecer até a chegada mentiria para a
-- contagem e para o valor do estoque.
--
-- O balde é `deposit_id = '__transito__'`, e NÃO uma linha em `deposits`. A
-- decisão é o coração desta fase:
--
--   · o saldo por depósito é `soma dos movimentos daquele deposit_id` (ver
--     lib/stock-core.js), então um id sem linha em `deposits` já soma certo,
--     já respeita a guarda de saldo negativo do commitStockMovements e já
--     aparece na contagem do razão. Nada de matemática nova;
--
--   · toda tela monta os seletores a partir de `data.deposits`, e
--     `assertMovementIsPossible` RECUSA depósito que não esteja lá. Então o
--     trânsito é automaticamente inescolhível: ninguém lança movimento manual
--     nele, ninguém o põe como depósito padrão de produto, ninguém o exclui,
--     ninguém transfere para dentro dele pela tela. Uma linha em `deposits`
--     exigiria escrever cada uma dessas guardas à mão, e a que faltasse seria
--     a que alguém usaria.
--
-- É o mesmo desenho do balde de saldo NÃO ALOCADO (`deposit_id = ''`), que já
-- existe e já funciona assim. A diferença é que este tem nome.
--
-- POR QUE `status` NASCE 'recebida'
-- ---------------------------------
-- Toda transferência que já existe foi instantânea: saiu e chegou no mesmo
-- instante. Marcá-las 'enviada' inventaria um trânsito que nunca houve e
-- encheria a lista de cargas pendentes com anos de histórico. O default já é o
-- valor verdadeiro para o passado, e o envio novo grava 'enviada'
-- explicitamente.
--
-- A CONFERÊNCIA ACEITA DIVERGÊNCIA, E NÃO A APAGA
-- -----------------------------------------------
-- `received_quantity` ACUMULA, e o status só vira 'recebida' quando alcança
-- `quantity`. Enquanto falta, a linha segue 'enviada' e o que falta segue no
-- balde de trânsito.
--
-- É de propósito que não exista aqui um "dar baixa na falta": escrever perda de
-- estoque é decisão de contabilidade, não default que o sistema escolhe. E
-- acumular permite o caso comum — a caixa que faltava aparece no dia seguinte e
-- é recebida numa segunda conferência, sem nenhum lançamento de perda. O que
-- não se resolve fica visível na lista de cargas em trânsito, que é a pressão
-- para alguém decidir.
--
-- Receber MAIS do que foi enviado é recusado: o excesso não saiu de nenhuma
-- origem, e aceitá-lo criaria estoque.
-- ---------------------------------------------------------------------------

alter table if exists stock_transfers
  add column if not exists status text not null default 'recebida';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stock_transfers_status_check'
  ) then
    alter table stock_transfers add constraint stock_transfers_status_check
      check (status in ('enviada', 'recebida'));
  end if;
end $$;

-- Quanto já foi CONFERIDO na chegada. Acumula entre conferências; nunca passa
-- de `quantity` (a rota recusa antes, e o CHECK abaixo é a garantia).
alter table if exists stock_transfers
  add column if not exists received_quantity numeric(18, 4) not null default 0;

alter table if exists stock_transfers
  add column if not exists sent_at timestamptz;
alter table if exists stock_transfers
  add column if not exists received_at timestamptz;
alter table if exists stock_transfers
  add column if not exists received_by text not null default '';
alter table if exists stock_transfers
  add column if not exists received_by_name text not null default '';

-- As duas pernas novas. `movement_out_id` e `movement_in_id` MANTÊM o
-- significado que sempre tiveram — saída da origem e entrada no destino —, e o
-- segundo passa a ser preenchido só na chegada. Quem já lia essas colunas
-- continua lendo a mesma coisa.
alter table if exists stock_transfers
  add column if not exists movement_transit_in_id text not null default '';
alter table if exists stock_transfers
  add column if not exists movement_transit_out_id text not null default '';

-- O PASSADO FICA COERENTE COM O QUE ELE FOI. As transferências instantâneas
-- chegaram inteiras no instante em que saíram.
update stock_transfers
   set received_quantity = quantity
 where status = 'recebida' and received_quantity = 0;

update stock_transfers
   set sent_at = created_at, received_at = created_at
 where sent_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stock_transfers_recebido_no_limite'
  ) then
    alter table stock_transfers add constraint stock_transfers_recebido_no_limite
      check (received_quantity >= 0 and received_quantity <= quantity);
  end if;
end $$;

-- A pergunta que a tela de cargas faz: "o que saiu e ainda não chegou?".
-- Parcial pelo status porque a lista pendente é minúscula ao lado do histórico.
create index if not exists idx_stock_transfers_transito
  on stock_transfers (status, date desc) where status = 'enviada';

-- E a pergunta da conferência: "as linhas desta carga". O batch_id já ligava os
-- itens enviados juntos; agora ele é a chave da tela de recebimento.
create index if not exists idx_stock_transfers_lote
  on stock_transfers (batch_id);

comment on column stock_transfers.status is
  'Fase CZ — enviada (no balde __transito__) ou recebida (conferida no destino). '
  'Nasce recebida para o histórico instantâneo continuar verdadeiro.';
comment on column stock_transfers.received_quantity is
  'Fase CZ — quanto já foi conferido na chegada. ACUMULA: a caixa que falta '
  'pode chegar depois e ser recebida numa segunda conferência.';
