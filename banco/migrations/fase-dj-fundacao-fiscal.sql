-- ============================================================================
-- FASE DJ — FUNDAÇÃO FISCAL: o que o SPED precisa saber do cadastro
-- ============================================================================
--
-- Primeira fase da EFD ICMS/IPI. Ela não gera arquivo nenhum: prepara as
-- respostas que o Bloco 0 exige do cadastro e que hoje ninguém guarda.
--
-- O QUE MEDIU A DECISÃO, em 29/09/2026, contra o banco local
-- ----------------------------------------------------------
--   produtos ................................ 5.475
--   produtos sem NCM .........................     5
--   unidades distintas em uso ................    34   <- o registro 0190
--   unidade tributável != comercial ..........     7
--   documentos fiscais de qualquer tipo ......     0
--   estabelecimentos .........................     0
--   regras fiscais ...........................     0
--
-- O quinto número é o que decide o ESCOPO. Não há nota emitida, então não há o
-- que escriturar, e construir o motor SPED agora produziria código que ninguém
-- consegue exercitar contra dado real. O que cabe agora é o que fica MAIS CARO
-- DEPOIS — histórico, que só se grava enquanto acontece.
--
-- A ESPECIFICAÇÃO PEDE MAIS DO QUE ENTRA AQUI, e o motivo de cada ausência está
-- escrito no fim. A regra é a das fases CP e CS: campo só entra se alguém o LÊ.
-- Coluna que ninguém lê é o defeito de `declaracao_importacao`, que está no
-- schema desde a fase de importação e não tem uma linha de código.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. O ESTABELECIMENTO GANHA DOIS CAMPOS DO REGISTRO 0000 — e não cinco
--
-- O registro 0000 identifica o estabelecimento pelo CNPJ, e duas das suas
-- informações não saem de lugar nenhum deste sistema hoje:
--
--   IND_PERFIL  perfil de apresentação do arquivo (A, B ou C). É atribuído pelo
--               estado AO ESTABELECIMENTO, então mora aqui e não na empresa.
--   IND_ATIV    0 = industrial ou equiparado a industrial, 1 = outros.
--
-- AS DUAS NASCEM NULAS, E ISSO É A DECISÃO. `empresa.e_importadora` é true, e
-- importadora é equiparada a industrial (RIPI art. 9º) — o que sugere IND_ATIV
-- = 0. Mas "sugere" não é o que vai num arquivo assinado: quem escritura tem de
-- afirmar isso, e um default faria os estabelecimentos passarem a declarar um
-- enquadramento que ninguém escolheu. O perfil errado muda QUAIS REGISTROS o
-- arquivo precisa ter, então errar aqui não produz um campo errado — produz um
-- arquivo com registros faltando.
--
-- Campo vazio que o pré-check cobra é melhor que valor plausível que ninguém
-- conferiu. É o mesmo raciocínio de `escala_relevante` na fase CS.
-- ----------------------------------------------------------------------------
alter table estabelecimento add column if not exists perfil_sped char(1);

alter table estabelecimento drop constraint if exists estabelecimento_perfil_sped_check;
alter table estabelecimento add constraint estabelecimento_perfil_sped_check
  check (perfil_sped is null or perfil_sped in ('A', 'B', 'C'));

comment on column estabelecimento.perfil_sped is
  'Fase DJ - IND_PERFIL do registro 0000 da EFD ICMS/IPI: perfil de apresentacao do arquivo (A, B ou C), atribuido pelo estado a este estabelecimento. NULL = nao declarado, e o pre-check cobra.';

alter table estabelecimento add column if not exists indicador_atividade smallint;

alter table estabelecimento drop constraint if exists estabelecimento_indicador_atividade_check;
alter table estabelecimento add constraint estabelecimento_indicador_atividade_check
  check (indicador_atividade is null or indicador_atividade in (0, 1));

comment on column estabelecimento.indicador_atividade is
  'Fase DJ - IND_ATIV do registro 0000: 0 = industrial ou equiparado a industrial, 1 = outros. NULL = nao declarado. Nao tem default porque o enquadramento e afirmacao de quem escritura, nao deducao de empresa.e_importadora.';

