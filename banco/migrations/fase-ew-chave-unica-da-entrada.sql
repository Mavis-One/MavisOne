-- ============================================================================
-- FASE EW — A CHAVE DA NOTA DE ENTRADA É ÚNICA, CONFERIDO NO BANCO DE VERDADE
-- ============================================================================
--
-- Pedido do usuário (19/10/2026): "o sistema está passando a entrada de NF em
-- duplicidade e criando títulos em duplicidade". O código recusa a segunda
-- entrada da mesma nota pela chave única de nfe_entrada (fase AK, desde
-- 24/08/2026) — mas os bancos que receberam migrações à mão, ou "adotadas"
-- sem rodar (VPS, 14/09), não têm prova de que o índice existe.
--
-- Esta confere e, faltando, cria. Com chave JÁ repetida no banco, o índice
-- não pode nascer: em vez de derrubar o deploy, avisa no log — as repetidas
-- aparecem marcadas em Compras › Notas de Entrada ("Duplicadas"), para o
-- usuário resolver (decisão dele), e uma migração nova cria o índice depois.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
     where t.relname = 'nfe_entrada' and i.indisunique and a.attname = 'chave' and i.indnatts = 1
  ) then
    return;
  end if;
  if exists (select chave from nfe_entrada group by chave having count(*) > 1) then
    raise notice 'nfe_entrada tem chave repetida: o índice único não foi criado. Resolva as duplicadas em Compras > Notas de Entrada.';
    return;
  end if;
  create unique index nfe_entrada_chave_unica on nfe_entrada (chave);
end $$;
