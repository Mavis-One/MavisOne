-- ============================================================================
-- FASE AR — as notas que terceiros emitiram contra o nosso CNPJ (DF-e)
-- ============================================================================
--
-- O QUE É
-- -------
-- Quando um fornecedor emite uma NF-e contra o nosso CNPJ, ela existe na SEFAZ
-- antes de existir aqui. O serviço de Distribuição de DF-e é como se pergunta
-- "o que emitiram contra mim?", e a resposta vem numerada por NSU — um contador
-- sequencial POR CNPJ, mantido pela SEFAZ.
--
-- Até esta fase, uma nota só entrava no sistema se alguém pedisse o XML ao
-- fornecedor e o colasse na tela de Entrada. Nota que ninguém pediu não existia
-- — inclusive as emitidas contra nós por engano ou por fraude, que são
-- exatamente as que mais importam achar.
--
-- POR QUE DUAS TABELAS
-- --------------------
-- `dfe_nsu` guarda o ponteiro (o último NSU lido) e `nfe_distribuicao` guarda
-- os documentos. São coisas com vidas diferentes: apagar um documento duplicado
-- não pode fazer a próxima busca voltar no tempo e rebaixar tudo de novo.
--
-- O NSU É POR CNPJ, e a chave primária de dfe_nsu reflete isso. Guardar um
-- ponteiro só, global, faria a segunda empresa continuar de onde a primeira
-- parou — e as duas perderiam notas sem nenhum erro aparecer.
--
-- O QUE A SEFAZ DEVOLVE, E POR QUE `xml` PODE SER NULO
-- ----------------------------------------------------
-- Antes de manifestar, a SEFAZ devolve só um RESUMO (resNFe): chave, emitente,
-- valor, data. O XML completo (procNFe) só vem depois da manifestação — é essa
-- a razão de existir a "Ciência da operação".
--
-- Então `xml` nulo não é falha: é o estado normal de uma nota ainda não
-- manifestada. Quem decide o que fazer com isso é a tela, e a coluna
-- `tipo_documento` diz qual dos dois se tem em mãos.
--
-- POR QUE NÃO HÁ FK PARA empresa NEM PARA nfe_entrada
-- ----------------------------------------------------
-- Mesma razão das fases AP e AQ: isto é registro do que a SEFAZ disse, e o que
-- a SEFAZ disse tem de sobreviver ao cadastro. Uma nota emitida contra um CNPJ
-- que depois saiu do cadastro continua sendo prova de que alguém a emitiu.

-- ----------------------------------------------------------------------------
-- O ponteiro por CNPJ
-- ----------------------------------------------------------------------------
create table if not exists dfe_nsu (
  -- Só dígitos, sem máscara: é a mesma forma em que o CNPJ viaja para a SEFAZ,
  -- e comparar '11.222.333/0001-81' com '11222333000181' é o tipo de erro que
  -- não dá exceção — só devolve zero notas.
  cnpj              text primary key,
  ultimo_nsu        bigint not null default 0,
  -- O maior NSU que a SEFAZ diz existir para este CNPJ. Comparado com
  -- ultimo_nsu, é o que diz se ainda falta buscar — a SEFAZ entrega no máximo
  -- 50 documentos por consulta, então uma sincronização longa são várias.
  max_nsu           bigint not null default 0,
  sincronizado_em   timestamptz,
  atualizado_em     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Os documentos
-- ----------------------------------------------------------------------------
create table if not exists nfe_distribuicao (
  id                     text primary key,
  -- O CNPJ CONTRA O QUAL a nota foi emitida — o nosso. É por ele que a tela
  -- separa por empresa.
  cnpj_destinatario      text not null,
  empresa_nome           text not null default '',
  nsu                    bigint not null,
  -- 44 dígitos. `character(44)` como em nfe_entrada.chave, pelo mesmo motivo:
  -- chave com tamanho diferente de 44 é chave errada, e o banco recusa na hora.
  chave                  character(44) not null,

  emitente_documento     text not null default '',
  emitente_nome          text not null default '',
  data_emissao           timestamptz,
  valor_total            numeric(15,2) not null default 0,

  -- 'resumo' (resNFe) ou 'completo' (procNFe). Ver o cabeçalho.
  tipo_documento         text not null default 'resumo',
  xml                    text,
  resumo                 jsonb not null default '{}'::jsonb,

  -- Manifestação: o código do evento (210200/210210/210220/210240) e quando.
  -- Nulo = não manifestada. Ver public/modules/shared/manifestacao.js.
  manifestacao_codigo    text,
  manifestado_em         timestamptz,
  manifestado_por        text,
  manifestado_por_nome   text not null default '',

  -- A entrada que esta nota virou, quando virou. É o que impede lançar a mesma
  -- nota duas vezes — e o que responde "essa nota já entrou?" sem varrer
  -- nfe_entrada por chave.
  entrada_id             text,

  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);

-- A MESMA NOTA NÃO PODE ENTRAR DUAS VEZES PARA O MESMO CNPJ.
--
-- Uma busca por período e outra por chave devolvem o mesmo documento, e sem
-- esta restrição a tela mostraria a nota duplicada — com uma das cópias
-- manifestada e a outra não. É o índice que faz a segunda busca ATUALIZAR em
-- vez de inserir.
create unique index if not exists idx_nfe_distribuicao_chave
  on nfe_distribuicao (cnpj_destinatario, chave);

create index if not exists idx_nfe_distribuicao_cnpj on nfe_distribuicao (cnpj_destinatario);
create index if not exists idx_nfe_distribuicao_nsu on nfe_distribuicao (cnpj_destinatario, nsu desc);
create index if not exists idx_nfe_distribuicao_emitente on nfe_distribuicao (emitente_documento);
create index if not exists idx_nfe_distribuicao_manifestacao on nfe_distribuicao (manifestacao_codigo);
create index if not exists idx_nfe_distribuicao_entrada on nfe_distribuicao (entrada_id);

-- RLS: ver o cabeçalho da fase-af.
alter table if exists dfe_nsu enable row level security;
alter table if exists nfe_distribuicao enable row level security;
