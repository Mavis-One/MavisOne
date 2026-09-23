-- ============================================================================
-- FASE CU — a contagem de estoque, que é a carga inicial e o inventário
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- Nada. Medido no banco em 23/09/2026:
--
--     5.475 produtos cadastrados
--         0 depósitos
--         0 movimentos de estoque
--         0 unidades de saldo somando o catálogo inteiro
--
-- O sistema sabe movimentar estoque (entrada, saída, transferência, venda,
-- produção, nota de entrada) e não sabe COMEÇAR a ter estoque. Saldo inicial
-- só pode ser lançado na CRIAÇÃO do produto — a rota de produtos faz
-- `if (!existing && initialQuantity > 0)` e gera um movimento com
-- `origin: 'saldo-inicial'`. Para os 5.475 produtos que já existem, esse `if`
-- nunca é verdadeiro: não há caminho nenhum.
--
-- A alternativa era lançar 5.475 movimentações manuais, uma tela por produto.
--
-- POR QUE UMA TABELA E NÃO UMA ROTA DE IMPORTAÇÃO
-- ----------------------------------------------
-- Porque o raio-X pede DUAS coisas que são a mesma coisa:
--
--   VM-EST-08 (P0) — carga do estoque inicial por loja, faseada, idempotente,
--                    com relatório de conferência
--   VM-EST-04 (P1) — inventário cíclico, divergência apontada, ajuste gerado
--                    como movimentação rastreada, relatório de acuracidade
--
-- Uma folha de contagem que recebe a quantidade contada por produto/depósito e
-- gera o movimento de ajuste ATENDE OS DOIS. A carga inicial é uma contagem
-- contra saldo anterior zero — é literalmente o mesmo documento com o
-- `expected_quantity` zerado. Construir duas coisas separadas daria dois
-- caminhos para mexer no saldo, com duas chances de um deles esquecer uma
-- guarda.
--
-- POR QUE UM DOCUMENTO COM STATUS, E NÃO UM ENVIO ÚNICO
-- ----------------------------------------------------
-- A transferência (fase AP) monta a lista no navegador e envia tudo num POST.
-- Serve lá porque transferir é um ato de minutos.
--
-- Contar não é. Uma contagem de galpão leva horas, é feita por mais de uma
-- pessoa, e quem conta está no corredor com o celular na mão. Perder a lista
-- num F5 é exatamente a falha que faz a contagem voltar para o papel — e do
-- papel ela não volta para o sistema.
--
-- Por isso: a contagem NASCE gravada, com status `aberta`, recebe item por
-- item, e só mexe no estoque quando alguém a FECHA. É também o que dá
-- idempotência à carga inicial (fechar uma contagem fechada é recusado) e o que
-- permite o relatório de conferência que o VM-EST-08 pede.
--
-- POR QUE `cancelada` EXISTE E `delete` NÃO
-- -----------------------------------------
-- Uma contagem abandonada é registro de trabalho feito: alguém andou pelo
-- galpão. Apagá-la esconde que a contagem existiu e que foi desistida — e o
-- relatório de acuracidade passaria a medir só as contagens que deram certo,
-- que é a medida errada.
--
-- Mesma decisão do razão (fase AP) e do documento fiscal: o registro sobrevive.
-- Fechada, então, não volta atrás por aqui — o que se desfaz é o MOVIMENTO que
-- ela gerou, pela tela de Movimentações, que já sabe estornar.
--
-- POR QUE A CONTAGEM NÃO PODE DEIXAR NENHUM SALDO NEGATIVO, POR CONSTRUÇÃO
-- -----------------------------------------------------------------------
-- Vale a pena escrever porque é o que dispensa uma guarda nova.
--
-- O ajuste é `contado − saldo_do_depósito`, então o saldo do depósito DEPOIS do
-- fechamento é exatamente `contado`, que o CHECK obriga a ser >= 0. Nenhum
-- depósito fica negativo.
--
-- E o "não alocado" (total do produto menos a soma dos depósitos) é INVARIANTE:
-- o fechamento soma o mesmo delta ao total do produto e ao depósito contado, e
-- a diferença entre os dois não se move. Uma contagem não pode piorar o balde
-- que ela não toca — que é justamente a regra que commitStockMovements aplica
-- ("só recusa quando o lote piora").
--
-- O fechamento passa por commitStockMovements assim mesmo, e não por um INSERT
-- próprio: é lá que mora a travagem dos produtos em ordem fixa (contra
-- deadlock), a numeração pela sequence e a soma transacional do total. Ter
-- provado que duas guardas não disparam não é motivo para sair do caminho onde
-- elas moram — a próxima guarda que alguém acrescentar lá vale para a contagem
-- de graça.
--
-- POR QUE `expected_quantity` FICA GRAVADO SE O FECHAMENTO RECALCULA
-- -----------------------------------------------------------------
-- São duas perguntas diferentes.
--
-- `expected_quantity` é o saldo no momento em que o item foi contado: é o que o
-- relatório de acuracidade compara com o contado para dizer "o sistema errou em
-- 3 unidades". Sem ele, depois do fechamento o saldo passa a ser o contado e a
-- divergência DESAPARECE do registro — a contagem provaria que sempre esteve
-- certa.
--
-- `adjustment` é o delta efetivamente aplicado no fechamento, contra o saldo
-- lido naquele instante. Os dois números podem diferir se algo se mexeu entre a
-- contagem e o fechamento, e é bom que difiram: é assim que se vê que se mexeu.

