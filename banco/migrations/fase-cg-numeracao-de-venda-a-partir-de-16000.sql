-- ---------------------------------------------------------------------------
-- Fase CG — a numeração de pedidos passa a começar em 16000
--
-- POR QUE 16000, E POR QUE AGORA
-- ------------------------------
-- A importação do histórico do ViperERP trouxe 14.942 documentos numerados de
-- 1 a 15.525 (ver fase-br e o comentário em lib/db/vendas-compras.js). O
-- sistema continuaria de 15.526 em diante, encostado no fim do histórico
-- importado. A decisão é abrir uma faixa nova, redonda e visivelmente separada:
-- o que tem número 16.000 ou mais nasceu AQUI.
--
-- Medido neste banco antes da mudança:
--
--     maior code em orders ......... 15.525
--     maior code em quotes ......... 15.517
--     sales_code_seq ............... 15.527
--
-- Não há colisão possível: 16.000 está acima de tudo o que existe.
--
-- POR QUE `greatest`, E NÃO `setval(..., 15999)` DIRETO
-- -----------------------------------------------------
-- Porque migração roda mais de uma vez — no banco de teste, no de produção, num
-- restore, no RECRIAR-DO-ZERO. Um setval fixo rodado depois do pedido 16.010
-- REBAIXARIA a sequence, e o número 16.010 sairia de novo. Não há unique em
-- orders.code nem em quotes.code: o banco aceitaria o duplicado calado, e o
-- estrago apareceria como dois pedidos com o mesmo número na lista e duas notas
-- citando o mesmo documento — exatamente o que a fase BR veio evitar.
--
-- Com `greatest`, o valor só sobe. Rodar dez vezes tem o mesmo efeito de rodar
-- uma, e num banco que já passou de 16.000 esta migração não faz nada.
--
-- O `max(code)` das duas tabelas entra na conta pelo mesmo motivo: se um
-- histórico maior for importado depois, a numeração continua depois dele, e não
-- por cima.
--
-- A NUMERAÇÃO É COMPARTILHADA entre pedido e orçamento — é o mesmo documento
-- que troca de tipo quando é aprovado. Então 16.000 é o próximo NÚMERO, e um
-- orçamento criado no meio consome um da faixa. Separar as duas numerações
-- seria outra decisão, com outra migração.
-- ---------------------------------------------------------------------------

select setval(
  'sales_code_seq',
  greatest(
    -- Onde a sequence já está: nunca rebaixar.
    coalesce((select last_value from sales_code_seq), 0),
    -- Onde os dados já estão: nunca repetir número gravado.
    coalesce((select max(code) from orders), 0),
    coalesce((select max(code) from quotes), 0),
    -- O piso pedido: 15999 com is_called = true faz o próximo nextval
    -- devolver 16000.
    15999
  ),
  true
);

comment on sequence sales_code_seq is
  'Numeracao compartilhada de pedidos e orcamentos. nextval e atomico: substitui '
  'o max+1 que abria janela para dois documentos com o mesmo numero (fase BR). '
  'Piso de 16000 a partir da fase CG: abaixo disso e historico importado do '
  'ViperERP (1 a 15.525).';
