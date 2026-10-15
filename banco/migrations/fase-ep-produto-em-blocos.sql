-- ============================================================================
-- FASE EP — O CADASTRO DE PRODUTO EM BLOCOS
-- ============================================================================
--
-- Pedido do usuário (15/10/2026), com o print do cadastro de outro sistema:
-- a tela de produto numa página só, em blocos, com os campos que faltavam.
-- Escolhidos por ele, entre os que não existiam:
--   - código do fabricante (o código do item no catálogo de quem fabrica; não
--     é o CNPJ do fabricante da fase CS, que é dado fiscal da escala);
--   - preço a prazo e preço mínimo (vazio = não definido; não é zero);
--   - pode vender (desligado, o produto sai da busca da venda) e
--     matéria-prima (o tipo do item no SPED passa a 01).
--
-- "Serviço" e "Controla estoque" do print já existiam: são movimenta_estoque.
-- "Vender sem estoque" NÃO entra: desde 13/10/2026 nenhum produto fatura sem
-- saldo (pedido do usuário).
--
-- Colunas comerciais, e não fiscais: não entram em produto_fiscal (o histórico
-- da fase DJ é do que vai na nota).
-- ============================================================================

alter table products
  add column if not exists codigo_fabricante text,
  add column if not exists preco_prazo numeric,
  add column if not exists preco_minimo numeric,
  add column if not exists pode_vender boolean not null default true,
  add column if not exists materia_prima boolean not null default false;

comment on column products.codigo_fabricante is
  'Código do item no catálogo do fabricante (C.Fabricante). Entra na busca de produtos.';
comment on column products.preco_prazo is
  'Preço a prazo. Nulo = não definido (vale o preço à vista).';
comment on column products.preco_minimo is
  'Preço mínimo de venda. Nulo = não definido.';
comment on column products.pode_vender is
  'Desligado, o produto sai da busca da venda (continua no estoque, compras e notas).';
comment on column products.materia_prima is
  'Matéria-prima: o TIPO_ITEM do registro 0200 do SPED passa a 01.';
