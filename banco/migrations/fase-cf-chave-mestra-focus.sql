-- ============================================================================
-- FASE CF — a chave mestra da Focus NFe passa a morar no banco
-- ============================================================================
--
-- O QUE EXISTE HOJE
-- -----------------
--   estabelecimento.focus_token_cifrado  → um token por CNPJ completo (14).
--                                          É ELE que emite: na Focus, o token
--                                          diz de quem é a nota.
--   FOCUS_NFE_TOKEN (.env)               → token único de reserva, usado só
--                                          enquanto a trava de homologação
--                                          está ligada.
--
-- O que NÃO existe é um lugar para a CHAVE MESTRA: o token principal da conta
-- Focus, o que vale para a conta inteira em vez de para um CNPJ. É com ele que
-- se faz o que não pertence a nenhuma filial — listar as empresas da conta
-- (GET /empresas responde 404 para token comum), cadastrar uma empresa nova,
-- conferir se a conta está de pé antes de existir qualquer estabelecimento.
--
-- Guardar isso no .env tem três problemas práticos: só troca com deploy, não
-- cabe duas (homologação e produção convivem, e hoje é preciso reescrever a
-- variável para trocar de ambiente), e fica em texto puro no disco do servidor.
--
-- POR QUE OS TOKENS SÃO `bytea` E NÃO `varchar`
-- ---------------------------------------------
-- Porque este projeto já criptografa segredo em repouso (lib/secrets.js,
-- AES-256-GCM) e é assim que `estabelecimento.focus_token_cifrado` e
-- `open_finance_connections.credenciais_cifradas` estão gravados. A chave
-- mestra é MAIS sensível que qualquer um deles: o token de uma filial emite
-- por uma filial; o principal responde pela conta toda. Um backup do banco,
-- um dump colado num chamado, um SELECT de quem só deveria ler relatório —
-- com varchar, cada um desses vira o token na tela de alguém.
-- O sufixo `_cifrado` é o aviso de que ali não tem texto legível.
--
-- A chave usada é a FOCUS_TOKEN_ENCRYPTION_KEY, a mesma do token da filial: é
-- o mesmo domínio (Focus NFe), e separar chave por tabela dentro do mesmo
-- domínio multiplicaria segredo para gerir sem isolar nada de novo.
--
-- DOIS AMBIENTES NA MESMA LINHA
-- -----------------------------
-- Homologação e produção coexistem em colunas próprias porque são tokens
-- diferentes da mesma conta. Quem estiver testando não precisa apagar o de
-- produção para testar, e ligar a produção um dia não é digitar de novo um
-- segredo que já se tinha — é desligar a trava (FOCUS_NFE_SOMENTE_HOMOLOGACAO).
--
-- O QUE A CHAVE MESTRA NÃO FAZ
-- ----------------------------
-- Ela NÃO substitui o token do estabelecimento na emissão. Continua valendo a
-- regra de lib/focusnfe.js: em produção, cada CNPJ emite com o token dele, e
-- nenhuma reserva é aceita — uma nota autorizada com o emitente errado não tem
-- desfazer. A chave mestra entra como reserva no mesmo lugar (e sob a mesma
-- condição) em que o FOCUS_NFE_TOKEN entra hoje: só com a trava ligada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. AS INTEGRAÇÕES DA CASA
-- ---------------------------------------------------------------------------
-- Uma linha por provedor externo. Nasce com a Focus NFe e cabe a próxima
-- (adquirente, outro emissor) sem precisar de outra tabela.
create table if not exists integracoes (
  id uuid primary key default gen_random_uuid(),

  nome text not null,                 -- como aparece na tela: "Focus NFe"

  -- Chave natural. É por ele que o código procura ('FOCUS_NFE'), e é o unique
  -- que impede a mesma integração cadastrada duas vezes com tokens diferentes
  -- — o que seria um sistema com duas verdades sobre qual token é o bom.
  provedor text not null unique,

  token_principal_homologacao_cifrado bytea,
  token_principal_producao_cifrado    bytea,

  ativo boolean not null default true,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- O `ON UPDATE CURRENT_TIMESTAMP` do MySQL não existe no Postgres: é trigger.
-- Vale a pena aqui porque `atualizado_em` numa tabela de segredo é a resposta
-- para "quando esse token mudou?" — a pergunta que se faz quando a emissão
-- começa a tomar 401 e ninguém lembra de ter mexido.
create or replace function toca_atualizado_em()
returns trigger
language plpgsql
as $func$
begin
  new.atualizado_em := now();
  return new;
end;
$func$;

drop trigger if exists trg_integracoes_atualizado_em on integracoes;
create trigger trg_integracoes_atualizado_em
  before update on integracoes
  for each row execute function toca_atualizado_em();

comment on table integracoes is
  'Provedores externos e a chave mestra de cada um (fase CF). Os tokens são '
  'cifrados com AES-256-GCM (lib/secrets.js, FOCUS_TOKEN_ENCRYPTION_KEY) — '
  'nunca gravar texto puro aqui.';

comment on column integracoes.token_principal_homologacao_cifrado is
  'Token principal da CONTA na Focus NFe, ambiente de homologação. Não é o '
  'token de emissão de um CNPJ (esse é estabelecimento.focus_token_cifrado).';

comment on column integracoes.token_principal_producao_cifrado is
  'Token principal da CONTA na Focus NFe, ambiente de produção. Só é alcançado '
  'com FOCUS_NFE_SOMENTE_HOMOLOGACAO desligada.';

-- ---------------------------------------------------------------------------
-- 2. QUAIS EMPRESAS USAM CADA INTEGRAÇÃO
-- ---------------------------------------------------------------------------
-- O vínculo existe para duas perguntas diferentes:
--
--   `ativo`  → esta empresa usa esta integração? Desligar aqui para uma
--              empresa não derruba as outras, e não apaga token nenhum.
--   token    → esta empresa tem um token PRÓPRIO, diferente do principal?
--
-- ATENÇÃO AO NÍVEL: a tabela é por EMPRESA (raiz de CNPJ, 8 dígitos), e quem
-- emite é o ESTABELECIMENTO (CNPJ completo, 14). Uma empresa com matriz e duas
-- filiais tem TRÊS tokens de emissão na Focus, um por CNPJ — e eles continuam
-- em `estabelecimento.focus_token_cifrado`, que é o único lugar onde cabem.
-- O token daqui é reserva do grupo, não o da nota: vale para operação de conta
-- e, na emissão, só sob a trava de homologação (ver lib/focusnfe.js).
create table if not exists empresas_integracoes (
  -- uuid dos dois lados porque é o que `empresa.id` e `integracoes.id` são.
  empresa_id    uuid not null references empresa(id)     on delete cascade,
  integracao_id uuid not null references integracoes(id) on delete cascade,

  token_empresa_homologacao_cifrado bytea,
  token_empresa_producao_cifrado    bytea,

  ativo boolean not null default true,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- A chave é o par: vincular duas vezes é a mesma decisão.
  primary key (empresa_id, integracao_id)
);

-- A chave primária serve à pergunta "o que esta empresa usa?". Este índice é a
-- outra ponta: "quem usa a Focus?", feita ao abrir a tela da integração.
create index if not exists idx_empresas_integracoes_por_integracao
  on empresas_integracoes (integracao_id);

drop trigger if exists trg_empresas_integracoes_atualizado_em on empresas_integracoes;
create trigger trg_empresas_integracoes_atualizado_em
  before update on empresas_integracoes
  for each row execute function toca_atualizado_em();

comment on table empresas_integracoes is
  'Quais empresas usam cada integração, com token próprio opcional (fase CF). '
  'O token que emite NF-e é o do estabelecimento (CNPJ completo), não este.';

-- ---------------------------------------------------------------------------
-- 3. A LINHA DA FOCUS NFe
-- ---------------------------------------------------------------------------
-- Sem token: ele entra pela aplicação, cifrado. Um placeholder em texto aqui
-- ('SEU_TOKEN_...') seria um valor que parece configurado, não passa na
-- validação de formato e, no dia em que alguém colasse o token de verdade por
-- cima dele via SQL, entraria legível — que é exatamente o que esta fase veio
-- impedir.
insert into integracoes (nome, provedor)
values ('Focus NFe', 'FOCUS_NFE')
on conflict (provedor) do nothing;

-- Toda empresa já cadastrada passa a usar a Focus. É o estado de fato: o
-- sistema inteiro já emite por ela. O vínculo nasce sem token próprio — quem
-- emite continua sendo o token de cada estabelecimento.
insert into empresas_integracoes (empresa_id, integracao_id)
select e.id, i.id
  from empresa e
 cross join integracoes i
 where i.provedor = 'FOCUS_NFE'
on conflict (empresa_id, integracao_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Como em todo o resto do schema: ligada e sem policy. Só o servidor fala com
-- o banco, pelo dono da conexão, que ignora RLS. Vale dobrado numa tabela de
-- segredo: uma conexão que apareça depois (BI, cliente no navegador) não lê
-- nem o token cifrado por acidente.
alter table if exists integracoes          enable row level security;
alter table if exists empresas_integracoes enable row level security;
