#!/usr/bin/env node
// A APURAÇÃO DO ICMS: C190 e E110.
//
// POR QUE ESTE TESTE É O ÚNICO JEITO DE CONFERIR ISTO HOJE. `fiscal_documentos`
// tem ZERO linhas (medido em 30/09/2026): não há nota emitida neste sistema.
// Uma conta fiscal que só se confere quando houver movimento é uma conta que
// ninguém confere — e quando houver movimento, quem descobre o erro é a SEFAZ.
// lib/sped-apuracao.js é função pura justamente para poder ser conferida agora,
// com objetos.
//
// O QUE ELE PROTEGE, em ordem de estrago:
//
//   1. A INVERSÃO DO CFOP 5605/1605. É saída que entra no crédito e entrada
//      que entra no débito. A regra ingênua ("5/6/7 é débito") erra nos dois e
//      o arquivo fecha igual — o erro só aparece em fiscalização.
//   2. DOCUMENTO EXTEMPORÂNEO fora do débito e do crédito, dentro do DEB_ESP.
//   3. A ARITMÉTICA DOS CAMPOS 11, 13 e 14, incluindo a faixa em que as duas
//      regras do Guia discordam.
//   4. O ZERO ASSUMIDO NÃO PODE SE PASSAR POR ZERO SABIDO. Saldo credor
//      anterior ausente e saldo credor anterior igual a zero dão o mesmo
//      número e significam coisas diferentes.
//   5. OS NOMES DOS CAMPOS, conferidos contra lib/sped-leiaute.js — não contra
//      uma lista digitada aqui.
const ap = require('../lib/sped-apuracao');
const leiaute = require('../lib/sped-leiaute');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const item = (extra) => ({
  cfop: '5102', cstIcms: '00', aliquotaIcms: 17,
  valorOperacao: 100, baseIcms: 100, valorIcms: 17,
  baseIcmsSt: 0, valorIcmsSt: 0, reducaoBase: 0, valorIpi: 0, ...extra
});

console.log('--- 1. C190: uma linha por CST × CFOP × alíquota ---');
const tresItens = [
  item({}),
  item({ valorOperacao: 50, baseIcms: 50, valorIcms: 8.5 }),
  item({ cfop: '5405', cstIcms: '60', aliquotaIcms: 0, valorIcms: 0, baseIcms: 0 })
];
const linhas = ap.linhasC190(tresItens);
check('duas combinações distintas dão duas linhas', linhas.length === 2, linhas.length);
const l5102 = linhas.find((l) => l.CFOP === '5102');
check('e os valores da combinação repetida somam',
  l5102.VL_OPR === 150 && l5102.VL_BC_ICMS === 150 && l5102.VL_ICMS === 25.5,
  `${l5102.VL_OPR} / ${l5102.VL_BC_ICMS} / ${l5102.VL_ICMS}`);

// A validação do Guia: *"não podem ser informados dois ou mais registros com a
// mesma combinação de valores dos campos CST_ICMS, CFOP e ALIQ_ICMS"*. 17,
// "17,00" e 17.0 são a MESMA alíquota — se cada grafia fizesse a sua linha, o
// registro sairia inválido e a causa seria um espaço a mais numa planilha.
const grafias = ap.linhasC190([
  item({ aliquotaIcms: 17 }), item({ aliquotaIcms: '17,00' }),
  item({ aliquotaIcms: 17.0 }), item({ aliquotaIcms: '17.0000' })
]);
check('quatro grafias da mesma alíquota dão UMA linha', grafias.length === 1, grafias.length);
check('  e o total é a soma das quatro', grafias[0].VL_ICMS === 68, grafias[0].VL_ICMS);

const combinacoes = new Set(linhas.map((l) => `${l.CST_ICMS}|${l.CFOP}|${l.ALIQ_ICMS}`));
check('nenhuma combinação se repete na saída', combinacoes.size === linhas.length);

// COD_OBS é campo do registro (o 12), então entra na chave: duas linhas iguais
// em CST/CFOP/alíquota e diferentes em observação são duas linhas de verdade.
// Fundi-las perderia a ligação com o registro 0460.
const comObs = ap.linhasC190([
  item({ codigoObservacao: 'OBS1' }), item({ codigoObservacao: 'OBS2' }), item({ codigoObservacao: 'OBS1' })
]);
check('a observação separa linhas de mesma tributação', comObs.length === 2, comObs.length);

// CADA PARTE DA CHAVE, ISOLADA. Os três itens do começo diferem em CFOP, CST e
// alíquota ao mesmo tempo, então continuavam dando duas linhas mesmo com o
// CFOP fora da chave — a mutação passava. Aqui cada par difere em UMA coisa só.
check('só o CFOP diferente já separa',
  ap.linhasC190([item({ cfop: '5102' }), item({ cfop: '6102' })]).length === 2);
