-- ---------------------------------------------------------------------------
-- Fase P — vínculo entre o Pedido e a NF-e
--
-- O menu da NF-e já tinha a ação "Ir para a venda", com a checagem
-- `nfe.orderId ? true : 'Esta NF-e não tem venda vinculada.'` — só que orderId
-- nunca foi gravado por lugar nenhum. A ação nascia permanentemente desligada.
--
-- Com o fluxo Pedido -> Aprovar -> Financeiro -> Gerar NF-e, o vínculo passa a
-- existir de verdade, e é guardado nos DOIS sentidos de propósito:
--
--   nfes.order_id  — de qual pedido esta nota saiu (a nota é o documento final,
--                    e é dela que se pergunta a origem numa conferência)
--   orders.nfe_id  — qual nota já foi emitida para este pedido, que é o que
--                    impede emitir a segunda por engano e o que permite à tela
--                    do pedido mostrar a nota sem varrer a tabela inteira
--
-- Sem FK rígida em nenhum dos dois lados: os registros nascem em rotas
-- diferentes e em momentos diferentes, e uma FK aqui só transformaria ordem de
-- gravação em erro de banco. A consistência é garantida no servidor, que grava
-- os dois lados na mesma rota de emissão.
-- ---------------------------------------------------------------------------
alter table if exists nfes add column if not exists order_id text;
alter table if exists orders add column if not exists nfe_id text;

create index if not exists idx_nfes_order_id on nfes (order_id);
