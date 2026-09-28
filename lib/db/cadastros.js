const { banco, createId, assertNoError } = require('./client');

// "people" e "cnpjs" têm dezenas de campos opcionais no formulário de Cadastros
// (endereço de cobrança/entrega, dados bancários, whatsapp, papéis, etc.).
// Só os campos abaixo viram coluna própria (o que hoje é filtrado/buscado);
// o resto é preservado inteiro em "extra" (jsonb), sem precisar enumerar tudo.
const PEOPLE_CORE_FIELDS = ['id', 'code', 'type', 'name', 'tradeName', 'document', 'email', 'phone', 'status', 'city', 'state', 'zipCode', 'createdAt'];
const CNPJ_CORE_FIELDS = ['id', 'code', 'type', 'name', 'tradeName', 'document', 'email', 'phone', 'status', 'registrationStatus', 'city', 'state', 'createdAt'];

function splitCoreAndExtra(payload, coreFields) {
  const core = {};
  const extra = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (coreFields.includes(key)) {
      core[key] = value;
    } else {
      extra[key] = value;
    }
  });
  return { core, extra };
}

function mapPersonRow(row) {
  if (!row) return null;
  return {
    ...(row.extra || {}),
    id: row.id,
    code: row.code,
    type: row.type,
    name: row.name,
    tradeName: row.trade_name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    status: row.status,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    createdAt: row.created_at
  };
}

function mapCnpjRow(row) {
  if (!row) return null;
  return {
    ...(row.extra || {}),
    id: row.id,
    code: row.code,
    type: row.type,
    name: row.name,
    tradeName: row.trade_name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    status: row.status,
    registrationStatus: row.registration_status,
    city: row.city,
    state: row.state,
    createdAt: row.created_at
  };
}

/**
 * AS TRES LISTAS DO CADASTRO, GUARDADAS ENTRE REQUISICOES (fase DI).
 *
 * O PROBLEMA, MEDIDO
 * ------------------
 * `syncCadastroData` le people + cnpjs + deposits, e e chamada por quase toda
 * rota do sistema. O peso esta em `people.extra`, um jsonb de ~887 bytes por
 * pessoa -- 5,6 MB nas 6.492 desta base, 25 chaves cada (contatos, endereco,
 * RG, limite de credito, transportadora padrao...).
 *
 *     select * de people (6.492 linhas) ..... 93,7 ms
 *
 * E esses 93,7 ms sao pagos de novo a cada requisicao, para dado que muda
 * quando alguem cadastra um cliente -- ou seja, quase nunca.
 *
 * POR QUE NAO FOI UM RECORTE DE COLUNA
 * ------------------------------------
 * A tentativa obvia e cortar `extra` do select para as rotas que so precisam do
 * nome. Sem ela: 30 ms. Medido, e descartado.
 *
 * `mapPersonRow` faz `...(row.extra || {})`: as 25 chaves do jsonb ficam no
 * PRIMEIRO NIVEL do objeto, indistinguiveis de coluna real. Cortar `extra`
 * transforma cada uma em `undefined` -- sem erro e sem aviso.
 *
 * E nao da para saber quem as le. Varri lib/, public/ e server.js: 36 das
 * chaves tem leitor, espalhado por 20 arquivos, e os nomes sao genericos --
 * `notes`, `roles`, `paymentMethod` e `country` aparecem em adquirentes,
 * categorias de venda, equipamentos, origens, permissoes de usuario e
 * lancamentos financeiros, que nao tem nada a ver com pessoa. Nao ha analise
 * estatica que separe. E scripts/test-sync-obrigatorio.js nao protegeria: ele
 * vigia COLECAO lida sem sync, nao coluna ausente do recorte.
 *
 * O QUE ISTO FAZ
 * --------------
 * Guarda as LINHAS CRUAS do banco e remapeia a cada chamada:
 *
 *     ida ao banco + parse do jsonb ..... 93,7 ms
 *     remapear as linhas em memoria .....  1,9 ms   <- 48x
 *
 * Remapear, e nao devolver o array pronto, e' deliberado: cada chamador recebe
 * OBJETOS NOVOS. Devolvendo o mesmo array, um `pessoa.nome = x` em qualquer
 * rota entraria no cache e apareceria para todas as outras -- o tipo de defeito
 * que nao se acha procurando. 1,9 ms e' um preco baixo por essa garantia.
 *
 * E nenhum campo desaparece: o dado e o mesmo, completo. So nao e buscado de
 * novo.
 *
 * POR QUE ISTO E SEGURO AQUI
 * --------------------------
 * 1. TODA escrita em people/cnpjs/deposits passa por este arquivo -- nove
 *    funcoes, todas chamando `esquecerCadastro`. Cadastrou um cliente, a
 *    proxima leitura vai ao banco.
 *
 * 2. O processo e UM. ecosystem.config.js fixa `instances: 1` e
 *    `exec_mode: 'fork'`, com o porque escrito la: lib/limite-tentativas.js ja
 *    guarda estado em memoria, e em cluster cada worker teria o seu. Este cache
 *    entra na mesma lista -- nao cria uma classe nova de problema, e esta
 *    anotado no mesmo lugar.
 *
 * 3. O TTL e' a rede de seguranca para o que NAO passa por aqui: uma migracao,
 *    um UPDATE por psql, ou o dia em que alguem ligar o cluster. 30s -- curto o
 *    bastante para ninguem notar, longo o bastante para cobrir a rajada de
 *    requisicoes de uma navegacao.
 */
