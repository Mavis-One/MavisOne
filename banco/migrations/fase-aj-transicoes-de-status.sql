-- ---------------------------------------------------------------------------
-- Fase AJ — transicoes validas de status, no BANCO
--
-- Ate aqui qualquer status virava qualquer outro: bastava um UPDATE com o
-- campo preenchido. Um pedido faturado voltava a "Orcamento" sem estornar
-- nada, e o estoque baixado e o contas a receber criado ficavam la, agora sem
-- nenhum documento que os explicasse.
--
-- A tela ja escondia o caminho e o servidor passou a recusar. Isto aqui e a
-- terceira porta -- a que continua fechada quando alguem escreve direto no
-- banco: um script de correcao, um UPDATE no SQL Editor, uma integracao
-- futura. Regra que so existe no aplicativo vale ate a primeira vez que
-- alguem nao passa por ele.
--
-- A LISTA E A MESMA de public/modules/shared/sales_status.js (TRANSICOES).
-- Nao foi redigitada: foi gerada dali, e scripts/test-transicoes-status.js
-- compara par a par os dois lados a cada rodada da suite. Duas listas
-- escritas a mao divergem -- e divergencia aqui significa a tela permitindo o
-- que o banco recusa, ou pior, o contrario.
--
-- O QUE NAO ESTA AQUI, DE PROPOSITO:
--
--   Nao ha "create type ... as enum". O briefing pedia, mas a coluna e text e
--   ja tem valor legado gravado ('faturado', 'pendente', 'em aberto'),
--   traduzido na leitura. Trocar o tipo obrigaria a reescrever TODA linha
--   existente antes -- e migracao que reescreve dado historico e o oposto de
--   aditiva. A funcao abaixo normaliza o legado antes de comparar, entao
--   pedido antigo continua podendo ser cancelado.
--
--   O catalogo do sistema tambem e MAIOR que os seis status do briefing: tem
--   pre-faturado, parcialmente faturado e aprovado sem faturamento, os tres em
--   uso. Reduzir ao conjunto do briefing apagaria estados que existem.
-- ---------------------------------------------------------------------------

