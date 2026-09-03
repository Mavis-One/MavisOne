-- ============================================================================
-- FASE AV — faturar e emitir viram um ato só
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- Faturar e emitir eram passos independentes, e nada ligava um ao outro. Um
-- pedido podia ficar "Pedido Faturado" — com estoque baixado e conta a receber
-- criada — sem nenhum documento fiscal, para sempre, sem que nada avisasse.
--
-- Não é hipótese: neste banco havia 8 pedidos faturados sem nota, R$ 26.033,80,
-- de abril a agosto. O alerta que os encontraria existia e estava ligado na
-- coleção errada (corrigido na mesma leva).
--
-- A auditoria do ERP anterior achou o mesmo padrão lá, e com a mesma
-- consequência: mercadoria saindo da loja sem documento, descoberto só quando
-- alguém audita.
--
-- O QUE MUDA
-- ----------
-- O catálogo de status passa a declarar `exigeDocumento`, e "Pedido Faturado" o
-- declara. Chegar nesse status sem NF-e é recusado.
--
-- MAS NEM TODA SAÍDA TEM NOTA, e ignorar isso quebraria a operação:
-- transferência entre depósitos da mesma empresa, remessa para conserto,
-- bonificação, amostra, brinde. O sistema já tem o status certo para esses
-- casos — "Pedido Aprovado Sem Faturamento", que baixa estoque e não gera
-- financeiro — e ele NÃO exige documento.
--
-- Sobra o caso real que não cabe em nenhum dos dois: a venda que precisa ser
-- faturada agora e cuja nota sai depois (SEFAZ fora do ar, certificado vencendo,
-- contingência). Para esse existe a DISPENSA — e ela é registrada, com motivo e
-- autor, em vez de acontecer em silêncio.
--
-- POR QUE MOTIVO OBRIGATÓRIO
-- --------------------------
-- Uma dispensa sem motivo é o mesmo "faturado sem nota" de antes, com um clique
-- a mais. O motivo é o que permite, depois, separar a contingência de ontem do
-- hábito que virou regra — e é o que o painel de Atenção usa para distinguir o
-- pedido resolvido do esquecido.

alter table if exists orders
  add column if not exists dispensa_documento_fiscal boolean not null default false;

alter table if exists orders
  add column if not exists dispensa_motivo text not null default '';

-- Quem dispensou e quando. Sem isto a dispensa é uma opinião sem dono — e é
-- justamente a informação que falta quando alguém pergunta, meses depois, por
-- que aquela venda saiu sem nota.
alter table if exists orders
  add column if not exists dispensa_por text;

alter table if exists orders
  add column if not exists dispensa_por_nome text not null default '';

alter table if exists orders
  add column if not exists dispensa_em timestamptz;

-- O painel de Atenção procura os faturados sem nota; este índice é o que evita
-- varrer a tabela de pedidos a cada abertura do hub.
create index if not exists idx_orders_sem_documento
  on orders (status) where nfe_id is null or nfe_id = '';

-- NÃO HÁ BACKFILL, e é decisão.
--
-- Os 8 pedidos faturados sem nota que já existem NÃO são marcados como
-- dispensados: marcá-los inventaria uma justificativa que ninguém deu e os
-- faria sumir do painel — apagando exatamente o problema que esta fase existe
-- para tornar visível. Eles continuam aparecendo até alguém emitir a nota ou
-- registrar o motivo.
