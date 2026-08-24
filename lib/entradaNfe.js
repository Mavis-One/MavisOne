/**
 * ENTRADA DE NF-e — ler o XML do fornecedor e dizer o que dele já existe aqui.
 *
 * O QUE ESTE ARQUIVO FAZ, E O QUE NÃO FAZ
 * ---------------------------------------
 * Tudo aqui é função pura: XML entra, objeto sai. Nada grava, nada consulta
 * banco. Quem grava é a rota (server.js) DEPOIS de o usuário confirmar. Essa
 * separação é o ponto do desenho: analisar uma nota não pode criar fornecedor,
 * produto nem movimento de estoque por conta própria — arrastar um XML para a
 * tela é um gesto de "deixa eu ver o que tem aqui", não de "lança isso".
 *
 * A CONFERÊNCIA
 * -------------
 * `montarConferencia` responde três perguntas, e é para elas que a tela existe:
 *
 *   1. Quem é o fornecedor? Já está cadastrado (achado pelo CNPJ/CPF, nunca
 *      pelo nome) ou é novo? Se é novo, aqui vai a ficha pronta para cadastrar,
 *      montada com os dados que a própria SEFAZ carimbou.
 *   2. O que é cada item? Já é produto meu, e por qual critério casou?
 *   3. O que impede o lançamento? (chave repetida, nota emitida por mim mesmo,
 *      nota endereçada a outro CNPJ.)
 *
 * POR QUE O CASAMENTO DE ITEM MOSTRA O CRITÉRIO
 * ---------------------------------------------
 * Casar por GTIN é quase certeza; casar por descrição é um palpite. Se a tela
 * mostrasse os dois do mesmo jeito, o palpite entraria no estoque com a mesma
 * confiança do código de barras — e ninguém descobriria até o inventário. Por
 * isso cada vínculo carrega `por` e `confianca`, e a tela trata palpite como
 * palpite.
 *
 * O DE-PARA QUE APRENDE
 * ---------------------
 * `cProd` é o código do produto NA CASA DO FORNECEDOR, não na minha. Casar meu
 * SKU com o código dele acerta às vezes e erra feio outras. Então, quando
 * alguém vincula um item na mão, esse vínculo fica gravado no item da entrada;
 * na próxima nota do MESMO fornecedor com o MESMO cProd, o vínculo é sugerido
 * de novo (`vinculosAnteriores`). É um de-para que se constrói sozinho, sem
 * tabela nova e sem ninguém preencher cadastro de código de fornecedor.
 */

const { parseXml, achar, filhos, txt, num, erroXml } = require('./nfeXml');

function digitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// cEAN vem preenchido com "SEM GTIN" quando o produto não tem código de barras
// — é o que o layout manda escrever. Tratar isso como código faria TODOS os
// produtos sem GTIN casarem entre si.
function eanValido(valor) {
  const limpo = digitos(valor);
  if (!limpo) return '';
  if (!/^\d{8}$|^\d{12,14}$/.test(limpo)) return '';
  if (/^0+$/.test(limpo)) return '';
  return limpo;
}

function dataDoDhEmi(valor) {
  // dhEmi vem como 2026-08-20T10:15:00-03:00. Os 10 primeiros caracteres já são
  // a data local do emitente — cortar é mais correto do que passar por Date,
  // que converteria para UTC e trocaria o dia em nota emitida depois das 21h.
  const texto = String(valor || '').trim();
  return texto.slice(0, 10);
}

function lerEndereco(no) {
  if (!no) return {};
  return {
    logradouro: txt(no, 'xLgr'),
    numero: txt(no, 'nro'),
    complemento: txt(no, 'xCpl'),
    bairro: txt(no, 'xBairro'),
    codigoMunicipio: txt(no, 'cMun'),
    municipio: txt(no, 'xMun'),
    uf: txt(no, 'UF'),
    cep: digitos(txt(no, 'CEP')),
    codigoPais: txt(no, 'cPais') || '1058',
    pais: txt(no, 'xPais') || 'Brasil',
    telefone: digitos(txt(no, 'fone'))
  };
}

