#!/usr/bin/env node
// O CST decide QUAIS campos a nota carrega — não é um rótulo.
//
// O QUE ESTE TESTE EXISTE PARA PEGAR
// ----------------------------------
// Até 14/08/2026 o payload mandava base, alíquota e valor de ICMS para
// QUALQUER CST. Numa isenta (40) isso é declarar imposto onde não há, e a
// SEFAZ recusa. Não tinha explodido porque a única regra cadastrada usava
// CST 00, onde os três são mesmo obrigatórios — apareceria na primeira
// isenção que alguém cadastrasse.
//
// A armadilha do meio: "isenta ou não tributada E COM ST" (CST 30) começa com
// a palavra isenta e NÃO tem ICMS próprio, mas TEM substituição tributária.
// Tratar os dois lados pelo nome erra os dois.
//
// A outra: CST que exige grupo que este sistema ainda não monta (diferimento,
// ST retido, monofásico) precisa ser RECUSADO. Emitir pela metade produz nota
// que passa na validação declarando o imposto errado — e isso só aparece numa
// fiscalização.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const CST = require('../public/modules/shared/cst_icms');
const { buildNfePayload } = require('../lib/nfePayloadBuilder');

const ARGS = {
  estabelecimento: { cnpj: '11222333000181', razaoSocial: 'Emitente SC Ltda', logradouro: 'Rua B', numero: '1', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000', codigoMunicipio: '4209102', inscricaoEstadual: '123456789' },
  empresa: { crt: 3 },
  destinatario: { nome: 'Cliente', documento: '12345678000199', contribuinte: true, logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000' },
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-15T10:00:00-03:00',
  ambiente: 'homologacao'
};
const montar = (regra) => buildNfePayload({
  ...ARGS,
  itens: [{
    descricao: 'Produto', codigoProduto: 'P1', ncm: '73181500', quantidade: 2, valorUnitario: 100, unidadeComercial: 'UN',
    regraFiscal: { cfop: '5102', cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3, ...regra }
  }]
}).items[0];

console.log('--- a tabela cobre os 12 CST do layout ---');
const OFICIAIS = ['00', '10', '20', '30', '40', '41', '50', '51', '60', '61', '70', '90'];
OFICIAIS.forEach((c) => check(`CST ${c} está na tabela`, Boolean(CST.situacao(c)), CST.situacao(c)?.rotulo));
check('e nada além deles', Object.keys(CST.SITUACOES).length === OFICIAIS.length, String(Object.keys(CST.SITUACOES).length));

console.log('\n--- quem tributa a operação própria ---');
// Estes levam base, alíquota e valor.
['00', '10', '20', '70', '90'].forEach((c) => check(`CST ${c} tem ICMS próprio`, CST.temIcmsProprio(c)));
// Estes NÃO. O 30 é o que engana: o nome começa com "isenta".
['30', '40', '41', '50', '60', '61'].forEach((c) => check(`CST ${c} NÃO tem ICMS próprio`, !CST.temIcmsProprio(c)));

console.log('\n--- CST isento sai com SÓ a situação tributária ---');
const camposIcms = (item) => Object.keys(item).filter((k) => k.startsWith('icms_')).sort();
['40', '41', '50', '30'].forEach((cst) => {
  const item = montar({ cstIcms: cst, aliquotaIcms: 17 });
  const campos = camposIcms(item);
  // A alíquota foi passada DE PROPÓSITO: mesmo declarada na regra, não pode
  // sair na nota. Uma regra antiga pode ter alíquota gravada de quando o campo
  // aparecia para todo CST.
  check(`CST ${cst}: nada de base/alíquota/valor`, campos.join(',') === 'icms_origem,icms_situacao_tributaria', campos.join(', '));
  check(`CST ${cst}: mas a situação tributária vai`, item.icms_situacao_tributaria === cst);
});

console.log('\n--- CST tributado continua completo ---');
const tributado = montar({ cstIcms: '00', aliquotaIcms: 17 });
check('CST 00 leva base', tributado.icms_base_calculo === 200, String(tributado.icms_base_calculo));
check('CST 00 leva alíquota', tributado.icms_aliquota === 17, String(tributado.icms_aliquota));
check('CST 00 leva valor (200 x 17%)', tributado.icms_valor === 34, String(tributado.icms_valor));

const reduzido = montar({ cstIcms: '20', aliquotaIcms: 17, reducaoBcIcms: 50 });
check('CST 20 declara a redução da base', reduzido.icms_reducao_base_calculo === 50, String(reduzido.icms_reducao_base_calculo));
check('e a base já vai reduzida (200 - 50%)', reduzido.icms_base_calculo === 100, String(reduzido.icms_base_calculo));

console.log('\n--- ST só onde o CST admite ---');
// Marcar ST numa regra de CST 00 declararia substituição numa operação que
// não tem.
const stEmCst00 = montar({ cstIcms: '00', aliquotaIcms: 17, cstIcmsSt: '60', mvaSt: 40, aliquotaIcmsSt: 17 });
check('CST 00 ignora o grupo de ST', !('icms_valor_st' in stEmCst00));
const stEmCst10 = montar({ cstIcms: '10', aliquotaIcms: 17, cstIcmsSt: '60', mvaSt: 40, aliquotaIcmsSt: 17 });
check('CST 10 monta o grupo de ST', stEmCst10.icms_valor_st > 0, String(stEmCst10.icms_valor_st));
const stEmCst30 = montar({ cstIcms: '30', cstIcmsSt: '60', mvaSt: 40, aliquotaIcmsSt: 17 });
check('CST 30 monta ST mesmo sem ICMS próprio', stEmCst30.icms_valor_st > 0, String(stEmCst30.icms_valor_st));

console.log('\n--- CST não implementado é RECUSADO, não emitido pela metade ---');
['51', '60', '61'].forEach((cst) => {
  let recusou = false;
  let mensagem = '';
  try { montar({ cstIcms: cst, aliquotaIcms: 17 }); } catch (e) { recusou = true; mensagem = e.message; }
  check(`CST ${cst} é recusado`, recusou, recusou ? '' : 'EMITIU');
  if (recusou) {
    check(`  e o erro diz o que falta`, /falta o /.test(mensagem) && /não é emitido por este sistema/.test(mensagem));
  }
});
let recusouDesconhecido = false;
try { montar({ cstIcms: '99', aliquotaIcms: 17 }); } catch (e) { recusouDesconhecido = /não existe na tabela/.test(e.message); }
check('CST inexistente também é recusado', recusouDesconhecido);

console.log('\n--- Simples Nacional segue por outro caminho ---');
// CSOSN não é CST: quem usa o Simples não passa pela tabela acima.
const simples = montar({ csosn: '102' });
check('CSOSN vai na situação tributária', simples.icms_situacao_tributaria === '102');
check('e sem base/alíquota', !('icms_base_calculo' in simples) && !('icms_aliquota' in simples));

console.log('\n--- servidor e tela leem a MESMA tabela ---');
// Se a tela tivesse a sua própria lista, um CST novo entraria num lado só: o
// formulário esconderia a alíquota e o payload a mandaria assim mesmo.
const builderSrc = ler('lib/nfePayloadBuilder.js');
const serverSrc = ler('server.js');
const dbFiscalSrc = ler('lib/db/fiscal.js');
const telaRegrasSrc = ler('public/modules/fiscal/subs/regras.js');
const telaSrc = ler('public/modules/fiscal/subs/regras.js');
const indexSrc = ler('public/index.html');
check('o builder importa o módulo compartilhado', /require\('\.\.\/public\/modules\/shared\/cst_icms'\)/.test(builderSrc));
check('a tela usa o mesmo módulo', /window\.MavisCstIcms/.test(telaSrc));
check('e ele é carregado no index', /shared\/cst_icms\.js/.test(indexSrc));
check('antes da tela de regras', indexSrc.indexOf('shared/cst_icms.js') < indexSrc.indexOf('fiscal/subs/regras.js'));
// O módulo precisa funcionar nos dois mundos.
const cstSrc = ler('public/modules/shared/cst_icms.js');
check('exporta para o Node', /module\.exports = api/.test(cstSrc));
check('e para o navegador', /raiz\.MavisCstIcms = api/.test(cstSrc));

console.log('\n--- a tela esconde o que não se aplica ---');
check('a linha de ICMS próprio é marcada', /data-icms-proprio/.test(telaSrc));
check('a redução da BC é marcada à parte', /data-icms-reducao/.test(telaSrc));
check('e some quando o CST não tributa', /linhaIcms\.hidden = !mostrarTributo/.test(telaSrc));
// Campo que desaparece sem explicação parece defeito da tela.
check('com um aviso explicando o porquê', /Não há base, alíquota nem valor de ICMS a declarar/.test(telaSrc));
check('e avisa antes de emitir quando o CST não é suportado', /a emissão vai recusar/.test(telaSrc));
check('o aviso tem estilo', /\.fiscal-aviso-cst/.test(ler('public/app.css')));
// Editar uma regra isenta tem que ABRIR sem os campos, não só depois de mexer.
check('a regra vale já na abertura do formulário', /\n\s*aplicarRegrasDoCst\(\);/.test(telaSrc));

console.log('\n--- "0" e "00" são o mesmo CST ---');
// O banco guarda char(2) e a tela pode mandar "0": sem normalizar, um CST "0"
// não casaria com "00" e cairia no caminho do desconhecido.
check('normaliza "0" para "00"', CST.normalizar('0') === '00');
check('normaliza 40 numérico', CST.normalizar(40) === '40');
check('e devolve vazio para nulo', CST.normalizar(null) === '');

console.log('\n--- só nota de VENDA gera contas a receber ---');
// Emitir não é sinônimo de vender. A geração não consultava operacaoFiscal,
// que já declarava geraFinanceiro por operação desde sempre: uma devolução com
// condição de pagamento preenchida criava recebível de dinheiro que a empresa
// não vai receber.
const geracao = serverSrc.slice(
  serverSrc.indexOf('async function gerarFinanceiroDaNfeAvulsa'),
  serverSrc.indexOf('async function aplicarRespostaFocusNaNfe'));
check('a geração consulta a operação fiscal', /operacaoFiscal\.operacao\(nfe\.tipoOperacaoFiscal\)/.test(geracao));
check('e desiste quando a operação não gera', /if \(operacao && !operacao\.geraFinanceiro\) return 0;/.test(geracao));

console.log('\n--- e o CFOP confirma ---');
// A operação é escolhida na tela; o CFOP vem da regra fiscal do item. Os dois
// podem discordar, e quem vence é o CFOP: é ele que vai no documento e é por
// ele que o contador confere.
check('classifica pelo CFOP dos itens', /cfopsDaNfeGeramFinanceiro\(nfe\)/.test(serverSrc));
check('e desiste quando o CFOP diz que não é venda', /if \(porCfop === false\) return 0;/.test(geracao));
// Rede instável não pode virar "não gera": recebível a menos some em silêncio.
check('falha ao classificar NÃO cancela a geração', /return null;[\s\S]{0,200}Falha ao classificar o CFOP/.test(serverSrc));
check('a classificação é DADO, não código', /from\('cfop'\)\.select\('codigo, gera_financeiro'\)/.test(dbFiscalSrc));
// Coluna ausente (migração não rodada) não pode ser lida como "nenhum CFOP
// gera" — isso faria todo recebível sumir em silêncio.
check('coluna ausente vira "não sei", não "não gera"', /schema cache[\s\S]{0,60}return \{\};/.test(dbFiscalSrc));

const migracaoAe = ler('banco/migrations/fase-ae-financeiro-por-cfop-e-beneficio.sql');
check('a migração cria a coluna do CFOP', /add column if not exists gera_financeiro/.test(migracaoAe));
// Padrão seguro: recebível a mais é cobrança indevida de cliente.
check('e o padrão é false', /gera_financeiro boolean not null default false/.test(migracaoAe));
check('só venda de saída é semeada como true', /set gera_financeiro = true[\s\S]{0,120}tipo = 'SAIDA'[\s\S]{0,120}ilike 'Venda%'/.test(migracaoAe));

console.log('\n--- a FK da parcela sai, e a checagem vai para o código ---');
// A FK da fase-n apontava para `nfes` (manual, id TEXTO). A fase-aa tornou
// `nfe` (fiscal, id UUID) a nota do sistema, e a FK ficou para trás: toda
// parcela era recusada. Repontar o Postgres RECUSA — "incompatible types: text
// and uuid" — e converter a coluna quebraria o caminho legado, que continua
// vivo e grava id texto. Uma FK só sabe apontar para UMA tabela.
check('a constraint é derrubada', /drop constraint if exists financial_entries_nfe_id_fkey/.test(migracaoAe));
check('e NÃO é recriada', !/add constraint\s+financial_entries_nfe_id_fkey/.test(migracaoAe));
// Perder integridade em silêncio seria pior do que perder integridade.
check('a migração explica por que não dá para ter FK', /incompatible types: text and uuid/.test(migracaoAe));
check('e a coluna fica comentada no banco', /comment on column financial_entries\.nfe_id/.test(migracaoAe));
// O que o banco não garante mais, o código garante.
check('o código confere que a nota existe antes de criar parcela', /const existe = await fiscalDb\.getNfeById\(nfe\.id\)/.test(geracao));
check('e não cria quando não encontra', /parcela NÃO criada/.test(geracao));

console.log('\n--- nota isenta leva o código de benefício fiscal ---');
// Medido em homologação, 15/08/2026, em duas emissões seguidas:
//
//   sem cBenef  -> 930  CST com beneficio fiscal e nao informado o codigo
//                       de beneficio fiscal [nItem:1]
//   com SC830001-> 931  Informado codigo de beneficio fiscal incompativel
//                       com CST e UF [nItem:1]
//
// A segunda prova que o campo CHEGA e é conferido contra a tabela do estado —
// "SC830001" era sondagem e não existe em SC. Este teste garante o transporte;
// o código válido é dado do contador, e nenhuma constante aqui inventa um.
const isentaComBeneficio = montar({ cstIcms: '40', codigoBeneficioFiscal: 'SC830001' });
check('manda o cBenef', isentaComBeneficio.codigo_beneficio_fiscal === 'SC830001', isentaComBeneficio.codigo_beneficio_fiscal);
check('e segue sem alíquota', !('icms_aliquota' in isentaComBeneficio));
const isentaSemBeneficio = montar({ cstIcms: '40' });
check('sem benefício declarado, não inventa código', !('codigo_beneficio_fiscal' in isentaSemBeneficio));

const desonerada = montar({ cstIcms: '40', codigoBeneficioFiscal: 'SC830001', icmsMotivoDesoneracao: '9', aliquotaIcms: 17 });
check('desoneração leva o motivo', desonerada.icms_motivo_desoneracao === '9');
check('e o valor que deixou de ser cobrado (200 x 17%)', desonerada.icms_valor_desonerado === 34, String(desonerada.icms_valor_desonerado));
// Sem motivo, mandar só o valor faz a SEFAZ cobrar o par.
check('sem motivo, não manda valor desonerado', !('icms_valor_desonerado' in isentaComBeneficio));

console.log('\n--- a tela pede o benefício onde a alíquota some ---');
check('a linha do benefício existe', /data-icms-beneficio/.test(telaRegrasSrc));
// Quem preenche precisa saber que errar o código NÃO passa despercebido.
check('a tela diz de onde vem o código e o que acontece se errar', /SEF\/SC[\s\S]{0,140}931/.test(telaRegrasSrc));
check('e é o espelho da linha de alíquota', /linhaBeneficio\.hidden = mostrarTributo/.test(telaRegrasSrc));
check('os campos novos são enviados no submit', /'codigoBeneficioFiscal', 'icmsMotivoDesoneracao'/.test(telaRegrasSrc));
check('o banco lê os dois', /codigoBeneficioFiscal: row\.codigo_beneficio_fiscal/.test(dbFiscalSrc) && /icmsMotivoDesoneracao: row\.icms_motivo_desoneracao/.test(dbFiscalSrc));
check('e grava os dois', /codigo_beneficio_fiscal: textoOuNulo/.test(dbFiscalSrc) && /icms_motivo_desoneracao: textoOuNulo/.test(dbFiscalSrc));



console.log('\n--- alíquota de ICMS pode ser informada POR ITEM ---');
// A regra fiscal dá o padrão; o item vence quando o produto tem tributação
// própria. O motor já fazia isso, mas a tela de emissão não mandava o campo —
// a capacidade existia e não dava para usar.
const doisItens = buildNfePayload({
  ...ARGS,
  itens: [
    { descricao: 'Padrão da regra', codigoProduto: 'A', ncm: '73181500', quantidade: 1, valorUnitario: 100, unidadeComercial: 'UN',
      regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 17, cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 } },
    { descricao: 'Alíquota própria', codigoProduto: 'B', ncm: '84713012', quantidade: 1, valorUnitario: 100, unidadeComercial: 'UN', aliquotaIcms: 12,
      regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 17, cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 } }
  ]
}).items;
check('o primeiro item usa a alíquota da regra', doisItens[0].icms_aliquota === 17, String(doisItens[0].icms_aliquota));
check('o segundo usa a dele', doisItens[1].icms_aliquota === 12, String(doisItens[1].icms_aliquota));
check('e o valor sai de base x % (100 x 12%)', doisItens[1].icms_valor === 12, String(doisItens[1].icms_valor));

const telaEmissaoSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a tela de emissão tem a coluna ICMS %', /data-field="aliquotaIcms"/.test(telaEmissaoSrc));
check('e envia o campo no payload', /aliquotaIcms: Number\(item\.aliquotaIcms\)/.test(telaEmissaoSrc));
// Mandar 0 para "não informado" faria o servidor emitir sem ICMS.
check('campo vazio NÃO vira zero', /trim\(\) === '' \? \{\} :/.test(telaEmissaoSrc));


console.log('\n--- o cBenef também é digitado POR ITEM ---');
// Mesma lógica da alíquota: o benefício varia por mercadoria e muda por ato
// normativo. Não existe lista para escolher — uma lista nossa nasceria
// desatualizada, e o código é da tabela da UF.
const isentasVariadas = buildNfePayload({
  ...ARGS,
  itens: [
    { descricao: 'Benefício da regra', codigoProduto: 'A', ncm: '49019900', quantidade: 1, valorUnitario: 40, unidadeComercial: 'UN',
      regraFiscal: { cfop: '5102', cstIcms: '40', codigoBeneficioFiscal: 'SC000001', cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 } },
    { descricao: 'Benefício próprio', codigoProduto: 'B', ncm: '49019900', quantidade: 1, valorUnitario: 40, unidadeComercial: 'UN', codigoBeneficioFiscal: 'SC000002',
      regraFiscal: { cfop: '5102', cstIcms: '40', codigoBeneficioFiscal: 'SC000001', cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 } },
    // Regra SEM benefício e item COM: é este caso que prova a passagem, porque
    // o código só pode ter vindo do item.
    { descricao: 'Só o item declara', codigoProduto: 'C', ncm: '49019900', quantidade: 1, valorUnitario: 40, unidadeComercial: 'UN', codigoBeneficioFiscal: 'SC000003',
      regraFiscal: { cfop: '5102', cstIcms: '40', cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 } }
  ]
}).items;
check('sem nada digitado, vale o da regra', isentasVariadas[0].codigo_beneficio_fiscal === 'SC000001', isentasVariadas[0].codigo_beneficio_fiscal);
check('digitado no item vence o da regra', isentasVariadas[1].codigo_beneficio_fiscal === 'SC000002', isentasVariadas[1].codigo_beneficio_fiscal);
check('e o item sozinho basta', isentasVariadas[2].codigo_beneficio_fiscal === 'SC000003', isentasVariadas[2].codigo_beneficio_fiscal);
// Espaço em volta viraria um código diferente para a SEFAZ.
const comEspaco = buildNfePayload({
  ...ARGS,
  itens: [{ descricao: 'X', codigoProduto: 'X', ncm: '49019900', quantidade: 1, valorUnitario: 40, unidadeComercial: 'UN', codigoBeneficioFiscal: '  SC000004  ',
    regraFiscal: { cfop: '5102', cstIcms: '40', cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 } }]
}).items[0];
check('e vai sem espaço em volta', comEspaco.codigo_beneficio_fiscal === 'SC000004', JSON.stringify(comEspaco.codigo_beneficio_fiscal));

check('a tela de emissão tem a coluna cBenef', /data-field="codigoBeneficioFiscal"/.test(telaEmissaoSrc));
check('com cabeçalho na tabela', /<th[^>]*>cBenef<\/th>/.test(telaEmissaoSrc));
check('e envia o campo no payload', /codigoBeneficioFiscal: String\(item\.codigoBeneficioFiscal\)\.trim\(\)/.test(telaEmissaoSrc));
// String vazia enviada seria lida como "sem benefício" e apagaria o da regra.
check('em branco não é enviado', /String\(item\.codigoBeneficioFiscal \?\? ''\)\.trim\(\) === ''[\s\S]{0,40}\? \{\}/.test(telaEmissaoSrc));
check('item novo já nasce com o campo', /codigoBeneficioFiscal: ''/.test(telaEmissaoSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
