/**
 * TRIBUTOS DE UM PEDIDO — a conta que alimenta a aba Impostos.
 *
 * O QUE ESTE ARQUIVO NÃO É
 * ------------------------
 * Não é um segundo motor fiscal. A tributação de item já existe e é usada na
 * emissão de verdade (lib/nfePayloadBuilder.js, buildNfeItemPayload), e é ELA
 * que roda aqui. Um cálculo próprio para a prévia daria duas respostas: a tela
 * mostraria um número e a nota sairia com outro, e a divergência só apareceria
 * depois de autorizada.
 *
 * ZERO NÃO É UMA RESPOSTA SÓ
 * --------------------------
 * Um campo em R$ 0,00 pode significar duas coisas muito diferentes:
 *
 *   a) não há esse imposto nesta operação;
 *   b) este sistema ainda não apura esse imposto.
 *
 * Mostrar as duas do mesmo jeito é o defeito clássico de tela de impostos:
 * alguém confere o pedido, vê ISS zerado e conclui que não há ISS a pagar.
 * Por isso o retorno traz `naoCalculados` — a lista dos campos que estão em
 * zero pelo motivo (b). A tela mostra "—" neles, não "R$ 0,00".
 *
 * E `pendencias` diz o que impediu o cálculo de um item: sem NCM, sem regra
 * fiscal, CST que este sistema ainda não emite. Um item que não pôde ser
 * apurado NÃO entra nas somas — somar zero por ele faria o total parecer
 * completo.
 */

const { buildNfeItemPayload } = require('./nfePayloadBuilder');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;

// Campos que a estrutura declara porque o briefing pede, mas que nenhuma parte
// do sistema apura hoje. Ficam aqui, num lugar só, para a tela poder marcá-los
// e para a lista encolher sozinha à medida que cada um for implementado.
//
// Não é preguiça declarada: cada um destes depende de coisa que não existe —
// ISS é NFS-e (outro documento), retenções dependem do cadastro de retenção
// por tomador, e o Imposto Seletivo ainda não tem regulamentação aplicável.
const NAO_APURADOS = [
  'icms.descontoZonaFranca',
  'fcp.base',
  'fcp.valor',
  'fcp.baseSt',
  'fcp.valorSt',
  'fcp.baseStRetidoAnteriormente',
  'fcp.valorStRetidoAnteriormente',
  'pis.descontoZonaFranca',
  'pis.baseSt',
  'pis.valorSt',
  'cofins.baseSt',
  'cofins.valorSt',
  'issqn.base',
  'issqn.valor',
  'issqn.issPorSt',
  'outros.irrf',
  'outros.csllRetido',
  'outros.inssRetido',
  'is.base',
  'is.valor'
];

function estruturaZerada() {
  return {
    valoresDaNota: { valorTotal: 0, valorFaturado: 0 },
    icms: {
      baseCalculoDestacado: 0,
      valorDestacado: 0,
      descontoZonaFranca: 0,
      valorDiferencialAliquota: 0,
      baseSt: 0,
      valorSt: 0,
      icmsDesonerado: 0
    },
    fcp: {
      base: 0,
      valor: 0,
      baseSt: 0,
      valorSt: 0,
      baseStRetidoAnteriormente: 0,
      valorStRetidoAnteriormente: 0,
      // Além da lista do briefing: o FCP do estado de DESTINO é outro campo da
      // nota (vFCPUFDest), e é o único que este sistema apura hoje. Somá-lo no
      // "FCP Valor" acima faria dois impostos diferentes virarem um número só.
      ufDestino: { base: 0, valor: 0 }
    },
    cofins: { base: 0, valor: 0, baseSt: 0, valorSt: 0 },
    pis: { base: 0, valor: 0, descontoZonaFranca: 0, baseSt: 0, valorSt: 0 },
    issqn: { base: 0, valor: 0, issPorSt: 0 },
    outros: { irrf: 0, csllRetido: 0, inssRetido: 0, baseIpi: 0, valorIpi: 0 },
    // Reforma tributária (LC 214/2025). Existem desde já, zerados na transição
    // quando a regra não declarar alíquota — mas o campo tem de estar no
    // modelo, senão a nota é recusada por não informar IBS/CBS.
    ibsCbs: { baseCalculo: 0, valorIbs: 0, valorCbs: 0 },
    is: { base: 0, valor: 0 }
  };
}

