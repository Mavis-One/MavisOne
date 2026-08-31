-- ---------------------------------------------------------------------------
-- Fase L — Controle de acesso (RBAC): papéis, permissões e trilha de auditoria
--
-- Tradução do schema de RBAC para a realidade deste ERP:
--
--   * O banco é PostgreSQL (Supabase), não MySQL. Tipos e sintaxe mudam:
--     TINYINT(1) -> boolean, ENUM -> check constraint, JSON -> jsonb,
--     VARBINARY(16)+INET6_ATON -> inet (nativo no Postgres),
--     AUTO_INCREMENT -> generated always as identity.
--
--   * Papéis e permissões usam o SLUG como chave primária, em vez de id
--     numérico + slug único. O código já fala em slug ('admin', 'sales.criar');
--     com id numérico toda consulta precisaria de um join só para traduzir.
--
--   * Os recursos são os módulos reais do sistema (sales, cadastros, stock,
--     finance, purchases, settings, fiscal), não reserva/hóspede.
--
-- SEGURANÇA DA MIGRAÇÃO: o seed no fim reproduz o acesso que cada usuário já
-- tem hoje (allowed_modules), com todas as ações. Ninguém perde acesso ao rodar
-- isto — o que muda é passar a EXISTIR como restringir, pela tela de usuários.
-- ---------------------------------------------------------------------------

-- 1) Usuários: bloquear sem apagar, e saber quando entrou pela última vez.
alter table if exists users add column if not exists active boolean not null default true;
alter table if exists users add column if not exists last_login_at timestamptz;

-- 2) Papéis. `system` marca o que a tela não deixa apagar/renomear.
create table if not exists roles (
  slug text primary key,
  name text not null,
  description text not null default '',
  level smallint not null default 10,
  system boolean not null default false,
  created_at timestamptz not null default now()
);

-- 3) Permissões: uma linha por ação verificável (recurso + ação).
create table if not exists permissions (
  slug text primary key,
  resource text not null,
  action text not null,
  description text not null default ''
);
create index if not exists idx_permissions_resource on permissions (resource);

-- 4) Papel -> permissões.
create table if not exists role_permissions (
  role_slug text not null references roles (slug) on delete cascade,
  permission_slug text not null references permissions (slug) on delete cascade,
  primary key (role_slug, permission_slug)
);

-- 5) Usuário -> papéis (pode ter mais de um).
create table if not exists user_roles (
  user_id text not null references users (id) on delete cascade,
  role_slug text not null references roles (slug) on delete cascade,
  granted_by text references users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_slug)
);

-- 6) Permissão pontual, sem precisar criar papel novo. NEGAR sempre vence.
create table if not exists user_permissions (
  user_id text not null references users (id) on delete cascade,
  permission_slug text not null references permissions (slug) on delete cascade,
  effect text not null default 'PERMITIR' check (effect in ('PERMITIR', 'NEGAR')),
  primary key (user_id, permission_slug)
);