check('só o CST diferente já separa',
  ap.linhasC190([item({ cstIcms: '00' }), item({ cstIcms: '20' })]).length === 2);
check('só a alíquota diferente já separa',
  ap.linhasC190([item({ aliquotaIcms: 17 }), item({ aliquotaIcms: 12 })]).length === 2);
check('  e sem observação o campo sai nulo, não vazio',
  ap.linhasC190([item({})])[0].COD_OBS === null);

// DINHEIRO NÃO PODE ACUMULAR RESÍDUO BINÁRIO: 0,1 + 0,2 em ponto flutuante dá
// 0,30000000000000004, e a coluna da EFD tem duas casas. Um centavo de sobra
// num total faz o C190 não fechar com o C100.
const centavos = ap.linhasC190([item({ valorIcms: 0.1 }), item({ valorIcms: 0.2 })]);
check('os totais saem arredondados em duas casas',
  centavos[0].VL_ICMS === 0.3, String(centavos[0].VL_ICMS));

// Ordem estável: duas gerações do mesmo mês têm de dar o mesmo arquivo, senão
// não dá para comparar o que mudou entre duas escriturações.
const embaralhado = ap.linhasC190([tresItens[2], tresItens[1], tresItens[0]]);
check('a ordem da saída não depende da ordem da entrada',
  JSON.stringify(embaralhado) === JSON.stringify(linhas));

console.log('\n--- 2. os nomes dos campos saem do leiaute, não daqui ---');
// DERIVADO: as chaves de uma linha de C190 têm de ser exatamente os campos do
// C190 no Guia, menos o REG (que o serializador escreve). Isto pegaria o nome
// truncado "VL_BC_ICMS_" que o leiaute tinha antes de 30/09/2026.
const camposC190 = leiaute.camposDe('C190').map((c) => c.nome).filter((n) => n !== 'REG');
const chavesC190 = Object.keys(linhas[0]);
const faltandoC190 = camposC190.filter((n) => !chavesC190.includes(n));
const sobrandoC190 = chavesC190.filter((n) => !camposC190.includes(n));
check('a linha de C190 tem todos os campos do leiaute',
  faltandoC190.length === 0, faltandoC190.join(', ') || `${camposC190.length} campos`);
check('  e nenhum campo a mais', sobrandoC190.length === 0, sobrandoC190.join(', ') || 'nenhum');

const camposE110 = leiaute.camposDe('E110').map((c) => c.nome);
const chavesE110 = Object.keys(ap.apuracaoE110([], { saldoCredorAnterior: 0, deducoes: 0 }).campos);
check('o E110 tem os 15 campos do leiaute, na ordem',
  JSON.stringify(chavesE110) === JSON.stringify(camposE110),
  chavesE110.length + ' campos');

console.log('\n--- 3. a inversão do CFOP 5605 / 1605 ---');
const comTransferencia = [
  { sentido: 'SAIDA', situacao: '00', linhas: ap.linhasC190([item({ valorIcms: 1000 })]) },
  { sentido: 'SAIDA', situacao: '00', linhas: ap.linhasC190([item({ cfop: '5605', valorIcms: 300 })]) },
  { sentido: 'ENTRADA', situacao: '00', linhas: ap.linhasC190([item({ cfop: '1102', valorIcms: 200 })]) },
  { sentido: 'ENTRADA', situacao: '00', linhas: ap.linhasC190([item({ cfop: '1605', valorIcms: 70 })]) }
];
const t = ap.totaisDoPeriodo(comTransferencia);
// Ingênuo seria débito = 1000 + 300 = 1300 e crédito = 200 + 70 = 270.
check('a saída 5605 vai para o CRÉDITO', t.creditos === 500, `créditos=${t.creditos} (200 + 300)`);
check('a entrada 1605 vai para o DÉBITO', t.debitos === 1070, `débitos=${t.debitos} (1000 + 70)`);
check('  e a regra ingênua daria outro número', t.debitos !== 1300 && t.creditos !== 270);
check('  duas linhas foram invertidas', t.linhasInvertidas === 2, t.linhasInvertidas);

console.log('\n--- 4. documento extemporâneo não é débito nem crédito ---');
// A LISTA É LITERAL AQUI, DE PROPÓSITO. A primeira versão iterava
// `ap.SITUACOES_EXTEMPORANEAS`, e aí uma mutação que apagava o '07' da
// constante passava: o teste deixava de testar o caso que a mutação removeu.
// '01' e '07' vêm do Guia (campo 15 do E110), não do código.
check('a constante do código é a do Guia: 01 e 07',
  JSON.stringify(ap.SITUACOES_EXTEMPORANEAS) === JSON.stringify(['01', '07']),
  ap.SITUACOES_EXTEMPORANEAS.join(', '));
