-- ============================================================================
-- RECRIAR O BANCO DO ZERO — arquivo GERADO. Não edite aqui.
--
--   Gerado por: node scripts/gerar-sql-do-zero.js
--   Fonte:      supabase/schema.sql + supabase/migrations/*.sql
--
-- COMO USAR
--   1. crie o projeto no Supabase e abra o SQL Editor;
--   2. cole este arquivo INTEIRO e rode;
--   3. confira com: npm run migracoes  (com o .env já apontando para o novo).
--
-- A ORDEM DESTE ARQUIVO NÃO É A ORDEM ALFABÉTICA DA PASTA, e isso é o ponto:
-- 'fase-aa' vem antes de 'fase-h' em qualquer listagem, e rodar nessa ordem
-- tenta alterar tabela que ainda não existe. Aqui as fases estão na ordem em
-- que foram escritas — uma letra antes de duas, alfabética dentro do mesmo
-- tamanho.
--
-- Rodar de novo no mesmo banco é seguro: tudo usa "if not exists" e
-- "on conflict do nothing".
--
-- ATENÇÃO À SENHA SEMENTE: o schema cria o usuário 'admin' com um hash que
-- está versionado neste repositório — ou seja, público para quem tem acesso ao
-- código. Troque a senha no primeiro acesso ao banco novo, antes de cadastrar
-- qualquer coisa de verdade.
--
-- Arquivos incluídos, nesta ordem:
--   supabase/schema.sql
--   01. supabase/migrations/fase-h-campos-financeiros.sql
--   02. supabase/migrations/fase-i-informacoes-gerais.sql
--   03. supabase/migrations/fase-j-cabecalho-dados.sql
--   04. supabase/migrations/fase-k-abas-pagamento-entrega.sql
--   05. supabase/migrations/fase-l-controle-de-acesso.sql
--   06. supabase/migrations/fase-m-financeiro-no-supabase.sql
--   07. supabase/migrations/fase-n-nfe-no-supabase.sql
--   08. supabase/migrations/fase-o-pedido-gera-financeiro.sql
--   09. supabase/migrations/fase-p-vinculo-pedido-nfe.sql
--   10. supabase/migrations/fase-q-tabelas-fiscais.sql
--   11. supabase/migrations/fase-r-modulos-novos.sql
--   12. supabase/migrations/fase-s-permissoes-modulos-novos.sql
--   13. supabase/migrations/fase-t-permissoes-fiscais-gerente.sql
--   14. supabase/migrations/fase-u-rh-organizacional.sql
--   15. supabase/migrations/fase-v-difal-e-pagamento.sql
--   16. supabase/migrations/fase-w-pcp-chao-de-fabrica.sql
--   17. supabase/migrations/fase-x-tipos-de-contrato.sql
--   18. supabase/migrations/fase-y-cst-faltantes.sql
--   19. supabase/migrations/fase-z-ibs-cbs.sql
--   20. supabase/migrations/fase-aa-nfe-lista-unificada.sql
--   21. supabase/migrations/fase-ab-nfe-complementar-icms.sql
--   22. supabase/migrations/fase-ac-classes-de-produto.sql
--   23. supabase/migrations/fase-ad-ibs-cbs-uf-municipio.sql
--   24. supabase/migrations/fase-ae-financeiro-por-cfop-e-beneficio.sql
--   25. supabase/migrations/fase-af-rls-fechar-porta-publica.sql
--   26. supabase/migrations/fase-ag-preferencias-do-usuario.sql
--   27. supabase/migrations/fase-ah-grupos-de-produtos.sql
--   28. supabase/migrations/fase-ai-anexos-do-pedido.sql
--   29. supabase/migrations/fase-aj-transicoes-de-status.sql
--   30. supabase/migrations/fase-ak-entrada-de-nfe.sql
--   31. supabase/migrations/fase-al-usuario-vendedor.sql
-- ============================================================================


-- ============================================================================
-- >>> supabase/schema.sql
-- ============================================================================

-- ============================================================================
-- MavisONE ERP — Schema Supabase (Postgres)
-- Fase A da migração para Supabase.
--
-- Como usar: cole este arquivo inteiro no SQL Editor do Supabase e rode.
-- É seguro rodar mais de uma vez (todo "create" usa "if not exists" e os
-- inserts de dados semente usam "on conflict ... do nothing").
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Sequence do código sequencial de Cadastros (compartilhada entre Pessoas e
-- CNPJs, substitui o contador "nextCadastroCode" do data/db.json — que tinha
-- uma condição de corrida real quando dois cadastros eram salvos ao mesmo
-- tempo. Sequence do Postgres é atômica, corrige isso de graça).
-- ----------------------------------------------------------------------------
create sequence if not exists cadastro_code_seq start 1;

-- Função auxiliar: próximo código de cadastro, já formatado (mesma regra de
-- formatCadastroCode() em server.js: zero-padded com no mínimo 2 dígitos).
create or replace function next_cadastro_code()
returns text
language sql
as $$
  select lpad(nextval('cadastro_code_seq')::text, 2, '0');
$$;

-- ----------------------------------------------------------------------------
-- Usuários (autenticação e permissões por módulo)
-- ----------------------------------------------------------------------------
create table if not exists users (
  id text primary key,
  username text not null unique,
  password_hash text not null,
  name text not null,
  role text not null default 'user',
  allowed_modules text[] not null default '{}',
  theme text not null default 'light',
  dashboard_pins jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists users
  add column if not exists dashboard_pins jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- Configurações da empresa — linha única (id sempre 1)
-- ----------------------------------------------------------------------------
create table if not exists settings (
  id integer primary key default 1,
  company_name text not null default 'MavisONE',
  currency text not null default 'BRL',
  tax_rate numeric not null default 0,
  constraint settings_singleton check (id = 1)
);

-- ----------------------------------------------------------------------------
-- Estoque
-- ----------------------------------------------------------------------------
create table if not exists products (
  id text primary key,
  name text not null,
  sku text,
  stock_quantity numeric not null default 0,
  cost_price numeric not null default 0,
  sale_price numeric not null default 0,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Vendas / Compras (fluxo simples já existente no app)
-- ----------------------------------------------------------------------------
create table if not exists sales (
  id text primary key,
  date date not null,
  customer text not null,
  product_id text references products(id),
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'faturado',
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id text primary key,
  date date not null,
  supplier text not null,
  product_id text references products(id),
  quantity numeric not null default 0,
  cost_price numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'pendente',
  created_at timestamptz not null default now()
);

-- O `status` é text sem CHECK de propósito: o catálogo de status vive em
-- public/modules/shared/sales_status.js (fonte única, lida pela tela E pelo
-- server.js) e status novo não pode depender de migração de banco. Os valores
-- antigos ('pendente', 'faturado', 'em aberto', 'aprovado', 'reprovado') ainda
-- gravados continuam sendo traduzidos na leitura pelo catálogo — nenhuma
-- linha precisa ser alterada.
create table if not exists orders (
  id text primary key,
  type text not null default 'order',
  customer text not null,
  date date not null,
  amount numeric not null default 0,
  status text not null default 'pedido',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists quotes (
  id text primary key,
  type text not null default 'quote',
  customer text not null,
  date date not null,
  amount numeric not null default 0,
  status text not null default 'orcamento',
  note text,
  created_at timestamptz not null default now()
);

-- Fase F — orders/quotes (Fase A) só tinham o modelo antigo de item único
-- (customer/amount). O formulário real de Vendas (Novo Pedido/Orçamento) usa
-- múltiplos itens, cliente/empresa/vendedor/depósito vinculados a cadastro,
-- desconto e frete — nenhuma dessas colunas existia. "customer"/"amount"
-- continuam sendo escritas (mapeadas de clientSupplierName/totalAmount) só
-- pra não quebrar a constraint not null antiga; quem lê de verdade é
-- client_supplier_name/total_amount daqui pra frente.
alter table if exists orders add column if not exists code integer;
alter table if exists orders add column if not exists client_supplier_id text;
alter table if exists orders add column if not exists client_supplier_name text;
alter table if exists orders add column if not exists company_id text;
alter table if exists orders add column if not exists seller_id text;
alter table if exists orders add column if not exists deposit_id text;
alter table if exists orders add column if not exists due_date date;
alter table if exists orders add column if not exists items jsonb not null default '[]'::jsonb;
alter table if exists orders add column if not exists discount_amount numeric not null default 0;
alter table if exists orders add column if not exists discount_percent numeric not null default 0;
alter table if exists orders add column if not exists freight numeric not null default 0;
alter table if exists orders add column if not exists items_total numeric not null default 0;
alter table if exists orders add column if not exists total_amount numeric not null default 0;
alter table if exists orders add column if not exists stock_applied boolean not null default false;
alter table if exists orders add column if not exists created_by text;
alter table if exists orders add column if not exists created_by_name text;
alter table if exists orders add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_orders_code on orders (code);
create index if not exists idx_orders_client_supplier on orders (client_supplier_id);

alter table if exists quotes add column if not exists code integer;
alter table if exists quotes add column if not exists client_supplier_id text;
alter table if exists quotes add column if not exists client_supplier_name text;
alter table if exists quotes add column if not exists company_id text;
alter table if exists quotes add column if not exists seller_id text;
alter table if exists quotes add column if not exists deposit_id text;
alter table if exists quotes add column if not exists due_date date;
alter table if exists quotes add column if not exists items jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists discount_amount numeric not null default 0;
alter table if exists quotes add column if not exists discount_percent numeric not null default 0;
alter table if exists quotes add column if not exists freight numeric not null default 0;
alter table if exists quotes add column if not exists items_total numeric not null default 0;
alter table if exists quotes add column if not exists total_amount numeric not null default 0;
alter table if exists quotes add column if not exists stock_applied boolean not null default false;
alter table if exists quotes add column if not exists created_by text;
alter table if exists quotes add column if not exists created_by_name text;
alter table if exists quotes add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_quotes_code on quotes (code);
create index if not exists idx_quotes_client_supplier on quotes (client_supplier_id);

-- Fase G — purchases (Fase A) só tinha fornecedor em texto livre. Agora
-- aceita vínculo opcional a um Cadastro (pessoa/CNPJ) via supplier_id, mesmo
-- padrão de client_supplier_id em orders/quotes — "supplier" continua
-- gravado (nome resolvido no momento da compra) pra exibição não depender
-- do cadastro não ter sido alterado/excluído depois.
alter table if exists purchases add column if not exists supplier_id text;
create index if not exists idx_purchases_supplier on purchases (supplier_id);

-- Log's Vendas Importadas — já existia a tabela (Fase A), sem alteração
-- necessária, só passa a ser usada de verdade a partir desta fase.

create table if not exists import_logs (
  id text primary key,
  type text,
  source text,
  count integer not null default 0,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Cadastros: Pessoas / CNPJs / Depósitos
-- "people"/"cnpjs" têm ~45 campos cada no app hoje (endereço de cobrança e
-- entrega, dados bancários, whatsapp, papéis, etc.). Colunas fixas só para o
-- que já é filtrado/buscado; o resto vai em "extra" (jsonb), preservando a
-- flexibilidade que o formulário de Cadastros já tem.
-- ----------------------------------------------------------------------------
create table if not exists people (
  id text primary key,
  code text,
  type text not null default 'pessoa-fisica',
  name text not null,
  trade_name text,
  document text not null,
  email text,
  phone text,
  status text not null default 'ativo',
  city text,
  state text,
  zip_code text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_people_document on people(document);
create index if not exists idx_people_code on people(code);

create table if not exists cnpjs (
  id text primary key,
  code text,
  type text not null default 'pessoa-juridica',
  name text not null,
  trade_name text,
  document text not null,
  email text,
  phone text,
  status text not null default 'ativo',
  registration_status text,
  city text,
  state text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_cnpjs_document on cnpjs(document);
create index if not exists idx_cnpjs_code on cnpjs(code);

create table if not exists deposits (
  id text primary key,
  name text not null,
  code text,
  status text not null default 'ativo',
  address text,
  city text,
  state text,
  manager text,
  notes text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Financeiro — plano de contas, centros de custo, contas bancárias
-- ----------------------------------------------------------------------------
create table if not exists financial_categories (
  id text primary key,
  name text not null,
  type text not null default 'ambos',
  created_at timestamptz not null default now()
);

create table if not exists cost_centers (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists bank_accounts (
  id text primary key,
  name text not null,
  bank text,
  agency text,
  number text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- NF-e (precisa existir antes de financial_entries, que referencia nfe_id)
-- ----------------------------------------------------------------------------
create table if not exists nfes (
  id text primary key,
  number text not null,
  series text not null default '1',
  date date not null,
  status text not null default 'autorizada',
  key text,
  amount numeric not null default 0,
  customer text not null,
  client_supplier_id text,
  client_document text,
  client_address text,
  client_city text,
  client_state text,
  client_state_registration text,
  tax_notes text,
  payment_type text not null default 'avista',
  installments_count integer not null default 1,
  installment_interval_days integer not null default 30,
  created_by text references users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nfe_items (
  id text primary key,
  nfe_id text not null references nfes(id) on delete cascade,
  code text,
  description text not null,
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  total numeric not null default 0,
  cfop text,
  ncm text
);
create index if not exists idx_nfe_items_nfe_id on nfe_items(nfe_id);

-- ----------------------------------------------------------------------------
-- Lançamentos financeiros e baixas
-- "client_supplier_id" fica sem FK rígida de propósito: pode apontar tanto
-- para people.id quanto para cnpjs.id (mesma lógica polimórfica que
-- getCadastroDirectory() já usa hoje em server.js).
-- ----------------------------------------------------------------------------
create table if not exists financial_entries (
  id text primary key,
  type text not null,
  date date not null,
  due_date date not null,
  amount numeric not null default 0,
  description text not null,
  document text,
  note text,
  category_id text references financial_categories(id),
  cost_center_id text references cost_centers(id),
  bank_account_id text references bank_accounts(id),
  target_bank_account_id text references bank_accounts(id),
  client_supplier_id text,
  client_supplier_name text,
  reference_id text,
  nfe_id text references nfes(id),
  status text not null default 'pending',
  created_by text references users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_financial_entries_status on financial_entries(status);
create index if not exists idx_financial_entries_type on financial_entries(type);
create index if not exists idx_financial_entries_due_date on financial_entries(due_date);
create index if not exists idx_financial_entries_nfe_id on financial_entries(nfe_id);

create table if not exists financial_payments (
  id text primary key,
  entry_id text not null references financial_entries(id) on delete cascade,
  amount numeric not null default 0,
  date date not null,
  bank_account_id text references bank_accounts(id),
  interest numeric not null default 0,
  fine numeric not null default 0,
  discount numeric not null default 0,
  note text,
  created_by text references users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_financial_payments_entry_id on financial_payments(entry_id);

-- ----------------------------------------------------------------------------
-- Extrato Open Finance / Conciliação
-- ----------------------------------------------------------------------------
create table if not exists bank_transactions (
  id text primary key,
  bank_account_id text references bank_accounts(id),
  date date not null,
  description text not null,
  amount numeric not null default 0,
  type text not null default 'entrada',
  status text not null default 'nao_conciliado',
  matched_entry_id text references financial_entries(id),
  matched_payment_id text,
  source text not null default 'manual',
  created_by text references users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_bank_transactions_status on bank_transactions(status);
create index if not exists idx_bank_transactions_bank_account_id on bank_transactions(bank_account_id);

-- ----------------------------------------------------------------------------
-- Auditoria
-- ----------------------------------------------------------------------------
create table if not exists audit_logs (
  id text primary key,
  action text not null,
  target_id text,
  target_username text,
  by_id text,
  by_name text,
  at timestamptz not null default now(),
  details jsonb
);
create index if not exists idx_audit_logs_at on audit_logs(at desc);

-- ----------------------------------------------------------------------------
-- Dados semente mínimos
-- Usuário admin / senha "SENHA-REMOVIDA-DO-HISTORICO" (mesma credencial padrão que o app já usa
-- hoje no data/db.json) — mas agora com hash bcrypt em vez de texto puro.
-- ----------------------------------------------------------------------------
insert into settings (id, company_name, currency, tax_rate)
values (1, 'MavisONE', 'BRL', 0)
on conflict (id) do nothing;

insert into users (id, username, password_hash, name, role, allowed_modules, theme)
values (
  'user-admin',
  'admin',
  '$2b$10$2hstaCoQQjU2pNSExmbMnehZ7PMKuDwWTxzq5ovbi7aSZytgCKBWu',
  'Administrador',
  'admin',
  array['dashboard','sales','purchases','stock','finance','settings','cadastros'],
  'light'
)
on conflict (id) do nothing;

insert into products (id, name, sku, stock_quantity, cost_price, sale_price)
values ('prod-1', 'Produto Exemplo', 'SKU-001', 20, 50, 75)
on conflict (id) do nothing;

-- ============================================================================
-- Fase C — Schema fiscal para emissão de NF-e (multi-empresa / multi-filial)
-- Integração: Focus NFe (lib/focusnfe.js). Sem RLS — controle de acesso fica
-- no backend (server.js) com a service_role key, mesmo padrão do resto deste
-- arquivo. Idempotente, pode rodar mais de uma vez.
--
-- Modelo em 2 níveis:
--   empresa         = pessoa jurídica  (chave natural = CNPJ raiz, 8 dígitos)
--   estabelecimento = matriz/filial    (chave natural = CNPJ completo, 14)
--
-- Da PESSOA JURÍDICA (herdado por todas as filiais): regime tributário/CRT,
-- certificado digital A1, opção de transferência.
-- Do ESTABELECIMENTO (individual): IE, endereço, token Focus, série/numeração.
--
-- Desvio proposital do desenho original: não criamos uma tabela "produto"
-- própria — os dados fiscais (NCM, CEST, origem etc.) foram adicionados como
-- colunas na tabela "products" já existente acima (Estoque), pra não ter dois
-- catálogos de produto em paralelo. Por isso "products.id" (text) é usado nas
-- referências abaixo em vez de um novo UUID.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Grupo econômico (opcional, mas separa "grupo" de "filial")
-- ----------------------------------------------------------------------------
create table if not exists grupo_economico (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Empresa — pessoa jurídica, uma por raiz de CNPJ
-- ----------------------------------------------------------------------------
create table if not exists empresa (
  id uuid primary key default gen_random_uuid(),
  grupo_economico_id uuid references grupo_economico(id),

  cnpj_raiz char(8) not null unique,
  razao_social text not null,

  -- Regime tributário: define CSOSN vs CST em TODOS os itens de TODAS as filiais
  regime_tributario text not null
    check (regime_tributario in ('SIMPLES_NACIONAL',
                                  'SIMPLES_EXCESSO_SUBLIMITE',
                                  'LUCRO_PRESUMIDO',
                                  'LUCRO_REAL')),
  crt smallint not null check (crt in (1,2,3,4)),
  -- CRT: 1=Simples  2=Simples c/ excesso de sublimite  3=Regime Normal
  --      4=MEI (não emite NF-e modelo 55 na maioria dos casos)

  -- Alíquota efetiva do Simples do mês corrente (CSOSN 101/201 exigem
  -- informar crédito de ICMS ao destinatário). Recalcular mensalmente.
  aliquota_credito_icms_sn numeric(5,4),
  aliquota_sn_vigencia date,

  -- Convênio ICMS 109/2024: opção por equiparar transferências entre
  -- estabelecimentos próprios a operação tributada. Decisão anual, por PJ.
  opcao_transferencia_tributada boolean not null default false,

  e_importadora boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Certificado digital A1 — por empresa (raiz), não por filial.
-- NUNCA guardar o .pfx nem a senha aqui: eles ficam na Focus NFe. Esta tabela
-- existe só para controlar validade e disparar alerta de vencimento.
-- ----------------------------------------------------------------------------
create table if not exists certificado_digital (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id) on delete cascade,
  tipo text not null default 'A1' check (tipo in ('A1','A3')),
  titular_cnpj char(14) not null,
  valido_de date not null,
  valido_ate date not null,
  enviado_focus_em timestamptz,
  substituido_por_id uuid references certificado_digital(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_certificado_vencendo on certificado_digital (valido_ate)
  where substituido_por_id is null;

-- ----------------------------------------------------------------------------
-- Estabelecimento — matriz, filial ou depósito
-- ----------------------------------------------------------------------------
create table if not exists estabelecimento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id),

  cnpj char(14) not null unique,      -- só dígitos
  ordem char(4) not null,             -- 0001 = matriz, 0002+ = filial
  tipo text not null
    check (tipo in ('MATRIZ','FILIAL','DEPOSITO_FECHADO','ARMAZEM_GERAL')),

  razao_social text not null,         -- deve bater EXATO com a Receita
  nome_fantasia text,
  email text,
  telefone text,

  -- Fiscais obrigatórios no XML
  inscricao_estadual text not null,
  inscricao_estadual_st text,         -- se houver ST em outra UF
  inscricao_municipal text,           -- necessária se emitir NFS-e
  cnae_principal char(7) not null,

  -- Endereço (todos obrigatórios no XML)
  logradouro text not null,
  numero text not null,
  complemento text,
  bairro text not null,
  codigo_municipio char(7) not null,  -- código IBGE, NÃO o nome
  municipio text not null,
  uf char(2) not null,
  cep char(8) not null,

  -- Integração Focus NFe: 1 token por CNPJ completo
  focus_token_cifrado bytea,          -- criptografado em repouso
  focus_ambiente text not null default 'homologacao'
    check (focus_ambiente in ('homologacao','producao')),
  focus_cadastrado_em timestamptz,

  emite_nfe boolean not null default true,
  emite_nfce boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create index if not exists idx_estab_empresa on estabelecimento (empresa_id);

-- Regra: CNPJ do estabelecimento tem que começar com a raiz da empresa-mãe.
-- Postgres não aceita subquery em CHECK CONSTRAINT — vira trigger.
create or replace function estabelecimento_valida_cnpj_raiz()
returns trigger
language plpgsql
as $$
declare
  raiz char(8);
begin
  select cnpj_raiz into raiz from empresa where id = new.empresa_id;
  if raiz is null then
    raise exception 'Empresa % não encontrada', new.empresa_id;
  end if;
  if left(new.cnpj, 8) <> raiz then
    raise exception 'CNPJ do estabelecimento (%) não bate com a raiz da empresa (raiz esperada: %)', new.cnpj, raiz;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_estabelecimento_valida_cnpj_raiz on estabelecimento;
create trigger trg_estabelecimento_valida_cnpj_raiz
  before insert or update on estabelecimento
  for each row execute function estabelecimento_valida_cnpj_raiz();

-- ----------------------------------------------------------------------------
-- Numeração de NF-e — sequência por estabelecimento + série.
-- Cada CNPJ tem numeração PRÓPRIA. Nunca compartilhar contador. Incrementar
-- com "select ... for update" pra evitar número duplicado.
-- ----------------------------------------------------------------------------
create table if not exists serie_nfe (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimento(id),
  modelo smallint not null default 55,  -- 55=NF-e  65=NFC-e
  serie smallint not null,
  proximo_numero bigint not null default 1,
  ambiente text not null
    check (ambiente in ('homologacao','producao')),

  unique (estabelecimento_id, modelo, serie, ambiente)
);

-- ----------------------------------------------------------------------------
-- Dados fiscais do produto — colunas novas na tabela "products" (Estoque)
-- já existente acima, em vez de um catálogo de produto paralelo.
-- ----------------------------------------------------------------------------
alter table if exists products add column if not exists ncm char(8);
alter table if exists products add column if not exists cest char(7);              -- obrigatório se houver ST
alter table if exists products add column if not exists unidade_comercial text;
alter table if exists products add column if not exists unidade_tributavel text;
alter table if exists products add column if not exists ean text;                  -- usar 'SEM GTIN' se não tiver

-- Origem da mercadoria (campo orig do XML) — pivô da importação
--  0 Nacional
--  1 Estrangeira - importação direta          -> exige DI
--  2 Estrangeira - adquirida no mercado interno
--  3 Nacional, conteúdo de importação > 40%   -> exige FCI
--  4 Nacional c/ processos produtivos básicos
--  5 Nacional, conteúdo de importação <= 40%  -> exige FCI
--  6 Estrangeira - importação direta, sem similar nacional -> exige DI
--  7 Estrangeira - mercado interno, sem similar nacional
--  8 Nacional, conteúdo de importação > 70%   -> exige FCI
alter table if exists products add column if not exists origem smallint check (origem between 0 and 8);
alter table if exists products add column if not exists numero_fci uuid;  -- Ficha de Conteúdo de Importação

-- ----------------------------------------------------------------------------
-- Declaração de Importação — exigida no item quando origem = 1 ou 6.
-- Vai no XML na primeira saída após a nacionalização.
-- ----------------------------------------------------------------------------
create table if not exists declaracao_importacao (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimento(id),

  numero_documento text not null,
  data_registro date not null,
  local_desembaraco text not null,
  uf_desembaraco char(2) not null,
  data_desembaraco date not null,
  via_transporte smallint not null,        -- 1=marítima 4=aérea 7=rodoviária...
  valor_afrmm numeric(15,2),               -- obrigatório se via = 1
  forma_intermediacao smallint not null,   -- 1=própria 2=conta e ordem 3=encomenda
  cnpj_adquirente char(14),                -- se forma = 2 ou 3
  uf_terceiro char(2),

  unique (estabelecimento_id, numero_documento)
);

create table if not exists di_adicao (
  id uuid primary key default gen_random_uuid(),
  declaracao_id uuid not null references declaracao_importacao(id)
    on delete cascade,
  produto_id text not null references products(id),
  numero_adicao smallint not null,
  numero_sequencial_item smallint not null,
  codigo_fabricante text not null,
  desconto numeric(15,2) default 0,
  quantidade numeric(15,4) not null,
  saldo_disponivel numeric(15,4) not null   -- baixa conforme vai saindo
);

-- ----------------------------------------------------------------------------
-- Regra fiscal — resolve CFOP + tributação por contexto.
-- Chave de busca, do mais específico para o mais genérico:
--   (empresa, ncm, tipo_operacao, uf_destino, tipo_destinatario)
-- Preencher NULL nos campos que devem funcionar como coringa.
-- ----------------------------------------------------------------------------
create table if not exists regra_fiscal (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id),

  -- Critérios de match (NULL = qualquer)
  ncm char(8),
  origem smallint,
  tipo_operacao text not null
    check (tipo_operacao in ('VENDA','TRANSFERENCIA','REMESSA','RETORNO',
                              'DEVOLUCAO','BONIFICACAO','ENTRADA_IMPORTACAO')),
  uf_destino char(2),
  dentro_do_estado boolean,
  destinatario_contribuinte boolean,

  -- Resultado
  cfop char(4) not null,

  -- Simples Nacional (CRT 1 e 2)
  csosn char(3),   -- 101,102,103,201,202,203,300,400,500,900

  -- Regime Normal (CRT 3)
  cst_icms char(2),   -- 00,10,20,30,40,41,50,51,60,70,90
  modalidade_bc_icms smallint,
  aliquota_icms numeric(5,2),
  reducao_bc_icms numeric(5,2),

  -- ST
  cst_icms_st char(2),
  mva_st numeric(5,2),
  aliquota_icms_st numeric(5,2),

  -- PIS / COFINS
  cst_pis char(2),   -- 01 no Presumido/Real, 49 ou 99 no Simples
  aliquota_pis numeric(5,4),
  cst_cofins char(2),
  aliquota_cofins numeric(5,4),

  -- IPI (relevante para importadora: é contribuinte de IPI na revenda)
  cst_ipi char(2),
  aliquota_ipi numeric(5,2),
  codigo_enquadramento_ipi char(3),

  prioridade int not null default 0,   -- desempate: maior ganha
  vigencia_inicio date not null,
  vigencia_fim date,
  observacao_fisco text      -- vai em infAdProd quando exigido por lei
);

create index if not exists idx_regra_busca
  on regra_fiscal (empresa_id, tipo_operacao, ncm, uf_destino);

-- ----------------------------------------------------------------------------
-- NF-e emitida — controle local + rastreio na Focus.
-- Nome "nfe" (singular) não colide com a tabela "nfes" (plural) já definida
-- acima — mas são conceitos diferentes: "nfes" é o registro simples de NF-e
-- avulsa do Financeiro (ainda não migrado do data/db.json pra cá); "nfe" é o
-- documento fiscal de verdade, transmitido à SEFAZ via Focus NFe. Unificar os
-- dois é decisão para quando o módulo Financeiro migrar pro Supabase.
-- ----------------------------------------------------------------------------
create table if not exists nfe (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimento(id),

  -- ref: identificador SEU, enviado à Focus. Torna a emissão idempotente.
  referencia text not null unique,

  modelo smallint not null default 55,
  serie smallint,
  numero bigint,
  chave_acesso char(44) unique,

  natureza_operacao text not null,
  tipo_documento smallint not null check (tipo_documento in (0,1)), -- 0=entrada 1=saída
  finalidade_emissao smallint not null check (finalidade_emissao in (1,2,3,4)),
  -- 1=normal 2=complementar 3=ajuste 4=devolução

  status text not null default 'RASCUNHO'
    check (status in ('RASCUNHO','PROCESSANDO','AUTORIZADO','ERRO',
                       'CANCELADO','DENEGADO','INUTILIZADO')),
  mensagem_sefaz text,
  protocolo text,

  valor_total numeric(15,2),
  data_emissao timestamptz,
  autorizado_em timestamptz,

  url_xml text,
  url_danfe text,
  payload_enviado jsonb,      -- guardar para auditoria e reenvio
  resposta_focus jsonb,

  criado_em timestamptz not null default now()
);

create index if not exists idx_nfe_estab_data on nfe (estabelecimento_id, data_emissao desc);
create index if not exists idx_nfe_status on nfe (status) where status in ('PROCESSANDO','ERRO');

-- ============================================================================
-- Fase D — Fecha lacunas do módulo fiscal (CC-e, inutilização, webhook,
-- armazenamento local de XML/DANFE, permissões granulares).
-- ============================================================================

-- Histórico de eventos de uma NF-e (Carta de Correção, cancelamento) ou de
-- uma faixa de numeração (inutilização — por isso nfe_id é opcional).
create table if not exists nfe_eventos (
  id uuid primary key default gen_random_uuid(),
  nfe_id uuid references nfe(id) on delete cascade,
  estabelecimento_id uuid not null references estabelecimento(id),
  tipo text not null check (tipo in ('CCE','CANCELAMENTO','INUTILIZACAO')),
  payload_enviado jsonb,
  resposta_focus jsonb,
  status text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_nfe_eventos_nfe_id on nfe_eventos (nfe_id);

-- Cópia local do XML/DANFE — não depende do link da Focus NFe continuar
-- disponível pra sempre. Um registro por (nfe, tipo).
create table if not exists nfe_arquivos (
  id uuid primary key default gen_random_uuid(),
  nfe_id uuid not null references nfe(id) on delete cascade,
  tipo text not null check (tipo in ('xml','danfe')),
  conteudo bytea not null,
  baixado_em timestamptz not null default now(),
  unique (nfe_id, tipo)
);

-- Permissões granulares do módulo Fiscal (fiscal.emitir, fiscal.cancelar
-- etc.) — só addição de coluna, não muda nada do resto do sistema.
alter table if exists users add column if not exists fiscal_permissions text[] not null default '{}';

-- ============================================================================
-- Fase E — Módulo Open Finance (conexão bancária real via Pluggy/Polp/Celcoin)
-- Integração: lib/openfinance/service.js. Isolamento multiempresa reaproveita
-- estabelecimento (Fase C) em vez de um "companyId" novo. bank_accounts e
-- bank_transactions (Fase A) ganham colunas novas em vez de tabelas
-- paralelas — o fluxo manual/CSV que já existe continua funcionando igual.
-- ============================================================================

-- Catálogo de instituições (bancos) que cada provider conhece. Um mesmo banco
-- pode ter um id diferente em cada provider, por isso a chave é o par
-- (provider, provider_institution_id), não o nome.
create table if not exists financial_institutions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('pluggy','polp','celcoin')),
  provider_institution_id text not null,
  name text not null,
  image_url text,
  type text,
  created_at timestamptz not null default now(),
  unique (provider, provider_institution_id)
);

-- Uma conexão = um vínculo com um banco via um provider, pra um
-- estabelecimento específico. As credenciais/tokens que o provider devolve
-- (ex.: itemId da Pluggy) ficam cifradas — nunca em texto puro — com chave
-- própria (OPEN_FINANCE_ENCRYPTION_KEY, independente da chave da Focus NFe).
create table if not exists open_finance_connections (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimento(id),
  provider text not null check (provider in ('pluggy','polp','celcoin')),
  provider_connection_id text,
  institution_id uuid references financial_institutions(id),
  status text not null default 'pending' check (status in ('pending','connected','error','disconnected')),
  credentials_encrypted bytea,
  error_message text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estabelecimento_id, provider, provider_connection_id)
);
create index if not exists idx_of_connections_estabelecimento on open_finance_connections (estabelecimento_id);

-- Colunas novas em bank_accounts (Fase A) pra refletir contas vindas de uma
-- conexão de verdade, sem duplicar a tabela. Tudo nullable: conta manual
-- (fluxo que já existe) continua com essas colunas vazias.
alter table if exists bank_accounts add column if not exists estabelecimento_id uuid references estabelecimento(id);
alter table if exists bank_accounts add column if not exists connection_id uuid references open_finance_connections(id);
alter table if exists bank_accounts add column if not exists provider text check (provider is null or provider in ('pluggy','polp','celcoin'));
alter table if exists bank_accounts add column if not exists provider_account_id text;
alter table if exists bank_accounts add column if not exists account_type text check (account_type is null or account_type in ('corrente','poupanca','credito'));
alter table if exists bank_accounts add column if not exists currency text not null default 'BRL';
alter table if exists bank_accounts add column if not exists current_balance numeric;
alter table if exists bank_accounts add column if not exists available_balance numeric;
alter table if exists bank_accounts add column if not exists status text check (status is null or status in ('ativa','erro','desconectada'));
alter table if exists bank_accounts add column if not exists last_sync_at timestamptz;

-- Idempotência de sincronização de contas: a mesma conta do provider nunca
-- aparece duas vezes pra mesma conexão. Constraint cheia, não parcial: no
-- Postgres, NULL nunca é igual a NULL numa unique constraint multi-coluna,
-- então contas manuais (connection_id/provider_account_id nulos) não
-- conflitam entre si — e um constraint cheio (não índice parcial) é o que
-- permite usar .upsert({...}, {onConflict:'connection_id,provider_account_id'})
-- direto pelo PostgREST, igual já funciona hoje pra nfe_arquivos (unique
-- nfe_id,tipo). Índice parcial não é aceito como alvo de ON CONFLICT.
create unique index if not exists idx_bank_accounts_connection_provider_account
  on bank_accounts (connection_id, provider_account_id);

-- Histórico de saldo — cada sincronização INSERE uma linha nova, nunca
-- sobrescreve (é isso que permite ver evolução de saldo no tempo).
--
-- account_id SEM foreign key pra bank_accounts(id) de propósito: bank_accounts
-- (Fase A) existe como tabela no Supabase mas está com 0 linhas — quem
-- alimenta contas de verdade hoje é o arquivo local data/db.json (ver nota em
-- lib/openfinance/sync.js e db.js). Um FK contra uma tabela que nunca recebe
-- os IDs reais quebraria TODA sincronização em produção. Reavaliar quando
-- Finance migrar de fato pro Supabase.
create table if not exists account_balances (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  current_balance numeric not null,
  available_balance numeric,
  captured_at timestamptz not null default now()
);
create index if not exists idx_account_balances_account_captured on account_balances (account_id, captured_at desc);

-- Colunas novas em bank_transactions (Fase A) — o essencial pra idempotência
-- real é (bank_account_id, provider_transaction_id): a mesma transação nunca
-- entra duas vezes, mesmo que a sincronização rode de novo (Fase 3).
alter table if exists bank_transactions add column if not exists provider text check (provider is null or provider in ('pluggy','polp','celcoin'));
alter table if exists bank_transactions add column if not exists provider_transaction_id text;
alter table if exists bank_transactions add column if not exists processing_date date;
alter table if exists bank_transactions add column if not exists direction text check (direction is null or direction in ('entrada','saida'));
alter table if exists bank_transactions add column if not exists category text;
alter table if exists bank_transactions add column if not exists subcategory text;
alter table if exists bank_transactions add column if not exists merchant_name text;
alter table if exists bank_transactions add column if not exists merchant_document text;
alter table if exists bank_transactions add column if not exists counterparty_name text;
alter table if exists bank_transactions add column if not exists counterparty_document text;
alter table if exists bank_transactions add column if not exists payment_method text;
alter table if exists bank_transactions add column if not exists pix_key text;
alter table if exists bank_transactions add column if not exists pix_end_to_end_id text;
alter table if exists bank_transactions add column if not exists pix_type text;
alter table if exists bank_transactions add column if not exists document_number text;
alter table if exists bank_transactions add column if not exists original_data jsonb;

-- Constraint cheia (não parcial) pelo mesmo motivo do idx_bank_accounts_*
-- acima — permite upsert direto por onConflict e ainda deixa transações
-- manuais (provider_transaction_id nulo) livres pra coexistir sem conflito.
create unique index if not exists idx_bank_transactions_account_provider_tx
  on bank_transactions (bank_account_id, provider_transaction_id);

-- Cartões vinculados a uma conexão, e as transações de cada cartão — mesma
-- lógica de idempotência (constraint cheia, ver nota acima).
create table if not exists bank_cards (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references open_finance_connections(id) on delete cascade,
  provider_card_id text not null,
  brand text,
  last4 char(4),
  type text check (type is null or type in ('credito','debito')),
  created_at timestamptz not null default now(),
  unique (connection_id, provider_card_id)
);

create table if not exists card_transactions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references bank_cards(id) on delete cascade,
  provider_transaction_id text,
  amount numeric not null default 0,
  currency text not null default 'BRL',
  description text,
  date date not null,
  installments smallint,
  original_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_card_transactions_card_date on card_transactions (card_id, date desc);
create unique index if not exists idx_card_transactions_card_provider_tx
  on card_transactions (card_id, provider_transaction_id);

-- Eventos brutos de webhook — gravado ANTES de qualquer processamento (se o
-- processamento falhar, o evento não se perde). provider_event_id pode ser
-- nulo pra provider que não manda um id estável; nesse caso não há dedup
-- automático (múltiplos nulos não conflitam entre si no unique abaixo).
create table if not exists open_finance_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  connection_id uuid references open_finance_connections(id) on delete set null,
  provider_event_id text,
  payload jsonb not null,
  processed boolean not null default false,
  error text,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index if not exists idx_of_webhook_events_connection on open_finance_webhook_events (connection_id);

-- Trilha de auditoria específica do Open Finance (acesso a dado bancário,
-- sincronização, conexão/desconexão) — separada da audit_logs genérica
-- porque aqui o registro é sobre acesso a dado financeiro sensível, não
-- sobre uma ação administrativa qualquer. by_id/by_name ficam nullable
-- porque nem todo evento (ex.: sync automático, webhook) tem um usuário
-- logado por trás, e (igual audit_logs genérica) by_id de propósito NÃO tem
-- FK pra users — o registro tem que sobreviver mesmo que o usuário seja
-- excluído depois.
create table if not exists open_finance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references open_finance_connections(id) on delete set null,
  estabelecimento_id uuid references estabelecimento(id),
  action text not null,
  by_id text,
  by_name text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_of_audit_logs_connection on open_finance_audit_logs (connection_id);
create index if not exists idx_of_audit_logs_created_at on open_finance_audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Fase H — campos financeiros do Pedido/Orçamento
--
-- O formulário passou a ter descontos combinados (% + R$), frete com as chaves
-- "fixar" e "cobrar do comprador", despesas gerais, taxa de montagem, serviços
-- e comissões. Sem estas colunas os valores eram calculados na tela e perdidos
-- ao salvar — o registro reabria com os campos zerados.
--
-- discount_total, seller_commission, agent_commission e total_weight são
-- derivados: guardados para relatório e conferência histórica, mas sempre
-- recalculados pelo servidor a cada gravação (o cliente nunca dita o total).
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists freight_fixed boolean not null default false;
alter table if exists orders add column if not exists charge_freight_to_buyer boolean not null default true;
alter table if exists orders add column if not exists general_expenses numeric not null default 0;
alter table if exists orders add column if not exists assembly_fee numeric not null default 0;
alter table if exists orders add column if not exists services_amount numeric not null default 0;
alter table if exists orders add column if not exists seller_commission_percent numeric not null default 0;
alter table if exists orders add column if not exists agent_commission_percent numeric not null default 0;
alter table if exists orders add column if not exists discount_total numeric not null default 0;
alter table if exists orders add column if not exists seller_commission numeric not null default 0;
alter table if exists orders add column if not exists agent_commission numeric not null default 0;
alter table if exists orders add column if not exists total_weight numeric not null default 0;

alter table if exists quotes add column if not exists freight_fixed boolean not null default false;
alter table if exists quotes add column if not exists charge_freight_to_buyer boolean not null default true;
alter table if exists quotes add column if not exists general_expenses numeric not null default 0;
alter table if exists quotes add column if not exists assembly_fee numeric not null default 0;
alter table if exists quotes add column if not exists services_amount numeric not null default 0;
alter table if exists quotes add column if not exists seller_commission_percent numeric not null default 0;
alter table if exists quotes add column if not exists agent_commission_percent numeric not null default 0;
alter table if exists quotes add column if not exists discount_total numeric not null default 0;
alter table if exists quotes add column if not exists seller_commission numeric not null default 0;
alter table if exists quotes add column if not exists agent_commission numeric not null default 0;
alter table if exists quotes add column if not exists total_weight numeric not null default 0;

-- ---------------------------------------------------------------------------
-- Fase I — seção "Informações Gerais" do Pedido/Orçamento
--
-- O formulário ganhou um bloco de acompanhamento abaixo dos descontos e
-- despesas: hora do cadastro, status/contato do cliente, código da ordem de
-- compra do cliente, os três e-mails de envio, data de aprovação, pedido
-- relacionado, número da revisão e a chave "Gerar Ordem de Serviço".
--
-- updated_by_name guarda quem fez a última alteração ("Alterado por" na tela);
-- a data correspondente já vinha de updated_at.
--
-- approval_date é `date` e aceita null — o campo fica vazio até o orçamento ser
-- aprovado, e string vazia não faz cast para date no Postgres.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists registration_time text not null default '';
alter table if exists orders add column if not exists client_status text not null default '';
alter table if exists orders add column if not exists client_contact text not null default '';
alter table if exists orders add column if not exists customer_po_code text not null default '';
alter table if exists orders add column if not exists recipient_email text not null default '';
alter table if exists orders add column if not exists billing_recipient_email text not null default '';
alter table if exists orders add column if not exists commercial_recipient_email text not null default '';
alter table if exists orders add column if not exists approval_date date;
alter table if exists orders add column if not exists related_order_code numeric not null default 0;
alter table if exists orders add column if not exists revision_number numeric not null default 0;
alter table if exists orders add column if not exists generate_service_order boolean not null default false;
alter table if exists orders add column if not exists updated_by_name text not null default '';

alter table if exists quotes add column if not exists registration_time text not null default '';
alter table if exists quotes add column if not exists client_status text not null default '';
alter table if exists quotes add column if not exists client_contact text not null default '';
alter table if exists quotes add column if not exists customer_po_code text not null default '';
alter table if exists quotes add column if not exists recipient_email text not null default '';
alter table if exists quotes add column if not exists billing_recipient_email text not null default '';
alter table if exists quotes add column if not exists commercial_recipient_email text not null default '';
alter table if exists quotes add column if not exists approval_date date;
alter table if exists quotes add column if not exists related_order_code numeric not null default 0;
alter table if exists quotes add column if not exists revision_number numeric not null default 0;
alter table if exists quotes add column if not exists generate_service_order boolean not null default false;
alter table if exists quotes add column if not exists updated_by_name text not null default '';

-- ---------------------------------------------------------------------------
-- Fase J — cabeçalho da aba "Dados" do Pedido/Orçamento
--
-- Classificação da venda que o formulário passou a pedir junto de cliente,
-- empresa, depósito e vendedor: origem da venda (venda direta, televendas,
-- e-commerce...), categoria e tabela de preços.
--
-- sale_origin nasce com 'Venda Direta' porque é o caso normal — os registros
-- antigos, criados antes deste campo existir, ficam classificados assim em vez
-- de aparecerem em branco na tela.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists sale_origin text not null default 'Venda Direta';
alter table if exists orders add column if not exists category text not null default '';
alter table if exists orders add column if not exists price_table text not null default '';

alter table if exists quotes add column if not exists sale_origin text not null default 'Venda Direta';
alter table if exists quotes add column if not exists category text not null default '';
alter table if exists quotes add column if not exists price_table text not null default '';

-- ---------------------------------------------------------------------------
-- Fase K — abas Pagamentos, Entrega e Termos e Condições do Pedido/Orçamento
--
-- São blocos de formulário (plano de conta, forma de pagamento, parcelas,
-- transportadora, endereço de entrega, termos de venda). Guardados como jsonb
-- em vez de ~30 colunas soltas: ninguém filtra pedido por "bairro de entrega",
-- e cada campo novo da tela deixaria de exigir migração.
--
-- O servidor copia chave por chave antes de gravar (salesPaymentInfo,
-- salesPaymentLines e salesDelivery em server.js) — o jsonb não é o objeto cru
-- que veio do navegador.
--
--   payment_info: objeto único   { accountPlan, paymentMethodId, paymentTerm... }
--   payments:     lista          [ { methodId, methodName, dueDate, amount, note } ]
--   delivery:     objeto único   { addressType, carrierId, zipCode, city... }
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists payment_info jsonb not null default '{}'::jsonb;
alter table if exists orders add column if not exists payments jsonb not null default '[]'::jsonb;
alter table if exists orders add column if not exists delivery jsonb not null default '{}'::jsonb;
alter table if exists orders add column if not exists sales_terms text not null default '';

alter table if exists quotes add column if not exists payment_info jsonb not null default '{}'::jsonb;
alter table if exists quotes add column if not exists payments jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists delivery jsonb not null default '{}'::jsonb;
alter table if exists quotes add column if not exists sales_terms text not null default '';

-- ---------------------------------------------------------------------------
-- Fase L — Controle de acesso (RBAC): papéis, permissões e trilha de auditoria
--
-- Tradução do schema de RBAC para a realidade deste ERP:
--
--   * O banco é PostgreSQL (Supabase), não MySQL. Tipos e sintaxe mudam:
--     TINYINT(1) -> boolean, ENUM -> check constraint, JSON -> jsonb,
--     VARBINARY(16)+INET6_ATON -> inet (nativo no Postgres),
--     AUTO_INCREMENT -> generated always as identity.
--
--   * Papéis e permissões usam o SLUG como chave primária, em vez de id
--     numérico + slug único. O código já fala em slug ('admin', 'sales.criar');
--     com id numérico toda consulta precisaria de um join só para traduzir.
--
--   * Os recursos são os módulos reais do sistema (sales, cadastros, stock,
--     finance, purchases, settings, fiscal), não reserva/hóspede.
--
-- SEGURANÇA DA MIGRAÇÃO: o seed no fim reproduz o acesso que cada usuário já
-- tem hoje (allowed_modules), com todas as ações. Ninguém perde acesso ao rodar
-- isto — o que muda é passar a EXISTIR como restringir, pela tela de usuários.
-- ---------------------------------------------------------------------------

-- 1) Usuários: bloquear sem apagar, e saber quando entrou pela última vez.
alter table if exists users add column if not exists active boolean not null default true;
alter table if exists users add column if not exists last_login_at timestamptz;

-- 2) Papéis. `system` marca o que a tela não deixa apagar/renomear.
create table if not exists roles (
  slug text primary key,
  name text not null,
  description text not null default '',
  level smallint not null default 10,
  system boolean not null default false,
  created_at timestamptz not null default now()
);

-- 3) Permissões: uma linha por ação verificável (recurso + ação).
create table if not exists permissions (
  slug text primary key,
  resource text not null,
  action text not null,
  description text not null default ''
);
create index if not exists idx_permissions_resource on permissions (resource);

-- 4) Papel -> permissões.
create table if not exists role_permissions (
  role_slug text not null references roles (slug) on delete cascade,
  permission_slug text not null references permissions (slug) on delete cascade,
  primary key (role_slug, permission_slug)
);

-- 5) Usuário -> papéis (pode ter mais de um).
create table if not exists user_roles (
  user_id text not null references users (id) on delete cascade,
  role_slug text not null references roles (slug) on delete cascade,
  granted_by text references users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_slug)
);

-- 6) Permissão pontual, sem precisar criar papel novo. NEGAR sempre vence.
create table if not exists user_permissions (
  user_id text not null references users (id) on delete cascade,
  permission_slug text not null references permissions (slug) on delete cascade,
  effect text not null default 'PERMITIR' check (effect in ('PERMITIR', 'NEGAR')),
  primary key (user_id, permission_slug)
);

-- 7) Trilha de auditoria. Registra também o que foi NEGADO — é justamente a
--    tentativa barrada que interessa numa investigação.
create table if not exists access_logs (
  id bigint generated always as identity primary key,
  user_id text references users (id) on delete set null,
  user_name text not null default '',
  action text not null,
  resource_type text not null default '',
  resource_id text not null default '',
  result text not null default 'PERMITIDO' check (result in ('PERMITIDO', 'NEGADO')),
  ip inet,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_access_logs_user on access_logs (user_id, created_at desc);
create index if not exists idx_access_logs_action on access_logs (action, created_at desc);
create index if not exists idx_access_logs_result on access_logs (result, created_at desc);

-- View das permissões efetivas (papéis + diretas, com NEGAR removendo).
-- O app não depende dela para decidir (ver lib/permissoes.js) — ela existe para
-- conferência direta no banco: "o que o fulano pode, afinal?".
create or replace view vw_user_permissions as
select u.id as user_id, p.slug as permission
from users u
join user_roles ur on ur.user_id = u.id
join role_permissions rp on rp.role_slug = ur.role_slug
join permissions p on p.slug = rp.permission_slug
where u.active
  and not exists (
    select 1 from user_permissions up
    where up.user_id = u.id and up.permission_slug = p.slug and up.effect = 'NEGAR'
  )
union
select u.id, p.slug
from users u
join user_permissions up on up.user_id = u.id and up.effect = 'PERMITIR'
join permissions p on p.slug = up.permission_slug
where u.active;

-- ---------------------------------------------------------------------------
-- SEED
-- ---------------------------------------------------------------------------
insert into roles (slug, name, description, level, system) values
  ('admin',   'Administrador', 'Acesso total ao sistema',                 100, true),
  ('gerente', 'Gerente',       'Operação completa, relatórios e exclusão',  50, false),
  ('usuario', 'Usuário',       'Acesso operacional limitado',               10, true)
on conflict (slug) do update set name = excluded.name, description = excluded.description;

-- Permissões: um módulo do ERP por recurso, quatro ações onde faz sentido.
insert into permissions (slug, resource, action, description) values
  ('dashboard.ler',   'dashboard', 'ler',     'Ver o painel inicial'),
  ('cadastros.ler',   'cadastros', 'ler',     'Ver cadastros'),
  ('cadastros.criar', 'cadastros', 'criar',   'Criar cadastro'),
  ('cadastros.editar','cadastros', 'editar',  'Editar cadastro'),
  ('cadastros.excluir','cadastros','excluir', 'Excluir cadastro'),
  ('sales.ler',       'sales',     'ler',     'Ver pedidos e orçamentos'),
  ('sales.criar',     'sales',     'criar',   'Criar pedido/orçamento'),
  ('sales.editar',    'sales',     'editar',  'Editar pedido/orçamento'),
  ('sales.excluir',   'sales',     'excluir', 'Excluir pedido/orçamento'),
  ('purchases.ler',   'purchases', 'ler',     'Ver compras'),
  ('purchases.criar', 'purchases', 'criar',   'Lançar compra'),
  ('purchases.editar','purchases', 'editar',  'Editar compra'),
  ('purchases.excluir','purchases','excluir', 'Excluir compra'),
  ('stock.ler',       'stock',     'ler',     'Ver estoque'),
  ('stock.criar',     'stock',     'criar',   'Lançar movimentação'),
  ('stock.editar',    'stock',     'editar',  'Editar estoque'),
  ('stock.excluir',   'stock',     'excluir', 'Excluir movimentação'),
  ('finance.ler',     'finance',   'ler',     'Ver financeiro'),
  ('finance.criar',   'finance',   'criar',   'Lançar no financeiro'),
  ('finance.editar',  'finance',   'editar',  'Editar lançamento'),
  ('finance.excluir', 'finance',   'excluir', 'Excluir lançamento'),
  ('settings.ler',    'settings',  'ler',     'Ver configurações'),
  ('settings.editar', 'settings',  'editar',  'Alterar configurações'),
  ('usuarios.gerenciar','usuarios','gerenciar','Criar/editar usuários, papéis e permissões'),
  ('auditoria.ler',   'auditoria', 'ler',     'Ver a trilha de auditoria'),
  -- Fiscal já tinha permissão por ação antes deste RBAC (users.fiscal_permissions).
  -- Entram aqui com os mesmos nomes para o controle ficar num lugar só.
  ('fiscal.visualizar','fiscal','visualizar','Ver dados fiscais'),
  ('fiscal.criar',    'fiscal',   'criar',    'Criar registro fiscal'),
  ('fiscal.editar',   'fiscal',   'editar',   'Editar registro fiscal'),
  ('fiscal.emitir',   'fiscal',   'emitir',   'Emitir NF-e'),
  ('fiscal.cancelar', 'fiscal',   'cancelar', 'Cancelar NF-e'),
  ('fiscal.cce',      'fiscal',   'cce',      'Emitir carta de correção'),
  ('fiscal.inutilizar','fiscal',  'inutilizar','Inutilizar numeração'),
  ('fiscal.configurar','fiscal',  'configurar','Configurar empresa/estabelecimento'),
  ('fiscal.regras',   'fiscal',   'regras',   'Regras fiscais'),
  ('fiscal.certificado','fiscal', 'certificado','Certificado digital'),
  ('fiscal.documentos_recebidos','fiscal','documentos_recebidos','Documentos recebidos'),
  ('fiscal.manifestar','fiscal',  'manifestar','Manifestar documentos'),
  ('fiscal.xml',      'fiscal',   'xml',      'Baixar XML'),
  ('fiscal.danfe',    'fiscal',   'danfe',    'Baixar DANFE'),
  ('fiscal.auditoria','fiscal',   'auditoria','Auditoria fiscal')
on conflict (slug) do update set description = excluded.description;

-- USUÁRIO: opera, mas não exclui, não vê financeiro e não mexe em usuários.
insert into role_permissions (role_slug, permission_slug)
select 'usuario', slug from permissions
where slug in ('dashboard.ler',
               'sales.ler', 'sales.criar', 'sales.editar',
               'cadastros.ler', 'cadastros.criar', 'cadastros.editar',
               'stock.ler', 'purchases.ler')
on conflict do nothing;

-- GERENTE: tudo do usuário + excluir + financeiro + auditoria. Sem gerenciar usuários.
insert into role_permissions (role_slug, permission_slug)
select 'gerente', slug from permissions
where resource in ('dashboard', 'sales', 'cadastros', 'stock', 'purchases', 'finance')
   or slug = 'auditoria.ler'
on conflict do nothing;

-- ADMIN não recebe lista: o atalho de administrador libera tudo (mesma regra da
-- função usuario_pode() do schema original).

-- Usuários existentes ganham papel conforme o `role` que já tinham.
insert into user_roles (user_id, role_slug)
select id, case when role = 'admin' then 'admin' else 'usuario' end from users
on conflict do nothing;

-- E mantêm exatamente o acesso de hoje: uma permissão direta para cada ação dos
-- módulos que já estavam liberados em allowed_modules. Sem isto, quem hoje
-- exclui um pedido perderia a exclusão no instante em que a migração rodasse.
insert into user_permissions (user_id, permission_slug, effect)
select u.id, p.slug, 'PERMITIR'
from users u
join permissions p on p.resource = any (u.allowed_modules)
where u.role <> 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Fase M — Financeiro sai do data/db.json e passa a viver no Supabase
--
-- As tabelas (financial_entries, financial_payments, financial_categories,
-- cost_centers, bank_accounts) já existiam no schema desde a Fase A, mas nenhuma
-- rota as usava: o módulo inteiro lia e gravava no arquivo local. Esta fase é a
-- ligação — e o SQL abaixo é o único ajuste de estrutura que ela precisa.
--
-- POR QUE DERRUBAR A FK DE nfe_id:
--
-- financial_entries.nfe_id referencia nfes(id). Só que a NF-e ainda mora no
-- db.json: emitir uma nota grava a nota no arquivo e as parcelas no Supabase.
-- Com a FK no lugar, o Postgres recusaria as parcelas — a nota que elas
-- apontam não existe na tabela dele — e a emissão quebraria.
--
-- O vínculo continua existindo e sendo usado (cancelar a NF-e cancela as
-- parcelas, por nfe_id); o que se perde é a checagem do banco, exatamente como
-- já acontece com client_supplier_id, que aponta ora para people, ora para
-- cnpjs e por isso também não tem FK.
--
-- Quando a NF-e for para o Supabase (próxima fase), a FK volta com:
--   alter table financial_entries
--     add constraint financial_entries_nfe_id_fkey
--     foreign key (nfe_id) references nfes(id);
-- ---------------------------------------------------------------------------
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

-- O modelo antigo do arquivo gravava lançamento de venda/compra sem vencimento
-- (só `date`). A coluna é not null, então esses casos passam a repetir a data —
-- é o que createFinancialEntry já faz (`due_date: payload.dueDate || payload.date`).
-- Nada a alterar aqui: fica registrado para quem for ler os dados depois.

-- ---------------------------------------------------------------------------
-- Fase N — NF-e sai do data/db.json e passa a viver no Supabase
--
-- As tabelas `nfes` e `nfe_items` já existiam desde a Fase A, sem nenhuma rota
-- usando. Agora emitir, listar, abrir e cancelar NF-e passa pelo banco.
--
-- Com a nota no Supabase, a FK que a Fase M precisou derrubar volta: uma
-- parcela só pode apontar para uma NF-e que exista de verdade. É a checagem que
-- impede parcela órfã — e parcela órfã de documento fiscal é exatamente o tipo
-- de inconsistência que ninguém percebe até a conferência do contador.
--
-- O `not valid` é de propósito: valida da migração para frente sem varrer as
-- linhas antigas, para o caso de haver parcela gravada durante a janela em que
-- a Fase M rodou e esta ainda não. Para exigir a checagem também no passado
-- (recomendado depois de conferir que não sobrou nada), rode:
--
--   alter table financial_entries validate constraint financial_entries_nfe_id_fkey;
--
-- Se essa validação acusar erro, existe parcela apontando para NF-e que não
-- está no banco — investigue antes de forçar.
-- ---------------------------------------------------------------------------
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

alter table if exists financial_entries
  add constraint financial_entries_nfe_id_fkey
  foreign key (nfe_id) references nfes (id)
  not valid;

-- A listagem de NF-e ordena por data e filtra por status; os itens são sempre
-- buscados por nota.
create index if not exists idx_nfes_date on nfes (date desc);
create index if not exists idx_nfes_status on nfes (status);

-- ---------------------------------------------------------------------------
-- Fase O — pedido faturado gera contas a receber
--
-- Até aqui, faturar um pedido mexia no estoque e parava por aí: o Financeiro
-- nunca ficava sabendo. Quem quisesse a receita tinha que lançar à mão, e
-- pedido cancelado deixava a cobrança viva.
--
-- `finance_applied` é a irmã de `stock_applied`: marca que aquele pedido JÁ
-- gerou as parcelas. Sem ela, salvar de novo um pedido já faturado geraria
-- cobrança dobrada — e cobrança dobrada é o tipo de erro que chega no cliente.
--
-- As parcelas saem da aba "Pagamentos" do pedido quando ela estiver preenchida
-- (uma conta a receber por linha, com a forma e o vencimento combinados); sem
-- nada preenchido, sai uma parcela única no total da venda. O vínculo é o
-- `reference_id` do lançamento, que guarda o id do pedido.
--
-- quotes recebe a coluna junto porque orders e quotes compartilham o mesmo
-- construtor de linha no código — orçamento nunca fatura, então lá ela fica
-- sempre falsa.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists finance_applied boolean not null default false;
alter table if exists quotes add column if not exists finance_applied boolean not null default false;

-- O cancelamento de um pedido procura as parcelas dele por reference_id.
create index if not exists idx_financial_entries_reference_id on financial_entries (reference_id);

-- ---------------------------------------------------------------------------
-- Fase P — vínculo entre o Pedido e a NF-e
--
-- O menu da NF-e já tinha a ação "Ir para a venda", com a checagem
-- `nfe.orderId ? true : 'Esta NF-e não tem venda vinculada.'` — só que orderId
-- nunca foi gravado por lugar nenhum. A ação nascia permanentemente desligada.
--
-- Com o fluxo Pedido -> Aprovar -> Financeiro -> Gerar NF-e, o vínculo passa a
-- existir de verdade, e é guardado nos DOIS sentidos de propósito:
--
--   nfes.order_id  — de qual pedido esta nota saiu (a nota é o documento final,
--                    e é dela que se pergunta a origem numa conferência)
--   orders.nfe_id  — qual nota já foi emitida para este pedido, que é o que
--                    impede emitir a segunda por engano e o que permite à tela
--                    do pedido mostrar a nota sem varrer a tabela inteira
--
-- Sem FK rígida em nenhum dos dois lados: os registros nascem em rotas
-- diferentes e em momentos diferentes, e uma FK aqui só transformaria ordem de
-- gravação em erro de banco. A consistência é garantida no servidor, que grava
-- os dois lados na mesma rota de emissão.
-- ---------------------------------------------------------------------------
alter table if exists nfes add column if not exists order_id text;
alter table if exists orders add column if not exists nfe_id text;

create index if not exists idx_nfes_order_id on nfes (order_id);

-- ---------------------------------------------------------------------------
-- Fase Q — tabelas fiscais de referência (CFOP, CST, CSOSN, origem)
--
-- Hoje CFOP e NCM são texto livre digitado à mão na emissão da NF-e. Errar um
-- dígito num documento fiscal não dá erro na tela: dá problema na apuração,
-- meses depois. Com as tabelas, o campo vira seleção com descrição ao lado.
--
-- SÃO CÓDIGOS OFICIAIS, não interpretação: o conteúdo abaixo é o texto da
-- legislação (Convênio S/Nº 1970 para CFOP; Anexos do Convênio 4/81 e da Lei
-- do Simples para CST/CSOSN). Nada aqui decide QUAL código se aplica ao seu
-- caso — isso é a regra_fiscal, e continua sendo assunto do seu contador.
--
-- SOBRE O CFOP: o primeiro dígito é o âmbito da operação e os três últimos
-- identificam a natureza:
--     1/2/3 = ENTRADA  (estadual / interestadual / exterior)
--     5/6/7 = SAÍDA    (estadual / interestadual / exterior)
-- Os três últimos dígitos NÃO significam a mesma coisa na entrada e na saída
-- (102 na saída é "venda de mercadoria de terceiros"; na entrada é "compra
-- para comercialização"), por isso as duas listas são separadas e cada código
-- é gravado por extenso — nada é gerado por combinação.
--
-- A lista é o subconjunto usado em comércio/revenda, incluindo substituição
-- tributária, conserto e ativo imobilizado. A tabela completa tem centenas de
-- códigos; acrescentar os que faltarem é um insert, sem mexer em código.
-- ---------------------------------------------------------------------------

create table if not exists cfop (
  codigo char(4) primary key,
  descricao text not null,
  -- ENTRADA ou SAIDA, derivado do primeiro dígito
  tipo text not null check (tipo in ('ENTRADA', 'SAIDA')),
  -- ESTADUAL (1/5), INTERESTADUAL (2/6) ou EXTERIOR (3/7)
  ambito text not null check (ambito in ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR')),
  ativo boolean not null default true
);
create index if not exists idx_cfop_tipo on cfop (tipo, ambito);

create table if not exists cst_icms (
  codigo char(2) primary key,
  descricao text not null
);

create table if not exists csosn (
  codigo char(3) primary key,
  descricao text not null
);

create table if not exists cst_pis_cofins (
  codigo char(2) primary key,
  descricao text not null,
  -- ENTRADA (créditos) ou SAIDA (débitos): a mesma tabela atende os dois
  grupo text not null check (grupo in ('ENTRADA', 'SAIDA'))
);

create table if not exists cst_ipi (
  codigo char(2) primary key,
  descricao text not null,
  grupo text not null check (grupo in ('ENTRADA', 'SAIDA'))
);

create table if not exists origem_mercadoria (
  codigo char(1) primary key,
  descricao text not null
);

-- ---------------------------------------------------------------------------
-- CFOP — SAÍDAS (5 = dentro do estado, 6 = interestadual)
-- ---------------------------------------------------------------------------
insert into cfop (codigo, descricao, tipo, ambito) values
  ('5101', 'Vendas · Venda de produção do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'ESTADUAL'),
  ('5103', 'Vendas · Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5104', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5109', 'Vendas · Venda de produção do estabelecimento destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'ESTADUAL'),
  ('5110', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'ESTADUAL'),
  ('5114', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, remetida anteriormente em consignação mercantil', 'SAIDA', 'ESTADUAL'),
  ('5152', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'ESTADUAL'),
  ('5201', 'Devolução · Devolução de compra para industrialização ou produção rural', 'SAIDA', 'ESTADUAL'),
  ('5202', 'Devolução · Devolução de compra para comercialização', 'SAIDA', 'ESTADUAL'),
  ('5401', 'Vendas · Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'ESTADUAL'),
  ('5403', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'ESTADUAL'),
  ('5405', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído', 'SAIDA', 'ESTADUAL'),
  ('5409', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'ESTADUAL'),
  ('5411', 'Devolução · Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'ESTADUAL'),
  ('5551', 'Vendas · Venda de bem do ativo imobilizado', 'SAIDA', 'ESTADUAL'),
  ('5552', 'Transferência · Transferência de bem do ativo imobilizado', 'SAIDA', 'ESTADUAL'),
  ('5556', 'Devolução · Devolução de compra de material de uso ou consumo', 'SAIDA', 'ESTADUAL'),
  ('5901', 'Remessas · Remessa para industrialização por encomenda', 'SAIDA', 'ESTADUAL'),
  ('5902', 'Remessas · Retorno de mercadoria utilizada na industrialização por encomenda', 'SAIDA', 'ESTADUAL'),
  ('5910', 'Remessas · Remessa em bonificação, doação ou brinde', 'SAIDA', 'ESTADUAL'),
  ('5911', 'Remessas · Remessa de amostra grátis', 'SAIDA', 'ESTADUAL'),
  ('5912', 'Remessas · Remessa de mercadoria ou bem para demonstração, mostruário ou treinamento', 'SAIDA', 'ESTADUAL'),
  ('5913', 'Remessas · Retorno de mercadoria ou bem recebido para demonstração ou mostruário', 'SAIDA', 'ESTADUAL'),
  ('5915', 'Remessas · Remessa de mercadoria ou bem para conserto ou reparo', 'SAIDA', 'ESTADUAL'),
  ('5916', 'Remessas · Retorno de mercadoria ou bem recebido para conserto ou reparo', 'SAIDA', 'ESTADUAL'),
  ('5917', 'Remessas · Remessa de mercadoria em consignação mercantil ou industrial', 'SAIDA', 'ESTADUAL'),
  ('5920', 'Remessas · Remessa de vasilhame ou sacaria', 'SAIDA', 'ESTADUAL'),
  ('5927', 'Estoque · Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração', 'SAIDA', 'ESTADUAL'),
  ('5949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'ESTADUAL'),
  ('6101', 'Vendas · Venda de produção do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'INTERESTADUAL'),
  ('6103', 'Vendas · Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6104', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6107', 'Vendas · Venda de produção do estabelecimento, destinada a não contribuinte', 'SAIDA', 'INTERESTADUAL'),
  ('6108', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte', 'SAIDA', 'INTERESTADUAL'),
  ('6109', 'Vendas · Venda de produção do estabelecimento destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'INTERESTADUAL'),
  ('6110', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'INTERESTADUAL'),
  ('6201', 'Devolução · Devolução de compra para industrialização ou produção rural', 'SAIDA', 'INTERESTADUAL'),
  ('6202', 'Devolução · Devolução de compra para comercialização', 'SAIDA', 'INTERESTADUAL'),
  ('6401', 'Vendas · Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'INTERESTADUAL'),
  ('6403', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'INTERESTADUAL'),
  ('6404', 'Vendas · Venda de mercadoria sujeita ao regime de substituição tributária, cujo imposto já tenha sido retido anteriormente', 'SAIDA', 'INTERESTADUAL'),
  ('6409', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'INTERESTADUAL'),
  ('6411', 'Devolução · Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'INTERESTADUAL'),
  ('6551', 'Vendas · Venda de bem do ativo imobilizado', 'SAIDA', 'INTERESTADUAL'),
  ('6552', 'Transferência · Transferência de bem do ativo imobilizado', 'SAIDA', 'INTERESTADUAL'),
  ('6556', 'Devolução · Devolução de compra de material de uso ou consumo', 'SAIDA', 'INTERESTADUAL'),
  ('6901', 'Remessas · Remessa para industrialização por encomenda', 'SAIDA', 'INTERESTADUAL'),
  ('6902', 'Remessas · Retorno de mercadoria utilizada na industrialização por encomenda', 'SAIDA', 'INTERESTADUAL'),
  ('6910', 'Remessas · Remessa em bonificação, doação ou brinde', 'SAIDA', 'INTERESTADUAL'),
  ('6913', 'Remessas · Retorno de mercadoria ou bem recebido para demonstração ou mostruário', 'SAIDA', 'INTERESTADUAL'),
  ('6915', 'Remessas · Remessa de mercadoria ou bem para conserto ou reparo', 'SAIDA', 'INTERESTADUAL'),
  ('6916', 'Remessas · Retorno de mercadoria ou bem recebido para conserto ou reparo', 'SAIDA', 'INTERESTADUAL'),
  ('6917', 'Remessas · Remessa de mercadoria em consignação mercantil ou industrial', 'SAIDA', 'INTERESTADUAL'),
  ('6949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'INTERESTADUAL'),
  ('7102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'EXTERIOR'),
  ('7949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'EXTERIOR')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CFOP — ENTRADAS (1 = dentro do estado, 2 = interestadual, 3 = exterior)
-- ---------------------------------------------------------------------------
insert into cfop (codigo, descricao, tipo, ambito) values
  ('1101', 'Compras · Compra para industrialização ou produção rural', 'ENTRADA', 'ESTADUAL'),
  ('1102', 'Compras · Compra para comercialização', 'ENTRADA', 'ESTADUAL'),
  ('1201', 'Compras · Devolução de venda de produção do estabelecimento', 'ENTRADA', 'ESTADUAL'),
  ('1202', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros', 'ENTRADA', 'ESTADUAL'),
  ('1401', 'Compras · Compra para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1403', 'Compras · Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1409', 'Compras · Transferência para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1411', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1551', 'Compras · Compra de bem para o ativo imobilizado', 'ENTRADA', 'ESTADUAL'),
  ('1556', 'Compras · Compra de material para uso ou consumo', 'ENTRADA', 'ESTADUAL'),
  ('1902', 'Compras · Retorno de mercadoria remetida para industrialização por encomenda', 'ENTRADA', 'ESTADUAL'),
  ('1912', 'Compras · Entrada de mercadoria ou bem recebido para demonstração ou mostruário', 'ENTRADA', 'ESTADUAL'),
  ('1915', 'Compras · Entrada de mercadoria ou bem recebido para conserto ou reparo', 'ENTRADA', 'ESTADUAL'),
  ('1916', 'Compras · Retorno de mercadoria ou bem remetido para conserto ou reparo', 'ENTRADA', 'ESTADUAL'),
  ('1949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'ESTADUAL'),
  ('2101', 'Compras · Compra para industrialização ou produção rural', 'ENTRADA', 'INTERESTADUAL'),
  ('2102', 'Compras · Compra para comercialização', 'ENTRADA', 'INTERESTADUAL'),
  ('2201', 'Compras · Devolução de venda de produção do estabelecimento', 'ENTRADA', 'INTERESTADUAL'),
  ('2202', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros', 'ENTRADA', 'INTERESTADUAL'),
  ('2401', 'Compras · Compra para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2403', 'Compras · Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2411', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2551', 'Compras · Compra de bem para o ativo imobilizado', 'ENTRADA', 'INTERESTADUAL'),
  ('2556', 'Compras · Compra de material para uso ou consumo', 'ENTRADA', 'INTERESTADUAL'),
  ('2902', 'Compras · Retorno de mercadoria remetida para industrialização por encomenda', 'ENTRADA', 'INTERESTADUAL'),
  ('2915', 'Compras · Entrada de mercadoria ou bem recebido para conserto ou reparo', 'ENTRADA', 'INTERESTADUAL'),
  ('2916', 'Compras · Retorno de mercadoria ou bem remetido para conserto ou reparo', 'ENTRADA', 'INTERESTADUAL'),
  ('2949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'INTERESTADUAL'),
  ('3102', 'Compras · Compra para comercialização', 'ENTRADA', 'EXTERIOR'),
  ('3949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'EXTERIOR')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de ICMS — Tabela B (regime normal: Lucro Presumido e Lucro Real)
-- ---------------------------------------------------------------------------
insert into cst_icms (codigo, descricao) values
  ('00', 'Tributada integralmente'),
  ('10', 'Tributada e com cobrança do ICMS por substituição tributária'),
  ('20', 'Com redução de base de cálculo'),
  ('30', 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária'),
  ('40', 'Isenta'),
  ('41', 'Não tributada'),
  ('50', 'Suspensão'),
  ('51', 'Diferimento'),
  ('60', 'ICMS cobrado anteriormente por substituição tributária'),
  ('61', 'Tributação monofásica sobre combustíveis cobrada anteriormente'),
  ('70', 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária'),
  ('90', 'Outras')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CSOSN — Simples Nacional (substitui o CST de ICMS quando CRT é 1 ou 2)
-- ---------------------------------------------------------------------------
insert into csosn (codigo, descricao) values
  ('101', 'Tributada pelo Simples Nacional com permissão de crédito'),
  ('102', 'Tributada pelo Simples Nacional sem permissão de crédito'),
  ('103', 'Isenção do ICMS no Simples Nacional para faixa de receita bruta'),
  ('201', 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária'),
  ('202', 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária'),
  ('203', 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária'),
  ('300', 'Imune'),
  ('400', 'Não tributada pelo Simples Nacional'),
  ('500', 'ICMS cobrado anteriormente por substituição tributária ou por antecipação'),
  ('900', 'Outros')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de PIS/COFINS
-- ---------------------------------------------------------------------------
insert into cst_pis_cofins (codigo, descricao, grupo) values
  ('01', 'Operação tributável com alíquota básica', 'SAIDA'),
  ('02', 'Operação tributável com alíquota diferenciada', 'SAIDA'),
  ('03', 'Operação tributável com alíquota por unidade de medida de produto', 'SAIDA'),
  ('04', 'Operação tributável monofásica — revenda a alíquota zero', 'SAIDA'),
  ('05', 'Operação tributável por substituição tributária', 'SAIDA'),
  ('06', 'Operação tributável a alíquota zero', 'SAIDA'),
  ('07', 'Operação isenta da contribuição', 'SAIDA'),
  ('08', 'Operação sem incidência da contribuição', 'SAIDA'),
  ('09', 'Operação com suspensão da contribuição', 'SAIDA'),
  ('49', 'Outras operações de saída', 'SAIDA'),
  ('50', 'Operação com direito a crédito — vinculada exclusivamente a receita tributada no mercado interno', 'ENTRADA'),
  ('51', 'Operação com direito a crédito — vinculada exclusivamente a receita não tributada no mercado interno', 'ENTRADA'),
  ('52', 'Operação com direito a crédito — vinculada exclusivamente a receita de exportação', 'ENTRADA'),
  ('53', 'Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno', 'ENTRADA'),
  ('54', 'Operação com direito a crédito — vinculada a receitas tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('55', 'Operação com direito a crédito — vinculada a receitas não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('56', 'Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno e de exportação', 'ENTRADA'),
  -- Faixa 60–67: crédito PRESUMIDO. É de regime não-cumulativo (Lucro Real).
  -- No Presumido (cumulativo) a saída é CST 01 e não há crédito; no Simples, 49.
  ('60', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita tributada no mercado interno', 'ENTRADA'),
  ('61', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita não-tributada no mercado interno', 'ENTRADA'),
  ('62', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita de exportação', 'ENTRADA'),
  ('63', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno', 'ENTRADA'),
  ('64', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('65', 'Crédito presumido — operação de aquisição vinculada a receitas não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('66', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('67', 'Crédito presumido — outras operações', 'ENTRADA'),
  ('70', 'Operação de aquisição sem direito a crédito', 'ENTRADA'),
  ('71', 'Operação de aquisição com isenção', 'ENTRADA'),
  ('72', 'Operação de aquisição com suspensão', 'ENTRADA'),
  ('73', 'Operação de aquisição a alíquota zero', 'ENTRADA'),
  ('74', 'Operação de aquisição sem incidência da contribuição', 'ENTRADA'),
  ('75', 'Operação de aquisição por substituição tributária', 'ENTRADA'),
  ('98', 'Outras operações de entrada', 'ENTRADA'),
  ('99', 'Outras operações', 'SAIDA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;

-- ---------------------------------------------------------------------------
-- CST de IPI
-- ---------------------------------------------------------------------------
insert into cst_ipi (codigo, descricao, grupo) values
  ('00', 'Entrada com recuperação de crédito', 'ENTRADA'),
  ('01', 'Entrada tributada com alíquota zero', 'ENTRADA'),
  ('02', 'Entrada isenta', 'ENTRADA'),
  ('03', 'Entrada não tributada', 'ENTRADA'),
  ('04', 'Entrada imune', 'ENTRADA'),
  ('05', 'Entrada com suspensão', 'ENTRADA'),
  ('49', 'Outras entradas', 'ENTRADA'),
  ('50', 'Saída tributada', 'SAIDA'),
  ('51', 'Saída tributada com alíquota zero', 'SAIDA'),
  ('52', 'Saída isenta', 'SAIDA'),
  ('53', 'Saída não tributada', 'SAIDA'),
  ('54', 'Saída imune', 'SAIDA'),
  ('55', 'Saída com suspensão', 'SAIDA'),
  ('99', 'Outras saídas', 'SAIDA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;

-- ---------------------------------------------------------------------------
-- Origem da mercadoria — Tabela A (primeiro dígito do CST/CSOSN na NF-e)
-- ---------------------------------------------------------------------------
insert into origem_mercadoria (codigo, descricao) values
  ('0', 'Nacional, exceto as indicadas nos códigos 3 a 5'),
  ('1', 'Estrangeira — importação direta, exceto a indicada no código 6'),
  ('2', 'Estrangeira — adquirida no mercado interno, exceto a indicada no código 7'),
  ('3', 'Nacional, com conteúdo de importação superior a 40% e inferior ou igual a 70%'),
  ('4', 'Nacional, produzida com processos produtivos básicos (Decreto-Lei 288/67 e leis correlatas)'),
  ('5', 'Nacional, com conteúdo de importação inferior ou igual a 40%'),
  ('6', 'Estrangeira — importação direta, sem similar nacional, constante em lista CAMEX'),
  ('7', 'Estrangeira — adquirida no mercado interno, sem similar nacional, constante em lista CAMEX'),
  ('8', 'Nacional, com conteúdo de importação superior a 70%')
on conflict (codigo) do update set descricao = excluded.descricao;


-- ============================================================================
-- >>> supabase/migrations/fase-h-campos-financeiros.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase H — campos financeiros do Pedido/Orçamento
--
-- O formulário passou a ter descontos combinados (% + R$), frete com as chaves
-- "fixar" e "cobrar do comprador", despesas gerais, taxa de montagem, serviços
-- e comissões. Sem estas colunas os valores eram calculados na tela e perdidos
-- ao salvar — o registro reabria com os campos zerados.
--
-- discount_total, seller_commission, agent_commission e total_weight são
-- derivados: guardados para relatório e conferência histórica, mas sempre
-- recalculados pelo servidor a cada gravação (o cliente nunca dita o total).
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists freight_fixed boolean not null default false;
alter table if exists orders add column if not exists charge_freight_to_buyer boolean not null default true;
alter table if exists orders add column if not exists general_expenses numeric not null default 0;
alter table if exists orders add column if not exists assembly_fee numeric not null default 0;
alter table if exists orders add column if not exists services_amount numeric not null default 0;
alter table if exists orders add column if not exists seller_commission_percent numeric not null default 0;
alter table if exists orders add column if not exists agent_commission_percent numeric not null default 0;
alter table if exists orders add column if not exists discount_total numeric not null default 0;
alter table if exists orders add column if not exists seller_commission numeric not null default 0;
alter table if exists orders add column if not exists agent_commission numeric not null default 0;
alter table if exists orders add column if not exists total_weight numeric not null default 0;

alter table if exists quotes add column if not exists freight_fixed boolean not null default false;
alter table if exists quotes add column if not exists charge_freight_to_buyer boolean not null default true;
alter table if exists quotes add column if not exists general_expenses numeric not null default 0;
alter table if exists quotes add column if not exists assembly_fee numeric not null default 0;
alter table if exists quotes add column if not exists services_amount numeric not null default 0;
alter table if exists quotes add column if not exists seller_commission_percent numeric not null default 0;
alter table if exists quotes add column if not exists agent_commission_percent numeric not null default 0;
alter table if exists quotes add column if not exists discount_total numeric not null default 0;
alter table if exists quotes add column if not exists seller_commission numeric not null default 0;
alter table if exists quotes add column if not exists agent_commission numeric not null default 0;
alter table if exists quotes add column if not exists total_weight numeric not null default 0;


-- ============================================================================
-- >>> supabase/migrations/fase-i-informacoes-gerais.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase I — seção "Informações Gerais" do Pedido/Orçamento
--
-- O formulário ganhou um bloco de acompanhamento abaixo dos descontos e
-- despesas: hora do cadastro, status/contato do cliente, código da ordem de
-- compra do cliente, os três e-mails de envio, data de aprovação, pedido
-- relacionado, número da revisão e a chave "Gerar Ordem de Serviço".
--
-- updated_by_name guarda quem fez a última alteração ("Alterado por" na tela);
-- a data correspondente já vinha de updated_at.
--
-- approval_date é `date` e aceita null — o campo fica vazio até o orçamento ser
-- aprovado, e string vazia não faz cast para date no Postgres.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists registration_time text not null default '';
alter table if exists orders add column if not exists client_status text not null default '';
alter table if exists orders add column if not exists client_contact text not null default '';
alter table if exists orders add column if not exists customer_po_code text not null default '';
alter table if exists orders add column if not exists recipient_email text not null default '';
alter table if exists orders add column if not exists billing_recipient_email text not null default '';
alter table if exists orders add column if not exists commercial_recipient_email text not null default '';
alter table if exists orders add column if not exists approval_date date;
alter table if exists orders add column if not exists related_order_code numeric not null default 0;
alter table if exists orders add column if not exists revision_number numeric not null default 0;
alter table if exists orders add column if not exists generate_service_order boolean not null default false;
alter table if exists orders add column if not exists updated_by_name text not null default '';

alter table if exists quotes add column if not exists registration_time text not null default '';
alter table if exists quotes add column if not exists client_status text not null default '';
alter table if exists quotes add column if not exists client_contact text not null default '';
alter table if exists quotes add column if not exists customer_po_code text not null default '';
alter table if exists quotes add column if not exists recipient_email text not null default '';
alter table if exists quotes add column if not exists billing_recipient_email text not null default '';
alter table if exists quotes add column if not exists commercial_recipient_email text not null default '';
alter table if exists quotes add column if not exists approval_date date;
alter table if exists quotes add column if not exists related_order_code numeric not null default 0;
alter table if exists quotes add column if not exists revision_number numeric not null default 0;
alter table if exists quotes add column if not exists generate_service_order boolean not null default false;
alter table if exists quotes add column if not exists updated_by_name text not null default '';


-- ============================================================================
-- >>> supabase/migrations/fase-j-cabecalho-dados.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase J — cabeçalho da aba "Dados" do Pedido/Orçamento
--
-- Classificação da venda que o formulário passou a pedir junto de cliente,
-- empresa, depósito e vendedor: origem da venda (venda direta, televendas,
-- e-commerce...), categoria e tabela de preços.
--
-- sale_origin nasce com 'Venda Direta' porque é o caso normal — os registros
-- antigos, criados antes deste campo existir, ficam classificados assim em vez
-- de aparecerem em branco na tela.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists sale_origin text not null default 'Venda Direta';
alter table if exists orders add column if not exists category text not null default '';
alter table if exists orders add column if not exists price_table text not null default '';

alter table if exists quotes add column if not exists sale_origin text not null default 'Venda Direta';
alter table if exists quotes add column if not exists category text not null default '';
alter table if exists quotes add column if not exists price_table text not null default '';


-- ============================================================================
-- >>> supabase/migrations/fase-k-abas-pagamento-entrega.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase K — abas Pagamentos, Entrega e Termos e Condições do Pedido/Orçamento
--
-- São blocos de formulário (plano de conta, forma de pagamento, parcelas,
-- transportadora, endereço de entrega, termos de venda). Guardados como jsonb
-- em vez de ~30 colunas soltas: ninguém filtra pedido por "bairro de entrega",
-- e cada campo novo da tela deixaria de exigir migração.
--
-- O servidor copia chave por chave antes de gravar (salesPaymentInfo,
-- salesPaymentLines e salesDelivery em server.js) — o jsonb não é o objeto cru
-- que veio do navegador.
--
--   payment_info: objeto único   { accountPlan, paymentMethodId, paymentTerm... }
--   payments:     lista          [ { methodId, methodName, dueDate, amount, note } ]
--   delivery:     objeto único   { addressType, carrierId, zipCode, city... }
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists payment_info jsonb not null default '{}'::jsonb;
alter table if exists orders add column if not exists payments jsonb not null default '[]'::jsonb;
alter table if exists orders add column if not exists delivery jsonb not null default '{}'::jsonb;
alter table if exists orders add column if not exists sales_terms text not null default '';

alter table if exists quotes add column if not exists payment_info jsonb not null default '{}'::jsonb;
alter table if exists quotes add column if not exists payments jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists delivery jsonb not null default '{}'::jsonb;
alter table if exists quotes add column if not exists sales_terms text not null default '';


-- ============================================================================
-- >>> supabase/migrations/fase-l-controle-de-acesso.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase L — Controle de acesso (RBAC): papéis, permissões e trilha de auditoria
--
-- Tradução do schema de RBAC para a realidade deste ERP:
--
--   * O banco é PostgreSQL (Supabase), não MySQL. Tipos e sintaxe mudam:
--     TINYINT(1) -> boolean, ENUM -> check constraint, JSON -> jsonb,
--     VARBINARY(16)+INET6_ATON -> inet (nativo no Postgres),
--     AUTO_INCREMENT -> generated always as identity.
--
--   * Papéis e permissões usam o SLUG como chave primária, em vez de id
--     numérico + slug único. O código já fala em slug ('admin', 'sales.criar');
--     com id numérico toda consulta precisaria de um join só para traduzir.
--
--   * Os recursos são os módulos reais do sistema (sales, cadastros, stock,
--     finance, purchases, settings, fiscal), não reserva/hóspede.
--
-- SEGURANÇA DA MIGRAÇÃO: o seed no fim reproduz o acesso que cada usuário já
-- tem hoje (allowed_modules), com todas as ações. Ninguém perde acesso ao rodar
-- isto — o que muda é passar a EXISTIR como restringir, pela tela de usuários.
-- ---------------------------------------------------------------------------

-- 1) Usuários: bloquear sem apagar, e saber quando entrou pela última vez.
alter table if exists users add column if not exists active boolean not null default true;
alter table if exists users add column if not exists last_login_at timestamptz;

-- 2) Papéis. `system` marca o que a tela não deixa apagar/renomear.
create table if not exists roles (
  slug text primary key,
  name text not null,
  description text not null default '',
  level smallint not null default 10,
  system boolean not null default false,
  created_at timestamptz not null default now()
);

-- 3) Permissões: uma linha por ação verificável (recurso + ação).
create table if not exists permissions (
  slug text primary key,
  resource text not null,
  action text not null,
  description text not null default ''
);
create index if not exists idx_permissions_resource on permissions (resource);

-- 4) Papel -> permissões.
create table if not exists role_permissions (
  role_slug text not null references roles (slug) on delete cascade,
  permission_slug text not null references permissions (slug) on delete cascade,
  primary key (role_slug, permission_slug)
);

-- 5) Usuário -> papéis (pode ter mais de um).
create table if not exists user_roles (
  user_id text not null references users (id) on delete cascade,
  role_slug text not null references roles (slug) on delete cascade,
  granted_by text references users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_slug)
);

-- 6) Permissão pontual, sem precisar criar papel novo. NEGAR sempre vence.
create table if not exists user_permissions (
  user_id text not null references users (id) on delete cascade,
  permission_slug text not null references permissions (slug) on delete cascade,
  effect text not null default 'PERMITIR' check (effect in ('PERMITIR', 'NEGAR')),
  primary key (user_id, permission_slug)
);

-- 7) Trilha de auditoria. Registra também o que foi NEGADO — é justamente a
--    tentativa barrada que interessa numa investigação.
create table if not exists access_logs (
  id bigint generated always as identity primary key,
  user_id text references users (id) on delete set null,
  user_name text not null default '',
  action text not null,
  resource_type text not null default '',
  resource_id text not null default '',
  result text not null default 'PERMITIDO' check (result in ('PERMITIDO', 'NEGADO')),
  ip inet,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_access_logs_user on access_logs (user_id, created_at desc);
create index if not exists idx_access_logs_action on access_logs (action, created_at desc);
create index if not exists idx_access_logs_result on access_logs (result, created_at desc);

-- View das permissões efetivas (papéis + diretas, com NEGAR removendo).
-- O app não depende dela para decidir (ver lib/permissoes.js) — ela existe para
-- conferência direta no banco: "o que o fulano pode, afinal?".
create or replace view vw_user_permissions as
select u.id as user_id, p.slug as permission
from users u
join user_roles ur on ur.user_id = u.id
join role_permissions rp on rp.role_slug = ur.role_slug
join permissions p on p.slug = rp.permission_slug
where u.active
  and not exists (
    select 1 from user_permissions up
    where up.user_id = u.id and up.permission_slug = p.slug and up.effect = 'NEGAR'
  )
union
select u.id, p.slug
from users u
join user_permissions up on up.user_id = u.id and up.effect = 'PERMITIR'
join permissions p on p.slug = up.permission_slug
where u.active;

-- ---------------------------------------------------------------------------
-- SEED
-- ---------------------------------------------------------------------------
insert into roles (slug, name, description, level, system) values
  ('admin',   'Administrador', 'Acesso total ao sistema',                 100, true),
  ('gerente', 'Gerente',       'Operação completa, relatórios e exclusão',  50, false),
  ('usuario', 'Usuário',       'Acesso operacional limitado',               10, true)
on conflict (slug) do update set name = excluded.name, description = excluded.description;

-- Permissões: um módulo do ERP por recurso, quatro ações onde faz sentido.
insert into permissions (slug, resource, action, description) values
  ('dashboard.ler',   'dashboard', 'ler',     'Ver o painel inicial'),
  ('cadastros.ler',   'cadastros', 'ler',     'Ver cadastros'),
  ('cadastros.criar', 'cadastros', 'criar',   'Criar cadastro'),
  ('cadastros.editar','cadastros', 'editar',  'Editar cadastro'),
  ('cadastros.excluir','cadastros','excluir', 'Excluir cadastro'),
  ('sales.ler',       'sales',     'ler',     'Ver pedidos e orçamentos'),
  ('sales.criar',     'sales',     'criar',   'Criar pedido/orçamento'),
  ('sales.editar',    'sales',     'editar',  'Editar pedido/orçamento'),
  ('sales.excluir',   'sales',     'excluir', 'Excluir pedido/orçamento'),
  ('purchases.ler',   'purchases', 'ler',     'Ver compras'),
  ('purchases.criar', 'purchases', 'criar',   'Lançar compra'),
  ('purchases.editar','purchases', 'editar',  'Editar compra'),
  ('purchases.excluir','purchases','excluir', 'Excluir compra'),
  ('stock.ler',       'stock',     'ler',     'Ver estoque'),
  ('stock.criar',     'stock',     'criar',   'Lançar movimentação'),
  ('stock.editar',    'stock',     'editar',  'Editar estoque'),
  ('stock.excluir',   'stock',     'excluir', 'Excluir movimentação'),
  ('finance.ler',     'finance',   'ler',     'Ver financeiro'),
  ('finance.criar',   'finance',   'criar',   'Lançar no financeiro'),
  ('finance.editar',  'finance',   'editar',  'Editar lançamento'),
  ('finance.excluir', 'finance',   'excluir', 'Excluir lançamento'),
  ('settings.ler',    'settings',  'ler',     'Ver configurações'),
  ('settings.editar', 'settings',  'editar',  'Alterar configurações'),
  ('usuarios.gerenciar','usuarios','gerenciar','Criar/editar usuários, papéis e permissões'),
  ('auditoria.ler',   'auditoria', 'ler',     'Ver a trilha de auditoria'),
  -- Fiscal já tinha permissão por ação antes deste RBAC (users.fiscal_permissions).
  -- Entram aqui com os mesmos nomes para o controle ficar num lugar só.
  ('fiscal.visualizar','fiscal','visualizar','Ver dados fiscais'),
  ('fiscal.criar',    'fiscal',   'criar',    'Criar registro fiscal'),
  ('fiscal.editar',   'fiscal',   'editar',   'Editar registro fiscal'),
  ('fiscal.emitir',   'fiscal',   'emitir',   'Emitir NF-e'),
  ('fiscal.cancelar', 'fiscal',   'cancelar', 'Cancelar NF-e'),
  ('fiscal.cce',      'fiscal',   'cce',      'Emitir carta de correção'),
  ('fiscal.inutilizar','fiscal',  'inutilizar','Inutilizar numeração'),
  ('fiscal.configurar','fiscal',  'configurar','Configurar empresa/estabelecimento'),
  ('fiscal.regras',   'fiscal',   'regras',   'Regras fiscais'),
  ('fiscal.certificado','fiscal', 'certificado','Certificado digital'),
  ('fiscal.documentos_recebidos','fiscal','documentos_recebidos','Documentos recebidos'),
  ('fiscal.manifestar','fiscal',  'manifestar','Manifestar documentos'),
  ('fiscal.xml',      'fiscal',   'xml',      'Baixar XML'),
  ('fiscal.danfe',    'fiscal',   'danfe',    'Baixar DANFE'),
  ('fiscal.auditoria','fiscal',   'auditoria','Auditoria fiscal')
on conflict (slug) do update set description = excluded.description;

-- USUÁRIO: opera, mas não exclui, não vê financeiro e não mexe em usuários.
insert into role_permissions (role_slug, permission_slug)
select 'usuario', slug from permissions
where slug in ('dashboard.ler',
               'sales.ler', 'sales.criar', 'sales.editar',
               'cadastros.ler', 'cadastros.criar', 'cadastros.editar',
               'stock.ler', 'purchases.ler')
on conflict do nothing;

-- GERENTE: tudo do usuário + excluir + financeiro + auditoria. Sem gerenciar usuários.
insert into role_permissions (role_slug, permission_slug)
select 'gerente', slug from permissions
where resource in ('dashboard', 'sales', 'cadastros', 'stock', 'purchases', 'finance')
   or slug = 'auditoria.ler'
on conflict do nothing;

-- ADMIN não recebe lista: o atalho de administrador libera tudo (mesma regra da
-- função usuario_pode() do schema original).

-- Usuários existentes ganham papel conforme o `role` que já tinham.
insert into user_roles (user_id, role_slug)
select id, case when role = 'admin' then 'admin' else 'usuario' end from users
on conflict do nothing;

-- E mantêm exatamente o acesso de hoje: uma permissão direta para cada ação dos
-- módulos que já estavam liberados em allowed_modules. Sem isto, quem hoje
-- exclui um pedido perderia a exclusão no instante em que a migração rodasse.
insert into user_permissions (user_id, permission_slug, effect)
select u.id, p.slug, 'PERMITIR'
from users u
join permissions p on p.resource = any (u.allowed_modules)
where u.role <> 'admin'
on conflict do nothing;


-- ============================================================================
-- >>> supabase/migrations/fase-m-financeiro-no-supabase.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase M — Financeiro sai do data/db.json e passa a viver no Supabase
--
-- >>> SUPERADA PELA FASE N: a única instrução deste arquivo (derrubar a FK de
-- >>> nfe_id) foi desfeita quando a NF-e também foi para o Supabase e a nota
-- >>> passou a ser gravada antes das parcelas. Rode fase-n-nfe-no-supabase.sql;
-- >>> este arquivo fica como registro do porquê a FK chegou a ser derrubada.
--
-- As tabelas (financial_entries, financial_payments, financial_categories,
-- cost_centers, bank_accounts) já existiam no schema desde a Fase A, mas nenhuma
-- rota as usava: o módulo inteiro lia e gravava no arquivo local. Esta fase é a
-- ligação — e o SQL abaixo é o único ajuste de estrutura que ela precisa.
--
-- POR QUE DERRUBAR A FK DE nfe_id:
--
-- financial_entries.nfe_id referencia nfes(id). Só que a NF-e ainda mora no
-- db.json: emitir uma nota grava a nota no arquivo e as parcelas no Supabase.
-- Com a FK no lugar, o Postgres recusaria as parcelas — a nota que elas
-- apontam não existe na tabela dele — e a emissão quebraria.
--
-- O vínculo continua existindo e sendo usado (cancelar a NF-e cancela as
-- parcelas, por nfe_id); o que se perde é a checagem do banco, exatamente como
-- já acontece com client_supplier_id, que aponta ora para people, ora para
-- cnpjs e por isso também não tem FK.
--
-- Quando a NF-e for para o Supabase (próxima fase), a FK volta com:
--   alter table financial_entries
--     add constraint financial_entries_nfe_id_fkey
--     foreign key (nfe_id) references nfes(id);
-- ---------------------------------------------------------------------------
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

-- O modelo antigo do arquivo gravava lançamento de venda/compra sem vencimento
-- (só `date`). A coluna é not null, então esses casos passam a repetir a data —
-- é o que createFinancialEntry já faz (`due_date: payload.dueDate || payload.date`).
-- Nada a alterar aqui: fica registrado para quem for ler os dados depois.


-- ============================================================================
-- >>> supabase/migrations/fase-n-nfe-no-supabase.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase N — NF-e sai do data/db.json e passa a viver no Supabase
--
-- As tabelas `nfes` e `nfe_items` já existiam desde a Fase A, sem nenhuma rota
-- usando. Agora emitir, listar, abrir e cancelar NF-e passa pelo banco.
--
-- Com a nota no Supabase, a FK que a Fase M precisou derrubar volta: uma
-- parcela só pode apontar para uma NF-e que exista de verdade. É a checagem que
-- impede parcela órfã — e parcela órfã de documento fiscal é exatamente o tipo
-- de inconsistência que ninguém percebe até a conferência do contador.
--
-- O `not valid` é de propósito: valida da migração para frente sem varrer as
-- linhas antigas, para o caso de haver parcela gravada durante a janela em que
-- a Fase M rodou e esta ainda não. Para exigir a checagem também no passado
-- (recomendado depois de conferir que não sobrou nada), rode:
--
--   alter table financial_entries validate constraint financial_entries_nfe_id_fkey;
--
-- Se essa validação acusar erro, existe parcela apontando para NF-e que não
-- está no banco — investigue antes de forçar.
-- ---------------------------------------------------------------------------
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

alter table if exists financial_entries
  add constraint financial_entries_nfe_id_fkey
  foreign key (nfe_id) references nfes (id)
  not valid;

-- A listagem de NF-e ordena por data e filtra por status; os itens são sempre
-- buscados por nota.
create index if not exists idx_nfes_date on nfes (date desc);
create index if not exists idx_nfes_status on nfes (status);


-- ============================================================================
-- >>> supabase/migrations/fase-o-pedido-gera-financeiro.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase O — pedido faturado gera contas a receber
--
-- Até aqui, faturar um pedido mexia no estoque e parava por aí: o Financeiro
-- nunca ficava sabendo. Quem quisesse a receita tinha que lançar à mão, e
-- pedido cancelado deixava a cobrança viva.
--
-- `finance_applied` é a irmã de `stock_applied`: marca que aquele pedido JÁ
-- gerou as parcelas. Sem ela, salvar de novo um pedido já faturado geraria
-- cobrança dobrada — e cobrança dobrada é o tipo de erro que chega no cliente.
--
-- As parcelas saem da aba "Pagamentos" do pedido quando ela estiver preenchida
-- (uma conta a receber por linha, com a forma e o vencimento combinados); sem
-- nada preenchido, sai uma parcela única no total da venda. O vínculo é o
-- `reference_id` do lançamento, que guarda o id do pedido.
--
-- quotes recebe a coluna junto porque orders e quotes compartilham o mesmo
-- construtor de linha no código — orçamento nunca fatura, então lá ela fica
-- sempre falsa.
-- ---------------------------------------------------------------------------
alter table if exists orders add column if not exists finance_applied boolean not null default false;
alter table if exists quotes add column if not exists finance_applied boolean not null default false;

-- O cancelamento de um pedido procura as parcelas dele por reference_id.
create index if not exists idx_financial_entries_reference_id on financial_entries (reference_id);


-- ============================================================================
-- >>> supabase/migrations/fase-p-vinculo-pedido-nfe.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase P — vínculo entre o Pedido e a NF-e
--
-- O menu da NF-e já tinha a ação "Ir para a venda", com a checagem
-- `nfe.orderId ? true : 'Esta NF-e não tem venda vinculada.'` — só que orderId
-- nunca foi gravado por lugar nenhum. A ação nascia permanentemente desligada.
--
-- Com o fluxo Pedido -> Aprovar -> Financeiro -> Gerar NF-e, o vínculo passa a
-- existir de verdade, e é guardado nos DOIS sentidos de propósito:
--
--   nfes.order_id  — de qual pedido esta nota saiu (a nota é o documento final,
--                    e é dela que se pergunta a origem numa conferência)
--   orders.nfe_id  — qual nota já foi emitida para este pedido, que é o que
--                    impede emitir a segunda por engano e o que permite à tela
--                    do pedido mostrar a nota sem varrer a tabela inteira
--
-- Sem FK rígida em nenhum dos dois lados: os registros nascem em rotas
-- diferentes e em momentos diferentes, e uma FK aqui só transformaria ordem de
-- gravação em erro de banco. A consistência é garantida no servidor, que grava
-- os dois lados na mesma rota de emissão.
-- ---------------------------------------------------------------------------
alter table if exists nfes add column if not exists order_id text;
alter table if exists orders add column if not exists nfe_id text;

create index if not exists idx_nfes_order_id on nfes (order_id);


-- ============================================================================
-- >>> supabase/migrations/fase-q-tabelas-fiscais.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase Q — tabelas fiscais de referência (CFOP, CST, CSOSN, origem)
--
-- Hoje CFOP e NCM são texto livre digitado à mão na emissão da NF-e. Errar um
-- dígito num documento fiscal não dá erro na tela: dá problema na apuração,
-- meses depois. Com as tabelas, o campo vira seleção com descrição ao lado.
--
-- SÃO CÓDIGOS OFICIAIS, não interpretação: o conteúdo abaixo é o texto da
-- legislação (Convênio S/Nº 1970 para CFOP; Anexos do Convênio 4/81 e da Lei
-- do Simples para CST/CSOSN). Nada aqui decide QUAL código se aplica ao seu
-- caso — isso é a regra_fiscal, e continua sendo assunto do seu contador.
--
-- ÚNICA EXCEÇÃO: a descrição do CFOP vem com a categoria na frente, separada
-- por ' · ' — "Vendas · Venda de produção do estabelecimento". O que vem ANTES
-- do ' · ' é agrupamento nosso, para o usuário achar o código numa lista de
-- 58 opções; o que vem DEPOIS é o texto da lei, sem alteração. A categoria não
-- virou coluna porque isso exigiria DDL, e a tela separa no ' · ' para montar
-- os grupos do select — mudar o separador quebra esse agrupamento.
--
-- SOBRE O CFOP: o primeiro dígito é o âmbito da operação e os três últimos
-- identificam a natureza:
--     1/2/3 = ENTRADA  (estadual / interestadual / exterior)
--     5/6/7 = SAÍDA    (estadual / interestadual / exterior)
-- Os três últimos dígitos NÃO significam a mesma coisa na entrada e na saída
-- (102 na saída é "venda de mercadoria de terceiros"; na entrada é "compra
-- para comercialização"), por isso as duas listas são separadas e cada código
-- é gravado por extenso — nada é gerado por combinação.
--
-- A lista é o subconjunto usado em comércio/revenda, incluindo substituição
-- tributária, conserto e ativo imobilizado. A tabela completa tem centenas de
-- códigos; acrescentar os que faltarem é um insert, sem mexer em código.
-- ---------------------------------------------------------------------------

create table if not exists cfop (
  codigo char(4) primary key,
  descricao text not null,
  -- ENTRADA ou SAIDA, derivado do primeiro dígito
  tipo text not null check (tipo in ('ENTRADA', 'SAIDA')),
  -- ESTADUAL (1/5), INTERESTADUAL (2/6) ou EXTERIOR (3/7)
  ambito text not null check (ambito in ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR')),
  ativo boolean not null default true
);
create index if not exists idx_cfop_tipo on cfop (tipo, ambito);

create table if not exists cst_icms (
  codigo char(2) primary key,
  descricao text not null
);

create table if not exists csosn (
  codigo char(3) primary key,
  descricao text not null
);

create table if not exists cst_pis_cofins (
  codigo char(2) primary key,
  descricao text not null,
  -- ENTRADA (créditos) ou SAIDA (débitos): a mesma tabela atende os dois
  grupo text not null check (grupo in ('ENTRADA', 'SAIDA'))
);

create table if not exists cst_ipi (
  codigo char(2) primary key,
  descricao text not null,
  grupo text not null check (grupo in ('ENTRADA', 'SAIDA'))
);

create table if not exists origem_mercadoria (
  codigo char(1) primary key,
  descricao text not null
);

-- ---------------------------------------------------------------------------
-- CFOP — SAÍDAS (5 = dentro do estado, 6 = interestadual)
-- ---------------------------------------------------------------------------
insert into cfop (codigo, descricao, tipo, ambito) values
  ('5101', 'Vendas · Venda de produção do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'ESTADUAL'),
  ('5103', 'Vendas · Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5104', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5109', 'Vendas · Venda de produção do estabelecimento destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'ESTADUAL'),
  ('5110', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'ESTADUAL'),
  ('5114', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, remetida anteriormente em consignação mercantil', 'SAIDA', 'ESTADUAL'),
  ('5152', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'ESTADUAL'),
  ('5201', 'Devolução · Devolução de compra para industrialização ou produção rural', 'SAIDA', 'ESTADUAL'),
  ('5202', 'Devolução · Devolução de compra para comercialização', 'SAIDA', 'ESTADUAL'),
  ('5401', 'Vendas · Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'ESTADUAL'),
  ('5403', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'ESTADUAL'),
  ('5405', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído', 'SAIDA', 'ESTADUAL'),
  ('5409', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'ESTADUAL'),
  ('5411', 'Devolução · Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'ESTADUAL'),
  ('5551', 'Vendas · Venda de bem do ativo imobilizado', 'SAIDA', 'ESTADUAL'),
  ('5552', 'Transferência · Transferência de bem do ativo imobilizado', 'SAIDA', 'ESTADUAL'),
  ('5556', 'Devolução · Devolução de compra de material de uso ou consumo', 'SAIDA', 'ESTADUAL'),
  ('5901', 'Remessas · Remessa para industrialização por encomenda', 'SAIDA', 'ESTADUAL'),
  ('5902', 'Remessas · Retorno de mercadoria utilizada na industrialização por encomenda', 'SAIDA', 'ESTADUAL'),
  ('5910', 'Remessas · Remessa em bonificação, doação ou brinde', 'SAIDA', 'ESTADUAL'),
  ('5911', 'Remessas · Remessa de amostra grátis', 'SAIDA', 'ESTADUAL'),
  ('5912', 'Remessas · Remessa de mercadoria ou bem para demonstração, mostruário ou treinamento', 'SAIDA', 'ESTADUAL'),
  ('5913', 'Remessas · Retorno de mercadoria ou bem recebido para demonstração ou mostruário', 'SAIDA', 'ESTADUAL'),
  ('5915', 'Remessas · Remessa de mercadoria ou bem para conserto ou reparo', 'SAIDA', 'ESTADUAL'),
  ('5916', 'Remessas · Retorno de mercadoria ou bem recebido para conserto ou reparo', 'SAIDA', 'ESTADUAL'),
  ('5917', 'Remessas · Remessa de mercadoria em consignação mercantil ou industrial', 'SAIDA', 'ESTADUAL'),
  ('5920', 'Remessas · Remessa de vasilhame ou sacaria', 'SAIDA', 'ESTADUAL'),
  ('5927', 'Estoque · Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração', 'SAIDA', 'ESTADUAL'),
  ('5949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'ESTADUAL'),
  ('6101', 'Vendas · Venda de produção do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'INTERESTADUAL'),
  ('6103', 'Vendas · Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6104', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6107', 'Vendas · Venda de produção do estabelecimento, destinada a não contribuinte', 'SAIDA', 'INTERESTADUAL'),
  ('6108', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte', 'SAIDA', 'INTERESTADUAL'),
  ('6109', 'Vendas · Venda de produção do estabelecimento destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'INTERESTADUAL'),
  ('6110', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'INTERESTADUAL'),
  ('6201', 'Devolução · Devolução de compra para industrialização ou produção rural', 'SAIDA', 'INTERESTADUAL'),
  ('6202', 'Devolução · Devolução de compra para comercialização', 'SAIDA', 'INTERESTADUAL'),
  ('6401', 'Vendas · Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'INTERESTADUAL'),
  ('6403', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'INTERESTADUAL'),
  ('6404', 'Vendas · Venda de mercadoria sujeita ao regime de substituição tributária, cujo imposto já tenha sido retido anteriormente', 'SAIDA', 'INTERESTADUAL'),
  ('6409', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'INTERESTADUAL'),
  ('6411', 'Devolução · Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'INTERESTADUAL'),
  ('6551', 'Vendas · Venda de bem do ativo imobilizado', 'SAIDA', 'INTERESTADUAL'),
  ('6552', 'Transferência · Transferência de bem do ativo imobilizado', 'SAIDA', 'INTERESTADUAL'),
  ('6556', 'Devolução · Devolução de compra de material de uso ou consumo', 'SAIDA', 'INTERESTADUAL'),
  ('6901', 'Remessas · Remessa para industrialização por encomenda', 'SAIDA', 'INTERESTADUAL'),
  ('6902', 'Remessas · Retorno de mercadoria utilizada na industrialização por encomenda', 'SAIDA', 'INTERESTADUAL'),
  ('6910', 'Remessas · Remessa em bonificação, doação ou brinde', 'SAIDA', 'INTERESTADUAL'),
  ('6913', 'Remessas · Retorno de mercadoria ou bem recebido para demonstração ou mostruário', 'SAIDA', 'INTERESTADUAL'),
  ('6915', 'Remessas · Remessa de mercadoria ou bem para conserto ou reparo', 'SAIDA', 'INTERESTADUAL'),
  ('6916', 'Remessas · Retorno de mercadoria ou bem recebido para conserto ou reparo', 'SAIDA', 'INTERESTADUAL'),
  ('6917', 'Remessas · Remessa de mercadoria em consignação mercantil ou industrial', 'SAIDA', 'INTERESTADUAL'),
  ('6949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'INTERESTADUAL'),
  ('7102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'EXTERIOR'),
  ('7949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'EXTERIOR')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CFOP — ENTRADAS (1 = dentro do estado, 2 = interestadual, 3 = exterior)
-- ---------------------------------------------------------------------------
insert into cfop (codigo, descricao, tipo, ambito) values
  ('1101', 'Compras · Compra para industrialização ou produção rural', 'ENTRADA', 'ESTADUAL'),
  ('1102', 'Compras · Compra para comercialização', 'ENTRADA', 'ESTADUAL'),
  ('1201', 'Compras · Devolução de venda de produção do estabelecimento', 'ENTRADA', 'ESTADUAL'),
  ('1202', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros', 'ENTRADA', 'ESTADUAL'),
  ('1401', 'Compras · Compra para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1403', 'Compras · Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1409', 'Compras · Transferência para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1411', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1551', 'Compras · Compra de bem para o ativo imobilizado', 'ENTRADA', 'ESTADUAL'),
  ('1556', 'Compras · Compra de material para uso ou consumo', 'ENTRADA', 'ESTADUAL'),
  ('1902', 'Compras · Retorno de mercadoria remetida para industrialização por encomenda', 'ENTRADA', 'ESTADUAL'),
  ('1912', 'Compras · Entrada de mercadoria ou bem recebido para demonstração ou mostruário', 'ENTRADA', 'ESTADUAL'),
  ('1915', 'Compras · Entrada de mercadoria ou bem recebido para conserto ou reparo', 'ENTRADA', 'ESTADUAL'),
  ('1916', 'Compras · Retorno de mercadoria ou bem remetido para conserto ou reparo', 'ENTRADA', 'ESTADUAL'),
  ('1949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'ESTADUAL'),
  ('2101', 'Compras · Compra para industrialização ou produção rural', 'ENTRADA', 'INTERESTADUAL'),
  ('2102', 'Compras · Compra para comercialização', 'ENTRADA', 'INTERESTADUAL'),
  ('2201', 'Compras · Devolução de venda de produção do estabelecimento', 'ENTRADA', 'INTERESTADUAL'),
  ('2202', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros', 'ENTRADA', 'INTERESTADUAL'),
  ('2401', 'Compras · Compra para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2403', 'Compras · Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2411', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2551', 'Compras · Compra de bem para o ativo imobilizado', 'ENTRADA', 'INTERESTADUAL'),
  ('2556', 'Compras · Compra de material para uso ou consumo', 'ENTRADA', 'INTERESTADUAL'),
  ('2902', 'Compras · Retorno de mercadoria remetida para industrialização por encomenda', 'ENTRADA', 'INTERESTADUAL'),
  ('2915', 'Compras · Entrada de mercadoria ou bem recebido para conserto ou reparo', 'ENTRADA', 'INTERESTADUAL'),
  ('2916', 'Compras · Retorno de mercadoria ou bem remetido para conserto ou reparo', 'ENTRADA', 'INTERESTADUAL'),
  ('2949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'INTERESTADUAL'),
  ('3102', 'Compras · Compra para comercialização', 'ENTRADA', 'EXTERIOR'),
  ('3949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'EXTERIOR')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de ICMS — Tabela B (regime normal: Lucro Presumido e Lucro Real)
-- ---------------------------------------------------------------------------
insert into cst_icms (codigo, descricao) values
  ('00', 'Tributada integralmente'),
  ('10', 'Tributada e com cobrança do ICMS por substituição tributária'),
  ('20', 'Com redução de base de cálculo'),
  ('30', 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária'),
  ('40', 'Isenta'),
  ('41', 'Não tributada'),
  ('50', 'Suspensão'),
  ('51', 'Diferimento'),
  ('60', 'ICMS cobrado anteriormente por substituição tributária'),
  ('70', 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária'),
  ('90', 'Outras')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CSOSN — Simples Nacional (substitui o CST de ICMS quando CRT é 1 ou 2)
-- ---------------------------------------------------------------------------
insert into csosn (codigo, descricao) values
  ('101', 'Tributada pelo Simples Nacional com permissão de crédito'),
  ('102', 'Tributada pelo Simples Nacional sem permissão de crédito'),
  ('103', 'Isenção do ICMS no Simples Nacional para faixa de receita bruta'),
  ('201', 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária'),
  ('202', 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária'),
  ('203', 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária'),
  ('300', 'Imune'),
  ('400', 'Não tributada pelo Simples Nacional'),
  ('500', 'ICMS cobrado anteriormente por substituição tributária ou por antecipação'),
  ('900', 'Outros')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de PIS/COFINS
-- ---------------------------------------------------------------------------
insert into cst_pis_cofins (codigo, descricao, grupo) values
  ('01', 'Operação tributável com alíquota básica', 'SAIDA'),
  ('02', 'Operação tributável com alíquota diferenciada', 'SAIDA'),
  ('03', 'Operação tributável com alíquota por unidade de medida de produto', 'SAIDA'),
  ('04', 'Operação tributável monofásica — revenda a alíquota zero', 'SAIDA'),
  ('05', 'Operação tributável por substituição tributária', 'SAIDA'),
  ('06', 'Operação tributável a alíquota zero', 'SAIDA'),
  ('07', 'Operação isenta da contribuição', 'SAIDA'),
  ('08', 'Operação sem incidência da contribuição', 'SAIDA'),
  ('09', 'Operação com suspensão da contribuição', 'SAIDA'),
  ('49', 'Outras operações de saída', 'SAIDA'),
  ('50', 'Operação com direito a crédito — vinculada exclusivamente a receita tributada no mercado interno', 'ENTRADA'),
  ('51', 'Operação com direito a crédito — vinculada exclusivamente a receita não tributada no mercado interno', 'ENTRADA'),
  ('53', 'Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno', 'ENTRADA'),
  ('56', 'Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('70', 'Operação de aquisição sem direito a crédito', 'ENTRADA'),
  ('71', 'Operação de aquisição com isenção', 'ENTRADA'),
  ('72', 'Operação de aquisição com suspensão', 'ENTRADA'),
  ('73', 'Operação de aquisição a alíquota zero', 'ENTRADA'),
  ('74', 'Operação de aquisição sem incidência da contribuição', 'ENTRADA'),
  ('75', 'Operação de aquisição por substituição tributária', 'ENTRADA'),
  ('98', 'Outras operações de entrada', 'ENTRADA'),
  ('99', 'Outras operações', 'SAIDA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;

-- ---------------------------------------------------------------------------
-- CST de IPI
-- ---------------------------------------------------------------------------
insert into cst_ipi (codigo, descricao, grupo) values
  ('00', 'Entrada com recuperação de crédito', 'ENTRADA'),
  ('01', 'Entrada tributada com alíquota zero', 'ENTRADA'),
  ('02', 'Entrada isenta', 'ENTRADA'),
  ('03', 'Entrada não tributada', 'ENTRADA'),
  ('04', 'Entrada imune', 'ENTRADA'),
  ('05', 'Entrada com suspensão', 'ENTRADA'),
  ('49', 'Outras entradas', 'ENTRADA'),
  ('50', 'Saída tributada', 'SAIDA'),
  ('51', 'Saída tributada com alíquota zero', 'SAIDA'),
  ('52', 'Saída isenta', 'SAIDA'),
  ('53', 'Saída não tributada', 'SAIDA'),
  ('54', 'Saída imune', 'SAIDA'),
  ('55', 'Saída com suspensão', 'SAIDA'),
  ('99', 'Outras saídas', 'SAIDA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;

-- ---------------------------------------------------------------------------
-- Origem da mercadoria — Tabela A (primeiro dígito do CST/CSOSN na NF-e)
-- ---------------------------------------------------------------------------
insert into origem_mercadoria (codigo, descricao) values
  ('0', 'Nacional, exceto as indicadas nos códigos 3 a 5'),
  ('1', 'Estrangeira — importação direta, exceto a indicada no código 6'),
  ('2', 'Estrangeira — adquirida no mercado interno, exceto a indicada no código 7'),
  ('3', 'Nacional, com conteúdo de importação superior a 40% e inferior ou igual a 70%'),
  ('4', 'Nacional, produzida com processos produtivos básicos (Decreto-Lei 288/67 e leis correlatas)'),
  ('5', 'Nacional, com conteúdo de importação inferior ou igual a 40%'),
  ('6', 'Estrangeira — importação direta, sem similar nacional, constante em lista CAMEX'),
  ('7', 'Estrangeira — adquirida no mercado interno, sem similar nacional, constante em lista CAMEX'),
  ('8', 'Nacional, com conteúdo de importação superior a 70%')
on conflict (codigo) do update set descricao = excluded.descricao;


-- ============================================================================
-- >>> supabase/migrations/fase-r-modulos-novos.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase R — tabelas dos módulos novos (Frota, RH, PCP, Contratos, CRM)
--
-- Os módulos já existem no menu, com Área de Trabalho e controle de acesso; o
-- que falta é onde gravar. Enquanto esta migração não roda, cada tela desses
-- módulos abre dizendo exatamente isso — não mostra tabela vazia fingindo que
-- o cadastro funciona.
--
-- SOBRE OS CAMPOS: é o mínimo para as telas existirem, não o cadastro completo
-- do seu processo. Acrescentar coluna depois é um ALTER TABLE; o que não dá é
-- descobrir tarde que a tabela nem existia.
--
-- O CRM É DIFERENTE DE PROPÓSITO: por decisão de projeto ele NÃO guarda
-- oportunidade nem conta aqui — lê do CRM externo. Duplicar o cadastro criaria
-- duas fontes da verdade divergindo, e ninguém saberia qual está certa. Por
-- isso o CRM ganha só a tabela de CONEXÃO (endereço e credencial do outro
-- sistema), e nada de dados de negócio.
-- ---------------------------------------------------------------------------

-- =============================== FROTA =====================================
create table if not exists fleet_vehicles (
  id text primary key,
  plate text not null,
  description text,
  brand text,
  model text,
  year integer,
  -- Quilometragem atual: os abastecimentos e as manutenções escrevem aqui.
  odometer numeric(12,1) not null default 0,
  status text not null default 'ativo' check (status in ('ativo', 'manutencao', 'inativo', 'vendido')),
  created_at timestamptz not null default now()
);
create unique index if not exists idx_fleet_plate on fleet_vehicles (upper(plate));

create table if not exists fleet_maintenances (
  id text primary key,
  vehicle_id text not null references fleet_vehicles(id) on delete cascade,
  date date not null,
  kind text not null default 'preventiva' check (kind in ('preventiva', 'corretiva')),
  description text,
  supplier_name text,
  cost numeric(14,2) not null default 0,
  odometer numeric(12,1),
  created_at timestamptz not null default now()
);
create index if not exists idx_fleet_maint_vehicle on fleet_maintenances (vehicle_id, date desc);

create table if not exists fleet_refuels (
  id text primary key,
  vehicle_id text not null references fleet_vehicles(id) on delete cascade,
  date date not null,
  liters numeric(10,2) not null default 0,
  total numeric(14,2) not null default 0,
  odometer numeric(12,1),
  station text,
  created_at timestamptz not null default now()
);
create index if not exists idx_fleet_refuel_vehicle on fleet_refuels (vehicle_id, date desc);

-- ================================= RH ======================================
create table if not exists hr_positions (
  id text primary key,
  name text not null,
  description text,
  salary_min numeric(14,2),
  salary_max numeric(14,2),
  active boolean not null default true
);

create table if not exists hr_employees (
  id text primary key,
  name text not null,
  document text,
  position_id text references hr_positions(id) on delete set null,
  admitted_at date,
  dismissed_at date,
  salary numeric(14,2),
  email text,
  phone text,
  status text not null default 'ativo' check (status in ('ativo', 'afastado', 'desligado')),
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_emp_status on hr_employees (status, name);

create table if not exists hr_leaves (
  id text primary key,
  employee_id text not null references hr_employees(id) on delete cascade,
  kind text not null check (kind in ('ferias', 'licenca', 'afastamento', 'falta')),
  start_date date not null,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_leave_emp on hr_leaves (employee_id, start_date desc);

create table if not exists hr_time_entries (
  id text primary key,
  employee_id text not null references hr_employees(id) on delete cascade,
  date date not null,
  entrada time,
  saida_almoco time,
  volta_almoco time,
  saida time,
  notes text
);
create unique index if not exists idx_hr_time_unico on hr_time_entries (employee_id, date);

-- ================================= PCP =====================================
-- Estrutura de produto: o que cada produto consome para ser feito.
-- product_id e component_id apontam para products, que já existe.
create table if not exists pcp_bom (
  id text primary key,
  product_id text not null,
  component_id text not null,
  quantity numeric(14,4) not null default 1,
  loss_percent numeric(6,2) not null default 0,
  -- Um componente não pode aparecer duas vezes na mesma ficha.
  constraint pcp_bom_unico unique (product_id, component_id)
);
create index if not exists idx_pcp_bom_produto on pcp_bom (product_id);

create table if not exists pcp_orders (
  id text primary key,
  code integer,
  product_id text not null,
  quantity numeric(14,4) not null default 0,
  quantity_done numeric(14,4) not null default 0,
  status text not null default 'aberta' check (status in ('aberta', 'em_producao', 'concluida', 'cancelada')),
  start_date date,
  due_date date,
  -- Pedido de venda que originou a ordem, quando houver.
  order_id text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pcp_orders_status on pcp_orders (status, due_date);

create table if not exists pcp_entries (
  id text primary key,
  order_id text not null references pcp_orders(id) on delete cascade,
  date date not null,
  quantity numeric(14,4) not null default 0,
  employee_id text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pcp_entries_order on pcp_entries (order_id, date desc);

-- ============================== CONTRATOS ==================================
create table if not exists contract_templates (
  id text primary key,
  name text not null,
  body text,
  active boolean not null default true
);

create table if not exists contracts (
  id text primary key,
  code integer,
  title text not null,
  -- 'cliente' ou 'fornecedor': o mesmo contrato pode ser receita ou despesa.
  party_kind text not null default 'cliente' check (party_kind in ('cliente', 'fornecedor')),
  party_id text,
  party_name text,
  start_date date,
  end_date date,
  value numeric(14,2) not null default 0,
  -- Periodicidade da cobrança; 'unico' para contrato sem recorrência.
  billing_cycle text not null default 'mensal' check (billing_cycle in ('unico', 'mensal', 'trimestral', 'semestral', 'anual')),
  auto_renew boolean not null default false,
  status text not null default 'ativo' check (status in ('rascunho', 'ativo', 'suspenso', 'encerrado')),
  template_id text references contract_templates(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_contracts_venc on contracts (status, end_date);

-- ================================= CRM =====================================
-- Só a conexão. Nada de oportunidade ou conta: quem guarda isso é o CRM
-- externo, e este módulo lê de lá.
create table if not exists crm_connection (
  id integer primary key default 1,
  base_url text,
  api_token text,
  -- Última vez que o teste de conexão passou, para a tela dizer se está no ar.
  last_ok_at timestamptz,
  last_error text,
  active boolean not null default false,
  constraint crm_connection_linha_unica check (id = 1)
);


-- ============================================================================
-- >>> supabase/migrations/fase-s-permissoes-modulos-novos.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase S — permissões dos módulos novos
--
-- A Fase R criou as tabelas de Frota, RH, PCP, Contratos e CRM, e o código
-- passou a exigir permissões como fleet.ler e contracts.criar. Só que essas
-- linhas nunca foram criadas na tabela `permissions`.
--
-- O efeito era silencioso e total: usuarioPode() exige que a permissão esteja
-- entre as efetivas do usuário, e ela não existia nem para ser concedida. Ou
-- seja, os seis módulos ficavam inacessíveis para QUALQUER pessoa que não fosse
-- administrador — e nem a tela de Papéis e Permissões tinha o que mostrar,
-- porque ela lista o que está aqui.
--
-- São INSERTs, não DDL: dá para rodar por aqui ou pelo SQL Editor, tanto faz.
--
-- Sobre o CRM: ele não cria nem exclui nada (é ponte para o sistema externo),
-- então recebe só ler e editar — editar é o que salva o endereço e o token da
-- conexão. Relatórios só lê, porque relatório não grava.
-- ---------------------------------------------------------------------------

insert into permissions (slug, resource, action, description) values
  ('reports.ler',      'reports',   'ler',     'Ver relatórios'),

  ('fleet.ler',        'fleet',     'ler',     'Ver a frota'),
  ('fleet.criar',      'fleet',     'criar',   'Cadastrar veículo, manutenção ou abastecimento'),
  ('fleet.editar',     'fleet',     'editar',  'Editar registros da frota'),
  ('fleet.excluir',    'fleet',     'excluir', 'Excluir registros da frota'),

  ('crm.ler',          'crm',       'ler',     'Ver os dados vindos do CRM externo'),
  ('crm.editar',       'crm',       'editar',  'Configurar a conexão com o CRM externo'),

  ('hr.ler',           'hr',        'ler',     'Ver colaboradores, cargos, ausências e ponto'),
  ('hr.criar',         'hr',        'criar',   'Cadastrar colaborador, cargo, ausência ou ponto'),
  ('hr.editar',        'hr',        'editar',  'Editar registros de RH'),
  ('hr.excluir',       'hr',        'excluir', 'Excluir registros de RH'),

  ('pcp.ler',          'pcp',       'ler',     'Ver ordens, estrutura e apontamentos'),
  ('pcp.criar',        'pcp',       'criar',   'Abrir ordem, item de estrutura ou apontamento'),
  ('pcp.editar',       'pcp',       'editar',  'Editar registros de PCP'),
  ('pcp.excluir',      'pcp',       'excluir', 'Excluir registros de PCP'),

  ('contracts.ler',    'contracts', 'ler',     'Ver contratos e modelos'),
  ('contracts.criar',  'contracts', 'criar',   'Cadastrar contrato ou modelo'),
  ('contracts.editar', 'contracts', 'editar',  'Editar contratos e modelos'),
  ('contracts.excluir','contracts', 'excluir', 'Excluir contratos e modelos')
on conflict (slug) do update set description = excluded.description;

-- ---------------------------------------------------------------------------
-- Quem recebe o quê.
--
-- Gerente: tudo, inclusive excluir — é o papel que já tinha exclusão nos outros
-- módulos, e não faria sentido ser diferente aqui.
--
-- Usuário: opera, mas NÃO exclui. Apagar um contrato ou um colaborador some com
-- histórico que ninguém recupera pela tela; quem faz isso é gerente ou admin.
-- Administrador não entra na lista porque passa por cima de qualquer permissão.
-- ---------------------------------------------------------------------------
insert into role_permissions (role_slug, permission_slug) values
  ('gerente', 'reports.ler'),
  ('gerente', 'fleet.ler'), ('gerente', 'fleet.criar'), ('gerente', 'fleet.editar'), ('gerente', 'fleet.excluir'),
  ('gerente', 'crm.ler'), ('gerente', 'crm.editar'),
  ('gerente', 'hr.ler'), ('gerente', 'hr.criar'), ('gerente', 'hr.editar'), ('gerente', 'hr.excluir'),
  ('gerente', 'pcp.ler'), ('gerente', 'pcp.criar'), ('gerente', 'pcp.editar'), ('gerente', 'pcp.excluir'),
  ('gerente', 'contracts.ler'), ('gerente', 'contracts.criar'), ('gerente', 'contracts.editar'), ('gerente', 'contracts.excluir'),

  ('usuario', 'reports.ler'),
  ('usuario', 'fleet.ler'), ('usuario', 'fleet.criar'), ('usuario', 'fleet.editar'),
  ('usuario', 'crm.ler'),
  ('usuario', 'hr.ler'),
  ('usuario', 'pcp.ler'), ('usuario', 'pcp.criar'), ('usuario', 'pcp.editar'),
  ('usuario', 'contracts.ler')
on conflict do nothing;


-- ============================================================================
-- >>> supabase/migrations/fase-t-permissoes-fiscais-gerente.sql
-- ============================================================================

-- Fase T — o papel "gerente" não tinha NENHUMA permissão fiscal
--
-- Situação encontrada:
--   usuario  -> 15 permissões fiscal.* (todas, inclusive inutilizar e certificado)
--   gerente  ->  0
--   admin    ->  0 (não precisa: passa por ehAdministrador)
--
-- Em todo o resto do sistema gerente ⊃ usuario (a Fase S deu a ele o `excluir`
-- que o usuário não tem). No Fiscal está invertido: hoje um gerente não
-- consegue nem ABRIR o módulo, porque /api/fiscal/ decide por
-- usuarioPode(user, 'fiscal.<ação>') e ele não tem nenhuma.
--
-- Isto é aditivo: ninguém perde acesso. É seguro rodar mais de uma vez.
--
-- NÃO resolvido aqui de propósito: o papel `usuario` continua podendo
-- inutilizar numeração, configurar estabelecimento e mexer em certificado
-- digital. Inutilizar é irreversível e certificado é credencial da empresa —
-- provavelmente não deveriam estar no papel mais básico. Mas TIRAR permissão
-- quebra quem já trabalha com ela hoje, então essa decisão fica com quem
-- administra o sistema, e não escondida numa migração.

insert into role_permissions (role_slug, permission_slug)
select 'gerente', slug
from permissions
where resource = 'fiscal'
on conflict do nothing;

-- Conferência: as três linhas devem sair com a mesma contagem de fiscal.*
-- para gerente e usuario, e 0 para admin.
--
-- select r.slug,
--        count(*) filter (where rp.permission_slug like 'fiscal.%') as fiscais
-- from roles r
-- left join role_permissions rp on rp.role_slug = r.slug
-- group by r.slug
-- order by r.slug;


-- ============================================================================
-- >>> supabase/migrations/fase-u-rh-organizacional.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase U — estrutura organizacional do RH
--
-- A Fase R deu ao RH o essencial: colaborador, cargo, ausência e ponto. O que
-- faltava é a estrutura que classifica o colaborador e define a jornada dele —
-- e sem ela o cadastro de pessoal responde "quem trabalha aqui", mas não
-- "onde", "sob que vínculo" e "em que horário".
--
-- QUATRO TABELAS, TODAS DE APOIO:
--   hr_departments          — onde a pessoa trabalha (setor, com responsável)
--   hr_work_schedules       — expediente: a jornada CONTRATADA
--   hr_employee_types       — vínculo: CLT, PJ, estágio, aprendiz, temporário
--   hr_employee_categories  — forma de remuneração: mensalista, horista, comissionado
--
-- EXPEDIENTE ≠ REGISTRO DE PONTO. `hr_time_entries` (Fase R) guarda o que a
-- pessoa REALMENTE marcou num dia. `hr_work_schedules` guarda o que ela DEVERIA
-- cumprir. São tabelas diferentes porque a comparação entre as duas é que
-- produz atraso, hora extra e banco de horas — com uma tabela só não há o que
-- comparar.
--
-- POR QUE TIPO E CATEGORIA SÃO SEPARADOS: são eixos independentes. Um CLT pode
-- ser mensalista ou horista; um comissionado pode ser CLT ou PJ. Juntar os dois
-- num campo só obrigaria a cadastrar "CLT mensalista", "CLT horista", "PJ
-- mensalista" — o produto das duas listas, que cresce e sai de controle.
--
-- Rodar DEPOIS da fase-r-modulos-novos.sql: as quatro referenciam ou são
-- referenciadas por hr_employees.
-- ---------------------------------------------------------------------------

-- =========================== DEPARTAMENTOS =================================
create table if not exists hr_departments (
  id text primary key,
  name text not null,
  description text,
  -- Responsável é um colaborador. ON DELETE SET NULL, e não CASCADE: desligar
  -- o gerente não pode apagar o departamento inteiro junto com ele.
  manager_id text references hr_employees(id) on delete set null,
  -- Centro de custo é texto livre porque o plano de contas do Financeiro tem
  -- vida própria; amarrar por FK obrigaria a cadastrar um antes do outro.
  cost_center text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_dept_ativo on hr_departments (active, name);

-- ============================= EXPEDIENTES ==================================
create table if not exists hr_work_schedules (
  id text primary key,
  name text not null,
  description text,
  -- Dias da semana como texto ('seg-sex', 'seg-sab', '12x36'): é rótulo de
  -- escala, não cálculo. Quando virar cálculo de escala de verdade, vira
  -- tabela filha com um dia por linha — e aí este campo some.
  dias_semana text,
  entrada time,
  saida_almoco time,
  volta_almoco time,
  saida time,
  -- Carga contratada, em horas por semana. É o número do contrato (44, 40,
  -- 30, 20) e não a soma dos horários acima: escala 12x36 tem carga semanal
  -- média que não sai de uma conta simples de entrada e saída.
  carga_semanal numeric(5,2),
  -- Minutos de tolerância antes de a marcação virar atraso. A CLT trata até 5
  -- minutos por marcação, 10 no dia, como não computáveis.
  tolerancia_minutos integer not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_sched_ativo on hr_work_schedules (active, name);

-- ======================== TIPOS DE COLABORADOR ==============================
-- O VÍNCULO. Exemplos: CLT, PJ, Estágio, Jovem Aprendiz, Temporário, Autônomo.
create table if not exists hr_employee_types (
  id text primary key,
  name text not null,
  description text,
  -- Quem tem registro em carteira gera obrigação trabalhista (férias, 13º,
  -- FGTS); PJ e autônomo, não. É a diferença que muda o cálculo, então fica
  -- como campo e não como interpretação do nome.
  registro_clt boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ====================== CATEGORIAS DE COLABORADOR ===========================
-- A FORMA DE REMUNERAÇÃO. Exemplos: Mensalista, Horista, Diarista, Comissionado.
create table if not exists hr_employee_categories (
  id text primary key,
  name text not null,
  description text,
  -- Base do salário cadastrado no colaborador: 'mensal', 'hora', 'dia' ou
  -- 'comissao'. Sem isto, "salário 3000" é ambíguo entre R$3.000/mês e
  -- R$3.000/hora — e o erro só aparece na folha.
  base_calculo text not null default 'mensal'
    check (base_calculo in ('mensal', 'hora', 'dia', 'comissao')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ==================== VÍNCULOS NO CADASTRO DE PESSOAL =======================
-- Todos ON DELETE SET NULL pelo mesmo motivo: excluir um departamento, um
-- expediente ou um tipo não pode apagar a ficha de quem estava classificado
-- ali. O colaborador só fica sem a classificação, e a tela mostra "-".
alter table hr_employees add column if not exists department_id text
  references hr_departments(id) on delete set null;
alter table hr_employees add column if not exists work_schedule_id text
  references hr_work_schedules(id) on delete set null;
alter table hr_employees add column if not exists employee_type_id text
  references hr_employee_types(id) on delete set null;
alter table hr_employees add column if not exists employee_category_id text
  references hr_employee_categories(id) on delete set null;

create index if not exists idx_hr_emp_depto on hr_employees (department_id);

-- ============================ CBO NA PROFISSÃO ==============================
-- (a parte fiscal desta fase está em fase-v-difal-e-pagamento.sql)
-- hr_positions já existia como "Cargos" e passa a se chamar Profissões na
-- tela — é o mesmo registro (nome, descrição, faixa salarial). O que faltava
-- era o código da Classificação Brasileira de Ocupações, que o eSocial exige e
-- que não tem onde ser guardado hoje.
alter table hr_positions add column if not exists cbo text;


-- ============================================================================
-- >>> supabase/migrations/fase-v-difal-e-pagamento.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase V — DIFAL e crédito do Simples na regra fiscal
--
-- Preparação para o primeiro teste em homologação com emitente em SANTA
-- CATARINA operando em Simples Nacional e Lucro Presumido.
--
-- O QUE FALTAVA E POR QUÊ
--
-- 1. DIFAL (EC 87/2015). Venda interestadual para quem NÃO é contribuinte —
--    consumidor final pessoa física em outro estado — deve a diferença entre a
--    alíquota interna do estado de DESTINO e a interestadual, e essa diferença
--    pertence ao destino. Para calcular é preciso saber a alíquota interna do
--    outro estado, que varia por UF e por produto. Não dá para embutir no
--    código: são 27 estados que mudam de alíquota por lei estadual. Fica como
--    campo da regra, que já é cadastrada por UF de destino.
--
--    Simples Nacional está DISPENSADO do DIFAL (ADI 5.464 do STF), por isso o
--    payload só monta a partilha quando a regra usa CST, não CSOSN.
--
-- 2. FCP no destino. Alguns estados cobram Fundo de Combate à Pobreza por
--    cima do DIFAL, com percentual próprio e lista própria de produtos. Mesmo
--    motivo do item 1: é dado, não regra de código.
--
-- 3. Crédito de ICMS do Simples. CSOSN 101 e 201 são "com permissão de
--    crédito" e a nota precisa declarar o percentual que o destinatário pode
--    aproveitar. O percentual é o da faixa do Simples da empresa e já existe
--    em empresa.aliquota_credito_icms_sn (Fase C) — o que faltava era o
--    payload usá-lo, e isso é código, não banco.
-- ---------------------------------------------------------------------------

-- Alíquota interna do estado de DESTINO, para o cálculo do DIFAL. Fica NULL
-- em regra de operação interna e em regra de Simples Nacional — nos dois casos
-- não há partilha a calcular.
alter table regra_fiscal add column if not exists aliquota_interna_uf_destino numeric(5,2);

-- Percentual do Fundo de Combate à Pobreza do estado de destino.
alter table regra_fiscal add column if not exists aliquota_fcp_uf_destino numeric(5,2);


-- ============================================================================
-- >>> supabase/migrations/fase-w-pcp-chao-de-fabrica.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase W — chão de fábrica no PCP
--
-- A Fase R deu ao PCP o essencial: ordem de produção, ficha técnica e
-- apontamento. Falta o que diz ONDE a ordem está sendo feita, EM QUE ETAPA ela
-- se encontra no fluxo da empresa, e se o que saiu está BOM.
--
--   pcp_sectors         — setores/centros de trabalho, na ordem do fluxo
--   pcp_statuses        — os status que a empresa usa, além das 4 etapas fixas
--   pcp_quality_checks  — inspeção de qualidade por ordem
--
-- POR QUE STATUS É TABELA E A ETAPA CONTINUA FIXA
-- ------------------------------------------------
-- pcp_orders.status tem CHECK com quatro valores (aberta, em_producao,
-- concluida, cancelada) e o código depende deles: é por "concluida" que se sabe
-- que a ordem terminou. Trocar isso por texto livre quebraria toda a lógica na
-- primeira vez que alguém digitasse "Concluída " com espaço no fim.
--
-- Então são DUAS coisas: a ETAPA (fixa, do código) e o STATUS (cadastrado, da
-- empresa). "Aguardando matéria-prima", "Em setup", "Parada por manutenção"
-- são status diferentes que vivem todos na etapa "em_producao". Cada status
-- declara a que etapa pertence, e é a etapa que manda no comportamento.
--
-- Mesmo desenho do catálogo de status de Pedido/Orçamento em Vendas.
--
-- Rodar DEPOIS de fase-r-modulos-novos.sql (referencia pcp_orders) e de
-- fase-u-rh-organizacional.sql não é necessário — hr_employees já existe na R.
-- ---------------------------------------------------------------------------

-- =============================== SETORES ====================================
create table if not exists pcp_sectors (
  id text primary key,
  name text not null,
  description text,
  -- Quem responde pelo setor. SET NULL: desligar o encarregado não pode
  -- apagar o setor junto com ele.
  responsible_id text references hr_employees(id) on delete set null,
  -- Posição do setor na linha (1 = primeiro). É o que permite listar o fluxo
  -- na ordem em que a peça caminha, em vez de em ordem alfabética.
  sequencia integer not null default 0,
  -- Quanto o setor produz por hora, na unidade do produto. Serve para estimar
  -- prazo; fica em branco quando o setor não tem ritmo constante.
  capacidade_hora numeric(14,4),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcp_setor_fluxo on pcp_sectors (sequencia, name);

-- ================================ STATUS ====================================
create table if not exists pcp_statuses (
  id text primary key,
  name text not null,
  -- A etapa do fluxo a que este status pertence. É ela que o código lê; o
  -- nome acima é só o rótulo que a empresa escolheu.
  etapa text not null default 'em_producao'
    check (etapa in ('aberta', 'em_producao', 'concluida', 'cancelada')),
  description text,
  -- Cor do badge na lista de ordens. Texto livre porque é valor de CSS.
  color text,
  ordem integer not null default 0,
  -- Status com que uma ordem nova nasce. Só um por etapa faz sentido, mas a
  -- unicidade é responsabilidade da tela — constraint parcial aqui obrigaria
  -- a mexer no banco toda vez que a regra mudasse.
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcp_status_ordem on pcp_statuses (etapa, ordem);

-- ========================= CONTROLE DE QUALIDADE ============================
create table if not exists pcp_quality_checks (
  id text primary key,
  -- CASCADE: apagar a ordem apaga as inspeções dela, como já acontece com os
  -- apontamentos. A inspeção não existe fora da ordem.
  order_id text not null references pcp_orders(id) on delete cascade,
  sector_id text references pcp_sectors(id) on delete set null,
  date date not null,
  inspector_id text references hr_employees(id) on delete set null,
  quantidade_inspecionada numeric(14,4) not null default 0,
  -- Só a aprovada é guardada. A reprovada é a diferença, e gravar as duas
  -- criaria um terceiro número que pode discordar dos outros dois — mesma
  -- razão de "Falta" ser derivado na lista de ordens.
  quantidade_aprovada numeric(14,4) not null default 0,
  resultado text not null default 'aprovado'
    check (resultado in ('aprovado', 'aprovado_com_ressalva', 'reprovado')),
  -- O que foi encontrado. Em reprovação é o campo que explica a decisão, e é
  -- o que a auditoria de qualidade vai ler meses depois.
  motivo text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcp_qc_ordem on pcp_quality_checks (order_id, date desc);
create index if not exists idx_pcp_qc_resultado on pcp_quality_checks (resultado, date desc);

-- ==================== VÍNCULOS NA ORDEM DE PRODUÇÃO =========================
-- SET NULL nos dois: excluir um setor ou um status não pode apagar a ordem.
-- A ordem só perde a classificação, e a etapa (coluna status) continua de pé —
-- é ela que o código lê.
alter table pcp_orders add column if not exists sector_id text
  references pcp_sectors(id) on delete set null;
alter table pcp_orders add column if not exists status_id text
  references pcp_statuses(id) on delete set null;

create index if not exists idx_pcp_orders_setor on pcp_orders (sector_id);


-- ============================================================================
-- >>> supabase/migrations/fase-x-tipos-de-contrato.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase X — tipos de contrato
--
-- O módulo Contratos tinha MODELO (o texto-padrão que se reaproveita ao
-- emitir) mas não tinha TIPO — a classificação do que aquele contrato é.
-- São coisas diferentes: "Locação de equipamento" é um tipo; o texto com as
-- cláusulas de locação é um modelo. Um tipo pode ter vários modelos ao longo do
-- tempo, e o mesmo modelo pode servir a mais de um tipo.
--
-- O CAMPO QUE FAZ O TIPO VALER A PENA: aviso_previa_dias.
--
-- Contrato não se renova nem se encerra no dia do vencimento — se encerra no
-- prazo de aviso prévio ANTES dele. Perder essa data é o erro caro do módulo:
-- o contrato renova sozinho por mais um ciclo inteiro sem ninguém decidir.
-- O prazo varia por tipo (30 dias num contrato de serviço, 90 numa locação),
-- e é por isso que ele mora aqui e não numa configuração global.
--
-- As telas de Contratos e de Vencimentos leem esse prazo para avisar no
-- momento certo, em vez de avisar só quando já venceu.
-- ---------------------------------------------------------------------------

create table if not exists contract_types (
  id text primary key,
  name text not null,
  description text,
  -- De que lado do caixa este tipo costuma cair. 'ambos' existe porque há
  -- tipo que serve aos dois lados (permuta, parceria, comodato).
  natureza text not null default 'receita'
    check (natureza in ('receita', 'despesa', 'ambos')),
  -- Dias de antecedência para avisar renovação ou encerramento. 30 é o prazo
  -- mais comum em contrato de prestação de serviço.
  aviso_previa_dias integer not null default 30,
  -- Modelo de texto que costuma acompanhar este tipo. SET NULL: excluir o
  -- modelo não pode apagar o tipo junto.
  template_id text references contract_templates(id) on delete set null,
  ordem integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_types_ordem on contract_types (ordem, name);

-- SET NULL pelo mesmo motivo de sempre: excluir um tipo não pode apagar os
-- contratos classificados nele. Eles só ficam sem tipo, e a tela mostra "-".
alter table contracts add column if not exists type_id text
  references contract_types(id) on delete set null;

create index if not exists idx_contracts_tipo on contracts (type_id);


-- ============================================================================
-- >>> supabase/migrations/fase-y-cst-faltantes.sql
-- ============================================================================

-- Fase Y — códigos CST que faltavam nas tabelas de referência.
--
-- Origem: conferência contra as listas do ERP que o usuário usa hoje
-- (2026-08-10). A tabela de CST de ICMS estava sem o 61, e a de PIS/COFINS
-- sem onze códigos da faixa de crédito presumido (60 a 67) e da faixa de
-- crédito vinculado (52, 54, 55).
--
-- Por que isso importa mesmo sendo revenda: a tela de regra fiscal monta os
-- selects a partir DESTAS tabelas. Um código ausente não é só um item a menos
-- na lista — é uma operação que não tem como ser cadastrada. E quando o
-- contador pedir um CST que não está aqui, o caminho fácil vira digitar
-- errado o que está.
--
-- Idempotente: pode rodar mais de uma vez.

-- ---------------------------------------------------------------------------
-- CST de ICMS — 61
-- ---------------------------------------------------------------------------
-- Criado pela NT 2016.002 (monofasia de combustíveis, EC 33/2001 + LC 192/2022).
-- Não se aplica a revenda comum; entra para a lista ficar completa.
insert into cst_icms (codigo, descricao) values
  ('61', 'Tributação monofásica sobre combustíveis cobrada anteriormente')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de PIS/COFINS — faixas de crédito que faltavam
-- ---------------------------------------------------------------------------
-- ATENÇÃO: estes códigos são de regime NÃO-CUMULATIVO (Lucro Real). No Lucro
-- Presumido, que é cumulativo, a saída é CST 01 e não há crédito a apropriar;
-- no Simples Nacional, CST 49. Estarem disponíveis na lista não significa que
-- possam ser usados nos regimes desta empresa — ver a regra fiscal.
insert into cst_pis_cofins (codigo, descricao, grupo) values
  ('52', 'Operação com direito a crédito — vinculada exclusivamente a receita de exportação', 'ENTRADA'),
  ('54', 'Operação com direito a crédito — vinculada a receitas tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('55', 'Operação com direito a crédito — vinculada a receitas não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('60', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita tributada no mercado interno', 'ENTRADA'),
  ('61', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita não-tributada no mercado interno', 'ENTRADA'),
  ('62', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita de exportação', 'ENTRADA'),
  ('63', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno', 'ENTRADA'),
  ('64', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('65', 'Crédito presumido — operação de aquisição vinculada a receitas não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('66', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('67', 'Crédito presumido — outras operações', 'ENTRADA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;


-- ============================================================================
-- >>> supabase/migrations/fase-z-ibs-cbs.sql
-- ============================================================================

-- Fase Z — IBS e CBS (Reforma Tributária, LC 214/2025).
--
-- Dois códigos novos, e eles NÃO são independentes:
--
--   CST do IBS/CBS  (3 dígitos)  — a situação tributária, como o CST do ICMS.
--   cClassTrib      (6 dígitos)  — a classificação tributária, que detalha QUAL
--                                  hipótese legal se aplica dentro daquele CST.
--
-- Os três primeiros dígitos do cClassTrib SÃO o CST. 000001 pertence ao CST
-- 000, 011002 ao CST 011, 200003 ao CST 200. Isso não é convenção de nome: é a
-- estrutura do código, e o CHECK abaixo impede que uma linha errada entre.
-- Sem essa amarra, um cClassTrib cadastrado sob o CST errado só apareceria
-- como rejeição da SEFAZ, com a nota já montada.
--
-- Idempotente: pode rodar mais de uma vez.

-- ---------------------------------------------------------------------------
-- CST do IBS/CBS — tabela COMPLETA (19 códigos)
-- ---------------------------------------------------------------------------
create table if not exists cst_ibs_cbs (
  codigo char(3) primary key,
  descricao text not null
);

insert into cst_ibs_cbs (codigo, descricao) values
  ('000', 'Tributação integral'),
  ('010', 'Tributação com alíquotas uniformes — operações setor financeiro'),
  ('011', 'Tributação com alíquotas uniformes reduzidas em 60%'),
  ('200', 'Alíquota reduzida'),
  ('210', 'Alíquota reduzida com redutor de base de cálculo'),
  ('220', 'Alíquota fixa'),
  ('221', 'Alíquota fixa proporcional'),
  ('222', 'Redução de base de cálculo'),
  ('400', 'Isenção'),
  ('410', 'Imunidade e não incidência'),
  ('510', 'Diferimento'),
  ('515', 'Diferimento com redução de alíquota'),
  ('550', 'Suspensão'),
  ('620', 'Tributação monofásica'),
  ('800', 'Transferência de crédito'),
  ('810', 'Ajustes'),
  ('811', 'Anulação de crédito'),
  ('820', 'Tributação em declaração de regime específico'),
  ('830', 'Exclusão de base de cálculo')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- cClassTrib — classificação tributária
-- ---------------------------------------------------------------------------
-- ATENÇÃO: esta tabela está PARCIAL de propósito.
--
-- A tabela oficial da LC 214/2025 tem centenas de códigos. Aqui entraram
-- apenas os que foram conferidos um a um contra a listagem do ERP em uso
-- (2026-08-10) — as faixas 000xxx, 010xxx, 011xxx e 200xxx até 200008.
--
-- Preferi a lista curta e correta à lista longa e chutada: um cClassTrib
-- inventado não é recusado no cadastro, vai para a nota e volta como rejeição
-- da SEFAZ — ou pior, passa e classifica a operação sob uma hipótese legal que
-- não é a dela.
--
-- Enquanto estiver incompleta, a tela de regra fiscal aceita digitar o código
-- à mão (o mesmo comportamento que já existe quando a tabela não existe).
-- Para completar: exportar a lista do ERP atual e dar INSERT aqui.
create table if not exists classificacao_tributaria (
  codigo char(6) primary key,
  -- Os 3 primeiros dígitos do código SÃO o CST. Guardar separado é redundante
  -- de propósito: é o que permite filtrar o select por CST escolhido.
  cst char(3) not null references cst_ibs_cbs(codigo),
  descricao text not null,
  constraint classificacao_tributaria_cst_coerente
    check (cst = substring(codigo from 1 for 3))
);

create index if not exists idx_classificacao_tributaria_cst on classificacao_tributaria (cst);

insert into classificacao_tributaria (codigo, cst, descricao) values
  ('000001', '000', 'Situações tributadas integralmente pelo IBS e CBS'),
  ('000002', '000', 'Exploração de via, observado o art. 11 da LC 214/2025'),
  ('000003', '000', 'Regime automotivo — projetos incentivados, observado o art. 311 da LC 214/2025'),
  ('000004', '000', 'Regime automotivo — projetos incentivados, observado o art. 312 da LC 214/2025'),
  ('010001', '010', 'Operações do FGTS não realizadas pela Caixa Econômica Federal, observado o art. 212 da LC 214/2025'),
  ('010002', '010', 'Operações do serviço financeiro'),
  ('011001', '011', 'Planos de assistência funerária, observado o art. 236 da LC 214/2025'),
  ('011002', '011', 'Planos de assistência à saúde, observado o art. 237 da LC 214/2025'),
  ('011003', '011', 'Intermediação de planos de assistência à saúde, observado o art. 240 da LC 214/2025'),
  ('011004', '011', 'Concursos e prognósticos, observado o art. 246 da LC 214/2025'),
  ('011005', '011', 'Planos de assistência à saúde de animais domésticos, observado o art. 243 da LC 214/2025'),
  ('200001', '200', 'Aquisições de máquinas, aparelhos, instrumentos, equipamentos, matérias-primas, produtos intermediários e materiais de embalagem realizadas entre empresas autorizadas a operar em zonas de processamento de exportação, observado o art. 103 da LC 214/2025'),
  ('200002', '200', 'Fornecimento ou importação de tratores, máquinas e implementos agrícolas destinados a produtor rural não contribuinte, e de veículos de transporte de carga destinados a transportador autônomo de carga pessoa física não contribuinte, observado o art. 110 da LC 214/2025'),
  ('200003', '200', 'Vendas de produtos destinados à alimentação humana relacionados no Anexo I da LC 214/2025, que compõem a Cesta Básica Nacional de Alimentos, observado o art. 125 da LC 214/2025'),
  ('200004', '200', 'Venda de dispositivos médicos com as classificações da NCM/SH previstas no Anexo XII da LC 214/2025, observado o art. 144 da LC 214/2025'),
  ('200005', '200', 'Venda de dispositivos médicos com as classificações da NCM/SH previstas no Anexo IV da LC 214/2025, quando adquiridos por órgãos da administração pública direta, autarquias e fundações públicas, observado o art. 144 da LC 214/2025'),
  ('200006', '200', 'Situação de emergência de saúde pública reconhecida pelo Poder Legislativo federal, estadual, distrital ou municipal competente, para incluir dispositivos não listados no Anexo XII da LC 214/2025'),
  ('200007', '200', 'Fornecimento de dispositivos de acessibilidade próprios para pessoas com deficiência relacionados no Anexo XIII da LC 214/2025, observado o art. 145 da LC 214/2025'),
  ('200008', '200', 'Fornecimento de dispositivos de acessibilidade próprios para pessoas com deficiência relacionados no Anexo V da LC 214/2025, quando adquiridos por órgãos da administração pública direta, autarquias, fundações públicas e entidades imunes, observado o art. 145 da LC 214/2025')
on conflict (codigo) do update set cst = excluded.cst, descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- Regra fiscal — colunas de IBS/CBS
-- ---------------------------------------------------------------------------
-- As alíquotas ficam na regra, não no código: são definidas por lei e mudam a
-- cada ano da transição. Em 2026 (fase de teste) valem CBS 0,9% e IBS 0,1%,
-- compensáveis com PIS/COFINS — mas quem preenche é o contador, do mesmo jeito
-- que as alíquotas de ICMS.
alter table regra_fiscal add column if not exists cst_ibs_cbs char(3);
alter table regra_fiscal add column if not exists class_trib char(6);
alter table regra_fiscal add column if not exists aliquota_ibs numeric(7,4);
alter table regra_fiscal add column if not exists aliquota_cbs numeric(7,4);

comment on column regra_fiscal.cst_ibs_cbs is 'CST do IBS/CBS (LC 214/2025). Os 3 primeiros dígitos de class_trib.';
comment on column regra_fiscal.class_trib is 'cClassTrib — classificação tributária de 6 dígitos. Começa pelo cst_ibs_cbs.';


-- ============================================================================
-- >>> supabase/migrations/fase-aa-nfe-lista-unificada.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AA — a NF-e real vira a NF-e da tela
--
-- O SISTEMA TINHA DUAS NF-e QUE NÃO SE FALAVAM:
--
--   `nfes`  — registro manual do Financeiro (tela "Nova NF-e Avulsa").
--   `nfe`   — a nota de verdade, transmitida à SEFAZ pela Focus NFe.
--
-- A tela "NF-e Emitidas" lia só a primeira. Quem emitisse pela Focus não veria
-- a nota no lugar onde qualquer pessoa vai procurar — e nada acusaria o erro.
-- As nove ações do menu (baixar XML, DANFE, CC-e, consultar status) também
-- ficavam mortas por isso: as rotas existem em /api/fiscal/nfe, mas o menu
-- vivia na lista errada.
--
-- Esta migração dá à tabela fiscal as três colunas que faltavam para ela poder
-- SER a lista:
--
--   destinatario_nome / destinatario_documento
--     Estavam só dentro de payload_enviado (jsonb). Ler dali não serve por dois
--     motivos: filtrar por cliente viraria varredura de JSON, e em HOMOLOGAÇÃO
--     o nome do destinatário é o texto fixo que a SEFAZ exige
--     ("NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL") — a lista
--     inteira mostraria a mesma frase em vez do cliente.
--
--   order_id
--     O pedido de venda que originou a nota. Sem ele a ação "Ir Para a Venda"
--     não tem para onde ir. Sem FK de propósito: a nota é documento fiscal e
--     não pode ser apagada nem alterada por causa do ciclo de vida do pedido.
--     Ver a regra de que documento fiscal só se cancela, jamais se exclui.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

alter table nfe add column if not exists destinatario_nome text;
alter table nfe add column if not exists destinatario_documento text;
alter table nfe add column if not exists order_id text;

-- NF-e AVULSA: emitida sem pedido de origem.
--
-- Quando a nota nasce de um pedido, o financeiro já foi gerado por ele. Quando
-- ela nasce avulsa, não existe ninguém para gerar — e sem isto uma venda
-- faturada some do contas a receber.
--
-- A condição fica gravada porque a autorização da SEFAZ pode chegar DEPOIS,
-- por webhook, num processo que não tem mais a tela nem o usuário: sem a
-- condição guardada, não haveria como montar as parcelas naquele momento.
alter table nfe add column if not exists condicao_pagamento jsonb;

comment on column nfe.condicao_pagamento is
  'Como a nota avulsa deve virar contas a receber: {tipo, parcelas, intervaloDias}. Nulo quando a nota veio de pedido — nesse caso o financeiro é do pedido.';

comment on column nfe.destinatario_nome is
  'Nome REAL do destinatário. Em homologação difere do nome enviado à SEFAZ, que é o texto fixo exigido por ela.';
comment on column nfe.order_id is
  'Pedido de venda de origem. Sem FK: a nota não pode ser afetada pelo ciclo de vida do pedido.';

-- Busca por cliente na lista de NF-e.
create index if not exists idx_nfe_destinatario on nfe (destinatario_nome);
-- "Este pedido já tem nota?" — pergunta feita a cada tentativa de emissão.
create index if not exists idx_nfe_order on nfe (order_id);


-- ============================================================================
-- >>> supabase/migrations/fase-ab-nfe-complementar-icms.sql
-- ============================================================================

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


-- ============================================================================
-- >>> supabase/migrations/fase-ac-classes-de-produto.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AC — CLASSES DE PRODUTO (a primeira é COR)
--
-- O PROBLEMA
-- ----------
-- Um mesmo produto existe em cores diferentes, e cada cor tem o próprio
-- saldo. Sem isso, as saídas são: cadastrar quatro produtos ("Godzilla Preto",
-- "Godzilla Branco"...), o que quadruplica o cadastro e quebra qualquer
-- relatório por produto; ou controlar a cor no papel, e o estoque do sistema
-- deixa de valer.
--
-- O DESENHO
-- ---------
--   product_classes                  a classe em si (COR, e amanhã VOLTAGEM)
--   product_class_values             os valores dela (Preto, Branco, ...)
--   product_class_assignments        quais classes ESTE produto usa
--   product_class_value_assignments  quais valores ESTE produto oferece
--
-- Duas camadas de propósito: o catálogo é global (a cor "Preto" é a mesma para
-- todo mundo) e a atribuição é por produto (nem todo produto vem em preto).
-- Sem a separação, cadastrar uma cor nova exigiria repetir a linha em cada
-- produto que a usa.
--
-- O QUE ESTE ARQUIVO NÃO CRIA, E POR QUÊ
-- --------------------------------------
-- A especificação pedia `product_stock_classes`, com o saldo por cor gravado.
-- Aqui o saldo por depósito NÃO é gravado: ele é derivado da soma do razão de
-- movimentos (ver depositBalance em lib/stock-core.js). Uma tabela de saldo
-- por cor seria um TERCEIRO número, capaz de discordar do razão e de
-- products.stock_quantity — exatamente a inconsistência que o §8 da própria
-- especificação proíbe.
--
-- O saldo por cor vem da mesma soma que já produz o saldo por depósito, com a
-- cor gravada no movimento. Dois números que saem do mesmo cálculo não têm
-- como divergir.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ================================ CLASSES ==================================
create table if not exists product_classes (
  id text primary key,
  -- NULO = vale para todas as empresas, que é o caso de COR.
  -- `products` não tem empresa: um produto é global neste sistema. Uma classe
  -- obrigatoriamente por empresa deixaria produto global apontando para classe
  -- de uma empresa só — inconsistência sem dono.
  company_id text,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duas classes "COR" na mesma empresa seriam indistinguíveis nas telas.
-- `coalesce` porque NULL nunca é igual a NULL num índice único: sem ele, dez
-- classes globais chamadas COR passariam.
create unique index if not exists idx_product_classes_nome
  on product_classes (coalesce(company_id, ''), lower(name));

-- ============================ VALORES DA CLASSE =============================
create table if not exists product_class_values (
  id text primary key,
  -- RESTRICT, não CASCADE: apagar a classe COR levaria junto todo o histórico
  -- de qual cor cada movimento teve.
  class_id text not null references product_classes(id) on delete restrict,
  name text not null,
  -- Código curto para etiqueta e importação ("PT", "BR"). Opcional: obrigar
  -- um código para cadastrar uma cor é atrito sem retorno.
  code text,
  -- Espaço para o que a cor precisar depois: {"hex": "#000000"}.
  metadata jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- §21.1 — "Preto" e "preto" na mesma classe seriam duas cores para o sistema e
-- uma só para quem vende.
create unique index if not exists idx_product_class_values_nome
  on product_class_values (class_id, lower(name));
create unique index if not exists idx_product_class_values_codigo
  on product_class_values (class_id, upper(code)) where code is not null;
create index if not exists idx_product_class_values_classe
  on product_class_values (class_id, active);

-- ===================== CLASSES QUE O PRODUTO UTILIZA ========================
create table if not exists product_class_assignments (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  class_id text not null references product_classes(id) on delete restrict,
  -- Obriga escolher um valor na venda? COR de um produto que só existe em
  -- preto não precisa ser escolhida.
  required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- §21.2 — a mesma classe duas vezes no mesmo produto daria duas listas de cor
-- na tela de venda.
create unique index if not exists idx_product_class_assign_unico
  on product_class_assignments (product_id, class_id);
create index if not exists idx_product_class_assign_produto
  on product_class_assignments (product_id, active);

-- CASCADE no produto e RESTRICT na classe, de propósito: excluir um produto
-- deve limpar as atribuições dele; excluir uma classe usada por qualquer
-- produto tem de ser recusado (§21.5).

-- ===================== VALORES QUE O PRODUTO OFERECE =========================
create table if not exists product_class_value_assignments (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  class_id text not null references product_classes(id) on delete restrict,
  class_value_id text not null references product_class_values(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_product_class_value_assign_unico
  on product_class_value_assignments (product_id, class_value_id);
create index if not exists idx_product_class_value_assign_produto
  on product_class_value_assignments (product_id, class_id, active);

-- ============================== SEMENTE: COR ================================
-- A classe COR e as cores mais comuns já entram cadastradas: exigir que o
-- usuário crie "Preto" antes de poder usar a funcionalidade é atrito no
-- primeiro minuto. O `hex` alimenta a bolinha de cor na tela.
insert into product_classes (id, name, description) values
  ('pclass_cor', 'COR', 'Cor do produto. Cada cor tem saldo de estoque próprio.')
on conflict (id) do update set name = excluded.name, description = excluded.description;

insert into product_class_values (id, class_id, name, code, metadata) values
  ('pcval_cor_preto',    'pclass_cor', 'Preto',    'PT', '{"hex":"#111827"}'),
  ('pcval_cor_branco',   'pclass_cor', 'Branco',   'BR', '{"hex":"#F9FAFB"}'),
  ('pcval_cor_vermelho', 'pclass_cor', 'Vermelho', 'VM', '{"hex":"#DC2626"}'),
  ('pcval_cor_azul',     'pclass_cor', 'Azul',     'AZ', '{"hex":"#2563EB"}'),
  ('pcval_cor_cinza',    'pclass_cor', 'Cinza',    'CZ', '{"hex":"#6B7280"}')
on conflict (id) do update set
  name = excluded.name, code = excluded.code, metadata = excluded.metadata;


-- ============================================================================
-- >>> supabase/migrations/fase-ad-ibs-cbs-uf-municipio.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AD — IBS separado por UF e por Município na regra fiscal
--
-- POR QUE
--
-- A fase-z criou `aliquota_ibs` como um número só. A API da Focus NFe não
-- aceita assim: ela pede os dois lados separados, porque o IBS tem DOIS
-- destinatários com competências distintas —
--
--     ibs_uf_aliquota   -> pIBSUF   (competência do estado)
--     ibs_mun_aliquota  -> pIBSMun  (competência do município)
--
-- Dividir um total ao meio no código resolveria 2026 por coincidência (as
-- alíquotas de teste são 0,05% + 0,05%) e passaria a mentir no primeiro ano em
-- que estado e município divergirem — que é o desenho da LC 214/2025. Alíquota
-- é dado, não regra de código: são 27 estados e 5.570 municípios legislando.
--
-- MEDIDO EM HOMOLOGAÇÃO (14/08/2026): sem os campos de IBS/CBS no payload, a
-- SEFAZ recusa TODA nota com "1115 — Rejeicao: IBS/CBS não informado".
--
-- `aliquota_ibs` (o total da fase-z) fica de pé, sem uso pelo payload: apagar
-- coluna não tem volta, e o custo de mantê-la é zero. Não havia nenhuma regra
-- fiscal cadastrada quando isto rodou, então não há dado a converter.
-- ---------------------------------------------------------------------------

-- Competência do ESTADO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_uf numeric(7,4);

-- Competência do MUNICÍPIO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_mun numeric(7,4);


-- ============================================================================
-- >>> supabase/migrations/fase-ae-financeiro-por-cfop-e-beneficio.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AE — três correções que só apareceram emitindo de verdade
--
--   1. a FK da parcela apontava para a tabela de nota ERRADA — e sai de cena
--   2. o CFOP passa a dizer se a nota gera financeiro
--   3. nota isenta precisa do código de benefício fiscal
-- ---------------------------------------------------------------------------


-- 1. A FK DA PARCELA NÃO TEM COMO EXISTIR ---------------------------------
--
-- O sistema tem DUAS tabelas de nota, vivas ao mesmo tempo:
--
--   `nfes`  — registro manual do Financeiro. id TEXTO ("nfe-1786191489250-...")
--   `nfe`   — a nota transmitida à SEFAZ.    id UUID  ("c405593f-e9c4-...")
--
-- E os DOIS caminhos gravam financial_entries.nfe_id: a emissão fiscal
-- (server.js, gerarFinanceiroDaNfeAvulsa) e a NF-e manual do Financeiro
-- (server.js, rota POST /api/finance/nfe).
--
-- A FK da fase-n apontava para `nfes`. Como quem gera parcela na emissão é a
-- nota fiscal, que vive em `nfe`, TODA tentativa era recusada pelo banco:
--
--     A parcela aponta para a NF-e "...", que não está no banco.
--
-- Efeito: nota autorizada, cliente devendo, e nada no Financeiro. Medido na
-- primeira nota autorizada do sistema, em 14/08/2026.
--
-- A tentativa óbvia — repontar para `nfe` — o Postgres recusa:
--
--     42804: foreign key constraint cannot be implemented
--     Key columns "nfe_id" and "id" are of incompatible types: text and uuid.
--
-- E não adianta converter a coluna para uuid: isso passaria a recusar o id do
-- caminho legado, que é texto e continua em uso.
--
-- Então a constraint SAI. Uma FK só sabe apontar para UMA tabela, e aqui são
-- duas com tipos de id diferentes — o modelo não comporta a garantia. Isto é
-- perda de integridade, e está escrito aqui para não parecer descuido: quem
-- protege contra parcela órfã agora é o código, que sabe de qual fluxo veio.
--
-- A correção de verdade é unificar `nfes` dentro de `nfe` (a fase-aa já deu o
-- primeiro passo, tornando `nfe` A lista do sistema). É decisão de modelo, com
-- migração de dados, e não cabe numa correção de bug.
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

comment on column financial_entries.nfe_id is
  'Nota que originou a parcela. SEM foreign key de propósito: aponta ora para nfe (uuid, fiscal), ora para nfes (texto, manual) — ver fase-ae.';


-- 2. QUAL CFOP GERA FINANCEIRO --------------------------------------------
--
-- Emitir nota não é sinônimo de vender. Uma devolução (1202) não gera
-- recebível; uma venda (5405) gera. Sair pelo `tipo` (ENTRADA/SAÍDA) não
-- resolve: 5202 é devolução de compra, é SAÍDA e não gera nada.
--
-- Vira COLUNA, e não regra no código, porque a classificação é fiscal: quando
-- um CFOP fugir do padrão, a correção é uma linha de UPDATE aqui e não um
-- deploy.
alter table if exists cfop add column if not exists gera_financeiro boolean not null default false;

comment on column cfop.gera_financeiro is
  'A NF-e com este CFOP cria contas a receber? Venda cria; devolução, remessa, retorno e transferência não.';

-- Semente: só venda de saída. Tudo o mais fica false, que é o padrão seguro —
-- recebível a menos aparece na conferência; recebível a mais é cobrança
-- indevida de cliente.
update cfop
   set gera_financeiro = true
 where tipo = 'SAIDA'
   and (descricao ilike 'Venda%' or descricao ilike 'Vendas%');


-- 3. CÓDIGO DE BENEFÍCIO FISCAL (nota isenta) ------------------------------
--
-- Medido em homologação em 15/08/2026, emitindo com CST 40:
--
--     930  Rejeicao: CST com beneficio fiscal e nao informado o codigo
--          de beneficio fiscal [nItem:1]
--
-- A SEFAZ NÃO pediu base nem alíquota (o grupo da isenta não tem esses
-- campos). Pediu o cBenef — o código que o estado publica para cada benefício.
-- Sem ele, nenhuma nota isenta é autorizada.
--
-- É dado do estado, não do código: em SC sai da tabela da SEF/SC, e muda por
-- ato normativo.
alter table regra_fiscal add column if not exists codigo_beneficio_fiscal varchar(10);
alter table regra_fiscal add column if not exists icms_motivo_desoneracao varchar(2);

comment on column regra_fiscal.codigo_beneficio_fiscal is
  'cBenef — código do benefício fiscal na tabela da UF. Exigido pela SEFAZ em CST com benefício (40, 41, 50).';
comment on column regra_fiscal.icms_motivo_desoneracao is
  'motDesICMS — motivo da desoneração do ICMS, quando houver valor desonerado a declarar.';


-- ============================================================================
-- >>> supabase/migrations/fase-af-rls-fechar-porta-publica.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AF — RLS: trancar a porta publica do PostgREST
--
-- POR QUE ISTO NAO E "filtro por empresa"
--
-- O sistema conecta no Supabase com a chave SERVICE_ROLE (lib/db/client.js), e
-- essa chave IGNORA RLS por completo. Nenhuma politica escrita aqui vai
-- filtrar uma query nossa. Quem separa empresa continua sendo o codigo, no
-- portao de permissoes — e e la que essa regra deve ser lida e corrigida.
--
-- O QUE ISTO RESOLVE, ENTAO
--
-- Um projeto Supabase expoe o PostgREST na internet, e a chave "anon" e
-- publica por natureza (ela nasceu para ir dentro do navegador). Com RLS
-- DESLIGADA, os papeis anon e authenticated enxergam as tabelas do schema
-- public. Ou seja: hoje qualquer um com essa chave le users, people, orders,
-- nfe e certificado_digital.
--
-- Conferido em 22/08/2026: zero "enable row level security" e zero
-- "create policy" no schema. E so o servidor fala com o Supabase — nao existe
-- cliente Supabase no navegador (conferido em public/), entao ligar RLS nao
-- quebra tela nenhuma.
--
-- O DESENHO
--
-- Liga RLS nas 77 tabelas e NAO cria politica permissiva. Sem politica, o
-- Postgres nega tudo para anon e authenticated; service_role passa por cima,
-- como sempre passou. O app continua identico e a porta da rua fecha.
--
-- Se um dia alguma tela falar direto com o Supabase (usando o Auth dele), ai
-- sim entram politicas por usuario — e ai existira um auth.uid() para elas
-- consultarem, coisa que hoje nao existe.
--
-- A LISTA E CONFERIDA, NAO CHUTADA
--
-- Os nomes saem de um levantamento contra o banco. A primeira sonda usou
-- head:true e o PostgREST engoliu o erro de tabela inexistente: deu "78 de 78
-- existem", incluindo uma tabela "em" que na verdade veio de um comentario em
-- portugues ("ALTER TABLE em nfe_itens"). Refeita sem head:true, sobraram 77.
--
-- COMO VOLTAR ATRAS
--
--   alter table <nome> disable row level security;
--
-- Nao mexe em dado nenhum: so liga uma trava, tabela a tabela, reversivel do
-- mesmo jeito.
-- ---------------------------------------------------------------------------
alter table if exists access_logs enable row level security;
alter table if exists account_balances enable row level security;
alter table if exists audit_logs enable row level security;
alter table if exists bank_accounts enable row level security;
alter table if exists bank_cards enable row level security;
alter table if exists bank_transactions enable row level security;
alter table if exists card_transactions enable row level security;
alter table if exists certificado_digital enable row level security;
alter table if exists cfop enable row level security;
alter table if exists classificacao_tributaria enable row level security;
alter table if exists cnpjs enable row level security;
alter table if exists contract_templates enable row level security;
alter table if exists contract_types enable row level security;
alter table if exists contracts enable row level security;
alter table if exists cost_centers enable row level security;
alter table if exists crm_connection enable row level security;
alter table if exists csosn enable row level security;
alter table if exists cst_ibs_cbs enable row level security;
alter table if exists cst_icms enable row level security;
alter table if exists cst_ipi enable row level security;
alter table if exists cst_pis_cofins enable row level security;
alter table if exists declaracao_importacao enable row level security;
alter table if exists deposits enable row level security;
alter table if exists di_adicao enable row level security;
alter table if exists empresa enable row level security;
alter table if exists estabelecimento enable row level security;
alter table if exists financial_categories enable row level security;
alter table if exists financial_entries enable row level security;
alter table if exists financial_institutions enable row level security;
alter table if exists financial_payments enable row level security;
alter table if exists fleet_maintenances enable row level security;
alter table if exists fleet_refuels enable row level security;
alter table if exists fleet_vehicles enable row level security;
alter table if exists grupo_economico enable row level security;
alter table if exists hr_departments enable row level security;
alter table if exists hr_employee_categories enable row level security;
alter table if exists hr_employee_types enable row level security;
alter table if exists hr_employees enable row level security;
alter table if exists hr_leaves enable row level security;
alter table if exists hr_positions enable row level security;
alter table if exists hr_time_entries enable row level security;
alter table if exists hr_work_schedules enable row level security;
alter table if exists import_logs enable row level security;
alter table if exists nfe enable row level security;
alter table if exists nfe_arquivos enable row level security;
alter table if exists nfe_eventos enable row level security;
alter table if exists nfe_items enable row level security;
alter table if exists nfes enable row level security;
alter table if exists open_finance_audit_logs enable row level security;
alter table if exists open_finance_connections enable row level security;
alter table if exists open_finance_webhook_events enable row level security;
alter table if exists orders enable row level security;
alter table if exists origem_mercadoria enable row level security;
alter table if exists pcp_bom enable row level security;
alter table if exists pcp_entries enable row level security;
alter table if exists pcp_orders enable row level security;
alter table if exists pcp_quality_checks enable row level security;
alter table if exists pcp_sectors enable row level security;
alter table if exists pcp_statuses enable row level security;
alter table if exists people enable row level security;
alter table if exists permissions enable row level security;
alter table if exists product_class_assignments enable row level security;
alter table if exists product_class_value_assignments enable row level security;
alter table if exists product_class_values enable row level security;
alter table if exists product_classes enable row level security;
alter table if exists products enable row level security;
alter table if exists purchases enable row level security;
alter table if exists quotes enable row level security;
alter table if exists regra_fiscal enable row level security;
alter table if exists role_permissions enable row level security;
alter table if exists roles enable row level security;
alter table if exists sales enable row level security;
alter table if exists serie_nfe enable row level security;
alter table if exists settings enable row level security;
alter table if exists user_permissions enable row level security;
alter table if exists user_roles enable row level security;
alter table if exists users enable row level security;

-- Conferencia no proprio SQL Editor: esta consulta tem que voltar VAZIA.
--
--   select tablename from pg_tables
--    where schemaname = 'public' and rowsecurity = false;


-- ============================================================================
-- >>> supabase/migrations/fase-ag-preferencias-do-usuario.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AG — preferencias de tela por usuario
--
-- A lista de Pedidos e Orcamentos ganhou seletor de colunas, e a escolha
-- precisa seguir a PESSOA, nao o navegador. Guardar em localStorage pareceria
-- funcionar ate alguem trocar de maquina ou abrir numa aba anonima e achar que
-- o sistema esqueceu.
--
-- Uma coluna jsonb generica, e nao uma por tela: a proxima lista que precisar
-- lembrar de algo (largura de coluna, ordem preferida, filtro salvo) entra sem
-- migracao nova. O formato e { "<tela>": { ...o que aquela tela quiser } }.
--
-- Segue o caminho que ja existia para dashboard_pins, na mesma tabela.
alter table if exists users add column if not exists preferences jsonb not null default '{}'::jsonb;

comment on column users.preferences is
  'Preferencias de tela por usuario, no formato { "<tela>": {...} }. Hoje guarda as colunas visiveis da lista de vendas.';


-- ============================================================================
-- >>> supabase/migrations/fase-ah-grupos-de-produtos.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ATENCAO -- A TELA DE GRUPOS FOI RETIRADA EM 25/08/2026.
--
-- O pedido nao tem mais grupos: a tela de Produtos voltou a ser uma lista so.
-- Os grupos separavam o que ninguem separava na pratica, e toda venda nascia
-- com um "Grupo de Produtos Padrao - 01" que so ocupava espaco.
--
-- A COLUNA CONTINUA NO BANCO, E DE PROPOSITO. Ela guarda os grupos dos pedidos
-- que ja foram gravados com eles; apagar a coluna apagaria esse historico para
-- sempre, e o ganho seria zero -- uma coluna jsonb que ninguem le nao custa
-- consulta nem espaco relevante. Os itens nunca dependeram dela: sempre foram
-- lista plana, e o `groupId` de cada item virou um campo que ninguem le.
--
-- Se um dia a funcao voltar, o dado esta aqui. Se nunca voltar, nada quebra.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Fase AH — Grupos de Produtos no pedido e no orcamento
--
-- O pedido passa a ter 1..N grupos ("Grupo de Produtos Padrao - 01",
-- renomeavel), cada um com seus itens e seu total.
--
-- MODELO: o grupo e METADADO sobre a lista PLANA de itens que ja existe, e nao
-- um nivel a mais dentro dela.
--
--   items          [ {..., "groupId": "grp-a"}, {..., "groupId": "grp-b"} ]
--   product_groups [ {"id":"grp-a","name":"...","ordem":0}, ... ]
--
-- O pedido inteiro ja e lido como lista plana de itens em muitos lugares --
-- baixa de estoque, reserva, totais, payload da NF-e, tabela de precos.
-- Aninhar os itens dentro dos grupos obrigaria todos eles a saber de grupo so
-- para somar uma quantidade, e cada um que esquecesse passaria a ignorar tudo
-- que nao estivesse no primeiro grupo -- em silencio, que e o pior jeito de
-- errar estoque. Um campo a mais dentro do item e ignorado por quem nao se
-- importa, que e a maioria.
--
-- Esta migracao e ADITIVA: nao mexe em `items`, nao apaga nada e nao muda tipo
-- de coluna. Pedido gravado antes dela continua valido -- fica com
-- product_groups = [] e, na primeira leitura, a normalizacao poe todos os itens
-- num grupo padrao. Nenhum item se perde por nao ter groupId.
--
-- Vale para as DUAS tabelas: orcamento vira pedido sem trocar de tabela, e um
-- orcamento que perdesse os grupos ao ser aprovado seria pior do que nunca
-- te-los tido.
-- ---------------------------------------------------------------------------

alter table if exists orders add column if not exists product_groups jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists product_groups jsonb not null default '[]'::jsonb;

comment on column orders.product_groups is
  'Grupos de produtos do pedido: [{"id","name","ordem"}]. Os itens ficam em `items`, cada um com "groupId" apontando para um destes. Lista vazia = pedido de antes da fase AH; a leitura cria o grupo padrao.';

comment on column quotes.product_groups is
  'Grupos de produtos do orcamento: [{"id","name","ordem"}]. Mesmo formato de orders.product_groups.';


-- ============================================================================
-- >>> supabase/migrations/fase-ai-anexos-do-pedido.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AI — Arquivos Anexados ao pedido e ao orcamento
--
-- O ARQUIVO nao fica aqui. O binario vai para o Supabase Storage, no bucket
-- `pedido-anexos`, e esta coluna guarda so a FICHA de cada arquivo:
--
--   [{ "id", "nome", "tamanho", "tipo", "caminho", "enviadoEm", "enviadoPor" }]
--
-- Guardar o binario no banco (bytea ou base64 num jsonb) faria cada leitura do
-- pedido arrastar os anexos junto: abrir a lista de pedidos passaria a
-- transferir megabytes de PDF que ninguem pediu. O `caminho` e o que liga a
-- ficha ao arquivo la no Storage.
--
-- O bucket e PRIVADO. Anexo de pedido tem contrato, proposta e dado de
-- cliente; bucket publico faria cada arquivo ficar legivel por qualquer um que
-- descobrisse a URL, sem login nenhum. O download passa pelo servidor, que
-- confere a sessao antes de entregar os bytes.
--
-- Migracao ADITIVA: nao mexe em nada existente. Pedido gravado antes dela fica
-- com `attachments = []`, que e exatamente "nenhum anexo".
--
-- Vale para as DUAS tabelas: orcamento vira pedido sem trocar de tabela, e
-- perder os anexos ao aprovar seria pior do que nunca te-los aceitado.
-- ---------------------------------------------------------------------------

alter table if exists orders add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column orders.attachments is
  'Fichas dos arquivos anexados: [{"id","nome","tamanho","tipo","caminho","enviadoEm","enviadoPor"}]. O binario fica no Supabase Storage, bucket privado `pedido-anexos`; `caminho` e a chave la dentro.';

comment on column quotes.attachments is
  'Fichas dos arquivos anexados ao orcamento. Mesmo formato de orders.attachments.';


-- ============================================================================
-- >>> supabase/migrations/fase-aj-transicoes-de-status.sql
-- ============================================================================

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


-- ============================================================================
-- >>> supabase/migrations/fase-ak-entrada-de-nfe.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AK -- Entrada de NF-e (a nota que o FORNECEDOR emitiu contra nos)
--
-- O QUE MUDA DE MAO AQUI
-- ----------------------
-- Todo o resto do modulo fiscal trata de nota que EU emito: `nfe` tem
-- `referencia` unica para a Focus, `payload_enviado`, `resposta_focus`,
-- `estabelecimento_id`. Nada disso existe numa nota recebida -- ela ja veio
-- pronta e autorizada, eu nao transmiti nada. Encaixar entrada naquela tabela
-- deixaria metade das colunas nulas para sempre e, pior, misturaria na mesma
-- lista o que eu emiti com o que me emitiram: a primeira consulta de "minhas
-- notas" que alguem escrevesse sem filtrar traria as duas coisas.
--
-- Por isso duas tabelas proprias.
--
-- POR QUE O XML FICA NA LINHA (E NAO NO STORAGE)
-- ----------------------------------------------
-- O XML *e* o documento fiscal -- o resto e leitura minha dele. Guardado na
-- linha, ele entra no backup de dados junto com tudo (scripts/backup-supabase.js
-- exporta tabelas; Storage e outra passada, com outro modo de falhar). Uma nota
-- tem entre 20 KB e 200 KB; a coluna so e lida quando alguem abre a nota, nunca
-- na listagem, porque nenhuma consulta de lista faz `select *`.
--
-- NAO EXISTE ROTA DE EXCLUSAO, E ISSO E DE PROPOSITO
-- --------------------------------------------------
-- Vale para documento recebido a mesma regra que vale para documento emitido:
-- nota fiscal nao se apaga. Uma entrada lancada por engano se corrige com
-- devolucao ou com a escrituracao, nunca sumindo com a linha. O `on delete
-- cascade` dos itens existe para o dia em que alguem precisar limpar dado de
-- teste direto no banco -- nao ha caminho para isso pelo aplicativo.
--
-- O DE-PARA QUE APRENDE SOZINHO
-- -----------------------------
-- `codigo_fornecedor` guarda o cProd -- o codigo do produto NA CASA DO
-- FORNECEDOR. Quando alguem vincula o item a um produto meu, o par
-- (fornecedor, cProd) -> product_id fica registrado aqui, e a proxima nota do
-- mesmo fornecedor ja chega com o vinculo sugerido. E um de-para construido
-- pelo uso, sem tabela de cadastro que ninguem preencheria.
--
-- DEPOIS DE RODAR ESTA MIGRACAO
-- ------------------------------
-- `node scripts/prova-entrada-nfe.js` grava uma nota de prova, tenta lancar a
-- mesma chave duas vezes, confere o CHECK do status e apaga tudo no fim. E o
-- unico caminho que prova que as colunas do INSERT existem AQUI -- a suite de
-- `npm test` le arquivo, e arquivo nao sabe o que foi aplicado no banco.
-- ---------------------------------------------------------------------------

create table if not exists nfe_entrada (
  id text primary key,

  -- A chave e a identidade da nota no Brasil inteiro. UNIQUE aqui e o que
  -- impede lancar a mesma nota duas vezes -- e a defesa que nao depende de a
  -- tela lembrar de conferir.
  chave char(44) not null unique,

  modelo text,
  serie text,
  numero text,
  data_emissao date,
  natureza_operacao text,

  -- Emitente = fornecedor. O documento fica gravado mesmo quando ha cadastro,
  -- porque e por ele que a proxima nota reencontra o fornecedor, e porque
  -- cadastro pode ser editado depois.
  emitente_documento text not null,
  emitente_nome text not null,
  emitente_ie text,

  -- people.id OU cnpjs.id. Polimorfico e sem FK, igual a
  -- financial_entries.client_supplier_id -- as duas tabelas de contraparte
  -- vivem separadas desde a Fase A.
  cadastro_id text,

  destinatario_documento text,

  valor_produtos numeric(15,2) not null default 0,
  valor_total numeric(15,2) not null default 0,

  -- LANCADA: conferida e aceita. REVISAR: gravada com pendencia conhecida
  -- (item sem produto, por exemplo) para nao obrigar a resolver tudo na hora.
  status text not null default 'LANCADA' check (status in ('LANCADA', 'REVISAR')),

  movimentou_estoque boolean not null default false,
  gerou_financeiro boolean not null default false,

  xml text not null,

  -- A nota inteira ja lida (emitente, itens, totais, duplicatas, protocolo).
  -- Existe para a tela nao precisar reprocessar o XML a cada abertura, e para
  -- o dia em que o layout mudar: o que foi lido no dia do lancamento fica
  -- congelado como estava.
  resumo jsonb not null default '{}'::jsonb,

  criado_por text references users(id),
  criado_por_nome text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_nfe_entrada_emitente on nfe_entrada (emitente_documento, criado_em desc);
create index if not exists idx_nfe_entrada_data on nfe_entrada (data_emissao desc);

create table if not exists nfe_entrada_item (
  id text primary key,
  entrada_id text not null references nfe_entrada(id) on delete cascade,

  numero integer not null default 0,
  codigo_fornecedor text,
  ean text,
  descricao text not null,
  ncm text,
  cfop text,
  unidade text,
  quantidade numeric(15,4) not null default 0,
  valor_unitario numeric(15,10) not null default 0,
  valor_total numeric(15,2) not null default 0,

  product_id text references products(id),

  -- Como o vinculo foi feito: historico, gtin, codigo, descricao ou manual.
  -- Fica gravado porque muda o quanto se pode confiar nele: casado por GTIN e
  -- fato, casado por descricao e palpite. Numa auditoria de estoque, saber
  -- qual foi qual e a diferenca entre achar o erro e procurar no escuro.
  vinculo_origem text,

  movimentou_estoque boolean not null default false,

  -- ICMS/IPI/PIS/COFINS do item, como vieram na nota. Guardados porque a
  -- apuracao de credito nasce daqui -- e nao daria para reconstruir depois sem
  -- reprocessar o XML item a item.
  imposto jsonb not null default '{}'::jsonb
);

create index if not exists idx_nfe_entrada_item_entrada on nfe_entrada_item (entrada_id);
-- O indice do de-para: so as linhas que tem produto vinculado interessam.
create index if not exists idx_nfe_entrada_item_depara on nfe_entrada_item (codigo_fornecedor) where product_id is not null;

-- RLS: mesma decisao da fase-af. O aplicativo usa service_role, que IGNORA
-- RLS; ligar aqui fecha a porta do PostgREST com a chave `anon`, que e publica.
-- Sem policy nenhuma de proposito -- ninguem alem do servidor le estas tabelas.
alter table if exists nfe_entrada enable row level security;
alter table if exists nfe_entrada_item enable row level security;

comment on table nfe_entrada is
  'NF-e recebida de fornecedor (entrada). Documento de terceiro: nao tem referencia da Focus nem protocolo meu. Nunca e excluida -- correcao se faz por devolucao.';
comment on column nfe_entrada.chave is
  'Chave de acesso de 44 digitos. UNIQUE: e o que impede a mesma nota entrar duas vezes.';
comment on column nfe_entrada_item.codigo_fornecedor is
  'cProd -- codigo do produto na casa do FORNECEDOR, nao no meu estoque. Com product_id preenchido, forma o de-para reaproveitado na proxima nota do mesmo fornecedor.';


-- ============================================================================
-- >>> supabase/migrations/fase-al-usuario-vendedor.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fase AL -- A ponte entre QUEM FAZ LOGIN e QUEM VENDE
--
-- O PROBLEMA QUE ESTA COLUNA RESOLVE
-- ----------------------------------
-- O vendedor de um pedido e uma PESSOA do Cadastros (`people`, com o papel
-- "Vendedor"): orders.seller_id aponta para la. Quem faz login e uma linha de
-- `users`. Sao duas tabelas diferentes desde a Fase A, e por bons motivos --
-- vendedor nao precisa ter login (representante externo, vendedor que saiu da
-- empresa mas cujas vendas continuam no historico), e usuario nao precisa
-- vender (o financeiro, o estoquista, o admin).
--
-- Enquanto as duas nao se falavam, a pergunta "quais vendas sao SUAS?" nao
-- tinha resposta possivel, e o Relatorio de Vendas so conseguia oferecer duas
-- opcoes ruins: mostrar tudo para todo mundo, ou pedir para a pessoa escolher
-- o proprio nome num filtro -- que qualquer um pode trocar.
--
-- POR QUE UMA COLUNA, E NAO CASAR PELO NOME
-- -----------------------------------------
-- Casar `users.name` com `people.name` custaria zero e e a armadilha: dois
-- "Joao Silva" no cadastro, ou um acento a menos, e o relatorio passa a mostrar
-- as vendas de outra pessoa -- ou nenhuma -- sem erro nenhum aparecer. Controle
-- de acesso que erra em silencio e pior do que controle nenhum, porque ninguem
-- vai procurar o defeito.
--
-- NULO E O PADRAO, E E O CASO MAIS RESTRITIVO
-- -------------------------------------------
-- Usuario sem vinculo nao ve venda nenhuma no relatorio (fora administrador,
-- que ve tudo por outro caminho). E de proposito: o ramo "sem filtro" nunca
-- pode ser o padrao de quem o sistema nao sabe quem e. A tela mostra o motivo
-- e diz o que fazer, em vez de uma lista vazia sem explicacao.
--
-- SEM FOREIGN KEY, IGUAL AO RESTO DO SISTEMA
-- ------------------------------------------
-- `people` e `cnpjs` sao as duas tabelas de contraparte, e o sistema inteiro
-- aponta para elas por id solto (financial_entries.client_supplier_id,
-- nfe_entrada.cadastro_id). Uma FK aqui seria a unica do genero e impediria
-- apagar uma pessoa que ja foi vendedora -- exatamente o registro que o
-- historico de vendas precisa manter.
-- ---------------------------------------------------------------------------

alter table if exists users
  add column if not exists seller_id text;

create index if not exists idx_users_seller on users (seller_id) where seller_id is not null;

comment on column users.seller_id is
  'people.id do vendedor que este usuario E. Define quais vendas ele ve no Relatorio de Vendas quando nao e administrador. Nulo = nenhuma venda (falha fechada), nunca "todas".';

