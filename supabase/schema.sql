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
  created_at timestamptz not null default now()
);

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

create table if not exists orders (
  id text primary key,
  type text not null default 'order',
  customer text not null,
  date date not null,
  amount numeric not null default 0,
  status text not null default 'pendente',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists quotes (
  id text primary key,
  type text not null default 'quote',
  customer text not null,
  date date not null,
  amount numeric not null default 0,
  status text not null default 'em aberto',
  note text,
  created_at timestamptz not null default now()
);

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
