// OS CAMPOS FISCAIS QUE SÓ O PRODUTO RESPONDE (fase CS) — sem banco e sem rede.
//
// O requisito VM-FIS-03 do raio-X do ViperERP pedia dez campos e uma tabela
// filha. Entraram CINCO, pela regra da fase CP: campo só entra se alguém o LÊ.
// As cinco ausências têm motivo escrito na migração, e a última seção deste
// teste confere que os motivos continuam lá — porque a tentação de "completar o
// requisito" é o que produz schema morto.
//
// O CRITÉRIO DOS CINCO: vão para dentro da NF-e, e nenhuma outra parte do
// sistema tem como supri-los.
//
//   cst_ipi + aliquota_ipi   o IPI segue a TIPI, que é do PRODUTO e não da
//                            operação. Uma regra por operação × UF não diz
//                            "esta furadeira é 6,5% e aquele parafuso é 0%"
//                            sem uma regra por NCM — o problema que a fase CP
//                            resolveu para o ICMS;
//   codigo_ex_tipi           número da exceção dentro da posição da TIPI;
//   escala_relevante         indEscala, Convênio ICMS 52/2017;
//   cnpj_fabricante          CNPJFab, exigido quando a escala NÃO é relevante.
//
// OS TRÊS DEFEITOS QUE ESTE TESTE EXISTE PARA IMPEDIR:
//
//   1. NOME DE CAMPO ERRADO no payload. A Focus DESCARTA campo desconhecido em
//      silêncio e responde sucesso. Foi assim que `indicador_ie_destinatario`
//      passou um mês sem levar o indicador a nota nenhuma, e assim que
//      `item_valor_total` nunca declarou o indTot do item escritural. Os nomes
//      daqui foram conferidos em 23/09/2026 contra
//      campos.focusnfe.com.br/nfe/NotaFiscalXML.html;
//
//   2. NEGAÇÃO DUPLA na escala. A coluna guarda `escala_relevante` (o nome da
//      Focus) e a tela pergunta "escala NÃO relevante" (o rótulo que o operador
//      conhece). A inversão existe em UM lugar, no formulário. Espalhá-la faria
//      a nota sair com a informação trocada sem nada falhar;
//
//   3. O TERCEIRO ESTADO. `escala_relevante` é NULO por padrão. Booleano
//      obrigatório faria os 5.475 produtos passarem a DECLARAR indEscala na
//      primeira emissão — uma afirmação que hoje não existe em nota nenhuma.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

const { buildNfeItemPayload, conferirEscalaDosItens } = require(path.join(RAIZ, 'lib/nfePayloadBuilder'));
const migracao = ler('banco/migrations/fase-cs-fiscal-do-produto.sql');
const estoqueDb = ler('lib/db/estoque.js');
const stockCore = ler('lib/stock-core.js');
const serverSrc = ler('server.js');
const formulario = ler('public/modules/stock/subs/new_product.js');

const REGRA = {
  cfop: '5102', cstIcms: '00', modalidadeBcIcms: 3, aliquotaIcms: 17,
  cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3,
  cstIpi: '99', aliquotaIpi: 0, codigoEnquadramentoIpi: '999'
};
const itemBase = {
  descricao: 'Furadeira', quantidade: 2, valorUnitario: 200, ncm: '84672100',
  origem: 1, unidadeComercial: 'UN', regraFiscal: REGRA
};
const montar = (extra) => buildNfeItemPayload({ ...itemBase, ...extra }, 0);

console.log('\n--- 1. os nomes do payload são os da Focus ---');
const completo = montar({
  cstIpi: '50', aliquotaIpi: 6.5, codigoExTipi: '01',
  escalaRelevante: false, cnpjFabricante: '12345678000195'
});
check('codigo_ex_tipi (tag EXTIPI)', completo.codigo_ex_tipi === '01', String(completo.codigo_ex_tipi));
check('escala_relevante (tag indEscala)', completo.escala_relevante === false, String(completo.escala_relevante));
check('cnpj_fabricante (tag CNPJFab)', completo.cnpj_fabricante === '12345678000195', completo.cnpj_fabricante);
// Os nomes que NÃO existem e que seriam o palpite natural de quem não conferiu.
check('e NÃO usa nomes inventados',
  !('ex_tipi' in completo) && !('extipi' in completo)
  && !('escala_nao_relevante' in completo) && !('ind_escala' in completo)
  && !('cnpj_fab' in completo),
  'a Focus descarta nome desconhecido em silêncio');
