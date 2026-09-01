-- ============================================================================
-- FASE AP — o razão de estoque sai do arquivo e vira tabela
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- `data.stockMovements` e `data.stockTransfers` viviam em data/db.json. Três
-- consequências, todas silenciosas:
--
--   1. O pg_dump não os via. O backup se anunciava como cópia do sistema e
--      copiava o Postgres, que é outra coisa. (Contornado na mesma leva pondo o
--      db.json dentro do artefato; isto aqui é a correção de raiz.)
--   2. Não havia transação. Uma transferência gravava dois movimentos e um
--      registro num writeFileSync só — atômica POR ACIDENTE, porque era um
--      arquivo, não porque alguém garantiu.
--   3. Duas requisições concorrentes faziam loadData/saveData e a última
--      vencia, apagando a escrita da outra sem erro nenhum.
--
-- POR QUE NÃO HÁ CHAVE ESTRANGEIRA PARA products NEM PARA deposits
-- ----------------------------------------------------------------
-- Porque razão é HISTÓRICO, e histórico tem de sobreviver ao cadastro. Excluir
-- um produto não pode apagar em cascata a prova de que ele entrou e saiu do
-- estoque — o movimento aconteceu, e o registro dele vale para conferência,
-- auditoria e inventário depois que o cadastro morreu.
--
-- Não é invenção desta migração: o schema já documenta a mesma decisão para
-- access_logs.by_id ("de propósito NÃO tem FK pra users — o registro tem que
-- sobreviver mesmo que o usuário seja excluído") e financial_entries.
--
-- E é literal aqui: os 23 movimentos que existem hoje apontam para dois
-- produtos que não existem mais em products, e para um depósito que não existe
-- mais em deposits. Com FK, a migração recusaria todos os 23 e o saldo de 1051
-- unidades sumiria da tela sem ninguém pedir.
--
-- POR QUE deposit_id E class_value_id SÃO '' E NÃO NULL
-- -----------------------------------------------------
-- Porque '' aqui é VALOR, não ausência: significa "saldo não alocado em
-- depósito" (é o balde `unallocated` de productBalances) e "sem cor" (o balde
-- `semClasse`, que a tela filtra pelo sentinela '_sem'). 20 dos 23 movimentos
-- estão nesse balde.
--
-- Trocar por NULL obrigaria a reescrever toda comparação de saldo para tratar
-- IS NULL — e uma comparação esquecida não dá erro: ela devolve saldo errado,
-- que é o pior resultado possível num razão.
--
-- A NUMERAÇÃO PASSA A SER DO BANCO
-- --------------------------------
-- O código (MOV-0001) era calculado no Node como max+1 lendo a lista inteira.
-- Isso reusava código depois de um DELETE e, com duas requisições ao mesmo
-- tempo, gerava MOV-0024 duas vezes. Sequence não repete e não volta atrás.
-- ============================================================================

