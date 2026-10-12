-- ============================================================================
-- FASE EE — DEPÓSITOS DE MONTADOS E DESMONTADOS, SÓ NA MATRIZ
-- ============================================================================
--
-- Pedido do usuário (13/10/2026): "a classificação de montados e desmontados
-- preciso que seja aplicada apenas na empresa matriz, para organização de
-- estoque e ter conexão com o módulo PCP para baixa futura". Decidido com ele:
--   - só a SAL INFINITY PLUS matriz (CNPJ 43.792.899/0001-35);
--   - o "Depósito Matriz" atual (com o saldo de hoje) vira o de DESMONTADOS;
--   - nasce o "Depósito Matriz - Montados", vazio — a baixa do PCP o enche.
--
-- A baixa de montagem (fase ED) deixava escolher QUALQUER depósito como origem
-- e destino (pcp_config). Agora origem e destino SÃO estes dois: um depósito
-- de cada classificação no sistema inteiro (índice único), e a regra "só na
-- matriz" é do servidor, que conhece o CNPJ da empresa (as empresas moram no
-- data/db.json, fora do alcance deste SQL).
-- ============================================================================

alter table if exists deposits add column if not exists classificacao text
  check (classificacao is null or classificacao in ('desmontados', 'montados'));

create unique index if not exists idx_deposits_classificacao on deposits (classificacao)
  where classificacao is not null;

-- O "Depósito Matriz" vira o de desmontados (se ninguém ainda for).
update deposits set classificacao = 'desmontados'
 where name = 'Depósito Matriz'
   and classificacao is null
   and not exists (select 1 from deposits where classificacao = 'desmontados');

-- E nasce o de montados, na mesma empresa do Depósito Matriz, com o próximo
-- código DEP-NNNN. Só se ainda não houver um.
insert into deposits (id, name, code, status, company_id, address, city, state, manager, notes)
select 'dep-matriz-montados',
       'Depósito Matriz - Montados',
       'DEP-' || lpad((coalesce((select max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int) from deposits where code ~ '^DEP-\d+$'), 0) + 1)::text, 4, '0'),
       'ativo', d.company_id, coalesce(d.address, ''), coalesce(d.city, ''), coalesce(d.state, ''), '',
       'Scooters montadas (baixa de montagem do PCP). Criado pela fase EE.'
  from deposits d
 where d.name = 'Depósito Matriz'
   and not exists (select 1 from deposits where classificacao = 'montados')
   and not exists (select 1 from deposits where id = 'dep-matriz-montados')
 limit 1;

update deposits set classificacao = 'montados'
 where id = 'dep-matriz-montados' and classificacao is null
   and not exists (select 1 from deposits where classificacao = 'montados');

-- A escolha manual de depósitos da baixa (fase ED) deixa de existir.
drop table if exists pcp_config;
