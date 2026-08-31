/**
 * ENTRADA DE NF-e no banco. Tabelas da fase-ak: `nfe_entrada` e
 * `nfe_entrada_item`.
 *
 * Duas coisas guiam este arquivo:
 *
 * 1. A LISTAGEM NUNCA TRAZ O XML. A coluna `xml` guarda o documento inteiro
 *    (20 a 200 KB por nota); um `select *` na lista transformaria a abertura da
 *    tela em megabytes de tráfego que ninguém pediu. Por isso existe uma lista
 *    de colunas explícita em COLUNAS_LISTA, e o XML só sai em `obterXml`.
 *
 * 2. NÃO EXISTE `excluirEntrada`. Nota fiscal recebida não se apaga, do mesmo
 *    jeito que nota emitida não se apaga. Não é falta de função: é a ausência
 *    deliberada dela.
 */

const { banco, createId, assertNoError } = require('./client');

const COLUNAS_LISTA = [
  'id', 'chave', 'modelo', 'serie', 'numero', 'data_emissao', 'natureza_operacao',
  'emitente_documento', 'emitente_nome', 'emitente_ie', 'cadastro_id',
  'destinatario_documento', 'valor_produtos', 'valor_total', 'status',
  'movimentou_estoque', 'gerou_financeiro', 'criado_por', 'criado_por_nome', 'criado_em'
].join(', ');

function mapEntrada(row) {
  if (!row) return null;
  return {
    id: row.id,
    chave: row.chave,
    modelo: row.modelo || '',
    serie: row.serie || '',
    numero: row.numero || '',
    dataEmissao: row.data_emissao || '',
    naturezaOperacao: row.natureza_operacao || '',
    emitenteDocumento: row.emitente_documento || '',
    emitenteNome: row.emitente_nome || '',
    emitenteIe: row.emitente_ie || '',
    cadastroId: row.cadastro_id || '',
    destinatarioDocumento: row.destinatario_documento || '',
    valorProdutos: Number(row.valor_produtos || 0),
    valorTotal: Number(row.valor_total || 0),
    status: row.status || 'LANCADA',
    movimentouEstoque: row.movimentou_estoque === true,
    gerouFinanceiro: row.gerou_financeiro === true,
    criadoPor: row.criado_por || '',
    criadoPorNome: row.criado_por_nome || '',
    criadoEm: row.criado_em || '',
    resumo: row.resumo || undefined
  };
}

function mapItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    entradaId: row.entrada_id,
    numero: Number(row.numero || 0),
    codigo: row.codigo_fornecedor || '',
    ean: row.ean || '',
    descricao: row.descricao || '',
    ncm: row.ncm || '',
    cfop: row.cfop || '',
    unidade: row.unidade || '',
    quantidade: Number(row.quantidade || 0),
    valorUnitario: Number(row.valor_unitario || 0),
    valorTotal: Number(row.valor_total || 0),
    produtoId: row.product_id || '',
    vinculoOrigem: row.vinculo_origem || '',
    movimentouEstoque: row.movimentou_estoque === true,
    imposto: row.imposto || {}
  };
}

async function buscarPorChave(chave) {
  const limpa = String(chave || '').replace(/\D/g, '');
  if (limpa.length !== 44) return null;
  const { data, error } = await banco
    .from('nfe_entrada').select(COLUNAS_LISTA).eq('chave', limpa).maybeSingle();
  assertNoError(error, 'buscarPorChave');
  return mapEntrada(data);
}

async function listarEntradas({ limite = 200 } = {}) {
  const { data, error } = await banco
    .from('nfe_entrada').select(COLUNAS_LISTA)
    .order('criado_em', { ascending: false })
    .limit(limite);
  assertNoError(error, 'listarEntradas');
  return (data || []).map(mapEntrada);
}

async function obterEntrada(id) {
  const { data, error } = await banco
    .from('nfe_entrada').select(`${COLUNAS_LISTA}, resumo`).eq('id', id).maybeSingle();
  assertNoError(error, 'obterEntrada');
  if (!data) return null;
  const { data: itens, error: erroItens } = await banco
    .from('nfe_entrada_item').select('*').eq('entrada_id', id).order('numero');
  assertNoError(erroItens, 'obterEntrada.itens');
  return { ...mapEntrada(data), itens: (itens || []).map(mapItem) };
}

async function obterXml(id) {
  const { data, error } = await banco
    .from('nfe_entrada').select('id, chave, xml').eq('id', id).maybeSingle();
  assertNoError(error, 'obterXml');
  return data || null;
}

/**
 * De-para aprendido: o que este fornecedor já mandou antes e alguém vinculou.
 * Devolve { [codigoDoFornecedor]: productId }.
 *
 * Duas notas do mesmo fornecedor podem ter vinculado o mesmo código a produtos
 * diferentes (alguém errou uma vez, corrigiu na seguinte). Por isso a leitura
 * vem da mais NOVA para a mais velha e o primeiro visto vence: a correção mais
 * recente é a que vale.
 */
