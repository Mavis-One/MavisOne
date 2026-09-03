-- ============================================================================
-- FASE AX — cancelar um lançamento passa a exigir motivo
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- `POST /api/finance/entries/:id/cancelar` trocava o status para 'cancelado' e
-- acabava. A tela pedia uma confirmação ("Confirma o cancelamento?") e mais
-- nada. Meses depois, um lançamento cancelado de R$ 8.400 é um registro que
-- ninguém consegue explicar: dá para ver QUEM cancelou (a trilha de auditoria
-- guarda), mas não POR QUÊ — e é o porquê que decide se aquilo foi correção de
-- digitação, venda desfeita ou dinheiro que alguém deixou de cobrar.
--
-- A NF-e já resolvia isso: cancelamento sem justificativa é recusado, porque a
-- SEFAZ exige. O lançamento financeiro não tinha ninguém de fora exigindo, e
-- por isso ficou sem.
--
-- POR QUE AS TRÊS COLUNAS, E NÃO SÓ O MOTIVO
-- -------------------------------------------
-- Porque motivo sozinho não responde a pergunta que se faz olhando para um
-- cancelamento: "quem decidiu isso, e quando?". Está na trilha de auditoria,
-- sim — em outra tabela, em outra tela, e a busca é por id de lançamento.
-- Quem abre o lançamento quer as três coisas juntas, ali.
--
-- A trilha continua sendo a prova (é ela que ninguém edita); estas colunas são
-- a leitura. Duas cópias do mesmo fato, de propósito.
--
-- NULO É PERMITIDO, e é o estado dos que já foram cancelados antes desta fase.
-- Preencher com "motivo não informado" inventaria um motivo que ninguém deu; a
-- tela mostra "motivo não registrado" para eles, que é a verdade.
alter table if exists financial_entries
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_name text;
