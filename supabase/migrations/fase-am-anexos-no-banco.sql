-- ---------------------------------------------------------------------------
-- Fase AM — o anexo do pedido sai do Storage e entra no banco
--
-- POR QUE ISTO NAO CONTRADIZ O QUE A FASE AI DIZ
--
-- A fase AI escreveu, com razao, que guardar o binario no banco "faria cada
-- leitura do pedido arrastar os anexos junto". Aquela frase era sobre guardar o
-- arquivo DENTRO de orders.attachments, no mesmo jsonb da ficha: ali, sim, todo
-- SELECT do pedido traria megabytes de PDF que ninguem pediu.
--
-- Aqui o binario vai para uma TABELA SEPARADA. orders.attachments continua
-- sendo so a ficha, do mesmo jeito e com o mesmo formato, e a lista de pedidos
-- continua sem tocar em um byte de arquivo. So quem clica em baixar le esta
-- tabela. A objecao da fase AI continua valendo, e continua respeitada.
--
-- O QUE MUDOU E POR QUE
--
-- O sistema saiu do Supabase e passou a rodar contra um Postgres em Docker. O
-- Supabase Storage nao veio junto — nao existe mais bucket para onde mandar o
-- arquivo. As alternativas eram pasta em volume do Docker ou tabela no banco, e
-- a tabela ganhou por causa do BACKUP: a stack de pg_dump que ja roda no
-- Portainer passa a cobrir os anexos sem nenhum trabalho novo. Com arquivo em
-- pasta, backup viraria duas coisas que precisam ser restauradas no mesmo
-- ponto no tempo — e a que alguem esquece e sempre a segunda.
--
-- POR QUE NAO EXISTE FK PARA orders
--
-- Pelo mesmo motivo da fase AE, e o motivo e o mesmo de sempre neste sistema:
-- um registro de venda mora em `orders` OU em `quotes`, sao duas tabelas, e uma
-- FK so pode apontar para uma. A limpeza do anexo ao excluir o pedido continua
-- sendo feita em codigo (server.js ja chama removerAnexo antes de excluir), e o
-- indice por registro_id e o que torna essa limpeza barata.
--
-- O ARQUIVO CONTINUA PRIVADO
--
-- Antes o bucket era privado e o download passava pelo servidor, que conferia a
-- sessao antes de entregar os bytes. Agora e mais forte ainda: nao existe URL
-- nenhuma para o arquivo. O unico caminho ate o binario e uma consulta feita
-- pelo servidor, depois do portao de permissao. Nao ha link para vazar.
--
-- ADITIVA: nao mexe em orders nem em quotes. Pedido antigo continua com a ficha
-- que tinha; se aquela ficha apontava para um arquivo no Storage que nao veio
-- junto, o download avisa que o arquivo nao esta no banco — em vez de entregar
-- lixo.
-- ---------------------------------------------------------------------------

create table if not exists pedido_anexo (
  -- O mesmo id "anx-..." que ja vai gravado dentro da ficha em
  -- orders.attachments. Reusar o id da ficha, em vez de gerar um novo, e o que
  -- permite achar o binario a partir da ficha sem coluna de ligacao extra.
  id text primary key,

  -- id do pedido OU do orcamento. Sem FK, ver o cabecalho.
  registro_id text not null,

  nome text not null,
  tipo text not null default '',
  tamanho integer not null,

  -- O binario. bytea, nao base64 em texto: base64 ocupa 33% a mais e obrigaria
  -- a converter nas duas pontas.
  conteudo bytea not null,

  enviado_em timestamptz not null default now(),
  enviado_por text not null default ''
);

-- A busca por pedido e a unica que existe (listar/limpar os anexos de um
-- registro). Sem o indice, excluir um pedido varreria a tabela inteira de
-- arquivos para achar os dele.
create index if not exists idx_pedido_anexo_registro on pedido_anexo (registro_id);

-- RLS ligada, sem politica, como nas outras 80 tabelas (fase AF). Hoje ela nao
-- filtra nada: o app conecta como DONO das tabelas, e dono passa por cima de
-- RLS por padrao (nao ha "force row level security" em lugar nenhum). Fica
-- ligada assim mesmo porque o dia em que alguem apontar outra ferramenta para
-- este banco com um papel comum, a porta ja esta fechada — e porque uma tabela
-- fora do padrao das outras e o tipo de exceção que ninguem lembra depois.
alter table if exists pedido_anexo enable row level security;

comment on table pedido_anexo is
  'Binario dos arquivos anexados a pedidos e orcamentos. A FICHA (nome, tamanho, quem enviou) fica em orders.attachments / quotes.attachments; aqui fica o conteudo, lido so quando alguem baixa. Sem FK porque o registro pode estar em orders ou em quotes.';

comment on column pedido_anexo.conteudo is
  'Os bytes do arquivo. Nao existe URL publica para ele: o unico acesso e pelo servidor, depois da checagem de sessao e permissao.';
