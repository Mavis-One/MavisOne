-- ============================================================================
-- FASE CS — os campos fiscais que só o PRODUTO pode responder
-- ============================================================================
--
-- O requisito VM-FIS-03 do raio-X do ViperERP pede dez campos e uma tabela
-- filha. Entram CINCO, e a razão de cada ausência está escrita no fim — a regra
-- é a mesma da fase CP: campo só entra se alguém o LÊ. Coluna que ninguém lê é
-- o defeito de `declaracao_importacao`, que está no schema desde a fase de
-- importação e não tem uma linha de código.
--
-- O CRITÉRIO: estes cinco vão para dentro da NF-e, e NENHUMA outra parte do
-- sistema tem como supri-los. Não são preferência de cadastro — são campos que
-- a SEFAZ exige e que só o produto sabe responder.
--
-- NOMES CONFERIDOS na fonte, em 23/09/2026, contra
-- campos.focusnfe.com.br/nfe/NotaFiscalXML.html:
--
--   coluna aqui            campo JSON da Focus       tag XML    tipo
--   cst_ipi                ipi_situacao_tributaria   CST        (já usado)
--   aliquota_ipi           ipi_aliquota              pIPI       (já usado)
--   codigo_ex_tipi         codigo_ex_tipi            EXTIPI     Integer[2-3]
--   escala_relevante       escala_relevante          indEscala  Boolean
--   cnpj_fabricante        cnpj_fabricante           CNPJFab    Integer[14]
--
-- A conferência não é zelo excessivo: a Focus DESCARTA campo desconhecido em
-- silêncio e responde sucesso. Foi assim que `indicador_ie_destinatario` passou
-- um mês sem levar o indicador a nota nenhuma, e foi assim que
-- `item_valor_total` nunca declarou o indTot do item escritural (corrigido no
-- commit anterior a esta migração). Nome errado aqui produziria nota
-- incompleta sem nenhum erro em lugar nenhum.
--
-- ----------------------------------------------------------------------------
-- IPI NO PRODUTO, E POR QUE ELE GANHA DA REGRA
-- ----------------------------------------------------------------------------
-- `regra_fiscal` já tem `cst_ipi` e `aliquota_ipi`, e a emissão os usa. O
-- problema é de natureza: o IPI segue a classificação do produto na TIPI, que é
-- do PRODUTO e não da operação. Uma regra por operação × UF não consegue
-- expressar "esta furadeira é 6,5% e aquele parafuso é 0%" sem uma regra por
-- NCM — exatamente o problema que a fase CP resolveu para o ICMS.
--
-- Então o produto, quando declara CST de IPI, VENCE a regra. A regra continua
-- servindo de padrão para quem não declarou, e é o que mantém as notas de hoje
-- saindo iguais: enquanto nenhum produto tiver `cst_ipi`, nada muda.
--
-- Isto importa em especial aqui: o emitente é IMPORTADORA, e importadora é
-- equiparada a industrial (RIPI art. 9º) — contribuinte de IPI na revenda.
-- ----------------------------------------------------------------------------
alter table products add column if not exists cst_ipi char(2);
alter table products add column if not exists aliquota_ipi numeric(5,2);

comment on column products.cst_ipi is
  'Fase CS — CST do IPI deste produto (tabela da TIPI). Quando preenchido, VENCE o cst_ipi da regra fiscal: IPI é classificação do produto, não da operação. NULL = usa a regra.';
comment on column products.aliquota_ipi is
  'Fase CS — alíquota de IPI do produto, em %. Só é usada quando cst_ipi está preenchido.';

-- ----------------------------------------------------------------------------
-- EX TIPI
--
-- Nada além do produto pode informá-lo: é o número da exceção dentro da posição
-- da TIPI. Integer[2-3] na Focus, guardado como texto de até 3 dígitos porque
-- "01" e "1" são exceções diferentes e um integer comeria o zero à esquerda.
-- ----------------------------------------------------------------------------
alter table products add column if not exists codigo_ex_tipi varchar(3);

alter table products drop constraint if exists products_codigo_ex_tipi_check;
alter table products add constraint products_codigo_ex_tipi_check
  check (codigo_ex_tipi is null or codigo_ex_tipi ~ '^[0-9]{2,3}$');

comment on column products.codigo_ex_tipi is
  'Fase CS — código EX TIPI (tag EXTIPI). Texto e não integer: "01" e "1" são exceções distintas, e integer perderia o zero à esquerda.';

