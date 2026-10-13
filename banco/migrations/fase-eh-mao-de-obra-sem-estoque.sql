-- ============================================================================
-- FASE EH — A MÃO DE OBRA NÃO CONTROLA ESTOQUE
-- ============================================================================
--
-- O usuário mostrou a Nova Venda com "-244 de 0" na coluna Disponível
-- (13/10/2026): era a MÃO-DE-OBRA (SOMENTE PARA SERVIÇO), código 588, um
-- serviço cadastrado como produto que movimenta estoque, com saldo 0 e 244
-- unidades "reservadas" por pedidos importados do Viper. Além do número
-- absurdo, o faturamento de qualquer pedido com ela era recusado por falta de
-- saldo — e, desde a trava da NF-e, a nota também.
--
-- Decisão do usuário: só a 588, sem regra geral. A coluna
-- products.movimenta_estoque já existe (fase AB) e o sistema passou a
-- respeitá-la na venda: produto com `false` não reserva, não baixa no
-- faturamento, não estorna e não trava a NF-e/NFC-e.
--
-- Código E nome conferidos juntos: o SKU sozinho poderia ser outro produto
-- num banco que não seja este.
-- ============================================================================

update products
   set movimenta_estoque = false
 where sku = '588'
   and upper(name) like 'MAO-DE%OBRA%'
   and movimenta_estoque is distinct from false;
