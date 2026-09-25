-- ---------------------------------------------------------------------------
-- Fase DD — meta de venda por FILIAL
--
-- A fase DC criou a meta por 'empresa', apontando para `orders.company_id`. Só
-- que esse campo está vazio nos 14.864 pedidos desta base: uma meta de empresa
-- não teria venda nenhuma para medir. A loja de cada venda só aparece no fim da
-- categoria ("Venda de Materiais e Serviços / Araquari") — ver
-- lib/filial-da-venda.js.
--
-- O escopo novo 'filial' guarda em `referencia_id` o NOME da filial como ele
-- aparece na categoria. Nome, e não id, porque a filial não tem cadastro: ela
-- existe só como texto nos pedidos. A comparação ignora acento e caixa
-- (chaveDaFilial), então "Timbo" e "Timbó" são a mesma meta.
--
-- Só o CHECK muda. A unicidade (escopo, referencia_id, competencia) da fase DC
-- já cobre o escopo novo sem nada a acrescentar.
-- ---------------------------------------------------------------------------

alter table metas_de_venda drop constraint if exists metas_de_venda_escopo_check;
alter table metas_de_venda add constraint metas_de_venda_escopo_check
  check (escopo in ('empresa', 'vendedor', 'filial'));

comment on column metas_de_venda.referencia_id is
  'Empresa do db.json (mesma referência de orders.company_id) quando escopo = '
  'empresa; people.id com papel Vendedor (mesma de orders.seller_id) quando '
  'escopo = vendedor; nome da filial como aparece no fim de orders.category '
  'quando escopo = filial (fase DD). Sem FK: referência polimórfica, e meta é '
  'histórico.';
