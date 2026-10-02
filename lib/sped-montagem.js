/**
 * A ESCRITURAÇÃO DO MÊS — documentos do sistema -> registros da EFD ICMS/IPI.
 *
 * Esta é a peça do meio, e é pura de propósito:
 *
 *   banco (lib/db/sped-escrituracao.js)  -> lê documentos, cadastro, configuração
 *   ESTA                                 -> decide cada registro e cada campo
 *   lib/sped-gerador.js                  -> escreve o arquivo
 *
 * Pura porque cada decisão aqui é uma regra do Guia Prático ou uma escolha
 * fiscal, e as duas precisam ser provadas com documentos montados à mão — hoje
 * há 0 notas no banco, e uma regra que só se confere quando houver movimento é
 * uma regra que ninguém confere.
 *
 * O QUE ELA NÃO GERA, E POR QUE DIZ EM VEZ DE OMITIR
 * --------------------------------------------------
 * Cada registro que o arquivo deveria ter e este sistema ainda não sabe montar
 * vira um IMPEDIMENTO (a geração é recusada) ou um AVISO (o arquivo sai, e a
 * tela diz o que falta). A diferença é se a omissão muda o imposto:
 *
 *   impede: ICMS-ST retido nas saídas (E200–E250), DIFAL (E300), Bloco K
 *           obrigatório, e qualquer dado de cadastro sem o qual o PVA recusa;
 *   avisa:  C110/0450 (informação complementar), CFOP de entrada derivado,
 *           CSOSN de fornecedor do Simples convertido, unidade divergente.
 */

const apuracao = require('./sped-apuracao');
const { VERSAO_POR_ANO } = require('./sped-conferencia');

const COD_SIT = {
  REGULAR: '00', EXTEMPORANEO: '01', CANCELADO: '02', CANCELADO_EXTEMPORANEO: '03',
  DENEGADO: '04', INUTILIZADO: '05', COMPLEMENTAR: '06', COMPLEMENTAR_EXTEMPORANEO: '07',
  REGIME_ESPECIAL: '08'
};
// Documento nessas situações sai no C100 só com a identificação — sem valor,
// sem participante e sem filhos. É a regra do Guia para COD_SIT 02, 03, 04 e 05.
const SEM_VALORES = ['02', '03', '04', '05'];

// As 13 perguntas do 1010, na ordem do registro.
const INDICADORES_1010 = ['IND_EXP', 'IND_CCRF', 'IND_COMB', 'IND_USINA', 'IND_VA', 'IND_EE',
  'IND_CART', 'IND_FORM', 'IND_AER', 'IND_GIAF1', 'IND_GIAF3', 'IND_GIAF4', 'IND_REST_RESSARC'];

// TIPO_ITEM do 0200 a partir do tipo fiscal do cadastro. Hoje só existe
// 'NORMAL' nas 5.484 linhas de produto_fiscal; os outros estão aqui para o dia
// em que o cadastro os tiver.
const TIPO_ITEM = {
  NORMAL: '00', MERCADORIA: '00', REVENDA: '00', MATERIA_PRIMA: '01', EMBALAGEM: '02',
  PRODUTO_EM_PROCESSO: '03', PRODUTO_ACABADO: '04', SUBPRODUTO: '05', PRODUTO_INTERMEDIARIO: '06',
  USO_CONSUMO: '07', ATIVO: '08', SERVICO: '09', OUTROS_INSUMOS: '10', OUTRAS: '99'
};

// Descrição das unidades mais comuns, para o 0190 quando `fiscal_unidades`
// não tem a unidade (hoje está vazia). O sistema antigo escrevia "descricao un".
const UNIDADES_CONHECIDAS = {
  UN: 'UNIDADE', UND: 'UNIDADE', UNID: 'UNIDADE', PC: 'PECA', PCT: 'PACOTE', CX: 'CAIXA',
  KG: 'QUILOGRAMA', G: 'GRAMA', L: 'LITRO', LT: 'LITRO', ML: 'MILILITRO', M: 'METRO',
  M2: 'METRO QUADRADO', M3: 'METRO CUBICO', CM: 'CENTIMETRO', MM: 'MILIMETRO', KIT: 'KIT',
  JG: 'JOGO', PAR: 'PAR', DZ: 'DUZIA', RL: 'ROLO', FD: 'FARDO', SC: 'SACO', CH: 'CHAPA',
  BR: 'BARRA', GL: 'GALAO', TB: 'TUBO', FR: 'FRASCO', CJ: 'CONJUNTO', TON: 'TONELADA'
};

