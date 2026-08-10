-- ---------------------------------------------------------------------------
-- Fase X — tipos de contrato
--
-- O módulo Contratos tinha MODELO (o texto-padrão que se reaproveita ao
-- emitir) mas não tinha TIPO — a classificação do que aquele contrato é.
-- São coisas diferentes: "Locação de equipamento" é um tipo; o texto com as
-- cláusulas de locação é um modelo. Um tipo pode ter vários modelos ao longo do
-- tempo, e o mesmo modelo pode servir a mais de um tipo.
--
-- O CAMPO QUE FAZ O TIPO VALER A PENA: aviso_previa_dias.
--
-- Contrato não se renova nem se encerra no dia do vencimento — se encerra no
-- prazo de aviso prévio ANTES dele. Perder essa data é o erro caro do módulo:
-- o contrato renova sozinho por mais um ciclo inteiro sem ninguém decidir.
-- O prazo varia por tipo (30 dias num contrato de serviço, 90 numa locação),
-- e é por isso que ele mora aqui e não numa configuração global.
--
-- As telas de Contratos e de Vencimentos leem esse prazo para avisar no
-- momento certo, em vez de avisar só quando já venceu.
-- ---------------------------------------------------------------------------

create table if not exists contract_types (
  id text primary key,
  name text not null,
  description text,
  -- De que lado do caixa este tipo costuma cair. 'ambos' existe porque há
  -- tipo que serve aos dois lados (permuta, parceria, comodato).
  natureza text not null default 'receita'
    check (natureza in ('receita', 'despesa', 'ambos')),
  -- Dias de antecedência para avisar renovação ou encerramento. 30 é o prazo
  -- mais comum em contrato de prestação de serviço.
  aviso_previa_dias integer not null default 30,
  -- Modelo de texto que costuma acompanhar este tipo. SET NULL: excluir o
  -- modelo não pode apagar o tipo junto.
  template_id text references contract_templates(id) on delete set null,
  ordem integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_types_ordem on contract_types (ordem, name);

-- SET NULL pelo mesmo motivo de sempre: excluir um tipo não pode apagar os
-- contratos classificados nele. Eles só ficam sem tipo, e a tela mostra "-".
alter table contracts add column if not exists type_id text
  references contract_types(id) on delete set null;

create index if not exists idx_contracts_tipo on contracts (type_id);
