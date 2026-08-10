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
