// Monta o payload de emissão de NF-e no formato da Focus NFe
// (https://doc.focusnfe.com.br/reference/emitir_nfe). Mapeamento feito com
// base na documentação pública e nas convenções usuais de NF-e — o primeiro
// teste real em homologação tende a apontar campos adicionais exigidos pela
// SEFAZ do estado específico; ajustar conforme a resposta de erro da Focus.
//
// O que cada CST admite vem do módulo compartilhado com a tela: se os dois
// discordassem, o formulário esconderia a alíquota numa isenção e o payload a
// mandaria assim mesmo.
const cstIcms = require('../public/modules/shared/cst_icms');
// Os limites de texto da SEFAZ vem do MESMO catalogo que a tela usa. Dois
// numeros separados divergiriam, e a tela diria "cabe" para o que a SEFAZ
// recusa — que e exatamente o erro que esta conferencia existe para evitar.
const textoNfe = require('../public/modules/shared/nfe_texto_padrao');
// A tabela tBand, do MESMO catalogo que o cadastro de credenciadoras valida e
// que a linha de pagamento do pedido oferece. Bandeira que a SEFAZ nao conhece
// nao entra no XML.
const bandeiraCartao = require('../public/modules/shared/bandeira_cartao');
// A IE do destinatário só entra quando ele é contribuinte, e só com os
// dígitos. "ISENTO" no cadastro é resposta para a tela, não para o XML.
const inscricaoEstadual = require('../public/modules/shared/inscricao_estadual');

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

const num = (valor) => Number(valor || 0);

// "Foi preenchido?" — e não "é diferente de zero". Alíquota 0 com CST 40
// (isento) é informação, não campo vazio: tratar 0 como ausente faria a nota
// sair sem o grupo do imposto e a SEFAZ rejeitar.
const informado = (valor) => valor !== null && valor !== undefined && valor !== '';

