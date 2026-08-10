-- Fase T — o papel "gerente" não tinha NENHUMA permissão fiscal
--
-- Situação encontrada:
--   usuario  -> 15 permissões fiscal.* (todas, inclusive inutilizar e certificado)
--   gerente  ->  0
--   admin    ->  0 (não precisa: passa por ehAdministrador)
--
-- Em todo o resto do sistema gerente ⊃ usuario (a Fase S deu a ele o `excluir`
-- que o usuário não tem). No Fiscal está invertido: hoje um gerente não
-- consegue nem ABRIR o módulo, porque /api/fiscal/ decide por
-- usuarioPode(user, 'fiscal.<ação>') e ele não tem nenhuma.
--
-- Isto é aditivo: ninguém perde acesso. É seguro rodar mais de uma vez.
--
-- NÃO resolvido aqui de propósito: o papel `usuario` continua podendo
-- inutilizar numeração, configurar estabelecimento e mexer em certificado
-- digital. Inutilizar é irreversível e certificado é credencial da empresa —
-- provavelmente não deveriam estar no papel mais básico. Mas TIRAR permissão
-- quebra quem já trabalha com ela hoje, então essa decisão fica com quem
-- administra o sistema, e não escondida numa migração.

insert into role_permissions (role_slug, permission_slug)
select 'gerente', slug
from permissions
where resource = 'fiscal'
on conflict do nothing;

-- Conferência: as três linhas devem sair com a mesma contagem de fiscal.*
-- para gerente e usuario, e 0 para admin.
--
-- select r.slug,
--        count(*) filter (where rp.permission_slug like 'fiscal.%') as fiscais
-- from roles r
-- left join role_permissions rp on rp.role_slug = r.slug
-- group by r.slug
-- order by r.slug;
