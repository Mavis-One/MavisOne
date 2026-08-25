-- =============================================================================
-- CONSOLIDADO — as migracoes que FALTAM no banco novo, na ordem certa.
--  Quem manda sao os arquivos de fase; o verificador
--  (scripts/verificar-migracoes.js) ignora este arquivo.
--
--  SITUACAO EM 25/08/2026, no projeto novo do Supabase:
--
--  O RECRIAR-DO-ZERO.sql foi executado e a maior parte entrou -- inclusive as
--  fases AK e AL, que ficam DEPOIS destas nove no arquivo. Ou seja, a execucao
--  chegou ao fim; foi este trecho do meio que nao teve efeito. Nao da para
--  saber, de fora do banco, se o editor acusou erro e seguiu, ou se pulou.
--
--  Estas nove sao idempotentes ("if not exists" em tudo): rodar de novo nao
--  duplica nada e nao apaga nada. Se aparecer erro, GUARDE A MENSAGEM -- e' ela
--  que diz o que aconteceu da primeira vez.
--
--  Confira depois com:  npm run migracoes
-- =============================================================================

-- >>> fase-aa-nfe-lista-unificada.sql

-- ---------------------------------------------------------------------------
-- Fase AA — a NF-e real vira a NF-e da tela
--
-- O SISTEMA TINHA DUAS NF-e QUE NÃO SE FALAVAM:
--
--   `nfes`  — registro manual do Financeiro (tela "Nova NF-e Avulsa").
--   `nfe`   — a nota de verdade, transmitida à SEFAZ pela Focus NFe.
--
-- A tela "NF-e Emitidas" lia só a primeira. Quem emitisse pela Focus não veria
-- a nota no lugar onde qualquer pessoa vai procurar — e nada acusaria o erro.
-- As nove ações do menu (baixar XML, DANFE, CC-e, consultar status) também
-- ficavam mortas por isso: as rotas existem em /api/fiscal/nfe, mas o menu
-- vivia na lista errada.
--
-- Esta migração dá à tabela fiscal as três colunas que faltavam para ela poder
-- SER a lista:
--
--   destinatario_nome / destinatario_documento
--     Estavam só dentro de payload_enviado (jsonb). Ler dali não serve por dois
--     motivos: filtrar por cliente viraria varredura de JSON, e em HOMOLOGAÇÃO
--     o nome do destinatário é o texto fixo que a SEFAZ exige
--     ("NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL") — a lista
--     inteira mostraria a mesma frase em vez do cliente.
--
--   order_id
--     O pedido de venda que originou a nota. Sem ele a ação "Ir Para a Venda"
--     não tem para onde ir. Sem FK de propósito: a nota é documento fiscal e
--     não pode ser apagada nem alterada por causa do ciclo de vida do pedido.
--     Ver a regra de que documento fiscal só se cancela, jamais se exclui.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

alter table nfe add column if not exists destinatario_nome text;
alter table nfe add column if not exists destinatario_documento text;
alter table nfe add column if not exists order_id text;

-- NF-e AVULSA: emitida sem pedido de origem.
--
-- Quando a nota nasce de um pedido, o financeiro já foi gerado por ele. Quando
-- ela nasce avulsa, não existe ninguém para gerar — e sem isto uma venda
-- faturada some do contas a receber.
--
-- A condição fica gravada porque a autorização da SEFAZ pode chegar DEPOIS,
-- por webhook, num processo que não tem mais a tela nem o usuário: sem a
-- condição guardada, não haveria como montar as parcelas naquele momento.
alter table nfe add column if not exists condicao_pagamento jsonb;

comment on column nfe.condicao_pagamento is
  'Como a nota avulsa deve virar contas a receber: {tipo, parcelas, intervaloDias}. Nulo quando a nota veio de pedido — nesse caso o financeiro é do pedido.';

comment on column nfe.destinatario_nome is
  'Nome REAL do destinatário. Em homologação difere do nome enviado à SEFAZ, que é o texto fixo exigido por ela.';
comment on column nfe.order_id is
  'Pedido de venda de origem. Sem FK: a nota não pode ser afetada pelo ciclo de vida do pedido.';

-- Busca por cliente na lista de NF-e.
create index if not exists idx_nfe_destinatario on nfe (destinatario_nome);
-- "Este pedido já tem nota?" — pergunta feita a cada tentativa de emissão.
create index if not exists idx_nfe_order on nfe (order_id);

-- >>> fase-ab-nfe-complementar-icms.sql