function buildNfeItemPayload(item, index) {
  const regra = item.regraFiscal;
  const quantidade = Number(item.quantidade || 0);
  const valorUnitario = Number(item.valorUnitario || 0);
  const valorBruto = round2(quantidade * valorUnitario);

  const base = {
    numero_item: index + 1,
    codigo_produto: item.codigoProduto || String(index + 1),
    descricao: item.descricao,
    cfop: regra.cfop,
    codigo_ncm: item.ncm,
    quantidade_comercial: quantidade,
    valor_unitario_comercial: valorUnitario,
    quantidade_tributavel: quantidade,
    valor_unitario_tributavel: valorUnitario,
    unidade_comercial: item.unidadeComercial || 'UN',
    // A tributável pode diferir da comercial (vende em caixa, tributa em
    // unidade). Só cai na comercial quando o produto não declara a própria.
    unidade_tributavel: item.unidadeTributavel || item.unidadeComercial || 'UN',
    valor_bruto: valorBruto,
    icms_origem: item.origem ?? 0
  };

  // indTot: o valor do item entra no total da nota (1) ou não (0). Item
  // ESCRITURAL não compõe o total de mercadorias — ele existe para carregar o
  // imposto, e somar R$ 0,00 ao total de produtos seria só ruído. Declarar
  // indTot=0 é o que diz isso à SEFAZ, em vez de deixá-la deduzir.
  //
  // O NOME DO CAMPO ESTAVA ERRADO, e por isso a declaração nunca saiu.
  //
  // Até 23/09/2026 esta linha gravava `item_valor_total`, que NÃO EXISTE na
  // Focus. Conferido em campos.focusnfe.com.br/nfe/NotaFiscalXML.html: o campo
  // de indTot é `inclui_no_total`, de valores 0 e 1, e o PADRÃO DELE É 1 — ou
  // seja, o item escritural vinha sendo declarado como se compusesse o total.
  // (O nome parecido que existe, `valor_total_item`, é outra coisa: é o valor
  // em reais da participação do item no total, não o indicador.)
  //
  // A Focus ignora campo desconhecido em silêncio e responde sucesso, então
  // nada falhou nem falharia — é o mesmo defeito que `indicador_ie_destinatario`
  // teve por um mês. O total da nota continuava certo por coincidência: o item
  // escritural vale R$ 0,00, e somar zero não muda soma nenhuma. O que estava
  // errado era a DECLARAÇÃO, e ela só cobraria o preço no dia em que um item
  // escritural carregasse valor.
  if (item.escritural) base.inclui_no_total = 0;

  // CEST é obrigatório quando o produto está em regime de ST. Vem do cadastro
  // do produto, não da regra: é classificação da mercadoria.
  if (item.cest) base.cest = String(item.cest).replace(/\D/g, '');
  if (item.ean) base.codigo_barras_comercial = item.ean;

  // --- ICMS próprio ---------------------------------------------------------
  // CST que exige um grupo que ainda não montamos (diferimento, ST retido,
  // monofásico de combustível) é RECUSADO, não emitido pela metade. Nota que
  // passa na validação declarando o imposto errado é pior do que nota que não
  // sai: a primeira só aparece numa fiscalização.
  if (regra.cstIcms && !regra.csosn && !cstIcms.ehSuportado(regra.cstIcms)) {
    const situacao = cstIcms.situacao(regra.cstIcms);
    const err = new Error(situacao
      ? `CST ${cstIcms.normalizar(regra.cstIcms)} (${situacao.rotulo}) ainda não é emitido por este sistema: falta o ${situacao.falta}. Use outra situação tributária ou peça a implementação antes de emitir.`
      : `CST "${regra.cstIcms}" não existe na tabela do ICMS.`);
    err.status = 400;
    throw err;
  }

  if (regra.csosn) {
    // Simples Nacional — CSOSN em vez de CST, e sem base/alíquota no grupo.
    base.icms_situacao_tributaria = regra.csosn;
  } else if (regra.cstIcms && !cstIcms.temIcmsProprio(regra.cstIcms)) {
    // ISENTA, NÃO TRIBUTADA, SUSPENSÃO, ST JÁ RETIDO: vai SÓ o CST.
    //
    // Estes CST não tributam a operação própria — não existe base, nem
    // alíquota, nem valor a declarar. Até 14/08/2026 o código mandava os três
    // para qualquer CST; numa nota isenta isso é declarar imposto onde não há,
    // e a SEFAZ recusa. Não apareceu antes porque a única regra cadastrada
    // usava CST 00, onde os três são obrigatórios.
    base.icms_situacao_tributaria = cstIcms.normalizar(regra.cstIcms);

    // O benefício fiscal É o que a SEFAZ cobra numa isenta. Medido em
    // homologação em 15/08/2026, emitindo com CST 40 sem ele:
    //
    //   930 — CST com beneficio fiscal e nao informado o codigo de
    //         beneficio fiscal [nItem:1]
    //
    // O código sai da tabela da UF (em SC, da SEF/SC) e muda por ato
    // normativo, por isso é campo da regra e não constante aqui.
    //
    // E não adianta inventar um no formato certo: emitindo com "SC830001",
    // também em 15/08/2026, a resposta mudou de 930 para
    //
    //   931 — Informado codigo de beneficio fiscal incompativel com CST e UF
    //
    // ou seja, a SEFAZ CONFERE o código contra a tabela do estado. É uma boa
    // notícia — ao contrário de um nome de campo errado, que a Focus ignora
    // calada e devolve sucesso, aqui o erro aparece na cara. Nota isenta só
    // sai com o cBenef que o contador confirmar.
    //
    // Digitado na emissão VENCE o da regra, igual à alíquota: o benefício varia
    // por mercadoria e por ato normativo, e esperar uma regra nova para cada
    // caso emperraria a emissão. Vazio = usa o da regra.
    const beneficio = informado(item.codigoBeneficioFiscal)
      ? item.codigoBeneficioFiscal
      : regra.codigoBeneficioFiscal;
    if (informado(beneficio)) {
      base.codigo_beneficio_fiscal = String(beneficio).trim();
    }
    // Desoneração: quanto de ICMS deixou de ser cobrado e por quê. Vai junto
    // quando a regra declara o motivo — sem motivo, mandar só o valor faz a
    // SEFAZ cobrar o par.
    if (informado(regra.icmsMotivoDesoneracao)) {
      base.icms_motivo_desoneracao = String(regra.icmsMotivoDesoneracao).trim();
      const aliquotaCheia = num(regra.aliquotaIcms);
      if (aliquotaCheia > 0) {
        base.icms_valor_desonerado = round2(valorBruto * aliquotaCheia / 100);
      }
    }
  } else if (regra.cstIcms) {
    base.icms_situacao_tributaria = regra.cstIcms;
    base.icms_modalidade_base_calculo = informado(regra.modalidadeBcIcms) ? Number(regra.modalidadeBcIcms) : 3;
    // Redução de base: a BC vai reduzida E o percentual vai declarado. Mandar
    // só a base reduzida faz a SEFAZ recalcular e acusar divergência.
    const reducao = num(regra.reducaoBcIcms);
    // NUMA NOTA COMPLEMENTAR A BASE NÃO VEM DO VALOR DO ITEM.
    //
    // O item escritural vale R$ 0,00 — derivar a base dele daria ICMS zero, e
    // a nota não complementaria nada. A base é informada pelo usuário: é
    // exatamente o valor que ficou de fora da nota original.
    const baseInformada = informado(item.baseIcms) ? num(item.baseIcms) : null;
    const baseBruta = baseInformada !== null ? baseInformada : valorBruto;
    const baseIcms = reducao > 0 ? round2(baseBruta * (1 - reducao / 100)) : baseBruta;
    if (reducao > 0) base.icms_reducao_base_calculo = reducao;
    base.icms_base_calculo = baseIcms;
    const aliquota = informado(item.aliquotaIcms) ? num(item.aliquotaIcms) : num(regra.aliquotaIcms);
    base.icms_aliquota = aliquota;
    // Valor informado tem precedência sobre o calculado: o complemento pode
    // ser uma diferença apurada (o que faltou), que não é base × alíquota.
    base.icms_valor = informado(item.valorIcms)
      ? round2(num(item.valorIcms))
      : round2(baseIcms * aliquota / 100);
  }

  // --- ICMS-ST --------------------------------------------------------------
  // O valor retido é calculado sobre a base do substituto: o valor da operação
  // acrescido da MVA, com o ICMS próprio abatido — é o que a nota tem que
  // declarar, e não a alíquota aplicada crua.
  // ST só quando o CST da operação admite. Sem esta guarda, marcar ST numa
  // regra de CST 00 faria a nota declarar substituição numa operação que não
  // tem. Com CSOSN (Simples) quem decide é outra tabela, ainda não modelada
  // aqui — nesse caminho segue como estava.
  const cstAdmiteSt = !regra.cstIcms || cstIcms.temSt(regra.cstIcms);
  if (regra.cstIcmsSt && cstAdmiteSt) {
    const mva = num(regra.mvaSt);
    const baseSt = round2(valorBruto * (1 + mva / 100));
    const icmsProprio = num(base.icms_valor);
    base.icms_modalidade_base_calculo_st = 4; // 4 = Margem de Valor Agregado (%)
    base.icms_margem_valor_adicionado_st = mva;
    base.icms_base_calculo_st = baseSt;
    base.icms_aliquota_st = num(regra.aliquotaIcmsSt);
    base.icms_valor_st = Math.max(0, round2(baseSt * num(regra.aliquotaIcmsSt) / 100 - icmsProprio));
  }

  if (regra.cstPis) {
    base.pis_situacao_tributaria = regra.cstPis;
    base.pis_base_calculo = valorBruto;
    base.pis_aliquota_porcentual = num(regra.aliquotaPis);
    base.pis_valor = round2(valorBruto * num(regra.aliquotaPis) / 100);
  }

  if (regra.cstCofins) {
    base.cofins_situacao_tributaria = regra.cstCofins;
    base.cofins_base_calculo = valorBruto;
    base.cofins_aliquota_porcentual = num(regra.aliquotaCofins);
    base.cofins_valor = round2(valorBruto * num(regra.aliquotaCofins) / 100);
  }

  // --- IPI ------------------------------------------------------------------
  // Indústria e importadora são contribuintes de IPI. O código de
  // enquadramento é obrigatório sempre que o grupo do IPI aparece; 999
  // ("tributação normal") é o padrão de quem não tem enquadramento especial.
  //
  // O PRODUTO VENCE A REGRA AQUI (fase CS), e é o único imposto em que isso
  // acontece. A razão é de natureza: o IPI segue a classificação do produto na
  // TIPI, que é do produto e não da operação. Uma regra por operação × UF não
  // consegue dizer "esta furadeira é 6,5% e aquele parafuso é 0%" sem uma regra
  // por NCM — o mesmo problema que a fase CP resolveu para o ICMS.
  //
  // A regra segue valendo como padrão de quem não declarou, e é isso que faz
  // esta mudança não alterar nenhuma nota enquanto nenhum produto tiver CST de
  // IPI cadastrado.
  const cstIpi = item.cstIpi || regra.cstIpi;
  if (cstIpi) {
    // A alíquota acompanha a MESMA fonte do CST. Misturar CST do produto com
    // alíquota da regra produziria uma combinação que ninguém cadastrou —
    // `informado` e não `||` porque alíquota 0 é legítima (CST imune/isento).
    const aliquotaIpi = item.cstIpi && informado(item.aliquotaIpi)
      ? num(item.aliquotaIpi)
      : num(regra.aliquotaIpi);
    base.ipi_situacao_tributaria = cstIpi;
    base.ipi_codigo_enquadramento_legal = regra.codigoEnquadramentoIpi || '999';
    base.ipi_base_calculo = valorBruto;
    base.ipi_aliquota = aliquotaIpi;
    base.ipi_valor = round2(valorBruto * aliquotaIpi / 100);
  }

  // --- EX TIPI, escala e fabricante (fase CS) --------------------------------
  // Três campos que SÓ o produto pode responder, e que nenhuma regra fiscal
  // teria como supri-los. Nomes conferidos em 23/09/2026 contra
  // campos.focusnfe.com.br/nfe/NotaFiscalXML.html:
  //
  //   codigo_ex_tipi    EXTIPI     Integer[2-3]
  //   escala_relevante  indEscala  Boolean
  //   cnpj_fabricante   CNPJFab    Integer[14]
  //
  // A conferência na fonte não é zelo: a Focus descarta campo desconhecido em
  // silêncio e responde sucesso. Foi assim que `indicador_ie_destinatario`
  // passou um mês sem chegar a nota nenhuma.
  if (item.codigoExTipi) base.codigo_ex_tipi = String(item.codigoExTipi).replace(/\D/g, '');

  // TRÊS estados, e o terceiro é o que importa: `null` é "não declarado", e o
  // campo é OMITIDO. Mandar `escala_relevante: true` por padrão faria toda nota
  // passar a afirmar algo sobre os 5.475 produtos que hoje ela não afirma.
  if (item.escalaRelevante === true || item.escalaRelevante === false) {
    base.escala_relevante = item.escalaRelevante;
    // O CNPJ do fabricante é exigido justamente no caso NÃO relevante. Vai
    // junto e só aí: em escala relevante ele não tem função e a SEFAZ não o
    // pede. A conferência de que ele EXISTE está em conferirEscalaDosItens —
    // aqui é só a montagem.
    if (item.escalaRelevante === false && item.cnpjFabricante) {
      base.cnpj_fabricante = String(item.cnpjFabricante).replace(/\D/g, '');
    }
  }

  // --- Crédito de ICMS do Simples Nacional ----------------------------------
  // CSOSN 101 e 201 são "com permissão de crédito": a nota tem que declarar
  // quanto de ICMS o destinatário pode aproveitar, e o percentual é o da
  // partilha do SN da empresa (cadastrado em empresa.aliquotaCreditoIcmsSn).
  // Sem esses dois campos a SEFAZ rejeita o CSOSN 101/201, e com eles zerados
  // o cliente perde um crédito a que tem direito.
  if (['101', '201'].includes(String(regra.csosn || '')) && num(item.aliquotaCreditoSn) > 0) {
    base.icms_aliquota_credito_simples = num(item.aliquotaCreditoSn);
    base.icms_valor_credito_simples = round2(valorBruto * num(item.aliquotaCreditoSn) / 100);
  }

  // --- DIFAL / partilha (EC 87/2015) ----------------------------------------
  // Venda interestadual para quem NÃO é contribuinte: a diferença entre a
  // alíquota interna do estado de destino e a interestadual pertence ao
  // destino. Desde 2019 a partilha é 100% destino, 0% remetente — os dois
  // campos vão mesmo assim, porque a SEFAZ exige o par.
  //
  // Simples Nacional está DISPENSADO do DIFAL (ADI 5.464 do STF), por isso a
  // partilha só é montada quando a regra usa CST, não CSOSN.
  if (item.difal && !regra.csosn && num(regra.aliquotaInternaUfDestino) > 0) {
    const baseDifal = num(base.icms_base_calculo) || valorBruto;
    const interna = num(regra.aliquotaInternaUfDestino);
    const interestadual = num(regra.aliquotaIcms);
    const valorDifal = round2(baseDifal * Math.max(0, interna - interestadual) / 100);
    base.icms_base_calculo_uf_destino = baseDifal;
    base.icms_aliquota_interna_uf_destino = interna;
    base.icms_aliquota_interestadual = interestadual;
    base.icms_valor_uf_destino = valorDifal;
    base.icms_valor_uf_remetente = 0;
    // FCP do estado de destino, quando houver. É percentual separado do ICMS.
    if (num(regra.aliquotaFcpUfDestino) > 0) {
      base.percentual_fcp_uf_destino = num(regra.aliquotaFcpUfDestino);
      base.icms_valor_fcp_uf_destino = round2(baseDifal * num(regra.aliquotaFcpUfDestino) / 100);
    }
  }

  // --- IBS e CBS (Reforma Tributária, LC 214/2025) ---------------------------
  // Sem este bloco a SEFAZ recusa TODA nota: "1115 — Rejeicao: IBS/CBS não
  // informado". Medido numa emissão real em homologação em 14/08/2026, com o
  // resto do caminho já funcionando (certificado assinou, nota chegou à SEFAZ).
  //
  // Os nomes dos campos vêm da referência oficial da Focus NFe
  // (campos.focusnfe.com.br/nfe/ItemNotaFiscalXML.html), conferidos contra as
  // tags do XML — pIBSUF, pIBSMun, pCBS, cClassTrib. Isso importa mais do que
  // parece: a Focus IGNORA campo desconhecido em silêncio e responde sucesso,
  // então um nome errado aqui não dá erro — produz nota AUTORIZADA e errada,
  // que só aparece numa fiscalização.
  //
  // O bloco inteiro depende da regra declarar o CST do IBS/CBS. Regra que não
  // declara continua sendo recusada pela SEFAZ, como hoje — o que NÃO fazemos
  // é inventar uma situação tributária para a nota passar.
  if (regra.cstIbsCbs) {
    // A base é a mesma do PIS/COFINS: o valor da mercadoria. Não é a base do
    // ICMS, que pode vir reduzida — redução de base do ICMS é benefício do
    // ICMS e não acompanha os tributos novos.
    const baseIbsCbs = valorBruto;
    base.ibs_cbs_situacao_tributaria = String(regra.cstIbsCbs);
    base.ibs_cbs_classificacao_tributaria = String(regra.classTrib || '');
    base.ibs_cbs_base_calculo = baseIbsCbs;

    // `informado`, e não "> 0" — a distinção que o resto deste arquivo já
    // fazia e que eu quebrei na primeira versão deste bloco. Alíquota ZERO é
    // informação; alíquota AUSENTE é outra coisa.
    //
    // Custou uma rejeição para aprender: em 2026 o IBS do município é
    // obrigatoriamente 0,0% (a UF fica com os 0,1% inteiros), e enviar 0 é
    // exigido — omitir o campo derruba a nota com "1036 — Alíquota do IBS do
    // Município inválida". Já um CST de operação não tributada não tem
    // alíquota nenhuma, e aí o campo realmente não vai.
    if (informado(regra.aliquotaIbsUf)) {
      base.ibs_uf_aliquota = num(regra.aliquotaIbsUf);
      base.ibs_uf_valor = round2(baseIbsCbs * num(regra.aliquotaIbsUf) / 100);
    }
    if (informado(regra.aliquotaIbsMun)) {
      base.ibs_mun_aliquota = num(regra.aliquotaIbsMun);
      base.ibs_mun_valor = round2(baseIbsCbs * num(regra.aliquotaIbsMun) / 100);
    }
    // vIBS é a soma das duas competências, não um terceiro cálculo: somar os
    // valores já arredondados evita o centavo de diferença que a SEFAZ acusa
    // ao conferir o total contra as partes.
    if (informado(regra.aliquotaIbsUf) || informado(regra.aliquotaIbsMun)) {
      base.ibs_valor_total = round2(num(base.ibs_uf_valor) + num(base.ibs_mun_valor));
    }
    if (informado(regra.aliquotaCbs)) {
      base.cbs_aliquota = num(regra.aliquotaCbs);
      base.cbs_valor = round2(baseIbsCbs * num(regra.aliquotaCbs) / 100);
    }
  }

  // Texto exigido por lei (ex.: "Empresa optante pelo Simples Nacional") vai
  // no item, não no rodapé: é a regra do item que o determina.
  if (regra.observacaoFisco) base.informacoes_adicionais_item = regra.observacaoFisco;

  return base;
}