const so = (v) => String(v ?? '').replace(/\D/g, '');
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const moeda = (v) => Math.round(n(v) * 100) / 100;
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** 'aaaa-mm-dd' (ou Date) -> 'ddmmaaaa'. */
function dataEfd(v) {
  if (!v) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

/** 'aaaa-mm' -> { ini: 'aaaa-mm-01', fim: 'aaaa-mm-dd', ano, mes } */
function janela(competencia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ''));
  if (!m) throw Object.assign(new Error('Competência inválida. Use aaaa-mm.'), { status: 400 });
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { ano, mes, ini: `${m[1]}-${m[2]}-01`, fim: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * CST_ICMS de 3 posições: origem + CST.
 *
 * Fornecedor do Simples manda CSOSN (101, 102, 500…), que não é CST. A entrada
 * escritura CST, e a conversão usual é para 90 ("outras"). O sistema antigo
 * escrevia o CSOSN como se fosse CST ("102" = origem 1 + CST 02, que é outra
 * coisa). Devolve `convertido` para a tela contar.
 */
function cstIcms(origem, cst) {
  const c = so(cst);
  const o = origem === null || origem === undefined || origem === '' ? '0' : String(origem);
  if (c.length === 3) return { cst: `${o}90`, convertido: true };
  return { cst: `${o}${c.padStart(2, '0')}`, convertido: false };
}

/**
 * OS VALORES DE ICMS DE UM ITEM, já com a decisão sobre o crédito.
 *
 * `semCredito` é a configuração NENHUM aplicada a nota de terceiro de entrada:
 * base, alíquota e ICMS saem zerados. É a única diferença entre as duas
 * escolhas — e por isso ela mora num lugar só.
 */
function icmsDoItem(item, { semCredito, contribuinteIpi }) {
  const t = item.tributos || {};
  const icms = t.ICMS || {};
  const st = t.ICMS_ST || {};
  const fcpSt = t.FCP_ST || {};
  const ipi = t.IPI || {};
  const mercadoria = n(item.valorTotal) - n(item.valorDesconto) + n(item.valorFrete) + n(item.valorSeguro) + n(item.valorOutras);
  const base = semCredito ? 0 : n(icms.base);
  const reducao = !semCredito && n(icms.reducao) > 0 ? Math.max(0, moeda(mercadoria - n(icms.base))) : 0;
  return {
    base,
    aliquota: semCredito ? 0 : n(icms.aliquota),
    valor: semCredito ? 0 : n(icms.valor),
    baseSt: n(st.base),
    aliquotaSt: n(st.aliquota),
    valorSt: n(st.valor),
    reducao,
    // Quem não é contribuinte do IPI não destaca nem credita IPI: ele é custo e
    // entra no valor da operação (VL_OPR), não no VL_IPI.
    ipi: contribuinteIpi ? n(ipi.valor) : 0,
    // VL_OPR do C190: mercadoria + acessórias + ST + FCP-ST + IPI − desconto.
    operacao: moeda(mercadoria + n(st.valor) + n(fcpSt.valor) + n(ipi.valor))
  };
}

/**
 * A ESCRITURAÇÃO.
 *
 *   montarEscrituracao({
 *     competencia: 'aaaa-mm',
 *     estabelecimento, empresa, configuracao,
 *     documentos,                 // do período, já filtrados pelo banco
 *     unidades: { UN: 'UNIDADE' },// fiscal_unidades
 *     saldoCredorAnterior         // número, ou null = desconhecido
 *   })
 *
 * Devolve { registro0000, blocos, apuracao, impedimentos, avisos, resumo }.
 * Com impedimento, `blocos` ainda vem — a tela pode mostrar a prévia —, mas
 * quem gera o arquivo tem de recusar.
 */
function montarEscrituracao({ competencia, estabelecimento: est = {}, empresa = {}, configuracao: cfg = {}, documentos = [], unidades = {}, saldoCredorAnterior = null }) {
  const j = janela(competencia);
  const impedimentos = [];
  const avisos = [];
  const impede = (codigo, titulo, detalhe, itens) => impedimentos.push({ codigo, titulo, detalhe, itens });
  const avisa = (codigo, titulo, detalhe, itens) => avisos.push({ codigo, titulo, detalhe, itens });

  // ---------------------------------------------------------------- cadastro
  const perfil = texto(est.perfil_sped).toUpperCase();
  const indAtiv = est.indicador_atividade === null || est.indicador_atividade === undefined ? '' : String(est.indicador_atividade);
  if (!['A', 'B', 'C'].includes(perfil)) impede('PERFIL', 'O perfil do SPED (A, B ou C) do estabelecimento não foi informado', 'Nos SPEDs do sistema anterior ele é B. Quem define é o contador.');
  if (!['0', '1'].includes(indAtiv)) impede('IND_ATIV', 'O indicador de atividade (industrial ou outros) não foi informado', 'Nos SPEDs do sistema anterior ele é 1 (outros).');
  if (!texto(cfg.contador_nome) || !(so(cfg.contador_cpf) || so(cfg.contador_cnpj)) || !texto(cfg.contador_crc)) {
    impede('CONTADOR', 'O contabilista (registro 0100) não está completo', 'Nome, CPF e CRC são obrigatórios no arquivo.');
  }
  if (!['DESTACADO', 'NENHUM'].includes(cfg.credito_icms_entradas)) {
    impede('CREDITO', 'Falta decidir como escriturar o ICMS das entradas',
      'Os SPEDs do sistema anterior declaram crédito zero em todos os meses, com ICMS destacado nas entradas. '
      + 'Tomar o crédito ou não muda o imposto a recolher — a escolha é do contador.');
  }
  if (cfg.bloco_k_obrigatorio) {
    impede('BLOCO_K', 'O estabelecimento está marcado como obrigado ao Bloco K',
      'Este sistema não tem estoque por estabelecimento com data, então não gera o K200. O SPED de setembro/2026 do sistema anterior trouxe K200.');
  }
  for (const [campo, rotulo] of [['cnpj', 'CNPJ'], ['inscricao_estadual', 'inscrição estadual'], ['codigo_municipio', 'código do município'], ['uf', 'UF']]) {
    if (!texto(est[campo])) impede('ESTABELECIMENTO', `O estabelecimento está sem ${rotulo}`, 'Vai no registro 0000.');
  }

  const contribuinteIpi = indAtiv === '0';
  const regime = texto(empresa.regime_tributario).toUpperCase();
  const naoCumulativo = regime === 'LUCRO_REAL';

  // -------------------------------------------------------------- documentos
  const docs = [...documentos].sort((a, b) => {
    const da = String(a.emissaoPropria ? a.dataEmissao : (a.dataMovimento || a.dataEmissao) || '');
    const db = String(b.emissaoPropria ? b.dataEmissao : (b.dataMovimento || b.dataEmissao) || '');
    return da.localeCompare(db) || String(a.modelo).localeCompare(String(b.modelo))
      || String(a.serie || '').localeCompare(String(b.serie || '')) || n(a.numero) - n(b.numero);
  });

  const participantes = new Map(); // codigo -> 0150
  const itens0200 = new Map();     // COD_ITEM -> 0200
  const unidadesUsadas = new Set();
  const blocoC = [];
  const paraApuracao = [];
  let csosnConvertidos = 0;
  const unidadeDivergente = [];
  const semParticipante = [];
  let comObservacao = 0;
  let stRetidoNasSaidas = 0;
  let stNasEntradas = 0;
  let difal = 0;
  const resumo = { documentos: 0, saidas: 0, entradas: 0, canceladas: 0, itensC170: 0 };

  for (const d of docs) {
    const codSit = COD_SIT[d.situacao] || '00';
    const indOper = d.sentido === 'ENTRADA' ? '0' : '1';
    const indEmit = d.emissaoPropria ? '0' : '1';
    const modelo = String(d.modelo || '55');
    resumo.documentos += 1;
    if (indOper === '0') resumo.entradas += 1; else resumo.saidas += 1;

    if (SEM_VALORES.includes(codSit)) {
      resumo.canceladas += 1;
      blocoC.push({
        REG: 'C100', IND_OPER: indOper, IND_EMIT: indEmit, COD_MOD: modelo, COD_SIT: codSit,
        SER: texto(d.serie), NUM_DOC: String(d.numero), CHV_NFE: codSit === '05' ? '' : so(d.chaveAcesso)
      });
      continue;
    }

    const nfce = modelo === '65';
    const semCredito = indOper === '0' && !d.emissaoPropria && cfg.credito_icms_entradas === 'NENHUM';
    const p = d.participante;
    if (!nfce && !p) semParticipante.push(String(d.numero));
    if (!nfce && p) {
      const cod = texto(p.codigo);
      if (!participantes.has(cod)) {
        const brasil = !texto(p.codigoPais) || texto(p.codigoPais) === '1058';
        participantes.set(cod, {
          REG: '0150', COD_PART: cod, NOME: texto(p.nome).slice(0, 100),
          COD_PAIS: texto(p.codigoPais) || '1058',
          CNPJ: p.tipoDocumento === 'CNPJ' ? so(p.documento) : '',
          CPF: p.tipoDocumento === 'CPF' ? so(p.documento) : '',
          IE: so(p.inscricaoEstadual) ? texto(p.inscricaoEstadual).replace(/[^0-9A-Za-z]/g, '') : '',
          COD_MUN: brasil ? so(p.codigoMunicipio) : '',
          SUFRAMA: texto(p.inscricaoSuframa),
          END: texto(p.logradouro).slice(0, 60), NUM: texto(p.numero).slice(0, 10),
          COMPL: texto(p.complemento).slice(0, 60), BAIRRO: texto(p.bairro).slice(0, 60)
        });
      }
    }

    // Itens: os valores de ICMS de cada um, e o C170 quando a nota é de terceiro.
    // Nota própria NÃO tem C170 — o Guia dispensa, e o sistema anterior também
    // não escrevia: o fisco já tem o XML.
    const filhos170 = [];
    const linhas = [];
    for (const it of d.itens || []) {
      const v = icmsDoItem(it, { semCredito, contribuinteIpi });
      const t = it.tributos || {};
      const { cst, convertido } = cstIcms(it.origem, t.ICMS && t.ICMS.cst);
      if (convertido) csosnConvertidos += 1;
      if (t.ICMS_ST && n(t.ICMS_ST.valor)) {
        if (indOper === '1') stRetidoNasSaidas += n(t.ICMS_ST.valor);
        else stNasEntradas += n(t.ICMS_ST.valor);
      }
      if (t.ICMS_DIFAL && n(t.ICMS_DIFAL.valor)) difal += n(t.ICMS_DIFAL.valor);

      linhas.push({
        cfop: so(it.cfop), cstIcms: cst, aliquotaIcms: v.aliquota, valorOperacao: v.operacao,
        baseIcms: v.base, valorIcms: v.valor, baseIcmsSt: v.baseSt, valorIcmsSt: v.valorSt,
        reducaoBase: v.reducao, valorIpi: v.ipi
      });

      if (d.emissaoPropria || nfce) continue;

      // O ITEM DO 0200. Com vínculo ao cadastro e a MESMA unidade da nota, é o
      // produto daqui. Sem vínculo, ou com unidade diferente, é o item do
      // fornecedor: unidade diferente exigiria o 0220 (fator de conversão), que
      // este sistema não tem — e C170 com UNID diferente do 0200 sem 0220 é
      // recusado pelo PVA.
      const prod = it.produto;
      const unidNota = texto(it.unidade).toUpperCase().slice(0, 6) || 'UN';
      const usaProduto = prod && texto(prod.codigo) && texto(prod.unidade).toUpperCase() === unidNota;
      if (prod && texto(prod.codigo) && !usaProduto) unidadeDivergente.push(`${prod.codigo}: nota em ${unidNota}, cadastro em ${texto(prod.unidade).toUpperCase() || '—'}`);
      const codItem = usaProduto ? texto(prod.codigo) : `${texto(p && p.codigo) || 'F'}-${texto(it.codigoItem)}`.slice(0, 60);
      if (!itens0200.has(codItem)) {
        const cfop = so(it.cfop);
        const tipo = usaProduto
          ? (TIPO_ITEM[texto(prod.tipoItem).toUpperCase()] || '00')
          : (/^\d556$/.test(cfop) ? '07' : /^\d551$/.test(cfop) ? '08' : /^\d(102|403|101)$/.test(cfop) ? '00' : '99');
        const ncm = so(usaProduto ? prod.ncm : it.ncm) || so(it.ncm);
        itens0200.set(codItem, {
          REG: '0200', COD_ITEM: codItem,
          DESCR_ITEM: texto(usaProduto ? prod.descricao : it.descricao) || texto(it.descricao),
          COD_BARRA: usaProduto ? so(prod.ean) : '',
          UNID_INV: unidNota, TIPO_ITEM: tipo,
          COD_NCM: ncm.length === 8 ? ncm : '',
          EX_IPI: usaProduto ? texto(prod.exIpi) : '',
          CEST: so(usaProduto ? prod.cest : it.cest) || so(it.cest)
        });
        unidadesUsadas.add(unidNota);
      }

      const pis = t.PIS || {};
      const cofins = t.COFINS || {};
      filhos170.push({
        REG: 'C170', NUM_ITEM: String(it.numero), COD_ITEM: codItem,
        DESCR_COMPL: texto(it.descricao).slice(0, 255),
        QTD: n(it.quantidade), UNID: unidNota, VL_ITEM: n(it.valorTotal), VL_DESC: n(it.valorDesconto),
        IND_MOV: it.indicadorMovimentoFisico === false ? '1' : '0',
        CST_ICMS: cst, CFOP: so(it.cfop),
        VL_BC_ICMS: v.base, ALIQ_ICMS: v.aliquota, VL_ICMS: v.valor,
        VL_BC_ICMS_ST: v.baseSt, ALIQ_ST: v.aliquotaSt, VL_ICMS_ST: v.valorSt,
        VL_IPI: contribuinteIpi ? v.ipi : '',
        // PIS/COFINS de quem RECEBE. No lucro presumido (cumulativo) não há
        // crédito: CST 70, "aquisição sem direito a crédito", sem base.
        CST_PIS: naoCumulativo ? '50' : '70',
        VL_BC_PIS: naoCumulativo ? n(pis.base) : '', ALIQ_PIS: naoCumulativo ? n(pis.aliquota) : '',
        VL_PIS: naoCumulativo ? n(pis.valor) : '',
        CST_COFINS: naoCumulativo ? '50' : '70',
        VL_BC_COFINS: naoCumulativo ? n(cofins.base) : '', ALIQ_COFINS: naoCumulativo ? n(cofins.aliquota) : '',
        VL_COFINS: naoCumulativo ? n(cofins.valor) : ''
      });
      resumo.itensC170 += 1;
    }

    const c190 = apuracao.linhasC190(linhas);
    const soma = (k) => moeda(c190.reduce((s, l) => s + n(l[k]), 0));
    if (texto(d.observacaoFiscal)) comObservacao += 1;

    blocoC.push({
      REG: 'C100', IND_OPER: indOper, IND_EMIT: indEmit, COD_PART: nfce ? '' : texto(p && p.codigo),
      COD_MOD: modelo, COD_SIT: codSit, SER: texto(d.serie), NUM_DOC: String(d.numero), CHV_NFE: so(d.chaveAcesso),
      DT_DOC: dataEfd(d.dataEmissao), DT_E_S: dataEfd(d.dataMovimento || d.dataEmissao),
      VL_DOC: n(d.valorTotal), IND_PGTO: d.indicadorPagamento === null || d.indicadorPagamento === undefined ? '2' : String(d.indicadorPagamento),
      VL_DESC: n(d.valorDesconto), VL_ABAT_NT: 0, VL_MERC: n(d.valorProdutos),
      IND_FRT: d.modalidadeFrete === null || d.modalidadeFrete === undefined ? '9' : String(d.modalidadeFrete),
      VL_FRT: n(d.valorFrete), VL_SEG: n(d.valorSeguro), VL_OUT_DA: n(d.valorOutras),
      // Base e ICMS do C100 são a SOMA DO C190, e não o total do XML: o PVA
      // confere as duas, e na entrada sem crédito o C190 é zero.
      VL_BC_ICMS: soma('VL_BC_ICMS'), VL_ICMS: soma('VL_ICMS'),
      VL_BC_ICMS_ST: nfce ? '' : soma('VL_BC_ICMS_ST'), VL_ICMS_ST: nfce ? '' : soma('VL_ICMS_ST'),
      VL_IPI: nfce ? '' : soma('VL_IPI'),
      VL_PIS: nfce ? '' : n(d.valorPis), VL_COFINS: nfce ? '' : n(d.valorCofins)
    });
    blocoC.push(...filhos170);
    for (const l of c190) blocoC.push({ REG: 'C190', ...l, COD_OBS: l.COD_OBS || '' });
    paraApuracao.push({ sentido: indOper === '0' ? 'ENTRADA' : 'SAIDA', situacao: codSit, linhas: c190 });
  }

  if (semParticipante.length) impede('PARTICIPANTE', `${semParticipante.length} nota(s) modelo 55 sem participante`, 'O C100 de NF-e exige o COD_PART.', semParticipante.slice(0, 15));
  for (const part of participantes.values()) {
    if (part.COD_PAIS === '1058' && !part.COD_MUN) impede('PARTICIPANTE_MUNICIPIO', 'Participante sem código de município', `${part.COD_PART} ${part.NOME}`);
  }
  if (stRetidoNasSaidas > 0) impede('ST', `Há ICMS-ST retido nas saídas (R$ ${moeda(stRetidoNasSaidas).toFixed(2)})`, 'A apuração do ST (E200 a E250) ainda não é gerada por este sistema.');
  if (difal > 0) impede('DIFAL', `Há DIFAL de venda a não contribuinte de outra UF (R$ ${moeda(difal).toFixed(2)})`, 'A apuração do DIFAL (E300 a E316) ainda não é gerada por este sistema.');
  if (stNasEntradas > 0) avisa('ST_ENTRADAS', `ICMS-ST nas entradas: R$ ${moeda(stNasEntradas).toFixed(2)}`, 'Vai no C170/C190 das entradas. O sistema anterior também lançava isto no E210 como "outros créditos de ST"; este não lança. Confirmar com o contador.');
  if (csosnConvertidos) avisa('CSOSN', `${csosnConvertidos} item(ns) de fornecedor do Simples: CSOSN escriturado como CST 90`, 'O sistema anterior escrevia o CSOSN no lugar do CST.');
  if (unidadeDivergente.length) avisa('UNIDADE', `${unidadeDivergente.length} item(ns) com unidade da nota diferente da do cadastro`, 'Escriturados com o código do fornecedor (sem o 0220, que pede o fator de conversão).', [...new Set(unidadeDivergente)].slice(0, 15));
  if (comObservacao) avisa('C110', `${comObservacao} nota(s) com informação complementar`, 'O C110/0450 (texto legal da nota) ainda não é gerado.');

  // ----------------------------------------------------------------- apuração
  if (saldoCredorAnterior === null || saldoCredorAnterior === undefined) {
    impede('SALDO_ANTERIOR', 'O saldo credor do mês anterior é desconhecido',
      'Informe a competência em que a escrituração deste sistema começa e o saldo credor com que ela começa (o campo 14 do E110 do último SPED do sistema anterior).');
  }
  const zeros = { debitosDoDocumento: 0, debitosDaApuracao: 0, estornosDeCredito: 0, creditosDoDocumento: 0, creditosDaApuracao: 0, estornosDeDebito: 0 };
  const e110 = apuracao.apuracaoE110(paraApuracao, { saldoCredorAnterior: n(saldoCredorAnterior), ajustes: zeros, deducoes: 0 });
  const blocoE = [
    { REG: 'E100', DT_INI: dataEfd(j.ini), DT_FIN: dataEfd(j.fim) },
    { ...e110.campos }
  ];
  const aRecolher = moeda(e110.campos.VL_ICMS_RECOLHER + e110.campos.DEB_ESP);
  if (aRecolher > 0) {
    const dia = Number(cfg.e116_dia_vencimento);
    if (!texto(cfg.e116_codigo_receita) || !dia) {
      impede('E116', `Há ICMS a recolher (R$ ${aRecolher.toFixed(2)}) e falta o código de receita ou o dia de vencimento`, 'Nos SPEDs do sistema anterior: código 144910014, dia 10 do mês seguinte.');
    } else {
      const proxAno = j.mes === 12 ? j.ano + 1 : j.ano;
      const proxMes = j.mes === 12 ? 1 : j.mes + 1;
      const ultimoDia = new Date(Date.UTC(proxAno, proxMes, 0)).getUTCDate();
      const venc = `${proxAno}-${String(proxMes).padStart(2, '0')}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`;
      blocoE.push({
        REG: 'E116', COD_OR: '000', VL_OR: aRecolher, DT_VCTO: dataEfd(venc),
        COD_REC: texto(cfg.e116_codigo_receita), MES_REF: `${String(j.mes).padStart(2, '0')}${j.ano}`
      });
    }
  }

  // ------------------------------------------------------------------ bloco 0
  const versao = VERSAO_POR_ANO[j.ano];
  if (!versao) impede('VERSAO', `Não sei a versão do leiaute para ${j.ano}`, 'lib/sped-conferencia.js, VERSAO_POR_ANO.');
  const registro0000 = {
    REG: '0000', COD_VER: versao || '', COD_FIN: '0', DT_INI: dataEfd(j.ini), DT_FIN: dataEfd(j.fim),
    NOME: texto(est.razao_social).slice(0, 100), CNPJ: so(est.cnpj), UF: texto(est.uf).toUpperCase(),
    IE: so(est.inscricao_estadual), COD_MUN: so(est.codigo_municipio), IM: texto(est.inscricao_municipal),
    IND_PERFIL: perfil, IND_ATIV: indAtiv
  };
  const fone = so(est.telefone);
  const bloco0 = [
    {
      REG: '0005', FANTASIA: texto(est.nome_fantasia || est.razao_social).slice(0, 60), CEP: so(est.cep),
      END: texto(est.logradouro).slice(0, 60), NUM: texto(est.numero).slice(0, 10),
      COMPL: texto(est.complemento).slice(0, 60), BAIRRO: texto(est.bairro).slice(0, 60),
      FONE: fone.length >= 10 ? fone.slice(-11) : '', EMAIL: texto(est.email)
    },
    {
      REG: '0100', NOME: texto(cfg.contador_nome).slice(0, 100), CPF: so(cfg.contador_cpf), CRC: texto(cfg.contador_crc),
      CNPJ: so(cfg.contador_cnpj), CEP: so(cfg.contador_cep), END: texto(cfg.contador_endereco).slice(0, 60),
      NUM: texto(cfg.contador_numero).slice(0, 10), COMPL: texto(cfg.contador_complemento).slice(0, 60),
      BAIRRO: texto(cfg.contador_bairro).slice(0, 60), FONE: so(cfg.contador_telefone).slice(-11),
      EMAIL: texto(cfg.contador_email), COD_MUN: so(cfg.contador_codigo_municipio)
    },
    ...[...participantes.values()].sort((a, b) => a.COD_PART.localeCompare(b.COD_PART)),
    ...[...unidadesUsadas].sort().map((u) => ({
      REG: '0190', UNID: u, DESCR: texto(unidades[u]) || UNIDADES_CONHECIDAS[u] || `UNIDADE ${u}`
    })),
    ...[...itens0200.values()].sort((a, b) => a.COD_ITEM.localeCompare(b.COD_ITEM))
  ];

  const ind = cfg.indicadores_1010 || {};
  // "S" no 1010 obriga o registro correspondente do Bloco 1 — e nenhum deles é
  // gerado aqui. Responder S e entregar sem o registro é o PVA recusando.
  const marcados = INDICADORES_1010.filter((k) => ind[k] === 'S');
  if (marcados.length) {
    impede('BLOCO_1', `O 1010 responde "S" em ${marcados.join(', ')}`, 'Os registros do Bloco 1 que essas respostas exigem (1100, 1200, 1601…) ainda não são gerados por este sistema.');
  }
  const bloco1 = [Object.fromEntries([['REG', '1010'], ...INDICADORES_1010.map((k) => [k, ind[k] === 'S' ? 'S' : 'N'])])];

  return {
    registro0000,
    blocos: { 0: bloco0, C: blocoC, E: blocoE, 1: bloco1 },
    apuracao: { ...e110.campos, saldoCredorAnterior: saldoCredorAnterior === null || saldoCredorAnterior === undefined ? null : moeda(saldoCredorAnterior) },
    impedimentos,
    avisos,
    resumo: { ...resumo, participantes: participantes.size, itens: itens0200.size, competencia, de: j.ini, ate: j.fim }
  };
}

module.exports = { montarEscrituracao, janela, cstIcms, dataEfd, COD_SIT, INDICADORES_1010, UNIDADES_CONHECIDAS };
