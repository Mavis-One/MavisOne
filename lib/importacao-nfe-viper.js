/**
 * AS NF-e DO VIPER, DAS PLANILHAS PARA DOCUMENTOS (fase DX, 11/10/2026).
 *
 * Função pura: recebe as abas lidas por lib/xlsx-leitor.js e devolve a lista
 * de documentos que a rota POST /api/fiscal/importacao/nfe grava, mais o que
 * ficou de fora e por quê. Não toca banco nem rede — é o que o teste exercita.
 *
 * AS DUAS PLANILHAS
 * -----------------
 *   DETALHADA ("NFe_SAL_Infinity_...xlsx", abas Notas e Itens) — só a MATRIZ.
 *     Com chave: notas emitidas pela matriz (saídas e entradas próprias), com
 *       protocolo, totais e itens. Entram COMPLETAS (com itens e impostos).
 *     Sem chave: entradas de fornecedor que o Viper listava sem XML ("dados da
 *       listagem"). Entram só com o cabeçalho.
 *
 *   LISTAGEM ("documentos_fiscais.xlsx") — todas as empresas, mas só número,
 *     data, participante, valor, status e natureza. Sem chave, sem série, sem
 *     itens: entram só com o cabeçalho. As linhas da MATRIZ são puladas quando a
 *     detalhada também veio (ela é a versão completa das mesmas notas).
 *
 * TODAS SÃO HISTÓRICO (fase DY, decisão do usuário em 11/10/2026): nenhuma
 * importada vai ao SPED do MavisONE — os SPEDs daqueles meses saíram do Viper.
 * `escriturar` é sempre false; `completa` diz se a nota veio com chave e itens.
 *
 * DE QUAL ESTABELECIMENTO É CADA LINHA DA LISTAGEM
 * ------------------------------------------------
 * A listagem não traz CNPJ, só o nome que o Viper dava à empresa. O mapa
 * abaixo foi CONFERIDO em 11/10/2026 cruzando número + cliente de cada nota
 * com as chaves de 967 DANFEs do Viper: cada nome casou com um CNPJ só
 * (Marcolla 134 notas, Centro 128, Guaramirim 109, Timbó 92, Barra 84,
 * Araquari 76, São Bento 51, Electric 11). FILIAL 07 e FILIAL 09 não tinham
 * DANFE na amostra e seguem o número da filial no CNPJ (0007 Vila Lalau,
 * 0009 Iririu). KACCAU ELETRIC e SAL INFINITY BY BLUMENAU não são do
 * MavisONE: o usuário mandou ignorar.
 */
const { dataDoExcel } = require('./xlsx-leitor');

const EMPRESAS_DA_LISTAGEM = {
  'SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)': '43792899000135',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 02 (MARCOLLA)': '43792899000216',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 03 (ARAQUARI)': '43792899000305',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 04 (SAO BENTO DO SUL)': '43792899000488',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 05 (TIMBO)': '43792899000569',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 06 (GUARAMIRIM)': '43792899000640',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 07 (GALPAO - DEPOSITO)': '43792899000720',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 08 (CENTRO - JOINVILLE)': '43792899000801',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 09 (IRIRIU - JOINVILLE)': '43792899000992',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 10 (BARRA)': '43792899001026',
  'SAL INFINITY ELECTRIC LTDA': '46877837000114'
};
const CNPJ_DA_MATRIZ = '43792899000135';
// Raízes de CNPJ do grupo: nota com chave destas raízes é EMISSÃO PRÓPRIA.
const RAIZES_DO_GRUPO = ['43792899', '46877837'];

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const valor = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const decimal = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function situacaoDoStatus(status) {
  const s = texto(status).toLowerCase();
  if (s === 'aprovada' || s === 'autorizada') return 'REGULAR';
  if (s === 'cancelada') return 'CANCELADO';
  return null;
}

