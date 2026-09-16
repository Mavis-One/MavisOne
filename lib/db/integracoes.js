/**
 * AS INTEGRAÇÕES E A CHAVE MESTRA (fase CF).
 *
 * `integracoes` guarda o token PRINCIPAL da conta de cada provedor — hoje só a
 * Focus NFe. Não confundir com o token que emite a nota: esse é por CNPJ
 * completo e mora em `estabelecimento.focus_token_cifrado` (lib/db/fiscal.js).
 *
 *   chave mestra  → a conta.  Listar empresas, cadastrar empresa, testar se a
 *                   conta responde antes de existir qualquer estabelecimento.
 *   token do CNPJ → a nota.   Quem emite, e quem diz à Focus de quem ela é.
 *
 * O SEGREDO NÃO SAI DAQUI EM TEXTO
 * --------------------------------
 * As funções que a tela e as rotas usam (`listarIntegracoes`, `getIntegracao`)
 * devolvem só se HÁ token, nunca o token — mesmo padrão de
 * `mapEstabelecimentoRow`. Quem precisa do valor de verdade é
 * lib/focusnfe.js, e chama `getChaveMestra` / `getTokenDaEmpresa`, marcadas
 * como uso interno. Uma rota que devolvesse o token decifrado transformaria
 * "quem pode ver Configurações" em "quem pode emitir por qualquer CNPJ da
 * conta".
 */
const { banco, assertNoError } = require('./client');
const { encryptToBytea, decryptFromBytea } = require('../secrets');
// Só a validação de formato. lib/focusnfe.js não carrega este arquivo no topo
// (só dentro das funções), então não há ciclo na carga — mesmo arranjo de
// lib/db/fiscal.js.
const { assertTokenValido } = require('../focusnfe');

const PROVEDOR_FOCUS = 'FOCUS_NFE';

// Os dois ambientes vivem em colunas separadas, então cada leitura e cada
// gravação precisa escolher uma. Escolher errado seria mandar o token de
// homologação para a URL de produção — 403 que parece credencial revogada.
// Uma única tabela de nomes evita a escolha espalhada por seis lugares.
const COLUNAS = {
  integracao: {
    homologacao: 'token_principal_homologacao_cifrado',
    producao: 'token_principal_producao_cifrado'
  },
  empresa: {
    homologacao: 'token_empresa_homologacao_cifrado',
    producao: 'token_empresa_producao_cifrado'
  }
};

function normalizarAmbiente(raw) {
  return String(raw || '').toLowerCase() === 'producao' ? 'producao' : 'homologacao';
}

function mapIntegracaoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    provedor: row.provedor,
    // Booleano, nunca o valor: ver o cabeçalho.
    chaveMestraHomologacaoConfigurada: Boolean(row[COLUNAS.integracao.homologacao]),
    chaveMestraProducaoConfigurada: Boolean(row[COLUNAS.integracao.producao]),
    ativo: row.ativo,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em
  };
}

function mapVinculoRow(row) {
  if (!row) return null;
  return {
    empresaId: row.empresa_id,
    integracaoId: row.integracao_id,
    tokenHomologacaoConfigurado: Boolean(row[COLUNAS.empresa.homologacao]),
    tokenProducaoConfigurado: Boolean(row[COLUNAS.empresa.producao]),
    ativo: row.ativo,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em
  };
}

async function listarIntegracoes() {
  const { data, error } = await banco.from('integracoes').select('*').order('nome', { ascending: true });
  assertNoError(error, 'listarIntegracoes');
  return (data || []).map(mapIntegracaoRow);
}

async function getIntegracao(provedor = PROVEDOR_FOCUS) {
  const { data, error } = await banco.from('integracoes').select('*').eq('provedor', provedor).maybeSingle();
  assertNoError(error, 'getIntegracao');
  return mapIntegracaoRow(data);
}

/**
 * Grava (ou apaga) a chave mestra de um ambiente.
 *
 * Três estados por ambiente, e não dois — a mesma lição de
 * buildEstabelecimentoFields: sem um "apagar" explícito, um token colado
 * errado só podia ser sobrescrito, nunca removido. O apagar tem precedência
 * sobre o gravar: se os dois chegarem juntos, o pedido destrutivo é o que foi
 * escrito com todas as letras.
 *
 * O ambiente que não vier no payload NÃO é tocado. Salvar a homologação não
 * pode derrubar a produção de quem já emite.
 */