async function vinculosDoFornecedor(documento) {
  const limpo = String(documento || '').replace(/\D/g, '');
  if (!limpo) return {};
  const { data: entradas, error } = await banco
    .from('nfe_entrada').select('id')
    .eq('emitente_documento', limpo)
    .order('criado_em', { ascending: false })
    .limit(50);
  assertNoError(error, 'vinculosDoFornecedor.entradas');
  const ids = (entradas || []).map((e) => e.id);
  if (!ids.length) return {};

  const { data: itens, error: erroItens } = await banco
    .from('nfe_entrada_item').select('entrada_id, codigo_fornecedor, product_id')
    .in('entrada_id', ids)
    .not('product_id', 'is', null);
  assertNoError(erroItens, 'vinculosDoFornecedor.itens');

  const ordem = new Map(ids.map((id, i) => [id, i]));
  const mapa = {};
  // Ordena pela posição da entrada (0 = mais nova) e deixa a primeira gravar.
  for (const item of (itens || []).sort((a, b) => (ordem.get(a.entrada_id) ?? 0) - (ordem.get(b.entrada_id) ?? 0))) {
    const codigo = item.codigo_fornecedor || '';
    if (!codigo || mapa[codigo]) continue;
    mapa[codigo] = item.product_id;
  }
  return mapa;
}

/**
 * Grava a entrada e os itens.
 *
 * A entrada entra primeiro: o item tem FK para ela. Se a gravação dos itens
 * falhar, a entrada fica sem item — e é por isso que quem chama trata o erro
 * apagando a cabeça (o único lugar do sistema onde uma entrada é removida, e
 * ainda assim uma que nunca chegou a existir por inteiro).
 */
async function criarEntrada({ entrada, itens }) {
  const id = entrada.id || createId('ent');
  const linha = {
    id,
    chave: String(entrada.chave || '').replace(/\D/g, ''),
    modelo: entrada.modelo || null,
    serie: entrada.serie || null,
    numero: entrada.numero || null,
    data_emissao: entrada.dataEmissao || null,
    natureza_operacao: entrada.naturezaOperacao || null,
    emitente_documento: String(entrada.emitenteDocumento || '').replace(/\D/g, ''),
    emitente_nome: entrada.emitenteNome || '',
    emitente_ie: entrada.emitenteIe || null,
    cadastro_id: entrada.cadastroId || null,
    destinatario_documento: String(entrada.destinatarioDocumento || '').replace(/\D/g, '') || null,
    valor_produtos: Number(entrada.valorProdutos || 0),
    valor_total: Number(entrada.valorTotal || 0),
    status: entrada.status || 'LANCADA',
    movimentou_estoque: entrada.movimentouEstoque === true,
    gerou_financeiro: entrada.gerouFinanceiro === true,
    xml: entrada.xml || '',
    resumo: entrada.resumo || {},
    criado_por: entrada.criadoPor || null,
    criado_por_nome: entrada.criadoPorNome || '',
    criado_em: new Date().toISOString()
  };

  const { error } = await banco.from('nfe_entrada').insert(linha);
  if (error && (error.code === '23505' || /duplicate key/i.test(error.message || ''))) {
    const err = new Error('Esta nota já foi lançada. A chave de acesso é única em todo o sistema.');
    err.status = 409;
    throw err;
  }
  assertNoError(error, 'criarEntrada');

  const linhasItens = (itens || []).map((item) => ({
    id: createId('eni'),
    entrada_id: id,
    numero: Number(item.numero || 0),
    codigo_fornecedor: item.codigo || null,
    ean: item.ean || null,
    descricao: item.descricao || '',
    ncm: item.ncm || null,
    cfop: item.cfop || null,
    unidade: item.unidade || null,
    quantidade: Number(item.quantidade || 0),
    valor_unitario: Number(item.valorUnitario || 0),
    valor_total: Number(item.valorTotal || 0),
    product_id: item.produtoId || null,
    vinculo_origem: item.vinculoOrigem || null,
    movimentou_estoque: item.movimentouEstoque === true,
    imposto: item.imposto || {}
  }));

  if (linhasItens.length) {
    const { error: erroItens } = await banco.from('nfe_entrada_item').insert(linhasItens);
    if (erroItens) {
      // Cabeça sem item é pior do que nada gravado: a chave ficaria "usada" e a
      // nota nunca mais poderia ser lançada. Desfaz e devolve o erro real.
      await banco.from('nfe_entrada').delete().eq('id', id);
      assertNoError(erroItens, 'criarEntrada.itens');
    }
  }

  return obterEntrada(id);
}

module.exports = {
  buscarPorChave,
  listarEntradas,
  obterEntrada,
  obterXml,
  vinculosDoFornecedor,
  criarEntrada
};
