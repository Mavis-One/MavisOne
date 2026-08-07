-- ---------------------------------------------------------------------------
-- Fase N — NF-e sai do data/db.json e passa a viver no Supabase
--
-- As tabelas `nfes` e `nfe_items` já existiam desde a Fase A, sem nenhuma rota
-- usando. Agora emitir, listar, abrir e cancelar NF-e passa pelo banco.
--
-- Com a nota no Supabase, a FK que a Fase M precisou derrubar volta: uma
-- parcela só pode apontar para uma NF-e que exista de verdade. É a checagem que
-- impede parcela órfã — e parcela órfã de documento fiscal é exatamente o tipo
-- de inconsistência que ninguém percebe até a conferência do contador.
--
-- O `not valid` é de propósito: valida da migração para frente sem varrer as
-- linhas antigas, para o caso de haver parcela gravada durante a janela em que
-- a Fase M rodou e esta ainda não. Para exigir a checagem também no passado
-- (recomendado depois de conferir que não sobrou nada), rode:
--
--   alter table financial_entries validate constraint financial_entries_nfe_id_fkey;
--
-- Se essa validação acusar erro, existe parcela apontando para NF-e que não
-- está no banco — investigue antes de forçar.
-- ---------------------------------------------------------------------------
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

alter table if exists financial_entries
  add constraint financial_entries_nfe_id_fkey
  foreign key (nfe_id) references nfes (id)
  not valid;

-- A listagem de NF-e ordena por data e filtra por status; os itens são sempre
-- buscados por nota.
create index if not exists idx_nfes_date on nfes (date desc);
create index if not exists idx_nfes_status on nfes (status);