-- ----------------------------------------------------------------------------
-- 2. AS UNIDADES DE MEDIDA — o registro 0190
--
-- O 0190 exige, para cada unidade citada no arquivo, um código e uma DESCRIÇÃO.
-- Hoje a unidade é texto livre em `products.unidade_comercial`, e são 34
-- distintas.
--
-- UMA CORREÇÃO AO DIAGNÓSTICO DE 26/09/2026, que dizia "o 0190 sairia com 8
-- linhas": oito era o que eu havia listado, não o que existe. Medido agora, uma
-- por uma: UN 3.680, PC 1.095, MT 121, CT 93, KG 74, LT 61, PAR 42, BL 31,
-- JG 30, RL 29, TB 25, SC 23, GL 23, M2 21, CX 19, PT 17, FL 13, KIT 13, CH 10,
-- BR 8, CA 7, PCT 7, ML 6, BD 6, FR 5, M3 5, CJ 4, CM 1, CV 1, CAR 1, FD 1,
-- COM 1, AP 1, PL 1. São 34, e a cauda é o problema — não o tamanho.
--
-- ESTA TABELA NASCE VAZIA, E ISSO É A DECISÃO, NÃO UMA OMISSÃO.
--
-- Eu sei o que "KG" significa. Não sei se "BL" é bloco ou bobina, se "CT" é
-- cartela ou cento, se "CA" é caixa ou cartela, se "PT" é pacote ou pote, nem o
-- que "COM", "AP", "CV" e "PL" são nesta base. A descrição do 0190 é o que o
-- fisco lê, e preencher por palpite produz exatamente o defeito que este
-- projeto já viu duas vezes na emissão: campo aceito em silêncio, com conteúdo
-- errado, sem erro em lugar nenhum (`indicador_ie_destinatario` por um mês, e
-- `item_valor_total` que nunca declarou o indTot).
--
-- Então o ganho desta tabela não é o conteúdo — é a PENDÊNCIA VISÍVEL. Com ela,
-- "34 unidades em uso, 0 descritas" é uma lista que alguém preenche numa tarde;
-- sem ela, é uma rejeição do PVA em janeiro, quando não houver tarde nenhuma.
-- ----------------------------------------------------------------------------
create table if not exists fiscal_unidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id) on delete cascade,
  -- O código como ele vai para o arquivo, guardado como digitado. A comparação
  -- é sem caso e sem espaço: "un", "UN" e "UN " são a mesma unidade, e duas
  -- linhas para ela fariam o 0190 declarar a mesma unidade duas vezes — que é
  -- erro de estrutura, não de conteúdo.
  codigo text not null,
  descricao text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table fiscal_unidades drop constraint if exists fiscal_unidades_codigo_check;
alter table fiscal_unidades add constraint fiscal_unidades_codigo_check
  check (btrim(codigo) <> '' and length(btrim(codigo)) <= 6);

alter table fiscal_unidades drop constraint if exists fiscal_unidades_descricao_check;
alter table fiscal_unidades add constraint fiscal_unidades_descricao_check
  check (btrim(descricao) <> '');

create unique index if not exists idx_fiscal_unidades_codigo
  on fiscal_unidades (empresa_id, upper(btrim(codigo)));

alter table if exists fiscal_unidades enable row level security;

comment on table fiscal_unidades is
  'Fase DJ - registro 0190 da EFD: codigo e descricao de cada unidade de medida citada no arquivo. Nasce vazia de proposito: a descricao e o que o fisco le, e adivinhar "BL" ou "CT" produziria arquivo aceito com conteudo errado.';