for (const situacao of ['01', '07']) {
  const extemp = ap.totaisDoPeriodo([
    { sentido: 'SAIDA', situacao, linhas: ap.linhasC190([item({ valorIcms: 400 })]) },
    { sentido: 'SAIDA', situacao: '00', linhas: ap.linhasC190([item({ valorIcms: 100 })]) }
  ]);
  check(`COD_SIT ${situacao} sai do débito e entra no DEB_ESP`,
    extemp.debitos === 100 && extemp.debitoEspecial === 400,
    `débito=${extemp.debitos} deb_esp=${extemp.debitoEspecial}`);
}
// Entrada extemporânea também não vira crédito.
const entradaExtemp = ap.totaisDoPeriodo([
  { sentido: 'ENTRADA', situacao: '01', linhas: ap.linhasC190([item({ cfop: '1102', valorIcms: 250 })]) }
]);
check('e a entrada extemporânea também não vira crédito',
  entradaExtemp.creditos === 0 && entradaExtemp.debitoEspecial === 250,
  `crédito=${entradaExtemp.creditos} deb_esp=${entradaExtemp.debitoEspecial}`);

console.log('\n--- 5. campos 11, 13 e 14: saldo devedor, credor, e a faixa do conflito ---');
const venda = (icms) => ({ sentido: 'SAIDA', situacao: '00', linhas: ap.linhasC190([item({ valorIcms: icms })]) });
const compra = (icms) => ({ sentido: 'ENTRADA', situacao: '00', linhas: ap.linhasC190([item({ cfop: '1102', valorIcms: icms })]) });

// (a) saldo DEVEDOR, com dedução menor que o apurado.
const devedor = ap.apuracaoE110([venda(100), compra(30)], { saldoCredorAnterior: 0, deducoes: 20 });
check('saldo devedor: 11 = débitos − créditos',
  devedor.campos.VL_SLD_APURADO === 70, devedor.campos.VL_SLD_APURADO);
check('  13 = 11 − 12', devedor.campos.VL_ICMS_RECOLHER === 50, devedor.campos.VL_ICMS_RECOLHER);
check('  e 14 = 0', devedor.campos.VL_SLD_CREDOR_TRANSPORTAR === 0);

// (b) saldo CREDOR: o que sobra vai para o campo 14, não para o 11 negativo.
const credor = ap.apuracaoE110([venda(30), compra(100)], { saldoCredorAnterior: 0, deducoes: 0 });
check('saldo credor: 11 = 0 e o crédito vai para o 14',
  credor.campos.VL_SLD_APURADO === 0 && credor.campos.VL_SLD_CREDOR_TRANSPORTAR === 70,
  `11=${credor.campos.VL_SLD_APURADO} 14=${credor.campos.VL_SLD_CREDOR_TRANSPORTAR}`);
check('  e 13 nunca é negativo', credor.campos.VL_ICMS_RECOLHER === 0);

// (b2) OS SEIS AJUSTES, CADA UM COM VALOR PRÓPRIO E CADA UM DO SEU LADO.
// Nenhum teste anterior passava ajuste diferente de zero, então uma mutação que
// tirava VL_ESTORNOS_CRED da soma de débitos passava sem ser vista. Os valores
// são primos entre si para que trocar dois de lado mude o resultado.
const seisAjustes = ap.apuracaoE110([venda(1000)], {
  saldoCredorAnterior: 7,
  deducoes: 0,
  ajustes: {
    debitosDoDocumento: 100,    // campo 03, débito
    debitosDaApuracao: 200,     // campo 04, débito
    estornosDeCredito: 400,     // campo 05, débito
    creditosDoDocumento: 11,    // campo 07, crédito
    creditosDaApuracao: 13,     // campo 08, crédito
    estornosDeDebito: 17        // campo 09, crédito
  }
});
// A expressão do Guia, escrita à mão: débitos + (03 + 04) + 05
//                                  − [créditos + (07 + 08) + 09 + 10]
const esperado = (1000 + 100 + 200 + 400) - (0 + 11 + 13 + 17 + 7);
check('os seis ajustes entram cada um do seu lado',
  seisAjustes.campos.VL_SLD_APURADO === esperado,
  `${seisAjustes.campos.VL_SLD_APURADO} (esperado ${esperado})`);
