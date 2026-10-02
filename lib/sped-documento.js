/**
 * XML DA NF-e -> DOCUMENTO FISCAL ESCRITURADO (fiscal_documentos).
 *
 * UMA FUNÇÃO PARA TRÊS ORIGENS, e é por isso que ela parte do XML:
 *
 *   - a nota EMITIDA pela Focus: o XML autorizado fica em `nfe_arquivos`;
 *   - a nota de ENTRADA: o XML fica em `nfe_entrada.xml`;
 *   - a nota que existe FORA do sistema (as que o ViperERP emitiu): o XML que
 *     alguém importar.
 *
 * O XML é o documento que a SEFAZ autorizou. `payload_enviado` é o que este
 * sistema PEDIU — a Focus completa, arredonda e às vezes recusa campo. Escriturar
 * o pedido em vez do autorizado é declarar ao Fisco uma nota que não existe.
 *
 * Puro: recebe texto, devolve o payload de `criarDocumento`
 * (lib/db/fiscal-documentos.js) e avisos. Não conhece banco.
 */

const { lerNotaDeEntrada } = require('./entradaNfe');

const so = (v) => String(v ?? '').replace(/\D/g, '');
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * O CFOP DA ENTRADA a partir do CFOP do fornecedor.
 *
 * A nota do fornecedor traz o CFOP DELE (5102, venda). O SPED de quem recebe
 * escritura o da ENTRADA (1102, compra para comercialização). A troca do
 * primeiro dígito (5->1, 6->2, 7->3) resolve a maioria; o resto do código
 * também muda em quatro casos, porque a operação do outro lado tem outro nome:
 *
 *   x101  venda de produção própria   -> x102 compra para comercialização
 *   x401, x402, x403, x405  venda com ST -> x403 compra para comercialização com ST
 *
 * O que ISTO NÃO SABE é a FINALIDADE da compra: o mesmo 5102 do fornecedor é
 * 1102 se a mercadoria é para revender, 1556 se é uso e consumo e 1551 se é
 * ativo imobilizado. Isso é escolha de quem recebe, e esta função escolhe
 * revenda — o caso desta empresa — e DEVOLVE `derivado: true` para a tela
 * listar cada conversão feita.
 */
function cfopDeEntrada(cfop) {
  const c = so(cfop);
  if (!/^\d{4}$/.test(c)) return { cfop: null, derivado: false };
  const primeiro = { 5: '1', 6: '2', 7: '3' }[c[0]];
  if (!primeiro) return { cfop: c, derivado: false }; // já é de entrada
  let resto = c.slice(1);
  if (resto === '101') resto = '102';
  if (['401', '402', '403', '405'].includes(resto)) resto = '403';
  return { cfop: primeiro + resto, derivado: true, original: c };
}

/**
 * O participante do 0150, no formato que `retratoDoParticipante` lê.
 *
 * COD_PART é o CNPJ/CPF: estável, único, e o mesmo que outra nota do mesmo
 * fornecedor vai trazer. Quem não tem documento (estrangeiro) ganha o nome.
 */
function participanteDaParte(parte) {
  if (!parte || (!parte.documento && !parte.nome)) return null;
  const e = parte.endereco || {};
  const ie = String(parte.inscricaoEstadual || '').toUpperCase() === 'ISENTO' ? '' : parte.inscricaoEstadual;
  return {
    code: parte.documento || `EX-${String(parte.nome).slice(0, 50)}`,
    name: parte.nome,
    document: parte.documento,
    stateRegistration: ie,
    municipalRegistration: parte.inscricaoMunicipal,
    countryCode: e.codigoPais || '1058',
    ibgeCityCode: e.codigoMunicipio,
    street: e.logradouro,
    streetNumber: e.numero,
    addressComplement: e.complemento,
    neighborhood: e.bairro,
    zipCode: e.cep,
    city: e.municipio,
    state: e.uf
  };
}

/** C100 IND_PGTO: 0 à vista, 1 a prazo, 2 outros. */
function indicadorDePagamento(nota) {
  if ((nota.duplicatas || []).length) return 1;
  const pags = nota.pagamentos || [];
  if (pags.length && pags.every((p) => p.codigo === '90')) return 2;
  return 0;
}

/**
 * O DOCUMENTO.
 *
 *   documentoDoXml(xml, {
 *     cnpjEstabelecimento,   // decide se a nota é EMISSÃO PRÓPRIA ou de terceiro
 *     dataEntrada,           // aaaa-mm-dd; para a nota de terceiro é o DT_E_S
 *     produtoPorItem         // { [nItem]: product_id } — o vínculo que a entrada fez
 *   })
 *
 * Devolve { payload, itens, avisos, nota } — `payload`/`itens` prontos para
 * `criarDocumento`, sem `origem` nem ponteiros (nfeId, nfeEntradaId), que são
 * de quem chama.
 */
