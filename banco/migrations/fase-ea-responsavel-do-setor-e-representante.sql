-- ============================================================================
-- FASE EA — O RESPONSÁVEL DO SETOR PCP É UM REPRESENTANTE
-- ============================================================================
--
-- Decisão do usuário (12/10/2026): no Setor PCP, o campo Responsável lista SÓ
-- os representantes do Cadastros (pessoa ou empresa com o papel
-- "Representante", ver a fase DZ), e não mais o quadro do RH.
--
-- A fase W criou `responsible_id` com chave estrangeira para hr_employees, e
-- com ela o banco recusa gravar o id de uma pessoa do Cadastros (provado no
-- banco local: "violates foreign key constraint
-- pcp_sectors_responsible_id_fkey"). A chave sai; a coluna fica, com o mesmo
-- nome, guardando o id de people ou cnpjs — sem chave estrangeira, como
-- pcp_orders.representante_id, porque o representante pode estar em qualquer
-- das duas tabelas.
--
-- Setor que já apontava para um colaborador do RH continua apontando: a lista
-- de setores mostra o nome dele até alguém escolher o representante.
-- ============================================================================

do $$
declare
  restricao text;
begin
  for restricao in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
     where t.relname = 'pcp_sectors'
       and c.contype = 'f'
       and a.attname = 'responsible_id'
  loop
    execute format('alter table pcp_sectors drop constraint %I', restricao);
  end loop;
end $$;
