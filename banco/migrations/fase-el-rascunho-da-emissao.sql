-- ============================================================================
-- FASE EL — A NOTA EM EDIÇÃO SALVA ANTES DE EMITIR
-- ============================================================================
--
-- Pedido do usuário (14/10/2026): "faça um botão para salvar a nota fiscal em
-- edição antes de faturar ela". A tela de emissão guardava tudo só na memória
-- do navegador: sair dela (ou um F5) perdia destinatário, itens, impostos
-- editados, transporte e cobrança.
--
-- NÃO É DOCUMENTO FISCAL. É o estado da tela, e por isso mora fora de `nfe`:
-- nada aqui tem número, chave ou status na SEFAZ, e apagar um rascunho (depois
-- de emitir, ou ao descartá-lo) não apaga nota nenhuma.
--
-- `chave` diz de quem é a nota em edição: "pedido:<id>" para a nota de um
-- pedido (qualquer um que abrir a emissão daquele pedido a encontra), e
-- "avulsa:<usuário>" para a avulsa (uma por pessoa).
-- ============================================================================

create table if not exists nfe_rascunho_emissao (
  chave text primary key,
  pedido_id text,
  user_id text,
  user_name text,
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table if exists nfe_rascunho_emissao enable row level security;

comment on table nfe_rascunho_emissao is
  'Estado da tela de emissão de NF-e salvo pelo usuário antes de emitir. Não é documento fiscal.';
