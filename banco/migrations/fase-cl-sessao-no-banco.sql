-- ============================================================================
-- FASE CL — a sessão de login sai da memória do processo e vai para o banco
-- ============================================================================
--
-- O QUE ACONTECIA, MEDIDO EM 16/09/2026
-- -------------------------------------
-- O escritório relatou que ninguém ficava conectado mais de dez minutos, e a
-- tela dizia "Não autenticado" — cair, recarregar, logar de novo, repetir.
--
-- Não havia (e não há) prazo de dez minutos em lugar nenhum: a sessão nasce
-- valendo até a meia-noite local (lib/sessao.js). O que havia era o PROCESSO
-- REINICIANDO, e a sessão morando na memória dele:
--
--   sessions          -> quem está logado          } os dois em RAM,
--   sessoesEncerradas -> por que alguém caiu        } os dois zerados no boot
--
-- Reinício apagava os dois juntos, e é a perda do SEGUNDO que produzia a
-- experiência ruim. Sem ele, o servidor não sabe dizer por que o token morreu:
-- responde 401 sem `motivo`, e a tela — que só volta ao login quando existe um
-- `motivo` para mostrar — fica aberta dando erro a cada clique até alguém
-- apertar F5. Um deploy, um `pm2 restart` ou um tropeço de um segundo no
-- Postgres deslogava o escritório inteiro sem explicar nada a ninguém.
--
-- Com a sessão no banco, reinício deixa de ser um evento para o usuário: o
-- token continua valendo porque a verdade sobre ele sobreviveu ao processo.
--
-- POR QUE `token_hash` E NÃO O TOKEN
-- ----------------------------------
-- O token É a credencial: quem o tem está logado, sem senha e sem segundo
-- fator. Gravá-lo em texto significaria que todo lugar por onde uma cópia do
-- banco passa passa a conter credencial viva — e neste projeto o banco SAI DA
-- MÁQUINA por desenho (deploy/backup-banco, com envio para nuvem via rclone).
-- Um dump num chamado, um backup num drive compartilhado, e quem ler entra como
-- a pessoa, não como alguém que precisa quebrar uma senha.
--
-- SHA-256 puro, sem sal e sem bcrypt, e isso é decisão e não economia: o token
-- são 256 bits de `crypto.randomBytes` (ver criarTokenDeSessao em server.js).
-- Sal e custo de derivação existem contra dicionário e forca-bruta, que é o
-- problema de SENHA — texto curto que uma pessoa escolheu e consegue lembrar.
-- Não há dicionário de 2^256, então o custo não compraria segurança; compraria
-- ~100ms de bcrypt em TODA requisição do sistema, porque o portão de acesso
-- procura a sessão a cada chamada.
--
-- POR QUE A LINHA FICA DEPOIS DE ENCERRADA
-- ----------------------------------------
-- `encerrada_em` + `motivo` são o que o mapa `sessoesEncerradas` fazia em
-- memória, e servem à mesma pergunta: POR QUE eu caí. Apagar a linha no logout
-- ou na virada do dia deixaria "sessão que terminou por um motivo conhecido" e
-- "token que nunca existiu" indistinguíveis — e aí o usuário recebe de novo o
-- "Não autenticado" que esta fase existe para eliminar.
--
-- Doze horas de retenção, como era em memória: depois disso a linha não
-- responde mais pergunta nenhuma (ninguém investiga por que caiu ontem com um
-- token que já não existe) e vira peso. A varredura limpa.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A TABELA
-- ---------------------------------------------------------------------------
create table if not exists sessoes (
  -- A CHAVE É O HASH, e é primary key de propósito: duas linhas para o mesmo
  -- token seriam duas verdades sobre quem está logado. 32 bytes de SHA-256.
  token_hash bytea primary key,

  -- `text` porque `users.id` é text neste schema ('user-admin'), não uuid.
  -- CASCADE: usuário excluído não deixa sessão órfã capaz de autenticar — o
  -- `getCurrentUser` já barraria (não acha o usuário), mas depender da segunda
  -- barreira para a primeira não mentir é frágil de graça.
  user_id text not null references users(id) on delete cascade,

  criada_em timestamptz not null default now(),

  -- Calculado na CRIAÇÃO e gravado, nunca recalculado na leitura. É a mesma
  -- razão que o comentário do `sessions` em memória já registrava: recalcular
  -- daria sempre "a próxima meia-noite a partir de agora", e a sessão nunca
  -- venceria. Aqui a armadilha é pior, porque a linha persiste entre reinícios.
  expira_em timestamptz not null,

  -- Nulo = sessão viva. Preenchido = terminou, e `motivo` diz como.
  encerrada_em timestamptz,

  -- A lista fechada é a de lib/sessao.js (MOTIVOS) mais 'logout', que é o
  -- único que a tela não precisa explicar — quem clicou em Sair sabe por quê.
  -- `check` e não texto livre: motivo novo sem frase na tela viraria "Sua
  -- sessão foi encerrada" genérico, que é o que a fase CL vem consertar.
  motivo text check (motivo in ('outro-dispositivo', 'fim-do-dia', 'logout')),

  -- De onde a sessão nasceu. Não autentica nada (IP não é identidade), serve à
  -- auditoria: "minha conta caiu" fica respondível quando se vê de qual
  -- endereço veio o login que derrubou.
  ip inet,

  -- Encerrada tem que ter motivo, e motivo sem encerrada seria uma sessão viva
  -- alegando ter morrido. O banco recusa os dois meios-estados.
  constraint sessoes_encerrada_com_motivo check (
    (encerrada_em is null and motivo is null) or
    (encerrada_em is not null and motivo is not null)
  )
);