check('o fonte registra onde os nomes foram conferidos',
  /campos\.focusnfe\.com\.br\/nfe\/NotaFiscalXML\.html/.test(ler('lib/nfePayloadBuilder.js')));

console.log('\n--- 2. o IPI do produto vence a regra ---');
check('CST do produto (50), não o da regra (99)', completo.ipi_situacao_tributaria === '50', completo.ipi_situacao_tributaria);
check('alíquota do produto (6,5), não a da regra (0)', completo.ipi_aliquota === 6.5, String(completo.ipi_aliquota));
check('e o valor acompanha', completo.ipi_valor === 26, String(completo.ipi_valor));
// O ponto: CST de um lado e alíquota do outro produziria uma combinação que
// ninguém cadastrou.
const soCst = montar({ cstIpi: '50' });
check('produto com CST e SEM alíquota cai na alíquota da REGRA, não em zero',
  soCst.ipi_aliquota === 0 && soCst.ipi_situacao_tributaria === '50',
  `CST ${soCst.ipi_situacao_tributaria}, alíquota ${soCst.ipi_aliquota}`);
// Alíquota 0 é legítima (CST de imune/isento) e não pode ser lida como vazio.
const zeroLegitimo = montar({ cstIpi: '53', aliquotaIpi: 0 });
check('alíquota 0 declarada pelo produto é respeitada',
  zeroLegitimo.ipi_aliquota === 0 && zeroLegitimo.ipi_situacao_tributaria === '53');

console.log('\n--- 3. produto que não declara nada: NADA MUDA ---');
// É a garantia de que esta fase não altera nenhuma nota enquanto ninguém
// cadastrar os campos novos. Sem ela, a fase mexeria em 5.475 produtos de uma vez.
const nada = montar({ cstIpi: '', aliquotaIpi: null, codigoExTipi: '', escalaRelevante: null, cnpjFabricante: '' });
check('IPI vem inteiro da regra', nada.ipi_situacao_tributaria === '99' && nada.ipi_aliquota === 0);
check('EX TIPI ausente do payload', !('codigo_ex_tipi' in nada));
check('indEscala OMITIDO, não afirmado',
  !('escala_relevante' in nada),
  'mandar true por padrão faria toda nota declarar algo sobre os 5.475 produtos');
check('CNPJFab ausente', !('cnpj_fabricante' in nada));

console.log('\n--- 4. o terceiro estado existe de ponta a ponta ---');
check('a coluna é nula por padrão, e o porquê está escrito',
  /alter table products add column if not exists escala_relevante boolean;/.test(migracao)
  && /NULA POR PADRÃO/.test(migracao));
check('o mapeador preserva os três estados',
  /escalaRelevante: row\.escala_relevante === null \|\| row\.escala_relevante === undefined \? null : Boolean\(row\.escala_relevante\)/.test(estoqueDb));
check('a serialização também',
  /escalaRelevante: product\.escalaRelevante \?\? null,/.test(stockCore));
check('a emissão não converte false em null',
  /escalaRelevante: produto\.escalaRelevante === undefined \? null : produto\.escalaRelevante,/.test(serverSrc),
  '`|| null` transformaria "escala NÃO relevante" em "não declarado"');
// `[^>]*>` entre o value e o rótulo: cada <option> carrega um ${...} que decide
// o `selected`, e um `.*` ganancioso não atravessa esse trecho.
check('o formulário oferece os três',
  /<option value=""[^>]*>Não declarado/.test(formulario)
  && /<option value="1"[^>]*>Sim — escala não relevante/.test(formulario)
  && /<option value="0"[^>]*>Não — escala relevante/.test(formulario));

