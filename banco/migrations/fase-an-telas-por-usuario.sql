-- ============================================================================
-- FASE AN — quais TELAS de um módulo o usuário pode ver
-- ============================================================================
--
-- O QUE FALTAVA
-- -------------
-- A liberação de acesso era por MÓDULO inteiro: `users.allowed_modules` diz
-- "esta pessoa entra em Vendas", e a partir daí ela vê as 9 telas de Vendas.
-- Não havia meio-termo. Quem precisasse liberar o lançamento de pedido mas não
-- o Relatório de Vendas tinha de escolher entre dar tudo ou negar tudo.
--
-- POR QUE UMA LISTA DE BLOQUEADAS, E NÃO DE LIBERADAS
-- ---------------------------------------------------
-- Porque o sistema ganha tela nova quase toda semana — são 121 hoje. Numa
-- lista de LIBERADAS, cada tela nova nasceria invisível para todo usuário que
-- já tivesse a lista preenchida, e ninguém descobriria: a tela simplesmente
-- não estaria no menu de quem já existia, e estaria no de quem fosse criado
-- depois. Aqui o silêncio é do lado certo — módulo liberado continua trazendo
-- tudo, menos o que alguém bloqueou de propósito.
--
-- FORMATO
--   { "sales": ["painel_vendedor", "relatorio"], "finance": ["conciliacao"] }
--
--   Chave = módulo, valor = as telas daquele módulo que este usuário NÃO vê.
--   Módulo ausente, ou lista vazia, significa "vê todas" — que é o
--   comportamento de antes desta fase, e é o que todo usuário existente
--   herda ao rodar isto (o default '{}' cuida disso).
--
-- ISTO É NAVEGAÇÃO, NÃO É A TRANCA
-- --------------------------------
-- Esconder a tela tira o convite; não segura a porta. Quem barra de verdade é
-- o portão do servidor (lib/permissoes.js + verificarAcesso), que enxerga
-- módulo e AÇÃO — criar, editar, excluir. Uma tela escondida cujo módulo
-- continua liberado ainda tem as rotas dele abertas para quem souber chamá-las.
-- Para negar de verdade, tire o módulo ou a permissão da ação.
-- ============================================================================

alter table if exists users
  add column if not exists blocked_subs jsonb not null default '{}'::jsonb;

comment on column users.blocked_subs is
  'Telas que este usuário NÃO vê, por módulo: {"sales":["relatorio"]}. Vazio = vê todas as telas dos módulos liberados. Ver fase-an.';