/**
 * @param {object} entrada
 *   itens: [{ descricao, ncm, origem, quantidade, valorUnitario, codigoProduto, ... }]
 *   empresa, estabelecimento, destinatario: { uf, contribuinte }
 *   tipoOperacao: chave do catálogo de operações ('VENDA', 'TRANSFERENCIA', …)
 *   data: AAAA-MM-DD usada para escolher a regra vigente
 *   valorFaturado: o que já virou nota autorizada, quando houver
 * @param {object} deps
 *   resolverRegraFiscal: a MESMA função que a emissão usa
 */
async function calcularTributos(entrada, deps) {
  const {
    itens = [],
    empresa = null,
    estabelecimento = null,
    destinatario = {},
    tipoOperacao = 'VENDA',
    data = new Date().toISOString().slice(0, 10),
    valorFaturado = 0
  } = entrada || {};
  const resolverRegraFiscal = deps && deps.resolverRegraFiscal;

  const total = estruturaZerada();
  const pendencias = [];
  const porItem = [];

  total.valoresDaNota.valorFaturado = round2(valorFaturado);

  // Sem empresa/estabelecimento não há como escolher regra nenhuma: a regra é
  // por empresa, e a UF do emitente decide se a operação é interna. Devolve a
  // estrutura zerada com o motivo, em vez de somar zeros como se fosse conta
  // fechada.
  if (!empresa || !estabelecimento) {
    pendencias.push({
      escopo: 'pedido',
      motivo: 'Empresa do pedido não está ligada a um estabelecimento fiscal — sem isso não há regra fiscal para aplicar.'
    });
    return { ...total, porItem, pendencias, naoCalculados: NAO_APURADOS, calculado: false };
  }
  if (!destinatario.uf) {
    pendencias.push({
      escopo: 'pedido',
      motivo: 'Cliente sem UF: a alíquota depende do destino, e operação interna e interestadual não são a mesma conta.'
    });
    return { ...total, porItem, pendencias, naoCalculados: NAO_APURADOS, calculado: false };
  }

  const dentroDoEstado = destinatario.uf === estabelecimento.uf;

  for (let i = 0; i < itens.length; i += 1) {
    const item = itens[i];
    const rotulo = `Item ${i + 1} (${item.descricao || 'sem descrição'})`;

    if (!item.ncm) {
      pendencias.push({ escopo: rotulo, motivo: 'Sem NCM no cadastro do produto — a regra fiscal é escolhida por NCM.' });
      continue;
    }

    let regra = null;
    try {
      regra = await resolverRegraFiscal({
        empresaId: empresa.id,
        ncm: item.ncm,
        origem: item.origem || 0,
        tipoOperacao,
        ufDestino: destinatario.uf,
        dentroDoEstado,
        destinatarioContribuinte: Boolean(destinatario.contribuinte),
        data
      });
    } catch (erro) {
      pendencias.push({ escopo: rotulo, motivo: `Falha ao buscar a regra fiscal: ${erro.message}` });
      continue;
    }

    if (!regra) {
      pendencias.push({
        escopo: rotulo,
        motivo: `Nenhuma regra fiscal para o NCM ${item.ncm} nesta operação (${tipoOperacao}, destino ${destinatario.uf}). Cadastre em Fiscal → Regras Fiscais.`
      });
      continue;
    }

    let payload = null;
    try {
      payload = buildNfeItemPayload({
        ...item,
        regraFiscal: regra,
        // Mesmas condições da emissão: DIFAL só em venda interestadual para
        // quem NÃO é contribuinte, e o crédito do Simples vem da empresa.
        difal: !dentroDoEstado && !destinatario.contribuinte,
        aliquotaCreditoSn: empresa.aliquotaCreditoIcmsSn
      }, i);
    } catch (erro) {
      // buildNfeItemPayload recusa CST que o sistema ainda não emite. Na
      // emissão isso derruba a nota inteira, e está certo; aqui derrubaria a
      // aba, então vira pendência do item e o resto continua somando.
      pendencias.push({ escopo: rotulo, motivo: erro.message });
      continue;
    }

    // Item ESCRITURAL carrega imposto, não mercadoria: não entra no valor de
    // produtos. Mesma separação que a emissão faz entre valor comercial e
    // valor fiscal.
    if (!item.escritural) {
      total.valoresDaNota.valorTotal = round2(total.valoresDaNota.valorTotal + num(payload.valor_bruto));
    }

    total.icms.baseCalculoDestacado = round2(total.icms.baseCalculoDestacado + num(payload.icms_base_calculo));
    total.icms.valorDestacado = round2(total.icms.valorDestacado + num(payload.icms_valor));
    total.icms.valorDiferencialAliquota = round2(total.icms.valorDiferencialAliquota + num(payload.icms_valor_uf_destino));
    total.icms.baseSt = round2(total.icms.baseSt + num(payload.icms_base_calculo_st));
    total.icms.valorSt = round2(total.icms.valorSt + num(payload.icms_valor_st));
    total.icms.icmsDesonerado = round2(total.icms.icmsDesonerado + num(payload.icms_valor_desonerado));

    total.fcp.ufDestino.base = round2(total.fcp.ufDestino.base + num(payload.icms_base_calculo_uf_destino));
    total.fcp.ufDestino.valor = round2(total.fcp.ufDestino.valor + num(payload.icms_valor_fcp_uf_destino));

    total.pis.base = round2(total.pis.base + num(payload.pis_base_calculo));
    total.pis.valor = round2(total.pis.valor + num(payload.pis_valor));
    total.cofins.base = round2(total.cofins.base + num(payload.cofins_base_calculo));
    total.cofins.valor = round2(total.cofins.valor + num(payload.cofins_valor));

    total.outros.baseIpi = round2(total.outros.baseIpi + num(payload.ipi_base_calculo));
    total.outros.valorIpi = round2(total.outros.valorIpi + num(payload.ipi_valor));

    total.ibsCbs.baseCalculo = round2(total.ibsCbs.baseCalculo + num(payload.ibs_cbs_base_calculo));
    total.ibsCbs.valorIbs = round2(total.ibsCbs.valorIbs + num(payload.ibs_valor_total));
    total.ibsCbs.valorCbs = round2(total.ibsCbs.valorCbs + num(payload.cbs_valor));

    porItem.push({
      numero: i + 1,
      descricao: item.descricao || '',
      ncm: item.ncm,
      cfop: payload.cfop || '',
      // CST ou CSOSN — a tela mostra o que a regra usou, sem traduzir um no
      // outro: são tabelas diferentes e confundi-las esconde o regime.
      situacaoIcms: payload.icms_situacao_tributaria || '',
      valorBruto: round2(payload.valor_bruto),
      icmsBase: round2(payload.icms_base_calculo),
      icmsAliquota: num(payload.icms_aliquota),
      icmsValor: round2(payload.icms_valor),
      pisValor: round2(payload.pis_valor),
      cofinsValor: round2(payload.cofins_valor),
      ipiValor: round2(payload.ipi_valor),
      ibsValor: round2(payload.ibs_valor_total),
      cbsValor: round2(payload.cbs_valor)
    });
  }

  return {
    ...total,
    porItem,
    pendencias,
    naoCalculados: NAO_APURADOS,
    // `calculado` é verdadeiro quando TODO item virou conta. Com uma pendência
    // que seja, os totais são parciais, e a tela precisa dizer isso — um total
    // parcial apresentado como final é pior do que nenhum total.
    calculado: pendencias.length === 0 && porItem.length > 0
  };
}

module.exports = { calcularTributos, NAO_APURADOS, estruturaZerada };
