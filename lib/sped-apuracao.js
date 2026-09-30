/**
 * A APURAÇÃO DO ICMS DA EFD — o registro analítico C190 e o E110.
 *
 * POR QUE ISTO EXISTE, E O QUE ELE NÃO RESOLVE
 * --------------------------------------------
 * O pré-check do SPED (lib/db/sped-pre-check.js) lista dez registros da
 * escrituração de agosto de 2026 que não tinham origem nenhuma neste sistema.
 * Deles, DOIS não precisavam de cadastro novo — precisavam de conta:
 *
 *   C190  é o total dos itens do documento, agrupado por CST × CFOP × alíquota
 *   E110  é o total dos C190 do período, separado em débito e crédito
 *
 * O dado dos dois já existe desde a fase DK: `fiscal_documento_itens.cfop` e
 * `fiscal_item_tributos` (cst, base_calculo, aliquota, valor, reducao_base).
 * O que faltava era a aritmética — e a aritmética não se adivinha: ela está
 * escrita no Guia Prático, e as citações abaixo são de lá (versão 3.2.2, ver
 * lib/sped-leiaute.js).
 *
 * OS OUTROS OITO CONTINUAM SEM ORIGEM, e este arquivo não muda isso: `0100`
 * (contabilista), `0450`+`C110` (textos legais do lançamento), `E116`/`E250`
 * (as obrigações a recolher — código da receita, vencimento, número da guia:
 * é cadastro que não existe) e `E200`/`E210` (apuração do ICMS-ST por UF).
 *
 * PURO DE PROPÓSITO. Recebe linhas já lidas e devolve números. Não conhece
 * banco nem HTTP, e por isso o teste prova as regras com objetos — o que
 * importa aqui, porque HOJE NÃO HÁ NOTA NENHUMA no banco (`fiscal_documentos`
 * tem 0 linhas, medido em 30/09/2026). Uma conta fiscal que só pode ser
 * conferida quando houver movimento é uma conta que ninguém confere; com
 * função pura ela é conferida agora.
 *
 * AS TRÊS ARMADILHAS DO E110
 * --------------------------
 * 1. O CFOP 5605 É SAÍDA E ENTRA NO CRÉDITO. O Guia, no campo 02: *"estão
 *    excluídos ... os documentos fiscais com CFOP 5605 – Transferência de
 *    saldo devedor de ICMS de outro estabelecimento da mesma empresa. Devem
 *    ser incluídos os documentos fiscais com CFOP igual a 1605 - Recebimento,
 *    por transferência, de saldo devedor do ICMS"*. Ou seja: a regra ingênua
 *    "CFOP 5/6/7 é débito, 1/2/3 é crédito" erra nos dois, e erra em silêncio
 *    — o arquivo fecha, só está errado.
 *
 * 2. DOCUMENTO EXTEMPORÂNEO NÃO ENTRA NO DÉBITO: vai para DEB_ESP. COD_SIT
 *    '01' (extemporâneo) e '07' (complementar extemporâneo). O Guia, campo 15:
 *    *"Informar o correspondente ao somatório dos valores de ICMS
 *    correspondentes aos documentos fiscais extemporâneos"*.
 *
 * 3. O SALDO CREDOR DO PERÍODO ANTERIOR NÃO TEM DE ONDE SAIR. É o E110 do mês
 *    passado, e este sistema nunca gerou um. Zero aqui não é "não havia saldo",
 *    é "não sei" — e as duas coisas dão arquivos diferentes. Por isso ele é
 *    parâmetro obrigatório de quem chama, e o que for assumido volta na lista
 *    `assumidos`, para a tela poder dizer em cima de que o número foi feito.
 */

const CFOP_TRANSFERENCIA_SALDO_DEVEDOR = { saida: '5605', entrada: '1605' };

