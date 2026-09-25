-- ---------------------------------------------------------------------------
-- Fase DC — meta de venda, por loja e por vendedor
--
-- O QUE FALTAVA, e estava escrito
-- -------------------------------
-- O cabeçalho de lib/kpis.js registrava a ausência com todas as letras: "O
-- mockup previa '85% da meta'. Não há cadastro de meta em lugar nenhum...
-- cartão com número derivado de nada é pior do que cartão sem número, porque
-- parece confiável."
--
-- A barra do cartão (`faixa`) já existia e media outra coisa — proporção
-- vencida, no caso de contas a receber. O desenho estava pronto esperando o
-- alvo; era só o alvo que não existia.
--
-- POR QUE OS DOIS ESCOPOS, E NÃO UM
-- ---------------------------------
-- São duas perguntas diferentes e as duas se cobram:
--
--   empresa  — "a Filial 08 vende R$ 400 mil em setembro?"
--   vendedor — "o MISAEL faz os R$ 60 mil dele?"
--
-- Uma tabela com `escopo` em vez de duas tabelas porque a conta é a MESMA
-- (rateio por dias corridos, ver lib/metas.js) e o consumo é o mesmo: quem abre
-- o Início recebe a meta do seu escopo de vendas. Duas tabelas dariam duas
-- migrações, duas rotas e dois rateios — e o segundo rateio divergiria do
-- primeiro na primeira correção feita só num deles.
--
-- NÃO SE SOMAM OS DOIS ESCOPOS. A meta da loja já contém as metas dos
-- vendedores dela; somar as duas pediria o dobro. Quem escolhe qual usar é a
-- rota, pelo escopo de vendas do usuário (lib/relatorios-escopo.js): quem vê
-- todas as vendas compara com a meta das EMPRESAS; quem vê só as próprias
-- compara com a meta DELE. Assim o valor do cartão e o alvo dele medem sempre o
-- mesmo universo.
--
-- SEM CHAVE ESTRANGEIRA, e é a mesma razão da fase AW
-- ---------------------------------------------------
-- `referencia_id` aponta para dois lugares diferentes conforme o escopo:
--
--   escopo 'empresa'  -> uma empresa de data/db.json, que é o que
--                        `orders.company_id` já usa. `companies` NÃO É UMA
--                        TABELA: as empresas que Vendas usa vivem no arquivo
--                        local, e as do Fiscal vivem em `empresa`/
--                        `estabelecimento`. São dois cadastros da mesma coisa
--                        do mundo, e este vínculo aponta para o primeiro
--                        porque é o que o pedido aponta.
--
--   escopo 'vendedor' -> uma PESSOA com o papel "Vendedor" (people.id), que é
--                        o que `orders.seller_id` guarda. Vendedor não é
--                        usuário: quem faz login é `users`, e a ponte é
--                        `users.seller_id` (fase AL).
--
-- Chave estrangeira polimórfica não existe em SQL, e mesmo que existisse, meta
-- é histórico: excluir um vendedor não pode apagar a meta que ele tinha em
-- março. Mesma decisão das fases AP, AQ, AR e AW.
--
-- A COMPETÊNCIA É O PRIMEIRO DIA DO MÊS
-- -------------------------------------
-- `date` normalizado no dia 1, e um CHECK que obriga isso. As alternativas eram
-- duas colunas (ano int, mes int) ou um texto 'YYYY-MM'. Com `date` o rateio
-- compara e ordena sem converter nada, e o CHECK impede a linha
-- '2026-09-15' que faria dois registros para o mesmo mês passarem pela
-- unicidade.
-- ---------------------------------------------------------------------------

create table if not exists metas_de_venda (
  id text primary key,
  escopo text not null check (escopo in ('empresa', 'vendedor')),
  -- Empresa do db.json ou pessoa com papel Vendedor, conforme o escopo. Vazio
  -- não é meta de ninguém: seria um alvo órfão somando no total.
  referencia_id text not null check (btrim(referencia_id) <> ''),
  competencia date not null check (extract(day from competencia) = 1),
  -- ZERO É VÁLIDO e tem significado: "esta loja não tem meta este mês" dito
  -- explicitamente é diferente de não ter linha. Negativo não existe.
  valor numeric(14,2) not null default 0 check (valor >= 0),
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- UMA meta por escopo, referência e mês. Sem isto, salvar duas vezes criaria
-- dois alvos e o rateio somaria os dois — a loja apareceria com o dobro da meta
-- e ninguém entenderia por quê.
create unique index if not exists idx_metas_unica
  on metas_de_venda (escopo, referencia_id, competencia);

-- A pergunta que o Início faz a cada carregamento: "quais metas tocam este
-- período?". Sempre por competência, e quase sempre por escopo junto.
create index if not exists idx_metas_competencia
  on metas_de_venda (escopo, competencia);

alter table metas_de_venda enable row level security;

comment on table metas_de_venda is
  'Fase DC — alvo de faturamento por loja (escopo empresa) e por vendedor, '
  'mensal. Rateado por dias corridos para qualquer recorte em lib/metas.js.';
comment on column metas_de_venda.referencia_id is
  'Empresa do db.json (mesma referência de orders.company_id) quando escopo = '
  'empresa; people.id com papel Vendedor (mesma de orders.seller_id) quando '
  'escopo = vendedor. Sem FK: referência polimórfica, e meta é histórico.';
