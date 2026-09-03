-- ============================================================================
-- FASE BA — a conta bancária cadastrada à mão volta a existir
-- ============================================================================
--
-- O BUG, E ELE É SÉRIO
-- ---------------------
-- `POST /api/cadastros/bank-accounts` respondia `success: true` com o registro
-- completo, e a conta NÃO EXISTIA EM LUGAR NENHUM. Provado contra a API:
--
--   POST  -> 200 {"success":true,"bankAccount":{"id":"bank-1788...","name":"..."}}
--   GET   -> {"bankAccounts":[]}          (zero)
--   banco -> select count(*) ... -> 0
--
-- A tela Cadastros > Contas Bancárias usa essa rota. Toda conta criada por ela
-- desde a limpeza do db.json foi perdida na hora, com a tela dizendo que deu
-- certo.
--
-- POR QUE ACONTECEU
-- ------------------
-- A rota genérica de cadastros grava em `data[coleção]` e chama `saveData`.
-- `bankAccounts` entrou na lista NAO_PERSISTIR quando o db.json parou de manter
-- cópia do que é do Postgres — porque a coleção passou a ser lida do banco. Só
-- que a ESCRITA continuou no caminho antigo: `saveData` removia a coleção e
-- ninguém a gravava no Postgres.
--
-- A leitura errava junto: a rota genérica não chama `syncFinanceData`, então
-- `data.bankAccounts` chegava vazio e a lista mostrava zero contas mesmo com
-- contas reais no banco.
--
-- É a forma mais desagradável de bug: silencioso, e com a confirmação de
-- sucesso na cara de quem cadastrou.
--
-- POR QUE A TABELA PRECISA MUDAR
-- -------------------------------
-- `bank_accounts` nasceu para o Open Finance: guarda a conexão com o provedor
-- (pluggy/polp/celcoin), o saldo sincronizado e o estado da conexão. O
-- formulário de cadastro pede outra metade — código do banco, dígitos, titular,
-- CPF/CNPJ, chave PIX, saldo inicial, observações — que a tabela não tinha
-- onde pôr.
--
-- As colunas novas são do CADASTRO. As que já existiam continuam sendo da
-- CONEXÃO, e é por isso que `status` não serve para os dois:
--
--   status  = 'ativa' | 'erro' | 'desconectada'   -> a CONEXÃO com o banco
--   ativo   = true | false                        -> o CADASTRO está em uso
--
-- Diferem por uma letra ('ativa' e 'ativo') e significam coisas diferentes.
-- Reaproveitar a mesma coluna para os dois seria uma armadilha que alguém
-- descobre no dia em que uma conta desconectada some do formulário.
--
-- O TIPO, AO CONTRÁRIO, É UM SÓ. `account_type` já é o tipo da conta; o CHECK é
-- que era estreito, escrito para os três valores que o provedor devolve. Uma
-- conta caixa ou de investimento é o mesmo campo com outro valor — duas colunas
-- de tipo seriam duas respostas para a mesma pergunta.

-- ----------------------------------------------------------------------------
-- As colunas do cadastro
-- ----------------------------------------------------------------------------
alter table if exists bank_accounts
  add column if not exists bank_code        text,
  add column if not exists agency_digit     text,
  add column if not exists number_digit     text,
  add column if not exists holder           text,
  add column if not exists holder_document  text,
  add column if not exists pix_key          text,
  add column if not exists initial_balance  numeric not null default 0,
  add column if not exists notes            text,
  -- O cadastro está em uso? Nada a ver com o estado da conexão — ver acima.
  -- Nasce `true` porque toda conta que já existe está em uso: ninguém marcou o
  -- contrário, e supor o contrário esconderia contas do formulário de
  -- lançamento de um dia para o outro.
  add column if not exists ativo            boolean not null default true;

-- ----------------------------------------------------------------------------
-- O tipo da conta aceita os cinco do formulário
-- ----------------------------------------------------------------------------
-- 'credito' fica: é o que o provedor devolve para cartão, e apagá-lo
-- invalidaria as contas já sincronizadas por Open Finance.
alter table if exists bank_accounts
  drop constraint if exists bank_accounts_account_type_check;

alter table if exists bank_accounts
  add constraint bank_accounts_account_type_check
  check (account_type is null or account_type in
    ('corrente', 'poupanca', 'credito', 'pagamento', 'caixa', 'investimento'));

-- A pergunta que o formulário de lançamento faz: "quais contas posso usar?".
create index if not exists idx_bank_accounts_ativo on bank_accounts (ativo);
