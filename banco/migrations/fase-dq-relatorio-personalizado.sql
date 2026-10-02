-- ============================================================================
-- FASE DQ — O RELATÓRIO PERSONALIZADO
-- ============================================================================
--
-- O primeiro item do menu Relatórios do Viper: a pessoa escolhe a fonte
-- (Lançamentos, Vendas, Itens de Vendas, Notas de Entrada...), as colunas, os
-- filtros e a ordem, e SALVA. No Viper havia um, o "Inventário 2026".
--
-- O relatório salvo é só a ESCOLHA: nomes de campo, operadores e valores. O
-- SQL nunca é gravado — quem monta a consulta é lib/relatorios/personalizado.js,
-- a partir da lista fechada de campos de cada fonte. Gravar SQL deixaria
-- qualquer um que edita relatório escrever consulta no banco.
--
-- `colunas`, `filtros` e `ordem` são jsonb porque são listas ordenadas que só
-- fazem sentido juntas; nada consulta dentro delas.
-- ============================================================================

create table if not exists relatorio_personalizado (
  id text primary key,
  nome text not null check (btrim(nome) <> ''),
  fonte text not null,
  colunas jsonb not null default '[]'::jsonb,
  filtros jsonb not null default '[]'::jsonb,
  ordem jsonb not null default '[]'::jsonb,
  -- Compartilhado: a equipe vê e roda (cada um com as próprias permissões);
  -- só quem criou, ou o administrador, edita e exclui.
  compartilhado boolean not null default true,
  criado_por text,
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ultima_execucao timestamptz
);

create index if not exists idx_relatorio_personalizado_nome on relatorio_personalizado (lower(nome));

-- Como toda tabela do schema (fase AF): o app conecta como dono e passa por
-- cima; a RLS é a porta que continua fechada se o banco for publicado.
alter table relatorio_personalizado enable row level security;

-- ----------------------------------------------------------------------------
-- As permissões. A fase S deu a Relatórios só `ler` ("relatório não grava").
-- O personalizado grava a escolha, e o portão central cobra reports.criar no
-- POST, reports.editar no PUT e reports.excluir no DELETE — sem estas linhas,
-- só o administrador conseguiria salvar um relatório.
--
-- Gerente e usuário recebem as três: o relatório salvo é a ferramenta da
-- própria pessoa, e a rota só deixa editar e excluir o que ela mesma criou.
-- ----------------------------------------------------------------------------
insert into permissions (slug, resource, action, description) values
  ('reports.criar',   'reports', 'criar',   'Criar relatório personalizado'),
  ('reports.editar',  'reports', 'editar',  'Editar o próprio relatório personalizado'),
  ('reports.excluir', 'reports', 'excluir', 'Excluir o próprio relatório personalizado')
on conflict (slug) do update set description = excluded.description;

insert into role_permissions (role_slug, permission_slug) values
  ('gerente', 'reports.criar'), ('gerente', 'reports.editar'), ('gerente', 'reports.excluir'),
  ('usuario', 'reports.criar'), ('usuario', 'reports.editar'), ('usuario', 'reports.excluir')
on conflict do nothing;