// Formas de pagamento do layout 4.0 da NF-e. O grupo é OBRIGATÓRIO desde a
// versão 4.0 — nota sem ele é rejeitada, e é a rejeição mais provável de uma
// primeira integração.
const FORMAS_PAGAMENTO = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito',
  '05': 'Crédito Loja', '10': 'Vale Alimentação', '11': 'Vale Refeição', '12': 'Vale Presente',
  '13': 'Vale Combustível', '15': 'Boleto Bancário', '16': 'Depósito Bancário',
  '17': 'PIX', '18': 'Transferência bancária', '19': 'Cashback',
  '90': 'Sem pagamento', '99': 'Outros'
};

// AS FORMAS QUE TEM GRUPO `card`: credito (03) e debito (04).
const FORMAS_DE_CARTAO = new Set(['03', '04']);

/**
 * O GRUPO `card` DE UMA LINHA DE PAGAMENTO — MONTADO INTEIRO OU NAO MONTADO.
 *
 * Este e o grupo que derrubou duas notas seguidas no ERP observado em
 * 08/09/2026:
 *
 *   Rejeicao: Falha no Schema XML da NFe
 *   (Elemento: enviNFe/NFe[1]/infNFe/pag/detPag/card/CNPJ/) (Cod: 225)
 *
 * O `card` saia SEM o CNPJ. O operador corrigiu a nota a mao e minutos depois a
 * seguinte caiu no mesmo erro, porque o defeito era do cadastro. Enquanto o
 * grupo nao e montado a SEFAZ nao cobra os campos dele; e monta-lo pela metade
 * que rejeita.
 *
 * `tipo_integracao` (tpIntegra) SEMPRE VAI numa linha de cartao, e o padrao e
 * 2 — "nao integrado ao sistema de automacao", que e o que uma maquininha POS
 * e. Dizer 1 sem ter CNPJ e autorizacao e exatamente a metade que rejeita;
 * dizer 2 e a verdade da loja que passa o cartao na maquininha ao lado do
 * computador.
 *
 * Os demais campos entram SO quando existem e sao validos: CNPJ com 14
 * digitos, bandeira que esta na tabela tBand, autorizacao ate 128 caracteres
 * (o limite do cAut). Campo invalido some em vez de viajar — o que a SEFAZ nao
 * aceita nao melhora por estar presente.
 *
 * Os nomes dos campos vem da referencia oficial da Focus
 * (campos.focusnfe.com.br/nfe/FormaPagamentoXML.html), com a tag XML de cada
 * um ao lado. Isso importa mais do que parece: a Focus IGNORA campo
 * desconhecido em silencio e responde sucesso, entao um nome errado aqui nao
 * da erro — produz nota AUTORIZADA e sem o grupo do cartao.
 */