-- ----------------------------------------------------------------------------
-- 3. O HISTÓRICO FISCAL DO PRODUTO — a parte urgente desta fase
--
-- A DECISÃO DE DESENHO, tomada em 29/09/2026: `products` CONTINUA SENDO A
-- FONTE. A emissão segue lendo `products.ncm`, e nada em `nfePayloadBuilder`,
-- `calcularTributos` ou nas telas de produto muda. `produto_fiscal` não é uma
-- segunda morada do dado fiscal — é o RETRATO de como ele estava.
--
-- Isso evita o defeito que o diagnóstico apontou como risco da Fase A: duas
-- moradas para NCM, CEST e origem, a emissão lendo uma e o SPED a outra,
-- divergindo sem erro nenhum. Aqui não há como divergir, porque aqui não há
-- decisão sendo tomada — só o registro do que a fonte dizia.
--
-- POR QUE AGORA, E NÃO NA FASE QUE PRECISAR
-- -----------------------------------------
-- A EFD de setembro é entregue em outubro e escritura o produto COMO ELE ERA em
-- setembro. Alguém corrige o NCM de um produto em outubro, e o registro 0200 de
-- setembro passa a sair com o NCM novo — sem erro, sem aviso, e a diferença só
-- aparece se o fisco cruzar a nota com o arquivo.
--
-- Histórico é o único tipo de dado que não se constrói depois. Cada dia sem
-- esta tabela é um dia de alterações que ninguém pode reconstruir — nem lendo
-- XML, nem lendo jsonb, porque a alteração não deixa rastro em lugar nenhum. É
-- o mesmo argumento do snapshot do item da nota (fase DK), e é por isso que
-- estas duas fases vêm antes das dez que geram arquivo.
--
-- É TRIGGER, E NÃO CÓDIGO NO CAMINHO DE ESCRITA
-- ---------------------------------------------
-- `upsertProduct` é o caminho principal, mas não é o único: há `atualizarCusto`,
-- há a importação do Viper, e há SQL rodado à mão num banco que já levou 63
-- migrações. Histórico que perde um caminho de escrita é PIOR que não existir —
-- ele responde "o NCM nunca mudou" com a autoridade de um registro, quando
-- mudou por fora. A trigger não tem como ser esquecida por quem escreve.
--
-- O idioma é o da fase AJ (`sales_status_guarda`), que é a trigger que este
-- projeto já mantém.
-- ----------------------------------------------------------------------------
create table if not exists produto_fiscal (
  id uuid primary key default gen_random_uuid(),

  -- SEM FOREIGN KEY PARA `products`, e isto é deliberado.
  --
  -- `on delete cascade` apagaria o histórico junto com o produto, e é
  -- exatamente no produto apagado que o histórico importa: a EFD de um período
  -- fechado ainda escritura um item que alguém excluiu do cadastro depois.
  -- `on delete restrict` impediria excluir qualquer produto já editado uma vez,
  -- o que, depois de um mês, é todo produto.
  --
  -- Então isto é um LIVRO, e não uma relação. E por isso `sku` e `nome` são
  -- copiados para dentro: eles são o COD_ITEM e o DESCR_ITEM do registro 0200,
  -- e sem eles uma linha órfã não responderia nada.
  product_id text not null,
  sku text,
  nome text,

  -- O RETRATO. Mesmos tipos das colunas de `products`, para o retrato não poder
  -- ser mais frouxo que a fonte — char(8) aqui e text ali deixaria entrar no
  -- histórico um NCM que a fonte recusaria.
  ncm char(8),
  cest char(7),
  origem smallint,
  tipo_produto_fiscal text,
  unidade_comercial text,
  unidade_tributavel text,
  ean text,
  cst_ipi char(2),
  aliquota_ipi numeric(5,2),
  codigo_ex_tipi varchar(3),
  escala_relevante boolean,
  cnpj_fabricante char(14),
  grupo_tributario_id uuid,
  -- `numero_fci` é uuid em `products`, e não texto: o número da Ficha de
  -- Conteúdo de Importação é um GUID emitido pela SEFAZ. Está vazio nos 5.475
  -- produtos hoje, e entra aqui de todo jeito porque é campo fiscal DO PRODUTO
  -- (vai na nota como nFCI) e porque a lista vigiada tem de ser a lista
  -- inteira — ver o comentário da trigger.
  numero_fci uuid,

  -- A VIGÊNCIA É UM INTERVALO SEMIABERTO: [inicio, fim).
  --
  -- A linha corrente tem `vigencia_fim` NULO, e a pergunta "qual era o NCM no
  -- dia X" é `vigencia_inicio <= X and (vigencia_fim is null or vigencia_fim > X)`.
  -- Semiaberto porque, fechado nos dois lados, o instante exato da troca casaria
  -- com DUAS linhas e a resposta dependeria da ordem da consulta.
  vigencia_inicio timestamptz not null default now(),
  vigencia_fim timestamptz,

  -- POR QUE O MOTIVO É COLUNA, E NÃO COMENTÁRIO.
  --
  -- A carga inicial desta migração grava uma linha por produto com
  -- `vigencia_inicio` = agora. Isso NÃO significa que os valores foram definidos
  -- agora — significa "é o que o cadastro dizia quando começamos a registrar".
  -- Sem esta coluna, um relatório futuro leria as 5.475 linhas como 5.475
  -- alterações feitas em 29/09/2026, o que é falso, e ninguém teria como saber.
  motivo text not null default 'ALTERACAO',

  registrado_em timestamptz not null default now()
);