create table if not exists stock_movements (
  id text primary key,
  code text not null,

  -- O ÚNICO campo que define o sinal do saldo: 'saida' subtrai, 'entrada' soma.
  type text not null check (type in ('entrada', 'saida')),
  date date not null default current_date,

  -- Sem FK, de propósito. Ver o bloco no cabeçalho.
  product_id text not null,
  -- O nome do produto NA ÉPOCA do lançamento. Não é usado para exibir (a tela
  -- resolve pelo cadastro atual e mostra "(produto removido)" quando sumiu) —
  -- fica como registro histórico de um razão que sobrevive ao cadastro.
  product_name text not null default '',

  -- '' = saldo não alocado em depósito. Ver o bloco no cabeçalho.
  deposit_id text not null default '',
  class_id text not null default '',
  class_value_id text not null default '',

  -- SEMPRE POSITIVA: o sinal mora em `type`. As 4 casas não são arbitrárias —
  -- é a precisão que o PCP produz ao ratear quantidade por ordem de produção.
  quantity numeric(18, 4) not null check (quantity > 0),
  -- 6 casas porque é preço unitário vindo de NF-e, onde o vUnCom tem mais casas
  -- que o total; arredondar antes de multiplicar por quantity criaria centavos
  -- de diferença em toda entrada.
  unit_cost numeric(18, 6) not null default 0,

  category_id text not null default '',
  document text not null default '',
  note text not null default '',

  -- Liga os DOIS movimentos de uma transferência (a saída e a entrada). É por
  -- ele que o estorno acha o par para desfazer.
  transfer_id text not null default '',
  origin text not null default '',

  -- De onde o movimento veio quando não foi lançado à mão: venda, compra,
  -- produção. Preenchidos por registrarMovimentoEstoque.
  motivo text not null default '',
  reference_type text not null default '',
  reference_id text not null default '',

  -- Sem FK para users pelo mesmo motivo dos outros: 17 dos 23 movimentos foram
  -- criados por um usuário que já não existe, e o registro de quem fez é
  -- justamente o que não pode sumir.
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

-- O saldo é agregação do razão, e estas são as três perguntas que o sistema faz:
-- saldo do produto no depósito, saldo do produto naquela cor, e a lista por
-- período. Sem elas, cada tela varre a tabela inteira.
create index if not exists idx_stock_mov_produto_deposito on stock_movements (product_id, deposit_id);
create index if not exists idx_stock_mov_produto_classe on stock_movements (product_id, class_value_id);
create index if not exists idx_stock_mov_data on stock_movements (date desc);
-- Parcial: a esmagadora maioria dos movimentos não é de transferência, e o
-- estorno pergunta só pelos que são.
create index if not exists idx_stock_mov_transferencia on stock_movements (transfer_id) where transfer_id <> '';

create table if not exists stock_transfers (
  id text primary key,
  code text not null,
  -- Liga os itens enviados na MESMA movimentação. A lista mostra uma linha por
  -- produto (é assim que ela sempre foi, e é o que o estorno por linha espera),
  -- mas quem precisar reconstruir a movimentação inteira tem por onde.
  batch_id text not null default '',
  date date not null default current_date,

  product_id text not null,
  origin_deposit_id text not null default '',
  destination_deposit_id text not null default '',
  class_id text not null default '',
  class_value_id text not null default '',
  quantity numeric(18, 4) not null check (quantity > 0),
  note text not null default '',

  -- Os dois movimentos que esta transferência gerou. Sem FK: apagar o
  -- movimento e apagar a transferência é a MESMA operação de estorno, e uma FK
  -- só decidiria a ordem em que ela falha.
  movement_out_id text not null default '',
  movement_in_id text not null default '',

  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_transf_produto on stock_transfers (product_id);
create index if not exists idx_stock_transf_lote on stock_transfers (batch_id) where batch_id <> '';
create index if not exists idx_stock_transf_data on stock_transfers (date desc);

-- ----------------------------------------------------------------------------
-- A numeração, que sai do Node e vem para o banco
-- ----------------------------------------------------------------------------
-- Ficam como sequences separadas porque MOV e TRA são séries independentes: a
-- transferência número 3 não tem nada a ver com o movimento número 3.
--
-- Não são DEFAULT da coluna de propósito: o código precisa saber o número ANTES
-- de montar o registro (a transferência grava o mesmo par de movimentos em dois
-- lugares), e um default só entregaria o número depois do INSERT.
create sequence if not exists stock_movements_code_seq as bigint start with 1;
create sequence if not exists stock_transfers_code_seq as bigint start with 1;

comment on table stock_movements is
  'Razão de estoque: uma linha por entrada/saída. Histórico — sobrevive à exclusão do produto, do depósito e do usuário, e por isso não tem FK para nenhum deles. Ver fase-ap.';
comment on table stock_transfers is
  'Transferências entre depósitos. Cada linha aponta para os dois movimentos que ela gerou. Ver fase-ap.';

-- ----------------------------------------------------------------------------
-- RLS, pela mesma razão da fase AF
-- ----------------------------------------------------------------------------
-- Toda tabela do schema tem RLS ligada, sem política: só o servidor fala com o
-- banco, e ele usa o dono da conexão (que ignora RLS por ser owner). A trava
-- existe para o dia em que alguém publicar este banco com uma chave pública —
-- é a camada que continua de pé quando a porta presa em 127.0.0.1 deixar de
-- estar presa.
--
-- Tabela nova que nasce sem isto é justamente a que fica aberta, e é por isso
-- que scripts/test-rls.js cobra cada uma pelo nome. Ele pegou estas duas.
alter table if exists stock_movements enable row level security;
alter table if exists stock_transfers enable row level security;
