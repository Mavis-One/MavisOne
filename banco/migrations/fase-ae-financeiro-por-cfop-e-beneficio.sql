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