// COD_SIT 01 e 07. O valor do ICMS deles não entra em débito nem crédito:
// entra em DEB_ESP, como valor extra-apuração.
const SITUACOES_EXTEMPORANEAS = ['01', '07'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Duas casas, como as colunas numeric(15,2) do banco e o campo da EFD. */
function moeda(v) {
  return Math.round(num(v) * 100) / 100;
}

/**
 * ALÍQUOTA COMO CHAVE DE AGRUPAMENTO.
 *
 * 17, 17.0 e "17,00" são a mesma alíquota e têm de cair na mesma linha do
 * C190 — senão o registro sai com duas linhas de mesma combinação, que é
 * exatamente o que a validação do Guia proíbe: *"não podem ser informados dois
 * ou mais registros com a mesma combinação de valores dos campos CST_ICMS,
 * CFOP e ALIQ_ICMS"*.
 *
 * Quatro casas porque a coluna é numeric(9,4) — alíquota interestadual com FCP
 * chega lá.
 */
function chaveDaAliquota(v) {
  return (Math.round(num(String(v).replace(',', '.')) * 10000) / 10000).toFixed(4);
}

function texto(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * AS LINHAS DO C190 DE UM DOCUMENTO.
 *
 * Recebe os itens de UM documento e devolve as linhas analíticas dele. Um
 * documento só: o C190 é filho do C100 no arquivo, e agrupar o período inteiro
 * junto daria um analítico que não corresponde a nota nenhuma. Na escrituração
 * de agosto foram 311 documentos e 333 linhas de C190 — pouco mais de uma por
 * nota, que é o retrato de quem vende com uma tributação só.
 *
 * Cada item entra como:
 *
 *   { cfop, cstIcms, aliquotaIcms, valorOperacao, baseIcms, valorIcms,
 *     baseIcmsSt, valorIcmsSt, reducaoBase, valorIpi, codigoObservacao }
 *
 * A ordem da saída é estável (CFOP, depois CST, depois alíquota) porque duas
 * gerações do mesmo mês têm de dar o mesmo arquivo — sem isso, comparar o que
 * mudou entre duas escriturações é impossível.
 */
function linhasC190(itens) {
  const grupos = new Map();
  for (const item of (itens || [])) {
    const cfop = texto(item && item.cfop);
    const cst = texto(item && item.cstIcms);
    const aliq = chaveDaAliquota(item && item.aliquotaIcms);
    // COD_OBS entra na chave porque é campo do registro: duas linhas iguais em
    // CST/CFOP/alíquota e diferentes em observação são duas linhas de verdade.
    const obs = texto(item && item.codigoObservacao);
    const chave = `${cfop}|${cst}|${aliq}|${obs}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        CST_ICMS: cst, CFOP: cfop, ALIQ_ICMS: Number(aliq),
        VL_OPR: 0, VL_BC_ICMS: 0, VL_ICMS: 0, VL_BC_ICMS_ST: 0,
        VL_ICMS_ST: 0, VL_RED_BC: 0, VL_IPI: 0, COD_OBS: obs || null
      });
    }
    const g = grupos.get(chave);
    g.VL_OPR += num(item.valorOperacao);
    g.VL_BC_ICMS += num(item.baseIcms);
    g.VL_ICMS += num(item.valorIcms);
    g.VL_BC_ICMS_ST += num(item.baseIcmsSt);
    g.VL_ICMS_ST += num(item.valorIcmsSt);
    g.VL_RED_BC += num(item.reducaoBase);
    g.VL_IPI += num(item.valorIpi);
  }

  return [...grupos.values()]
    .map((g) => ({
      ...g,
      VL_OPR: moeda(g.VL_OPR), VL_BC_ICMS: moeda(g.VL_BC_ICMS), VL_ICMS: moeda(g.VL_ICMS),
      VL_BC_ICMS_ST: moeda(g.VL_BC_ICMS_ST), VL_ICMS_ST: moeda(g.VL_ICMS_ST),
      VL_RED_BC: moeda(g.VL_RED_BC), VL_IPI: moeda(g.VL_IPI)
    }))
    .sort((a, b) => a.CFOP.localeCompare(b.CFOP)
      || a.CST_ICMS.localeCompare(b.CST_ICMS)
      || a.ALIQ_ICMS - b.ALIQ_ICMS);
}

/**
 * DÉBITO, CRÉDITO E DÉBITO ESPECIAL do período — com as três armadilhas.
 *
 * Recebe os documentos do período, cada um com o sentido, o COD_SIT e as
 * linhas de C190 dele:
 *
 *   { sentido: 'SAIDA' | 'ENTRADA', situacao: '00', linhas: [ ...C190 ] }
 *
 * O SENTIDO NÃO DECIDE SOZINHO: o CFOP da linha pode inverter (5605/1605), e a
 * situação pode tirar a linha das duas somas (extemporâneo). É por isso que
 * isto é uma função e não um `SUM(...) GROUP BY`.
 */
function totaisDoPeriodo(documentos) {
  let debitos = 0;
  let creditos = 0;
  let debitoEspecial = 0;
  let linhasExtemporaneas = 0;
  let linhasInvertidas = 0;

  for (const doc of (documentos || [])) {
    const extemporaneo = SITUACOES_EXTEMPORANEAS.includes(texto(doc && doc.situacao));
    const entrada = texto(doc && doc.sentido).toUpperCase() === 'ENTRADA';
    for (const linha of ((doc && doc.linhas) || [])) {
      const icms = num(linha.VL_ICMS);
      const cfop = texto(linha.CFOP);

      if (extemporaneo) {
        // Fora do débito E fora do crédito: vai para DEB_ESP.
        debitoEspecial += icms;
        linhasExtemporaneas += 1;
        continue;
      }

      // A INVERSÃO. 5605 é saída e vai para o crédito; 1605 é entrada e vai
      // para o débito. Vale pelo CFOP da linha, não pelo sentido do documento.
      if (cfop === CFOP_TRANSFERENCIA_SALDO_DEVEDOR.saida) { creditos += icms; linhasInvertidas += 1; continue; }
      if (cfop === CFOP_TRANSFERENCIA_SALDO_DEVEDOR.entrada) { debitos += icms; linhasInvertidas += 1; continue; }

      if (entrada) creditos += icms;
      else debitos += icms;
    }
  }

  return {
    debitos: moeda(debitos),
    creditos: moeda(creditos),
    debitoEspecial: moeda(debitoEspecial),
    linhasExtemporaneas,
    linhasInvertidas
  };
}

/**
 * O REGISTRO E110 — os 15 campos, e o que foi assumido para chegar nele.
 *
 * A CONTA DO CAMPO 11 (VL_SLD_APURADO), citada do Guia: *"soma do total de
 * débitos (VL_TOT_DEBITOS) com total de ajustes (VL_AJ_DEBITOS +
 * VL_TOT_AJ_DEBITOS) com total de estorno de crédito (VL_ESTORNOS_CRED) menos
 * a soma do total de créditos (VL_TOT_CREDITOS) com total de ajuste de créditos
 * (VL_AJ_CREDITOS + VL_TOT_AJ_CREDITOS) com total de estorno de débito
 * (VL_ESTORNOS_DEB) com saldo credor do período anterior (VL_SLD_CREDOR_ANT)"*.
 *
 * UM CONFLITO ENTRE DUAS REGRAS DO GUIA, e a escolha está aqui porque ela é uma
 * escolha. A regra do campo 11 diz: *"Se o valor da expressão for maior ou
 * igual a 0, então este valor deve ser informado neste campo e o campo 14
 * (VL_SLD_CREDOR_TRANSPORTAR) deve ser igual a 0"*. A regra do campo 14 põe as
 * DEDUÇÕES dentro da subtração e diz: *"Se for menor que 0, o valor absoluto do
 * resultado deve ser informado neste campo"*.
 *
 * As duas discordam numa faixa: quando a expressão do 11 é positiva mas MENOR
 * que as deduções. Aí o 11 manda escrever 0 no campo 14, e o 14 manda escrever
 * a diferença. Vale a regra do 14, que é a específica — e o campo 13
 * (VL_ICMS_RECOLHER = 11 − 12) não pode ficar negativo, então ele para em zero.
 *
 * ISSO NÃO ACONTECE HOJE: sem cadastro de dedução, VL_TOT_DED é sempre 0 e a
 * faixa não existe. Está implementado e anotado para o dia em que houver.
 *
 * O QUE ENTRA COMO PARÂMETRO, e por que nenhum tem valor padrão silencioso:
 *
 *   saldoCredorAnterior  o campo 10. É o campo 14 do E110 do mês anterior, e
 *                        este sistema nunca gerou um. Omitir -> `assumidos`.
 *   ajustes              os campos 03, 04, 05, 07, 08, 09. Vêm dos registros
 *                        C197 e E111, que não existem aqui. Omitir ->
 *                        `assumidos`.
 *   deducoes             o campo 12. Idem.
 *   debitoEspecialExtra  soma ao DEB_ESP calculado dos extemporâneos: o Guia
 *                        manda somar aí também ajustes de código '70' do C197
 *                        e '05' do E111.
 */
function apuracaoE110(documentos, opcoes = {}) {
  const totais = totaisDoPeriodo(documentos);
  const assumidos = [];
  const pegar = (nome, rotulo) => {
    if (opcoes[nome] === undefined || opcoes[nome] === null) {
      assumidos.push(rotulo);
      return 0;
    }
    return num(opcoes[nome]);
  };

  const saldoCredorAnterior = pegar('saldoCredorAnterior', 'saldo credor do período anterior (campo 10)');
  const ajustes = opcoes.ajustes || {};
  const aj = (nome, rotulo) => {
    if (ajustes[nome] === undefined || ajustes[nome] === null) {
      assumidos.push(rotulo);
      return 0;
    }
    return num(ajustes[nome]);
  };

  const VL_AJ_DEBITOS = aj('debitosDoDocumento', 'ajustes a débito do documento (campo 03)');
  const VL_TOT_AJ_DEBITOS = aj('debitosDaApuracao', 'ajustes a débito da apuração (campo 04)');
  const VL_ESTORNOS_CRED = aj('estornosDeCredito', 'estornos de crédito (campo 05)');
  const VL_AJ_CREDITOS = aj('creditosDoDocumento', 'ajustes a crédito do documento (campo 07)');
  const VL_TOT_AJ_CREDITOS = aj('creditosDaApuracao', 'ajustes a crédito da apuração (campo 08)');
  const VL_ESTORNOS_DEB = aj('estornosDeDebito', 'estornos de débito (campo 09)');
  const VL_TOT_DED = pegar('deducoes', 'deduções (campo 12)');

  const DEB_ESP = moeda(totais.debitoEspecial + num(opcoes.debitoEspecialExtra));

  const somaDebitos = totais.debitos + VL_AJ_DEBITOS + VL_TOT_AJ_DEBITOS + VL_ESTORNOS_CRED;
  const somaCreditos = totais.creditos + VL_AJ_CREDITOS + VL_TOT_AJ_CREDITOS
    + VL_ESTORNOS_DEB + saldoCredorAnterior;
  const expressao = moeda(somaDebitos - somaCreditos);
  // A expressão do campo 14 é a do 11 com as deduções dentro da subtração.
  const expressaoComDeducoes = moeda(expressao - VL_TOT_DED);

  const VL_SLD_APURADO = expressao >= 0 ? expressao : 0;
  const VL_SLD_CREDOR_TRANSPORTAR = expressaoComDeducoes < 0 ? moeda(-expressaoComDeducoes) : 0;
  // 11 − 12, mas nunca negativo: o que passaria de zero já foi para o campo 14.
  const VL_ICMS_RECOLHER = moeda(Math.max(0, VL_SLD_APURADO - VL_TOT_DED));

  return {
    campos: {
      REG: 'E110',
      VL_TOT_DEBITOS: totais.debitos,
      VL_AJ_DEBITOS,
      VL_TOT_AJ_DEBITOS,
      VL_ESTORNOS_CRED,
      VL_TOT_CREDITOS: totais.creditos,
      VL_AJ_CREDITOS,
      VL_TOT_AJ_CREDITOS,
      VL_ESTORNOS_DEB,
      VL_SLD_CREDOR_ANT: moeda(saldoCredorAnterior),
      VL_SLD_APURADO,
      VL_TOT_DED,
      VL_ICMS_RECOLHER,
      VL_SLD_CREDOR_TRANSPORTAR,
      DEB_ESP
    },
    // O que a conta assumiu por falta de cadastro. A tela mostra isto: um
    // E110 feito com seis zeros assumidos é um número, não uma apuração.
    assumidos,
    // Para a tela poder explicar de onde veio o débito e o crédito.
    diagnostico: {
      linhasExtemporaneas: totais.linhasExtemporaneas,
      linhasComCfopInvertido: totais.linhasInvertidas,
      // A validação do campo 15: DEB_ESP + VL_ICMS_RECOLHER tem de ser igual à
      // soma dos VL_OR do E116. Sem E116 não há o que conferir, mas o valor
      // que ele teria de somar é este.
      totalEsperadoNoE116: moeda(DEB_ESP + VL_ICMS_RECOLHER)
    }
  };
}

module.exports = {
  CFOP_TRANSFERENCIA_SALDO_DEVEDOR,
  SITUACOES_EXTEMPORANEAS,
  linhasC190,
  totaisDoPeriodo,
  apuracaoE110
};