const CADASTRO_CACHE_MS = Number(process.env.DATABASE_CADASTRO_CACHE_MS || 30000);
const cacheDoCadastro = new Map();

/**
 * Le a tabela uma vez e reaproveita as linhas cruas; remapeia sempre.
 *
 * Duas chamadas simultaneas com o cache frio compartilham a MESMA ida ao banco:
 * a promessa entra no cache antes de resolver. Sem isso, a rajada que abre uma
 * tela (varias rotas ao mesmo tempo) dispararia varios `select *` de 93 ms cada.
 */
async function lerComCache(tabela, mapear) {
  const guardado = cacheDoCadastro.get(tabela);
  if (guardado && (Date.now() - guardado.em) < CADASTRO_CACHE_MS) {
    return (await guardado.linhas).map(mapear);
  }
  const promessa = banco.from(tabela).select('*').order('created_at', { ascending: false })
    .then(({ data, error }) => {
      assertNoError(error, `lerComCache/${tabela}`);
      return data || [];
    })
    .catch((erro) => {
      // Falha nao fica guardada: o proximo pedido tenta de novo em vez de
      // devolver o erro por 30 segundos.
      cacheDoCadastro.delete(tabela);
      throw erro;
    });
  cacheDoCadastro.set(tabela, { em: Date.now(), linhas: promessa });
  return (await promessa).map(mapear);
}

/**
 * Joga fora o que foi guardado. Chamada por TODA escrita deste arquivo.
 *
 * Sem tabela, esquece as tres -- e' o que os testes usam.
 */
function esquecerCadastro(tabela) {
  if (tabela) cacheDoCadastro.delete(tabela);
  else cacheDoCadastro.clear();
}

async function getNextCadastroCode() {
  const { data, error } = await banco.rpc('next_cadastro_code');
  assertNoError(error, 'getNextCadastroCode');
  return data;
}

async function getPeople() {
  return lerComCache('people', mapPersonRow);
}

async function getPersonById(id) {
  const { data, error } = await banco.from('people').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getPersonById');
  return mapPersonRow(data);
}

async function createPerson(payload) {
  const id = payload.id || createId('pes');
  const code = payload.code || await getNextCadastroCode();
  const { core, extra } = splitCoreAndExtra({ ...payload, id, code }, PEOPLE_CORE_FIELDS);
  const row = {
    id: core.id,
    code: core.code,
    type: core.type || 'pessoa-fisica',
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    city: core.city || '',
    state: core.state || '',
    zip_code: core.zipCode || '',
    extra
  };
  const { error } = await banco.from('people').insert(row);
  assertNoError(error, 'createPerson');
  esquecerCadastro('people');
  return getPersonById(id);
}

async function updatePerson(id, payload) {
  const current = await getPersonById(id);
  if (!current) return null;
  const merged = { ...current, ...payload, id, code: current.code };
  const { core, extra } = splitCoreAndExtra(merged, PEOPLE_CORE_FIELDS);
  const row = {
    type: core.type,
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    city: core.city || '',
    state: core.state || '',
    zip_code: core.zipCode || '',
    extra
  };
  const { error } = await banco.from('people').update(row).eq('id', id);
  assertNoError(error, 'updatePerson');
  esquecerCadastro('people');
  return getPersonById(id);
}