-- ---------------------------------------------------------------------------
-- Fase AB — NF-e Complementar exclusiva de ICMS
--
-- O CENÁRIO
-- ---------
-- Uma nota saiu com ICMS a menor. O complemento não corresponde a mercadoria
-- nenhuma: não há o que entregar, nem o que dar baixa, nem o que receber. O
-- que existe é imposto a destacar.
--
-- A GAMBIARRA QUE ISTO EVITA
-- --------------------------
-- Lançar o complemento como venda de 1 unidade a R$ 0,01 para "caber" na
-- estrutura de item. Isso movimenta estoque de um produto que não saiu, gera
-- recebível de um centavo que ninguém vai cobrar, e suja o custo médio.
-- A SEF/SC prevê o caminho certo: item ESCRITURAL, com CFOP 5.949 e código de
-- produto próprio, quantidade e valor zerados, e o ICMS destacado sozinho.
--
-- O QUE ESTE ARQUIVO NÃO FAZ
-- --------------------------
-- A especificação pedia ALTER TABLE em `nfe_itens`. Essa tabela NÃO existe
-- neste sistema: os itens da NF-e vivem dentro de `nfe.payload_enviado`
-- (jsonb), que é a cópia fiel do que foi transmitido à SEFAZ. Criar uma tabela
-- de itens só para carregar duas flags duplicaria a fonte da verdade do
-- documento fiscal — e as duas cópias divergiriam. As flags de item viajam no
-- próprio payload.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ======================= TIPO DE OPERAÇÃO NA REGRA FISCAL ===================
-- O CHECK existente não conhece COMPLEMENTO_ICMS, então nenhuma regra fiscal
-- poderia ser cadastrada para a operação — e sem regra, a emissão para em
-- "Nenhuma regra fiscal encontrada".
--
-- Recriado em vez de alterado: Postgres não tem ALTER CONSTRAINT para CHECK.
alter table regra_fiscal drop constraint if exists regra_fiscal_tipo_operacao_check;
alter table regra_fiscal add constraint regra_fiscal_tipo_operacao_check
  check (tipo_operacao in ('VENDA','TRANSFERENCIA','REMESSA','RETORNO',
                            'DEVOLUCAO','BONIFICACAO','ENTRADA_IMPORTACAO',
                            'COMPLEMENTO_ICMS'));

-- ============================ PRODUTO ESCRITURAL ============================
-- Escritural = existe para gerar o item fiscal, não para ser vendido. Sem esta
-- marca o produto apareceria nas listas de mercadoria, entraria em pedido e
-- teria saldo de estoque cobrado.
alter table products add column if not exists tipo_produto_fiscal text
  default 'NORMAL';

-- Constraint separada do ADD COLUMN: rodar duas vezes um `add column ... check`
-- estoura por constraint duplicada.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_tipo_produto_fiscal_check'
  ) then
    alter table products add constraint products_tipo_produto_fiscal_check
      check (tipo_produto_fiscal in ('NORMAL', 'ESCRITURAL'));
  end if;
end $$;

-- Independentes de propósito: existe produto que movimenta estoque e não gera
-- financeiro (brinde), e o contrário (serviço faturado). Uma flag só não
-- conseguiria representar os dois.
alter table products add column if not exists movimenta_estoque boolean not null default true;
alter table products add column if not exists gera_financeiro boolean not null default true;

comment on column products.tipo_produto_fiscal is
  'NORMAL = mercadoria. ESCRITURAL = item que só existe para compor documento fiscal (ex.: complemento de ICMS). Escritural nunca entra em lista de mercadoria.';

-- Produto escritural padrão do complemento de ICMS (SEF/SC).
-- NCM 00000000 é o genérico para item sem mercadoria específica; o CFOP NÃO
-- fica gravado aqui — quem decide entre 5.949 (interno) e 6.949
-- (interestadual) é a regra fiscal, pela UF de destino.
insert into products (id, name, sku, stock_quantity, cost_price, sale_price,
                      ncm, unidade_comercial, unidade_tributavel, origem,
                      tipo_produto_fiscal, movimenta_estoque, gera_financeiro)
values ('prod_escritural_complemento_icms',
        'COMPLEMENTO DE ICMS - NF-E COMPLEMENTAR',
        'CFOP5.949', 0, 0, 0,
        '00000000', 'UN', 'UN', 0,
        'ESCRITURAL', false, false)
on conflict (id) do update set
  name = excluded.name,
  sku = excluded.sku,
  tipo_produto_fiscal = excluded.tipo_produto_fiscal,
  movimenta_estoque = excluded.movimenta_estoque,
  gera_financeiro = excluded.gera_financeiro;

-- ========================= DOCUMENTO COMPLEMENTAR ===========================
-- `finalidade_emissao` já existe em `nfe` desde a criação da tabela, com CHECK
-- (1,2,3,4) — o valor 2 (complementar) já era aceito. O que faltava era saber
-- QUAL complemento é, e a qual nota se refere.
alter table nfe add column if not exists tipo_operacao_fiscal text;
alter table nfe add column if not exists valor_icms_complementar numeric(15,2) not null default 0;
alter table nfe add column if not exists nfe_original_chave char(44);

