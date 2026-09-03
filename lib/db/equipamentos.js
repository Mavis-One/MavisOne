/**
 * EQUIPAMENTOS no banco. Tabela da fase-bb: `equipments`.
 *
 * Máquinas e equipamentos, próprios ou em posse de clientes, com a garantia
 * CONTADA a partir da NF-e que os vendeu — e não digitada. Ver o cabeçalho da
 * migração e o de public/modules/shared/garantia.js.
 *
 * A COLEÇÃO SAIU DO db.json nesta fase. Ela apontava para people/cnpjs e
 * deposits, que são tabelas, e passou a apontar também para a NF-e: registro em
 * arquivo referenciando quatro tabelas é a divisão que as fases AP, AS e BA
 * desfizeram. Foi feita agora porque a coleção tinha ZERO registros — a única
 * janela em que a mudança não custa migração de dados.
 */

const { banco, createId, assertNoError } = require('./client');
const garantia = require('../../public/modules/shared/garantia');

function mapEquipamento(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code || '',
    serialNumber: row.serial_number || '',
    model: row.model || '',
    brand: row.brand || '',
    personId: row.person_id || '',
    depositId: row.deposit_id || '',
    location: row.location || '',
    purchaseDate: row.purchase_date ? String(row.purchase_date).slice(0, 10) : '',
    purchaseValue: Number(row.purchase_value || 0),
    status: row.status || 'ativo',
    notes: row.notes || '',
    nfeId: row.nfe_id || '',
    warrantyMode: row.warranty_mode || 'prazo',
    warrantyMonths: row.warranty_months === null || row.warranty_months === undefined
      ? null
      : Number(row.warranty_months),
    warrantyUntil: row.warranty_until ? String(row.warranty_until).slice(0, 10) : '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listar() {
  const { data, error } = await banco.from('equipments').select('*').order('name', { ascending: true });
  assertNoError(error, 'listarEquipamentos');
  return (data || []).map(mapEquipamento);
}

async function obter(id) {
  const { data, error } = await banco.from('equipments').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'obterEquipamento');
  return mapEquipamento(data);
}

/**
 * A garantia, resolvida.
 *
 * `notaDaVenda` é { numero, data } da NF-e vinculada, ou null. Quem resolve a
 * nota é o chamador (o servidor, que tem as duas tabelas de NF-e em mãos) —
 * esta camada não sabe procurar nota, e não deveria.
 *
 * A DATA DA NOTA VENCE A DE AQUISIÇÃO quando as duas existem. A nota é o
 * documento; a data de aquisição é o que alguém lembrou de digitar, e é
 * justamente essa diferença que a fase inteira existe para explorar.
 */
function resolverGarantia(payload, notaDaVenda) {
  const temNota = Boolean(notaDaVenda && notaDaVenda.data);
  return garantia.calcular({
    modo: payload.warrantyMode,
    meses: payload.warrantyMonths,
    inicio: temNota ? notaDaVenda.data : payload.purchaseDate,
    inicioRotulo: temNota ? `NF-e ${notaDaVenda.numero || ''}`.trim() : 'data de aquisição',
    dataFixa: payload.warrantyUntil
  });
}

function montarLinha(payload, notaDaVenda) {
  const calculada = resolverGarantia(payload, notaDaVenda);
  return {
    name: payload.name,
    code: payload.code || '',
    serial_number: payload.serialNumber || '',
    model: payload.model || '',
    brand: payload.brand || '',
    person_id: payload.personId || '',
    deposit_id: payload.depositId || '',
    location: payload.location || '',
    purchase_date: payload.purchaseDate || null,
    purchase_value: Number(payload.purchaseValue || 0),
    status: payload.status || 'ativo',
    notes: payload.notes || '',
    nfe_id: payload.nfeId || '',
    warranty_mode: garantia.MODOS.includes(payload.warrantyMode) ? payload.warrantyMode : 'prazo',
    warranty_months: Number.isFinite(Number(payload.warrantyMonths)) && Number(payload.warrantyMonths) > 0
      ? Math.trunc(Number(payload.warrantyMonths))
      : null,
    // CALCULADO, sempre — nos dois modos. É o que faz "quais garantias vencem
    // este mês?" ser uma consulta em vez de uma varredura em JavaScript.
    warranty_until: calculada.ate || null
  };
}

/**
 * O erro de série duplicada vem do BANCO (índice único parcial sobre
 * lower(serial_number)) e é traduzido aqui. Conferir antes com um select seria
 * uma checagem que duas requisições simultâneas atravessam.
 */
function traduzirDuplicata(erro, serie) {
  const codigo = erro && (erro.code || (erro.cause && erro.cause.code));
  const texto = String((erro && erro.message) || '');
  if (codigo === '23505' || /idx_equipments_serie|duplicate key/i.test(texto)) {
    const claro = new Error(
      `Já existe um equipamento com o número de série "${serie}". `
      + 'Série repetida é a mesma máquina cadastrada duas vezes, e é assim que a assistência perde o histórico dela.'
    );
    claro.status = 409;
    return claro;
  }
  return erro;
}

async function criar(payload, notaDaVenda, user) {
  const id = createId('equip');
  const linha = {
    id,
    ...montarLinha(payload, notaDaVenda),
    created_by: user ? user.id : null,
    created_by_name: user ? user.name : null
  };
  try {
    const { error } = await banco.from('equipments').insert(linha);
    assertNoError(error, 'criarEquipamento');
  } catch (erro) {
    throw traduzirDuplicata(erro, payload.serialNumber);
  }
  return obter(id);
}

async function atualizar(id, payload, notaDaVenda) {
  try {
    const { error } = await banco.from('equipments')
      .update({ ...montarLinha(payload, notaDaVenda), updated_at: new Date().toISOString() })
      .eq('id', id);
    assertNoError(error, 'atualizarEquipamento');
  } catch (erro) {
    throw traduzirDuplicata(erro, payload.serialNumber);
  }
  return obter(id);
}

async function excluir(id) {
  const { error } = await banco.from('equipments').delete().eq('id', id);
  assertNoError(error, 'excluirEquipamento');
  return true;
}

/** Quantos equipamentos apontam para esta pessoa / este depósito. */
async function contarPor(campo, valor) {
  const coluna = campo === 'pessoa' ? 'person_id' : 'deposit_id';
  const { data, error } = await banco.from('equipments').select('id').eq(coluna, String(valor || ''));
  assertNoError(error, 'contarEquipamentos');
  return (data || []).length;
}

module.exports = { listar, obter, criar, atualizar, excluir, contarPor, resolverGarantia };
