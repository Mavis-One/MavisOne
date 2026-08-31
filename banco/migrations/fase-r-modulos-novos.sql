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