console.log('\n--- 5. a inversão acontece em UM lugar só ---');
check('a coluna tem o nome da Focus, não o da tela',
  /escala_relevante/.test(migracao) && !/escala_nao_relevante\s+boolean/.test(migracao));
check('a tela pergunta pela negativa', /name="escalaNaoRelevante"/.test(formulario));
check('e converte no submit, com o porquê ao lado',
  /A INVERSÃO ACONTECE AQUI, e só aqui/.test(formulario)
  && /return bruto === '1' \? 'false' : 'true';/.test(formulario));

console.log('\n--- 6. escala relevante não leva fabricante ---');
const relevante = montar({ escalaRelevante: true, cnpjFabricante: '12345678000195' });
check('declara true', relevante.escala_relevante === true);
check('e omite o CNPJFab, que a SEFAZ não pede nesse caso', !('cnpj_fabricante' in relevante));

console.log('\n--- 7. a conferência prévia ---');
const semFab = montar({ escalaRelevante: false, cnpjFabricante: '' });
const msg = conferirEscalaDosItens({ items: [semFab] });
check('barra escala não relevante sem fabricante', Boolean(msg));
check('nomeia o item', /item 1 \(Furadeira\)/.test(msg), (msg || '').slice(0, 60));
check('e diz onde preencher', /Estoque -> Produtos/.test(msg));
check('não reclama do item completo', conferirEscalaDosItens({ items: [completo] }) === '');
check('nem de quem não declara escala', conferirEscalaDosItens({ items: [nada] }) === '');
check('roda na MESMA função que o pré-check e a emissão usam',
  /const escalaIncompleta = conferirEscalaDosItens\(payload\);/.test(serverSrc),
  'duas listas de conferência divergem, e o pré-check passa a mentir');

console.log('\n--- 8. as conversões de tipo ---');
check('há conjuntos separados por tipo',
  /NUMERICOS_FISCAIS/.test(estoqueDb) && /BOOLEANOS_FISCAIS/.test(estoqueDb) && /SO_DIGITOS_FISCAIS/.test(estoqueDb));
check("`Boolean('false')` seria true, então a comparação é por texto",
  /valor === true \|\| valor === 'true' \|\| valor === '1' \|\| valor === 1/.test(estoqueDb));
check('o CNPJ perde a pontuação antes do CHECK de 14 dígitos',
  /const digitos = String\(valor \?\? ''\)\.replace\(\/\\D\/g, ''\)/.test(estoqueDb));
check('EX TIPI é texto para não perder o zero à esquerda',
  /codigo_ex_tipi varchar\(3\)/.test(migracao) && /perderia o zero à esquerda/.test(migracao));
check('e o banco recusa EX TIPI não numérico',
  /codigo_ex_tipi ~ '\^\[0-9\]\{2,3\}\$'/.test(migracao));
check('e CNPJ que não tenha 14 dígitos',
  /cnpj_fabricante ~ '\^\[0-9\]\{14\}\$'/.test(migracao));

console.log('\n--- 9. o que NÃO entrou continua com motivo escrito ---');
// Sem estes checks, a próxima pessoa "completa o requisito" e o sistema ganha
// quatro colunas que ninguém lê — o defeito de `declaracao_importacao`.
check('Imposto Seletivo: fora, e por quê',
  /IMPOSTO SELETIVO/.test(migracao) && /não tem regulamentação aplicável/.test(migracao));
check('crédito presumido: fora, e por quê',
  /produto_credito_presumido/.test(migracao) && /não há cálculo de crédito presumido/.test(migracao));
check('cfop_padrao: fora por ser ATIVAMENTE errado',
  /ATIVAMENTE ERRADO/.test(migracao) && /5 interna, 6\s*\n?--\s*interestadual, 7 exterior|5 interna, 6/.test(migracao));
check('cBenef no produto: fora, porque já é da regra',
  /cBenef é\s*\n?--\s*da tabela DA UF|cBenef é/.test(migracao));
check('e nenhuma dessas colunas foi criada',
  !/add column if not exists is_cst/.test(migracao)
  && !/add column if not exists cfop_padrao/.test(migracao)
  && !/create table if not exists produto_credito_presumido/.test(migracao));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
