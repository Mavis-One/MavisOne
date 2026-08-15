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
  if (item.escritural) base.item_valor_total = 0;

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
  if (regra.cstIpi) {
    base.ipi_situacao_tributaria = regra.cstIpi;
    base.ipi_codigo_enquadramento_legal = regra.codigoEnquadramentoIpi || '999';
    base.ipi_base_calculo = valorBruto;
    base.ipi_aliquota = num(regra.aliquotaIpi);
    base.ipi_valor = round2(valorBruto * num(regra.aliquotaIpi) / 100);
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
    (soma, i) => soma + (i.item_valor_total === 0 ? 0 : num(i.valor_bruto)), 0));

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
  ).map((p) => ({
    forma_pagamento: FORMAS_PAGAMENTO[String(p.forma)] ? String(p.forma) : '99',
    valor_pagamento: round2(p.valor)
  }));

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
    indicador_ie_destinatario: destinatario.contribuinte ? 1 : 9,
    inscricao_estadual_destinatario: destinatario.inscricaoEstadual || undefined,
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

    informacoes_adicionais_contribuinte: [
      informacoesAdicionais || null,
      emHomologacao ? `TESTE EM HOMOLOGACAO - SEM VALOR FISCAL. Destinatario real: ${destinatario.nome}` : null
    ].filter(Boolean).join(' | ') || undefined
  };
}

module.exports = { buildNfePayload };