create table if not exists stock_counts (
  id text primary key,
  code text not null,
  date date not null default current_date,

  -- OBRIGATÓRIO, e é a diferença em relação ao razão, onde deposit_id = ''
  -- significa "saldo não alocado". Contagem sem depósito não quer dizer nada:
  -- conta-se um LUGAR. O balde "não alocado" não é um lugar — é a ausência de
  -- um —, e o que o zera é distribuir o saldo, não contá-lo.
  deposit_id text not null check (btrim(deposit_id) <> ''),

  status text not null default 'aberta'
    check (status in ('aberta', 'fechada', 'cancelada')),
  note text not null default '',

  -- Quem fechou e quando. Separado de created_by porque contar e conferir são
  -- papéis diferentes, e a auditoria pergunta pelo segundo.
  closed_at timestamptz,
  closed_by text not null default '',
  closed_by_name text not null default '',
  cancel_reason text not null default '',

  -- Sem FK para users, pelo mesmo motivo das fases AP/AQ/AR: o registro de quem
  -- fez tem de sobreviver à exclusão de quem fez.
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists stock_count_items (
  id text primary key,

  -- AQUI TEM FK, E COM CASCADE — ao contrário do razão.
  --
  -- Não é contradição: o item não é histórico de um movimento, é PARTE de um
  -- documento. O histórico do ajuste mora em stock_movements, que não tem FK
  -- para nada e sobrevive a tudo, inclusive à contagem que o gerou.
  --
  -- E o cascade só alcança contagem `aberta`: fechada e cancelada não são
  -- excluíveis por rota nenhuma (ver o bloco no cabeçalho). O que o cascade
  -- evita é item órfão quando uma contagem aberta é descartada.
  count_id text not null references stock_counts (id) on delete cascade,

  product_id text not null,
  -- O nome do produto NA ÉPOCA da contagem, como no razão: a folha tem de
  -- continuar legível depois que o cadastro mudar ou sumir.
  product_name text not null default '',
  class_id text not null default '',
  class_value_id text not null default '',

  -- ZERO É PERMITIDO, e é a contagem mais importante que existe: "fui à
  -- prateleira e não havia nada". Um campo que só aceita > 0 não consegue
  -- registrar uma perda total — e perda total é o que a contagem existe para
  -- achar. É por isso que o CHECK é >= 0 e não > 0, diferente de
  -- stock_movements.quantity, onde a quantidade é de um movimento que
  -- aconteceu.
  counted_quantity numeric(18, 4) not null check (counted_quantity >= 0),

  -- O saldo do sistema quando este item foi contado. Ver o bloco no cabeçalho.
  expected_quantity numeric(18, 4) not null default 0,

  -- Preenchidos NO FECHAMENTO. Antes dele são 0 e '': a contagem aberta não
  -- ajustou nada.
  adjustment numeric(18, 4) not null default 0,
  movement_id text not null default '',

  note text not null default '',
  counted_by text not null default '',
  counted_by_name text not null default '',
  created_at timestamptz not null default now()
);

-- O MESMO PRODUTO (NA MESMA COR) DUAS VEZES NA MESMA CONTAGEM É ERRO DE
-- CONTAGEM, NÃO DUAS CONTAGENS.
--
-- Sem esta restrição, contar 8 e depois 5 do mesmo item deixaria os dois na
-- folha, e o fechamento aplicaria os dois ajustes em sequência: o saldo
-- terminaria em 5 por acidente (o último a ser aplicado vence), com um ajuste
-- fantasma de +8 no razão que ninguém pediu. Com ela, a segunda leitura
-- ATUALIZA a primeira — que é o que a pessoa quis dizer ao recontar.
create unique index if not exists idx_count_items_unico
  on stock_count_items (count_id, product_id, class_value_id);

create index if not exists idx_count_items_contagem on stock_count_items (count_id);
create index if not exists idx_stock_counts_deposito on stock_counts (deposit_id);
create index if not exists idx_stock_counts_status on stock_counts (status);
create index if not exists idx_stock_counts_data on stock_counts (date desc);

-- Série própria, pelo mesmo motivo de MOV e TRA serem separadas (fase AP): a
-- contagem número 3 não tem nada a ver com o movimento número 3. E não é
-- DEFAULT da coluna porque o código precisa do número ANTES do INSERT.
create sequence if not exists stock_counts_code_seq as bigint start with 1;

comment on table stock_counts is
  'Contagem de estoque: folha por depósito. Fechada, gera os movimentos de ajuste. Atende a carga inicial (VM-EST-08) e o inventário cíclico (VM-EST-04) — são o mesmo documento. Ver fase-cu.';
comment on table stock_count_items is
  'Itens contados. `expected_quantity` guarda o saldo no momento da contagem, para a acuracidade não desaparecer depois do fechamento. Ver fase-cu.';

-- ----------------------------------------------------------------------------
-- RLS, pela mesma razão da fase AF
-- ----------------------------------------------------------------------------
-- Toda tabela do schema tem RLS ligada, sem política: só o servidor fala com o
-- banco, e ele conecta como dono (que ignora RLS). A trava existe para o dia em
-- que alguém publicar este banco com uma chave pública. Tabela nova que nasce
-- sem isto é justamente a que fica aberta — scripts/test-rls.js cobra cada uma
-- pelo nome.
alter table if exists stock_counts enable row level security;
alter table if exists stock_count_items enable row level security;
