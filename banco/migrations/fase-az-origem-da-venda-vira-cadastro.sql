-- ============================================================================
-- FASE AZ — Origem da venda vira cadastro próprio
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- A lista de origens era uma constante dentro do public/app.js:
--
--   const ORIGENS_VENDA = ['Venda Direta', 'Televendas', 'E-commerce',
--                          'Marketplace', 'Representante', 'Balcão'];
--
-- Seis nomes escolhidos por quem escreveu o arquivo, sem tela para mexer. Uma
-- loja que vende por WhatsApp, por indicação ou numa feira não tem onde
-- registrar isso: escolhe "Venda Direta" para tudo, e a pergunta que a origem
-- existe para responder — DE ONDE VÊM AS MINHAS VENDAS — passa a ter uma
-- resposta só, que é sempre a mesma e não significa nada.
--
-- Não é o mesmo problema da fase AS. Lá o campo Categoria apontava para o
-- cadastro ERRADO (as categorias de produto); aqui ele não aponta para cadastro
-- nenhum. As duas correções chegam ao mesmo lugar: uma classificação de venda,
-- com tela, que quem usa o sistema controla.
--
-- POR QUE ORIGEM E CATEGORIA SÃO DUAS COISAS
-- -------------------------------------------
-- Categoria diz O QUE É a venda: varejo, atacado, bonificação, garantia.
-- Origem diz POR ONDE ela chegou: balcão, televendas, e-commerce, indicação.
--
-- A mesma venda tem as duas ao mesmo tempo — um atacado que entrou por
-- televendas. Guardar num campo só obriga a escolher qual das duas perguntas
-- vale a pena responder, e o relatório perde a outra para sempre.
--
-- POR QUE `sale_origin` CONTINUA GUARDANDO O NOME
-- ------------------------------------------------
-- Mesma razão da fase AS, e o mesmo preço: renomear uma origem NÃO renomeia nos
-- pedidos antigos. A coluna já guarda texto em 13 registros, o filtro da lista
-- de vendas compara texto, e trocar para id seria reescrever histórico e filtro
-- numa fase que era para criar uma tela.
--
-- A SEMEADURA COPIA AS SEIS E O QUE OS REGISTROS USAM
-- ----------------------------------------------------
-- Aqui, ao contrário da fase AS, a lista velha É o catálogo atual: as seis
-- opções são as únicas que qualquer pedido pôde escolher até hoje. Não copiá-las
-- deixaria o campo vazio na próxima venda.
--
-- E os registros gravados entram junto pelo mesmo motivo de sempre: um pedido
-- com origem fora da lista abriria com o campo em branco, e quem edita veria
-- vazio e acharia que se perdeu.

create table if not exists sales_origins (
  id            text primary key,
  name          text not null,
  code          text not null default '',
  -- 'ativo' | 'inativo'. Inativa some do formulário e continua no histórico —
  -- excluir uma origem em uso deixaria pedidos apontando para um nome que
  -- ninguém mais sabe de onde veio.
  status        text not null default 'ativo',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- "Balcão" e "balcão" são a mesma origem. O índice é sobre lower(name) porque
-- comparar no aplicativo deixaria passar as duas quando gravadas ao mesmo
-- tempo — duas requisições leem "não existe" e as duas gravam.
create unique index if not exists idx_sales_origins_nome
  on sales_origins (lower(name));

create index if not exists idx_sales_origins_status on sales_origins (status);

-- ----------------------------------------------------------------------------
-- Semeadura 1: as seis que estavam no código
-- ----------------------------------------------------------------------------
-- `on conflict do nothing` contra o índice de nome: rodar duas vezes não
-- duplica nem falha.
insert into sales_origins (id, name, notes)
values
  ('orig-venda-direta',  'Venda Direta',  'Veio da lista fixa do sistema (fase AZ).'),
  ('orig-televendas',    'Televendas',    'Veio da lista fixa do sistema (fase AZ).'),
  ('orig-ecommerce',     'E-commerce',    'Veio da lista fixa do sistema (fase AZ).'),
  ('orig-marketplace',   'Marketplace',   'Veio da lista fixa do sistema (fase AZ).'),
  ('orig-representante', 'Representante', 'Veio da lista fixa do sistema (fase AZ).'),
  ('orig-balcao',        'Balcão',        'Veio da lista fixa do sistema (fase AZ).')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Semeadura 2: o que pedidos e orçamentos realmente usam
-- ----------------------------------------------------------------------------
-- Hoje isso é só "Venda Direta", que a semeadura 1 já criou. A consulta existe
-- para o banco de quem já tem histórico com origem digitada fora da lista —
-- importação por CSV, por exemplo, que nunca passou pelo <select>.
--
-- O distinct é sobre o nome em minúsculas para que "Balcão" e "balcão", se
-- existirem os dois, virem UM.
insert into sales_origins (id, name, notes)
select
  'orig-' || md5(lower(trim(o.sale_origin))),
  min(trim(o.sale_origin)),
  'Criada a partir dos registros que já usavam este nome (fase AZ).'
from (
  select sale_origin from orders
  union all
  select sale_origin from quotes
) o
where coalesce(trim(o.sale_origin), '') <> ''
group by lower(trim(o.sale_origin))
on conflict do nothing;

-- RLS: ver o cabeçalho da fase-af.
alter table if exists sales_origins enable row level security;