comment on column nfe.tipo_operacao_fiscal is
  'Operação que originou a nota (VENDA, COMPLEMENTO_ICMS, ...). É ela que decide se houve movimentação de estoque e financeiro.';
comment on column nfe.valor_icms_complementar is
  'ICMS destacado numa nota complementar. NÃO é valor de venda: não vira recebível nem entra no faturamento.';
comment on column nfe.nfe_original_chave is
  'Chave da NF-e complementada. Obrigatória quando finalidade_emissao = 2.';

-- Regra de integridade no BANCO, não só na aplicação: uma nota complementar
-- sem a chave da original é recusada pela SEFAZ, e gravá-la deixaria um
-- rascunho impossível de transmitir sem ninguém saber por quê.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'nfe_complementar_exige_original'
  ) then
    alter table nfe add constraint nfe_complementar_exige_original
      check (finalidade_emissao <> 2 or nfe_original_chave is not null);
  end if;
end $$;

-- "Quais notas complementam esta?" — pergunta da conferência fiscal.
create index if not exists idx_nfe_original_chave on nfe (nfe_original_chave)
  where nfe_original_chave is not null;

-- >>> fase-ac-classes-de-produto.sql

-- ---------------------------------------------------------------------------
-- Fase AC — CLASSES DE PRODUTO (a primeira é COR)
--
-- O PROBLEMA
-- ----------
-- Um mesmo produto existe em cores diferentes, e cada cor tem o próprio
-- saldo. Sem isso, as saídas são: cadastrar quatro produtos ("Godzilla Preto",
-- "Godzilla Branco"...), o que quadruplica o cadastro e quebra qualquer
-- relatório por produto; ou controlar a cor no papel, e o estoque do sistema
-- deixa de valer.
--
-- O DESENHO
-- ---------
--   product_classes                  a classe em si (COR, e amanhã VOLTAGEM)
--   product_class_values             os valores dela (Preto, Branco, ...)
--   product_class_assignments        quais classes ESTE produto usa
--   product_class_value_assignments  quais valores ESTE produto oferece
--
-- Duas camadas de propósito: o catálogo é global (a cor "Preto" é a mesma para
-- todo mundo) e a atribuição é por produto (nem todo produto vem em preto).
-- Sem a separação, cadastrar uma cor nova exigiria repetir a linha em cada
-- produto que a usa.
--
-- O QUE ESTE ARQUIVO NÃO CRIA, E POR QUÊ
-- --------------------------------------
-- A especificação pedia `product_stock_classes`, com o saldo por cor gravado.
-- Aqui o saldo por depósito NÃO é gravado: ele é derivado da soma do razão de
-- movimentos (ver depositBalance em lib/stock-core.js). Uma tabela de saldo
-- por cor seria um TERCEIRO número, capaz de discordar do razão e de
-- products.stock_quantity — exatamente a inconsistência que o §8 da própria
-- especificação proíbe.
--
-- O saldo por cor vem da mesma soma que já produz o saldo por depósito, com a
-- cor gravada no movimento. Dois números que saem do mesmo cálculo não têm
-- como divergir.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ================================ CLASSES ==================================
create table if not exists product_classes (
  id text primary key,
  -- NULO = vale para todas as empresas, que é o caso de COR.
  -- `products` não tem empresa: um produto é global neste sistema. Uma classe
  -- obrigatoriamente por empresa deixaria produto global apontando para classe
  -- de uma empresa só — inconsistência sem dono.
  company_id text,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duas classes "COR" na mesma empresa seriam indistinguíveis nas telas.
-- `coalesce` porque NULL nunca é igual a NULL num índice único: sem ele, dez
-- classes globais chamadas COR passariam.
create unique index if not exists idx_product_classes_nome
  on product_classes (coalesce(company_id, ''), lower(name));

-- ============================ VALORES DA CLASSE =============================
create table if not exists product_class_values (
  id text primary key,
  -- RESTRICT, não CASCADE: apagar a classe COR levaria junto todo o histórico
  -- de qual cor cada movimento teve.
  class_id text not null references product_classes(id) on delete restrict,
  name text not null,
  -- Código curto para etiqueta e importação ("PT", "BR"). Opcional: obrigar
  -- um código para cadastrar uma cor é atrito sem retorno.
  code text,
  -- Espaço para o que a cor precisar depois: {"hex": "#000000"}.
  metadata jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- §21.1 — "Preto" e "preto" na mesma classe seriam duas cores para o sistema e
-- uma só para quem vende.
create unique index if not exists idx_product_class_values_nome
  on product_class_values (class_id, lower(name));
create unique index if not exists idx_product_class_values_codigo
  on product_class_values (class_id, upper(code)) where code is not null;
create index if not exists idx_product_class_values_classe
  on product_class_values (class_id, active);

-- ===================== CLASSES QUE O PRODUTO UTILIZA ========================
create table if not exists product_class_assignments (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  class_id text not null references product_classes(id) on delete restrict,
  -- Obriga escolher um valor na venda? COR de um produto que só existe em
  -- preto não precisa ser escolhida.
  required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- §21.2 — a mesma classe duas vezes no mesmo produto daria duas listas de cor
-- na tela de venda.
create unique index if not exists idx_product_class_assign_unico
  on product_class_assignments (product_id, class_id);
create index if not exists idx_product_class_assign_produto
  on product_class_assignments (product_id, active);

-- CASCADE no produto e RESTRICT na classe, de propósito: excluir um produto
-- deve limpar as atribuições dele; excluir uma classe usada por qualquer
-- produto tem de ser recusado (§21.5).

-- ===================== VALORES QUE O PRODUTO OFERECE =========================
create table if not exists product_class_value_assignments (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  class_id text not null references product_classes(id) on delete restrict,
  class_value_id text not null references product_class_values(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_product_class_value_assign_unico
  on product_class_value_assignments (product_id, class_value_id);
create index if not exists idx_product_class_value_assign_produto
  on product_class_value_assignments (product_id, class_id, active);

-- ============================== SEMENTE: COR ================================
-- A classe COR e as cores mais comuns já entram cadastradas: exigir que o
-- usuário crie "Preto" antes de poder usar a funcionalidade é atrito no
-- primeiro minuto. O `hex` alimenta a bolinha de cor na tela.
insert into product_classes (id, name, description) values
  ('pclass_cor', 'COR', 'Cor do produto. Cada cor tem saldo de estoque próprio.')
on conflict (id) do update set name = excluded.name, description = excluded.description;

insert into product_class_values (id, class_id, name, code, metadata) values
  ('pcval_cor_preto',    'pclass_cor', 'Preto',    'PT', '{"hex":"#111827"}'),
  ('pcval_cor_branco',   'pclass_cor', 'Branco',   'BR', '{"hex":"#F9FAFB"}'),
  ('pcval_cor_vermelho', 'pclass_cor', 'Vermelho', 'VM', '{"hex":"#DC2626"}'),
  ('pcval_cor_azul',     'pclass_cor', 'Azul',     'AZ', '{"hex":"#2563EB"}'),
  ('pcval_cor_cinza',    'pclass_cor', 'Cinza',    'CZ', '{"hex":"#6B7280"}')
on conflict (id) do update set
  name = excluded.name, code = excluded.code, metadata = excluded.metadata;

-- >>> fase-ad-ibs-cbs-uf-municipio.sql

-- ---------------------------------------------------------------------------
-- Fase AD — IBS separado por UF e por Município na regra fiscal
--
-- POR QUE
--
-- A fase-z criou `aliquota_ibs` como um número só. A API da Focus NFe não
-- aceita assim: ela pede os dois lados separados, porque o IBS tem DOIS
-- destinatários com competências distintas —
--
--     ibs_uf_aliquota   -> pIBSUF   (competência do estado)
--     ibs_mun_aliquota  -> pIBSMun  (competência do município)
--
-- Dividir um total ao meio no código resolveria 2026 por coincidência (as
-- alíquotas de teste são 0,05% + 0,05%) e passaria a mentir no primeiro ano em
-- que estado e município divergirem — que é o desenho da LC 214/2025. Alíquota
-- é dado, não regra de código: são 27 estados e 5.570 municípios legislando.
--
-- MEDIDO EM HOMOLOGAÇÃO (14/08/2026): sem os campos de IBS/CBS no payload, a
-- SEFAZ recusa TODA nota com "1115 — Rejeicao: IBS/CBS não informado".
--
-- `aliquota_ibs` (o total da fase-z) fica de pé, sem uso pelo payload: apagar
-- coluna não tem volta, e o custo de mantê-la é zero. Não havia nenhuma regra
-- fiscal cadastrada quando isto rodou, então não há dado a converter.
-- ---------------------------------------------------------------------------

-- Competência do ESTADO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_uf numeric(7,4);

-- Competência do MUNICÍPIO de destino.
alter table regra_fiscal add column if not exists aliquota_ibs_mun numeric(7,4);

-- >>> fase-ae-financeiro-por-cfop-e-beneficio.sql

-- ---------------------------------------------------------------------------
-- Fase AE — três correções que só apareceram emitindo de verdade
--
--   1. a FK da parcela apontava para a tabela de nota ERRADA — e sai de cena
--   2. o CFOP passa a dizer se a nota gera financeiro
--   3. nota isenta precisa do código de benefício fiscal
-- ---------------------------------------------------------------------------


-- 1. A FK DA PARCELA NÃO TEM COMO EXISTIR ---------------------------------
--
-- O sistema tem DUAS tabelas de nota, vivas ao mesmo tempo:
--
--   `nfes`  — registro manual do Financeiro. id TEXTO ("nfe-1786191489250-...")
--   `nfe`   — a nota transmitida à SEFAZ.    id UUID  ("c405593f-e9c4-...")
--
-- E os DOIS caminhos gravam financial_entries.nfe_id: a emissão fiscal
-- (server.js, gerarFinanceiroDaNfeAvulsa) e a NF-e manual do Financeiro
-- (server.js, rota POST /api/finance/nfe).
--
-- A FK da fase-n apontava para `nfes`. Como quem gera parcela na emissão é a
-- nota fiscal, que vive em `nfe`, TODA tentativa era recusada pelo banco:
--
--     A parcela aponta para a NF-e "...", que não está no banco.
--
-- Efeito: nota autorizada, cliente devendo, e nada no Financeiro. Medido na
-- primeira nota autorizada do sistema, em 14/08/2026.
--
-- A tentativa óbvia — repontar para `nfe` — o Postgres recusa:
--
--     42804: foreign key constraint cannot be implemented
--     Key columns "nfe_id" and "id" are of incompatible types: text and uuid.
--
-- E não adianta converter a coluna para uuid: isso passaria a recusar o id do
-- caminho legado, que é texto e continua em uso.
--
-- Então a constraint SAI. Uma FK só sabe apontar para UMA tabela, e aqui são
-- duas com tipos de id diferentes — o modelo não comporta a garantia. Isto é
-- perda de integridade, e está escrito aqui para não parecer descuido: quem
-- protege contra parcela órfã agora é o código, que sabe de qual fluxo veio.
--
-- A correção de verdade é unificar `nfes` dentro de `nfe` (a fase-aa já deu o
-- primeiro passo, tornando `nfe` A lista do sistema). É decisão de modelo, com
-- migração de dados, e não cabe numa correção de bug.
alter table if exists financial_entries drop constraint if exists financial_entries_nfe_id_fkey;

comment on column financial_entries.nfe_id is
  'Nota que originou a parcela. SEM foreign key de propósito: aponta ora para nfe (uuid, fiscal), ora para nfes (texto, manual) — ver fase-ae.';


-- 2. QUAL CFOP GERA FINANCEIRO --------------------------------------------
--
-- Emitir nota não é sinônimo de vender. Uma devolução (1202) não gera
-- recebível; uma venda (5405) gera. Sair pelo `tipo` (ENTRADA/SAÍDA) não
-- resolve: 5202 é devolução de compra, é SAÍDA e não gera nada.
--
-- Vira COLUNA, e não regra no código, porque a classificação é fiscal: quando
-- um CFOP fugir do padrão, a correção é uma linha de UPDATE aqui e não um
-- deploy.
alter table if exists cfop add column if not exists gera_financeiro boolean not null default false;

comment on column cfop.gera_financeiro is
  'A NF-e com este CFOP cria contas a receber? Venda cria; devolução, remessa, retorno e transferência não.';

-- Semente: só venda de saída. Tudo o mais fica false, que é o padrão seguro —
-- recebível a menos aparece na conferência; recebível a mais é cobrança
-- indevida de cliente.
update cfop
   set gera_financeiro = true
 where tipo = 'SAIDA'
   and (descricao ilike 'Venda%' or descricao ilike 'Vendas%');


-- 3. CÓDIGO DE BENEFÍCIO FISCAL (nota isenta) ------------------------------
--
-- Medido em homologação em 15/08/2026, emitindo com CST 40:
--
--     930  Rejeicao: CST com beneficio fiscal e nao informado o codigo
--          de beneficio fiscal [nItem:1]
--
-- A SEFAZ NÃO pediu base nem alíquota (o grupo da isenta não tem esses
-- campos). Pediu o cBenef — o código que o estado publica para cada benefício.
-- Sem ele, nenhuma nota isenta é autorizada.
--
-- É dado do estado, não do código: em SC sai da tabela da SEF/SC, e muda por
-- ato normativo.
alter table regra_fiscal add column if not exists codigo_beneficio_fiscal varchar(10);
alter table regra_fiscal add column if not exists icms_motivo_desoneracao varchar(2);

comment on column regra_fiscal.codigo_beneficio_fiscal is
  'cBenef — código do benefício fiscal na tabela da UF. Exigido pela SEFAZ em CST com benefício (40, 41, 50).';
comment on column regra_fiscal.icms_motivo_desoneracao is
  'motDesICMS — motivo da desoneração do ICMS, quando houver valor desonerado a declarar.';

-- >>> fase-ag-preferencias-do-usuario.sql

-- ---------------------------------------------------------------------------
-- Fase AG — preferencias de tela por usuario
--
-- A lista de Pedidos e Orcamentos ganhou seletor de colunas, e a escolha
-- precisa seguir a PESSOA, nao o navegador. Guardar em localStorage pareceria
-- funcionar ate alguem trocar de maquina ou abrir numa aba anonima e achar que
-- o sistema esqueceu.
--
-- Uma coluna jsonb generica, e nao uma por tela: a proxima lista que precisar
-- lembrar de algo (largura de coluna, ordem preferida, filtro salvo) entra sem
-- migracao nova. O formato e { "<tela>": { ...o que aquela tela quiser } }.
--
-- Segue o caminho que ja existia para dashboard_pins, na mesma tabela.
alter table if exists users add column if not exists preferences jsonb not null default '{}'::jsonb;

comment on column users.preferences is
  'Preferencias de tela por usuario, no formato { "<tela>": {...} }. Hoje guarda as colunas visiveis da lista de vendas.';

-- >>> fase-ah-grupos-de-produtos.sql

-- ---------------------------------------------------------------------------
-- ATENCAO -- A TELA DE GRUPOS FOI RETIRADA EM 25/08/2026.
--
-- O pedido nao tem mais grupos: a tela de Produtos voltou a ser uma lista so.
-- Os grupos separavam o que ninguem separava na pratica, e toda venda nascia
-- com um "Grupo de Produtos Padrao - 01" que so ocupava espaco.
--
-- A COLUNA CONTINUA NO BANCO, E DE PROPOSITO. Ela guarda os grupos dos pedidos
-- que ja foram gravados com eles; apagar a coluna apagaria esse historico para
-- sempre, e o ganho seria zero -- uma coluna jsonb que ninguem le nao custa
-- consulta nem espaco relevante. Os itens nunca dependeram dela: sempre foram
-- lista plana, e o `groupId` de cada item virou um campo que ninguem le.
--
-- Se um dia a funcao voltar, o dado esta aqui. Se nunca voltar, nada quebra.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Fase AH — Grupos de Produtos no pedido e no orcamento
--
-- O pedido passa a ter 1..N grupos ("Grupo de Produtos Padrao - 01",
-- renomeavel), cada um com seus itens e seu total.
--
-- MODELO: o grupo e METADADO sobre a lista PLANA de itens que ja existe, e nao
-- um nivel a mais dentro dela.
--
--   items          [ {..., "groupId": "grp-a"}, {..., "groupId": "grp-b"} ]
--   product_groups [ {"id":"grp-a","name":"...","ordem":0}, ... ]
--
-- O pedido inteiro ja e lido como lista plana de itens em muitos lugares --
-- baixa de estoque, reserva, totais, payload da NF-e, tabela de precos.
-- Aninhar os itens dentro dos grupos obrigaria todos eles a saber de grupo so
-- para somar uma quantidade, e cada um que esquecesse passaria a ignorar tudo
-- que nao estivesse no primeiro grupo -- em silencio, que e o pior jeito de
-- errar estoque. Um campo a mais dentro do item e ignorado por quem nao se
-- importa, que e a maioria.
--
-- Esta migracao e ADITIVA: nao mexe em `items`, nao apaga nada e nao muda tipo
-- de coluna. Pedido gravado antes dela continua valido -- fica com
-- product_groups = [] e, na primeira leitura, a normalizacao poe todos os itens
-- num grupo padrao. Nenhum item se perde por nao ter groupId.
--
-- Vale para as DUAS tabelas: orcamento vira pedido sem trocar de tabela, e um
-- orcamento que perdesse os grupos ao ser aprovado seria pior do que nunca
-- te-los tido.
-- ---------------------------------------------------------------------------

alter table if exists orders add column if not exists product_groups jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists product_groups jsonb not null default '[]'::jsonb;

comment on column orders.product_groups is
  'Grupos de produtos do pedido: [{"id","name","ordem"}]. Os itens ficam em `items`, cada um com "groupId" apontando para um destes. Lista vazia = pedido de antes da fase AH; a leitura cria o grupo padrao.';

comment on column quotes.product_groups is
  'Grupos de produtos do orcamento: [{"id","name","ordem"}]. Mesmo formato de orders.product_groups.';

-- >>> fase-ai-anexos-do-pedido.sql

-- ---------------------------------------------------------------------------
-- Fase AI — Arquivos Anexados ao pedido e ao orcamento
--
-- O ARQUIVO nao fica aqui. O binario vai para o Supabase Storage, no bucket
-- `pedido-anexos`, e esta coluna guarda so a FICHA de cada arquivo:
--
--   [{ "id", "nome", "tamanho", "tipo", "caminho", "enviadoEm", "enviadoPor" }]
--
-- Guardar o binario no banco (bytea ou base64 num jsonb) faria cada leitura do
-- pedido arrastar os anexos junto: abrir a lista de pedidos passaria a
-- transferir megabytes de PDF que ninguem pediu. O `caminho` e o que liga a
-- ficha ao arquivo la no Storage.
--
-- O bucket e PRIVADO. Anexo de pedido tem contrato, proposta e dado de
-- cliente; bucket publico faria cada arquivo ficar legivel por qualquer um que
-- descobrisse a URL, sem login nenhum. O download passa pelo servidor, que
-- confere a sessao antes de entregar os bytes.
--
-- Migracao ADITIVA: nao mexe em nada existente. Pedido gravado antes dela fica
-- com `attachments = []`, que e exatamente "nenhum anexo".
--
-- Vale para as DUAS tabelas: orcamento vira pedido sem trocar de tabela, e
-- perder os anexos ao aprovar seria pior do que nunca te-los aceitado.
-- ---------------------------------------------------------------------------

alter table if exists orders add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table if exists quotes add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column orders.attachments is
  'Fichas dos arquivos anexados: [{"id","nome","tamanho","tipo","caminho","enviadoEm","enviadoPor"}]. O binario fica no Supabase Storage, bucket privado `pedido-anexos`; `caminho` e a chave la dentro.';

comment on column quotes.attachments is
  'Fichas dos arquivos anexados ao orcamento. Mesmo formato de orders.attachments.';

-- >>> fase-aj-transicoes-de-status.sql

-- ---------------------------------------------------------------------------
-- Fase AJ — transicoes validas de status, no BANCO
--
-- Ate aqui qualquer status virava qualquer outro: bastava um UPDATE com o
-- campo preenchido. Um pedido faturado voltava a "Orcamento" sem estornar
-- nada, e o estoque baixado e o contas a receber criado ficavam la, agora sem
-- nenhum documento que os explicasse.
--
-- A tela ja escondia o caminho e o servidor passou a recusar. Isto aqui e a
-- terceira porta -- a que continua fechada quando alguem escreve direto no
-- banco: um script de correcao, um UPDATE no SQL Editor, uma integracao
-- futura. Regra que so existe no aplicativo vale ate a primeira vez que
-- alguem nao passa por ele.
--
-- A LISTA E A MESMA de public/modules/shared/sales_status.js (TRANSICOES).
-- Nao foi redigitada: foi gerada dali, e scripts/test-transicoes-status.js
-- compara par a par os dois lados a cada rodada da suite. Duas listas
-- escritas a mao divergem -- e divergencia aqui significa a tela permitindo o
-- que o banco recusa, ou pior, o contrario.
--
-- O QUE NAO ESTA AQUI, DE PROPOSITO:
--
--   Nao ha "create type ... as enum". O briefing pedia, mas a coluna e text e
--   ja tem valor legado gravado ('faturado', 'pendente', 'em aberto'),
--   traduzido na leitura. Trocar o tipo obrigaria a reescrever TODA linha
--   existente antes -- e migracao que reescreve dado historico e o oposto de
--   aditiva. A funcao abaixo normaliza o legado antes de comparar, entao
--   pedido antigo continua podendo ser cancelado.
--
--   O catalogo do sistema tambem e MAIOR que os seis status do briefing: tem
--   pre-faturado, parcialmente faturado e aprovado sem faturamento, os tres em
--   uso. Reduzir ao conjunto do briefing apagaria estados que existem.
-- ---------------------------------------------------------------------------

-- Traduz o status gravado para o vocabulario atual. Mesmo mapa do modulo
-- compartilhado: sem isto, um pedido gravado como 'faturado' nao teria linha
-- na tabela de transicoes e ficaria impossivel de cancelar.
-- DROP antes de criar: a primeira versao desta migracao nomeou os parametros
-- "de"/"para", e "create or replace" recusa trocar nome de parametro
-- ("cannot change name of input parameter"). Sem o drop, quem ja rodou a
-- versao anterior nao consegue aplicar a correcao.
drop function if exists sales_status_normalizar(text);
create or replace function sales_status_normalizar(p_bruto text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case lower(trim(coalesce(p_bruto, '')))
    when 'pendente' then 'pedido'
    when 'faturado' then 'pedido-faturado'
    when 'cancelado' then 'pedido-cancelado'
    when 'em aberto' then 'orcamento'
    when 'aprovado' then 'orcamento-aprovado'
    when 'reprovado' then 'orcamento-reprovado'
    else lower(trim(coalesce(p_bruto, '')))
  end;
$$;

-- Os pares validos numa TABELA, e nao num case gigante: da para consultar
-- ("de onde da para sair daqui?") e a geracao a partir do JS fica literal.
create table if not exists sales_status_transicao (
  de text not null,
  para text not null,
  primary key (de, para)
);

-- Fecha a porta publica do PostgREST, como as outras 77 tabelas (fase AF).
-- RLS ligada e SEM politica: anon e authenticated nao leem nem escrevem. Quem
-- precisa ler e a funcao acima, e ela le como dona.
alter table sales_status_transicao enable row level security;

-- Recriada inteira a cada execucao: e tabela de REGRA, nao de dado. Assim a
-- migracao pode rodar de novo depois de a lista mudar, sem duplicar nem deixar
-- par velho para tras.
delete from sales_status_transicao;
insert into sales_status_transicao (de, para) values
  ('orcamento', 'pedido'),
  ('orcamento', 'orcamento-aprovado'),
  ('orcamento', 'orcamento-reprovado'),
  ('orcamento-aprovado', 'pedido'),
  ('orcamento-aprovado', 'orcamento-reprovado'),
  ('pedido', 'pedido-nao-faturado'),
  ('pedido', 'pedido-pre-faturado'),
  ('pedido', 'pedido-faturado'),
  ('pedido', 'pedido-aprovado-sem-faturamento'),
  ('pedido', 'pedido-parcialmente-faturado'),
  ('pedido', 'pedido-cancelado'),
  ('pedido-nao-faturado', 'pedido'),
  ('pedido-nao-faturado', 'pedido-pre-faturado'),
  ('pedido-nao-faturado', 'pedido-faturado'),
  ('pedido-nao-faturado', 'pedido-aprovado-sem-faturamento'),
  ('pedido-nao-faturado', 'pedido-cancelado'),
  ('pedido-pre-faturado', 'pedido-faturado'),
  ('pedido-pre-faturado', 'pedido-parcialmente-faturado'),
  ('pedido-pre-faturado', 'pedido-nao-faturado'),
  ('pedido-pre-faturado', 'pedido-cancelado'),
  ('pedido-parcialmente-faturado', 'pedido-faturado'),
  ('pedido-parcialmente-faturado', 'pedido-cancelado'),
  ('pedido-faturado', 'pedido-cancelado'),
  ('pedido-aprovado-sem-faturamento', 'pedido-cancelado');

drop function if exists sales_status_transicao_valida(text, text);
create or replace function sales_status_transicao_valida(p_de text, p_para text)
returns boolean
language sql
stable
-- SECURITY DEFINER porque a tabela de regras fica com RLS ligada e sem
-- politica: um usuario "authenticated" que atualizasse o pedido leria ZERO
-- linhas de transicao e TODA mudanca de status seria recusada. Definer faz a
-- funcao ler as regras como dona da tabela, sem abrir a tabela para ninguem.
-- search_path fixo porque SECURITY DEFINER sem ele e o caminho classico de
-- sequestro: quem controlasse o search_path apontaria "sales_status_transicao"
-- para uma tabela propria.
security definer
set search_path = public
as $$
  -- OS PARAMETROS SE CHAMAM p_de/p_para, e nao de/para, porque a TABELA tem
  -- colunas com esses nomes. Dentro do subselect o Postgres resolve um nome
  -- solto como COLUNA, nao como parametro: escrito "sales_status_normalizar(de)",
  -- vira sales_status_normalizar(t.de), a comparacao fica t.de = t.de e o
  -- exists() da verdadeiro para QUALQUER par. Medido em 24/08/2026 contra o
  -- banco: ate "xxx -> yyy" respondia true. A guarda existia e nao guardava
  -- nada -- pior do que nao existir, porque parecia estar la.
  select
    -- Ficar no MESMO status nao e transicao: salvar um pedido sem mexer no
    -- status e a operacao mais comum da tela.
    sales_status_normalizar(p_de) = sales_status_normalizar(p_para)
    or exists (
      select 1 from sales_status_transicao t
      where t.de = sales_status_normalizar(p_de)
        and t.para = sales_status_normalizar(p_para)
    );
$$;

create or replace function sales_status_guarda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Linha nova entra com o status que quiser: ela nao vem de lugar nenhum.
  if tg_op = 'INSERT' then
    return new;
  end if;
  -- Status inalterado nao passa pela regra. Sem esta saida, TODO update de
  -- qualquer campo do pedido pagaria a consulta.
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not sales_status_transicao_valida(old.status, new.status) then
    raise exception 'Transicao de status invalida: % nao vira %.', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_guarda on orders;
create trigger orders_status_guarda
  before update on orders
  for each row execute function sales_status_guarda();

drop trigger if exists quotes_status_guarda on quotes;
create trigger quotes_status_guarda
  before update on quotes
  for each row execute function sales_status_guarda();

comment on table sales_status_transicao is
  'Transicoes validas de status de pedido/orcamento. Gerada de TRANSICOES em public/modules/shared/sales_status.js; scripts/test-transicoes-status.js confere que as duas nao divergiram.';
