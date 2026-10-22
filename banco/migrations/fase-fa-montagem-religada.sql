-- ============================================================================
-- FASE FA — CONTROLE DE MONTAGEM RELIGADO, SEM TRAVAR A VENDA
-- ============================================================================
--
-- Pedido do usuário (22/10/2026): "colocar uma sub-classe dentro dos produtos
-- para que eu consiga colocar se eles estão montados e desmontados" — é o
-- montado/desmontado da fase ER, desligado na fase EV (19/10) porque o pedido
-- de AUTOPROPELIDO passou a exigir a escolha e as lojas pararam de vender.
-- Escolhido com ele: religar SEM TRAVAR A VENDA. A venda deixa de exigir a
-- condição (shared/venda_obrigatorios.js): item sem ela sai do MONTADO, como já
-- saía o item antigo (condicaoDoItemDaVenda, em server.js).
--
-- 1. A marca volta aos produtos que a fase EV guardou em montagem_pausada.
--    Produto marcado à mão no cadastro durante a pausa continua como está.
--
-- 2. O QUE SE MOVEU NA PAUSA VIRA MONTADO. Nesses dias os movimentos destes
--    produtos foram gravados sem condição (''), e sem classificar o saldo por
--    condição não fecha. A regra é a da fase ER e a do cadastro (ligar a marca
--    num produto com saldo classifica o sem-condição como montado) — decisão
--    do usuário de 17/10. A guarda do razão (trg_stock_movements_imutavel)
--    deixa '' virar uma condição; nada mais muda na linha.
--
-- 3. A tabela montagem_pausada fica vazia: ela diz quem está pausado.
-- ============================================================================

update products p set controla_montagem = true
  from montagem_pausada mp
 where mp.product_id = p.id and not p.controla_montagem;

update stock_movements m set condicao = 'montado'
  from products p
 where p.id = m.product_id and p.controla_montagem and m.condicao = '';

update stock_transfers t set condicao = 'montado'
  from products p
 where p.id = t.product_id and p.controla_montagem and t.condicao = '';

delete from montagem_pausada;