-- ---------------------------------------------------------------------------
-- 2. ÍNDICES — um por pergunta que o código faz
-- ---------------------------------------------------------------------------
-- "quais sessões vivas são deste usuário?" — o login pergunta isso a cada
-- entrada, para derrubar as outras máquinas (sessão única por usuário).
-- Parcial: sessão encerrada não interessa a essa pergunta, e deixá-la fora
-- mantém o índice do tamanho do que está em uso, não do histórico.
create index if not exists idx_sessoes_usuario_vivas
  on sessoes (user_id)
  where encerrada_em is null;

-- "o que já venceu?" — a varredura periódica. Mesma razão para ser parcial.
create index if not exists idx_sessoes_expira
  on sessoes (expira_em)
  where encerrada_em is null;

-- "o que já passou das 12h?" — a limpeza do histórico encerrado.
create index if not exists idx_sessoes_encerradas
  on sessoes (encerrada_em)
  where encerrada_em is not null;

comment on table sessoes is
  'Sessões de login (fase CL). Antes viviam em memória do processo, e todo '
  'reinício deslogava todo mundo sem explicar por quê. Guarda o SHA-256 do '
  'token, nunca o token: o banco sai da máquina nos backups.';

comment on column sessoes.token_hash is
  'SHA-256 do token de sessão. O token tem 256 bits de crypto.randomBytes, '
  'então hash sem sal basta — sal e bcrypt defendem senha contra dicionário, '
  'e custariam ~100ms em toda requisição do sistema.';

comment on column sessoes.expira_em is
  'Meia-noite local seguinte ao login (lib/sessao.js). Gravado na criação; '
  'recalcular na leitura faria a sessão nunca vencer.';

comment on column sessoes.motivo is
  'Por que terminou, para a tela poder explicar. A linha fica 12h depois de '
  'encerrada: apagar na hora tornaria "logout" e "token inexistente" a mesma '
  'coisa aos olhos do servidor.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
-- Como em todo o resto do schema: ligada e sem policy. Só o servidor fala com
-- o banco, pelo dono da conexão, que ignora RLS. Vale dobrado aqui: uma
-- conexão que apareça depois (BI, relatório, cliente no navegador) não lê nem
-- o hash de sessão de ninguém por acidente.
alter table if exists sessoes enable row level security;