/** 'dd/mm/aaaa hh:mm' da listagem para 'aaaa-mm-dd'. */
function dataDaListagem(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(texto(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function indicePorCabecalho(cabecalho) {
  return (nome) => {
    const i = cabecalho.indexOf(nome);
    if (i < 0) throw new Error(`Coluna "${nome}" não encontrada na planilha.`);
    return i;
  };
}

/** Os itens da aba Itens, agrupados pela chave da nota. */
function itensPorChave(abaItens) {
  const mapa = new Map();
  if (!abaItens || !abaItens.linhas.length) return mapa;
  const ix = indicePorCabecalho(abaItens.linhas[0]);
  const c = {
    chave: ix('Chave'), n: ix('nItem'), cod: ix('cProd'), desc: ix('xProd'), ncm: ix('NCM'), cfop: ix('CFOP'),
    cst: ix('CST/CSOSN'), qtd: ix('Quantidade'), un: ix('Unidade'), vun: ix('vUnit'), vprod: ix('vProd'),
    icms: ix('ICMS'), ipi: ix('IPI'), pis: ix('PIS'), cofins: ix('COFINS'), origem: ix('Origem mercadoria'),
    st: ix('ICMS ST'), desconto: ix('Desconto')
  };
  for (const l of abaItens.linhas.slice(1)) {
    const chave = soDigitos(l[c.chave]);
    if (chave.length !== 44) continue;
    const tributos = [];
    const cst = texto(l[c.cst], 3);
    if (cst || l[c.icms] !== '') tributos.push({ tributo: 'ICMS', cst: cst || null, ...(l[c.icms] !== '' ? { valor: valor(l[c.icms]) } : {}) });
    if (l[c.st] !== '') tributos.push({ tributo: 'ICMS_ST', valor: valor(l[c.st]) });
    if (l[c.ipi] !== '') tributos.push({ tributo: 'IPI', valor: valor(l[c.ipi]) });
    if (l[c.pis] !== '') tributos.push({ tributo: 'PIS', valor: valor(l[c.pis]) });
    if (l[c.cofins] !== '') tributos.push({ tributo: 'COFINS', valor: valor(l[c.cofins]) });
    const origem = texto(l[c.origem], 1);
    const item = {
      numero: Number(l[c.n]) || undefined,
      codigoItem: texto(l[c.cod], 60),
      descricao: texto(l[c.desc], 120),
      ncm: soDigitos(l[c.ncm]).slice(0, 8) || null,
      cfop: soDigitos(l[c.cfop]).slice(0, 4) || null,
      quantidade: decimal(l[c.qtd]),
      unidade: texto(l[c.un], 6) || null,
      valorUnitario: decimal(l[c.vun]),
      valorTotal: valor(l[c.vprod]),
      valorDesconto: valor(l[c.desconto]),
      origem: /^\d$/.test(origem) ? Number(origem) : null,
      tributos
    };
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(item);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => (a.numero || 0) - (b.numero || 0));
  return mapa;
}

/** A aba Notas da planilha detalhada. */
function documentosDaDetalhada(abaNotas, abaItens, ignorados) {
  const ix = indicePorCabecalho(abaNotas.linhas[0]);
  const c = {
    chave: ix('Chave'), num: ix('Número'), serie: ix('Série'), emissao: ix('Emissão'), tipo: ix('Tipo'),
    natureza: ix('Natureza da operação'), emitDoc: ix('Emitente CNPJ/CPF'), emitNome: ix('Emitente nome'),
    destDoc: ix('Destinatário CPF/CNPJ'), destNome: ix('Destinatário nome'), vprod: ix('vProd'), vdesc: ix('vDesc'),
    vfrete: ix('vFrete'), vicms: ix('vICMS'), vst: ix('vST'), vipi: ix('vIPI'), vpis: ix('vPIS'), vcofins: ix('vCOFINS'),
    vnf: ix('vNF'), status: ix('Status'), protocolo: ix('Protocolo'), idErp: ix('ID ERP')
  };
  const itens = itensPorChave(abaItens);
  const docs = [];
  abaNotas.linhas.slice(1).forEach((l, i) => {
    if (!l.some((x) => x !== '')) return;
    const linha = i + 2;
    const chave = soDigitos(l[c.chave]);
    const numero = texto(l[c.num], 20);
    const situacao = situacaoDoStatus(l[c.status]);
    const data = dataDoExcel(l[c.emissao]);
    const sentido = texto(l[c.tipo]).toLowerCase().startsWith('sa') ? 'SAIDA' : 'ENTRADA';
    if (!numero || !situacao || !data) {
      ignorados.push({ planilha: 'detalhada', linha, motivo: 'linha sem número, status reconhecido ou data' });
      return;
    }
    if (chave && chave.length !== 44) {
      ignorados.push({ planilha: 'detalhada', linha, numero, motivo: 'chave com tamanho diferente de 44' });
      return;
    }
    // Com chave, o emitente é o CNPJ da chave; sem chave, o da coluna.
    const cnpjEmitente = chave ? chave.slice(6, 20) : soDigitos(l[c.emitDoc]);
    const propria = chave ? RAIZES_DO_GRUPO.includes(cnpjEmitente.slice(0, 8)) : false;
    const estabelecimentoCnpj = propria ? cnpjEmitente : soDigitos(l[c.destDoc]);
    if (!RAIZES_DO_GRUPO.includes(estabelecimentoCnpj.slice(0, 8))) {
      ignorados.push({ planilha: 'detalhada', linha, numero, motivo: `nenhum estabelecimento do grupo na nota (${l[c.destNome] || 'sem destinatário'})` });
      return;
    }
    const participante = propria
      ? { documento: soDigitos(l[c.destDoc]), nome: texto(l[c.destNome], 120) }
      : { documento: soDigitos(l[c.emitDoc]), nome: texto(l[c.emitNome], 120) };
    const daNota = chave ? (itens.get(chave) || []) : [];
    docs.push({
      ref: 'viper:' + (texto(l[c.idErp], 30) || chave || `${estabelecimentoCnpj}:${numero}`),
      estabelecimentoCnpj,
      sentido,
      emissaoPropria: propria,
      modelo: chave ? chave.slice(20, 22) : '55',
      serie: texto(l[c.serie], 3) || null,
      numero,
      chaveAcesso: chave || null,
      protocolo: texto(l[c.protocolo], 20) || null,
      dataEmissao: data.data,
      situacao,
      participante,
      valores: {
        valorTotal: valor(l[c.vnf]),
        valorProdutos: valor(l[c.vprod]),
        valorDesconto: valor(l[c.vdesc]),
        valorFrete: valor(l[c.vfrete]),
        valorIcms: valor(l[c.vicms]),
        valorIcmsSt: valor(l[c.vst]),
        valorIpi: valor(l[c.vipi]),
        valorPis: valor(l[c.vpis]),
        valorCofins: valor(l[c.vcofins])
      },
      itens: daNota,
      completa: Boolean(chave) && daNota.length > 0,
      escriturar: false,
      natureza: texto(l[c.natureza], 60)
    });
  });
  return docs;
}

/** A planilha de listagem (todas as empresas, só cabeçalho). */
function documentosDaListagem(abaLista, { pularMatriz }, ignorados) {
  // O cabeçalho não está na primeira linha: o Viper põe título e data antes.
  const posCab = abaLista.linhas.findIndex((l) => l.includes('Número') && l.includes('Empresa'));
  if (posCab < 0) throw new Error('Cabeçalho da listagem (Número, Empresa...) não encontrado.');
  const ix = indicePorCabecalho(abaLista.linhas[posCab]);
  const c = {
    num: ix('Número'), modelo: ix('Modelo'), origem: ix('Origem'), empresa: ix('Empresa'),
    part: ix('Destinatário / Emitente'), status: ix('Status'), emissao: ix('Emissão'), valor: ix('Valor'), natureza: ix('Natureza')
  };
  const docs = [];
  abaLista.linhas.slice(posCab + 1).forEach((l, i) => {
    const linha = posCab + i + 2;
    const numero = texto(l[c.num], 20);
    if (!/^\d+$/.test(numero)) return;
    const empresa = texto(l[c.empresa]);
    const cnpj = EMPRESAS_DA_LISTAGEM[empresa];
    if (!cnpj) {
      ignorados.push({ planilha: 'listagem', linha, numero, motivo: `empresa fora do MavisONE: ${empresa}` });
      return;
    }
    if (pularMatriz && cnpj === CNPJ_DA_MATRIZ) return;
    if (texto(l[c.modelo]).toUpperCase() !== 'NFE') {
      ignorados.push({ planilha: 'listagem', linha, numero, motivo: `modelo não tratado: ${l[c.modelo]}` });
      return;
    }
    const situacao = situacaoDoStatus(l[c.status]);
    const data = dataDaListagem(l[c.emissao]);
    if (!situacao || !data) {
      ignorados.push({ planilha: 'listagem', linha, numero, motivo: 'status ou data não reconhecidos' });
      return;
    }
    // Origem do Viper: Vendas/Orçamento = saída nossa; Compras = entrada de
    // fornecedor. Vazia: decide o 1º dígito do CFOP da natureza (5/6/7 saída,
    // 1/2/3 entrada — emitida por nós, como a devolução de venda).
    const origem = texto(l[c.origem]);
    const natureza = texto(l[c.natureza], 60);
    let sentido; let propria;
    if (origem === 'Vendas' || origem === 'Orçamento') { sentido = 'SAIDA'; propria = true; }
    else if (origem === 'Compras') { sentido = 'ENTRADA'; propria = false; }
    else if (/^[567]/.test(natureza)) { sentido = 'SAIDA'; propria = true; }
    else if (/^[123]/.test(natureza)) { sentido = 'ENTRADA'; propria = true; }
    else {
      ignorados.push({ planilha: 'listagem', linha, numero, motivo: `não dá para saber se é entrada ou saída (origem "${origem}", natureza "${natureza}")` });
      return;
    }
    const nome = texto(l[c.part], 120);
    docs.push({
      ref: `viper-lista:${cnpj}:${sentido}:${propria ? 'P' : 'T'}:${numero}:${nome.toUpperCase()}`.slice(0, 200),
      estabelecimentoCnpj: cnpj,
      sentido,
      emissaoPropria: propria,
      modelo: '55',
      serie: null,
      numero,
      chaveAcesso: null,
      protocolo: null,
      dataEmissao: data,
      situacao,
      participante: { documento: '', nome },
      valores: { valorTotal: valor(l[c.valor]), valorProdutos: valor(l[c.valor]) },
      itens: [],
      completa: false,
      escriturar: false,
      natureza
    });
  });
  return docs;
}

/**
 * Monta tudo. `detalhada` = abas de lerXlsx da planilha detalhada (ou null);
 * `listagem` = abas da listagem (ou null).
 */
function montarImportacao({ detalhada = null, listagem = null } = {}) {
  const ignorados = [];
  let documentos = [];
  if (detalhada) {
    const notas = detalhada.find((a) => a.nome === 'Notas');
    const itens = detalhada.find((a) => a.nome === 'Itens');
    if (!notas) throw new Error('A planilha detalhada não tem a aba "Notas".');
    documentos = documentos.concat(documentosDaDetalhada(notas, itens, ignorados));
  }
  if (listagem) {
    documentos = documentos.concat(documentosDaListagem(listagem[0], { pularMatriz: Boolean(detalhada) }, ignorados));
  }
  // A mesma nota duas vezes na entrada (chave ou ref repetida): fica a primeira.
  const vistos = new Set();
  documentos = documentos.filter((d) => {
    const id = d.chaveAcesso || d.ref;
    if (vistos.has(id)) {
      ignorados.push({ planilha: d.ref.startsWith('viper-lista') ? 'listagem' : 'detalhada', numero: d.numero, motivo: 'repetida na planilha' });
      return false;
    }
    vistos.add(id);
    return true;
  });
  return { documentos, ignorados, resumo: resumir(documentos, ignorados) };
}

function resumir(documentos, ignorados) {
  const conta = (f) => documentos.reduce((m, d) => { const k = f(d); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    total: documentos.length,
    completas: documentos.filter((d) => d.completa).length,
    soCabecalho: documentos.filter((d) => !d.completa).length,
    itens: documentos.reduce((s, d) => s + d.itens.length, 0),
    porEstabelecimento: conta((d) => d.estabelecimentoCnpj),
    porTipo: conta((d) => `${d.sentido}${d.emissaoPropria ? ' própria' : ' de terceiro'}`),
    canceladas: documentos.filter((d) => d.situacao === 'CANCELADO').length,
    ignorados: ignorados.length
  };
}

module.exports = {
  EMPRESAS_DA_LISTAGEM, CNPJ_DA_MATRIZ, RAIZES_DO_GRUPO,
  montarImportacao, documentosDaDetalhada, documentosDaListagem, itensPorChave,
  situacaoDoStatus, dataDaListagem
};
