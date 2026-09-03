/**
 * O DOCUMENTO DE COMPRA no banco. Tabela da fase-aq: `purchase_orders`.
 *
 * Cotação e ordem são o MESMO registro em pontos diferentes da vida — quem
 * decide qual é o status. Ver o cabeçalho de public/modules/shared/purchase_status.js
 * e o da migração fase-aq.
 *
 * DUAS AUSÊNCIAS DELIBERADAS
 * --------------------------
 * 1. Não há `excluirDocumento` que apague ordem já recebida. Documento que
 *    movimentou estoque tem movimento apontando para ele no razão; apagá-lo
 *    deixaria o razão citando uma ordem que não existe. Ordem recebida se
 *    ESTORNA (volta o estoque) e depois se cancela — nunca some.
 *
 * 2. Não há `duplicar` para transformar cotação em ordem. Aprovar uma cotação é
 *    mudar o status dela. Copiar criaria dois registros e a ordem não saberia
 *    mais de que cotação nasceu.
 */

const { banco, createId, assertNoError } = require('./client');
const { consultar } = require('./conexao');

function mapDocumento(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code == null ? null : Number(row.code),
    type: row.type,
    status: row.status,
    supplierId: row.supplier_id || '',
    supplierName: row.supplier_name || '',
    companyId: row.company_id || '',
    depositId: row.deposit_id || '',
    date: row.date,
    deliveryDate: row.delivery_date || null,
    note: row.note || '',
    items: Array.isArray(row.items) ? row.items : [],
    itemsTotal: Number(row.items_total || 0),
    freight: Number(row.freight || 0),
    otherExpenses: Number(row.other_expenses || 0),
    discountAmount: Number(row.discount_amount || 0),
    totalAmount: Number(row.total_amount || 0),
    stockApplied: Boolean(row.stock_applied),
    financeApplied: Boolean(row.finance_applied),
    entradaNfeId: row.entrada_nfe_id || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function linhaDoPayload(payload) {
  return {
    type: payload.type,
    status: payload.status,
    supplier_id: payload.supplierId || null,
    supplier_name: payload.supplierName || '',
    company_id: payload.companyId || null,
    deposit_id: payload.depositId || '',
    date: payload.date,
    delivery_date: payload.deliveryDate || null,
    note: payload.note || '',
    items: payload.items || [],
    items_total: Number(payload.itemsTotal || 0),
    freight: Number(payload.freight || 0),
    other_expenses: Number(payload.otherExpenses || 0),
    discount_amount: Number(payload.discountAmount || 0),
    total_amount: Number(payload.totalAmount || 0)
  };
}

/**
 * A numeração sai da sequence do banco.
 *
 * Era o padrão antigo do sistema calcular max+1 lendo a lista inteira: reusa
 * número depois de uma exclusão e gera o mesmo duas vezes quando duas pessoas
 * gravam ao mesmo tempo. A fase AP já corrigiu isso no razão de estoque; aqui
 * nasce certo.
 *
 * É a única consulta crua deste arquivo — o construtor de `banco` não expõe
 * nextval, e embrulhá-lo numa função de banco só para isso seria mais peça para
 * manter do que uma linha de SQL.
 */
async function proximoCodigo(cliente) {
  const executar = cliente ? cliente.query.bind(cliente) : consultar;
  const { rows } = await executar("select nextval('purchase_orders_code_seq')::int as code");
  return rows[0].code;
}

async function listarDocumentos({ tipo } = {}) {
  let consulta = banco.from('purchase_orders').select('*');
  if (tipo) consulta = consulta.eq('type', tipo);
  const { data, error } = await consulta.order('date', { ascending: false });
  assertNoError(error, 'listarDocumentos');
  return (data || []).map(mapDocumento);
}

async function obterDocumento(id) {
  const { data, error } = await banco.from('purchase_orders').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'obterDocumento');
  return mapDocumento(data);
}

async function criarDocumento(payload) {
  const id = createId('pc');
  const row = {
    id,
    code: await proximoCodigo(),
    ...linhaDoPayload(payload),
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || ''
  };
  const { error } = await banco.from('purchase_orders').insert(row);
  assertNoError(error, 'criarDocumento');
  return obterDocumento(id);
}

async function atualizarDocumento(id, payload) {
  const { error } = await banco.from('purchase_orders')
    .update({ ...linhaDoPayload(payload), updated_at: new Date().toISOString() })
    .eq('id', id);
  assertNoError(error, 'atualizarDocumento');
  return obterDocumento(id);
}

/**
 * Só o status, sem tocar no resto.
 *
 * Separado do atualizarDocumento de propósito: mudar status é a operação mais
 * frequente do módulo (aprovar, enviar, receber, cancelar) e mandar o documento
 * inteiro de volta a cada clique é a receita para uma tela desatualizada
 * sobrescrever o que outra pessoa acabou de corrigir.
 */
async function atualizarStatus(id, { status, type, stockApplied, financeApplied, entradaNfeId }, cliente) {
  const campos = { status, type, updated_at: new Date().toISOString() };
  if (stockApplied !== undefined) campos.stock_applied = stockApplied;
  if (financeApplied !== undefined) campos.finance_applied = financeApplied;
  if (entradaNfeId !== undefined) campos.entrada_nfe_id = entradaNfeId || null;

  // Dentro de uma transação (recebimento) a escrita tem de ir pelo MESMO
  // cliente que gravou o razão, senão o status muda fora da transação e
  // sobrevive a um rollback que desfez o estoque.
  if (cliente) {
    const chaves = Object.keys(campos);
    const atribuicoes = chaves.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    await cliente.query(
      `update purchase_orders set ${atribuicoes} where id = $${chaves.length + 1}`,
      [...chaves.map((c) => campos[c]), id]
    );
    return null;
  }
  const { error } = await banco.from('purchase_orders').update(campos).eq('id', id);
  assertNoError(error, 'atualizarStatus');
  return obterDocumento(id);
}

/** Trava a linha do documento. Ver o porquê em commitStockMovements (fase AP). */
async function travarDocumento(cliente, id) {
  await cliente.query('select id from purchase_orders where id = $1 for update', [id]);
}

/**
 * Apaga o documento. Recusa se ele já movimentou estoque — ver o cabeçalho.
 * A checagem é aqui, e não só na rota, porque é a camada que sabe o que a
 * coluna significa.
 */
async function excluirDocumento(id) {
  const documento = await obterDocumento(id);
  if (!documento) return false;
  if (documento.stockApplied) {
    const erro = new Error('Esta ordem já deu entrada no estoque. Estorne o recebimento antes de excluir.');
    erro.status = 400;
    throw erro;
  }
  const { error } = await banco.from('purchase_orders').delete().eq('id', id);
  assertNoError(error, 'excluirDocumento');
  return true;
}

module.exports = {
  listarDocumentos, obterDocumento, criarDocumento, atualizarDocumento,
  atualizarStatus, travarDocumento, excluirDocumento, proximoCodigo
};
