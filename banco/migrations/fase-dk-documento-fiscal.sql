-- ============================================================================
-- FASE DK — DOCUMENTO FISCAL: uma morada só, e o imposto por item consultável
-- ============================================================================
--
-- Segunda fase da EFD ICMS/IPI, e a que tinha a janela mais curta.
--
-- O PROBLEMA QUE ELA RESOLVE
-- --------------------------
-- O sistema tem QUATRO tabelas de nota, e nenhuma guarda imposto por item em
-- coluna consultável:
--
--   nfe (28 col)   a nota transmitida pela Focus. NÃO TEM TABELA DE ITEM: os
--                  itens existem só dentro de `payload_enviado` (jsonb).
--   nfes (23 col)  o registro MANUAL, digitado no Financeiro.
--   nfe_items      os itens do manual: 9 colunas — código, descrição,
--                  quantidade, valor, CFOP, NCM. Sem CST, sem base, sem
--                  alíquota, sem valor de ICMS, ST, IPI, PIS ou COFINS.
--   nfe_entrada    a nota de entrada por XML, com `imposto` em jsonb.
--
-- O registro C170 pede, por item, CST × base × alíquota × valor de cada
-- tributo. Hoje isso não sai de coluna nenhuma: sai de jsonb, ou não sai.
--
-- E A JANELA: `nfe` tem 0 linhas, `nfes` tem 0, `nfe_entrada` tem 0. Hoje isto
-- custa uma migração e NENHUM reprocessamento. Depois da primeira nota, custa
-- reler `payload_enviado` e XML para reconstruir cada item de cada nota — e
-- reconstruir imposto a partir de jsonb que ninguém validou é o tipo de
-- trabalho que sai errado em silêncio.
--
-- A DECISÃO DE 29/09/2026: `nfes` + `nfe_items` SAEM DE CENA
-- ---------------------------------------------------------
-- O diagnóstico de 26/09 chamou `nfe` e `nfes` de "dois modelos paralelos" e
-- perguntou qual morreria. Lendo o código com cuidado, a pergunta estava mal
-- posta: eles NÃO são duplicação acidental. `server.js` já documentava a
-- diferença — `nfe` é a nota TRANSMITIDA (payload, resposta da Focus, arquivos,
-- eventos), `nfes` é o registro MANUAL de uma nota que existe fora do sistema.
-- A tela "NF-e Emitidas" mostra as duas de propósito.
--
-- Então a pergunta certa era: ONDE MORA O REGISTRO MANUAL. E a resposta é aqui.
--
--   `nfe` CONTINUA, e continua sendo o registro da transmissão. Ele tem coisa
--   que só existe quando se fala com a SEFAZ, e `nfe_arquivos`/`nfe_eventos`
--   apontam para ele.
--
--   `nfes` + `nfe_items` SAEM. O que eles guardavam passa a ser uma linha de
--   `fiscal_documentos` com `origem = 'MANUAL'`, e os itens ganham o imposto
--   que eles nunca tiveram.
--
-- Uma morada só para "documento fiscal a escriturar" é o que o SPED escritura.
-- Duas moradas divergiriam no primeiro campo que uma ganhasse e a outra não.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. O PARTICIPANTE, NO RETRATO — registro 0150
--
-- O 0150 descreve o participante COMO ELE ERA no período. Alguém muda o
-- endereço de um cliente em outubro, e o 0150 de setembro passa a sair com o
-- endereço novo — o mesmo defeito que a fase DJ resolveu para o produto.
--
-- MAS AQUI O RETRATO NÃO É TIRADO POR TRIGGER, e a diferença tem motivo.
--
-- `products` tem 5.475 linhas e TODAS podem aparecer numa nota. `people` tem
-- 6.492, e o 0150 só exige os participantes CITADOS no arquivo. Uma trigger em
-- `people` guardaria o histórico de 6.492 cadastros para escriturar algumas
-- centenas — e o endereço de quem nunca comprou não é dado fiscal.
--
-- Então o retrato é tirado QUANDO UM DOCUMENTO CITA O PARTICIPANTE, por
-- `lib/db/fiscal-documentos.js`. Se nada mudou desde o último, o documento novo
-- aponta para o retrato que já existe: o 0150 quer uma linha por participante,
-- não uma por nota.
-- ----------------------------------------------------------------------------
create table if not exists fiscal_participantes (
  id text primary key,
  -- NULAVEL, e o motivo e o mesmo de `fiscal_documentos.empresa_id`: ver la.
  empresa_id uuid references empresa(id) on delete restrict,

  -- COD_PART do 0150. Sai do `code` de `people`/`cnpjs`, que é o código estável
  -- do cadastro — a fase CE existe justamente para ele não ser cortado. Não é o
  -- `id`: o COD_PART aparece em todo C100 do arquivo, e um id interno longo
  -- inflaria o arquivo sem informar nada.
  codigo text not null,

  -- Sem FK para `people`, pelo mesmo motivo de `produto_fiscal.product_id`:
  -- isto é um livro, e a linha tem de sobreviver à exclusão do cadastro. A EFD
  -- de um período fechado ainda cita quem alguém apagou depois.
  person_id text,

  nome text not null,
  -- SÓ DÍGITOS, sem máscara. O arquivo vai sem pontuação, e guardar formatado
  -- obrigaria a limpar na serialização — onde ninguém lembraria.
  documento text,
  tipo_documento text not null,
  inscricao_estadual text,
  inscricao_municipal text,
  inscricao_suframa text,
  codigo_pais text,
  codigo_municipio text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cep text,
  municipio text,
  uf text,

  -- A mesma vigência semiaberta [inicio, fim) da fase DJ, e pelo mesmo motivo.
  vigencia_inicio timestamptz not null default now(),
  vigencia_fim timestamptz,
  registrado_em timestamptz not null default now()
);