function lerParte(no, tagEndereco) {
  if (!no) return null;
  const cnpj = digitos(txt(no, 'CNPJ'));
  const cpf = digitos(txt(no, 'CPF'));
  return {
    documento: cnpj || cpf,
    tipoDocumento: cnpj ? 'CNPJ' : (cpf ? 'CPF' : ''),
    nome: txt(no, 'xNome'),
    fantasia: txt(no, 'xFant'),
    inscricaoEstadual: txt(no, 'IE'),
    inscricaoMunicipal: txt(no, 'IM'),
    cnae: txt(no, 'CNAE'),
    // CRT do emitente: 1=Simples, 2=Simples excesso de sublimite, 3=Regime
    // normal. Fica guardado porque muda o crédito de ICMS na entrada — quem
    // apura precisa ver, mesmo que o sistema ainda não apure.
    regimeTributario: txt(no, 'CRT'),
    email: txt(no, 'email'),
    endereco: lerEndereco(achar(no, tagEndereco))
  };
}

function lerImpostoDoItem(no) {
  const imposto = achar(no, 'imposto');
  if (!imposto) return { icms: {}, ipi: {}, pis: {}, cofins: {} };

  // O grupo do ICMS muda de nome conforme a tributação (ICMS00, ICMS20,
  // ICMSSN102...). Em vez de listar os quinze, pego o primeiro filho de <ICMS>:
  // só existe um, e é sempre ele.
  const icmsPai = achar(imposto, 'ICMS');
  const icmsNo = icmsPai && icmsPai.filhos[0] ? icmsPai.filhos[0] : null;
  const ipiPai = achar(imposto, 'IPI');
  const ipiNo = ipiPai ? (filhos(ipiPai, 'IPITrib')[0] || filhos(ipiPai, 'IPINT')[0] || null) : null;
  const pisPai = achar(imposto, 'PIS');
  const pisNo = pisPai && pisPai.filhos[0] ? pisPai.filhos[0] : null;
  const cofinsPai = achar(imposto, 'COFINS');
  const cofinsNo = cofinsPai && cofinsPai.filhos[0] ? cofinsPai.filhos[0] : null;

  return {
    icms: icmsNo ? {
      grupo: icmsNo.nome,
      origem: txt(icmsNo, 'orig'),
      // CST no regime normal, CSOSN no Simples: são campos diferentes e nunca
      // aparecem juntos.
      cst: txt(icmsNo, 'CST') || txt(icmsNo, 'CSOSN'),
      base: num(icmsNo, 'vBC'),
      aliquota: num(icmsNo, 'pICMS'),
      valor: num(icmsNo, 'vICMS'),
      baseSt: num(icmsNo, 'vBCST'),
      valorSt: num(icmsNo, 'vICMSST')
    } : {},
    ipi: ipiNo ? { cst: txt(ipiNo, 'CST'), aliquota: num(ipiNo, 'pIPI'), valor: num(ipiNo, 'vIPI') } : {},
    pis: pisNo ? { cst: txt(pisNo, 'CST'), aliquota: num(pisNo, 'pPIS'), valor: num(pisNo, 'vPIS') } : {},
    cofins: cofinsNo ? { cst: txt(cofinsNo, 'CST'), aliquota: num(cofinsNo, 'pCOFINS'), valor: num(cofinsNo, 'vCOFINS') } : {}
  };
}

