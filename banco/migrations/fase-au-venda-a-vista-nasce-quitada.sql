-- ============================================================================
-- FASE AU — a baixa sabe se foi o sistema ou uma pessoa que a registrou
-- ============================================================================
--
-- POR QUE ESTA COLUNA EXISTE
-- --------------------------
-- Até agora toda conta a receber de venda nascia `pending`, fixo no código: a
-- venda paga em DINHEIRO, no balcão, virava conta a receber em aberto.
--
-- Não é hipótese. A auditoria do ERP anterior (ViperERP, 02/09/2026) mediu o
-- estrago no mesmo desenho: R$ 140.375,77 "a receber" e R$ 0,00 "realizado" em
-- dois dias, com todo cliente que comprou aparecendo no relatório de
-- Inadimplentes, e o saldo das contas bancárias virando ficção. Quatro
-- relatórios passaram a mentir sem que nenhuma tela desse erro.
--
-- A correção faz a venda à vista nascer QUITADA, com a baixa registrada. E é aí
-- que aparece a necessidade desta coluna.
--
-- O QUE ELA RESOLVE
-- -----------------
-- Cancelar um pedido faturado já tinha uma regra deliberada: parcela recebida
-- NÃO é cancelada em silêncio, porque o dinheiro entrou de verdade e some da
-- vista de quem precisava decidir o que fazer.
--
-- Essa regra continua certa — para a baixa que uma PESSOA registrou. Mas a
-- baixa que o próprio faturamento criou é parte do faturamento: desfazer um
-- sem o outro deixaria dinheiro "recebido" de um pedido que não existe mais.
--
-- Sem a coluna, distinguir as duas exigiria ler o texto da observação — e teste
-- (ou regra) que depende de uma frase ensina a mudar a frase.
--
--   'manual'     — alguém abriu o lançamento e deu baixa. Fato humano, fica.
--   'automatica' — nasceu com o faturamento de uma venda à vista. Sai com ele.
--
-- O PADRÃO É 'manual', e é a escolha conservadora: toda baixa que já existe foi
-- registrada por uma pessoa, e nenhuma delas pode passar a sumir sozinha por
-- causa desta migração.
alter table if exists financial_payments
  add column if not exists origem text not null default 'manual';

-- Só os dois valores. Um terceiro valor entraria em silêncio e o cancelamento
-- não saberia o que fazer com ele — e "não sei" aqui significa apagar ou manter
-- dinheiro por engano.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'financial_payments_origem_check'
  ) then
    alter table financial_payments
      add constraint financial_payments_origem_check
      check (origem in ('manual', 'automatica'));
  end if;
end $$;

-- O cancelamento procura as baixas automáticas de um lançamento; sem índice
-- isso é varredura na tabela que mais cresce no sistema.
create index if not exists idx_financial_payments_origem
  on financial_payments (entry_id, origem);