function documentoDoXml(xml, { cnpjEstabelecimento, dataEntrada, produtoPorItem = {} } = {}) {
  const nota = lerNotaDeEntrada(xml);
  const avisos = [];
  const estab = so(cnpjEstabelecimento);
  const emitente = nota.emitente || {};
  const destinatario = nota.destinatario || null;

  const emissaoPropria = Boolean(estab) && so(emitente.documento) === estab;
  if (!emissaoPropria && destinatario && estab && so(destinatario.documento) !== estab) {
    avisos.push(`a nota ${nota.numero} não é deste CNPJ: emitente ${emitente.documento}, destinatário ${destinatario.documento}`);
  }

  // tpNF é a visão de quem EMITIU. Na nota própria vale como está; na de
  // terceiro, saída dele é entrada minha.
  const sentido = emissaoPropria
    ? (nota.tipoOperacao === '0' ? 'ENTRADA' : 'SAIDA')
    : (nota.tipoOperacao === '0' ? 'SAIDA' : 'ENTRADA');
  if (!emissaoPropria && nota.tipoOperacao === '0') {
    avisos.push(`a nota ${nota.numero} de ${emitente.nome} é uma ENTRADA para quem a emitiu; escriturada como saída`);
  }

  const participante = participanteDaParte(emissaoPropria ? destinatario : emitente);
  const conversoes = [];

  const itens = (nota.itens || []).map((it) => {
    let cfop = so(it.cfop) || null;
    if (!emissaoPropria) {
      const c = cfopDeEntrada(cfop);
      if (c.derivado) conversoes.push(`${c.original}->${c.cfop}`);
      cfop = c.cfop;
    }
    const icms = it.icms || {};
    const tributos = [];
    if (icms.cst) {
      tributos.push({
        tributo: 'ICMS', cst: icms.cst, baseCalculo: n(icms.base), aliquota: n(icms.aliquota),
        valor: n(icms.valor), reducaoBase: icms.reducaoBase ? n(icms.reducaoBase) : undefined
      });
    }
    if (n(icms.valorSt) || n(icms.baseSt)) {
      tributos.push({ tributo: 'ICMS_ST', baseCalculo: n(icms.baseSt), aliquota: n(icms.aliquotaSt), valor: n(icms.valorSt) });
    }
    if (n(icms.valorFcpSt)) tributos.push({ tributo: 'FCP_ST', valor: n(icms.valorFcpSt) });
    if (it.difal && (n(it.difal.valor) || n(it.difal.fcp))) {
      tributos.push({ tributo: 'ICMS_DIFAL', valor: n(it.difal.valor) });
    }
    for (const [chave, nome] of [['ipi', 'IPI'], ['pis', 'PIS'], ['cofins', 'COFINS']]) {
      const t = it[chave] || {};
      if (!t.cst) continue;
      tributos.push({ tributo: nome, cst: t.cst, baseCalculo: n(t.base), aliquota: n(t.aliquota), valor: n(t.valor) });
    }
    return {
      numero: it.numero,
      productId: produtoPorItem[it.numero] || null,
      codigoItem: it.codigo,
      descricao: it.descricao,
      quantidade: n(it.quantidade),
      unidade: it.unidade,
      valorUnitario: n(it.valorUnitario),
      valorTotal: n(it.valorTotal),
      valorDesconto: n(it.desconto),
      valorFrete: n(it.frete),
      valorSeguro: n(it.seguro),
      valorOutras: n(it.outros),
      cfop,
      ncm: so(it.ncm) || null,
      cest: so(it.cest) || null,
      origem: icms.origem === '' || icms.origem === undefined ? null : Number(icms.origem),
      tributos
    };
  });
  if (conversoes.length) {
    const unicas = [...new Set(conversoes)];
    avisos.push(`CFOP de entrada derivado do CFOP do fornecedor na nota ${nota.numero}: ${unicas.join(', ')}`);
  }

  const t = nota.totais || {};
  const dataEmissao = nota.dataEmissao || null;
  const payload = {
    sentido,
    emissaoPropria,
    modelo: nota.modelo || '55',
    serie: nota.serie || null,
    numero: nota.numero,
    chaveAcesso: so(nota.chave) || null,
    dataEmissao,
    // DT_E_S: para a nota de terceiro é o dia em que ela ENTROU aqui, e é por
    // ele que o C100 cai no mês. Para a própria, a saída que a nota declara.
    dataMovimento: emissaoPropria ? (nota.dataSaidaEntrada || dataEmissao) : (dataEntrada || dataEmissao),
    situacao: 'REGULAR',
    participante,
    valorTotal: n(t.nota),
    valorProdutos: n(t.produtos),
    valorDesconto: n(t.desconto),
    valorFrete: n(t.frete),
    valorSeguro: n(t.seguro),
    valorOutras: n(t.outros),
    valorBcIcms: n(t.baseIcms),
    valorIcms: n(t.icms),
    valorBcIcmsSt: n(t.baseIcmsSt),
    valorIcmsSt: n(t.icmsSt),
    valorIpi: n(t.ipi),
    valorPis: n(t.pis),
    valorCofins: n(t.cofins),
    indicadorPagamento: indicadorDePagamento(nota),
    modalidadeFrete: nota.modalidadeFrete === '' ? null : Number(nota.modalidadeFrete),
    observacaoFiscal: nota.informacoesComplementares || null
  };

  if (nota.ambiente && nota.ambiente !== '1') {
    avisos.push(`a nota ${nota.numero} é de HOMOLOGAÇÃO (tpAmb ${nota.ambiente}) — não tem valor fiscal`);
  }

  return { payload, itens, avisos, nota };
}

module.exports = { documentoDoXml, cfopDeEntrada, participanteDaParte };