function grupoCartao(tPag, pagamento) {
  if (!FORMAS_DE_CARTAO.has(tPag)) return {};
  const cnpj = String(pagamento.cnpjCredenciadora || '').replace(/\D/g, '');
  const bandeira = String(pagamento.bandeira || '').trim();
  const autorizacao = String(pagamento.autorizacao || '').trim().slice(0, 128);
  const grupo = {
    // tpIntegra
    tipo_integracao: String(pagamento.integracao || '') === '1' ? 1 : 2
  };
  // CNPJ da credenciadora
  if (cnpj.length === 14) grupo.cnpj_credenciadora = cnpj;
  // tBand
  if (bandeiraCartao.existe(bandeira)) grupo.bandeira_operadora = bandeira;
  // cAut
  if (autorizacao) grupo.numero_autorizacao = autorizacao;
  return grupo;
}

// Em homologação a SEFAZ exige que o nome do destinatário seja EXATAMENTE
// este texto — sem acento, em maiúsculas. É a rejeição mais comum de uma
// primeira integração, e a mais confusa: o cadastro do cliente está certo, a
// nota é recusada mesmo assim.
const NOME_DESTINATARIO_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

function buildNfePayload({
  estabelecimento, empresa, destinatario, itens, naturezaOperacao,
  tipoDocumento, finalidadeEmissao, dataEmissao,
  pagamentos, frete, seguro, desconto, outrasDespesas, modalidadeFrete, informacoesAdicionais,
  // Padrão fechado: sem ambiente informado, monta como teste. Um payload de
  // produção montado por engano vira uma nota real; o contrário, não.
  ambiente,
  // Chaves de NF-e que esta nota referencia. Obrigatório na complementar (a
  // SEFAZ recusa sem) e na devolução.
  referencias
}) {
  const emHomologacao = String(ambiente || 'homologacao').toLowerCase() !== 'producao';
  const documentoLimpo = String(destinatario.documento || '').replace(/\D/g, '');
  const items = itens.map(buildNfeItemPayload);
  // Item escritural não entra no total de mercadorias — ele declarou
  // indTot=0. Somá-lo aqui faria o total da nota discordar da soma dos itens
  // que a SEFAZ confere, e a rejeição viria por divergência de totais.
  const totalProdutos = round2(items.reduce(
    (soma, i) => soma + (i.inclui_no_total === 0 ? 0 : num(i.valor_bruto)), 0));

  // Total da nota = produtos + frete + seguro + outras despesas + ST + IPI
  // − desconto. É esse número que a SEFAZ confere contra a soma dos itens; se
  // não fechar, a nota é rejeitada por divergência de totais.
  const somaCampo = (campo) => round2(items.reduce((soma, i) => soma + num(i[campo]), 0));
  const totalNota = round2(
    totalProdutos + num(frete) + num(seguro) + num(outrasDespesas) - num(desconto)
    + somaCampo('icms_valor_st') + somaCampo('ipi_valor')
  );

  // Grupo obrigatório do layout 4.0. Sem pagamento informado, a nota sai como
  // uma parcela única "Outros" no valor total — melhor do que ser rejeitada,
  // e visível o bastante para alguém corrigir.
  const formasPagamento = (Array.isArray(pagamentos) && pagamentos.length
    ? pagamentos
    : [{ forma: '99', valor: totalNota }]
  ).map((p) => {
    const tPag = FORMAS_PAGAMENTO[String(p.forma)] ? String(p.forma) : '99';
    return {
      forma_pagamento: tPag,
      valor_pagamento: round2(p.valor),
      // O grupo `card`, quando a forma e cartao. Vazio nas outras — mandar
      // bandeira num PIX seria oferecer a SEFAZ um grupo que nao existe ali.
      ...grupoCartao(tPag, p)
    };
  });

  // Notas referenciadas (grupo NFref do layout). Só entram chaves com 44
  // dígitos: mandar uma truncada faz a SEFAZ rejeitar a nota inteira, e o
  // erro não diz qual das chaves está errada.
  const notasReferenciadas = (Array.isArray(referencias) ? referencias : [])
    .map((r) => String(r?.chaveAcesso || r?.chave || r || '').replace(/\D/g, ''))
    .filter((chave) => chave.length === 44)
    .map((chave) => ({ chave_nfe: chave }));

  return {
    items,
    natureza_operacao: naturezaOperacao,
    data_emissao: dataEmissao,
    tipo_documento: tipoDocumento,
    finalidade_emissao: finalidadeEmissao,
    ...(notasReferenciadas.length ? { notas_referenciadas: notasReferenciadas } : {}),

    cnpj_emitente: estabelecimento.cnpj,
    nome_emitente: estabelecimento.razaoSocial,
    nome_fantasia_emitente: estabelecimento.nomeFantasia || undefined,
    logradouro_emitente: estabelecimento.logradouro,
    numero_emitente: estabelecimento.numero,
    complemento_emitente: estabelecimento.complemento || undefined,
    bairro_emitente: estabelecimento.bairro,
    municipio_emitente: estabelecimento.municipio,
    uf_emitente: estabelecimento.uf,
    cep_emitente: estabelecimento.cep,
    codigo_municipio_emitente: estabelecimento.codigoMunicipio,
    inscricao_estadual_emitente: estabelecimento.inscricaoEstadual,
    telefone_emitente: estabelecimento.telefone || undefined,
    regime_tributario_emitente: empresa.crt,

    // O nome real não se perde: vai para as informações adicionais, senão a
    // nota de teste fica indistinguível de qualquer outra na hora de conferir.
    nome_destinatario: emHomologacao ? NOME_DESTINATARIO_HOMOLOGACAO : destinatario.nome,
    cnpj_destinatario: documentoLimpo.length === 14 ? documentoLimpo : undefined,
    cpf_destinatario: documentoLimpo.length === 11 ? documentoLimpo : undefined,
    // O NOME É O DA FOCUS, e não uma abreviação. Este campo se chamava
    // `indicador_ie_destinatario` desde a primeira versão do builder — um
    // nome que não existe na documentação da Focus (doc.focusnfe.com.br/
    // reference/emitir_nfe e campos.focusnfe.com.br/nfe/NotaFiscalXML.html
    // só conhecem `indicador_inscricao_estadual_destinatario`, tag indIEDest,
    // valores 1/2/9). Campo desconhecido a Focus ignora em silêncio: o
    // indicador nunca chegou à nota. Achado pela revisão de 15/09/2026, ao
    // fazer a decisão "ISENTO não é contribuinte" passar por aqui.
    indicador_inscricao_estadual_destinatario: destinatario.contribuinte ? 1 : 9,
    // Para indicador 2 e 9 a tag IE não é informada; para 1, vai só com os
    // dígitos — "ISENTO", ponto ou traço no campo é rejeição da SEFAZ.
    inscricao_estadual_destinatario: destinatario.contribuinte ? inscricaoEstadual.paraNota(destinatario.inscricaoEstadual) : undefined,
    logradouro_destinatario: destinatario.logradouro,
    numero_destinatario: destinatario.numero || 'S/N',
    bairro_destinatario: destinatario.bairro,
    municipio_destinatario: destinatario.municipio,
    uf_destinatario: destinatario.uf,
    cep_destinatario: destinatario.cep,
    codigo_municipio_destinatario: destinatario.codigoMunicipio || undefined,

    // 0 = por conta do emitente, 1 = do destinatário, 2 = de terceiros,
    // 9 = sem frete. Sem valor de frete, declarar "sem frete" é o correto.
    modalidade_frete: modalidadeFrete !== undefined && modalidadeFrete !== null
      ? Number(modalidadeFrete)
      : (num(frete) > 0 ? 0 : 9),
    valor_frete: num(frete) || undefined,
    valor_seguro: num(seguro) || undefined,
    valor_desconto: num(desconto) || undefined,
    valor_outras_despesas: num(outrasDespesas) || undefined,
    valor_produtos: totalProdutos,
    valor_total: totalNota,

    formas_pagamento: formasPagamento,

    // O aviso vem do catalogo compartilhado, e nao escrito aqui: e a TELA que
    // precisa saber que ele existe para contar o limite direito. Enquanto so
    // este arquivo sabia, a tela aprovava 5000 caracteres e a SEFAZ recebia
    // 5081 — ver orcamentoDoRodape.
    informacoes_adicionais_contribuinte: [
      informacoesAdicionais || null,
      emHomologacao ? textoNfe.avisoDeHomologacao(destinatario.nome) : null
    ].filter(Boolean).join(textoNfe.SEPARADOR_RODAPE) || undefined
  };
}