-- ----------------------------------------------------------------------------
-- ESCALA RELEVANTE E CNPJ DO FABRICANTE (Convênio ICMS 52/2017, cláusula 23)
--
-- DUAS DECISÕES DE DESENHO, e as duas evitam um defeito silencioso:
--
-- 1. A COLUNA É `escala_relevante`, NÃO `escala_nao_relevante`. O VM-FIS-03
--    pede o segundo nome, e o Viper rotula o campo como "Produzido em Escala
--    Não Relevante" — mas o campo da Focus é `escala_relevante` (Boolean), e
--    guardar o inverso obrigaria a negar o valor no meio do caminho. Negação
--    dupla entre banco e payload é a forma mais fácil de emitir a nota inteira
--    com a informação trocada, e ninguém perceber. A TELA continua perguntando
--    "escala não relevante", que é o que o operador conhece; a inversão fica em
--    UM lugar só, no formulário, à vista.
--
-- 2. A COLUNA É NULA POR PADRÃO, e não `not null default true`. Se fosse
--    booleano obrigatório, os 5.475 produtos passariam a DECLARAR indEscala na
--    primeira emissão — uma afirmação que hoje não existe em nota nenhuma. O
--    indicador só se aplica a produto sujeito a ele; NULL significa "não
--    declarado", e o payload simplesmente não manda o campo.
--
-- O CNPJ do fabricante é exigido quando a escala NÃO é relevante. A conferência
-- fica na emissão, junto das outras (ver conferirEscalaDosItens), e não como
-- CHECK: a regra é da NOTA, e um CHECK impediria salvar o cadastro pela metade
-- enquanto alguém busca o CNPJ do fabricante.
-- ----------------------------------------------------------------------------
alter table products add column if not exists escala_relevante boolean;
alter table products add column if not exists cnpj_fabricante char(14);

alter table products drop constraint if exists products_cnpj_fabricante_check;
alter table products add constraint products_cnpj_fabricante_check
  check (cnpj_fabricante is null or cnpj_fabricante ~ '^[0-9]{14}$');

comment on column products.escala_relevante is
  'Fase CS — indEscala (Convênio ICMS 52/2017). true = escala relevante, false = NÃO relevante (e aí o CNPJ do fabricante é exigido na nota), NULL = não declarado, e o payload omite o campo.';
comment on column products.cnpj_fabricante is
  'Fase CS — CNPJFab. Exigido quando escala_relevante = false. Só dígitos.';

-- Índice para a conferência "quais produtos estão com escala não relevante e
-- sem CNPJ do fabricante", que é a pendência que trava uma emissão.
create index if not exists idx_products_escala_sem_fabricante
  on products (escala_relevante)
  where escala_relevante = false and cnpj_fabricante is null;

-- ============================================================================
-- O QUE O VM-FIS-03 PEDE E NÃO ENTRA NESTA FASE — com o motivo
-- ============================================================================
--
-- `is_cst`, `is_classe_trib`, `is_aliquota` (IMPOSTO SELETIVO)
--   O payload da NF-e deste sistema não monta grupo de IS, e a Focus não
--   documenta os campos dele na referência conferida hoje. Some-se a isso o
--   que lib/calcularTributos.js já registra na lista NAO_APURADOS: o Imposto
--   Seletivo "ainda não tem regulamentação aplicável". Três colunas que ninguém
--   preenche e nada lê seriam schema morto — e schema morto convida alguém a
--   preencher a mão e a acreditar que está indo para a nota.
--
-- `produto_credito_presumido` (uf, codigo, percentual, valor)
--   Crédito presumido é benefício de ICMS concedido pelo estado (em SC, por
--   TTD). Ele muda o CÁLCULO do ICMS, e não há cálculo de crédito presumido em
--   lugar nenhum do sistema. A tabela sem a conta seria a mesma história de
--   `declaracao_importacao`. Quando a conta existir, a tabela entra com ela.
--
-- `cfop_padrao` no produto
--   Este é o único que fica fora por ser ATIVAMENTE ERRADO, e não por falta de
--   leitor. O primeiro dígito do CFOP é o escopo do destino: 5 interna, 6
--   interestadual, 7 exterior. Um CFOP fixo no produto não pode estar certo nas
--   três, e deixá-lo sobrepor a regra — que sabe a UF de destino — produziria
--   nota com CFOP da faixa errada. O próprio Viper tem um parâmetro chamado
--   "ignorar CFOP padrão do produto", o que diz que eles também descobriram
--   isso. O CFOP continua vindo de `regra_fiscal`, que casa por operação, UF e
--   agora por grupo tributário.
--
-- `codigo_beneficio_fiscal` (cBenef) no produto
--   Já existe em `regra_fiscal` (fase AE), que é onde ele pertence: o cBenef é
--   da tabela DA UF e vale para um par CST × UF, não para o produto. Uma cópia
--   no produto divergiria da regra no primeiro benefício que mudasse, e as duas
--   pareceriam válidas.
-- ============================================================================