async function salvarChaveMestra(provedor, payload = {}) {
  const alvo = String(provedor || PROVEDOR_FOCUS).trim();
  const fields = {};

  for (const ambiente of ['homologacao', 'producao']) {
    const coluna = COLUNAS.integracao[ambiente];
    const remover = payload[`remover_${ambiente}`] === true || payload[`remover${ambiente === 'producao' ? 'Producao' : 'Homologacao'}`] === true;
    const token = payload[ambiente === 'producao' ? 'tokenProducao' : 'tokenHomologacao'];
    if (remover) {
      fields[coluna] = null;
    } else if (token) {
      fields[coluna] = encryptToBytea(assertTokenValido(token));
    }
  }

  if (payload.ativo !== undefined) fields.ativo = Boolean(payload.ativo);
  if (payload.nome) fields.nome = String(payload.nome).trim();

  if (!Object.keys(fields).length) {
    const err = new Error('Nada para salvar: informe um token, marque a remoção de um, ou mude o estado da integração.');
    err.status = 400;
    throw err;
  }

  const { data, error } = await banco.from('integracoes').update(fields).eq('provedor', alvo).select().maybeSingle();
  assertNoError(error, 'salvarChaveMestra');
  if (!data) {
    // A linha vem semeada pela migração. Não existir significa banco sem a
    // fase CF — dizer isso é mais útil do que um "0 linhas afetadas".
    const err = new Error(`Integração "${alvo}" não está cadastrada. Rode as migrações pendentes (npm run migracoes).`);
    err.status = 404;
    throw err;
  }
  return mapIntegracaoRow(data);
}

/**
 * A chave mestra em texto, para o ambiente pedido. USO INTERNO — nunca expor
 * numa rota. Devolve null quando não há token gravado ou a integração está
 * desligada: desligar tem que valer, senão a caixa "ativo" é enfeite.
 */
async function getChaveMestra(ambiente, provedor = PROVEDOR_FOCUS) {
  const amb = normalizarAmbiente(ambiente);
  const coluna = COLUNAS.integracao[amb];
  const { data, error } = await banco
    .from('integracoes')
    .select(`ativo, ${coluna}`)
    .eq('provedor', provedor)
    .maybeSingle();
  assertNoError(error, 'getChaveMestra');
  if (!data || data.ativo === false || !data[coluna]) return null;
  return { token: decryptFromBytea(data[coluna]), ambiente: amb };
}

/**
 * Token próprio da empresa (raiz de CNPJ) para esta integração. USO INTERNO.
 *
 * Reserva de grupo, não o token da nota: quem emite é o estabelecimento. Ver o
 * bloco "ATENÇÃO AO NÍVEL" na fase-cf.
 */
async function getTokenDaEmpresa(empresaId, ambiente, provedor = PROVEDOR_FOCUS) {
  const id = String(empresaId || '').trim();
  if (!id) return null;
  const amb = normalizarAmbiente(ambiente);
  const coluna = COLUNAS.empresa[amb];

  const integracao = await getIntegracao(provedor);
  if (!integracao || integracao.ativo === false) return null;

  const { data, error } = await banco
    .from('empresas_integracoes')
    .select(`ativo, ${coluna}`)
    .eq('empresa_id', id)
    .eq('integracao_id', integracao.id)
    .maybeSingle();
  assertNoError(error, 'getTokenDaEmpresa');
  if (!data || data.ativo === false || !data[coluna]) return null;
  return { token: decryptFromBytea(data[coluna]), ambiente: amb };
}

/** Quais empresas usam esta integração. Sem token, como sempre. */
async function listarVinculos(provedor = PROVEDOR_FOCUS) {
  const integracao = await getIntegracao(provedor);
  if (!integracao) return [];
  const { data, error } = await banco.from('empresas_integracoes').select('*').eq('integracao_id', integracao.id);
  assertNoError(error, 'listarVinculos');
  return (data || []).map(mapVinculoRow);
}

/**
 * Liga/desliga uma empresa na integração e, opcionalmente, guarda o token
 * próprio dela. Upsert porque "vincular" é idempotente: marcar de novo a
 * mesma empresa é a mesma decisão, não um erro de chave duplicada.
 */
async function salvarVinculo(empresaId, payload = {}, provedor = PROVEDOR_FOCUS) {
  const id = String(empresaId || '').trim();
  if (!id) {
    const err = new Error('Informe a empresa para vincular à integração.');
    err.status = 400;
    throw err;
  }
  const integracao = await getIntegracao(provedor);
  if (!integracao) {
    const err = new Error(`Integração "${provedor}" não está cadastrada. Rode as migrações pendentes (npm run migracoes).`);
    err.status = 404;
    throw err;
  }

  const linha = { empresa_id: id, integracao_id: integracao.id };
  for (const ambiente of ['homologacao', 'producao']) {
    const coluna = COLUNAS.empresa[ambiente];
    const remover = payload[`remover${ambiente === 'producao' ? 'Producao' : 'Homologacao'}`] === true;
    const token = payload[ambiente === 'producao' ? 'tokenProducao' : 'tokenHomologacao'];
    if (remover) linha[coluna] = null;
    else if (token) linha[coluna] = encryptToBytea(assertTokenValido(token));
  }
  if (payload.ativo !== undefined) linha.ativo = Boolean(payload.ativo);

  const { data, error } = await banco
    .from('empresas_integracoes')
    .upsert(linha, { onConflict: 'empresa_id,integracao_id' })
    .select()
    .maybeSingle();
  assertNoError(error, 'salvarVinculo');
  return mapVinculoRow(data);
}

module.exports = {
  PROVEDOR_FOCUS,
  listarIntegracoes,
  getIntegracao,
  salvarChaveMestra,
  listarVinculos,
  salvarVinculo,
  // Uso interno (lib/focusnfe.js) — devolvem segredo em texto.
  getChaveMestra,
  getTokenDaEmpresa
};