/**
 * A SOMA DOS PAGAMENTOS FECHA COM O TOTAL DA NOTA?
 *
 * A SEFAZ confere vPag contra vNF e rejeita quando nao bate. Enquanto o grupo
 * `pag` era montado por este arquivo como UMA linha pelo total, isso fechava
 * por construcao; desde que a tela passou a mandar as linhas reais do pedido
 * (fase BU), passou a ser possivel divergir — pedido com desconto e linhas de
 * pagamento do valor cheio, por exemplo.
 *
 * Um centavo de folga: `valor_pagamento` e arredondado linha a linha e
 * `valor_total` de uma vez, entao a soma das partes pode diferir do todo por
 * arredondamento — que nao e erro de digitacao. E o mesmo criterio de
 * parcelasDoPedido.
 *
 * Devolve a mensagem do problema, ou '' quando fecha.
 */
function conferirPagamentosDaNota(payload) {
  const linhas = Array.isArray(payload.formas_pagamento) ? payload.formas_pagamento : [];
  // Uma linha tambem e conferida. A primeira versao pulava quando havia uma
  // so, na ideia de que ela seria sempre a do fallback (montada AQUI pelo
  // proprio total, e portanto exata). Mas um pedido com UMA linha de
  // pagamento de valor errado — total 970 com desconto e pagamento lancado
  // por 1000 — passava batido e chegava rejeitado na SEFAZ. O fallback
  // continua fechando por construcao, entao conferi-lo nao custa nada.
  if (!linhas.length) return '';
  const somado = round2(linhas.reduce((soma, l) => soma + num(l.valor_pagamento), 0));
  const total = round2(num(payload.valor_total));
  if (Math.abs(somado - total) <= 0.01) return '';
  const falta = round2(total - somado);
  return `As formas de pagamento somam ${somado.toFixed(2)} e a nota tem ${total.toFixed(2)}: `
    + `${falta > 0 ? `faltam ${falta.toFixed(2)}` : `excedem ${Math.abs(falta).toFixed(2)}`}. `
    + 'Ajuste os pagamentos do pedido antes de emitir — a SEFAZ recusa a nota assim.';
}

