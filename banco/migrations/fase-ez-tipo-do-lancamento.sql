-- ============================================================================
-- FASE EZ — O TIPO DO LANÇAMENTO NUM VOCABULÁRIO SÓ
-- ============================================================================
--
-- Queixa do usuário (21/10/2026), com dois prints: Contas a Pagar mostrava 4
-- títulos vencendo em 21/10 e o relatório Contas a Pagar, 3 — faltava o da
-- entrada de NF-e ("Despesa de compra · NF-e 1636"). "Verifique o motivo disso
-- e se esse erro está em mais locais, no módulo do contas a receber consigo
-- puxar mais títulos do que nos relatórios!"
--
-- O motivo: a entrada de NF-e e as compras gravavam o título com type
-- 'purchase', e a venda rápida com 'sale'. As telas os liam por
-- classifyFinanceEntry, que aceita os dois nomes; os relatórios do Financeiro
-- (Contas a Pagar e a Receber, Síntese, Fluxo de Caixa, DRE, Previsto x
-- Realizado, Extrato...) filtram em SQL por 'RECEITA'/'DESPESA', e esses
-- títulos ficavam de fora de todos eles.
--
-- Os já gravados passam ao nome novo aqui; os próximos já nascem com ele
-- (lib/db/financeiro.js, tipoDoLancamento). Pode rodar de novo: o que já está
-- certo não é tocado.
-- ============================================================================

update financial_entries set type = 'DESPESA'
 where lower(type) in ('purchase', 'despesa') and type <> 'DESPESA';

update financial_entries set type = 'RECEITA'
 where lower(type) in ('sale', 'receita') and type <> 'RECEITA';

update financial_entries set type = 'TRANSFERENCIA'
 where lower(type) in ('transfer', 'transferencia') and type <> 'TRANSFERENCIA';
