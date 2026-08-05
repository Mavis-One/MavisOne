// Monta o payload de emissão de NF-e no formato da Focus NFe
// (https://doc.focusnfe.com.br/reference/emitir_nfe). Mapeamento feito com
// base na documentação pública e nas convenções usuais de NF-e — o primeiro
// teste real em homologação tende a apontar campos adicionais exigidos pela
// SEFAZ do estado específico; ajustar conforme a resposta de erro da Focus.
function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

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
    unidade_tributavel: item.unidadeComercial || 'UN',
    valor_bruto: valorBruto,
    icms_origem: item.origem ?? 0
  };

  if (regra.csosn) {
    // Simples Nacional — CSOSN em vez de CST.
    base.icms_situacao_tributaria = regra.csosn;
  } else if (regra.cstIcms) {
    base.icms_situacao_tributaria = regra.cstIcms;
    base.icms_modalidade_base_calculo = regra.modalidadeBcIcms ?? 3;
    base.icms_base_calculo = valorBruto;
    base.icms_aliquota = Number(regra.aliquotaIcms || 0);
    base.icms_valor = round2(valorBruto * Number(regra.aliquotaIcms || 0) / 100);
  }

  if (regra.cstPis) {
    base.pis_situacao_tributaria = regra.cstPis;
    base.pis_base_calculo = valorBruto;
    base.pis_aliquota_porcentual = Number(regra.aliquotaPis || 0);
    base.pis_valor = round2(valorBruto * Number(regra.aliquotaPis || 0) / 100);
  }

  if (regra.cstCofins) {
    base.cofins_situacao_tributaria = regra.cstCofins;
    base.cofins_base_calculo = valorBruto;
    base.cofins_aliquota_porcentual = Number(regra.aliquotaCofins || 0);
    base.cofins_valor = round2(valorBruto * Number(regra.aliquotaCofins || 0) / 100);
  }

  return base;
}

function buildNfePayload({ estabelecimento, empresa, destinatario, itens, naturezaOperacao, tipoDocumento, finalidadeEmissao, dataEmissao }) {
  const documentoLimpo = String(destinatario.documento || '').replace(/\D/g, '');

  return {
    natureza_operacao: naturezaOperacao,
    data_emissao: dataEmissao,
    tipo_documento: tipoDocumento,
    finalidade_emissao: finalidadeEmissao,

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

    nome_destinatario: destinatario.nome,
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

    items: itens.map(buildNfeItemPayload)
  };
}

module.exports = { buildNfePayload };