/**
 * OS TEXTOS CABEM NO QUE A SEFAZ ACEITA?
 *
 * Confere o PAYLOAD MONTADO, e nao o que o usuario digitou. A diferenca nao e
 * detalhe: em homologacao o proprio builder ACRESCENTA ao rodape o aviso
 * obrigatorio de teste com o nome do destinatario real — 75 a 123 caracteres
 * que a tela nao conta. Um texto de exatamente 5000, que a tela aprova, chega
 * a SEFAZ com 5103 e e rejeitado. Medindo a string final isso some, e qualquer
 * outro acrescimo futuro ja nasce contado.
 *
 * POR QUE NO SERVIDOR, se a tela ja barra: a tela barra no navegador, e isso
 * vale so para quem passa por ela. E o preco de escapar e alto — nao e erro de
 * digitacao, e REJEICAO depois de transmitir, com a numeracao ja consumida.
 *
 * Devolve a mensagem do problema, ou '' quando esta tudo dentro.
 */
function conferirLimitesDeTexto(payload, { informacoesAdicionais = '' } = {}) {
  const rodape = String(payload.informacoes_adicionais_contribuinte || '');
  if (textoNfe.excedeLimite(rodape)) {
    const digitado = String(informacoesAdicionais || '').length;
    // Duas causas, duas mensagens: mandar encurtar um texto que sozinho cabe
    // deixaria o operador cortando conteudo sem entender por que.
    const porQue = digitado && digitado <= textoNfe.LIMITE_INFCPL
      ? ` Seu texto tem ${digitado}, mas em homologação a SEFAZ exige um aviso de teste`
        + ' que é acrescentado ao final e também conta.'
      : '';
    return `As observações adicionais ficaram com ${rodape.length} caracteres; `
      + `a SEFAZ aceita no máximo ${textoNfe.LIMITE_INFCPL}.${porQue}`;
  }
  for (const item of (payload.items || [])) {
    const doItem = String(item.informacoes_adicionais_item || '');
    if (textoNfe.excedeLimiteDoItem(doItem)) {
      // Nomear o item e a regra fiscal: o texto nao foi digitado nesta tela, veio
      // da regra que casou com o produto, e sem o nome ninguem acha de onde saiu.
      return `A observação do fisco do item "${item.descricao || item.codigo_produto || ''}" `
        + `tem ${doItem.length} caracteres; a SEFAZ aceita no máximo `
        + `${textoNfe.LIMITE_INFADPROD} no campo do item. Encurte o texto na regra fiscal.`;
    }
  }
  return '';
}

