// Monta o payload de emissão de NF-e no formato da Focus NFe
// (https://doc.focusnfe.com.br/reference/emitir_nfe). Mapeamento feito com
// base na documentação pública e nas convenções usuais de NF-e — o primeiro
// teste real em homologação tende a apontar campos adicionais exigidos pela
// SEFAZ do estado específico; ajustar conforme a resposta de erro da Focus.
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
  if (regra.csosn) {
    // Simples Nacional — CSOSN em vez de CST, e sem base/alíquota no grupo.
    base.icms_situacao_tributaria = regra.csosn;
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
  if (regra.cstIcmsSt) {
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
