#!/usr/bin/env node
// Gera supabase/migrations/fase-aj-transicoes-de-status.sql A PARTIR de
// TRANSICOES em public/modules/shared/sales_status.js.
//
// A lista de transicoes nao e redigitada em lugar nenhum: mudou no modulo,
// roda-se este script e o SQL sai igual. scripts/test-transicoes-status.js
// confere par a par que o arquivo no disco corresponde ao modulo -- se
// alguem editar o SQL a mao, ou mudar o modulo e esquecer de regerar, a
// suite acusa.
//
//   node scripts/gerar-transicoes-sql.js
const fs = require('fs');
const S = require('../public/modules/shared/sales_status');

const pares = [];
Object.entries(S.TRANSICOES).forEach(([de, destinos]) => destinos.forEach((para) => pares.push([de, para])));
const valores = pares.map(([a, b]) => `  ('${a}', '${b}')`).join(',\n');
const legados = Object.entries(S.LEGADOS).map(([de, para]) => `    when '${de}' then '${para}'`).join('\n');

// $$ montado por código: escrito literalmente, o shell que chama este script
// tenta expandir.
const D2 = '$' + '$';

const sql = `-- ---------------------------------------------------------------------------
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
create or replace function sales_status_normalizar(bruto text)
returns text
language sql
immutable
security definer
set search_path = public
as ${D2}
  select case lower(trim(coalesce(bruto, '')))
${legados}
    else lower(trim(coalesce(bruto, '')))
  end;
${D2};

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
${valores};

create or replace function sales_status_transicao_valida(de text, para text)
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
as ${D2}
  select
    -- Ficar no MESMO status nao e transicao: salvar um pedido sem mexer no
    -- status e a operacao mais comum da tela.
    sales_status_normalizar(de) = sales_status_normalizar(para)
    or exists (
      select 1 from sales_status_transicao t
      where t.de = sales_status_normalizar(de)
        and t.para = sales_status_normalizar(para)
    );
${D2};

create or replace function sales_status_guarda()
returns trigger
language plpgsql
security definer
set search_path = public
as ${D2}
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
${D2};

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
`;

const path = require('path');
fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'migrations', 'fase-aj-transicoes-de-status.sql'), sql);
console.log(`migracao gerada com ${pares.length} pares e ${Object.keys(S.LEGADOS).length} legados`);