// buildNfeItemPayload sai exportado para a aba Impostos do pedido usar a
// MESMA montagem que a emissao. Dois calculos separados dariam duas
// respostas, e a previa viraria mentira no dia em que uma das duas mudasse.
/**
 * O GRUPO DO CARTAO ESTA INTEIRO?
 *
 * So cobra da linha que DECLARA integracao (tpIntegra = 1): ai a SEFAZ exige o
 * CNPJ da credenciadora e o numero de autorizacao, e a nota sem eles volta com
 * a rejeicao 225 — depois de transmitida, com a numeracao ja consumida.
 *
 * Linha "nao integrada" (tpIntegra = 2) nao e cobrada de nada: e a maquininha
 * POS, que nao tem NSU chegando ao sistema. Exigir CNPJ ali impediria de
 * vender no cartao so porque ninguem cadastrou a credenciadora ainda.
 *
 * Devolve a mensagem do problema, ou '' quando esta inteiro.
 */
/**
 * ESCALA NÃO RELEVANTE SEM O CNPJ DO FABRICANTE (fase CS).
 *
 * O Convênio ICMS 52/2017, cláusula 23, criou o indEscala, e a regra que
 * acompanha é curta: declarado NÃO relevante, o CNPJFab passa a ser obrigatório.
 * A SEFAZ recusa a nota sem ele — depois de transmitida, com a numeração já
 * consumida, que é o custo que esta conferência evita.
 *
 * Confere contra o PAYLOAD MONTADO, e não contra o cadastro, pelo mesmo motivo
 * de conferirDestinatarioDaNota: é o payload que vai para a SEFAZ, e é nele que
 * o campo pode ter sido perdido no caminho.
 *
 * Item que NÃO declara escala não é cobrado de nada: `escala_relevante` ausente
 * é o estado dos 5.475 produtos deste cadastro, e exigir fabricante de todos
 * eles impediria emitir qualquer nota.
 *
 * Devolve a mensagem do problema, ou '' quando está inteiro.
 */