function lerItem(det) {
  const prod = achar(det, 'prod');
  const impostos = lerImpostoDoItem(det);
  return {
    numero: Number(det.atributos.nItem || 0) || 0,
    codigo: txt(prod, 'cProd'),
    ean: eanValido(txt(prod, 'cEAN')),
    eanBruto: txt(prod, 'cEAN'),
    descricao: txt(prod, 'xProd'),
    ncm: txt(prod, 'NCM'),
    cest: txt(prod, 'CEST'),
    cfop: txt(prod, 'CFOP'),
    unidade: txt(prod, 'uCom'),
    quantidade: num(prod, 'qCom'),
    valorUnitario: num(prod, 'vUnCom'),
    valorTotal: num(prod, 'vProd'),
    desconto: num(prod, 'vDesc'),
    frete: num(prod, 'vFrete'),
    seguro: num(prod, 'vSeg'),
    outros: num(prod, 'vOutro'),
    unidadeTributavel: txt(prod, 'uTrib'),
    quantidadeTributavel: num(prod, 'qTrib'),
    // indTot=0 significa "não compõe o total da nota" (brinde, item de
    // controle). Quem confere o total precisa saber disso.
    compoeTotal: txt(prod, 'indTot') !== '0',
    informacaoAdicional: txt(det, 'infAdProd'),
    ...impostos
  };
}

function lerTotais(inf) {
  const t = achar(inf, 'ICMSTot');
  if (!t) return {};
  return {
    baseIcms: num(t, 'vBC'),
    icms: num(t, 'vICMS'),
    baseIcmsSt: num(t, 'vBCST'),
    icmsSt: num(t, 'vST'),
    produtos: num(t, 'vProd'),
    frete: num(t, 'vFrete'),
    seguro: num(t, 'vSeg'),
    desconto: num(t, 'vDesc'),
    ipi: num(t, 'vIPI'),
    pis: num(t, 'vPIS'),
    cofins: num(t, 'vCOFINS'),
    outros: num(t, 'vOutro'),
    nota: num(t, 'vNF')
  };
}

function lerDuplicatas(inf) {
  const cobr = achar(inf, 'cobr');
  if (!cobr) return [];
  return filhos(cobr, 'dup').map((dup, i) => ({
    numero: txt(dup, 'nDup') || String(i + 1).padStart(3, '0'),
    vencimento: txt(dup, 'dVenc'),
    valor: num(dup, 'vDup')
  }));
}

const FORMAS_PAGAMENTO = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito',
  '05': 'Crédito na loja', '10': 'Vale alimentação', '11': 'Vale refeição', '12': 'Vale presente',
  '13': 'Vale combustível', '14': 'Duplicata mercantil', '15': 'Boleto bancário',
  '16': 'Depósito bancário', '17': 'PIX', '18': 'Transferência bancária', '19': 'Programa de fidelidade',
  '90': 'Sem pagamento', '99': 'Outros'
};

function lerPagamentos(inf) {
  const pag = achar(inf, 'pag');
  if (!pag) return [];
  return filhos(pag, 'detPag').map((det) => {
    const codigo = txt(det, 'tPag');
    return { codigo, forma: FORMAS_PAGAMENTO[codigo] || codigo, valor: num(det, 'vPag') };
  });
}

/**
 * XML da NF-e -> objeto normalizado. Não sabe nada do banco.
 */
