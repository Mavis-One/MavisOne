-- ---------------------------------------------------------------------------
-- Fase AL -- A ponte entre QUEM FAZ LOGIN e QUEM VENDE
--
-- O PROBLEMA QUE ESTA COLUNA RESOLVE
-- ----------------------------------
-- O vendedor de um pedido e uma PESSOA do Cadastros (`people`, com o papel
-- "Vendedor"): orders.seller_id aponta para la. Quem faz login e uma linha de
-- `users`. Sao duas tabelas diferentes desde a Fase A, e por bons motivos --
-- vendedor nao precisa ter login (representante externo, vendedor que saiu da
-- empresa mas cujas vendas continuam no historico), e usuario nao precisa
-- vender (o financeiro, o estoquista, o admin).
--
-- Enquanto as duas nao se falavam, a pergunta "quais vendas sao SUAS?" nao
-- tinha resposta possivel, e o Relatorio de Vendas so conseguia oferecer duas
-- opcoes ruins: mostrar tudo para todo mundo, ou pedir para a pessoa escolher
-- o proprio nome num filtro -- que qualquer um pode trocar.
--
-- POR QUE UMA COLUNA, E NAO CASAR PELO NOME
-- -----------------------------------------
-- Casar `users.name` com `people.name` custaria zero e e a armadilha: dois
-- "Joao Silva" no cadastro, ou um acento a menos, e o relatorio passa a mostrar
-- as vendas de outra pessoa -- ou nenhuma -- sem erro nenhum aparecer. Controle
-- de acesso que erra em silencio e pior do que controle nenhum, porque ninguem
-- vai procurar o defeito.
--
-- NULO E O PADRAO, E E O CASO MAIS RESTRITIVO
-- -------------------------------------------
-- Usuario sem vinculo nao ve venda nenhuma no relatorio (fora administrador,
-- que ve tudo por outro caminho). E de proposito: o ramo "sem filtro" nunca
-- pode ser o padrao de quem o sistema nao sabe quem e. A tela mostra o motivo
-- e diz o que fazer, em vez de uma lista vazia sem explicacao.
--
-- SEM FOREIGN KEY, IGUAL AO RESTO DO SISTEMA
-- ------------------------------------------
-- `people` e `cnpjs` sao as duas tabelas de contraparte, e o sistema inteiro
-- aponta para elas por id solto (financial_entries.client_supplier_id,
-- nfe_entrada.cadastro_id). Uma FK aqui seria a unica do genero e impediria
-- apagar uma pessoa que ja foi vendedora -- exatamente o registro que o
-- historico de vendas precisa manter.
-- ---------------------------------------------------------------------------

alter table if exists users
  add column if not exists seller_id text;

create index if not exists idx_users_seller on users (seller_id) where seller_id is not null;

comment on column users.seller_id is
  'people.id do vendedor que este usuario E. Define quais vendas ele ve no Relatorio de Vendas quando nao e administrador. Nulo = nenhuma venda (falha fechada), nunca "todas".';