-- 7) Trilha de auditoria. Registra também o que foi NEGADO — é justamente a
--    tentativa barrada que interessa numa investigação.
create table if not exists access_logs (
  id bigint generated always as identity primary key,
  user_id text references users (id) on delete set null,
  user_name text not null default '',
  action text not null,
  resource_type text not null default '',
  resource_id text not null default '',
  result text not null default 'PERMITIDO' check (result in ('PERMITIDO', 'NEGADO')),
  ip inet,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_access_logs_user on access_logs (user_id, created_at desc);
create index if not exists idx_access_logs_action on access_logs (action, created_at desc);
create index if not exists idx_access_logs_result on access_logs (result, created_at desc);

-- View das permissões efetivas (papéis + diretas, com NEGAR removendo).
-- O app não depende dela para decidir (ver lib/permissoes.js) — ela existe para
-- conferência direta no banco: "o que o fulano pode, afinal?".
create or replace view vw_user_permissions as
select u.id as user_id, p.slug as permission
from users u
join user_roles ur on ur.user_id = u.id
join role_permissions rp on rp.role_slug = ur.role_slug
join permissions p on p.slug = rp.permission_slug
where u.active
  and not exists (
    select 1 from user_permissions up
    where up.user_id = u.id and up.permission_slug = p.slug and up.effect = 'NEGAR'
  )
union
select u.id, p.slug
from users u
join user_permissions up on up.user_id = u.id and up.effect = 'PERMITIR'
join permissions p on p.slug = up.permission_slug
where u.active;

-- ---------------------------------------------------------------------------
-- SEED
-- ---------------------------------------------------------------------------
insert into roles (slug, name, description, level, system) values
  ('admin',   'Administrador', 'Acesso total ao sistema',                 100, true),
  ('gerente', 'Gerente',       'Operação completa, relatórios e exclusão',  50, false),
  ('usuario', 'Usuário',       'Acesso operacional limitado',               10, true)
on conflict (slug) do update set name = excluded.name, description = excluded.description;

-- Permissões: um módulo do ERP por recurso, quatro ações onde faz sentido.
insert into permissions (slug, resource, action, description) values
  ('dashboard.ler',   'dashboard', 'ler',     'Ver o painel inicial'),
  ('cadastros.ler',   'cadastros', 'ler',     'Ver cadastros'),
  ('cadastros.criar', 'cadastros', 'criar',   'Criar cadastro'),
  ('cadastros.editar','cadastros', 'editar',  'Editar cadastro'),
  ('cadastros.excluir','cadastros','excluir', 'Excluir cadastro'),
  ('sales.ler',       'sales',     'ler',     'Ver pedidos e orçamentos'),
  ('sales.criar',     'sales',     'criar',   'Criar pedido/orçamento'),
  ('sales.editar',    'sales',     'editar',  'Editar pedido/orçamento'),
  ('sales.excluir',   'sales',     'excluir', 'Excluir pedido/orçamento'),
  ('purchases.ler',   'purchases', 'ler',     'Ver compras'),
  ('purchases.criar', 'purchases', 'criar',   'Lançar compra'),
  ('purchases.editar','purchases', 'editar',  'Editar compra'),
  ('purchases.excluir','purchases','excluir', 'Excluir compra'),
  ('stock.ler',       'stock',     'ler',     'Ver estoque'),
  ('stock.criar',     'stock',     'criar',   'Lançar movimentação'),
  ('stock.editar',    'stock',     'editar',  'Editar estoque'),
  ('stock.excluir',   'stock',     'excluir', 'Excluir movimentação'),
  ('finance.ler',     'finance',   'ler',     'Ver financeiro'),
  ('finance.criar',   'finance',   'criar',   'Lançar no financeiro'),
  ('finance.editar',  'finance',   'editar',  'Editar lançamento'),
  ('finance.excluir', 'finance',   'excluir', 'Excluir lançamento'),
  ('settings.ler',    'settings',  'ler',     'Ver configurações'),
  ('settings.editar', 'settings',  'editar',  'Alterar configurações'),
  ('usuarios.gerenciar','usuarios','gerenciar','Criar/editar usuários, papéis e permissões'),
  ('auditoria.ler',   'auditoria', 'ler',     'Ver a trilha de auditoria'),
  -- Fiscal já tinha permissão por ação antes deste RBAC (users.fiscal_permissions).
  -- Entram aqui com os mesmos nomes para o controle ficar num lugar só.
  ('fiscal.visualizar','fiscal','visualizar','Ver dados fiscais'),
  ('fiscal.criar',    'fiscal',   'criar',    'Criar registro fiscal'),
  ('fiscal.editar',   'fiscal',   'editar',   'Editar registro fiscal'),
  ('fiscal.emitir',   'fiscal',   'emitir',   'Emitir NF-e'),
  ('fiscal.cancelar', 'fiscal',   'cancelar', 'Cancelar NF-e'),
  ('fiscal.cce',      'fiscal',   'cce',      'Emitir carta de correção'),
  ('fiscal.inutilizar','fiscal',  'inutilizar','Inutilizar numeração'),
  ('fiscal.configurar','fiscal',  'configurar','Configurar empresa/estabelecimento'),
  ('fiscal.regras',   'fiscal',   'regras',   'Regras fiscais'),
  ('fiscal.certificado','fiscal', 'certificado','Certificado digital'),
  ('fiscal.documentos_recebidos','fiscal','documentos_recebidos','Documentos recebidos'),
  ('fiscal.manifestar','fiscal',  'manifestar','Manifestar documentos'),
  ('fiscal.xml',      'fiscal',   'xml',      'Baixar XML'),
  ('fiscal.danfe',    'fiscal',   'danfe',    'Baixar DANFE'),
  ('fiscal.auditoria','fiscal',   'auditoria','Auditoria fiscal')
on conflict (slug) do update set description = excluded.description;

-- USUÁRIO: opera, mas não exclui, não vê financeiro e não mexe em usuários.
insert into role_permissions (role_slug, permission_slug)
select 'usuario', slug from permissions
where slug in ('dashboard.ler',
               'sales.ler', 'sales.criar', 'sales.editar',
               'cadastros.ler', 'cadastros.criar', 'cadastros.editar',
               'stock.ler', 'purchases.ler')
on conflict do nothing;

-- GERENTE: tudo do usuário + excluir + financeiro + auditoria. Sem gerenciar usuários.
insert into role_permissions (role_slug, permission_slug)
select 'gerente', slug from permissions
where resource in ('dashboard', 'sales', 'cadastros', 'stock', 'purchases', 'finance')
   or slug = 'auditoria.ler'
on conflict do nothing;

-- ADMIN não recebe lista: o atalho de administrador libera tudo (mesma regra da
-- função usuario_pode() do schema original).

-- Usuários existentes ganham papel conforme o `role` que já tinham.
insert into user_roles (user_id, role_slug)
select id, case when role = 'admin' then 'admin' else 'usuario' end from users
on conflict do nothing;

-- E mantêm exatamente o acesso de hoje: uma permissão direta para cada ação dos
-- módulos que já estavam liberados em allowed_modules. Sem isto, quem hoje
-- exclui um pedido perderia a exclusão no instante em que a migração rodasse.
insert into user_permissions (user_id, permission_slug, effect)
select u.id, p.slug, 'PERMITIR'
from users u
join permissions p on p.resource = any (u.allowed_modules)
where u.role <> 'admin'
on conflict do nothing;