async function deletePerson(id) {
  const { error } = await banco.from('people').delete().eq('id', id);
  assertNoError(error, 'deletePerson');
  esquecerCadastro('people');
}

async function getCnpjs() {
  return lerComCache('cnpjs', mapCnpjRow);
}

async function getCnpjById(id) {
  const { data, error } = await banco.from('cnpjs').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getCnpjById');
  return mapCnpjRow(data);
}

async function createCnpj(payload) {
  const id = payload.id || createId('cnpj');
  const code = payload.code || await getNextCadastroCode();
  const { core, extra } = splitCoreAndExtra({ ...payload, id, code }, CNPJ_CORE_FIELDS);
  const row = {
    id: core.id,
    code: core.code,
    type: 'pessoa-juridica',
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    registration_status: core.registrationStatus || '',
    city: core.city || '',
    state: core.state || '',
    extra
  };
  const { error } = await banco.from('cnpjs').insert(row);
  assertNoError(error, 'createCnpj');
  esquecerCadastro('cnpjs');
  return getCnpjById(id);
}

async function updateCnpj(id, payload) {
  const current = await getCnpjById(id);
  if (!current) return null;
  const merged = { ...current, ...payload, id, code: current.code };
  const { core, extra } = splitCoreAndExtra(merged, CNPJ_CORE_FIELDS);
  const row = {
    name: core.name,
    trade_name: core.tradeName || '',
    document: core.document,
    email: core.email || '',
    phone: core.phone || '',
    status: core.status || 'ativo',
    registration_status: core.registrationStatus || '',
    city: core.city || '',
    state: core.state || '',
    extra
  };
  const { error } = await banco.from('cnpjs').update(row).eq('id', id);
  assertNoError(error, 'updateCnpj');
  esquecerCadastro('cnpjs');
  return getCnpjById(id);
}

async function deleteCnpj(id) {
  const { error } = await banco.from('cnpjs').delete().eq('id', id);
  assertNoError(error, 'deleteCnpj');
  esquecerCadastro('cnpjs');
}

function mapDepositRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    // Fase AW: de que loja este deposito e'. Vazio nos que ja' existiam —
    // ninguem foi cadastrado com loja, e adivinhar seria pior que deixar
    // vazio. Ver o cabecalho da migracao fase-aw.
    companyId: row.company_id || '',
    status: row.status,
    address: row.address,
    city: row.city,
    state: row.state,
    manager: row.manager,
    notes: row.notes,
    createdAt: row.created_at
  };
}

async function getDeposits() {
  return lerComCache('deposits', mapDepositRow);
}

async function createDeposit(payload) {
  const row = {
    id: createId('dep'),
    name: payload.name,
    code: payload.code || '',
    company_id: payload.companyId || null,
    status: payload.status || 'ativo',
    address: payload.address || '',
    city: payload.city || '',
    state: payload.state || '',
    manager: payload.manager || '',
    notes: payload.notes || ''
  };
  const { error } = await banco.from('deposits').insert(row);
  assertNoError(error, 'createDeposit');
  esquecerCadastro('deposits');
  return mapDepositRow(row);
}

async function updateDeposit(id, payload) {
  const row = {
    name: payload.name,
    code: payload.code || '',
    company_id: payload.companyId || null,
    status: payload.status || 'ativo',
    address: payload.address || '',
    city: payload.city || '',
    state: payload.state || '',
    manager: payload.manager || '',
    notes: payload.notes || ''
  };
  const { data, error } = await banco.from('deposits').update(row).eq('id', id).select().maybeSingle();
  assertNoError(error, 'updateDeposit');
  esquecerCadastro('deposits');
  return mapDepositRow(data);
}

async function deleteDeposit(id) {
  const { error } = await banco.from('deposits').delete().eq('id', id);
  assertNoError(error, 'deleteDeposit');
  esquecerCadastro('deposits');
}

module.exports = {
  getPeople, getPersonById, createPerson, updatePerson, deletePerson,
  getCnpjs, getCnpjById, createCnpj, updateCnpj, deleteCnpj,
  getDeposits, createDeposit, updateDeposit, deleteDeposit,
  getNextCadastroCode,
  // Fase DI: quem escreve em people/cnpjs/deposits POR FORA deste arquivo
  // (importacao em lote, migracao rodada com o servidor no ar) precisa avisar.
  esquecerCadastro
};
