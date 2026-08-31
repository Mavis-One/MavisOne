-- ---------------------------------------------------------------------------
-- Fase AB — NF-e Complementar exclusiva de ICMS
--
-- O CENÁRIO
-- ---------
-- Uma nota saiu com ICMS a menor. O complemento não corresponde a mercadoria
-- nenhuma: não há o que entregar, nem o que dar baixa, nem o que receber. O
-- que existe é imposto a destacar.
--
-- A GAMBIARRA QUE ISTO EVITA
-- --------------------------
-- Lançar o complemento como venda de 1 unidade a R$ 0,01 para "caber" na
-- estrutura de item. Isso movimenta estoque de um produto que não saiu, gera
-- recebível de um centavo que ninguém vai cobrar, e suja o custo médio.
-- A SEF/SC prevê o caminho certo: item ESCRITURAL, com CFOP 5.949 e código de
-- produto próprio, quantidade e valor zerados, e o ICMS destacado sozinho.
--
-- O QUE ESTE ARQUIVO NÃO FAZ
-- --------------------------
-- A especificação pedia ALTER TABLE em `nfe_itens`. Essa tabela NÃO existe
-- neste sistema: os itens da NF-e vivem dentro de `nfe.payload_enviado`
-- (jsonb), que é a cópia fiel do que foi transmitido à SEFAZ. Criar uma tabela
-- de itens só para carregar duas flags duplicaria a fonte da verdade do
-- documento fiscal — e as duas cópias divergiriam. As flags de item viajam no
-- próprio payload.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ======================= TIPO DE OPERAÇÃO NA REGRA FISCAL ===================
-- O CHECK existente não conhece COMPLEMENTO_ICMS, então nenhuma regra fiscal
-- poderia ser cadastrada para a operação — e sem regra, a emissão para em
-- "Nenhuma regra fiscal encontrada".
--
-- Recriado em vez de alterado: Postgres não tem ALTER CONSTRAINT para CHECK.
alter table regra_fiscal drop constraint if exists regra_fiscal_tipo_operacao_check;
alter table regra_fiscal add constraint regra_fiscal_tipo_operacao_check
  check (tipo_operacao in ('VENDA','TRANSFERENCIA','REMESSA','RETORNO',
                            'DEVOLUCAO','BONIFICACAO','ENTRADA_IMPORTACAO',
                            'COMPLEMENTO_ICMS'));

-- ============================ PRODUTO ESCRITURAL ============================
-- Escritural = existe para gerar o item fiscal, não para ser vendido. Sem esta
-- marca o produto apareceria nas listas de mercadoria, entraria em pedido e
-- teria saldo de estoque cobrado.
alter table products add column if not exists tipo_produto_fiscal text
  default 'NORMAL';

-- Constraint separada do ADD COLUMN: rodar duas vezes um `add column ... check`
-- estoura por constraint duplicada.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_tipo_produto_fiscal_check'
  ) then
    alter table products add constraint products_tipo_produto_fiscal_check
      check (tipo_produto_fiscal in ('NORMAL', 'ESCRITURAL'));
  end if;
end $$;

-- Independentes de propósito: existe produto que movimenta estoque e não gera
-- financeiro (brinde), e o contrário (serviço faturado). Uma flag só não
-- conseguiria representar os dois.
alter table products add column if not exists movimenta_estoque boolean not null default true;
alter table products add column if not exists gera_financeiro boolean not null default true;

comment on column products.tipo_produto_fiscal is
  'NORMAL = mercadoria. ESCRITURAL = item que só existe para compor documento fiscal (ex.: complemento de ICMS). Escritural nunca entra em lista de mercadoria.';

-- Produto escritural padrão do complemento de ICMS (SEF/SC).
-- NCM 00000000 é o genérico para item sem mercadoria específica; o CFOP NÃO
-- fica gravado aqui — quem decide entre 5.949 (interno) e 6.949
-- (interestadual) é a regra fiscal, pela UF de destino.
insert into products (id, name, sku, stock_quantity, cost_price, sale_price,
                      ncm, unidade_comercial, unidade_tributavel, origem,
                      tipo_produto_fiscal, movimenta_estoque, gera_financeiro)
values ('prod_escritural_complemento_icms',
        'COMPLEMENTO DE ICMS - NF-E COMPLEMENTAR',
        'CFOP5.949', 0, 0, 0,
        '00000000', 'UN', 'UN', 0,
        'ESCRITURAL', false, false)
on conflict (id) do update set
  name = excluded.name,
  sku = excluded.sku,
  tipo_produto_fiscal = excluded.tipo_produto_fiscal,
  movimenta_estoque = excluded.movimenta_estoque,
  gera_financeiro = excluded.gera_financeiro;

-- ========================= DOCUMENTO COMPLEMENTAR ===========================
-- `finalidade_emissao` já existe em `nfe` desde a criação da tabela, com CHECK
-- (1,2,3,4) — o valor 2 (complementar) já era aceito. O que faltava era saber
-- QUAL complemento é, e a qual nota se refere.
alter table nfe add column if not exists tipo_operacao_fiscal text;
alter table nfe add column if not exists valor_icms_complementar numeric(15,2) not null default 0;
alter table nfe add column if not exists nfe_original_chave char(44);

comment on column nfe.tipo_operacao_fiscal is
  'Operação que originou a nota (VENDA, COMPLEMENTO_ICMS, ...). É ela que decide se houve movimentação de estoque e financeiro.';
comment on column nfe.valor_icms_complementar is
  'ICMS destacado numa nota complementar. NÃO é valor de venda: não vira recebível nem entra no faturamento.';
comment on column nfe.nfe_original_chave is
  'Chave da NF-e complementada. Obrigatória quando finalidade_emissao = 2.';

-- Regra de integridade no BANCO, não só na aplicação: uma nota complementar
-- sem a chave da original é recusada pela SEFAZ, e gravá-la deixaria um
-- rascunho impossível de transmitir sem ninguém saber por quê.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'nfe_complementar_exige_original'
  ) then
    alter table nfe add constraint nfe_complementar_exige_original
      check (finalidade_emissao <> 2 or nfe_original_chave is not null);
  end if;
end $$;

-- "Quais notas complementam esta?" — pergunta da conferência fiscal.
create index if not exists idx_nfe_original_chave on nfe (nfe_original_chave)
  where nfe_original_chave is not null;
