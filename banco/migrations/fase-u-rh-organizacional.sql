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