alter table produto_fiscal drop constraint if exists produto_fiscal_motivo_check;
alter table produto_fiscal add constraint produto_fiscal_motivo_check
  check (motivo in ('CARGA_INICIAL', 'CADASTRO', 'ALTERACAO'));

-- Intervalo invertido é dado impossível, e sem CHECK ele entraria calado.
alter table produto_fiscal drop constraint if exists produto_fiscal_vigencia_check;
alter table produto_fiscal add constraint produto_fiscal_vigencia_check
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio);

-- UMA SÓ LINHA ABERTA POR PRODUTO. É a trava que faz a pergunta "como está
-- hoje" ter UMA resposta: sem ela, uma trigger que falhasse no meio deixaria
-- duas linhas correntes, e a consulta devolveria qualquer uma das duas — o
-- mesmo tipo de empate indiferente que a fase DE removeu da lista de Vendas.
create unique index if not exists idx_produto_fiscal_corrente
  on produto_fiscal (product_id) where vigencia_fim is null;

-- O índice da pergunta retroativa: "este produto, naquele dia".
create index if not exists idx_produto_fiscal_janela
  on produto_fiscal (product_id, vigencia_inicio desc);

alter table if exists produto_fiscal enable row level security;

comment on table produto_fiscal is
  'Fase DJ - retrato dos campos fiscais de cada produto, com vigencia semiaberta [inicio, fim). `products` continua sendo a FONTE que a emissao le; esta tabela so registra como o dado estava, para a EFD de um periodo escriturar o produto como ele era naquele periodo. Escrita por trigger, nao por codigo.';

comment on column produto_fiscal.motivo is
  'CARGA_INICIAL = o estado em que a fase DJ encontrou o cadastro, e nao uma alteracao feita naquele dia. CADASTRO = produto criado. ALTERACAO = campo fiscal mudou.';

comment on column produto_fiscal.product_id is
  'Sem FK de proposito: este e um livro, e a linha precisa sobreviver a exclusao do produto - e no produto excluido que o historico importa.';