-- Traduz o status gravado para o vocabulario atual. Mesmo mapa do modulo
-- compartilhado: sem isto, um pedido gravado como 'faturado' nao teria linha
-- na tabela de transicoes e ficaria impossivel de cancelar.
-- DROP antes de criar: a primeira versao desta migracao nomeou os parametros
-- "de"/"para", e "create or replace" recusa trocar nome de parametro
-- ("cannot change name of input parameter"). Sem o drop, quem ja rodou a
-- versao anterior nao consegue aplicar a correcao.
drop function if exists sales_status_normalizar(text);
create or replace function sales_status_normalizar(p_bruto text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case lower(trim(coalesce(p_bruto, '')))
    when 'pendente' then 'pedido'
    when 'faturado' then 'pedido-faturado'
    when 'cancelado' then 'pedido-cancelado'
    when 'em aberto' then 'orcamento'
    when 'aprovado' then 'orcamento-aprovado'
    when 'reprovado' then 'orcamento-reprovado'
    else lower(trim(coalesce(p_bruto, '')))
  end;
$$;

-- Os pares validos numa TABELA, e nao num case gigante: da para consultar
-- ("de onde da para sair daqui?") e a geracao a partir do JS fica literal.
create table if not exists sales_status_transicao (
  de text not null,
  para text not null,
  primary key (de, para)
);

-- Fecha a porta publica do PostgREST, como as outras 77 tabelas (fase AF).
-- RLS ligada e SEM politica: anon e authenticated nao leem nem escrevem. Quem
-- precisa ler e a funcao acima, e ela le como dona.
alter table sales_status_transicao enable row level security;

-- Recriada inteira a cada execucao: e tabela de REGRA, nao de dado. Assim a
-- migracao pode rodar de novo depois de a lista mudar, sem duplicar nem deixar
-- par velho para tras.
delete from sales_status_transicao;
insert into sales_status_transicao (de, para) values
  ('orcamento', 'pedido'),
  ('orcamento', 'orcamento-aprovado'),
  ('orcamento', 'orcamento-reprovado'),
  ('orcamento-aprovado', 'pedido'),
  ('orcamento-aprovado', 'orcamento-reprovado'),
  ('pedido', 'pedido-nao-faturado'),
  ('pedido', 'pedido-pre-faturado'),
  ('pedido', 'pedido-faturado'),
  ('pedido', 'pedido-aprovado-sem-faturamento'),
  ('pedido', 'pedido-parcialmente-faturado'),
  ('pedido', 'pedido-cancelado'),
  ('pedido-nao-faturado', 'pedido'),
  ('pedido-nao-faturado', 'pedido-pre-faturado'),
  ('pedido-nao-faturado', 'pedido-faturado'),
  ('pedido-nao-faturado', 'pedido-aprovado-sem-faturamento'),
  ('pedido-nao-faturado', 'pedido-cancelado'),
  ('pedido-pre-faturado', 'pedido-faturado'),
  ('pedido-pre-faturado', 'pedido-parcialmente-faturado'),
  ('pedido-pre-faturado', 'pedido-nao-faturado'),
  ('pedido-pre-faturado', 'pedido-cancelado'),
  ('pedido-parcialmente-faturado', 'pedido-faturado'),
  ('pedido-parcialmente-faturado', 'pedido-cancelado'),
  ('pedido-faturado', 'pedido-cancelado'),
  ('pedido-aprovado-sem-faturamento', 'pedido-cancelado');

drop function if exists sales_status_transicao_valida(text, text);
create or replace function sales_status_transicao_valida(p_de text, p_para text)
returns boolean
language sql
stable
-- SECURITY DEFINER porque a tabela de regras fica com RLS ligada e sem
-- politica: um usuario "authenticated" que atualizasse o pedido leria ZERO
-- linhas de transicao e TODA mudanca de status seria recusada. Definer faz a
-- funcao ler as regras como dona da tabela, sem abrir a tabela para ninguem.
-- search_path fixo porque SECURITY DEFINER sem ele e o caminho classico de
-- sequestro: quem controlasse o search_path apontaria "sales_status_transicao"
-- para uma tabela propria.
security definer
set search_path = public
as $$
  -- OS PARAMETROS SE CHAMAM p_de/p_para, e nao de/para, porque a TABELA tem
  -- colunas com esses nomes. Dentro do subselect o Postgres resolve um nome
  -- solto como COLUNA, nao como parametro: escrito "sales_status_normalizar(de)",
  -- vira sales_status_normalizar(t.de), a comparacao fica t.de = t.de e o
  -- exists() da verdadeiro para QUALQUER par. Medido em 24/08/2026 contra o
  -- banco: ate "xxx -> yyy" respondia true. A guarda existia e nao guardava
  -- nada -- pior do que nao existir, porque parecia estar la.
  select
    -- Ficar no MESMO status nao e transicao: salvar um pedido sem mexer no
    -- status e a operacao mais comum da tela.
    sales_status_normalizar(p_de) = sales_status_normalizar(p_para)
    or exists (
      select 1 from sales_status_transicao t
      where t.de = sales_status_normalizar(p_de)
        and t.para = sales_status_normalizar(p_para)
    );
$$;

create or replace function sales_status_guarda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Linha nova entra com o status que quiser: ela nao vem de lugar nenhum.
  if tg_op = 'INSERT' then
    return new;
  end if;
  -- Status inalterado nao passa pela regra. Sem esta saida, TODO update de
  -- qualquer campo do pedido pagaria a consulta.
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not sales_status_transicao_valida(old.status, new.status) then
    raise exception 'Transicao de status invalida: % nao vira %.', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_guarda on orders;
create trigger orders_status_guarda
  before update on orders
  for each row execute function sales_status_guarda();

drop trigger if exists quotes_status_guarda on quotes;
create trigger quotes_status_guarda
  before update on quotes
  for each row execute function sales_status_guarda();

comment on table sales_status_transicao is
  'Transicoes validas de status de pedido/orcamento. Gerada de TRANSICOES em public/modules/shared/sales_status.js; scripts/test-transicoes-status.js confere que as duas nao divergiram.';
