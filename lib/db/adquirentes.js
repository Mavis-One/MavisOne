/**
 * CREDENCIADORAS DE CARTÃO no banco. Tabela da fase-bv: `card_acquirers`.
 *
 * Rede, Cielo, Stone, PagSeguro — quem processa o cartão e repassa o dinheiro.
 * O CNPJ guardado aqui é o que vai em `pag/detPag/card/CNPJ` da NF-e, e sem ele
 * a SEFAZ rejeita com o código 225 (falha de schema).
 *
 * POR QUE ISTO É UM CADASTRO, E NÃO UM CAMPO
 * ------------------------------------------
 * A mesma credenciadora atende várias formas de pagamento ("Rede 1x", "Rede
 * 2-6x", "Rede débito") e várias lojas. Repetir o CNPJ em cada forma é a receita
 * para tê-lo certo numa e errado noutra — e foi assim que o problema apareceu no
 * ERP observado em 08/09/2026: a MESMA rejeição em duas filiais diferentes,
 * porque a configuração era uma só e estava errada uma vez.
 *
 * EXCLUIR É DIFERENTE DE INATIVAR:
 *
 *   inativar — some do formulário, continua no histórico. É o que se quer
 *              quando o contrato com a credenciadora acaba.
 *   excluir  — só quando nenhuma forma de pagamento a usa. A guarda lê o
 *              db.json, que é onde as formas moram; ler o Postgres aqui seria
 *              perguntar à fonte errada — a lição da fase BB.
 */

const { banco, createId, assertNoError } = require('./client');

/**
 * As bandeiras do campo `tBand` da NF-e, com o código oficial.
 *
 * Guardadas com o código da SEFAZ, e não com um nome interno, para não haver
 * tradução no meio do caminho: o que está no cadastro é o que vai no XML.
 */
const BANDEIRAS = [
  { codigo: '01', nome: 'Visa' },
  { codigo: '02', nome: 'Mastercard' },
  { codigo: '03', nome: 'American Express' },
  { codigo: '04', nome: 'Sorocred' },
  { codigo: '05', nome: 'Diners Club' },
  { codigo: '06', nome: 'Elo' },
  { codigo: '07', nome: 'Hipercard' },
  { codigo: '08', nome: 'Aura' },
  { codigo: '09', nome: 'Cabal' },
  { codigo: '99', nome: 'Outros' }
];
const CODIGOS_DE_BANDEIRA = new Set(BANDEIRAS.map((b) => b.codigo));

function mapAdquirente(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    cnpj: row.cnpj || '',
    brands: Array.isArray(row.brands) ? row.brands : [],
    status: row.status || 'ativo',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listar({ apenasAtivas = false } = {}) {
  let consulta = banco.from('card_acquirers').select('*');
  if (apenasAtivas) consulta = consulta.eq('status', 'ativo');
  const { data, error } = await consulta.order('name', { ascending: true });
  assertNoError(error, 'listarAdquirentes');
  return (data || []).map(mapAdquirente);
}

async function obter(id) {
  const { data, error } = await banco.from('card_acquirers').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'obterAdquirente');
  return mapAdquirente(data);
}

/**
 * O dígito verificador do CNPJ.
 *
 * Conferir de verdade, e não só o tamanho: é este número que vai para a SEFAZ,
 * e um CNPJ de 14 dígitos inventado passa por qualquer checagem de comprimento
 * e volta como rejeição depois de transmitir — que é o custo caro.
 */
function cnpjValido(bruto) {
  const digitos = String(bruto || '').replace(/\D/g, '');
  if (digitos.length !== 14) return false;
  // Todos iguais passa na conta dos dígitos e não é CNPJ de ninguém.
  if (/^(\d)\1{13}$/.test(digitos)) return false;
  const calcular = (base) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) {
      soma += Number(base[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcular(digitos.slice(0, 12));
  const segundo = calcular(digitos.slice(0, 12) + primeiro);
  return digitos === digitos.slice(0, 12) + primeiro + segundo;
}

function normalizar(payload) {
  const erro = (mensagem, status = 400) => {
    const e = new Error(mensagem);
    e.status = status;
    return e;
  };
  const name = String(payload.name || '').trim();
  if (!name) throw erro('Informe o nome da credenciadora.');

  const cnpj = String(payload.cnpj || '').replace(/\D/g, '');
  if (!cnpj) throw erro('Informe o CNPJ da credenciadora — é ele que vai na NF-e.');
  if (!cnpjValido(cnpj)) {
    throw erro(
      `"${payload.cnpj}" não é um CNPJ válido. É este número que vai para a SEFAZ no grupo do cartão; `
      + 'um CNPJ inválido volta como rejeição depois de a nota ter sido transmitida.'
    );
  }

  // Bandeira fora da tabela oficial é descartada em vez de recusar o cadastro:
  // o que a SEFAZ não conhece ela não aceita, e guardar o código errado seria
  // guardar um problema para a hora da emissão.
  const brands = (Array.isArray(payload.brands) ? payload.brands : [])
    .map((b) => String(b || '').trim())
    .filter((b) => CODIGOS_DE_BANDEIRA.has(b));

  return {
    name,
    cnpj,
    brands: [...new Set(brands)],
    status: payload.status === 'inativo' ? 'inativo' : 'ativo',
    notes: String(payload.notes || '').trim()
  };
}

/**
 * Nome e CNPJ duplicados vêm do BANCO (dois índices únicos) e são traduzidos
 * aqui. Conferir antes com um select seria uma checagem que duas requisições
 * simultâneas atravessam — as duas leem "não existe", as duas gravam.
 */
function traduzirDuplicata(erro, dados) {
  const codigo = erro && (erro.code || (erro.cause && erro.cause.code));
  const texto = String((erro && erro.message) || '');
  if (codigo !== '23505' && !/duplicate key/i.test(texto)) return erro;
  const porCnpj = /idx_card_acquirers_cnpj/.test(texto);
  const claro = new Error(porCnpj
    ? `Já existe uma credenciadora com o CNPJ ${dados.cnpj}. Duas com o mesmo CNPJ são a mesma — `
      + 'e a segunda é a que vai estar desatualizada quando alguém corrigir a primeira.'
    : `Já existe uma credenciadora chamada "${dados.name}". Nomes iguais só mudando maiúsculas contam como o mesmo.`);
  claro.status = 409;
  return claro;
}

async function criar(payload) {
  const dados = normalizar(payload);
  const id = createId('adq');
  try {
    const { error } = await banco.from('card_acquirers').insert({ id, ...dados });
    assertNoError(error, 'criarAdquirente');
  } catch (erro) {
    throw traduzirDuplicata(erro, dados);
  }
  return obter(id);
}

async function atualizar(id, payload) {
  const dados = normalizar(payload);
  try {
    const { error } = await banco.from('card_acquirers')
      .update({ ...dados, updated_at: new Date().toISOString() })
      .eq('id', id);
    assertNoError(error, 'atualizarAdquirente');
  } catch (erro) {
    throw traduzirDuplicata(erro, dados);
  }
  return obter(id);
}

async function excluir(id) {
  const { error } = await banco.from('card_acquirers').delete().eq('id', id);
  assertNoError(error, 'excluirAdquirente');
  return true;
}

module.exports = { BANDEIRAS, listar, obter, criar, atualizar, excluir, cnpjValido };