alter table fiscal_participantes drop constraint if exists fiscal_participantes_tipo_documento_check;
alter table fiscal_participantes add constraint fiscal_participantes_tipo_documento_check
  check (tipo_documento in ('CNPJ', 'CPF', 'NENHUM'));

-- NENHUM existe porque existe participante sem CPF e sem CNPJ: o 0150 aceita
-- isso para estrangeiro. Sem o terceiro valor, alguém poria CPF vazio, e "CPF
-- em branco" e "não tem CPF" são afirmações diferentes no arquivo.
alter table fiscal_participantes drop constraint if exists fiscal_participantes_documento_check;
alter table fiscal_participantes add constraint fiscal_participantes_documento_check
  check (
    (tipo_documento = 'NENHUM' and documento is null)
    or (tipo_documento = 'CPF'  and documento ~ '^[0-9]{11}$')
    or (tipo_documento = 'CNPJ' and documento ~ '^[0-9]{14}$')
  );

alter table fiscal_participantes drop constraint if exists fiscal_participantes_vigencia_check;
alter table fiscal_participantes add constraint fiscal_participantes_vigencia_check
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio);

-- Um retrato corrente por participante, por empresa. É o que faz o 0150 ter
-- uma linha por COD_PART em vez de uma por nota.
create unique index if not exists idx_fiscal_participantes_corrente
  on fiscal_participantes (coalesce(empresa_id::text, ''), codigo) where vigencia_fim is null;

create index if not exists idx_fiscal_participantes_pessoa
  on fiscal_participantes (person_id, vigencia_inicio desc);

alter table if exists fiscal_participantes enable row level security;

comment on table fiscal_participantes is
  'Fase DK - registro 0150: o participante como ele era quando um documento o citou. Retrato tirado na criacao do documento, e reaproveitado quando nada mudou - o 0150 quer uma linha por participante, nao uma por nota.';