-- ----------------------------------------------------------------------------
-- A TRIGGER
--
-- `security definer` e `search_path` fixos seguem a fase AJ: a função escreve
-- numa tabela que o chamador não precisa conhecer, e `search_path` solto numa
-- função com definer é o caminho clássico para alguém plantar uma tabela
-- homônima no schema de busca.
-- ----------------------------------------------------------------------------
create or replace function produto_fiscal_registrar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  agora timestamptz;
begin
  -- NADA FISCAL MUDOU: SAI SEM CUSTO.
  --
  -- Sem esta saída, todo update de preço, saldo ou custo pagaria duas escritas
  -- a mais — e `atualizarCusto` roda a cada compra.
  --
  -- `is distinct from` e não `<>`: NULL <> NULL dá NULL, a comparação inteira
  -- viraria nula, e uma mudança de NULL para '12345678' passaria batida. Que é
  -- justo o caso mais comum aqui — campo fiscal sendo preenchido pela primeira
  -- vez. Foi o mesmo erro que a fase AJ documenta na guarda de status.
  if tg_op = 'UPDATE' and not (
        new.sku                 is distinct from old.sku
     or new.name                is distinct from old.name
     or new.ncm                 is distinct from old.ncm
     or new.cest                is distinct from old.cest
     or new.origem              is distinct from old.origem
     or new.tipo_produto_fiscal is distinct from old.tipo_produto_fiscal
     or new.unidade_comercial   is distinct from old.unidade_comercial
     or new.unidade_tributavel  is distinct from old.unidade_tributavel
     or new.ean                 is distinct from old.ean
     or new.cst_ipi             is distinct from old.cst_ipi
     or new.aliquota_ipi        is distinct from old.aliquota_ipi
     or new.codigo_ex_tipi      is distinct from old.codigo_ex_tipi
     or new.escala_relevante    is distinct from old.escala_relevante
     or new.cnpj_fabricante     is distinct from old.cnpj_fabricante
     or new.grupo_tributario_id is distinct from old.grupo_tributario_id
     or new.numero_fci          is distinct from old.numero_fci
  ) then
    return new;
  end if;

  -- UM instante só para fechar a linha velha e abrir a nova.
  --
  -- É `now()`, E EU TENTEI `clock_timestamp()` PRIMEIRO. A primeira versão
  -- desta função usava clock_timestamp() com este raciocínio escrito aqui:
  -- "now() é o início da transação, então duas alterações na mesma transação
  -- abririam intervalos no mesmo instante, e a pergunta retroativa casaria com
  -- uma linha de duração zero".
  --
  -- MEDIDO, o raciocínio estava errado nos dois lados:
  --
  --   1. A duração zero não é problema. O intervalo é semiaberto, então
  --      [T, T) não casa com instante nenhum — a linha intermediária fica
  --      registrada e não responde nada, que é exatamente o certo: um valor que
  --      só existiu dentro de uma transação nunca foi visível para ninguém.
  --
  --   2. clock_timestamp() QUEBRA A CONSULTA. Ele é o relógio de parede, sempre
  --      DEPOIS do now() da transação. Então, na mesma transação que altera o
  --      produto, `vigencia_inicio <= now()` é FALSO para o retrato novo, e a
  --      consulta devolve o ANTIGO — com cara de resposta certa. Foi o que a
  --      prova desta fase pegou: pedi "qual é o NCM agora" logo depois de
  --      trocá-lo e recebi o de antes.
  --
  -- `now()` ainda tem uma propriedade que o relógio de parede não tem: uma
  -- transação que altera dez produtos estampa os dez com o MESMO instante. O
  -- histórico fica consistente por conjunto de alteração, e não espalhado em
  -- microssegundos que não significam nada.
  --
  -- Guardado em VARIÁVEL de todo jeito, e não chamado duas vezes: é o que faz o
  -- fim de um retrato ser exatamente o início do outro. Qualquer diferença aqui
  -- abre um buraco na linha do tempo em que a pergunta "qual era o NCM" não tem
  -- resposta nenhuma.
  agora := now();

  update produto_fiscal
     set vigencia_fim = agora
   where product_id = new.id
     and vigencia_fim is null;

  insert into produto_fiscal (
    product_id, sku, nome,
    ncm, cest, origem, tipo_produto_fiscal,
    unidade_comercial, unidade_tributavel, ean,
    cst_ipi, aliquota_ipi, codigo_ex_tipi,
    escala_relevante, cnpj_fabricante, grupo_tributario_id, numero_fci,
    vigencia_inicio, motivo, registrado_em
  ) values (
    new.id, new.sku, new.name,
    new.ncm, new.cest, new.origem, new.tipo_produto_fiscal,
    new.unidade_comercial, new.unidade_tributavel, new.ean,
    new.cst_ipi, new.aliquota_ipi, new.codigo_ex_tipi,
    new.escala_relevante, new.cnpj_fabricante, new.grupo_tributario_id, new.numero_fci,
    agora,
    case tg_op when 'INSERT' then 'CADASTRO' else 'ALTERACAO' end,
    agora
  );

  return new;
end;
$$;

comment on function produto_fiscal_registrar() is
  'Fase DJ - fecha o retrato fiscal corrente do produto e abre outro, quando um campo fiscal muda. AFTER trigger: a linha de products ja esta gravada quando o registro acontece.';

-- AFTER, e não BEFORE.
--
-- A fase AJ usa BEFORE porque a guarda dela RECUSA a escrita — ela precisa
-- rodar antes de a linha existir. Esta não recusa nada: ela registra o que foi
-- gravado. Em BEFORE, um CHECK de `products` que estourasse depois deixaria o
-- histórico afirmando uma alteração que a transação vai desfazer. Na mesma
-- transação isso se resolve sozinho; mas a diferença fica errada no dia em que
-- alguém puser uma segunda trigger BEFORE que altere NEW, e aí o histórico
-- guardaria o valor que não foi gravado.
drop trigger if exists products_produto_fiscal on products;
create trigger products_produto_fiscal
  after insert or update on products
  for each row execute function produto_fiscal_registrar();

