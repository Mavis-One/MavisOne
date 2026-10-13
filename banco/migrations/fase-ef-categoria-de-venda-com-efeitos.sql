-- ============================================================================
-- FASE EF — A CATEGORIA DE VENDA DIZ O QUE FAZ (ESTOQUE, FINANCEIRO, FISCAL)
-- ============================================================================
--
-- Pedido do usuário (13/10/2026): a categoria de venda (ex.: "Transferência")
-- diz se altera o estoque, se gera financeiro, qual a utilidade dela, e se liga
-- aos outros módulos. Decisões dele: as quatro ligações (pedido, relatórios,
-- fiscal, financeiro) e as categorias que já existiam começam como VENDA,
-- alterando estoque e gerando financeiro — os defaults abaixo fazem isso, e o
-- comportamento de hoje não muda até alguém editar uma categoria.
--
-- Quem lê: public/modules/shared/categoria_venda.js (a regra) e os pontos que
-- a usam — efeitos do pedido (server.js), relatórios (lib/relatorios/comum.js,
-- lib/filial-da-venda.js), NF-e a partir do pedido e contas a receber.
-- ============================================================================

alter table if exists sales_categories
  add column if not exists finalidade text not null default 'venda'
    check (finalidade in ('venda', 'transferencia', 'remessa', 'bonificacao', 'garantia', 'demonstracao', 'devolucao', 'outros')),
  add column if not exists altera_estoque boolean not null default true,
  add column if not exists gera_financeiro boolean not null default true,
  -- A operação fiscal da NF-e gerada pelo pedido (lib/operacaoFiscal.js).
  -- Escolhida pelo usuário; vazia = a tela de emissão abre em Venda, como hoje.
  add column if not exists operacao_fiscal text
    check (operacao_fiscal is null or operacao_fiscal in ('VENDA', 'TRANSFERENCIA', 'REMESSA', 'RETORNO', 'DEVOLUCAO', 'BONIFICACAO')),
  -- A categoria financeira (plano de contas) das contas a receber do pedido.
  add column if not exists financial_category_id text;
