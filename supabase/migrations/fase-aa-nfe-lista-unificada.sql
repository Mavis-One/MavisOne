-- ---------------------------------------------------------------------------
-- Fase AA — a NF-e real vira a NF-e da tela
--
-- O SISTEMA TINHA DUAS NF-e QUE NÃO SE FALAVAM:
--
--   `nfes`  — registro manual do Financeiro (tela "Nova NF-e Avulsa").
--   `nfe`   — a nota de verdade, transmitida à SEFAZ pela Focus NFe.
--
-- A tela "NF-e Emitidas" lia só a primeira. Quem emitisse pela Focus não veria
-- a nota no lugar onde qualquer pessoa vai procurar — e nada acusaria o erro.
-- As nove ações do menu (baixar XML, DANFE, CC-e, consultar status) também
-- ficavam mortas por isso: as rotas existem em /api/fiscal/nfe, mas o menu
-- vivia na lista errada.
--
-- Esta migração dá à tabela fiscal as três colunas que faltavam para ela poder
-- SER a lista:
--
--   destinatario_nome / destinatario_documento
--     Estavam só dentro de payload_enviado (jsonb). Ler dali não serve por dois
--     motivos: filtrar por cliente viraria varredura de JSON, e em HOMOLOGAÇÃO
--     o nome do destinatário é o texto fixo que a SEFAZ exige
--     ("NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL") — a lista
--     inteira mostraria a mesma frase em vez do cliente.
--
--   order_id
--     O pedido de venda que originou a nota. Sem ele a ação "Ir Para a Venda"
--     não tem para onde ir. Sem FK de propósito: a nota é documento fiscal e
--     não pode ser apagada nem alterada por causa do ciclo de vida do pedido.
--     Ver a regra de que documento fiscal só se cancela, jamais se exclui.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

alter table nfe add column if not exists destinatario_nome text;
alter table nfe add column if not exists destinatario_documento text;
alter table nfe add column if not exists order_id text;

-- NF-e AVULSA: emitida sem pedido de origem.
--
-- Quando a nota nasce de um pedido, o financeiro já foi gerado por ele. Quando
-- ela nasce avulsa, não existe ninguém para gerar — e sem isto uma venda
-- faturada some do contas a receber.
--
-- A condição fica gravada porque a autorização da SEFAZ pode chegar DEPOIS,
-- por webhook, num processo que não tem mais a tela nem o usuário: sem a
-- condição guardada, não haveria como montar as parcelas naquele momento.
alter table nfe add column if not exists condicao_pagamento jsonb;

comment on column nfe.condicao_pagamento is
  'Como a nota avulsa deve virar contas a receber: {tipo, parcelas, intervaloDias}. Nulo quando a nota veio de pedido — nesse caso o financeiro é do pedido.';

comment on column nfe.destinatario_nome is
  'Nome REAL do destinatário. Em homologação difere do nome enviado à SEFAZ, que é o texto fixo exigido por ela.';
comment on column nfe.order_id is
  'Pedido de venda de origem. Sem FK: a nota não pode ser afetada pelo ciclo de vida do pedido.';

-- Busca por cliente na lista de NF-e.
create index if not exists idx_nfe_destinatario on nfe (destinatario_nome);
-- "Este pedido já tem nota?" — pergunta feita a cada tentativa de emissão.
create index if not exists idx_nfe_order on nfe (order_id);
