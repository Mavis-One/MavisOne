-- ---------------------------------------------------------------------------
-- Fase AG — preferencias de tela por usuario
--
-- A lista de Pedidos e Orcamentos ganhou seletor de colunas, e a escolha
-- precisa seguir a PESSOA, nao o navegador. Guardar em localStorage pareceria
-- funcionar ate alguem trocar de maquina ou abrir numa aba anonima e achar que
-- o sistema esqueceu.
--
-- Uma coluna jsonb generica, e nao uma por tela: a proxima lista que precisar
-- lembrar de algo (largura de coluna, ordem preferida, filtro salvo) entra sem
-- migracao nova. O formato e { "<tela>": { ...o que aquela tela quiser } }.
--
-- Segue o caminho que ja existia para dashboard_pins, na mesma tabela.
alter table if exists users add column if not exists preferences jsonb not null default '{}'::jsonb;

comment on column users.preferences is
  'Preferencias de tela por usuario, no formato { "<tela>": {...} }. Hoje guarda as colunas visiveis da lista de vendas.';
