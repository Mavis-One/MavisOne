-- ---------------------------------------------------------------------------
-- Fase S — permissões dos módulos novos
--
-- A Fase R criou as tabelas de Frota, RH, PCP, Contratos e CRM, e o código
-- passou a exigir permissões como fleet.ler e contracts.criar. Só que essas
-- linhas nunca foram criadas na tabela `permissions`.
--
-- O efeito era silencioso e total: usuarioPode() exige que a permissão esteja
-- entre as efetivas do usuário, e ela não existia nem para ser concedida. Ou
-- seja, os seis módulos ficavam inacessíveis para QUALQUER pessoa que não fosse
-- administrador — e nem a tela de Papéis e Permissões tinha o que mostrar,
-- porque ela lista o que está aqui.
--
-- São INSERTs, não DDL: dá para rodar por aqui ou pelo SQL Editor, tanto faz.
--
-- Sobre o CRM: ele não cria nem exclui nada (é ponte para o sistema externo),
-- então recebe só ler e editar — editar é o que salva o endereço e o token da
-- conexão. Relatórios só lê, porque relatório não grava.
-- ---------------------------------------------------------------------------

insert into permissions (slug, resource, action, description) values
  ('reports.ler',      'reports',   'ler',     'Ver relatórios'),

  ('fleet.ler',        'fleet',     'ler',     'Ver a frota'),
  ('fleet.criar',      'fleet',     'criar',   'Cadastrar veículo, manutenção ou abastecimento'),
  ('fleet.editar',     'fleet',     'editar',  'Editar registros da frota'),
  ('fleet.excluir',    'fleet',     'excluir', 'Excluir registros da frota'),

  ('crm.ler',          'crm',       'ler',     'Ver os dados vindos do CRM externo'),
  ('crm.editar',       'crm',       'editar',  'Configurar a conexão com o CRM externo'),

  ('hr.ler',           'hr',        'ler',     'Ver colaboradores, cargos, ausências e ponto'),
  ('hr.criar',         'hr',        'criar',   'Cadastrar colaborador, cargo, ausência ou ponto'),
  ('hr.editar',        'hr',        'editar',  'Editar registros de RH'),
  ('hr.excluir',       'hr',        'excluir', 'Excluir registros de RH'),

  ('pcp.ler',          'pcp',       'ler',     'Ver ordens, estrutura e apontamentos'),
  ('pcp.criar',        'pcp',       'criar',   'Abrir ordem, item de estrutura ou apontamento'),
  ('pcp.editar',       'pcp',       'editar',  'Editar registros de PCP'),
  ('pcp.excluir',      'pcp',       'excluir', 'Excluir registros de PCP'),

  ('contracts.ler',    'contracts', 'ler',     'Ver contratos e modelos'),
  ('contracts.criar',  'contracts', 'criar',   'Cadastrar contrato ou modelo'),
  ('contracts.editar', 'contracts', 'editar',  'Editar contratos e modelos'),
  ('contracts.excluir','contracts', 'excluir', 'Excluir contratos e modelos')
on conflict (slug) do update set description = excluded.description;

-- ---------------------------------------------------------------------------
-- Quem recebe o quê.
--
-- Gerente: tudo, inclusive excluir — é o papel que já tinha exclusão nos outros
-- módulos, e não faria sentido ser diferente aqui.
--
-- Usuário: opera, mas NÃO exclui. Apagar um contrato ou um colaborador some com
-- histórico que ninguém recupera pela tela; quem faz isso é gerente ou admin.
-- Administrador não entra na lista porque passa por cima de qualquer permissão.
-- ---------------------------------------------------------------------------
insert into role_permissions (role_slug, permission_slug) values
  ('gerente', 'reports.ler'),
  ('gerente', 'fleet.ler'), ('gerente', 'fleet.criar'), ('gerente', 'fleet.editar'), ('gerente', 'fleet.excluir'),
  ('gerente', 'crm.ler'), ('gerente', 'crm.editar'),
  ('gerente', 'hr.ler'), ('gerente', 'hr.criar'), ('gerente', 'hr.editar'), ('gerente', 'hr.excluir'),
  ('gerente', 'pcp.ler'), ('gerente', 'pcp.criar'), ('gerente', 'pcp.editar'), ('gerente', 'pcp.excluir'),
  ('gerente', 'contracts.ler'), ('gerente', 'contracts.criar'), ('gerente', 'contracts.editar'), ('gerente', 'contracts.excluir'),

  ('usuario', 'reports.ler'),
  ('usuario', 'fleet.ler'), ('usuario', 'fleet.criar'), ('usuario', 'fleet.editar'),
  ('usuario', 'crm.ler'),
  ('usuario', 'hr.ler'),
  ('usuario', 'pcp.ler'), ('usuario', 'pcp.criar'), ('usuario', 'pcp.editar'),
  ('usuario', 'contracts.ler')
on conflict do nothing;