-- ----------------------------------------------------------------------------
-- A CARGA INICIAL
--
-- Uma linha por produto, com o que o cadastro diz HOJE, marcada CARGA_INICIAL.
-- Sem ela, "qual era o NCM em setembro" não responde nada para os 5.475
-- produtos que nunca foram editados depois desta migração — e "não sei" é uma
-- resposta pior que "era isto, e passamos a registrar em 29/09/2026".
--
-- `where not exists` porque este arquivo roda em dois contextos: aplicado por
-- `npm run migracoes:aplicar` num banco que já tem produtos, e concatenado em
-- `banco/RECRIAR-DO-ZERO.sql`, onde roda num banco vazio e a trigger acima já
-- cria a linha de cada produto que entrar depois. Nos dois, rodar duas vezes
-- não pode duplicar.
-- ----------------------------------------------------------------------------
insert into produto_fiscal (
  product_id, sku, nome,
  ncm, cest, origem, tipo_produto_fiscal,
  unidade_comercial, unidade_tributavel, ean,
  cst_ipi, aliquota_ipi, codigo_ex_tipi,
  escala_relevante, cnpj_fabricante, grupo_tributario_id, numero_fci,
  motivo
)
select
  p.id, p.sku, p.name,
  p.ncm, p.cest, p.origem, p.tipo_produto_fiscal,
  p.unidade_comercial, p.unidade_tributavel, p.ean,
  p.cst_ipi, p.aliquota_ipi, p.codigo_ex_tipi,
  p.escala_relevante, p.cnpj_fabricante, p.grupo_tributario_id, p.numero_fci,
  'CARGA_INICIAL'
from products p
where not exists (
  select 1 from produto_fiscal pf
   where pf.product_id = p.id and pf.vigencia_fim is null
);

-- ============================================================================
-- O QUE A ESPECIFICAÇÃO PEDE E NÃO ENTRA NESTA FASE — com o motivo
-- ============================================================================
--
-- `estabelecimento.regime_tributario`
--   JÁ EXISTE, em `empresa`, junto de `crt`. Regime é eleito pela pessoa
--   jurídica e vale para todos os estabelecimentos do mesmo CNPJ raiz — não é
--   atributo de filial. Uma cópia aqui divergiria da empresa no primeiro
--   enquadramento que mudasse, e as duas pareceriam válidas. É o mesmo motivo
--   pelo qual a fase CS recusou `codigo_beneficio_fiscal` no produto.
--
-- `estabelecimento.codigo`
--   O registro 0000 identifica o estabelecimento por CNPJ, não por código
--   interno. `estabelecimento` já tem `ordem` char(4), que é o número da filial
--   usado na NF-e. Uma terceira identidade sem ninguém que a leia é schema
--   morto — e schema morto convida alguém a preenchê-lo e a acreditar que está
--   indo para algum lugar.
--
-- `estabelecimento.indicador_tipo_efd`
--   FICA DE FORA POR EU NÃO SABER O QUE É. O 0000 tem IND_PERFIL e IND_ATIV,
--   que entraram acima, e tem COD_FIN (arquivo original ou substituto) — que é
--   atributo DA GERAÇÃO, não do estabelecimento, e nasce na fase do gerador.
--   Não encontrei, no 0000 da EFD ICMS/IPI, um campo que "tipo de EFD"
--   descreva. Criar a coluna pelo nome, sem saber o domínio, é o pior dos dois
--   mundos: ela parece pronta e ninguém sabe o que preencher. Se o nome vier da
--   documentação oficial com um domínio definido, a coluna entra em uma linha.
--
-- `produto_conversao_unidade` (registro 0220)
--   MEDIDO ANTES DE DECIDIR: 7 produtos dos 5.475 têm `unidade_tributavel`
--   diferente de `unidade_comercial`, e os pares são JG->UN (2), UN->U (2),
--   UN->P (2) e UN->CX (1). "U" e "P" não são unidade — são truncamento. O 0220
--   só é exigido quando o item é escriturado em unidade diferente da do
--   inventário; aqui não há fator de conversão para declarar, há sete cadastros
--   para corrigir. A tabela entra quando existir uma conversão de verdade para
--   guardar; os sete viram pendência do pré-check, que é o que eles são.
--
-- `fiscal_participantes` (registro 0150)
--   ENTRA NA FASE DK, e não aqui. A especificação a põe na fundação, mas o
--   retrato do participante é tirado QUANDO UM DOCUMENTO O CITA — e quem cita é
--   a camada de documento fiscal. Criada aqui, ficaria sem escritor até a fase
--   seguinte; criada lá, nasce com um.
-- ============================================================================