function lerNotaDeEntrada(xml) {
  const raiz = parseXml(xml);
  const inf = achar(raiz, 'infNFe');
  if (!inf) {
    // O caso mais comum aqui é o "resumo" (resNFe) que vem da consulta de
    // destinatário: ele tem chave e valor, mas não tem item nenhum. Dizer isso
    // é mais útil do que "XML inválido".
    if (achar(raiz, 'resNFe')) {
      throw erroXml('Este XML é o RESUMO da nota (resNFe), não a nota completa. Baixe o XML da NF-e junto ao fornecedor ou pelo portal da SEFAZ.');
    }
    throw erroXml('Não encontrei a NF-e neste arquivo. Envie o XML da nota (o que tem <infNFe> dentro).');
  }

  const ide = achar(inf, 'ide');
  const protocolo = achar(raiz, 'infProt');
  const chave = digitos(inf.atributos.Id || '') || digitos(txt(protocolo, 'chNFe'));

  return {
    chave,
    versao: inf.atributos.versao || '',
    modelo: txt(ide, 'mod'),
    serie: txt(ide, 'serie'),
    numero: txt(ide, 'nNF'),
    dataEmissao: dataDoDhEmi(txt(ide, 'dhEmi') || txt(ide, 'dEmi')),
    dataSaidaEntrada: dataDoDhEmi(txt(ide, 'dhSaiEnt')),
    naturezaOperacao: txt(ide, 'natOp'),
    // tpNF é a visão do EMITENTE: a nota do fornecedor é saída (1) para ele e
    // entrada para mim. tpNF=0 numa nota de terceiro é devolução que ele
    // registrou como entrada dele.
    tipoOperacao: txt(ide, 'tpNF'),
    finalidade: txt(ide, 'finNFe'),
    ambiente: txt(ide, 'tpAmb'),
    emitente: lerParte(achar(inf, 'emit'), 'enderEmit'),
    destinatario: lerParte(achar(inf, 'dest'), 'enderDest'),
    itens: filhos(inf, 'det').map(lerItem),
    totais: lerTotais(inf),
    duplicatas: lerDuplicatas(inf),
    pagamentos: lerPagamentos(inf),
    informacoesComplementares: txt(achar(inf, 'infAdic'), 'infCpl'),
    protocolo: protocolo ? {
      numero: txt(protocolo, 'nProt'),
      recebidoEm: txt(protocolo, 'dhRecbto'),
      status: txt(protocolo, 'cStat'),
      motivo: txt(protocolo, 'xMotivo')
    } : null
  };
}

/**
 * Ficha de cadastro montada com os dados do XML.
 *
 * Os nomes dos campos são os MESMOS do formulário de Cadastros, de propósito:
 * isto é postado na rota que já existe (/api/cadastros/cnpjs ou /pessoas), e
 * não numa rota nova. Um segundo caminho de criação de cadastro significaria
 * uma segunda validação de CNPJ, uma segunda checagem de duplicidade e uma
 * segunda permissão para manter em dia — e a que ficasse para trás seria a
 * porta aberta.
 */
function sugerirCadastroDoEmitente(emitente) {
  if (!emitente || !emitente.documento) return null;
  const e = emitente.endereco || {};
  return {
    tipo: emitente.tipoDocumento === 'CPF' ? 'pessoa' : 'cnpj',
    document: emitente.documento,
    name: emitente.nome,
    tradeName: emitente.fantasia || '',
    email: emitente.email || '',
    phone: e.telefone || '',
    stateRegistration: emitente.inscricaoEstadual || '',
    municipalRegistration: emitente.inscricaoMunicipal || '',
    mainCnae: emitente.cnae || '',
    zipCode: e.cep || '',
    address: e.logradouro || '',
    addressNumber: e.numero || '',
    addressComplement: e.complemento || '',
    neighborhood: e.bairro || '',
    city: e.municipio || '',
    state: e.uf || '',
    ibgeCityCode: e.codigoMunicipio || '',
    country: e.pais || 'Brasil',
    countryCode: e.codigoPais || '1058',
    // Marcar o papel é o que faz o cadastro aparecer filtrado como fornecedor
    // depois. Sem isso ele entra como "sem papel" e some no meio dos clientes.
    roles: ['Fornecedor'],
    status: 'ativo',
    // Vai para o campo Observações do cadastro. Daqui a seis meses, quando
    // alguém estranhar um cadastro que ninguém lembra de ter feito, esta linha
    // responde de onde ele veio.
    notes: 'Cadastrado a partir do XML de uma NF-e de entrada.'
  };
}

