-- ============================================================================
-- FASE BV — quem é a credenciadora do cartão
-- ============================================================================
--
-- O QUE ISTO RESOLVE
-- ------------------
-- O grupo `pag/detPag/card` da NF-e exige o CNPJ da CREDENCIADORA quando o
-- pagamento é em cartão integrado (tpIntegra = 1). O MAVIS ONE não tinha esse
-- dado em lugar nenhum: `adquirente`, `credenciadora`, `bandeira` e `NSU` só
-- apareciam em comentário.
--
-- Enquanto o grupo `card` não é montado, a SEFAZ não cobra os campos dele — e é
-- por isso que a fase BU pôde levar as formas de pagamento reais para a nota sem
-- esbarrar nisso. Montá-lo PELA METADE é o que derruba a nota: na observação do
-- ViperERP de 08/09/2026, duas notas caíram na mesma rejeição
--
--   Rejeicao: Falha no Schema XML da NFe
--   (Elemento: enviNFe/NFe[1]/infNFe/pag/detPag/card/CNPJ/) (Cod: 225)
--
-- porque o `card` saía sem o CNPJ. O operador descobriu sozinho, corrigiu a
-- nota à mão, e minutos depois a nota seguinte caiu no mesmo erro — o defeito
-- era do cadastro, não da nota. Esta tabela é o cadastro que faltava; o grupo
-- `card` só passa a ser montado quando ele existir e estiver completo.
--
-- POR QUE UMA TABELA PRÓPRIA, E NÃO UM CAMPO NA FORMA DE PAGAMENTO
-- ----------------------------------------------------------------
-- A mesma credenciadora atende várias formas ("Rede 1x", "Rede 2-6x", "Rede
-- débito") e várias lojas. Repetir o CNPJ em cada forma é a receita para tê-lo
-- certo numa e errado noutra — que é exatamente a forma como o problema
-- observado se manifestou: erro igual em duas filiais diferentes, porque a
-- configuração era uma só e estava errada uma vez.
--
-- AS BANDEIRAS FICAM AQUI, e não no pedido, pelo mesmo motivo: quem aceita
-- Visa/Master/Elo é a credenciadora contratada, e o vendedor escolhe DENTRE as
-- que ela aceita. `tBand` da NF-e usa códigos próprios (01 Visa, 02 Mastercard,
-- 03 American Express, 04 Sorocred, 05 Diners, 06 Elo, 07 Hipercard, 08 Aura,
-- 09 Cabal, 99 Outros) — guardados como estão, para não haver tradução no meio.
-- ============================================================================

create table if not exists card_acquirers (
  id            text primary key,
  name          text not null,
  -- 14 dígitos, sem máscara. É o que vai em pag/detPag/card/CNPJ.
  cnpj          text not null,
  -- Códigos tBand aceitos, como texto ('01','02','06'). Vazio = não restringe.
  brands        jsonb not null default '[]'::jsonb,
  -- 'ativo' | 'inativo'. Inativa some do formulário e continua no histórico —
  -- excluir uma credenciadora em uso deixaria pagamentos apontando para um
  -- CNPJ que ninguém mais sabe de quem era.
  status        text not null default 'ativo',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- "Rede" e "rede" são a mesma credenciadora. O índice é sobre lower(name) pelo
-- mesmo motivo de sales_origins: comparar no aplicativo deixaria as duas
-- passarem quando gravadas ao mesmo tempo.
create unique index if not exists idx_card_acquirers_nome
  on card_acquirers (lower(name));

-- O CNPJ também é único: duas credenciadoras com o mesmo CNPJ são a mesma
-- credenciadora cadastrada duas vezes, e o segundo cadastro é o que vai estar
-- desatualizado quando alguém corrigir o primeiro.
create unique index if not exists idx_card_acquirers_cnpj
  on card_acquirers (cnpj);

create index if not exists idx_card_acquirers_status on card_acquirers (status);

-- ----------------------------------------------------------------------------
-- O VINCULO fica na FORMA DE PAGAMENTO — e ela mora no db.json, nao aqui.
--
-- `payment_methods` nao e tabela do Postgres: as formas de pagamento sao uma
-- colecao do data/db.json, servida pelo CRUD generico de cadastros. Por isso
-- nao ha `alter table` nem chave estrangeira nesta migracao: o campo
-- `cardAcquirerId` nasce no proprio registro do db.json.
--
-- E a mesma situacao das colunas `nfe_id` que apontam para duas tabelas
-- diferentes: sem FK possivel, a guarda tem de viver no aplicativo. Ver
-- `adquirenteEmUso` em server.js, que recusa excluir uma credenciadora que
-- alguma forma ainda usa — e que le a fonte CERTA, que e a licao da fase BB.
--
-- Fica na forma, e nao no pedido, porque e a forma que representa o contrato:
-- "Cartao de Credito Rede 2-6x" tem uma credenciadora, uma taxa e um prazo. O
-- vendedor escolhe a forma; o CNPJ vem junto, sem ninguem digitar.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- RLS: fecha a porta pública do PostgREST, como as outras tabelas.
-- Ligada e SEM política — anon e authenticated não leem nem escrevem. Quem lê
-- é o servidor, com o papel de serviço.
-- ----------------------------------------------------------------------------
alter table if exists card_acquirers enable row level security;

comment on table card_acquirers is
  'Credenciadoras de cartão (Rede, Cielo, Stone...). O CNPJ daqui vai em '
  'pag/detPag/card/CNPJ da NF-e — sem ele a SEFAZ rejeita com o código 225 '
  '(fase BV).';