-- ----------------------------------------------------------------------------
-- 2. O DOCUMENTO FISCAL — registro C100
--
-- Uma linha por documento a escriturar, de qualquer origem. `origem` diz de
-- onde ele veio, e o ponteiro da origem fica ao lado: uma nota transmitida
-- aponta para `nfe`, uma entrada por XML aponta para `nfe_entrada`, e o
-- registro manual não aponta para nada porque ele É o registro.
--
-- POR QUE O ID É `text` E NÃO `uuid`
-- ----------------------------------
-- As tabelas novas deste projeto usam uuid, e esta não. O motivo é concreto:
-- `orders.nfe_id` e `financial_entries.nfe_id` são `text` e vão passar a
-- guardar o id daqui. Mantendo text, nenhuma dessas colunas muda de tipo e
-- nenhum código que as trata como string opaca precisa saber que algo mudou —
-- uma troca de armazenamento não deveria exigir mudança de contrato.
--
-- UMA CORREÇÃO AO QUE O CÓDIGO AFIRMA HOJE: o comentário da rota de emissão
-- manual diz "financial_entries.nfe_id referencia nfes(id), então parcela de
-- nota inexistente é recusada pelo banco". MEDIDO: essa FK NÃO EXISTE. A única
-- que entra em `nfes` é `nfe_items.nfe_id`. E ela não pode existir, porque
-- aquela coluna aponta para DUAS tabelas — `nfe` quando a nota saiu pela Focus,
-- `nfes` quando foi digitada. A proteção que o comentário descreve nunca houve.
-- ----------------------------------------------------------------------------
create table if not exists fiscal_documentos (
  id text primary key,

  -- OS DOIS SAO NULAVEIS, E ISSO NAO E DESCUIDO.
  --
  -- O arquivo da EFD e POR ESTABELECIMENTO, entao os dois sao obrigatorios para
  -- gerar. Mas o banco tem 0 empresas e 0 estabelecimentos cadastrados, e a
  -- rota de NF-e manual do Financeiro FUNCIONA hoje sem eles. `not null` aqui
  -- faria essa rota passar a recusar -- trocaria uma pendencia futura por uma
  -- tela quebrada agora, o que e pior.
  --
  -- Nulo e "nao declarado", e o pre-check cobra antes de gerar. Mesma decisao
  -- de `perfil_sped` na fase DJ, pelo mesmo motivo.
  empresa_id uuid references empresa(id) on delete restrict,
  estabelecimento_id uuid references estabelecimento(id) on delete restrict,

  origem text not null,
  -- Os ponteiros para a morada de origem. `on delete restrict` nos dois: a
  -- nota transmitida não se apaga, e um documento escriturado apontando para o
  -- vazio é pior que um erro de exclusão.
  nfe_id uuid references nfe(id) on delete restrict,
  nfe_entrada_id text references nfe_entrada(id) on delete restrict,

  -- A IDENTIDADE DO DOCUMENTO
  sentido text not null,
  -- IND_EMIT do C100: emissão própria ou de terceiro. É coluna e não dedução de
  -- `sentido`, porque as duas se cruzam: devolução de venda é ENTRADA com
  -- emissão própria, e nota de remessa recebida é ENTRADA de terceiro.
  emissao_propria boolean not null,
  modelo text not null default '55',
  serie text,
  numero text not null,
  chave_acesso char(44),
  data_emissao date,
  -- DT_E_S: a data de entrada ou saída da mercadoria, que não é a da emissão.
  data_movimento date,

  -- A SITUAÇÃO É NOME, E NÃO O CÓDIGO DO C100.
  --
  -- O COD_SIT do C100 é numérico ('00' regular, '02' cancelado, e assim por
  -- diante). Aqui fica o NOME do estado, e a tradução para o código sai na fase
  -- do gerador, do Guia Prático da versão vigente no período. Guardar o número
  -- agora seria fixar, no banco, um valor que eu não conferi em documento
  -- oficial — e um COD_SIT errado não produz campo errado, produz documento
  -- escriturado como outra coisa.
  situacao text not null default 'REGULAR',

  participante_id text references fiscal_participantes(id) on delete restrict,

  -- OS VALORES. numeric(15,2) como no resto do sistema.
  valor_total numeric(15,2) not null default 0,
  valor_produtos numeric(15,2) not null default 0,
  valor_desconto numeric(15,2) not null default 0,
  valor_frete numeric(15,2) not null default 0,
  valor_seguro numeric(15,2) not null default 0,
  valor_outras numeric(15,2) not null default 0,
  valor_bc_icms numeric(15,2) not null default 0,
  valor_icms numeric(15,2) not null default 0,
  valor_bc_icms_st numeric(15,2) not null default 0,
  valor_icms_st numeric(15,2) not null default 0,
  valor_ipi numeric(15,2) not null default 0,
  valor_pis numeric(15,2) not null default 0,
  valor_cofins numeric(15,2) not null default 0,

  -- IND_PGTO do C100 (0 à vista, 1 a prazo, 2 outros) é campo FISCAL, e por
  -- isso entra. As duas colunas de parcela ao lado NÃO são fiscais: elas estão
  -- aqui porque o registro manual gera as contas a receber a partir delas, e
  -- era o que `nfes` guardava. Estão nomeadas para isso ficar à vista.
  indicador_pagamento smallint,
  parcelas_quantidade integer not null default 1,
  parcelas_intervalo_dias integer not null default 30,

  observacao_fiscal text,
  order_id text,
  criado_por text,
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table fiscal_documentos drop constraint if exists fiscal_documentos_origem_check;
alter table fiscal_documentos add constraint fiscal_documentos_origem_check
  check (origem in ('EMISSAO', 'MANUAL', 'ENTRADA_XML', 'DFE'));

alter table fiscal_documentos drop constraint if exists fiscal_documentos_sentido_check;
alter table fiscal_documentos add constraint fiscal_documentos_sentido_check
  check (sentido in ('ENTRADA', 'SAIDA'));

-- O VOCABULÁRIO DA SITUAÇÃO, e o que cada um significa para o arquivo:
--   REGULAR                    o documento entra e conta na apuração
--   EXTEMPORANEO               regular, escriturado fora do período próprio
--   CANCELADO                  entra no arquivo, e NÃO conta na apuração
--   CANCELADO_EXTEMPORANEO     idem, fora do período
--   DENEGADO                   a SEFAZ negou o uso; a numeração fica queimada
--   INUTILIZADO                numeração inutilizada, sem documento
--   COMPLEMENTAR               complementa outro documento
--   COMPLEMENTAR_EXTEMPORANEO  idem, fora do período
--   REGIME_ESPECIAL            emitido por regime especial ou norma específica
alter table fiscal_documentos drop constraint if exists fiscal_documentos_situacao_check;
alter table fiscal_documentos add constraint fiscal_documentos_situacao_check
  check (situacao in (
    'REGULAR', 'EXTEMPORANEO', 'CANCELADO', 'CANCELADO_EXTEMPORANEO',
    'DENEGADO', 'INUTILIZADO', 'COMPLEMENTAR', 'COMPLEMENTAR_EXTEMPORANEO',
    'REGIME_ESPECIAL'
  ));

-- A ORIGEM E O PONTEIRO TÊM DE CONCORDAR. Sem este CHECK, um documento com
-- origem MANUAL apontando para uma `nfe` seria aceito, e aí a mesma nota
-- estaria escriturada duas vezes — uma pela transmissão, outra pelo registro
-- manual — sem nada denunciando.
alter table fiscal_documentos drop constraint if exists fiscal_documentos_ponteiro_check;
alter table fiscal_documentos add constraint fiscal_documentos_ponteiro_check
  check (
    (origem = 'EMISSAO'     and nfe_id is not null     and nfe_entrada_id is null)
    or (origem = 'ENTRADA_XML' and nfe_entrada_id is not null and nfe_id is null)
    or (origem in ('MANUAL', 'DFE') and nfe_id is null and nfe_entrada_id is null)
  );

alter table fiscal_documentos drop constraint if exists fiscal_documentos_numero_check;
alter table fiscal_documentos add constraint fiscal_documentos_numero_check
  check (btrim(numero) <> '');

-- ----------------------------------------------------------------------------
-- A TRAVA DO DOCUMENTO REPETIDO
--
-- Chave de acesso é única por definição: 44 dígitos que incluem CNPJ, modelo,
-- série, número e um código aleatório. Duas linhas com a mesma chave são a
-- mesma nota escriturada duas vezes, que no arquivo é erro de estrutura.
--
-- Parcial (`where chave_acesso is not null`) porque o registro manual pode não
-- ter chave: quem digita uma nota antiga de talão não tem 44 dígitos para dar.
-- ----------------------------------------------------------------------------
create unique index if not exists idx_fiscal_documentos_chave
  on fiscal_documentos (chave_acesso) where chave_acesso is not null;

-- E a trava de quem NÃO tem chave: modelo + série + número, por emitente e
-- sentido. Nota cancelada continua ocupando a numeração — é por isso que a
-- situação não entra no índice.
-- `coalesce` no empresa_id, e nao a coluna crua: em indice unico, NULL nao
-- colide com NULL. Sem isto, enquanto nao houver empresa cadastrada, a trava
-- nao travaria NADA -- todo documento entraria com empresa nula e duas notas de
-- mesmo numero passariam. E justo agora que nao ha empresa nenhuma.
create unique index if not exists idx_fiscal_documentos_numeracao
  on fiscal_documentos (coalesce(empresa_id::text, ''), sentido, emissao_propria, modelo, coalesce(serie, ''), numero, coalesce(participante_id, ''))
  where chave_acesso is null;

create index if not exists idx_fiscal_documentos_periodo
  on fiscal_documentos (empresa_id, data_emissao desc);

-- O PRE-CHECK PRECISA ACHAR O QUE FALTA, e sem indice ele varreria a tabela.
create index if not exists idx_fiscal_documentos_sem_estabelecimento
  on fiscal_documentos (criado_em desc) where estabelecimento_id is null;

create index if not exists idx_fiscal_documentos_origem
  on fiscal_documentos (origem, data_emissao desc);

create index if not exists idx_fiscal_documentos_pedido
  on fiscal_documentos (order_id) where order_id is not null;

alter table if exists fiscal_documentos enable row level security;

comment on table fiscal_documentos is
  'Fase DK - registro C100: uma linha por documento fiscal a escriturar, de qualquer origem. `nfe` continua sendo o registro da TRANSMISSAO; esta tabela e o do documento. Substitui `nfes`, que foi removida nesta mesma migracao.';

comment on column fiscal_documentos.situacao is
  'Nome do estado, e nao o COD_SIT numerico do C100: a traducao para o codigo sai do Guia Pratico na fase do gerador.';

-- ----------------------------------------------------------------------------
-- 3. OS ITENS — registro C170
-- ----------------------------------------------------------------------------
create table if not exists fiscal_documento_itens (
  id text primary key,
  -- `on delete restrict`, e não cascade. A regra deste projeto é que documento
  -- fiscal não se apaga, só se cancela, e o `restrict` a torna ESTRUTURAL: um
  -- documento com item não pode ser excluído nem por SQL à mão. A rota de
  -- exclusão não existe de propósito; isto é a segunda tranca.
  documento_id text not null references fiscal_documentos(id) on delete restrict,

  -- NUM_ITEM. A numeração é do documento, e importa: o C170 sai em ordem.
  numero integer not null,

  product_id text,
  -- COD_ITEM do 0200: o sku COMO ELE ERA. Copiado e não lido de `products`,
  -- porque o sku muda e a nota antiga tem de continuar citando o código que
  -- foi para o arquivo.
  codigo_item text not null,
  descricao text not null,

  -- O RETRATO DO PRODUTO QUE ESTA NOTA USOU — e é aqui que a fase DJ se paga.
  --
  -- Sem isto, "com que NCM este item foi escriturado?" se responde comparando
  -- datas. Com isto, é um ponteiro. Nulo quando o item não vem do cadastro
  -- (item de nota de terceiro sem vínculo).
  produto_fiscal_id uuid,

  quantidade numeric(15,4) not null default 0,
  unidade text,
  -- 15,10 como em `nfe_entrada_item`: preço unitário de nota de entrada vem
  -- com muitas casas, e arredondar aqui muda o total do item.
  valor_unitario numeric(15,10) not null default 0,
  valor_total numeric(15,2) not null default 0,
  valor_desconto numeric(15,2) not null default 0,

  -- IND_MOV: houve movimentação física? Nota de simples faturamento não
  -- movimenta, e o Bloco H depende de saber disso.
  indicador_movimento_fisico boolean not null default true,

  cfop char(4),
  ncm char(8),
  cest char(7),
  origem smallint,

  criado_em timestamptz not null default now()
);

alter table fiscal_documento_itens drop constraint if exists fiscal_documento_itens_numero_check;
alter table fiscal_documento_itens add constraint fiscal_documento_itens_numero_check
  check (numero >= 1);

alter table fiscal_documento_itens drop constraint if exists fiscal_documento_itens_cfop_check;
alter table fiscal_documento_itens add constraint fiscal_documento_itens_cfop_check
  check (cfop is null or cfop ~ '^[0-9]{4}$');

alter table fiscal_documento_itens drop constraint if exists fiscal_documento_itens_ncm_check;
alter table fiscal_documento_itens add constraint fiscal_documento_itens_ncm_check
  check (ncm is null or ncm ~ '^[0-9]{8}$');

-- Dois itens com o mesmo NUM_ITEM no mesmo documento é arquivo inválido.
create unique index if not exists idx_fiscal_documento_itens_numero
  on fiscal_documento_itens (documento_id, numero);

create index if not exists idx_fiscal_documento_itens_produto
  on fiscal_documento_itens (product_id) where product_id is not null;

alter table if exists fiscal_documento_itens enable row level security;

comment on table fiscal_documento_itens is
  'Fase DK - registro C170: os itens do documento fiscal. `nfe_items` tinha 9 colunas e nenhum imposto; o imposto agora mora em fiscal_item_tributos, uma linha por tributo.';

comment on column fiscal_documento_itens.produto_fiscal_id is
  'Ponteiro para o retrato de `produto_fiscal` (fase DJ) que esta nota usou. E o que torna "com que NCM este item foi escriturado" um ponteiro em vez de uma comparacao de datas.';

-- ----------------------------------------------------------------------------
-- 4. O IMPOSTO POR ITEM — a coluna que faltava em todos os quatro modelos
--
-- UMA LINHA POR TRIBUTO, e não uma coluna por tributo. São duas razões, e a
-- segunda é a que decide:
--
--   1. Um item tem de 3 a 8 tributos, e cada um tem CST, base, alíquota, valor
--      e redução. Em colunas, isso são 40 colunas das quais a maioria é nula em
--      toda linha.
--
--   2. A REFORMA TRIBUTÁRIA. IBS, CBS e Imposto Seletivo estão entrando, e
--      `lib/calcularTributos.js` já os lista em NAO_APURADOS. Em colunas, cada
--      tributo novo é uma migração que altera a tabela de itens de todas as
--      notas já escrituradas. Em linhas, é um valor novo num CHECK.
--
-- O CST FICA AQUI, junto do tributo a que pertence, e não no item. CST de ICMS
-- e CST de PIS são tabelas diferentes com significados diferentes, e a fase Y
-- deste projeto já mantém as duas separadas. Uma coluna `cst` no item teria de
-- escolher uma.
-- ----------------------------------------------------------------------------
create table if not exists fiscal_item_tributos (
  id text primary key,
  item_id text not null references fiscal_documento_itens(id) on delete restrict,

  tributo text not null,
  -- Texto e não char(2)/char(3): o CST de ICMS tem 2 dígitos, o CSOSN 3, e o de
  -- PIS/COFINS 2. Um tipo fixo obrigaria a escolher, e a classificação
  -- tributária do IBS/CBS não é nem uma nem outra.
  cst text,

  base_calculo numeric(15,2),
  -- 9,4 porque alíquota de ICMS interestadual com FCP chega a quatro casas, e
  -- porque a alíquota de PIS/COFINS no regime cumulativo é 0,65 e 3,00 — onde
  -- duas casas bastariam, mas o DIFAL não.
  aliquota numeric(9,4),
  valor numeric(15,2),
  -- Percentual de redução de base. É informação PRÓPRIA, e não dedução de
  -- base/valor: base reduzida a zero e base não informada dão a mesma conta e
  -- significam coisas diferentes no arquivo.
  reducao_base numeric(9,4),
  -- cBenef: código de benefício fiscal da tabela DA UF. Vem de `regra_fiscal`,
  -- onde a fase AE o pôs, e é copiado para cá no momento da escrituração.
  codigo_beneficio text,

  criado_em timestamptz not null default now()
);

-- O CATÁLOGO DE TRIBUTOS.
--
-- IBS, CBS e IS entram desde já, e isso não contradiz a regra de "campo só
-- entra se alguém o lê": aqui não é coluna, é VALOR. A fase Z já criou
-- `cst_ibs_cbs`, `aliquota_ibs`, `aliquota_cbs` e `class_trib` em
-- `regra_fiscal`, então o dado tem de onde vir. O que não existe é o cálculo, e
-- é por isso que nada os escreve ainda.
alter table fiscal_item_tributos drop constraint if exists fiscal_item_tributos_tributo_check;
alter table fiscal_item_tributos add constraint fiscal_item_tributos_tributo_check
  check (tributo in (
    'ICMS', 'ICMS_ST', 'ICMS_DIFAL', 'FCP', 'FCP_ST',
    'IPI', 'PIS', 'COFINS',
    'IBS', 'CBS', 'IS'
  ));

-- Um tributo aparece UMA vez por item. Duas linhas de ICMS no mesmo item
-- dobrariam o imposto na apuração, e é o tipo de erro que só aparece no total
-- do mês.
create unique index if not exists idx_fiscal_item_tributos_unico
  on fiscal_item_tributos (item_id, tributo);

alter table if exists fiscal_item_tributos enable row level security;

comment on table fiscal_item_tributos is
  'Fase DK - o imposto por item, uma linha por tributo, com CST, base, aliquota, valor e reducao. E a coluna consultavel que NENHUM dos quatro modelos de nota tinha: `nfe` guardava em payload_enviado (jsonb), `nfe_items` nao guardava, `nfe_entrada_item` guardava em `imposto` (jsonb).';

-- ============================================================================
-- E `nfes` + `nfe_items` SAEM DE CENA
-- ============================================================================
--
-- As duas com 0 linhas, medido em 29/09/2026. Não há dado a migrar: o que muda
-- é onde `lib/db/financeiro.js` lê e escreve, e o contrato que ele devolve
-- continua o mesmo — `getNfes()` entrega objetos com as mesmas chaves, então a
-- tela "NF-e Emitidas", a emissão manual e o cancelamento não sabem que algo
-- mudou.
--
-- POR QUE DERRUBAR EM VEZ DE DEIXAR PARADAS
-- -----------------------------------------
-- Tabela que ninguém lê é o defeito de `declaracao_importacao`, citado em três
-- migrações deste projeto: ela está no schema desde a fase de importação, não
-- tem uma linha de código, e a cada fase alguém precisa descobrir de novo que
-- ela não serve. Deixar `nfes` parada ao lado de `fiscal_documentos` criaria o
-- mesmo problema, com o agravante de as duas parecerem servir para a mesma
-- coisa.
--
-- A JANELA DO DEPLOY, dita em voz alta
-- ------------------------------------
-- No VPS a ordem é `git pull`, `npm run migracoes:aplicar`, `pm2 restart`.
-- Entre a migração e o restart, o processo ANTIGO está no ar com o schema NOVO,
-- e nesse intervalo as rotas de NF-e do Financeiro responderiam erro. Com 0
-- notas emitidas em toda a história desta instalação, a janela é inofensiva
-- aqui — mas ela existe, e é melhor estar escrita do que descoberta.
--
-- A ORDEM IMPORTA, e é por isso que não há `cascade`: `nfe_items.nfe_id` tem FK
-- para `nfes`, então a filha cai primeiro e a mãe depois. `drop ... cascade`
-- faria o mesmo em uma linha, e é justamente o que não se quer numa migração —
-- `cascade` derruba o que ele encontrar, inclusive o que alguém tiver criado
-- depois e este arquivo não conhece.
-- ============================================================================
drop table if exists nfe_items;
drop table if exists nfes;
