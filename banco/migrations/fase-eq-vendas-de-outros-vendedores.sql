-- ============================================================================
-- FASE EQ — QUANDO UM VENDEDOR PODE MEXER NAS VENDAS DE OUTRO
-- ============================================================================
--
-- Pedido do usuário (15/10/2026): "faça uma regra aplicável pela tela de
-- usuários quando um vendedor pode mexer nas vendas de outro".
--
-- Desde 12/10/2026 a venda é do vendedor que a fez (lib/venda-do-vendedor.js):
-- quem tem vendedor vinculado e não é administrador só altera, exclui e anexa
-- nas vendas dele (ou nas sem vendedor). Esta chave, por usuário, libera as
-- vendas dos colegas — sem tomar a venda para si: o vendedor dela continua
-- sendo quem a fez. O que a pessoa VÊ nos relatórios não muda.
--
-- Padrão desligado: ninguém ganha acesso novo com a migração.
-- ============================================================================

alter table users
  add column if not exists pode_alterar_vendas_de_outros boolean not null default false;

comment on column users.pode_alterar_vendas_de_outros is
  'Vendedor que pode alterar, excluir e anexar nas vendas de outros vendedores (a venda continua do vendedor dela).';
