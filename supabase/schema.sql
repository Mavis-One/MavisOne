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