function acharCadastro(diretorio, documento) {
  const alvo = digitos(documento);
  if (!alvo) return null;
  // Só por documento. Casar fornecedor por NOME é como o cadastro duplicado
  // nasce: "COMERCIAL X LTDA" e "Comercial X" viram dois, e a partir daí metade
  // das compras vai para cada um.
  return (diretorio || []).find((entrada) => digitos(entrada.document) === alvo) || null;
}

/**
 * Item do XML -> produto do estoque.
 * Devolve { produtoId, por, confianca } ou null.
 */
function vincularItem(item, produtos, vinculosAnteriores = {}) {
  // 1. De-para aprendido: alguém já disse, numa nota anterior DESTE fornecedor,
  //    que este código é este produto. Ganha de tudo — é a única fonte que veio
  //    de uma pessoa conferindo.
  const anterior = vinculosAnteriores[item.codigo];
  if (anterior && produtos.some((p) => p.id === anterior)) {
    return { produtoId: anterior, por: 'historico', confianca: 'alta' };
  }

  // 2. GTIN. Código global de produto: se bate, é o mesmo item.
  if (item.ean) {
    const porEan = produtos.find((p) => eanValido(p.ean) && eanValido(p.ean) === item.ean);
    if (porEan) return { produtoId: porEan.id, por: 'gtin', confianca: 'alta' };
  }

  // 3. SKU igual ao código do fornecedor. Acontece bastante (o código dele
  //    virou o meu quando alguém cadastrou o produto copiando a nota), mas é
  //    coincidência estrutural, não garantia.
  if (item.codigo) {
    const alvo = normalizar(item.codigo);
    const porSku = produtos.find((p) => p.sku && normalizar(p.sku) === alvo);
    if (porSku) return { produtoId: porSku.id, por: 'codigo', confianca: 'media' };
  }

  // 4. Descrição idêntica depois de normalizar. É palpite, e vai marcado como
  //    tal: dois produtos diferentes podem se chamar igual.
  const alvoNome = normalizar(item.descricao);
  if (alvoNome.length >= 4) {
    const porNome = produtos.find((p) => normalizar(p.name) === alvoNome);
    if (porNome) return { produtoId: porNome.id, por: 'descricao', confianca: 'baixa' };
  }

  return null;
}

/**
 * Ficha de produto montada com os dados do item — para cadastrar o que ainda
 * não existe. NCM, unidade e GTIN vêm da nota; PREÇO DE VENDA não vem, e não é
 * esquecimento: o XML só diz quanto eu paguei.
 */
function sugerirProdutoDoItem(item) {
  return {
    name: item.descricao,
    sku: item.codigo || '',
    ean: item.ean || '',
    ncm: item.ncm || '',
    cest: item.cest || '',
    unidadeComercial: item.unidade || '',
    unidadeTributavel: item.unidadeTributavel || item.unidade || '',
    origem: item.icms && item.icms.origem !== undefined && item.icms.origem !== '' ? Number(item.icms.origem) : null,
    costPrice: Number(item.valorUnitario || 0),
    salePrice: 0,
    stockQuantity: 0
  };
}

/**
 * A conferência inteira: nota lida + o que dela já existe aqui + o que impede
 * o lançamento.
 */
