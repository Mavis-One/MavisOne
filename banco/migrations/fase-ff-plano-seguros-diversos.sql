-- ============================================================================
-- FASE FF — PLANO DE CONTAS "SEGUROS DIVERSOS"
-- ============================================================================
--
-- Pedido do usuário (28/10/2026): "preciso de uma conta contábil SEGUROS
-- DIVERSOS". A conta contábil do sistema é o Plano de Contas do Financeiro;
-- entra como despesa, igual às irmãs SEGURO VEICULAR, SEGUROS PREDIAL e
-- SEGURO DE VIDA.
--
-- Só cria se ainda não houver uma com o mesmo nome (sem diferença de
-- maiúsculas nem de espaços nas pontas): quem a criou pela tela antes do
-- deploy não fica com duas. Pode rodar de novo.
-- ============================================================================

insert into financial_categories (id, name, type, created_at)
select 'cat-seguros-diversos', 'SEGUROS DIVERSOS', 'despesa', now()
 where not exists (
   select 1 from financial_categories
    where upper(btrim(name)) = 'SEGUROS DIVERSOS'
 );
