-- ---------------------------------------------------------------------------
-- Fase AI — Arquivos Anexados ao pedido e ao orcamento
--
-- O ARQUIVO nao fica aqui. O binario vai para o Supabase Storage, no bucket
-- `pedido-anexos`, e esta coluna guarda so a FICHA de cada arquivo:
--
--   [{ "id", "nome", "tamanho", "tipo", "caminho", "enviadoEm", "enviadoPor" }]
--
-- Guardar o binario no banco (bytea ou base64 num jsonb) faria cada leitura do
-- pedido arrastar os anexos junto: abrir a lista de pedidos passaria a
-- transferir megabytes de PDF que ninguem pediu. O `caminho` e o que liga a
-- ficha ao arquivo la no Storage.
--
-- O bucket e PRIVADO. Anexo de pedido tem contrato, proposta e dado de
-- cliente; bucket publico faria cada arquivo ficar legivel por qualquer um que
-- descobrisse a URL, sem login nenhum. O download passa pelo servidor, que
-- confere a sessao antes de entregar os bytes.
--
-- Migracao ADITIVA: nao mexe em nada existente. Pedido gravado antes dela fica
-- com `attachments = []`, que e exatamente "nenhum anexo".
--
-- Vale para as DUAS tabelas: orcamento vira pedido sem trocar de tabela, e
-- perder os anexos ao aprovar seria pior do que nunca te-los aceitado.
-- ---------------------------------------------------------------------------

alter table if exists orders add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column orders.attachments is
  'Fichas dos arquivos anexados: [{"id","nome","tamanho","tipo","caminho","enviadoEm","enviadoPor"}]. O binario fica no Supabase Storage, bucket privado `pedido-anexos`; `caminho` e a chave la dentro.';

comment on column quotes.attachments is
  'Fichas dos arquivos anexados ao orcamento. Mesmo formato de orders.attachments.';