function montarConferencia({
  nota,
  diretorio = [],
  produtos = [],
  vinculosAnteriores = {},
  documentosProprios = [],
  entradaExistente = null
}) {
  const proprios = (documentosProprios || []).map(digitos).filter(Boolean);
  const emitente = nota.emitente || {};
  const destinatario = nota.destinatario || {};

  const cadastro = acharCadastro(diretorio, emitente.documento);
  const fornecedor = cadastro
    ? { situacao: 'cadastrado', cadastro, sugestao: null }
    : { situacao: 'nao-cadastrado', cadastro: null, sugestao: sugerirCadastroDoEmitente(emitente) };

  const itens = nota.itens.map((item) => {
    const vinculo = vincularItem(item, produtos, vinculosAnteriores);
    const produto = vinculo ? produtos.find((p) => p.id === vinculo.produtoId) : null;
    return {
      ...item,
      vinculo: vinculo ? { ...vinculo, nomeProduto: produto ? produto.name : '' } : null,
      sugestaoProduto: vinculo ? null : sugerirProdutoDoItem(item)
    };
  });

  const bloqueios = [];
  const avisos = [];

  if (entradaExistente) {
    bloqueios.push({
      chave: 'duplicidade',
      mensagem: `Esta nota já foi lançada em ${entradaExistente.criadoEm ? String(entradaExistente.criadoEm).slice(0, 10) : 'outra data'} (${entradaExistente.id}).`
    });
  }
  if (proprios.length && proprios.includes(digitos(emitente.documento))) {
    bloqueios.push({
      chave: 'emitente-proprio',
      mensagem: 'Esta nota foi emitida por você, não por um fornecedor. Nota própria não entra como entrada.'
    });
  }
  if (nota.chave && nota.chave.length !== 44) {
    bloqueios.push({ chave: 'chave', mensagem: 'A chave de acesso não tem 44 dígitos. O arquivo pode estar truncado.' });
  }
  if (!nota.itens.length) {
    bloqueios.push({ chave: 'sem-itens', mensagem: 'A nota não tem nenhum item.' });
  }

  // O destinatário só vira aviso quando EU sei quem eu sou. Sem estabelecimento
  // cadastrado, a comparação não teria com o que comparar e acusaria toda nota.
  if (proprios.length && destinatario.documento && !proprios.includes(digitos(destinatario.documento))) {
    avisos.push({
      chave: 'destinatario',
      mensagem: `A nota foi endereçada a ${destinatario.nome || destinatario.documento}, que não é um estabelecimento seu. Confira se é o XML certo.`
    });
  }
  if (nota.modelo && nota.modelo !== '55') {
    avisos.push({ chave: 'modelo', mensagem: `Modelo ${nota.modelo} — esta tela foi feita para NF-e (modelo 55).` });
  }
  if (nota.ambiente === '2') {
    avisos.push({ chave: 'homologacao', mensagem: 'Nota emitida em HOMOLOGAÇÃO. Não tem valor fiscal.' });
  }
  if (nota.protocolo && nota.protocolo.status && !['100', '150'].includes(nota.protocolo.status)) {
    avisos.push({ chave: 'protocolo', mensagem: `A SEFAZ respondeu ${nota.protocolo.status} — ${nota.protocolo.motivo || 'sem motivo informado'}.` });
  }
  const semVinculo = itens.filter((item) => !item.vinculo).length;
  if (semVinculo) {
    avisos.push({
      chave: 'itens-sem-produto',
      mensagem: `${semVinculo} ${semVinculo === 1 ? 'item não tem' : 'itens não têm'} produto correspondente no estoque.`
    });
  }
  const palpites = itens.filter((item) => item.vinculo && item.vinculo.confianca === 'baixa').length;
  if (palpites) {
    avisos.push({
      chave: 'vinculo-fraco',
      mensagem: `${palpites} ${palpites === 1 ? 'item foi casado' : 'itens foram casados'} só pela descrição. Confira antes de lançar.`
    });
  }

  const somaItens = itens.reduce((total, item) => total + Number(item.valorTotal || 0), 0);
  if (nota.totais && nota.totais.produtos && Math.abs(somaItens - nota.totais.produtos) > 0.02) {
    avisos.push({
      chave: 'total-divergente',
      mensagem: `A soma dos itens (${somaItens.toFixed(2)}) não bate com o total de produtos da nota (${Number(nota.totais.produtos).toFixed(2)}).`
    });
  }

  return { nota, fornecedor, itens, bloqueios, avisos };
}

module.exports = {
  lerNotaDeEntrada,
  sugerirCadastroDoEmitente,
  sugerirProdutoDoItem,
  vincularItem,
  acharCadastro,
  montarConferencia,
  digitos,
  normalizar,
  eanValido
};
