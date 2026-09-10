-- ============================================================================
-- FASE BX — o título de cartão diz quanto vai cair de verdade
-- ============================================================================
--
-- O QUE ISTO RESOLVE
-- ------------------
-- O cadastro de formas de pagamento tem o campo "Taxa (%)" desde sempre. Ele é
-- digitado, é validado (não pode ser negativo), aparece na lista de formas
-- formatado com duas casas — e NUNCA É LIDO POR NINGUÉM. Uma busca por
-- `feePercent` no repositório inteiro só encontra o próprio cadastro.
--
-- A consequência é aritmética: uma venda de R$ 1.000,00 no cartão a 3,5%
-- credita R$ 965,00 na conta. O ERP diz que vem R$ 1.000,00.
--
--   1. A CONCILIAÇÃO NUNCA FECHA. O extrato traz R$ 965,00 e o título espera
--      R$ 1.000,00 — erra por exatamente a taxa, em toda venda no cartão. É o
--      "Conc. ✗ e o contas a receber nunca é baixado" que a observação do
--      ViperERP de 08/09/2026 registrou (OBS-28).
--   2. TODO RELATÓRIO DE MARGEM MENTE PARA CIMA, pela taxa, em toda venda no
--      cartão. Ninguém percebe: o número parece certo e é sempre otimista.
--
-- O QUE ENTRA E O QUE NÃO MUDA
-- ----------------------------
-- `amount` CONTINUA SENDO O VALOR BRUTO. É o que o cliente pagou e o que a
-- venda valeu; mexer nele mudaria receita bruta, comissão e todo relatório que
-- já existe. A taxa entra como informação AO LADO, não no lugar.
--
--   fee_percent  — a taxa que valia NO DIA DA VENDA. Snapshot, e não uma
--                  consulta ao cadastro na hora de ler: taxa de credenciadora é
--                  renegociada, e recalcular um título de seis meses atrás com
--                  a taxa de hoje reescreveria o passado.
--   fee_amount   — quanto isso dá em reais, já arredondado. Guardado e não
--                  calculado na leitura pelo mesmo motivo: é o número que a
--                  baixa vai usar, e dois lugares arredondando dão dois valores.
--   net_amount   — o que efetivamente cai na conta. É ESTE o número que casa
--                  com o extrato.
--
-- AS COLUNAS DE IDENTIDADE DO CARTÃO vêm junto porque sem elas a conciliação
-- não tem por onde casar: o extrato da credenciadora vem por NSU e bandeira,
-- não por número de pedido.
--
--   card_acquirer_id / card_acquirer_name / card_brand / card_authorization
--
-- POR QUE `card_acquirer_name` SE JÁ EXISTE O ID: é snapshot, como
-- `client_supplier_name` na mesma tabela. Uma credenciadora inativada ou
-- renomeada não pode apagar de quem era o título de um ano atrás.
--
-- POR QUE NÃO HÁ CHAVE ESTRANGEIRA em `card_acquirer_id`: pela mesma razão de
-- `client_supplier_id`. Com FK, excluir uma credenciadora passaria a esbarrar em
-- títulos antigos, e a guarda que já existe (`formasQueUsamAdquirente`) recusa
-- exclusão pelo motivo certo — estar em uso HOJE. O nome guardado ao lado
-- continua dizendo a verdade quando o id não resolve mais.
--
-- A TAXA NÃO VIRA DESPESA AQUI. Lançar a taxa como despesa por venda é decisão
-- de contabilidade (muda a DRE) e dobra o número de lançamentos — não é uma
-- escolha para tomar de lado. O que esta fase faz é a baixa do título de cartão
-- nascer com o líquido no valor e a taxa no desconto, que fecha o título pelo
-- número certo e deixa a taxa visível no histórico de baixas.
-- ============================================================================

alter table if exists financial_entries
  -- Quem processa o cartão, no dia da venda.
  add column if not exists card_acquirer_id     text,
  add column if not exists card_acquirer_name   text,
  -- Código tBand ('01' Visa, '06' Elo...), como está no cadastro e no XML.
  add column if not exists card_brand           text,
  -- NSU / número de autorização. É por ele que o extrato da credenciadora casa.
  add column if not exists card_authorization   text,
  -- A taxa e o que ela custa. NULO quando a forma não cobra taxa — nulo é
  -- "não se aplica", e 0 seria "taxa zero contratada", que é outra coisa.
  add column if not exists fee_percent          numeric,
  add column if not exists fee_amount           numeric,
  -- O que cai na conta. NULO nos títulos anteriores a esta fase: inventar
  -- `net = amount` para trás afirmaria que a taxa era zero, e ela não era.
  add column if not exists net_amount           numeric;

-- A conciliação com o extrato da credenciadora procura por NSU. Sem índice, é
-- varredura na tabela inteira a cada linha do extrato.
create index if not exists idx_financial_entries_card_authorization
  on financial_entries (card_authorization)
  where card_authorization is not null and card_authorization <> '';

comment on column financial_entries.net_amount is
  'O que efetivamente cai na conta: amount - fee_amount. É este o número que '
  'casa com o extrato — amount continua sendo o bruto da venda (fase BX).';

comment on column financial_entries.fee_percent is
  'A taxa da forma de pagamento NO DIA DA VENDA. Snapshot: taxa renegociada '
  'não pode reescrever títulos antigos (fase BX).';