function conferirEscalaDosItens(payload) {
  const itens = Array.isArray(payload.items) ? payload.items : [];
  const semFabricante = [];
  itens.forEach((item, indice) => {
    if (item.escala_relevante !== false) return;
    if (!item.cnpj_fabricante) {
      semFabricante.push(`${indice + 1} (${item.descricao || 'sem descrição'})`);
    }
  });
  if (!semFabricante.length) return '';
  return `O item ${semFabricante.join(', ')} está declarado como produzido em escala NÃO `
    + 'relevante, e nesse caso a SEFAZ exige o CNPJ do fabricante da mercadoria. '
    + 'Preencha o CNPJ do fabricante no cadastro do produto, em Estoque -> Produtos, '
    + 'ou desmarque a escala não relevante se ela não se aplica — sem um dos dois a nota '
    + 'volta rejeitada depois de consumir a numeração.';
}

function conferirCartoesDaNota(payload) {
  const linhas = Array.isArray(payload.formas_pagamento) ? payload.formas_pagamento : [];
  const problemas = [];
  linhas.forEach((linha, indice) => {
    if (linha.tipo_integracao !== 1) return;
    const faltando = [];
    if (!linha.cnpj_credenciadora) faltando.push('o CNPJ da credenciadora');
    if (!linha.numero_autorizacao) faltando.push('o numero de autorizacao (NSU)');
    if (faltando.length) {
      problemas.push(`no pagamento ${indice + 1} falta ${faltando.join(' e ')}`);
    }
  });
  if (!problemas.length) return '';
  return `O pagamento em cartao esta declarado como INTEGRADO, e assim a SEFAZ exige o grupo completo: `
    + `${problemas.join('; ')}. `
    + 'Cadastre a credenciadora na forma de pagamento e informe a autorizacao no pedido, ou mude a linha '
    + 'para "nao integrado" — o grupo do cartao pela metade volta como rejeicao 225 depois de transmitir.';
}

/**
 * O ENDERECO DO DESTINATARIO ESTA COMPLETO? (fase BY)
 *
 * O grupo `enderDest` da NF-e exige logradouro, bairro, municipio, UF e CEP.
 * A emissao so' conferia nome, documento e UF: uma nota com o resto em branco
 * era montada, transmitida, e voltava REJEITADA — com a numeracao ja' consumida
 * e sem dizer, na tela do ERP, qual campo faltava.
 *
 * Conferir aqui, contra o PAYLOAD MONTADO, e' o mesmo principio de
 * conferirLimitesDeTexto: o que vale e' o que vai sair, nao o que foi digitado.
 *
 * O NUMERO NAO ENTRA na lista: o montador ja' o preenche com 'S/N', que e' o
 * valor previsto no layout para endereco sem numero. Exigi-lo recusaria uma
 * nota que a SEFAZ aceita.
 *
 * Devolve a mensagem do problema, ou '' quando esta completo.
 */
function conferirDestinatarioDaNota(payload) {
  const exigidos = [
    ['logradouro_destinatario', 'o logradouro'],
    ['bairro_destinatario', 'o bairro'],
    ['municipio_destinatario', 'o municipio'],
    ['uf_destinatario', 'a UF'],
    ['cep_destinatario', 'o CEP']
  ];
  const faltando = exigidos
    .filter(([campo]) => !String(payload[campo] || '').trim())
    .map(([, rotulo]) => rotulo);
  if (!faltando.length) return '';
  return `O endereco do destinatario esta incompleto: falta ${faltando.join(', ')}. `
    + 'A SEFAZ exige o grupo enderDest inteiro — sem isso a nota volta rejeitada, '
    + 'com a numeracao ja consumida. Complete o cadastro do cliente.';
}

module.exports = {
  buildNfePayload, buildNfeItemPayload, conferirLimitesDeTexto, conferirPagamentosDaNota,
  conferirCartoesDaNota, conferirDestinatarioDaNota, conferirEscalaDosItens
};
