-- ============================================================================
-- FASE DX — AS NF-e DO SISTEMA ANTERIOR (VIPER) DENTRO DO MAVISONE
-- ============================================================================
--
-- Pedido do usuário (11/10/2026): importar a relação de NF-e do Viper para o
-- histórico do MavisONE ficar igual ao do sistema anterior. Duas planilhas:
--
--   detalhada (só a MATRIZ) — chave, protocolo, totais, itens e impostos de
--     2.661 notas, e 1.104 entradas de fornecedor SEM chave nem itens;
--   listagem (todas as empresas) — número, data, participante, valor e
--     status, sem chave, sem série e sem itens.
--
-- ORIGEM NOVA, 'IMPORTACAO'
-- -------------------------
-- Não é 'MANUAL': nota manual gera contas a receber pelas parcelas, e uma nota
-- de 2024 importada viraria cobrança. Não é 'EMISSAO': não há linha em `nfe`
-- (a nota não saiu pela Focus). É um documento que existiu fora daqui e entra
-- como registro — sem financeiro, sem estoque, sem ação na SEFAZ.
--
-- ESCRITURAR
-- ----------
-- Só entra no SPED o documento importado COMPLETO (chave + itens). A nota da
-- listagem não tem chave nem itens, e o C100 de NF-e exige a chave: escriturá-
-- la produziria um arquivo que o PVA recusa. Ela entra como histórico
-- (`escriturar = false`): aparece nas consultas e nos relatórios, fica fora do
-- arquivo. Default true: tudo o que já existia continua escriturado.
--
-- Os campos de importação dizem de onde a linha veio, para conferir e para
-- reimportar sem duplicar (a trava continua sendo a chave, ou a numeração).
-- ============================================================================

alter table fiscal_documentos drop constraint if exists fiscal_documentos_origem_check;
alter table fiscal_documentos add constraint fiscal_documentos_origem_check
  check (origem in ('EMISSAO', 'MANUAL', 'ENTRADA_XML', 'DFE', 'IMPORTACAO'));

alter table fiscal_documentos drop constraint if exists fiscal_documentos_ponteiro_check;
alter table fiscal_documentos add constraint fiscal_documentos_ponteiro_check
  check (
    (origem = 'EMISSAO'     and nfe_id is not null     and nfe_entrada_id is null)
    or (origem = 'ENTRADA_XML' and nfe_entrada_id is not null and nfe_id is null)
    or (origem in ('MANUAL', 'DFE', 'IMPORTACAO') and nfe_id is null and nfe_entrada_id is null)
  );

alter table fiscal_documentos add column if not exists escriturar boolean not null default true;
alter table fiscal_documentos add column if not exists protocolo text;
-- Nome do lote ("viper-2026-10-11") e o id do documento no sistema de origem.
alter table fiscal_documentos add column if not exists importacao_lote text;
alter table fiscal_documentos add column if not exists importacao_ref text;

-- A TRAVA DE NUMERAÇÃO SEM CHAVE PASSA A SER POR ESTABELECIMENTO.
--
-- A da fase DK olhava empresa + sentido + modelo + série + número +
-- participante. Mas a numeração da NF-e é POR CNPJ, e matriz e filiais são a
-- mesma empresa: a importação achou 9 notas reais recusadas como "repetidas" —
-- Marcolla nº 2 e São Bento nº 2, as duas para a Electric, por exemplo. Com o
-- estabelecimento na chave do índice, duas filiais podem ter o mesmo número,
-- como na SEFAZ; dentro do mesmo CNPJ a trava continua igual.
drop index if exists idx_fiscal_documentos_numeracao;
create unique index if not exists idx_fiscal_documentos_numeracao
  on fiscal_documentos (coalesce(empresa_id::text, ''), coalesce(estabelecimento_id::text, ''), sentido, emissao_propria, modelo, coalesce(serie, ''), numero, coalesce(participante_id, ''))
  where chave_acesso is null;

create index if not exists idx_fiscal_documentos_importacao
  on fiscal_documentos (importacao_lote) where origem = 'IMPORTACAO';