check('  e cada um aparece no seu campo',
  seisAjustes.campos.VL_AJ_DEBITOS === 100 && seisAjustes.campos.VL_TOT_AJ_DEBITOS === 200
  && seisAjustes.campos.VL_ESTORNOS_CRED === 400 && seisAjustes.campos.VL_AJ_CREDITOS === 11
  && seisAjustes.campos.VL_TOT_AJ_CREDITOS === 13 && seisAjustes.campos.VL_ESTORNOS_DEB === 17);

// (c) o saldo credor ANTERIOR entra na subtração (campo 10).
const comAnterior = ap.apuracaoE110([venda(100)], { saldoCredorAnterior: 40, deducoes: 0 });
check('o saldo credor anterior reduz o apurado',
  comAnterior.campos.VL_SLD_APURADO === 60 && comAnterior.campos.VL_SLD_CREDOR_ANT === 40,
  comAnterior.campos.VL_SLD_APURADO);

// (d) A FAIXA DO CONFLITO: a expressão do 11 é positiva, mas menor que as
// deduções. A regra do campo 11 diz "então o campo 14 deve ser 0"; a regra do
// campo 14 põe as deduções na subtração e manda escrever a diferença. Vale a
// do 14, que é a específica.
const faixa = ap.apuracaoE110([venda(100)], { saldoCredorAnterior: 0, deducoes: 150 });
check('dedução maior que o apurado: 14 recebe a diferença',
  faixa.campos.VL_SLD_CREDOR_TRANSPORTAR === 50, faixa.campos.VL_SLD_CREDOR_TRANSPORTAR);
check('  o 11 continua sendo a expressão positiva', faixa.campos.VL_SLD_APURADO === 100);
check('  e o 13 para em zero em vez de ficar −50', faixa.campos.VL_ICMS_RECOLHER === 0);

// (e) A validação do campo 15: DEB_ESP + VL_ICMS_RECOLHER tem de ser igual à
// soma dos VL_OR do E116. Sem E116 não há o que conferir, mas o total que ele
// teria de somar é calculado e exposto.
const comExtemp = ap.apuracaoE110([
  venda(100), { sentido: 'SAIDA', situacao: '01', linhas: ap.linhasC190([item({ valorIcms: 25 })]) }
], { saldoCredorAnterior: 0, deducoes: 0 });
check('DEB_ESP recebe o ICMS extemporâneo', comExtemp.campos.DEB_ESP === 25, comExtemp.campos.DEB_ESP);
check('  e o total esperado no E116 é DEB_ESP + ICMS a recolher',
  comExtemp.diagnostico.totalEsperadoNoE116 === 125, comExtemp.diagnostico.totalEsperadoNoE116);

console.log('\n--- 6. zero assumido não se passa por zero sabido ---');
const semInformar = ap.apuracaoE110([venda(100)]);
check('omitir o saldo credor anterior aparece em `assumidos`',
  semInformar.assumidos.some((a) => /saldo credor do período anterior/.test(a)),
  semInformar.assumidos.length + ' assumidos');
check('  e os seis ajustes também',
  semInformar.assumidos.filter((a) => /ajuste|estorno/i.test(a)).length === 6,
  semInformar.assumidos.filter((a) => /ajuste|estorno/i.test(a)).length);
const informandoZero = ap.apuracaoE110([venda(100)], {
  saldoCredorAnterior: 0, deducoes: 0,
  ajustes: {
    debitosDoDocumento: 0, debitosDaApuracao: 0, estornosDeCredito: 0,
    creditosDoDocumento: 0, creditosDaApuracao: 0, estornosDeDebito: 0
  }
});
check('informar zero NÃO conta como assumido',
  informandoZero.assumidos.length === 0, informandoZero.assumidos.join(' | ') || 'nenhum');
check('  e o número é o mesmo nos dois casos',
  informandoZero.campos.VL_SLD_APURADO === semInformar.campos.VL_SLD_APURADO,
  'por isso a lista é a única coisa que distingue os dois');

console.log('\n--- 7. período sem movimento existe, e é zerado ---');
// O Guia, no E110: *"o registro deve ser apresentado inclusive nos casos de
// períodos sem movimento. Neste caso, os valores deverão ser apresentados
// zerados."*
const vazio = ap.apuracaoE110([], { saldoCredorAnterior: 0, deducoes: 0 });
check('sem documento nenhum, o E110 sai com os 15 campos',
  Object.keys(vazio.campos).length === 15);
check('  todos zerados, e o REG presente',
  vazio.campos.REG === 'E110'
  && Object.entries(vazio.campos).filter(([k]) => k !== 'REG').every(([, v]) => v === 0));
check('  e C190 de documento sem item é lista vazia, não uma linha de zeros',
  ap.linhasC190([]).length === 0 && ap.linhasC190(null).length === 0);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
