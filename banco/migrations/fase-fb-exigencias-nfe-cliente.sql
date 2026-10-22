-- ============================================================================
-- FASE FB — EXIGÊNCIAS DE NF-e POR CLIENTE (ex.: ARWEG / Grupo WEG)
-- ============================================================================
--
-- O usuário colou "006_exigencias_nfe_cliente.sql" (22/10/2026). ADAPTADO, e
-- não rodado: o script criava um schema `fis` à parte, que nenhuma tela nem a
-- emissão leem. Decidido com ele:
--   * o pedido de compra do cliente é digitado NO PRÓPRIO PEDIDO DE VENDA
--     (nº em orders.customer_po_code, que já existia; cond. pagto, centro e
--     depósito recebedor no cabeçalho; item do pedido, código do material e
--     unidade em cada linha) — sem a tabela pedido_compra_cliente do script;
--   * o perfil de cada cliente tem tela no Fiscal ("Exigências de NF-e por
--     Cliente").
--
-- O resto do script vive no código, e não em funções do banco:
--   * xPed / nItemPed vão em cada item da NF-e (Focus: `pedido_compra` e
--     `numero_item_pedido_compra`, conferidos em campos.focusnfe.com.br/nfe/
--     ItemNotaFiscalXML.html em 22/10/2026); o código do material, no texto do
--     item (infAdProd); o texto do pedido, nas informações complementares;
--   * a conferência antes de emitir (o validar_exigencias_nfe do script) é
--     lib/exigencias-nfe-cliente.js, chamada por prepararNfeParaTransmitir;
--   * o XML por e-mail na autorização vai pela própria Focus
--     (POST /v2/nfe/{ref}/email, até 10 endereços) — o sistema não tem
--     servidor de e-mail. Cada envio fica em nfe_email_envio.
-- ============================================================================

create table if not exists cliente_exigencia_nfe (
  cnpj_cpf               varchar(14) primary key,
  cadastro_id            text not null default '',
  nome                   text not null,
  ativo                  boolean not null default true,

  -- XML
  exige_xped_item        boolean not null default false,  -- xPed em cada item
  exige_nitemped_item    boolean not null default false,  -- nItemPed em cada item
  exige_mesmas_linhas    boolean not null default false,  -- uma linha da nota por item do pedido (sem repetir)
  exige_ref_retorno      boolean not null default false,  -- retorno refere a NF de remessa
  emails_xml             text[] not null default '{}',    -- XML por e-mail na autorização (até 10)

  -- DANFE
  exige_pedido_infcpl    boolean not null default false,  -- nº do pedido nas informações complementares
  exige_codigo_material  boolean not null default false,  -- código do material do cliente em cada item
  rotulo_material        text not null default 'MATERIAL',
  exige_cond_pagto       boolean not null default false,
  exige_unidade_pedido   boolean not null default false,  -- unidade do item = a do pedido do cliente
  exige_centro           boolean not null default false,
  exige_deposito         boolean not null default false,
  proibe_dados_bancarios boolean not null default false,

  -- Texto das informações complementares. Variáveis: {pedido} {cond_pagto} {centro} {deposito}
  modelo_infcpl          text not null default '',
  observacoes            text not null default '',
  criado_em              timestamptz not null default now(),
  alterado_em            timestamptz not null default now(),
  alterado_por_nome      text not null default '',
  constraint ck_exigencia_documento check (cnpj_cpf ~ '^[0-9]{11}$|^[0-9]{14}$'),
  constraint ck_exigencia_emails check (coalesce(array_length(emails_xml, 1), 0) <= 10)
);
alter table cliente_exigencia_nfe enable row level security;

create table if not exists nfe_email_envio (
  id            bigserial primary key,
  nfe_id        text not null,
  referencia    text not null default '',
  emails        text[] not null default '{}',
  status        text not null check (status in ('ENVIADO', 'ERRO')),
  erro          text not null default '',
  automatico    boolean not null default true,
  enviado_por_nome text not null default '',
  criado_em     timestamptz not null default now()
);
create index if not exists idx_nfe_email_envio_nfe on nfe_email_envio (nfe_id);
alter table nfe_email_envio enable row level security;

-- O perfil da ARWEG Jaraguá do Sul, como veio no script.
insert into cliente_exigencia_nfe (
  cnpj_cpf, nome,
  exige_xped_item, exige_nitemped_item, exige_mesmas_linhas, exige_ref_retorno, emails_xml,
  exige_pedido_infcpl, exige_codigo_material, rotulo_material, exige_cond_pagto, exige_unidade_pedido,
  exige_centro, exige_deposito, proibe_dados_bancarios,
  modelo_infcpl, observacoes, alterado_por_nome
) values (
  '84434240000194', 'ASSOCIACAO RECREATIVA WEG - ARWEG JARAGUA DO SUL',
  true, true, true, true, array['nfe@weg.net'],
  true, true, 'MATERIAL ARWEG', true, true,
  true, true, true,
  'PEDIDO DE COMPRA ARWEG: {pedido} | COND. PAGTO: {cond_pagto} | CENTRO RECEBEDOR: {centro} | DEPOSITO RECEBEDOR: {deposito}',
  'Condições Gerais de Compra WEG. Pagamento só por transferência para conta vinculada ao CNPJ emitente (cadastro ARWEG). Proibido negociar duplicatas com factoring/terceiros. NFS-e: weg-nservico@weg.net até dia 25, 1 nota por PDF.',
  'Sistema (fase FB)'
)
on conflict (cnpj_cpf) do nothing;
