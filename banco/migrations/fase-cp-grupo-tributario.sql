-- ============================================================================
-- FASE CP — GRUPO TRIBUTÁRIO: a regra fiscal deixa de precisar de um NCM por vez
-- ============================================================================
--
-- O QUE MEDIU A DECISÃO, em 21/09/2026
-- ------------------------------------
--   produtos cadastrados ............. 5.475
--   NCM distintos entre eles ..........  759
--   regras fiscais cadastradas ........    0
--
-- `resolverRegraFiscal` casa a regra pelo NCM do item. Com 759 NCMs, deixar o
-- catálogo inteiro apto a emitir exige, no pior caso, 759 regras — e isso VEZES
-- cada tipo de operação (VENDA, TRANSFERENCIA, REMESSA, DEVOLUCAO...) e vezes
-- cada UF de destino que mereça tratamento próprio. É por isso que o número de
-- regras é zero: a tarefa, do jeito que estava, não cabe em ninguém.
--
-- O NCM é uma classificação ADUANEIRA, não tributária. Ele diz o que a
-- mercadoria é; não diz como a empresa a tributa. Produtos com NCM diferente
-- recebem o mesmo tratamento (revenda tributada normal), e produtos com o MESMO
-- NCM podem receber tratamentos diferentes (um com ST, outro sem, porque um vai
-- para contribuinte e o outro para consumidor final).
--
-- O GRUPO TRIBUTÁRIO é a classificação que faltava: uma etiqueta no produto que
-- diz como ELE é tributado. "Revenda tributada", "Revenda com ST", "Monofásico
-- PIS/COFINS", "Importado para revenda". Meia dúzia de grupos cobre os 5.475
-- produtos, e a matriz de regras vira algo que uma pessoa consegue manter.
--
-- Isto é copiado do ViperERP de propósito. A parametrização fiscal dele é
-- Operação Fiscal x Grupo Tributário x UF destino, e é a parte do sistema
-- antigo que funciona melhor do que a nossa.
--
-- O NCM NÃO SAI DE CENA, e a diferença importa:
--
--   como CRITÉRIO de regra ele continua existindo e continua sendo o mais
--   específico — quando um NCM precisa de tratamento próprio, a regra com NCM
--   ganha da regra com grupo, porque tem mais critérios preenchidos;
--
--   como CAMPO DA NOTA ele continua OBRIGATÓRIO. A SEFAZ exige NCM em todo
--   item, e a emissão continua recusando item sem NCM. Grupo tributário
--   escolhe a REGRA; não substitui o NCM no XML.
--
-- POR QUE NÃO ENTRA "PAÍS" NA MATRIZ
-- ----------------------------------
-- A matriz do Viper tem uma quarta coluna, País de destino, e ela fica de fora
-- aqui por falta de dado com que casar: nem `people` nem `estabelecimento` têm
-- coluna de país. Criar `regra_fiscal.pais_destino` hoje seria coluna que
-- ninguém preenche e nada lê — o mesmo defeito de `declaracao_importacao`, que
-- existe no schema desde a fase de importação e não tem uma linha de código.
--
-- Exportação, que é o caso que o País serviria, JÁ é representável: a NF-e usa
-- `uf_destino = 'EX'`, e o critério `uf_destino` aceita esse valor. Quando o
-- cadastro de pessoas ganhar país, a coluna entra com quem a lê.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- O CATÁLOGO DE GRUPOS
--
-- Por empresa, e não global: empresas do mesmo grupo econômico podem ter regime
-- diferente (a memória do projeto registra Simples Nacional e Lucro Presumido
-- convivendo), e um grupo chamado "Revenda tributada" não significa a mesma
-- coisa nos dois.
-- ----------------------------------------------------------------------------
create table if not exists grupo_tributario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  descricao text,
  -- Grupo sai de uso sem sumir: produto já classificado continua apontando
  -- para ele, e a regra antiga continua explicando nota antiga. Desativar tira
  -- da lista de escolha; apagar quebraria o histórico.
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Nome único por empresa, sem depender de quem digitou com maiúscula: dois
-- grupos "Revenda Tributada" e "revenda tributada" seriam a receita para
-- metade dos produtos cair num e metade no outro.
create unique index if not exists idx_grupo_tributario_nome
  on grupo_tributario (empresa_id, lower(nome));

create index if not exists idx_grupo_tributario_empresa
  on grupo_tributario (empresa_id) where ativo;

alter table if exists grupo_tributario enable row level security;

comment on table grupo_tributario is
  'Fase CP — como a empresa tributa um produto. Etiqueta no produto que a regra fiscal usa como critério, no lugar de uma regra por NCM.';

-- ----------------------------------------------------------------------------
-- O PRODUTO GANHA A ETIQUETA
--
-- `on delete set null`, e não cascade: apagar um grupo não pode apagar produto.
-- Fica sem grupo, e a regra volta a ser escolhida pelos outros critérios — que
-- é exatamente o comportamento de hoje, então nada regride.
-- ----------------------------------------------------------------------------
alter table products add column if not exists grupo_tributario_id uuid
  references grupo_tributario(id) on delete set null;

create index if not exists idx_products_grupo_tributario
  on products (grupo_tributario_id) where grupo_tributario_id is not null;

comment on column products.grupo_tributario_id is
  'Fase CP — o grupo tributário do produto. NULL = sem grupo, e a regra é escolhida só pelos outros critérios.';

-- ----------------------------------------------------------------------------
-- A REGRA GANHA O CRITÉRIO
--
-- NULL = coringa, igual a `ncm`, `uf_destino` e os outros: regra sem grupo
-- continua valendo para qualquer produto. É o que garante que este ALTER não
-- muda o resultado de nenhuma regra já cadastrada.
-- ----------------------------------------------------------------------------
alter table regra_fiscal add column if not exists grupo_tributario_id uuid
  references grupo_tributario(id) on delete cascade;

comment on column regra_fiscal.grupo_tributario_id is
  'Fase CP — critério de casamento: qual grupo tributário esta regra atende. NULL = qualquer grupo, como os outros critérios.';

-- O índice de busca da regra passa a considerar o grupo. O antigo fica: quem
-- casa por NCM continua usando aquele.
create index if not exists idx_regra_busca_grupo
  on regra_fiscal (empresa_id, tipo_operacao, grupo_tributario_id, uf_destino);
