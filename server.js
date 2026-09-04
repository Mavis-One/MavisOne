require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const db = require('./db');
const focusNfe = require('./lib/focusnfe');
const fiscalDb = require('./lib/db/fiscal');
const modulosDb = require('./lib/db/modulos');
const crmDb = require('./lib/db/crm');
const { buildNfePayload, conferirLimitesDeTexto } = require('./lib/nfePayloadBuilder');
// Os limites de texto da SEFAZ, no mesmo catalogo que a tela usa.
const textoNfe = require('./public/modules/shared/nfe_texto_padrao');
// Catálogo de operações fiscais: é ele que diz se a nota movimenta estoque,
// gera financeiro e exige documento referenciado — em vez de `if` de
// finalidade espalhado pelo código de emissão.
const operacaoFiscal = require('./lib/operacaoFiscal');
// Prazo de 24h para cancelar NF-e. Mesmo arquivo que o navegador carrega, para
// tela e servidor não discordarem sobre quando o prazo venceu.
const prazoCancelamento = require('./public/modules/shared/prazo_cancelamento');
// Painel "Atenção" do hub: junta o que já está errado e espalhado por seis
// telas — conta vencida, NF-e rejeitada, pedido faturado sem nota, estoque
// abaixo do mínimo.
const atencao = require('./lib/atencao');
// Cartões do topo do hub: valor + variação contra o período anterior + a
// proporção que merece alarme.
const kpis = require('./lib/kpis');
// Classes de produto (COR e futuras): catálogo global + atribuição por produto.
const classesDb = require('./lib/db/classes');
const openFinanceService = require('./lib/openfinance/service');
const openFinanceSync = require('./lib/openfinance/sync');
const openFinanceDb = require('./lib/db/openfinance');
const stockCore = require('./lib/stock-core');
const cadastrosCore = require('./lib/cadastros-core');
const permissoes = require('./lib/permissoes');
const { parcelasDoPedido } = require('./lib/vendas-financeiro');
// Mora em public/ porque o navegador também carrega este arquivo por <script>.
// Fonte única do cálculo de totais — ver o comentário no topo do módulo.
const salesTotals = require('./public/modules/shared/sales_totals');
// Idem: catálogo de status de pedido/orçamento. É ele que diz, para cada
// status, se o registro é pedido ou orçamento e se baixa estoque / gera
// financeiro — as três decisões que antes eram `=== 'faturado'` espalhado.
const salesStatus = require('./public/modules/shared/sales_status');
// Aba Impostos do pedido. Roda a MESMA montagem tributária da emissão — ver o
// cabeçalho de lib/calcularTributos.js.
const { calcularTributos } = require('./lib/calcularTributos');
// Anexos do pedido: binário na tabela pedido_anexo (fase AM), ficha no
// próprio pedido. Ver o cabeçalho de lib/db/anexos.js.
const anexosDb = require('./lib/db/anexos');
// Entrada de NF-e: o XML que o fornecedor manda. O leitor nao usa biblioteca
// externa (ver o cabecalho de lib/nfeXml.js) e a conferencia e funcao pura --
// analisar uma nota nao pode criar fornecedor nem mexer em estoque sozinha.
const entradaNfe = require('./lib/entradaNfe');
const entradaNfeDb = require('./lib/db/entrada-nfe');
// Ações em lote da lista. Mesmo arquivo que o navegador carrega: é ele que diz
// quem é elegível, e a tela e o servidor precisam responder igual.
const salesBulk = require('./public/modules/shared/sales_bulk_actions');
// Relatório de Vendas: a regra de quem vê o quê e o cálculo do relatório, os
// dois em funções puras. Ver o cabeçalho de lib/relatorios-escopo.js.
const escopoLib = require('./lib/relatorios-escopo');
const relatoriosVendas = require('./lib/relatorios-vendas');
// Meu Painel: o mesmo escopo, mas fechado no próprio usuário. Ver o cabeçalho.
const painelPessoal = require('./lib/painel-pessoal-vendas');
const fiscalPermissoes = require('./public/modules/shared/fiscal_permissoes');
// Fase AP: o razao de estoque saiu do db.json e virou tabela no Postgres.
const razaoEstoque = require('./lib/db/estoque-razao');
const { emTransacao, consultar: consultarBanco } = require('./lib/db/conexao');
// Fase AT: o numero do lancamento financeiro (LF0001) — mesmo formato na tela.
const lancamentoCodigo = require('./public/modules/shared/lancamento_codigo');
// Fase AX: a descricao do lancamento financeiro. Quatro origens escreviam
// quatro frases diferentes para a mesma coisa — ver o cabecalho do catalogo.
const descricaoLancamento = require('./public/modules/shared/descricao_lancamento');
// Fase AS: categoria da VENDA (Varejo, Atacado, Bonificacao) — nao a do produto.
const categoriasVendaDb = require('./lib/db/categorias-venda');
// Fase AZ: origem da VENDA (Balcao, Televendas, E-commerce). Era uma lista
// fixa dentro do public/app.js, sem tela — ver o cabecalho da migracao.
const origensVendaDb = require('./lib/db/origens-venda');
// Fase BB: equipamentos sairam do db.json. A garantia e' contada a partir da
// NF-e que vendeu a maquina — ver o cabecalho de lib/db/equipamentos.js.
const equipamentosDb = require('./lib/db/equipamentos');
const garantia = require('./public/modules/shared/garantia');
// Fase AR: as notas que emitiram CONTRA o nosso CNPJ (Distribuicao de DF-e).
const dfeDb = require('./lib/db/dfe');
const manifestacao = require('./public/modules/shared/manifestacao');
// Fase AQ: cotacao e ordem de compra sao o mesmo documento — o status decide.
const comprasDb = require('./lib/db/compras');
const purchaseStatus = require('./public/modules/shared/purchase_status');
const purchaseTotals = require('./public/modules/shared/purchase_totals');
const reservasLib = require('./lib/reservas');
const painelModulos = require('./lib/painel-modulos');
const sessaoUtil = require('./lib/sessao');

const HOST = process.env.HOST || '0.0.0.0';
const BASE_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = 10;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Usuários NÃO moram mais aqui: a autenticação é 100% Supabase (users.password_hash,
// bcrypt) via lib/db/auth.js. O antigo array `users` guardava senha em texto puro e
// não era lido por nenhuma rota — foi removido, e normalizeData() apaga o resíduo de
// arquivos db.json antigos.
// O molde de um data/db.json novo. So' as colecoes que este ARQUIVO ainda e'
// dono — as outras moram no Postgres e sao recarregadas a cada requisicao (ver
// NAO_PERSISTIR). Semear as duas coisas dava um arquivo novo ja' nascido com um
// "Produto Exemplo" que nenhuma tela le' e um settings que db.getSettings()
// ignora.
const initialData = {
  // Legado: a venda rapida de /api/sales ainda empilha aqui. Vendas de verdade
  // sao orders/quotes, no banco.
  sales: [],
  bankTransactions: [],
  companies: [],
  productCategories: [],
  movementCategories: [],
  priceTables: [],
  productCatalogs: [],
  productMeta: {},
  contacts: [],
  equipments: [],
  paymentMethods: [],
  saleStatuses: [],
  productCashbacks: [],
  tasks: [],
  appointments: [],
  // Fila de saida: trilha que ainda nao subiu para audit_logs (pendenteDeSincronia).
  auditLogs: []
};

/**
 * AS COLECOES QUE NAO MORAM MAIS NESTE ARQUIVO.
 *
 * Todas tem dono no Postgres e sao recarregadas por cima logo depois do
 * loadData() — pelos syncs (syncCadastroData/syncSalesData/syncPurchasesData/
 * syncNfeData/syncFinanceData), pelo razao da fase AP, ou por uma consulta
 * direta (db.getProducts/db.getSettings, que nem passam pelo `data`).
 *
 * Gravar de volta criava uma SEGUNDA copia que ninguem le e todo mundo
 * acredita: a que o backup carregava, a que aparecia para quem abrisse o
 * arquivo, e — o pior — a que uma rota que esquecesse o sync leria como
 * verdade. Resultado plausivel e errado e' pior que resultado vazio.
 *
 * A prova estava no proprio arquivo: ele guardava dois depositos chamados
 * `zz-razao-origem/destino`, fixtures que um teste criou e apagou do banco. O
 * banco esqueceu; o db.json nao.
 *
 * E' uma lista de EXCLUSAO, nao de inclusao, de proposito: uma colecao nova que
 * alguem acrescente amanha continua sendo gravada. O preco de errar aqui e' uma
 * chave a mais no arquivo — nao um dado perdido.
 */
const NAO_PERSISTIR = new Set([
  'people', 'cnpjs', 'deposits',                                          // syncCadastroData
  'orders', 'quotes', 'importLogs',                                       // syncSalesData
  'purchases',                                                            // syncPurchasesData
  'nfes',                                                                 // syncNfeData
  'finance', 'financialPayments', 'financialCategories',                  // syncFinanceData
  'costCenters', 'bankAccounts',                                          // syncFinanceData
  'stockMovements', 'stockTransfers',                                     // fase AP: razao no Postgres
  'equipments',                                                           // fase BB: equipamentos no Postgres
  'products', 'settings',                                                 // nunca lidos de `data`
  '__movimentosPendentes',                                                // fila da requisicao, nao e' dado
  '__razaoCarregado'                                                      // marca da requisicao, nao e' dado
]);

// Cada sessão é { userId, criadaEm, expiraEm }. Guardar o `expiraEm` calculado
// na criação, em vez de recalcular a cada requisição, é o que faz a sessão
// morrer na virada do dia em que NASCEU — recalcular daria sempre "a próxima
// meia-noite a partir de agora", e a sessão nunca expiraria.
let sessions = {};

// ---------------------------------------------------------------------------
// SESSÃO ÚNICA POR USUÁRIO
//
// Entrar numa máquina derruba a sessão aberta em outra. É a regra pedida, e ela
// só funciona se a máquina derrubada souber POR QUE caiu: sem isso o usuário vê
// erros aleatórios em cada clique e acha que o sistema quebrou.
//
// Por isso o token derrubado não é simplesmente esquecido — ele fica aqui com o
// motivo, e a próxima requisição dele recebe uma resposta que a tela sabe
// explicar. É a diferença entre "Erro inesperado" e "sua conta entrou em outro
// dispositivo".
//
// Guarda só o token e o instante. O token já é um identificador opaco e a
// sessão dele acabou, então não há o que vazar aqui.
const sessoesEncerradas = new Map();
const LEMBRAR_ENCERRADA_MS = 12 * 60 * 60 * 1000; // 12h

function limparEncerradasAntigas() {
  const limite = Date.now() - LEMBRAR_ENCERRADA_MS;
  for (const [token, registro] of sessoesEncerradas) {
    if (registro.em < limite) sessoesEncerradas.delete(token);
  }
}

/**
 * Derruba as sessões abertas do usuário e devolve quantas caíram.
 * `exceto` protege o token recém-criado de derrubar a si mesmo.
 */
function encerrarSessoesDoUsuario(userId, motivo, exceto = null) {
  const derrubados = Object.keys(sessions).filter((t) => sessions[t].userId === userId && t !== exceto);
  if (derrubados.length) limparEncerradasAntigas();
  for (const token of derrubados) {
    delete sessions[token];
    sessoesEncerradas.set(token, { motivo, em: Date.now() });
  }
  return derrubados.length;
}

// ---------------------------------------------------------------------------
// EXPIRAÇÃO NA VIRADA DO DIA
//
// A regra e o porquê estão em lib/sessao.js. Aqui só a aplicação: derrubar o
// token quando ele vence, e varrer periodicamente os que venceram e cujo dono
// nunca mais voltou — sem a varredura, o mapa de sessões só cresceria, que é
// exatamente o peso que esta regra existe para tirar.
// ---------------------------------------------------------------------------
const VARRER_SESSOES_MS = 10 * 60 * 1000;

/** Encerra o token se ele já passou da virada. Devolve true se derrubou. */
function derrubarSeExpirou(token) {
  const sessao = sessions[token];
  if (!sessao || !sessaoUtil.sessaoExpirou(sessao)) return false;
  delete sessions[token];
  sessoesEncerradas.set(token, { motivo: 'fim-do-dia', em: Date.now() });
  return true;
}

function varrerSessoesExpiradas() {
  for (const token of Object.keys(sessions)) derrubarSeExpirou(token);
  limparEncerradasAntigas();
}

// unref: a varredura não é motivo para o processo continuar de pé.
setInterval(varrerSessoesExpiradas, VARRER_SESSOES_MS).unref();

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

function formatCadastroCode(n) {
  return String(n).padStart(2, '0');
}

// Garante que toda pessoa/CNPJ tenha um código sequencial único (compartilhado entre as duas coleções).
// Registros antigos sem código recebem um retroativamente, na ordem de criação.
function assignCadastroCodes(data) {
  const allCadastros = [...data.people, ...data.cnpjs];
  const existingCodes = allCadastros
    .map((record) => Number(record.code))
    .filter((n) => Number.isFinite(n) && n > 0);

  let nextCode = typeof data.nextCadastroCode === 'number' && data.nextCadastroCode > 0
    ? data.nextCadastroCode
    : (existingCodes.length ? Math.max(...existingCodes) + 1 : 1);

  const missing = allCadastros
    .filter((record) => !record.code)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  missing.forEach((record) => {
    record.code = formatCadastroCode(nextCode);
    nextCode += 1;
  });

  data.nextCadastroCode = nextCode;
  if (missing.length > 0) {
    data.__needsCodeSave = true;
  }
}

function normalizeData(data) {
  // As tres primeiras nao sao mais gravadas no arquivo (ver NAO_PERSISTIR), mas
  // a CHAVE tem de existir em memoria: ha leitura direta, sem `|| []`, tanto de
  // data.purchases quanto de data.sales. O arquivo perde a copia; o objeto
  // mantem a forma.
  data.products = Array.isArray(data.products) ? data.products : [];
  data.sales = Array.isArray(data.sales) ? data.sales : [];
  data.purchases = Array.isArray(data.purchases) ? data.purchases : [];
  data.orders = Array.isArray(data.orders) ? data.orders : [];
  data.quotes = Array.isArray(data.quotes) ? data.quotes : [];
  data.nfes = Array.isArray(data.nfes) ? data.nfes : [];
  data.people = Array.isArray(data.people) ? data.people : [];
  data.cnpjs = Array.isArray(data.cnpjs) ? data.cnpjs : [];
  data.deposits = Array.isArray(data.deposits) ? data.deposits : [];
  stockCore.ensureStockCollections(data);
  cadastrosCore.ensureCadastroCollections(data);
  data.finance = Array.isArray(data.finance) ? data.finance : [];
  data.financialPayments = Array.isArray(data.financialPayments) ? data.financialPayments : [];
  data.financialCategories = Array.isArray(data.financialCategories) ? data.financialCategories : [];
  data.costCenters = Array.isArray(data.costCenters) ? data.costCenters : [];
  data.bankAccounts = Array.isArray(data.bankAccounts) ? data.bankAccounts : [];
  data.companies = Array.isArray(data.companies) ? data.companies : [];
  data.bankTransactions = Array.isArray(data.bankTransactions) ? data.bankTransactions : [];
  data.stockMovements = Array.isArray(data.stockMovements) ? data.stockMovements : [];
  delete data.cadastros;
  data.importLogs = Array.isArray(data.importLogs) ? data.importLogs : [];
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  // Resíduo do modelo pré-Supabase: guardava senha em texto puro e nunca foi lido.
  // Apagar aqui garante que qualquer db.json antigo seja limpo no primeiro saveData().
  delete data.users;
  assignCadastroCodes(data);
  return data;
}

function loadData() {
  ensureDataFile();
  const bruto = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // O arquivo se limpa sozinho na primeira carga depois desta mudanca — aqui e
  // no servidor de producao, sem depender de alguem lembrar de rodar um script.
  // Mesmo caminho que o assignCadastroCodes ja' usava para gravar o que
  // descobriu lendo.
  const temResiduo = Object.keys(bruto).some((chave) => NAO_PERSISTIR.has(chave));
  const data = normalizeData(bruto);
  if (data.__needsCodeSave || temResiduo) {
    delete data.__needsCodeSave;
    saveData(data);
  }
  return data;
}

/**
 * GRAVA NUM TEMPORARIO E RENOMEIA — nao escreve por cima do arquivo bom.
 *
 * `fs.writeFileSync` abre com O_TRUNC: existe uma janela, entre truncar e
 * terminar de escrever, em que o db.json esta VAZIO ou pela metade. O arquivo
 * ja passa de 50 KB e cada rota faz o par loadData()/saveData(), entao a janela
 * acontece dezenas de vezes por dia.
 *
 * Quem cai nela:
 *   - o proprio sistema, se o processo morrer no meio da escrita (o db.json
 *     fica invalido e o loadData seguinte nao tem o que ler);
 *   - o backup, que copia o arquivo enquanto ele esta sendo reescrito e leva
 *     metade do JSON para dentro do artefato -- descoberto so' no dia em que
 *     alguem restaurasse.
 *
 * O rename e' atomico no mesmo sistema de arquivos (e no Windows o rename do
 * Node substitui o destino), entao ou o leitor ve o arquivo antigo inteiro, ou
 * o novo inteiro. Nunca metade.
 */
function saveData(data) {
  delete data.__needsCodeSave;
  const normalized = normalizeData(data);
  delete normalized.__needsCodeSave;
  // Copia rasa em vez de apagar as chaves do proprio `data`: quem chamou
  // continua usando o objeto depois daqui — varias rotas respondem com
  // `data.orders` LOGO APOS o saveData. Apagar no original devolveria a
  // resposta sem os dados que a tela pediu.
  const paraGravar = {};
  for (const chave of Object.keys(normalized)) {
    if (!NAO_PERSISTIR.has(chave)) paraGravar[chave] = normalized[chave];
  }
  const temporario = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(paraGravar, null, 2));
  fs.renameSync(temporario, DATA_FILE);
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(cpf) {
  const cleaned = sanitizeDigits(cpf);
  if (cleaned.length !== 11 || /^(\d)\1{10}$/.test(cleaned)) {
    return false;
  }

  const calcDigit = (base, factor) => {
    let total = 0;
    for (let i = 0; i < base.length; i += 1) {
      total += Number(base[i]) * factor;
      factor -= 1;
    }
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const digit1 = calcDigit(cleaned.slice(0, 9), 10);
  const digit2 = calcDigit(cleaned.slice(0, 10), 11);
  return cleaned === `${cleaned.slice(0, 9)}${digit1}${digit2}`;
}

function isValidCnpj(cnpj) {
  const cleaned = sanitizeDigits(cnpj);
  if (cleaned.length !== 14) {
    return false;
  }
  if (/^(\d)\1{13}$/.test(cleaned)) {
    return false;
  }

  const calcDigit = (base, factor) => {
    let total = 0;
    for (let i = 0; i < base.length; i += 1) {
      total += Number(base[i]) * factor;
      factor = factor === 2 ? 9 : factor - 1;
    }
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base12 = cleaned.slice(0, 12);
  const digit1 = calcDigit(base12, 5);
  const digit2 = calcDigit(base12 + digit1, 6);
  return cleaned === `${base12}${digit1}${digit2}`;
}

function isValidDocument(documentValue) {
  const cleaned = sanitizeDigits(documentValue);
  if (cleaned.length === 11) {
    return isValidCpf(cleaned);
  }
  if (cleaned.length === 14) {
    return isValidCnpj(cleaned);
  }
  return false;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getAddressLine(record) {
  return record.address || record.street || '';
}

function buildAddressKey(record) {
  const line = normalizeText(getAddressLine(record));
  if (!line) {
    return '';
  }
  const parts = [
    line,
    normalizeText(record.streetNumber || record.addressNumber || ''),
    normalizeText(record.neighborhood || ''),
    normalizeText(record.city || ''),
    normalizeText(record.state || ''),
    sanitizeDigits(record.zipCode || '')
  ];
  return parts.join('|');
}

function validateRequiredRegistrationFields(record) {
  const missing = [];
  if (!String(record.name || '').trim()) missing.push('Nome ou razão social');
  if (!String(record.document || '').trim()) missing.push('CPF/CNPJ');
  if (!record.foreignAddress) {
    if (!String(getAddressLine(record)).trim()) missing.push('Endereço (logradouro)');
    if (!String(record.city || '').trim()) missing.push('Cidade');
    if (!String(record.state || '').trim()) missing.push('UF');
    if (!String(record.zipCode || '').trim()) missing.push('CEP');
  }
  return missing;
}

function findDuplicateRegistration(data, record, excludeId) {
  const allRecords = [...data.people, ...data.cnpjs];
  const document = sanitizeDigits(record.document || '');
  const name = normalizeText(record.name || '');
  const addressKey = buildAddressKey(record);

  for (const entry of allRecords) {
    if (excludeId && entry.id === excludeId) {
      continue;
    }
    if (document && sanitizeDigits(entry.document || '') === document) {
      return `Já existe um cadastro com o CPF/CNPJ informado (${entry.name || 'sem nome'}).`;
    }
    if (name && normalizeText(entry.name || '') === name) {
      return `Já existe um cadastro com o nome "${record.name}".`;
    }
    if (addressKey && buildAddressKey(entry) === addressKey) {
      return 'Já existe um cadastro com este mesmo endereço.';
    }
  }
  return null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Tempo de resposta excedido ao consultar a API externa. Tente novamente.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCnpjOfficialData(cnpj) {
  const url = `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MavisONE/1.0'
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error || 'Não foi possível validar o CNPJ na API externa';
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  const contacts = [];
  if (payload.email) {
    contacts.push({ type: 'email', value: payload.email });
  }

  const phoneFields = [payload.ddd_telefone_1, payload.ddd_telefone_2];
  phoneFields.filter(Boolean).forEach((phone) => {
    contacts.push({ type: 'phone', value: phone });
  });

  return {
    cnpj: sanitizeDigits(payload.cnpj || cnpj),
    razaoSocial: payload.razao_social || '',
    nomeFantasia: payload.nome_fantasia || '',
    situacaoCadastral: payload.descricao_situacao_cadastral || payload.codigo_situacao_cadastral || '',
    endereco: {
      logradouro: payload.logradouro || '',
      numero: payload.numero || '',
      complemento: payload.complemento || '',
      bairro: payload.bairro || '',
      cep: sanitizeDigits(payload.cep || ''),
      cidade: payload.municipio || '',
      estado: payload.uf || ''
    },
    enderecoCompleto: [payload.logradouro, payload.numero, payload.complemento].filter(Boolean).join(', '),
    cnaePrincipal: payload.cnae_fiscal_descricao || (payload.cnae_fiscal ? String(payload.cnae_fiscal) : ''),
    dataAbertura: payload.data_inicio_atividade || '',
    contatos: contacts,
    raw: payload
  };
}

async function fetchCepData(cep) {
  const url = `https://viacep.com.br/ws/${cep}/json/`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MavisONE/1.0'
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.erro) {
    const err = new Error('CEP não encontrado.');
    err.status = 404;
    throw err;
  }

  return {
    zipCode: sanitizeDigits(payload.cep || cep),
    street: payload.logradouro || '',
    complement: payload.complemento || '',
    neighborhood: payload.bairro || '',
    city: payload.localidade || '',
    state: payload.uf || '',
    ibgeCityCode: payload.ibge || '',
    ddd: payload.ddd || '',
    raw: payload
  };
}

/**
 * O usuário da requisição, buscado UMA VEZ por requisição.
 *
 * POR QUE A MEMÓRIA EXISTE
 * ------------------------
 * Esta função é chamada no mínimo duas vezes em toda chamada de API: o portão
 * central (verificarAcesso) precisa do usuário para decidir a permissão, e
 * depois a rota chama de novo para usar os dados dele. Cada chamada era um
 * `select * from users` no Supabase.
 *
 * Medido neste projeto: 259ms por consulta ao banco, INDEPENDENTE do tamanho
 * do resultado — um SELECT que devolve zero linhas custa o mesmo que um que
 * devolve a tabela toda, porque o tempo é viagem, não dado. Duas buscas do
 * mesmo usuário eram meio segundo de espera por requisição, para responder
 * exatamente a mesma coisa duas vezes.
 *
 * O WeakMap é chaveado no próprio `req`: a memória nasce e morre com a
 * requisição, não existe cache entre usuários e não há o que expirar. Um
 * cache por tempo (como o do RBAC) seria errado aqui — usuário bloqueado no
 * meio do expediente continuaria entrando até o prazo virar.
 *
 * A CHECAGEM DE SESSÃO FICA FORA DA MEMÓRIA, e isso é de propósito: ela é em
 * memória, custa nada, e é o último ponto em que uma sessão vencida ainda
 * poderia passar. Memorizar o resultado dela seria trocar o meio segundo por
 * um buraco.
 */
const usuarioDaRequisicao = new WeakMap();

async function getCurrentUser(req) {
  const token = req.headers['x-auth-token'];
  // Confere a virada aqui também, e não só no portão da requisição: qualquer
  // caminho que chegue a um usuário autenticado passa por esta função, então é
  // o último ponto em que uma sessão vencida ainda poderia passar.
  if (!token || derrubarSeExpirou(token) || !sessions[token]) {
    return null;
  }
  if (usuarioDaRequisicao.has(req)) return usuarioDaRequisicao.get(req);

  const { userId } = sessions[token];
  const user = await db.getUserById(userId);
  // Bloqueado é como se não estivesse logado — inclusive para quem já tinha
  // sessão aberta quando o acesso foi suspenso.
  const resolvido = !user || user.active === false ? null : user;
  usuarioDaRequisicao.set(req, resolvido);
  return resolvido;
}

/**
 * Esquece o usuário memorizado desta requisição.
 *
 * Só faz falta quando a própria requisição ALTERA a linha do usuário logado e
 * precisa lê-la de novo depois — trocar o tema, fixar um atalho, editar o
 * próprio cadastro. Sem isto, a segunda leitura devolveria o estado de antes
 * da gravação e a tela mostraria o valor velho como se nada tivesse sido
 * salvo. É o preço da memória, e é barato quando explícito.
 */
function esquecerUsuarioDaRequisicao(req) {
  usuarioDaRequisicao.delete(req);
}

/**
 * Admin de verdade: pelo papel novo (user_roles) OU pela coluna antiga
 * users.role.
 *
 * `getCurrentUser` lê só a tabela `users`, então quem foi promovido a
 * administrador na tela de Papéis e Permissões — que grava em `user_roles` e
 * NÃO mexe em `users.role` — chegava aqui com role='user' e levava "Permissão
 * negada" ao abrir Auditoria ou ao gerenciar usuários. O portão central já
 * usava a regra certa (permissoes.ehAdministrador com os papéis carregados);
 * as rotas que checavam `role === 'admin'` na mão, não. Promover alguém pela
 * tela tinha efeito parcial, que é o pior dos casos: parece que funcionou.
 *
 * carregarAcessoDoUsuario tem cache de 5 minutos, então isto não custa uma
 * viagem ao banco por requisição.
 */
async function ehAdmin(usuario) {
  if (!usuario) return false;
  if (permissoes.ehAdministrador(usuario)) return true;
  const acesso = await db.rbac.carregarAcessoDoUsuario(usuario.id);
  return Boolean(acesso && permissoes.ehAdministrador({ ...usuario, roles: acesso.roles }));
}

function ipDaRequisicao(req) {
  const encaminhado = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const bruto = encaminhado || req.socket?.remoteAddress || '';
  // O Node entrega IPv4 embrulhado em IPv6 (::ffff:1.2.3.4); a coluna `inet`
  // aceita, mas guardar o IPv4 puro deixa o log legível.
  return bruto.replace(/^::ffff:/, '') || null;
}

/**
 * Verificação de acesso executada ANTES de cada ação, num lugar só.
 *
 * Antes disto, cada rota checava `user.allowedModules.includes('x')` na mão —
 * 80 pontos, todos com o mesmo poder de esquecer. Aqueles checks continuam onde
 * estão (defesa em profundidade); este aqui é o portão que enxerga a ação
 * (criar/ler/editar/excluir), aplica NEGAR explícito e alimenta a auditoria.
 *
 * Devolve { permitido, permissao, usuario }. Rota não mapeada passa direto —
 * ver o porquê em lib/permissoes.js/resolverPermissao.
 */
async function verificarAcesso(req, pathname) {
  const permissao = permissoes.resolverPermissao(pathname, req.method);
  if (!permissao) return { permitido: true, permissao: null, usuario: null };

  const usuario = await getCurrentUser(req);
  if (!usuario) return { permitido: false, permissao, usuario: null };

  const acesso = await db.rbac.carregarAcessoDoUsuario(usuario.id);
  // Sem RBAC no banco (migração pendente), decide pelo modelo antigo.
  const permitido = acesso
    ? permissoes.usuarioPode({ ...usuario, roles: acesso.roles }, permissao, acesso)
    : permissoes.podePeloModulo(usuario, permissao);

  return { permitido, permissao, usuario };
}

// Leitura é o que mais acontece e o que menos diz numa investigação: registrar
// todo GET encheria a tabela e esconderia o que importa. Grava-se toda ação de
// escrita e TODA tentativa negada, inclusive de leitura.
function deveRegistrar(metodo, permitido) {
  return !permitido || !['GET', 'HEAD'].includes(String(metodo || '').toUpperCase());
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// LIMITE_CORPO_PADRAO cobre com folga qualquer JSON desta API (um pedido com
// centenas de itens não chega perto). O upload de anexo passa um teto próprio,
// maior, porque o arquivo viaja em base64 — que é ~33% maior que o binário.
//
// Antes não havia teto nenhum: o corpo era acumulado em memória até o cliente
// parar de mandar. Com uma rota que aceita arquivo, isso deixa de ser teórico.
const LIMITE_CORPO_PADRAO = 8 * 1024 * 1024;

function readBody(req, limiteBytes = LIMITE_CORPO_PADRAO) {
  return new Promise((resolve, reject) => {
    let body = '';
    let recebidos = 0;
    req.on('data', (chunk) => {
      recebidos += chunk.length;
      if (recebidos > limiteBytes) {
        const err = new Error(`Corpo da requisição maior que o limite de ${Math.round(limiteBytes / 1024 / 1024)} MB.`);
        err.status = 413;
        // Destrói a conexão: continuar lendo o que já passou do teto é
        // exatamente o que o teto existe para impedir.
        req.destroy();
        reject(err);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function normalizeDashboardPins(pins) {
  if (!Array.isArray(pins)) {
    return [];
  }

  const uniquePins = [];
  const seen = new Set();
  pins.forEach((pin) => {
    const value = String(pin || '').trim();
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    uniquePins.push(value);
  });
  return uniquePins;
}

/**
 * TELAS BLOQUEADAS POR USUÁRIO (fase AN) — { "sales": ["relatorio"] }.
 *
 * NÃO confere as chaves contra o catálogo de telas, e isso é decisão, não
 * esquecimento: o catálogo (`moduleSubItems`) mora no bundle do navegador, e
 * trazer uma cópia dele para cá criaria a segunda lista que diverge na primeira
 * tela nova — o problema que fiscal_permissoes.js existe para não repetir. Uma
 * chave desconhecida aqui é inerte: nenhuma tela casa com ela, nada some.
 *
 * O que ESTE código precisa impedir é outra coisa: um POST à mão gravando um
 * objeto de qualquer tamanho numa coluna jsonb. Daí os tetos abaixo.
 */
function sanitizarTelasBloqueadas(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const CHAVE_VALIDA = /^[a-z0-9_]{1,64}$/;
  const limpo = {};
  for (const [modulo, telas] of Object.entries(valor).slice(0, 40)) {
    if (!CHAVE_VALIDA.test(modulo) || !Array.isArray(telas)) continue;
    const lista = [...new Set(telas.filter((t) => typeof t === 'string' && CHAVE_VALIDA.test(t)))].slice(0, 100);
    // Lista vazia é o mesmo que módulo ausente ("vê todas"). Guardar a chave
    // vazia só faria a coluna crescer e a leitura ter dois jeitos de dizer a
    // mesma coisa.
    if (lista.length) limpo[modulo] = lista;
  }
  return limpo;
}

function serializeUserForClient(user, acesso = null) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    allowedModules: user.allowedModules,
    // Fase AN. Vai para o cliente porque quem monta menu, submenu, favoritos,
    // Área de Trabalho e a validação da rota salva é ele — todos por
    // telasVisiveis(), em app.js.
    blockedSubs: user.blockedSubs || {},
    theme: user.theme,
    dashboardPins: normalizeDashboardPins(user.dashboardPins),
    // Preferencias de tela (fase-ag). Vao junto do usuario para a lista abrir
    // com as colunas escolhidas ja na primeira renderizacao, sem uma segunda
    // ida ao servidor.
    preferences: user.preferences && typeof user.preferences === 'object' ? user.preferences : {},
    active: user.active !== false,
    // A tela usa isto só para esconder botão que o usuário não pode usar. Quem
    // decide de verdade é o servidor: esconder não é bloquear.
    roles: acesso?.roles || [],
    permissions: acesso ? [...acesso.efetivas] : []
  };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    return [];
  }
  const headers = lines[0].split(',').map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] || '';
      return acc;
    }, {});
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getPeriodRange(period, fromQ, toQ) {
  const today = getTodayLocal();
  const todayStr = toDateStr(today);

  if (period === 'today') {
    return { from: todayStr, to: todayStr };
  }
  if (period === 'week') {
    const day = today.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toDateStr(monday), to: toDateStr(sunday) };
  }
  if (period === 'prev_month') {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: toDateStr(first), to: toDateStr(last) };
  }
  if (period === 'next_month') {
    const first = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    return { from: toDateStr(first), to: toDateStr(last) };
  }
  if (period === 'custom') {
    return { from: fromQ || todayStr, to: toQ || todayStr };
  }
  // 'month' (default)
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: toDateStr(first), to: toDateStr(last) };
}

// Período imediatamente anterior, com a mesma duração — usado só para o indicador
// de variação percentual do "Resultado" no dashboard (não depende do tipo de período).
function getPreviousPeriodRange(range) {
  const fromDate = new Date(`${range.from}T00:00:00`);
  const toDate = new Date(`${range.to}T00:00:00`);
  const spanMs = toDate.getTime() - fromDate.getTime();
  const prevTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - spanMs);
  return { from: toDateStr(prevFrom), to: toDateStr(prevTo) };
}

function classifyFinanceEntry(entry) {
  const t = String(entry.type || '').toLowerCase();
  if (t === 'sale' || t === 'receita') return 'receita';
  if (t === 'purchase' || t === 'despesa') return 'despesa';
  if (t === 'transferencia' || t === 'transfer') return 'transferencia';
  return 'outro';
}

function isFinanceEntryRealized(entry) {
  return String(entry.status || '').toLowerCase() === 'paid';
}

function isFinanceEntryCancelled(entry) {
  return ['cancelado', 'cancelled', 'canceled'].includes(String(entry.status || '').toLowerCase());
}

function financeEntryDueDate(entry) {
  return entry.dueDate || entry.date;
}

function financeEntryStatusLabel(entry) {
  const type = classifyFinanceEntry(entry);
  const status = String(entry.status || '').toLowerCase();
  if (status === 'paid') return type === 'despesa' ? 'pago' : 'recebido';
  if (status === 'pending') {
    const dueDate = financeEntryDueDate(entry);
    return dueDate < toDateStr(getTodayLocal()) ? 'vencido' : 'pendente';
  }
  return status || 'pendente';
}

function sumFinanceAmount(entries) {
  return entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

// Cadastros (pessoas/CNPJs) são Supabase de verdade a partir desta fase —
// data.people/data.cnpjs (e data.deposits, ver mais abaixo) não são mais
// lidos/gravados do arquivo local. Em vez de mudar a assinatura de toda
// função que usa data.people/data.cnpjs/data.deposits (getCadastroDirectory,
// resolveFinanceCounterparty, serializeSalesRecord, filterSalesRecords,
// buildSalesDashboardSummary, serializeFinanceEntry...), cada rota que
// precisa desses dados populada data.people/data.cnpjs/data.deposits com o
// conteúdo atual do Supabase logo após loadData() (ver syncCadastroData()) —
// as funções abaixo continuam exatamente como eram antes da migração.
/**
 * A METADE DAS GUARDAS QUE MORA NO BANCO (fase BB).
 *
 * `cadastrosCore.counterpartyInUse` e `depositInUse` liam `data.finance`,
 * `data.stockMovements` e `data.equipments` — tres colecoes que foram para o
 * Postgres e desde entao chegavam VAZIAS. As checagens nao falhavam: respondiam
 * "ninguem usa", sempre.
 *
 * Foi provado contra a API: excluir um deposito com movimentacao no razao
 * devolvia `success: true`. Ha um deposito assim no banco (`ssa5yc`, 3
 * movimentos) de antes desta descoberta — o razao aponta para um deposito que
 * nao existe mais.
 *
 * As duas funcoes abaixo perguntam ao BANCO, e cada uma junta a sua metade com
 * a que o cadastros-core ainda responde (contatos, tarefas, agendamentos,
 * produtos). Contagem, e nao varredura: nenhuma delas carrega o razao inteiro
 * na memoria para responder "tem algum?".
 */
async function contrapartidaEmUso(id) {
  const dados = loadData();
  const [comFinanceiro, comEquipamento, documentos] = await Promise.all([
    (async () => {
      await syncFinanceData(dados);
      return (dados.finance || []).some((entry) => entry.clientSupplierId === id);
    })(),
    equipamentosDb.contarPor('pessoa', id).catch(() => 0),
    // FASE BO: as quatro referencias que ficaram de fora da fase BB. Nenhuma
    // delas tem chave estrangeira (sao colunas text apontando para pessoas OU
    // cnpjs, duas tabelas), entao o banco nao recusa a exclusao: o cliente some
    // e o pedido fica apontando para um id que nao existe mais. A tela passa a
    // mostrar o nome gravado no proprio documento, que e' o `customer` — ou
    // seja, o estrago e' invisivel ate alguem tentar reabrir o cadastro.
    contarDocumentosDaContrapartida(id).catch(() => null)
  ]);
  if (comFinanceiro) return 'Existem lançamentos financeiros vinculados a este cadastro.';
  if (comEquipamento > 0) return 'Existem equipamentos vinculados a este cadastro.';
  if (documentos && documentos.total > 0) {
    return `${documentos.descricao} ${documentos.total === 1 ? 'aponta' : 'apontam'} para este cadastro. `
      + 'Marque como inativo em vez de excluir: assim ele some dos formulários e o histórico continua explicável.';
  }
  return cadastrosCore.counterpartyInUse(dados, id);
}

/**
 * Pedidos, orçamentos, compras e contratos que apontam para uma contrapartida.
 *
 * Uma consulta só, com quatro subselects: quatro idas ao banco para responder
 * "dá para excluir?" custariam quatro vezes a latência por um botão.
 */
async function contarDocumentosDaContrapartida(id) {
  const { rows } = await consultarBanco(
    `select
       (select count(*) from orders where client_supplier_id = $1)::int as pedidos,
       (select count(*) from quotes where client_supplier_id = $1)::int as orcamentos,
       (select count(*) from purchases where supplier_id = $1)::int as compras,
       (select count(*) from contracts where party_id = $1)::int as contratos`,
    [String(id || '')]
  );
  const { pedidos, orcamentos, compras, contratos } = rows[0];
  const total = pedidos + orcamentos + compras + contratos;
  const partes = [];
  if (pedidos) partes.push(`${pedidos} ${pedidos === 1 ? 'pedido' : 'pedidos'}`);
  if (orcamentos) partes.push(`${orcamentos} ${orcamentos === 1 ? 'orçamento' : 'orçamentos'}`);
  if (compras) partes.push(`${compras} ${compras === 1 ? 'compra' : 'compras'}`);
  if (contratos) partes.push(`${contratos} ${contratos === 1 ? 'contrato' : 'contratos'}`);
  return { pedidos, orcamentos, compras, contratos, total, descricao: partes.join(', ') };
}

/**
 * Documentos de venda e depósitos ligados a uma EMPRESA (loja).
 *
 * A guarda que existia (cadastrosCore.companies.inUse) varre data.orders e
 * data.quotes — coleções que estão em NAO_PERSISTIR e que a rota genérica de
 * cadastros nunca sincroniza. Ela respondia SEMPRE "não está em uso", e a
 * empresa saía levando junto a explicação de todo pedido faturado por ela.
 */
async function empresaEmUso(id) {
  const { rows } = await consultarBanco(
    `select
       (select count(*) from orders where company_id = $1)::int as pedidos,
       (select count(*) from quotes where company_id = $1)::int as orcamentos,
       (select count(*) from deposits where company_id = $1)::int as depositos`,
    [String(id || '')]
  );
  const { pedidos, orcamentos, depositos } = rows[0];
  const total = pedidos + orcamentos + depositos;
  if (!total) return null;
  const partes = [];
  if (pedidos) partes.push(`${pedidos} ${pedidos === 1 ? 'pedido' : 'pedidos'}`);
  if (orcamentos) partes.push(`${orcamentos} ${orcamentos === 1 ? 'orçamento' : 'orçamentos'}`);
  if (depositos) partes.push(`${depositos} ${depositos === 1 ? 'depósito' : 'depósitos'}`);
  return `${partes.join(', ')} ${total === 1 ? 'pertence' : 'pertencem'} a esta empresa. `
    + 'Marque como inativa em vez de excluir: assim ela some dos formulários e o histórico continua explicável.';
}

async function depositoEmUso(id) {
  const dados = loadData();
  const [movimentos, equipamentos] = await Promise.all([
    razaoEstoque.contarPorDeposito(id).catch(() => 0),
    equipamentosDb.contarPor('deposito', id).catch(() => 0)
  ]);
  if (movimentos > 0) {
    return `${movimentos === 1 ? 'Existe 1 movimentação' : `Existem ${movimentos} movimentações`} de estoque neste depósito.`;
  }
  if (equipamentos > 0) return 'Existem equipamentos alocados neste depósito.';
  return cadastrosCore.depositInUse(dados, id);
}

/**
 * As NF-e que um equipamento pode apontar como origem (fase BB).
 *
 * As DUAS tabelas de nota, ordenadas da mais recente para a mais antiga — quem
 * acabou de vender a maquina procura a nota de hoje, nao a de 2024.
 *
 * FICAM DE FORA as canceladas, denegadas e as que terminaram em erro: elas nao
 * venderam nada, e contar garantia a partir de uma delas seria contar a partir
 * de uma venda que nao existiu.
 */
function notasParaEquipamento(data) {
  const morta = (status) => ['CANCELADO', 'DENEGADO', 'ERRO', 'INUTILIZADA', 'cancelada', 'denegada', 'erro', 'inutilizada']
    .includes(String(status || ''));
  const rotulo = (numero, dataEmissao, para) => {
    const partes = [`NF-e ${numero || 's/n'}`];
    if (dataEmissao) partes.push(garantia.formatarBR(dataEmissao));
    if (para) partes.push(para);
    return partes.join(' · ');
  };
  const fiscais = (data.nfe || [])
    .filter((n) => !morta(n.status))
    .map((n) => ({
      id: n.id,
      name: rotulo(n.numero, String(n.dataEmissao || '').slice(0, 10), n.destinatarioNome),
      date: String(n.dataEmissao || '').slice(0, 10)
    }));
  const manuais = (data.nfes || [])
    .filter((n) => !morta(n.status))
    .map((n) => ({
      id: n.id,
      name: rotulo(n.number, String(n.date || '').slice(0, 10), n.customer),
      date: String(n.date || '').slice(0, 10)
    }));
  return [...fiscais, ...manuais].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * A NF-e de um equipamento: { id, numero, data }, ou null.
 *
 * DUAS TABELAS DE NOTA, de novo: `nfe` (a fiscal, que sai pela Focus) e `nfes`
 * (a manual). Sao duas porque nasceram em fases diferentes — ver a fase AE — e
 * por isso `equipments.nfe_id` nao tem chave estrangeira.
 */
function notaDoEquipamento(nfeId, data) {
  const id = String(nfeId || '').trim();
  if (!id) return null;
  const fiscal = (data.nfe || []).find((n) => n.id === id);
  if (fiscal) {
    return { id, numero: String(fiscal.numero || ''), data: String(fiscal.dataEmissao || '').slice(0, 10) };
  }
  const manual = (data.nfes || []).find((n) => n.id === id);
  if (manual) {
    return { id, numero: String(manual.number || ''), data: String(manual.date || '').slice(0, 10) };
  }
  return null;
}

/**
 * O equipamento como a tela precisa dele.
 *
 * A GARANTIA VEM COM O PORQUE. Sem ele o usuario ve "vence em 03/09/2027" e nao
 * tem como conferir se esta certo — e data que ninguem consegue conferir volta
 * a ser data em que ninguem confia. Ver public/modules/shared/garantia.js.
 */
function serializarEquipamento(equipamento, data) {
  const nota = notaDoEquipamento(equipamento.nfeId, data);
  const calculada = equipamentosDb.resolverGarantia(equipamento, nota);
  const ate = equipamento.warrantyUntil || calculada.ate;
  return {
    ...equipamento,
    personName: cadastrosCore.directoryName(data, equipamento.personId),
    depositName: resolveById(data.deposits, equipamento.depositId),
    nfeNumero: nota ? nota.numero : '',
    nfeData: nota ? nota.data : '',
    warrantyUntil: ate,
    warrantyPorque: calculada.porque,
    warrantySituacao: garantia.situacao(ate),
    warrantyDiasRestantes: garantia.diasRestantes(ate)
  };
}

async function syncCadastroData(data) {
  const [people, cnpjs, deposits] = await Promise.all([db.getPeople(), db.getCnpjs(), db.getDeposits()]);
  data.people = people;
  data.cnpjs = cnpjs;
  data.deposits = deposits;
}

function getCadastroDirectory(data) {
  const project = (record, kind) => ({
    id: record.id,
    kind,
    name: record.name,
    code: record.code,
    document: record.document,
    address: record.address || record.street || '',
    city: record.city || '',
    state: record.state || '',
    zipCode: record.zipCode || '',
    stateRegistration: record.stateRegistration || record.inscricaoEstadual || ''
  });
  const people = (data.people || []).map((p) => project(p, 'pessoa'));
  const companies = (data.cnpjs || []).map((c) => project(c, 'empresa'));
  return [...people, ...companies];
}

function resolveFinanceCounterparty(entry, data) {
  if (entry.clientSupplierId) {
    const found = getCadastroDirectory(data).find((c) => c.id === entry.clientSupplierId);
    if (found) return found.name;
  }
  if (entry.clientSupplierName) return entry.clientSupplierName;
  if (entry.type === 'sale') {
    const sale = data.sales.find((item) => item.id === entry.referenceId);
    if (sale) return sale.customer;
  }
  if (entry.type === 'purchase') {
    const purchase = data.purchases.find((item) => item.id === entry.referenceId);
    if (purchase) return purchase.supplier;
  }
  return entry.clienteFornecedor || entry.counterpartyName || '-';
}

// Documento (CPF/CNPJ) da contraparte de um lançamento — só existe quando o
// lançamento está de fato vinculado a um cadastro (clientSupplierId). Usado
// pra conciliação com score (scoreBankTransactionMatch): documento batendo é
// o sinal mais forte que existe, mais confiável que nome ou valor sozinhos.
function resolveFinanceCounterpartyDocument(entry, data) {
  if (!entry.clientSupplierId) return '';
  const found = getCadastroDirectory(data).find((c) => c.id === entry.clientSupplierId);
  return found ? String(found.document || '') : '';
}

// Score nomeado de conciliação (seção 17-18 do documento de Open Finance):
// puramente informativo pra ordenar/destacar candidatos na tela — a regra de
// ouro continua sendo que NENHUM score, por mais alto que seja, concilia
// sozinho. O clique do usuário é sempre obrigatório (ver rota /conciliar).
function scoreBankTransactionMatch({ amountDiff, daysDiff, remaining, nameMatch, documentMatch }) {
  const exactAmount = amountDiff < 0.01;
  const amountToleranceRelativa = remaining > 0 ? amountDiff / remaining <= 0.02 : false;
  const closeAmount = exactAmount || amountToleranceRelativa;

  if (documentMatch && exactAmount) return 'MATCH_EXACT';
  if (exactAmount && (daysDiff <= 3 || nameMatch)) return 'MATCH_HIGH';
  if (closeAmount && daysDiff <= 7) return 'MATCH_MEDIUM';
  if (nameMatch || documentMatch || daysDiff <= 3) return 'MATCH_LOW';
  return 'NO_MATCH';
}

// "a contém b" ou "b contém a", os dois já normalizados (sem acento/case) —
// nome de banco costuma vir abreviado/em ordem diferente do cadastro interno.
function looseNameMatch(a, b) {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (normA.length < 3 || normB.length < 3) return false;
  return normA.includes(normB) || normB.includes(normA);
}

function sumBy(list, key) {
  return (list || []).reduce((sum, item) => sum + Number(item[key] || 0), 0);
}

function resolveById(list, id) {
  if (!id) return '';
  const found = (list || []).find((item) => item.id === id);
  return found ? found.name : '';
}

// Vendedores não são uma entidade própria: são pessoas do Cadastro marcadas
// com a tag de papel 'Vendedor' (mesmo campo roles[] que a lista de Cadastros já filtra).
function getSellersDirectory(data) {
  return (data.people || [])
    .filter((person) => Array.isArray(person.roles) && person.roles.includes('Vendedor'))
    .map((person) => ({ id: person.id, name: person.name }));
}

// Transportadora pode ser pessoa física (motorista autônomo) ou empresa, por
// isso varre as duas listas — diferente de vendedor, que só é pessoa.
function getCarriersDirectory(data) {
  return [...(data.people || []), ...(data.cnpjs || [])]
    .filter((entry) => Array.isArray(entry.roles) && entry.roles.includes('Transportadora'))
    .map((entry) => ({ id: entry.id, name: entry.name }));
}

// orders/quotes são Supabase de verdade a partir desta fase — mesma
// estratégia de syncCadastroData(): popula data.orders/data.quotes com o
// conteúdo atual do Supabase logo após loadData(), pra buildSalesDashboardSummary/
// buildSalesChartSeries/filterSalesRecords/serializeSalesRecord (todas leem
// data.orders/data.quotes) continuarem exatamente como eram antes da
// migração. Escrita (criar/editar/excluir) é código novo, não passa por
// aqui — ver db.createOrder/updateOrder/deleteOrder direto nas rotas.
async function syncSalesData(data) {
  const [orders, quotes, importLogs] = await Promise.all([db.getOrders(), db.getQuotes(), db.getImportLogs()]);
  data.orders = orders;
  data.quotes = quotes;
  data.importLogs = importLogs;
}

// Mesmo papel de syncCadastroData/syncSalesData: popula data.purchases com o
// conteúdo atual do Supabase logo após loadData(), pra resolveFinanceCounterparty
// (Financeiro) e a checagem de produto-em-uso (Estoque) continuarem lendo
// data.purchases normalmente. Escrita (criar/mudar status) usa
// db.createPurchase/updatePurchase direto nas rotas de Compras.
async function syncPurchasesData(data) {
  data.purchases = await db.getPurchases();
}

// Financeiro no Supabase (Fase M). Mesmo padrão dos syncs acima: popula as
// coleções logo depois de loadData() para TODA a leitura existente — filtros,
// resumo, dashboard, conciliação — continuar lendo data.finance como sempre leu.
// Escrita não passa por aqui: vai direto em db.createFinancialEntry e afins.
//
// As cinco vêm juntas de propósito: financial_entries tem FK para categoria,
// centro de custo e conta bancária, então ler lançamento sem ter as três em mãos
// mostraria "categoria: -" em tudo.
//
// Enquanto uma rota do Financeiro não chamar isto, ela lê a cópia velha que
// ficou no db.json — por isso o sync entra em TODA rota que toca essas
// coleções, e não só nas que gravam.
// NF-e no Supabase (Fase N). Separado de syncFinanceData porque a nota traz os
// itens junto (duas consultas): rota que só mexe em lançamento não paga por isso.
async function syncNfeData(data) {
  // AS DUAS TABELAS DE NF-e, e nao so uma.
  //
  // `nfes` e a NF-e manual (o registro que alguem digita); `nfe` e a fiscal, a
  // que sai pela Focus. Sao duas tabelas porque nasceram em fases diferentes —
  // ver a fase AE.
  //
  // ERRO CORRIGIDO AQUI (fase AX): so `data.nfes` era populado. O serializer do
  // pedido procura a nota primeiro em `data.nfe` e depois em `data.nfes`, e o
  // comentario da rota /meu-painel ja dizia "sem syncNfeData, data.nfe vem
  // vazio e a coluna NF-e sai em branco" — estava certo sobre a consequencia e
  // errado sobre a causa: `data.nfe` vinha vazio SEMPRE. Toda nota emitida pelo
  // Fiscal aparecia sem numero na lista de pedidos, sem erro nenhum na tela.
  const [manuais, fiscais] = await Promise.all([
    db.getNfes(),
    fiscalDb.getNfeRecords().catch(() => [])
  ]);
  data.nfes = manuais;
  data.nfe = fiscais;
}

async function syncFinanceData(data) {
  const [entries, categories, costCenters, bankAccounts] = await Promise.all([
    db.getFinancialEntries(),
    db.getFinancialCategories(),
    db.getCostCenters(),
    db.getBankAccounts()
  ]);
  data.finance = entries;
  data.financialCategories = categories;
  data.costCenters = costCenters;
  data.bankAccounts = bankAccounts;
  // As baixas são lidas por lançamento (getFinanceEntryPayments filtra
  // data.financialPayments), então precisam estar todas em memória. Uma
  // consulta por lançamento seria uma viagem de rede por linha da lista.
  data.financialPayments = entries.length ? await db.getAllFinancialPayments() : [];
}

function normalizeSalesItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      return {
        productId: item.productId || '',
        name: String(item.name || '').trim(),
        sku: item.sku || '',
        // A cor viaja no ITEM, não no produto: o mesmo produto entra duas vezes
        // na mesma venda em cores diferentes, e cada linha baixa da sua cor.
        // O nome vem junto porque a lista da venda precisa mostrar "Preto" sem
        // ter de consultar o catálogo de classes a cada renderização.
        classId: item.classId || '',
        classValueId: item.classValueId || '',
        classValueName: String(item.classValueName || '').trim(),
        // Chassi do equipamento vendido nesta linha. Maiúsculas e sem espaços
        // porque é código de identificação, não texto livre: "9bw 123" e
        // "9BW123" são o mesmo chassi, e guardar os dois formatos faria a busca
        // por chassi não achar metade das vendas.
        chassi: String(item.chassi || '').replace(/\s+/g, '').toUpperCase().slice(0, 25),
        quantity,
        unitPrice,
        total: Math.round(quantity * unitPrice * 100) / 100
      };
    })
    .filter((item) => item.name && item.quantity > 0);
}

// O filtro acima exige `name`, e quem manda só o `productId` via integração ou
// importação via o item sumir calado — o pedido voltava com "Adicione ao menos
// um produto", mensagem que manda procurar defeito no lugar errado. O servidor
// tem o id: dá para buscar o nome em vez de descartar a linha.
//
// Só consulta o que falta. Pela tela, que sempre preenche o nome, isto não faz
// consulta nenhuma.
async function completarNomesDosItens(rawItems) {
  if (!Array.isArray(rawItems)) return rawItems;
  return Promise.all(rawItems.map(async (item) => {
    if (!item || String(item.name || '').trim() || !item.productId) return item;
    const produto = await db.getProductById(item.productId).catch(() => null);
    return produto ? { ...item, name: produto.name, sku: item.sku || produto.sku } : item;
  }));
}

// Lista vazia e lista inteira recusada são problemas diferentes e pedem
// respostas diferentes: "não mandou item" vs. "mandou item que não dá para
// usar". A mesma frase para os dois fazia o integrador conferir o campo errado.
function mensagemItensInvalidos(rawItems) {
  return Array.isArray(rawItems) && rawItems.length
    ? 'Nenhum item pôde ser aproveitado: cada linha precisa de um produto existente (ou o nome preenchido) e quantidade maior que zero.'
    : 'Adicione ao menos um produto ao pedido/orçamento';
}

// Delega para o módulo compartilhado com o navegador (ver o porquê lá). O
// servidor NUNCA confia no total que veio no body: recalcula a partir dos itens
// e dos parâmetros, senão bastaria adulterar o JSON para gravar o total que
// quisesse.
// Campos financeiros gravados no registro. Os parâmetros vêm do body; os
// totais SEMPRE do cálculo do servidor, nunca do que o cliente mandou.
function salesFinanceFields(body, totais) {
  return {
    discountAmount: Math.max(0, Number(body.discountAmount || 0)),
    discountPercent: Math.min(100, Math.max(0, Number(body.discountPercent || 0))),
    freight: Math.max(0, Number(body.freight || 0)),
    freightFixed: Boolean(body.freightFixed),
    chargeFreightToBuyer: body.chargeFreightToBuyer !== false,
    generalExpenses: Math.max(0, Number(body.generalExpenses || 0)),
    assemblyFee: Math.max(0, Number(body.assemblyFee || 0)),
    servicesAmount: Math.max(0, Number(body.servicesAmount || 0)),
    sellerCommissionPercent: Math.max(0, Number(body.sellerCommissionPercent || 0)),
    agentCommissionPercent: Math.max(0, Number(body.agentCommissionPercent || 0)),
    itemsTotal: totais.itemsTotal,
    totalAmount: totais.totalAmount,
    discountTotal: totais.descontoTotal,
    sellerCommission: totais.comissaoVendedor,
    agentCommission: totais.comissaoRepresentacao,
    totalWeight: totais.pesoTotal
  };
}

// Seção "Informações Gerais" do formulário — dados de acompanhamento, sem
// efeito sobre totais nem estoque. Só normaliza (trim/limite) o que veio da
// tela; "Alterado por"/"Data Alteração" NÃO saem daqui: são preenchidos na
// rota com o usuário autenticado, não com o que o cliente mandou.
function salesInfoFields(body) {
  const texto = (v) => String(v || '').trim().slice(0, 200);
  return {
    // Cabeçalho (aba Dados). saleOrigin é obrigatório na tela; aqui cai no
    // padrão em vez de recusar, pra não travar importação de registro antigo.
    saleOrigin: texto(body.saleOrigin) || 'Venda Direta',
    category: texto(body.category),
    priceTable: texto(body.priceTable),
    registrationTime: texto(body.registrationTime),
    clientStatus: texto(body.clientStatus),
    clientContact: texto(body.clientContact),
    customerPoCode: texto(body.customerPoCode),
    recipientEmail: texto(body.recipientEmail),
    billingRecipientEmail: texto(body.billingRecipientEmail),
    commercialRecipientEmail: texto(body.commercialRecipientEmail),
    approvalDate: texto(body.approvalDate),
    relatedOrderCode: Math.max(0, Number(body.relatedOrderCode || 0)),
    revisionNumber: Math.max(0, Number(body.revisionNumber || 0)),
    generateServiceOrder: Boolean(body.generateServiceOrder),
    // Fase AV: faturar exige documento fiscal, e esta é a saída registrada para
    // a venda cuja nota sai depois. Só a INTENÇÃO vem da tela; quem dispensou e
    // quando são carimbados na rota, com o usuário autenticado — pelo mesmo
    // motivo que "Alterado por" não sai daqui.
    dispensaDocumentoFiscal: Boolean(body.dispensaDocumentoFiscal),
    dispensaMotivo: String(body.dispensaMotivo || '').trim().slice(0, 300)
  };
}

// Abas Pagamentos e Entrega. Ficam em JSONB (um objeto por aba) em vez de ~30
// colunas soltas: são dados de formulário, ninguém filtra pedido por "bairro de
// entrega". Mas a chave é copiada UMA A UMA de propósito — gravar o objeto que
// veio do navegador direto deixaria qualquer campo extra entrar no banco.
const texto200 = (v) => String(v || '').trim().slice(0, 200);

function salesPaymentInfo(body) {
  const info = body.paymentInfo || {};
  return {
    accountPlan: texto200(info.accountPlan),
    paymentMethodId: texto200(info.paymentMethodId),
    entryGroup: texto200(info.entryGroup),
    ignoreCreditLimit: Boolean(info.ignoreCreditLimit),
    nfeNumber: texto200(info.nfeNumber),
    nfseNumber: texto200(info.nfseNumber),
    nfeBillingDate: texto200(info.nfeBillingDate),
    printDocument: texto200(info.printDocument) || 'Nenhum',
    billingDetails: texto200(info.billingDetails),
    cardTransaction: texto200(info.cardTransaction),
    // À vista x à prazo é escolha única: os dois interruptores da tela gravam
    // aqui, então não existe pedido marcado como as duas coisas.
    paymentTerm: info.paymentTerm === 'aprazo' ? 'aprazo' : 'avista',
    cashbackAmount: Math.max(0, Number(info.cashbackAmount || 0))
  };
}

// Parcelas/formas informadas na aba Pagamentos. O total NÃO é validado contra o
// valor da venda: pagamento parcial e entrada existem, e travar aqui impediria
// registrar o pedido. A tela avisa quando a soma não fecha.
function salesPaymentLines(body) {
  return (Array.isArray(body.payments) ? body.payments : [])
    .map((linha) => ({
      methodId: texto200(linha.methodId),
      methodName: texto200(linha.methodName),
      dueDate: texto200(linha.dueDate),
      amount: Math.max(0, Number(linha.amount || 0)),
      note: texto200(linha.note)
    }))
    .filter((linha) => linha.amount > 0 || linha.methodName)
    .slice(0, 120);
}

function salesDelivery(body) {
  const entrega = body.delivery || {};
  return {
    addressType: texto200(entrega.addressType) || 'Endereço Pessoa',
    shippingMethod: texto200(entrega.shippingMethod) || 'Outro',
    carrierId: texto200(entrega.carrierId),
    trackingCode: texto200(entrega.trackingCode),
    shippingDate: texto200(entrega.shippingDate),
    showCteOptions: Boolean(entrega.showCteOptions),
    deliveryForecast: texto200(entrega.deliveryForecast),
    onlineDeliveryType: texto200(entrega.onlineDeliveryType),
    zipCode: texto200(entrega.zipCode),
    city: texto200(entrega.city),
    state: texto200(entrega.state),
    district: texto200(entrega.district),
    street: texto200(entrega.street),
    number: texto200(entrega.number),
    complement: texto200(entrega.complement),
    country: texto200(entrega.country) || 'Brasil',
    cityCode: texto200(entrega.cityCode),
    stateCode: texto200(entrega.stateCode)
  };
}

function computeSalesTotals(items, body = {}) {
  return salesTotals.computeSalesTotals({
    items,
    discountAmount: body.discountAmount,
    discountPercent: body.discountPercent,
    freight: body.freight,
    chargeFreightToBuyer: body.chargeFreightToBuyer,
    generalExpenses: body.generalExpenses,
    assemblyFee: body.assemblyFee,
    servicesAmount: body.servicesAmount,
    sellerCommissionPercent: body.sellerCommissionPercent,
    agentCommissionPercent: body.agentCommissionPercent
  });
}

// Registro de ledger — nunca sobrescreve, só insere (mesmo espírito de
// account_balances no Open Finance). Mutação em memória; quem chama ainda
// precisa dar saveData(data) no final da rota.
//
// Grava no MESMO formato canônico que o módulo de Estoque usa
// (stockCore/buildMovementRecord): `type` 'entrada'|'saida' com `quantity`
// sempre positivo, em vez do antigo `quantityDelta` assinado. Sem isso, as
// movimentações geradas por Vendas/Compras entrariam em data.stockMovements
// num formato que stockCore.movementSignedQuantity não sabe ler — apareceriam
// com quantidade zero na tela de Movimentações e não somariam saldo nenhum.
//
// `motivo` guarda a semântica antiga ('venda'/'compra'/'estorno'), que se
// perderia no mapeamento para entrada/saída.
function registrarMovimentoEstoque(data, { productId, productName, type, quantityDelta, referenceType, referenceId, note, user, classId, classValueId, depositId }) {
  const delta = Number(quantityDelta || 0);
  // FASE BD: O DEPÓSITO DE QUEM ORIGINOU O MOVIMENTO VEM PRIMEIRO.
  //
  // Até aqui só existia o padrão do produto, e o depósito escolhido no
  // PEDIDO nunca chegava ao razão: o pedido dizia "Central", o movimento
  // nascia com depósito vazio, e a mercadoria saía de lugar nenhum enquanto
  // o Central seguia com o saldo cheio. Reproduzido num banco de prova:
  // pedido gravado com deposit_id preenchido gerou
  //   MOV-0002 | saida | prod-1 | 1.0000 | (VAZIO) | venda
  //
  // A ordem é deliberada: o depósito do documento é uma ESCOLHA de quem fez
  // a venda ou a compra; o padrão do produto é só um palpite de cadastro.
  // Sem nenhum dos dois fica em branco e productBalances() contabiliza como
  // saldo não alocado, como sempre foi.
  const defaultDepositId = String(depositId || '').trim()
    || stockCore.productMeta(data, productId).defaultDepositId || '';

  const movimento = {
    id: createId('mov'),
    // A sequence do banco numera, no descarregamento. Ver commitStockMovements.
    code: '',
    type: delta < 0 ? 'saida' : 'entrada',
    date: stockCore.todayStr(),
    productId,
    productName: productName || '',
    depositId: defaultDepositId,
    // Sem isto a venda baixaria do saldo GERAL e a quebra por cor nunca
    // fecharia: o produto perderia 3 unidades e nenhuma cor perderia nada.
    classId: classId || '',
    classValueId: classValueId || '',
    quantity: Math.abs(delta),
    unitCost: 0,
    categoryId: '',
    document: '',
    motivo: type,
    referenceType,
    referenceId: referenceId || '',
    transferId: '',
    origin: referenceType || 'manual',
    note: note || '',
    createdBy: user?.id || '',
    createdByName: user?.name || '',
    createdAt: new Date().toISOString()
  };
  // Nos DOIS lugares, de proposito: em data.stockMovements para que qualquer
  // leitura no resto da requisicao enxergue o movimento (era o comportamento de
  // antes), e na fila para o descarregamento gravar no banco.
  data.stockMovements.push(movimento);
  (data.__movimentosPendentes = data.__movimentosPendentes || []).push(movimento);
}

/**
 * De qual depósito o movimento original deste documento saiu (ou entrou).
 *
 * Pergunta ao PRÓPRIO razão, casando documento, produto, cor e motivo. É a única
 * fonte que sabe a verdade: o campo do pedido ou da compra diz onde ele está
 * apontando HOJE, não de onde a mercadoria saiu quando foi faturada.
 *
 * Devolve '' quando não acha — documento movimentado antes da fase BD, quando
 * nenhum movimento de venda ou compra guardava depósito. Quem chama cai no
 * depósito do documento.
 */
function depositoDoMovimentoDeOrigem(data, { referenceType, referenceId, productId, classValueId, motivo }) {
  const movimento = (data.stockMovements || []).find((m) => m.referenceType === referenceType
    && m.referenceId === referenceId
    && m.productId === productId
    && String(m.classValueId || '') === String(classValueId || '')
    && m.motivo === motivo);
  return movimento ? movimento.depositId || '' : '';
}

// Estoque só é afetado de verdade quando um PEDIDO (não orçamento — orçamento
// é só proposta) está ou passa a estar "faturado". Cobre os 4 casos de uma
// vez (criar já faturado, faturar depois, deixar de ser faturado, continuar
// faturado com itens diferentes) pra nunca deixar estoque inconsistente:
// primeiro PROJETA o resultado (devolve o que o pedido antigo reservava,
// desconta o que o novo vai reservar) e só grava de verdade se o resultado
// projetado não fica negativo em nenhum produto.
async function transitionOrderStockEffect(data, { oldItems, newItems, wasApplied, willApply, record, user }) {
  if (!wasApplied && !willApply) return;

  // FASE BD: O RAZÃO PRECISA ESTAR EM MEMÓRIA ANTES DA PROJEÇÃO.
  //
  // A projeção abaixo pergunta o saldo POR COR a classValueBalance, que soma
  // `data.stockMovements`. Essa coleção está em NAO_PERSISTIR desde a fase
  // AP, então loadData() a devolve VAZIA — e somar zero linhas dava
  // "disponível: 0" para toda cor, sempre. Item sem cor escapava porque
  // projeta contra products.stock_quantity, que vem do banco de verdade.
  //
  // Fica AQUI, e não em cada rota, porque são nove caminhos (Vendas POST,
  // PUT, DELETE, lote, Fiscal, PCP) e o próximo que nascer também esqueceria.
  await sincronizarRazao(data);

  const idsEnvolvidos = new Set([
    ...(wasApplied ? oldItems : []).map((item) => item.productId),
    ...(willApply ? newItems : []).map((item) => item.productId)
  ].filter(Boolean));

  const produtos = new Map();
  for (const id of idsEnvolvidos) {
    produtos.set(id, await db.getProductById(id));
  }

  // A projeção é por PRODUTO + COR, não só por produto. Vender 3 pretos com 10
  // no total mas só 2 pretos precisa ser recusado; contra o saldo geral isso
  // passaria, o pedido seria faturado e a cor ficaria com saldo negativo.
  //
  // Item sem cor continua projetando contra o saldo TOTAL do produto — é o caso
  // de todo produto que não usa classe, e também dos itens gravados antes de
  // este controle existir.
  const chaveItem = (item) => `${item.productId}|${item.classValueId || ''}`;
  const projetado = new Map();
  const semear = (item) => {
    const chave = chaveItem(item);
    if (!projetado.has(chave)) {
      projetado.set(chave, item.classValueId
        ? stockCore.classValueBalance(data, item.productId, item.classValueId)
        : Number(produtos.get(item.productId)?.stockQuantity || 0));
    }
    return chave;
  };
  if (wasApplied) {
    for (const item of oldItems) {
      if (!item.productId || !produtos.has(item.productId)) continue;
      const chave = semear(item);
      projetado.set(chave, projetado.get(chave) + Number(item.quantity || 0));
    }
  }
  if (willApply) {
    for (const item of newItems) {
      if (!item.productId || !produtos.has(item.productId)) continue;
      const chave = semear(item);
      const disponivel = projetado.get(chave);
      const restante = disponivel - Number(item.quantity || 0);
      if (restante < 0) {
        const cor = item.classValueName || item.classValueId;
        const err = new Error(`Estoque insuficiente para "${item.name}"${cor ? ` (${cor})` : ''} (disponível: ${disponivel}, necessário: ${item.quantity}).`);
        err.status = 400;
        throw err;
      }
      projetado.set(chave, restante);
    }
  }

  // Validado — agora aplica de verdade, um produto por vez.
  if (wasApplied) {
    for (const item of oldItems) {
      if (!item.productId) continue;
      const produto = produtos.get(item.productId);
      if (!produto) continue;
      // Fase AP: o total do produto NAO e' mexido aqui. Quem soma e' o
      // descarregamento, dentro da mesma transacao que grava o razao — assim o
      // total e o movimento nunca discordam, e a soma passa a ser relativa
      // (`stock_quantity + delta`), sem a corrida do read-modify-write.
      registrarMovimentoEstoque(data, {
        productId: item.productId, productName: item.name, type: 'estorno',
        quantityDelta: Number(item.quantity || 0), referenceType: 'order', referenceId: record.id,
        // O estorno devolve para a MESMA cor que a venda tirou. Devolver ao
        // saldo sem cor deixaria a cor eternamente devendo.
        classId: item.classId, classValueId: item.classValueId,
        // E para o MESMO depósito, pelo mesmo motivo. Não é sempre o
        // depósito atual do pedido: quem editou um pedido faturado pode ter
        // trocado o campo depois da baixa, e devolver ao novo encheria um
        // depósito que nunca entregou a mercadoria enquanto o outro ficaria
        // devendo para sempre. Por isso a busca no razão vem antes.
        depositId: depositoDoMovimentoDeOrigem(data, {
          referenceType: 'order', referenceId: record.id, motivo: 'venda',
          productId: item.productId, classValueId: item.classValueId
        }) || record.depositId,
        note: `Estorno do pedido ${record.code || record.id}`, user
      });
    }
  }
  if (willApply) {
    for (const item of newItems) {
      if (!item.productId) continue;
      // A releitura continua servindo para saber se o produto ainda existe; o
      // total dele nao e' mais calculado aqui (ver a nota acima).
      const produtoAtual = await db.getProductById(item.productId);
      if (!produtoAtual) continue;
      registrarMovimentoEstoque(data, {
        productId: item.productId, productName: item.name, type: 'venda',
        quantityDelta: -Number(item.quantity || 0), referenceType: 'order', referenceId: record.id,
        classId: item.classId, classValueId: item.classValueId,
        // O depósito escolhido no pedido. Sem isto a baixa nascia "não
        // alocada" e o depósito seguia com o saldo cheio (fase BD).
        depositId: record.depositId,
        note: `Pedido ${record.code || record.id}`, user
      });
    }
  }
  await descarregarMovimentosPendentes(data);
}

// Faturar um pedido gera as contas a receber; deixar de faturar cancela o que
// ainda não foi recebido. Mesmo desenho de transitionOrderStockEffect (os 4
// casos: nasce faturado, fatura depois, deixa de ser faturado, continua
// faturado) — e pelo mesmo motivo: é o único jeito de o financeiro nunca ficar
// contando dinheiro de pedido cancelado.
//
// A diferença importante para o estoque: quando o pedido CONTINUA faturado,
// aqui não se refaz nada. O estoque pode devolver e descontar de novo sem
// perder informação; conta a receber, não — apagar e recriar jogaria fora as
// baixas já registradas. Editar um pedido já faturado, portanto, não mexe nas
// parcelas: quem precisar corrigir valor estorna a baixa e edita o lançamento.
/**
 * O NÚMERO da nota deste pedido — o que se dita ao telefone, não o uuid.
 *
 * Procura em memória primeiro (as listas que a rota já carregou) e só então vai
 * ao banco: faturar roda dentro de `syncSalesData`, que traz pedidos e
 * orçamentos e mais nada. Sem a ida ao banco, o pedido faturado pela emissão da
 * própria nota — o caminho normal — sairia com a descrição sem número.
 *
 * Vazio quando não há nota, e vazio é resposta legítima: pedido com dispensa
 * registrada (fase AV) não tem número, e o catálogo escreve "Sem NF-e
 * (dispensada)" nesse caso.
 */
async function numeroDaNotaDoPedido(data, record) {
  if (!record || !record.nfeId) return '';
  const fiscal = (data.nfe || []).find((n) => n.id === record.nfeId);
  if (fiscal) return String(fiscal.numero || '');
  const manual = (data.nfes || []).find((n) => n.id === record.nfeId);
  if (manual) return String(manual.number || '');
  const doBanco = await fiscalDb.getNfeById(record.nfeId).catch(() => null);
  return doBanco ? String(doBanco.numero || '') : '';
}

/**
 * A nota chegou DEPOIS do faturamento: completa a descrição das parcelas.
 *
 * Acontece de verdade — pedido faturado com dispensa registrada (SEFAZ fora,
 * contingência) e a nota emitida no dia seguinte. As contas a receber já
 * existem e dizem "Sem NF-e (dispensada)", que a partir daqui é mentira.
 *
 * SÓ REESCREVE O QUE ELE MESMO ESCREVEU. Compara a descrição gravada com a que
 * este código produziria sem a nota; se bater caractere a caractere, troca pela
 * versão com o número. Se alguém tiver editado o texto à mão, não bate e fica —
 * corrigir o dado de um usuário porque o formato mudou é pior do que a
 * descrição desatualizada.
 */
async function anotarNotaNoFinanceiroDoPedido(data, record, numeroDaNota) {
  const numero = String(numeroDaNota || '').trim();
  if (!numero || !record || !record.id) return 0;
  const vinculadas = (data.finance || [])
    .filter((entry) => entry.referenceId === record.id && entry.status !== 'cancelado');
  if (!vinculadas.length) return 0;

  // As formas não entram na descrição (o nome da forma vem da própria linha de
  // pagamento), então o mapa vazio reproduz o mesmo texto.
  const semNota = parcelasDoPedido(record, new Map(), { nfeNumero: '' });
  const comNota = parcelasDoPedido(record, new Map(), { nfeNumero: numero });
  const usados = new Set();
  let ajustadas = 0;

  for (const entry of vinculadas) {
    const i = semNota.findIndex((p, idx) => !usados.has(idx) && p.description === entry.description);
    if (i < 0) continue;
    usados.add(i);
    entry.description = comNota[i].description;
    entry.updatedAt = new Date().toISOString();
    await db.updateFinancialEntry(entry.id, { description: entry.description });
    ajustadas += 1;
  }
  return ajustadas;
}

async function transitionOrderFinanceEffect(data, { record, wasApplied, willApply, user }) {
  if (wasApplied === willApply) return { criadas: 0, canceladas: 0, mantidas: 0 };

  if (!willApply) {
    const vinculadas = (data.finance || []).filter((entry) => entry.referenceId === record.id && entry.type === 'RECEITA');
    let canceladas = 0;
    for (const entry of vinculadas) {
      // BAIXA AUTOMÁTICA SAI COM O FATURAMENTO; baixa de gente, não.
      //
      // A regra antiga — "parcela já recebida não é cancelada em silêncio,
      // porque o dinheiro entrou de verdade" — continua valendo, e é ela que
      // protege a baixa que uma PESSOA registrou. Mas desde que a venda à vista
      // passou a nascer quitada (fase AU), existe uma baixa que o próprio
      // faturamento criou: desfazer um sem o outro deixaria dinheiro
      // "recebido" de um pedido que não existe mais.
      const baixas = getFinanceEntryPayments(data, entry.id);
      const automaticas = baixas.filter((baixa) => baixa.origem === 'automatica');
      const humanas = baixas.filter((baixa) => baixa.origem !== 'automatica');

      if (humanas.length) continue; // alguém recebeu de verdade: fica.

      for (const baixa of automaticas) {
        await db.deleteFinancialPayment(baixa.id);
        data.financialPayments = (data.financialPayments || []).filter((p) => p.id !== baixa.id);
      }
      if (entry.status === 'pending' || automaticas.length) {
        entry.status = 'cancelado';
        entry.updatedAt = new Date().toISOString();
        await db.updateFinancialEntry(entry.id, { status: 'cancelado' });
        canceladas += 1;
      }
    }
    return { criadas: 0, canceladas, mantidas: vinculadas.length - canceladas };
  }

  // A FORMA DE PAGAMENTO DECIDE SE A PARCELA NASCE QUITADA.
  //
  // Era `status: 'pending'` fixo — a venda paga em dinheiro, no balcão, nascia
  // como conta a receber em aberto. A auditoria do ERP anterior mostrou aonde
  // isso chega: R$ 140 mil "a receber" e R$ 0,00 "realizado" em dois dias, com
  // todo cliente que comprou no cartão listado como inadimplente. O cadastro de
  // formas de pagamento já sabia a resposta (type, daysToReceive, conta); o
  // código é que não perguntava. Ver public/modules/shared/forma_pagamento.js.
  const formasPorId = new Map((data.paymentMethods || []).map((forma) => [forma.id, forma]));
  // Fase AX: a descrição da parcela diz de onde ela veio — natureza, tipo,
  // pedido e nota. O número da nota é o único que não está no registro.
  const parcelas = parcelasDoPedido(record, formasPorId, {
    nfeNumero: await numeroDaNotaDoPedido(data, record)
  });
  let quitadas = 0;
  for (const parcela of parcelas) {
    const entry = await db.createFinancialEntry({
      type: 'RECEITA',
      date: record.date,
      dueDate: parcela.dueDate,
      amount: parcela.amount,
      description: parcela.description,
      document: String(record.code || ''),
      clientSupplierId: record.clientSupplierId || '',
      clientSupplierName: record.clientSupplierName || '',
      // referenceId é o que amarra a parcela ao pedido — é por ele que o
      // cancelamento acima encontra o que desfazer.
      referenceId: record.id,
      bankAccountId: parcela.bankAccountId || '',
      status: parcela.quitaNaHora ? 'paid' : 'pending',
      createdBy: user?.id,
      createdByName: user?.name
    });
    data.finance.push(entry);

    // A BAIXA TAMBÉM, e não só o status. Sem a linha em financial_payments o
    // painel continua somando R$ 0,00 em "realizado" e o extrato da conta não
    // enxerga o dinheiro — o problema só teria mudado de lugar.
    if (parcela.quitaNaHora) {
      const baixa = await db.createFinancialPayment({
        entryId: entry.id,
        amount: parcela.amount,
        date: record.date,
        bankAccountId: parcela.bankAccountId || '',
        // A marca que o cancelamento procura — ver a migração fase-au. É coluna,
        // e não o texto da observação: regra que depende de uma frase ensina a
        // mudar a frase.
        origem: 'automatica',
        note: 'Baixa automática: venda à vista.',
        createdBy: user?.id,
        createdByName: user?.name
      });
      data.financialPayments = data.financialPayments || [];
      data.financialPayments.push(baixa);
      quitadas += 1;
    }
  }
  return { criadas: parcelas.length, canceladas: 0, mantidas: 0, quitadas };
}

// Pedidos/orçamentos antigos (importados via CSV ou criados antes desta fase) não têm
// items[]/totalAmount — o serializer cai no campo "amount" achatado que eles já tinham,
// pra continuar aparecendo na lista sem quebrar.
function serializeSalesRecord(record, data) {
  const items = Array.isArray(record.items) ? record.items : [];
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalAmount = typeof record.totalAmount === 'number' ? record.totalAmount : Number(record.amount || itemsTotal || 0);

  let customerName = record.clientSupplierName || record.customer || '';
  if (record.clientSupplierId) {
    const found = getCadastroDirectory(data).find((entry) => entry.id === record.clientSupplierId);
    if (found) customerName = found.name;
  }

  return {
    id: record.id,
    type: record.type,
    code: record.code || String(record.id).slice(-6),
    date: record.date,
    dueDate: record.dueDate || '',
    clientSupplierId: record.clientSupplierId || '',
    customer: customerName || '-',
    companyId: record.companyId || '',
    companyName: resolveById(data.companies, record.companyId),
    sellerId: record.sellerId || '',
    sellerName: resolveById(getSellersDirectory(data), record.sellerId),
    depositId: record.depositId || '',
    depositName: resolveById(data.deposits, record.depositId),
    items,
    // Fichas dos anexos (fase AI). Só metadado — o binário mora em outra
    // tabela e sai por uma rota própria, que confere a sessão antes de
    // entregar. É por isso que listar pedido não arrasta megabyte de PDF.
    attachments: Array.isArray(record.attachments) ? record.attachments : [],
    discountAmount: Number(record.discountAmount || 0),
    discountPercent: Number(record.discountPercent || 0),
    freight: Number(record.freight || 0),
    // Sem estes campos aqui, reabrir o pedido para editar zerava frete fixo,
    // despesas gerais e taxa de montagem — a tela lê deste serializer.
    freightFixed: Boolean(record.freightFixed),
    chargeFreightToBuyer: record.chargeFreightToBuyer !== false,
    generalExpenses: Number(record.generalExpenses || 0),
    assemblyFee: Number(record.assemblyFee || 0),
    servicesAmount: Number(record.servicesAmount || 0),
    sellerCommissionPercent: Number(record.sellerCommissionPercent || 0),
    agentCommissionPercent: Number(record.agentCommissionPercent || 0),
    discountTotal: Number(record.discountTotal || 0),
    sellerCommission: Number(record.sellerCommission || 0),
    agentCommission: Number(record.agentCommission || 0),
    totalWeight: Number(record.totalWeight || 0),
    // Cabeçalho e Informações Gerais — sem estes campos aqui, reabrir o pedido
    // para editar apagaria classificação, contatos, e-mails e datas de
    // acompanhamento (a tela lê daqui).
    saleOrigin: record.saleOrigin || 'Venda Direta',
    category: record.category || '',
    priceTable: record.priceTable || '',
    registrationTime: record.registrationTime || '',
    clientStatus: record.clientStatus || '',
    clientContact: record.clientContact || '',
    customerPoCode: record.customerPoCode || '',
    recipientEmail: record.recipientEmail || '',
    billingRecipientEmail: record.billingRecipientEmail || '',
    commercialRecipientEmail: record.commercialRecipientEmail || '',
    approvalDate: record.approvalDate || '',
    relatedOrderCode: Number(record.relatedOrderCode || 0),
    revisionNumber: Number(record.revisionNumber || 0),
    generateServiceOrder: Boolean(record.generateServiceOrder),
    updatedByName: record.updatedByName || '',
    // Abas Pagamentos, Entrega e Termos. Passam pelas mesmas funções da
    // gravação para o registro antigo (que não tem nada disso) chegar na tela
    // com os padrões preenchidos em vez de undefined.
    paymentInfo: salesPaymentInfo(record),
    payments: salesPaymentLines(record),
    delivery: salesDelivery(record),
    salesTerms: record.salesTerms || '',
    itemsTotal: Math.round(itemsTotal * 100) / 100,
    amount: totalAmount,
    note: record.note || '',
    // Registro gravado antes do catálogo único ('pendente', 'faturado', 'em
    // aberto', …) é traduzido aqui na leitura — nada de migração SQL. O valor
    // novo só chega ao banco no próximo salvamento do registro.
    status: salesStatus.normalizar(record.status, record.type),
    // A tela precisa saber que o pedido já gerou as contas a receber — é o que
    // explica por que refaturar não cobra de novo.
    financeApplied: Boolean(record.financeApplied),
    // Qual NF-e saiu deste pedido; vazio enquanto não houver emissão.
    nfeId: record.nfeId || '',
    // Fase AV. A tela precisa mostrar POR QUE um pedido faturado não tem nota —
    // sem isso a dispensa fica registrada no banco e invisível para quem abre.
    dispensaDocumentoFiscal: Boolean(record.dispensaDocumentoFiscal),
    dispensaMotivo: record.dispensaMotivo || '',
    dispensaPorNome: record.dispensaPorNome || '',
    dispensaEm: record.dispensaEm || null,
    // O NÚMERO da nota, não o id: a coluna "NF-e" da lista mostra "1042", e o
    // id é um uuid que não diz nada a quem lê. Resolvido aqui porque é aqui que
    // se tem `data` em mãos — na tela seria uma varredura por linha.
    nfeNumero: (() => {
      if (!record.nfeId) return '';
      const fiscal = (data.nfe || []).find((n) => n.id === record.nfeId);
      if (fiscal) return String(fiscal.numero || '');
      const manual = (data.nfes || []).find((n) => n.id === record.nfeId);
      return manual ? String(manual.number || '') : '';
    })(),
    // Data de envio: mora dentro do grupo de entrega, e a lista precisa dela
    // achatada para poder ordenar e mostrar como coluna.
    dataEnvio: salesDelivery(record).shippingDate || '',
    createdByName: record.createdByName || '',
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || ''
  };
}

// As quatro datas do "Filtrar Por". Lista branca pelo mesmo motivo da
// ordenação: campo vindo da query string sem lista é leitura livre do objeto.
//
// Todas devolvem AAAA-MM-DD. `updatedAt` vem com hora, e comparar
// '2026-08-22T13:40:00Z' com '2026-08-22' deixaria de fora tudo o que foi
// alterado no próprio dia final da busca — o registro some justamente no dia em
// que a pessoa mexeu nele.
const CAMPOS_DE_DATA = {
  cadastro: (r) => String(r.date || '').slice(0, 10),
  alteracao: (r) => String(r.updatedAt || '').slice(0, 10),
  faturamento: (r) => String((r.paymentInfo && r.paymentInfo.nfeBillingDate) || '').slice(0, 10),
  envio: (r) => String(r.dataEnvio || '').slice(0, 10)
};

// Recebe registros JÁ SERIALIZADOS, não os crus. Antes recebia o cru e chamava
// serializeSalesRecord de novo lá dentro, uma vez por linha, só para poder
// comparar o nome do cliente. E mesmo assim os campos que a Busca Avançada
// precisa — número da NF-e, transportadora, data de faturamento — só existem
// depois de serializar. Serializar uma vez antes de filtrar resolve os dois.
function filterSalesRecords(registros, query) {
  let result = registros.slice();
  const texto = (v) => String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  const contem = (valor, alvo) => texto(valor).includes(alvo);

  // Texto = "contém", sem diferenciar maiúsculas: quem procura a OC do cliente
  // digita o pedaço que lembra, não o código inteiro.
  const filtroTexto = (param, ler) => {
    const alvo = texto(query.get(param));
    if (!alvo) return;
    result = result.filter((r) => contem(ler(r), alvo));
  };
  // Seleção = igualdade: o valor vem de uma lista, e "contém" faria a empresa
  // de id 'emp-1' casar com 'emp-12'.
  const filtroExato = (param, ler) => {
    const alvo = String(query.get(param) || '').trim();
    if (!alvo) return;
    result = result.filter((r) => String(ler(r) || '') === alvo);
  };

  const search = texto(query.get('search'));
  if (search) {
    result = result.filter((r) => contem(r.code, search) || contem(r.customer, search) || contem(r.id, search));
  }

  // O status do registro já sai normalizado do serializer; o do filtro vem do
  // catálogo. Normalizar o do filtro também faz o legado casar ('faturado'
  // encontra 'pedido-faturado').
  const status = query.get('status');
  if (status) {
    const alvo = salesStatus.normalizar(status);
    result = result.filter((r) => r.status === alvo);
  }

  filtroExato('type', (r) => r.type);
  filtroExato('companyId', (r) => r.companyId);
  filtroExato('sellerId', (r) => r.sellerId);
  filtroExato('clientSupplierId', (r) => r.clientSupplierId);
  filtroExato('carrierId', (r) => r.delivery && r.delivery.carrierId);
  filtroExato('category', (r) => r.category);
  filtroExato('saleOrigin', (r) => r.saleOrigin);

  // Uma caixa só para NF-e, NFC-e e NFS-e, como pede o briefing: quem procura
  // por um número de nota não quer antes descobrir de qual das três ele é.
  // Junta o número da nota emitida (vínculo fiscal) com os digitados na aba
  // Pagamentos, que é onde moram as notas lançadas à mão.
  filtroTexto('nfeNumero', (r) => [
    r.nfeNumero,
    r.paymentInfo && r.paymentInfo.nfeNumber,
    r.paymentInfo && r.paymentInfo.nfseNumber
  ].filter(Boolean).join(' '));
  filtroTexto('customerPoCode', (r) => r.customerPoCode);
  filtroTexto('clientContact', (r) => r.clientContact);
  filtroTexto('clientStatus', (r) => r.clientStatus);

  // Faixa de valor. Campo vazio não filtra; "De" maior que "Até" não se
  // conserta sozinho — devolve lista vazia, que é a resposta honesta ao que foi
  // pedido. Trocar os dois em silêncio faria a tela responder outra pergunta.
  const numero = (v) => {
    const bruto = String(v === null || v === undefined ? '' : v).trim().replace(',', '.');
    if (!bruto) return null;
    const n = Number(bruto);
    return Number.isFinite(n) ? n : null;
  };
  const valorDe = numero(query.get('valorDe'));
  const valorAte = numero(query.get('valorAte'));
  if (valorDe !== null) result = result.filter((r) => Number(r.amount || 0) >= valorDe);
  if (valorAte !== null) result = result.filter((r) => Number(r.amount || 0) <= valorAte);

  // "Filtrar Por" escolhe QUAL data o período compara. Sem isso, procurar o que
  // foi enviado na semana passada devolvia o que foi CADASTRADO na semana
  // passada — parecido o bastante para ninguém desconfiar do resultado.
  const lerData = CAMPOS_DE_DATA[query.get('dateField')] || CAMPOS_DE_DATA.cadastro;
  const dateFrom = query.get('dateFrom');
  const dateTo = query.get('dateTo');
  // Registro sem a data escolhida fica de fora: pedido que nunca foi enviado
  // não pertence a "enviados em agosto", em nenhuma das pontas do intervalo.
  if (dateFrom) result = result.filter((r) => { const d = lerData(r); return d && d >= dateFrom; });
  if (dateTo) result = result.filter((r) => { const d = lerData(r); return d && d <= dateTo; });

  return result;
}

// Traduz um pedido para o que o cálculo fiscal precisa saber: quem emite, para
// quem, e o que sai. Nada aqui inventa imposto — só reúne o que já está
// cadastrado e diz, em português, o que faltou.
async function montarContextoFiscalDoPedido(body, data) {
  const empresas = await fiscalDb.getEmpresas();
  const empresa = empresas.find((e) => e.ativo !== false) || empresas[0] || null;
  const estabelecimentos = empresa ? await fiscalDb.getEstabelecimentos(empresa.id) : [];
  const emitentes = estabelecimentos.filter((e) => e.ativo !== false && e.emiteNfe !== false);

  // O estabelecimento é escolhido pelo CNPJ da empresa do pedido. Sem esse
  // vínculo — e hoje o cadastro de empresas da venda não guarda CNPJ — cai no
  // único emitente, e o `motivo` diz que foi isso que aconteceu. Escolher em
  // silêncio seria pior: numa empresa com duas filiais em UFs diferentes, a
  // alíquota mudaria sem ninguém saber por quê.
  const empresaDaVenda = (data.companies || []).find((c) => c.id === body.companyId) || null;
  const documento = String((empresaDaVenda && (empresaDaVenda.document || empresaDaVenda.cnpj)) || '').replace(/\D/g, '');
  const porCnpj = documento ? emitentes.find((e) => String(e.cnpj || '').replace(/\D/g, '') === documento) : null;
  let estabelecimento = porCnpj;
  let motivo = '';
  if (!estabelecimento && emitentes.length === 1) {
    estabelecimento = emitentes[0];
    motivo = documento
      ? `O CNPJ da empresa do pedido não casa com nenhum estabelecimento; usando o único emitente cadastrado (${estabelecimento.razaoSocial || estabelecimento.cnpj}).`
      : `A empresa "${(empresaDaVenda && empresaDaVenda.name) || 'do pedido'}" não tem CNPJ cadastrado; usando o único estabelecimento emitente (${estabelecimento.razaoSocial || estabelecimento.cnpj}).`;
  } else if (!estabelecimento && emitentes.length > 1) {
    motivo = 'Há mais de um estabelecimento emitente e a empresa do pedido não tem CNPJ para identificar qual é — cadastre o CNPJ da empresa.';
  }

  // UF e condição de contribuinte do cliente saem do Cadastro. As duas mudam a
  // conta: destino decide interna x interestadual, e contribuinte decide DIFAL.
  const cliente = getCadastroDirectory(data).find((c) => c.id === body.clientSupplierId) || null;
  const destinatario = {
    uf: (cliente && cliente.state) || '',
    // Quem tem inscrição estadual é contribuinte. É o mesmo critério que a
    // emissão usa, e não um campo novo para alguém manter em dia.
    contribuinte: Boolean(cliente && String(cliente.stateRegistration || '').trim())
  };

  const produtos = await db.getProducts();
  const itens = (Array.isArray(body.items) ? body.items : []).map((item) => {
    const produto = produtos.find((p) => p.id === item.productId) || null;
    return {
      codigoProduto: item.sku || (produto && produto.sku) || '',
      descricao: item.name || (produto && produto.name) || '',
      // NCM e origem são do PRODUTO, não do item da venda: são classificação
      // da mercadoria, e o item só diz quanto e por quanto.
      ncm: (produto && produto.ncm) || '',
      origem: (produto && produto.origem) || 0,
      cest: (produto && produto.cest) || '',
      quantidade: Number(item.quantity || 0),
      valorUnitario: Number(item.unitPrice || 0)
    };
  });

  // Valor faturado: o que já virou nota AUTORIZADA. Pedido sem nota tem zero —
  // e zero aqui significa "ainda não faturou", não "faturou zero".
  let valorFaturado = 0;
  if (body.nfeId) {
    const nota = await fiscalDb.getNfeById(body.nfeId).catch(() => null);
    if (nota && String(nota.status || '').toUpperCase() === 'AUTORIZADO') {
      valorFaturado = Number(nota.valorTotal || 0);
    }
  }

  return {
    itens,
    empresa,
    estabelecimento,
    destinatario,
    valorFaturado,
    resumo: {
      empresa: empresa ? (empresa.razaoSocial || empresa.cnpjRaiz) : '',
      estabelecimento: estabelecimento ? (estabelecimento.razaoSocial || estabelecimento.cnpj) : '',
      ufEmitente: estabelecimento ? estabelecimento.uf : '',
      ufDestino: destinatario.uf,
      contribuinte: destinatario.contribuinte,
      motivo
    }
  };
}

/**
 * Aplica o que a MUDANÇA DE STATUS provoca: baixa/devolução de estoque,
 * criação/cancelamento das contas a receber, e a troca de tabela quando o
 * documento deixa de ser pedido (ou passa a ser).
 *
 * Existe como função porque a rota PUT e as ações em lote precisam do MESMO
 * comportamento. Duas cópias divergiriam no lugar mais caro possível: aprovar
 * em lote sem gerar as contas a receber ficaria "aprovado" na tela e nada no
 * Financeiro, e ninguém percebe até a cobrança não sair.
 */
async function aplicarEfeitosDeStatus({ id, current, updated, items, statusNovo, tipoNovo, isOrder, data, user }) {
  // Os dois efeitos são independentes: cada status do catálogo declara se
  // baixa estoque e se gera financeiro, e "Pedido Aprovado Sem Faturamento"
  // é justamente o que faz um sem o outro (transferência, remessa,
  // bonificação). Orçamento nunca faz nenhum dos dois.
  const eraFaturado = Boolean(current.financeApplied);
  const vaiBaixarEstoque = tipoNovo === 'order' && salesStatus.baixaEstoque(statusNovo);
  const vaiGerarFinanceiro = tipoNovo === 'order' && salesStatus.geraFinanceiro(statusNovo);

  // FATURAR EXIGE DOCUMENTO FISCAL (fase AV).
  //
  // Faturar e emitir eram passos soltos: o pedido ficava "Pedido Faturado", com
  // estoque baixado e conta a receber criada, sem nota nenhuma — e nada avisava.
  // Neste banco eram 8 pedidos, R$ 26.033,80, de abril a agosto.
  //
  // A recusa é AQUI, e não na rota, porque este é o ponto por onde passam a
  // edição do pedido E as ações em lote. Na rota, a ação em lote continuaria
  // faturando sem nota — que é a pior forma de ter a regra: a que vale só no
  // caminho que alguém lembrou de proteger.
  //
  // Três saídas legítimas, e nenhuma delas é "deixar passar":
  //   - a nota já existe (nfeId preenchido);
  //   - a saída não tem nota por natureza — aí o status é "Pedido Aprovado Sem
  //     Faturamento", que não exige documento;
  //   - a nota sai depois (SEFAZ fora, contingência) — aí a dispensa, COM
  //     motivo, fica registrada no pedido.
  if (tipoNovo === 'order' && salesStatus.exigeDocumento(statusNovo)) {
    // A NOTA PRECISA VALER, NÃO SÓ EXISTIR (fase BF). `nfeId` preenchido
    // respondia sim para uma nota CANCELADA — e ela fica gravada para
    // sempre, porque documento fiscal não se apaga. Sem isto, um pedido
    // desfaturado pelo cancelamento da nota poderia ser faturado de novo
    // apontando para a mesma nota morta.
    const temNota = Boolean(await notaQueSustentaOFaturamento({
      id, nfeId: updated.nfeId || current.nfeId
    }));
    const dispensado = Boolean(updated.dispensaDocumentoFiscal);
    const motivo = String(updated.dispensaMotivo || '').trim();
    if (!temNota && !dispensado) {
      const erro = new Error(
        'Este pedido não tem NF-e. Emita a nota (a emissão já fatura o pedido), '
        + 'ou use "Pedido Aprovado Sem Faturamento" se a saída não tem documento, '
        + 'ou registre a dispensa com o motivo.'
      );
      erro.status = 400;
      throw erro;
    }
    if (!temNota && dispensado && motivo.length < 10) {
      const erro = new Error(
        'Informe o motivo da dispensa de documento fiscal (pelo menos 10 caracteres). '
        + 'Dispensa sem motivo é faturar sem nota com um clique a mais.'
      );
      erro.status = 400;
      throw erro;
    }
  }

  // A PORTA DE VOLTA, E QUEM A GUARDA (fase BF).
  //
  // 'pedido-faturado' -> 'pedido-nao-faturado' passou a existir para que
  // CANCELAR A NF-e desfaça o faturamento que ela mesma causou: a mercadoria
  // volta, o recebível em aberto é cancelado e o pedido fica pronto para uma
  // nota nova. Antes disso o único caminho para fora era 'pedido-cancelado',
  // que mataria a venda — e cancelar uma nota quase nunca quer dizer cancelar a
  // venda: cancela-se por erro de dados, para reemitir.
  //
  // Mas a porta não pode ficar escancarada na tela. Desfaturar um pedido cuja
  // NF-e continua AUTORIZADA produz o inverso exato do problema que a fase AV
  // resolveu: nota válida para a SEFAZ, mercadoria de volta na prateleira e
  // nenhuma conta a receber. É a mesma regra lida ao contrário — faturar exige
  // documento; desfaturar exige que o documento não valha mais.
  //
  // A recusa fica AQUI pelo mesmo motivo que a de cima: é por este ponto que
  // passam a edição do pedido E as ações em lote.
  if (tipoNovo === 'order'
    && salesStatus.normalizar(current.status) === 'pedido-faturado'
    && statusNovo === 'pedido-nao-faturado') {
    const notaViva = await notaQueSustentaOFaturamento(current);
    if (notaViva) {
      const erro = new Error(
        `A NF-e ${notaViva.numero || notaViva.referencia || ''} deste pedido continua ${notaViva.status}. `
        + 'Cancele a nota primeiro — o cancelamento já devolve o pedido para "Pedido Não Faturado". '
        + 'Desfaturar com a nota de pé deixaria mercadoria em estoque e nota válida na SEFAZ.'
      );
      erro.status = 409;
      throw erro;
    }
  }

  // Roda sempre — inclusive quando o registro DEIXA de ser pedido: virar
  // orçamento tem que devolver ao estoque o que o pedido reservava. A
  // função sai na hora se não havia nem passa a haver reserva.
  await transitionOrderStockEffect(data, {
    oldItems: current.items || [],
    newItems: items,
    wasApplied: Boolean(current.stockApplied),
    willApply: vaiBaixarEstoque,
    record: updated,
    user
  });
  updated.stockApplied = vaiBaixarEstoque;
  updated.financeApplied = vaiGerarFinanceiro;

  // Trocar o status pode mudar o tipo, e pedido e orçamento moram em
  // tabelas diferentes. Grava na tabela nova ANTES de apagar da antiga,
  // mantendo id e código: se a gravação falhar, o registro original
  // continua de pé em vez de sumir. Referências por id (NF-e, contas a
  // receber) seguem válidas porque o id não muda.
  const mudouDeTabela = isOrder !== (tipoNovo === 'order');
  if (!mudouDeTabela) {
    updated = isOrder ? await db.updateOrder(id, updated) : await db.updateQuote(id, updated);
  } else {
    updated = tipoNovo === 'order' ? await db.createOrder(updated) : await db.createQuote(updated);
    if (isOrder) await db.deleteOrder(id); else await db.deleteQuote(id);
    // Espelha a troca nas listas em memória desta requisição — sem isso o
    // saveData() gravaria o registro nas duas listas ao mesmo tempo.
    const origemLista = isOrder ? data.orders : data.quotes;
    const destinoLista = tipoNovo === 'order' ? data.orders : data.quotes;
    const posicao = origemLista.findIndex((entry) => entry.id === id);
    if (posicao >= 0) origemLista.splice(posicao, 1);
    destinoLista.push(updated);
  }

  // Depois de gravar, pelo mesmo motivo da criação: o registro atualizado é
  // que carrega o total e as parcelas atuais. Também roda sempre — um
  // pedido faturado que vira orçamento precisa ter as parcelas canceladas.
  const efeitoFinanceiro = await transitionOrderFinanceEffect(data, {
    record: updated, wasApplied: eraFaturado, willApply: vaiGerarFinanceiro, user
  });
  return { updated, efeitoFinanceiro };
}

// --- As três operações que as ações em lote executam -------------------------
// Cada uma faz por UM registro o que a rota individual faz, usando as mesmas
// peças. Nenhuma delas decide elegibilidade: quem decide é sales_bulk_actions,
// consultado pela tela e pelo servidor.

async function mudarStatusSalesRecord(serializado, destino, data, user) {
  const isOrder = (data.orders || []).some((o) => o.id === serializado.id);
  const lista = isOrder ? data.orders : data.quotes;
  const current = lista.find((r) => r.id === serializado.id);
  if (!current) throw new Error('Registro não encontrado.');

  const statusNovo = salesStatus.normalizar(destino, undefined);
  if (!salesStatus.podeTransicionar(current.status, statusNovo)) {
    throw new Error(salesStatus.motivoDaRecusa(current.status, statusNovo));
  }
  const tipoNovo = salesStatus.tipoDoStatus(statusNovo);
  const updated = {
    ...current,
    type: tipoNovo,
    status: statusNovo,
    updatedByName: user.name,
    updatedAt: new Date().toISOString()
  };
  const efeitos = await aplicarEfeitosDeStatus({
    id: serializado.id,
    current,
    updated,
    // Os itens NÃO mudam numa ação em lote: só o status. Passar os mesmos faz
    // transitionOrderStockEffect comparar antes/depois e mexer só no que a
    // mudança de status pede.
    items: current.items || [],
    statusNovo,
    tipoNovo,
    isOrder,
    data,
    user
  });
  await registrarAuditoria({
    action: 'mudarStatusEmLote',
    targetId: serializado.id,
    targetUsername: String(serializado.code || serializado.id),
    byId: user.id,
    byName: user.name,
    details: { de: current.status, para: statusNovo }
  });
  return efeitos.updated;
}

async function excluirSalesRecord(id, data, user) {
  const order = await db.getOrderById(id);
  const isOrder = Boolean(order);
  const record = order || await db.getQuoteById(id);
  if (!record) throw new Error('Registro não encontrado.');
  if (isOrder && record.stockApplied) {
    // Excluir um pedido que reservava estoque devolve a reserva — sumir com o
    // registro e deixar a reserva de pé travaria a mercadoria para sempre.
    await transitionOrderStockEffect(data, {
      oldItems: record.items || [], newItems: [], wasApplied: true, willApply: false, record, user
    });
  }
  // Os anexos vão junto: sem isto as linhas de pedido_anexo ficam sem nada
  // apontando para elas. Antes de excluir o registro, porque depois as fichas
  // já não existem para dizer QUAIS arquivos apagar.
  for (const ficha of (Array.isArray(record.attachments) ? record.attachments : [])) {
    try {
      await anexosDb.removerAnexo(ficha);
    } catch (erro) {
      console.error('[anexos] arquivo orfao em pedido_anexo:', ficha.id, erro.message);
    }
  }
  await (isOrder ? db.deleteOrder(id) : db.deleteQuote(id));
  const lista = isOrder ? data.orders : data.quotes;
  const pos = lista.findIndex((r) => r.id === id);
  if (pos >= 0) lista.splice(pos, 1);
  await registrarAuditoria({
    action: 'excluirEmLote',
    targetId: id,
    targetUsername: String(record.code || id),
    byId: user.id,
    byName: user.name
  });
}

async function duplicarSalesRecord(serializado, data, user) {
  const tipo = serializado.type === 'quote' ? 'quote' : 'order';
  // A cópia nasce como RASCUNHO do próprio tipo. Duplicar um pedido faturado e
  // a cópia já nascer faturada baixaria estoque e criaria contas a receber de
  // uma venda que ninguém fez.
  const status = salesStatus.padraoDoTipo(tipo);
  const copia = {
    ...serializado,
    id: createId(tipo === 'order' ? 'ord' : 'qte'),
    code: await db.getNextSalesCode(),
    status,
    type: tipo,
    stockApplied: false,
    financeApplied: false,
    // A NF-e é do documento original. A cópia é outro documento e ainda não
    // tem nota.
    nfeId: '',
    // Nem a dispensa: ela foi dada para AQUELA venda, com aquele motivo e
    // aquele autor. Herdá-la faria a cópia nascer autorizada a faturar sem nota
    // por uma razão que ninguém deu para ela.
    dispensaDocumentoFiscal: false,
    dispensaMotivo: '',
    dispensaPor: null,
    dispensaPorNome: '',
    dispensaEm: null,
    // Anexos não são copiados: o arquivo está gravado sob o id do anexo
    // original, e duas fichas apontando para a mesma linha fariam excluir uma
    // quebrar a outra.
    attachments: [],
    // O chassi identifica UMA unidade física: copiá-lo criaria duas vendas do
    // mesmo equipamento.
    items: (serializado.items || []).map((item) => ({ ...item, chassi: '' })),
    createdBy: user.id,
    createdByName: user.name,
    createdAt: new Date().toISOString(),
    updatedByName: user.name,
    updatedAt: new Date().toISOString()
  };
  const gravado = tipo === 'order' ? await db.createOrder(copia) : await db.createQuote(copia);
  // Entra na lista em memória desta requisição: sem isso, duplicar dois
  // registros na mesma leva faria o segundo não enxergar o primeiro.
  (tipo === 'order' ? data.orders : data.quotes).push(gravado);
  await registrarAuditoria({
    action: 'duplicarEmLote',
    targetId: gravado.id,
    targetUsername: String(gravado.code),
    byId: user.id,
    byName: user.name,
    details: { origem: serializado.code }
  });
  return gravado;
}

/**
 * Os números do Painel Vendas e do Painel Vendedor — RECORTADOS PELO ESCOPO.
 *
 * O ESCOPO É OBRIGATÓRIO, E A FUNÇÃO QUEBRA SEM ELE
 * -------------------------------------------------
 * Esta função já foi `buildSalesDashboardSummary(data)`, sem recorte nenhum, e
 * o defeito que isso produzia era exatamente o oposto de barulhento: um
 * vendedor comum abria o Painel Vendedor, escolhia o colega no seletor e lia a
 * lista de pedidos dele inteira — cliente, valor e data — sem erro nenhum
 * aparecer, porque a rota entregava `bySeller` com TODO MUNDO e cabia à tela
 * desenhar só um. Tela não é controle de acesso.
 *
 * Deixar o parâmetro opcional, com "sem escopo = mostra tudo", seria repetir o
 * mesmo defeito na primeira rota nova que esquecesse de passá-lo. Por isso a
 * ausência é ERRO, e não permissão: quem chama tem que ter decidido de quem são
 * as vendas antes de pedir os números.
 *
 * QUAL ESCOPO ENTRA AQUI
 * ----------------------
 * `escopoDeVendas` (o do Relatório), e não `escopoPessoal` (o do Meu Painel).
 * São perguntas diferentes e a diferença é o administrador: aqui ele PRECISA
 * ver o time inteiro, porque esta é a tela de gestão. O vendedor comum vê só a
 * si mesmo, e quem não tem vínculo não vê nada.
 *
 * O RECORTE ACONTECE UMA VEZ, NO TOPO
 * -----------------------------------
 * Filtrar `orders` e `quotes` logo na entrada faz overview, bySeller e ticket
 * médio saírem todos do mesmo universo. Recortar só o `bySeller` deixaria o
 * card "Total vendido" somando a empresa inteira ao lado de uma tabela com
 * quatro linhas — o descasamento clássico de quem filtra em dois lugares.
 */
function buildSalesDashboardSummary(data, escopo) {
  if (!escopo) {
    throw new Error('buildSalesDashboardSummary exige um escopo (lib/relatorios-escopo.js). Sem ele a resposta vazaria as vendas de todos os vendedores.');
  }
  const visivel = (record) => escopoLib.vendaVisivel(escopo, record.sellerId);
  const orders = (data.orders || []).filter(visivel).map((record) => serializeSalesRecord(record, data));
  const quotes = (data.quotes || []).filter(visivel).map((record) => serializeSalesRecord(record, data));

  const valorPedidos = Math.round(orders.reduce((sum, o) => sum + Number(o.amount || 0), 0) * 100) / 100;
  const valorOrcamentos = Math.round(quotes.reduce((sum, q) => sum + Number(q.amount || 0), 0) * 100) / 100;
  // "Faturados" é receita: conta quem gera financeiro. Uma saída aprovada sem
  // faturamento (transferência, remessa) mexeu no estoque mas não é venda, e
  // entrar aqui inflaria o painel com dinheiro que não existe.
  const pedidosFaturados = orders.filter((o) => salesStatus.geraFinanceiro(o.status)).length;
  // "Pendentes" é o que ainda não se resolveu: nada saiu do estoque e não foi
  // cancelado. Uma remessa aprovada sem faturamento já se resolveu, mesmo sem
  // ter virado receita.
  const pedidosPendentes = orders.filter((o) => !salesStatus.baixaEstoque(o.status) && !salesStatus.ehCancelado(o.status)).length;

  const overview = {
    totalPedidos: orders.length,
    valorPedidos,
    totalOrcamentos: quotes.length,
    valorOrcamentos,
    pedidosFaturados,
    pedidosPendentes,
    ticketMedio: orders.length ? Math.round((valorPedidos / orders.length) * 100) / 100 : 0
  };

  // A LISTA DE VENDEDORES TAMBÉM É RECORTADA, e não só os pedidos de cada um.
  //
  // Com os pedidos filtrados mas a lista inteira, o seletor do Painel Vendedor
  // continuaria mostrando o nome de todos os colegas — cada um com zero pedidos.
  // Vazaria menos (nome, e não valor), mas continuaria vazando: quem é a equipe
  // de vendas, quantas pessoas são e como se chamam. E a tela ficaria absurda,
  // com um seletor de dez nomes que sempre devolvem lista vazia.
  const bySeller = getSellersDirectory(data)
    .filter((seller) => escopoLib.vendaVisivel(escopo, seller.id))
    .map((seller) => {
    const sellerOrders = orders.filter((o) => o.sellerId === seller.id);
    const valorTotal = Math.round(sellerOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0) * 100) / 100;
    return {
      sellerId: seller.id,
      sellerName: seller.name,
      totalPedidos: sellerOrders.length,
      valorTotal,
      ticketMedio: sellerOrders.length ? Math.round((valorTotal / sellerOrders.length) * 100) / 100 : 0,
      orders: sellerOrders
        .map((o) => ({ id: o.id, code: o.code, customer: o.customer, amount: o.amount, date: o.date, status: o.status }))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    };
  });

  return { overview, bySeller };
}

function getFinanceEntryPayments(data, entryId) {
  return (data.financialPayments || []).filter((payment) => payment.entryId === entryId);
}

function financeEntryEffectiveDue(entry, payments) {
  return Number(entry.amount || 0) + sumBy(payments, 'interest') + sumBy(payments, 'fine') - sumBy(payments, 'discount');
}

function financeEntryPaidTotal(payments) {
  return sumBy(payments, 'amount');
}

/**
 * O QUE UM LANÇAMENTO PRECISA RESPEITAR — AO NASCER E AO SER EDITADO (fase BG).
 *
 * As regras existiam só no POST. O PUT não repetia nenhuma delas, e o
 * formulário confiava em `required` e `min="0.01"` no HTML, que valem só dentro
 * do navegador. Provado contra a API:
 *
 *   POST {"description":"","amount":0}       -> 400 "Informe a descrição"
 *   PUT  {"description":"   ","amount":-500} -> 200, gravado com valor -500
 *   POST transferência com origem = destino  -> 400
 *   PUT  destino := a conta de origem        -> 200, transferência para si mesma
 *
 * Um lançamento com valor negativo não é uma despesa a mais: ele SUBTRAI do
 * total a pagar e some da conferência, porque ninguém procura um título com o
 * sinal trocado. E lançamento sem descrição é uma linha em branco na lista.
 *
 * O TIPO NÃO ESTÁ AQUI, de propósito. É conferência de ENTRADA, e só o POST
 * recebe tipo — o PUT nunca o altera. Cobrar tipo válido na edição recusaria
 * salvar um lançamento antigo por um campo que a tela nem mostra: a pessoa
 * abriria para mudar o vencimento e ficaria presa sem saída. Ele continua sendo
 * conferido no POST, onde chega do formulário.
 *
 * Recebe o estado PROPOSTO (o registro já com a edição aplicada por cima), e não
 * o corpo da requisição: um PUT que manda só `amount` precisa ser conferido
 * contra a descrição que já estava lá.
 */
function validarLancamentoFinanceiro({ description, amount, bankAccountId, targetBankAccountId, type }) {
  if (!String(description == null ? '' : description).trim()) {
    return 'Informe a descrição do lançamento';
  }
  if (!(Number(amount || 0) > 0)) {
    return 'Informe um valor maior que zero';
  }
  if (String(type || '').toUpperCase() === 'TRANSFERENCIA'
    && bankAccountId && targetBankAccountId && bankAccountId === targetBankAccountId) {
    return 'A conta de origem e a conta de destino da transferência não podem ser a mesma.';
  }
  return '';
}

function recomputeFinanceEntryStatus(entry, data) {
  if (entry.status === 'cancelado') return 'cancelado';
  const payments = getFinanceEntryPayments(data, entry.id);
  if (!payments.length) return 'pending';
  const due = financeEntryEffectiveDue(entry, payments);
  const paid = financeEntryPaidTotal(payments);
  if (paid + 0.005 >= due) return 'paid';
  return 'parcial';
}

/**
 * PONTO ÚNICO da trilha de auditoria.
 *
 * Ela vivia em `data/db.json` — arquivo no disco local do servidor. Para
 * emissão, cancelamento, carta de correção e inutilização de NF-e isso é o
 * pior lugar possível: é a única prova de QUEM fez o quê num documento
 * fiscal, e some junto com a máquina.
 *
 * Agora grava em `audit_logs` (Supabase). A tabela e as funções já existiam
 * desde o começo — nunca tinham sido ligadas.
 *
 * NÃO propaga o erro: a nota já foi transmitida à SEFAZ quando este código
 * roda. Falhar aqui não desfaz a emissão, só perderia o registro — por isso
 * há a queda para o arquivo local, que deixa o rastro em algum lugar em vez
 * de em nenhum.
 */
async function registrarAuditoria({ action, targetId, targetUsername, byId, byName, details }) {
  const registro = {
    action,
    targetId: targetId || '',
    targetUsername: targetUsername || '',
    byId: byId || '',
    byName: byName || '',
    details: details || null
  };
  try {
    return await db.addAuditLog(registro);
  } catch (error) {
    console.error('Falha ao gravar auditoria no Supabase:', action, error.message);
    try {
      const data = loadData();
      data.auditLogs = data.auditLogs || [];
      data.auditLogs.push({ id: createId('audit'), ...registro, at: new Date().toISOString(), pendenteDeSincronia: true });
      saveData(data);
    } catch (erroLocal) {
      console.error('E também falhou o registro local:', erroLocal.message);
    }
    return null;
  }
}

async function addFinanceAuditLog(_data, { action, entry, byId, byName, details }) {
  return registrarAuditoria({
    action,
    targetId: entry.id,
    targetUsername: `Lançamento ${String(entry.id).slice(-8)} · ${entry.description || ''}`.trim(),
    byId,
    byName,
    details
  });
}

function serializeFinanceEntry(entry, data) {
  const payments = getFinanceEntryPayments(data, entry.id);
  return {
    id: entry.id,
    // Fase AT: o numero do lancamento e o codigo pronto (LF0042). Os dois vao
    // para a tela — o numero para ordenar e buscar, o codigo para mostrar, sem
    // cada tela reimplementar o padding e uma delas escrever "LF42".
    code: entry.code == null ? null : Number(entry.code),
    codigo: lancamentoCodigo.formatar(entry.code),
    type: classifyFinanceEntry(entry),
    date: entry.date,
    dueDate: financeEntryDueDate(entry),
    description: entry.description,
    document: entry.document || '',
    note: entry.note || '',
    // Fase AX: por que foi cancelado. A tela mostra isto no lugar dos botoes de
    // baixa — quem abre um lancamento cancelado quer exatamente esta resposta.
    cancelReason: entry.cancelReason || '',
    cancelledAt: entry.cancelledAt || null,
    cancelledByName: entry.cancelledByName || '',
    category: entry.category || '',
    categoryName: resolveById(data.financialCategories, entry.category),
    costCenter: entry.costCenter || '',
    costCenterName: resolveById(data.costCenters, entry.costCenter),
    bankAccountId: entry.bankAccountId || '',
    bankAccountName: resolveById(data.bankAccounts, entry.bankAccountId),
    targetBankAccountId: entry.targetBankAccountId || '',
    targetBankAccountName: resolveById(data.bankAccounts, entry.targetBankAccountId),
    clientSupplierId: entry.clientSupplierId || '',
    clienteFornecedor: resolveFinanceCounterparty(entry, data),
    amountPrevisto: Number(entry.amount || 0),
    // entradas antigas de vendas/compras marcam status 'paid' direto, sem registrar baixa em financialPayments;
    // sem esse fallback o valor realizado aparece como R$ 0,00 para um lançamento já "Pago/Recebido"
    amountRealizado: payments.length > 0 ? financeEntryPaidTotal(payments) : (isFinanceEntryRealized(entry) ? Number(entry.amount || 0) : 0),
    editable: !entry.referenceId && !entry.nfeId,
    // Vinculado a um pedido ou a uma NF-e: NÃO significa mais "intocável".
    // Valor, data, descrição e cliente pertencem à origem; vencimento, conta,
    // plano de contas, centro de custo, documento e observação continuam sendo
    // do Financeiro. A tela usa isto para travar só o que é da origem, em vez
    // de deixar preencher tudo e recusar no fim — que era o beco sem saída
    // relatado em 22/08/2026.
    vinculo: entry.nfeId ? 'nfe' : (entry.referenceId ? 'pedido' : ''),
    camposTravados: (entry.referenceId || entry.nfeId)
      ? ['amount', 'date', 'description', 'clientSupplierId', 'clientSupplierName', 'type']
      : [],
    status: financeEntryStatusLabel(entry),
    rawStatus: entry.status,
    createdByName: entry.createdByName || '',
    createdAt: entry.createdAt || '',
    payments: payments
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((p) => ({
        id: p.id,
        amount: p.amount,
        date: p.date,
        bankAccountId: p.bankAccountId,
        bankAccountName: resolveById(data.bankAccounts, p.bankAccountId),
        interest: p.interest,
        fine: p.fine,
        discount: p.discount,
        note: p.note,
        createdByName: p.createdByName,
        createdAt: p.createdAt
      }))
  };
}

function filterFinanceEntries(data, query) {
  let entries = (data.finance || []).slice();

  const search = String(query.get('search') || '').trim().toLowerCase();
  if (search) {
    entries = entries.filter((entry) => {
      const name = resolveFinanceCounterparty(entry, data) || '';
      return String(entry.description || '').toLowerCase().includes(search)
        || String(entry.id || '').toLowerCase().includes(search)
        || name.toLowerCase().includes(search);
    });
  }

  const type = query.get('type');
  if (type) entries = entries.filter((entry) => classifyFinanceEntry(entry) === type);

  const status = query.get('status');
  if (status) entries = entries.filter((entry) => financeEntryStatusLabel(entry) === status);

  const clientSupplierId = query.get('clientSupplierId');
  if (clientSupplierId) entries = entries.filter((entry) => entry.clientSupplierId === clientSupplierId);

  const category = query.get('category');
  if (category) entries = entries.filter((entry) => entry.category === category);

  const costCenter = query.get('costCenter');
  if (costCenter) entries = entries.filter((entry) => entry.costCenter === costCenter);

  const bankAccountId = query.get('bankAccountId');
  if (bankAccountId) entries = entries.filter((entry) => entry.bankAccountId === bankAccountId);

  const dateFrom = query.get('dateFrom');
  const dateTo = query.get('dateTo');
  if (dateFrom) entries = entries.filter((entry) => entry.date >= dateFrom);
  if (dateTo) entries = entries.filter((entry) => entry.date <= dateTo);

  const dueFrom = query.get('dueFrom');
  const dueTo = query.get('dueTo');
  if (dueFrom) entries = entries.filter((entry) => financeEntryDueDate(entry) >= dueFrom);
  if (dueTo) entries = entries.filter((entry) => financeEntryDueDate(entry) <= dueTo);

  const amountMin = query.get('amountMin');
  const amountMax = query.get('amountMax');
  if (amountMin) entries = entries.filter((entry) => Number(entry.amount || 0) >= Number(amountMin));
  if (amountMax) entries = entries.filter((entry) => Number(entry.amount || 0) <= Number(amountMax));

  return entries;
}

// Vocabulário único de status para a tela, vindo dos DOIS mundos: o registro
// manual do Financeiro (minúsculas, 'emitida'/'cancelada') e a nota real da
// SEFAZ (maiúsculas, 'AUTORIZADO'/'ERRO'/'RASCUNHO'...).
const NFE_STATUS_FISCAL = {
  RASCUNHO: 'rascunho',
  PROCESSANDO: 'processando',
  AUTORIZADO: 'autorizada',
  ERRO: 'erro',
  CANCELADO: 'cancelada',
  DENEGADO: 'denegada',
  INUTILIZADO: 'inutilizada'
};

function normalizeNfeStatus(raw) {
  const bruto = String(raw || '').trim();
  const fiscal = NFE_STATUS_FISCAL[bruto.toUpperCase()];
  if (fiscal) return fiscal;
  const s = bruto.toLowerCase();
  if (s === 'emitida' || s === 'autorizada') return 'autorizada';
  if (['cancelada', 'denegada', 'rejeitada', 'pendente', 'rascunho', 'processando', 'erro', 'inutilizada'].includes(s)) return s;
  // NUNCA cair em 'autorizada'. O default anterior fazia isso, e transformava
  // qualquer status desconhecido — inclusive um ERRO de SEFAZ — numa nota que
  // a tela mostrava como autorizada, com botão de cancelar e tudo.
  return 'pendente';
}

function parseDateOnly(value) {
  const [y, m, d] = String(value || '').split('-').map(Number);
  if (!y || !m || !d) return getTodayLocal();
  return new Date(y, m - 1, d);
}

function buildNfeInstallments(nfe) {
  const total = Number(nfe.amount || 0);
  const count = Math.min(60, Math.max(1, Math.round(Number(nfe.installmentsCount || 1))));
  const intervalDays = Math.max(1, Number(nfe.installmentIntervalDays || 30));
  const baseDate = parseDateOnly(nfe.date);
  const per = Math.floor((total / count) * 100) / 100;
  const installments = [];
  let allocated = 0;
  for (let i = 0; i < count; i += 1) {
    const isLast = i === count - 1;
    const amount = isLast ? Math.round((total - allocated) * 100) / 100 : per;
    allocated += amount;
    const due = new Date(baseDate);
    // à vista (count === 1) vence na própria data de emissão; parcelado usa múltiplos do intervalo (30/60/...)
    if (count > 1) {
      due.setDate(due.getDate() + intervalDays * (i + 1));
    }
    installments.push({ number: i + 1, dueDate: toDateStr(due), amount });
  }
  return installments;
}

function serializeNfe(nfe, data) {
  const linkedEntries = (data.finance || []).filter((entry) => entry.nfeId === nfe.id);
  return {
    id: nfe.id,
    number: nfe.number,
    series: nfe.series || '1',
    date: nfe.date,
    status: normalizeNfeStatus(nfe.status),
    key: nfe.key || '',
    amount: Number(nfe.amount || 0),
    customer: nfe.customer || '',
    clientSupplierId: nfe.clientSupplierId || '',
    clientDocument: nfe.clientDocument || '',
    clientAddress: nfe.clientAddress || '',
    clientCity: nfe.clientCity || '',
    clientState: nfe.clientState || '',
    clientStateRegistration: nfe.clientStateRegistration || '',
    items: nfe.items || [],
    taxNotes: nfe.taxNotes || '',
    paymentType: nfe.paymentType || 'avista',
    installmentsCount: nfe.installmentsCount || 1,
    installmentIntervalDays: nfe.installmentIntervalDays || 30,
    financialEntries: linkedEntries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      dueDate: financeEntryDueDate(entry),
      amount: Number(entry.amount || 0),
      status: financeEntryStatusLabel(entry)
    })),
    createdByName: nfe.createdByName || '',
    createdAt: nfe.createdAt || ''
  };
}

/**
 * A nota REAL (tabela `nfe`, transmitida à SEFAZ) no formato que a tela de
 * NF-e Emitidas já desenha.
 *
 * Traduzir aqui, e não reescrever a tela, é o que permite as duas origens
 * conviverem numa lista só enquanto as notas antigas existirem. O campo
 * `origem` é o que diz a cada linha quais ações ela suporta: uma nota manual
 * do Financeiro não tem chave, nem XML, nem o que consultar na SEFAZ.
 */
function fiscalNfeParaLista(nfe) {
  return {
    id: nfe.id,
    origem: 'fiscal',
    number: nfe.numero || '',
    series: nfe.serie || '',
    date: String(nfe.dataEmissao || nfe.criadoEm || '').slice(0, 10),
    status: normalizeNfeStatus(nfe.status),
    statusFiscal: nfe.status,
    key: nfe.chaveAcesso || '',
    amount: Number(nfe.valorTotal || 0),
    customer: nfe.destinatarioNome || '',
    clientDocument: nfe.destinatarioDocumento || '',
    orderId: nfe.orderId || '',
    referencia: nfe.referencia || '',
    mensagemSefaz: nfe.mensagemSefaz || '',
    protocolo: nfe.protocolo || '',
    temXml: Boolean(nfe.urlXml),
    temDanfe: Boolean(nfe.urlDanfe),
    // Quando a SEFAZ autorizou — é daqui que sai o prazo de 24h para cancelar.
    // Sem este campo a tela não teria como desabilitar o botão, e a pessoa só
    // descobriria o vencimento depois de escrever a justificativa inteira.
    autorizadoEm: nfe.autorizadoEm || '',
    // A nota fiscal não gera parcela por si: o financeiro vem do pedido.
    financialEntries: [],
    items: []
  };
}

function filterNfes(data, query, listaBase) {
  let list = listaBase ? listaBase.slice() : (data.nfes || []).slice();

  const search = String(query.get('search') || '').trim().toLowerCase();
  if (search) {
    list = list.filter((nfe) => String(nfe.number || '').toLowerCase().includes(search)
      || String(nfe.customer || '').toLowerCase().includes(search)
      || String(nfe.key || '').toLowerCase().includes(search));
  }

  const status = query.get('status');
  if (status) list = list.filter((nfe) => normalizeNfeStatus(nfe.status) === status);

  const dateFrom = query.get('dateFrom');
  const dateTo = query.get('dateTo');
  if (dateFrom) list = list.filter((nfe) => nfe.date >= dateFrom);
  if (dateTo) list = list.filter((nfe) => nfe.date <= dateTo);

  return list;
}

function serializeBankTransaction(tx, data) {
  const matchedEntry = tx.matchedEntryId ? (data.finance || []).find((entry) => entry.id === tx.matchedEntryId) : null;
  return {
    id: tx.id,
    bankAccountId: tx.bankAccountId || '',
    bankAccountName: resolveById(data.bankAccounts, tx.bankAccountId),
    date: tx.date,
    description: tx.description,
    amount: Number(tx.amount || 0),
    type: tx.type,
    status: tx.status,
    matchedEntryId: tx.matchedEntryId || '',
    matchedEntryDescription: matchedEntry ? matchedEntry.description : '',
    source: tx.source || 'manual',
    createdByName: tx.createdByName || '',
    createdAt: tx.createdAt || ''
  };
}

function filterBankTransactions(data, query) {
  let list = (data.bankTransactions || []).slice();

  const bankAccountId = query.get('bankAccountId');
  if (bankAccountId) list = list.filter((tx) => tx.bankAccountId === bankAccountId);

  const status = query.get('status');
  if (status) list = list.filter((tx) => tx.status === status);

  const type = query.get('type');
  if (type) list = list.filter((tx) => tx.type === type);

  const search = String(query.get('search') || '').trim().toLowerCase();
  if (search) list = list.filter((tx) => String(tx.description || '').toLowerCase().includes(search));

  const dateFrom = query.get('dateFrom');
  const dateTo = query.get('dateTo');
  if (dateFrom) list = list.filter((tx) => tx.date >= dateFrom);
  if (dateTo) list = list.filter((tx) => tx.date <= dateTo);

  return list;
}

function buildBankTransaction(body, user, source) {
  return {
    id: createId('btx'),
    bankAccountId: body.bankAccountId || '',
    date: body.date || new Date().toISOString().slice(0, 10),
    description: String(body.description || '').trim(),
    amount: Math.abs(Number(body.amount || 0)),
    type: body.type === 'saida' ? 'saida' : 'entrada',
    status: 'nao_conciliado',
    matchedEntryId: '',
    matchedPaymentId: '',
    source,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function findBankTransactionMatches(tx, data) {
  const wantedType = tx.type === 'entrada' ? 'receita' : 'despesa';
  const txDate = parseDateOnly(tx.date);
  // Contraparte vinda de uma sincronização Open Finance de verdade
  // (merchantName/counterpartyName + os documentos) — em transação manual
  // isso vem tudo vazio e o score cai pra considerar só valor/data, igual
  // sempre funcionou.
  const txCounterpartyName = tx.counterpartyName || tx.merchantName || '';
  const txCounterpartyDocument = sanitizeDigits(tx.counterpartyDocument || tx.merchantDocument || '');

  const candidates = (data.finance || [])
    .filter((entry) => classifyFinanceEntry(entry) === wantedType)
    .filter((entry) => {
      const status = String(entry.status || '').toLowerCase();
      return status === 'pending' || status === 'parcial';
    })
    .map((entry) => {
      const payments = getFinanceEntryPayments(data, entry.id);
      const due = financeEntryEffectiveDue(entry, payments);
      const paid = financeEntryPaidTotal(payments);
      const remaining = Math.round((due - paid) * 100) / 100;
      const amountDiff = Math.abs(remaining - Number(tx.amount || 0));
      const daysDiff = Math.abs((parseDateOnly(financeEntryDueDate(entry)) - txDate) / 86400000);

      const entryDocument = sanitizeDigits(resolveFinanceCounterpartyDocument(entry, data));
      const documentMatch = Boolean(entryDocument && txCounterpartyDocument && entryDocument === txCounterpartyDocument);
      const nameMatch = Boolean(txCounterpartyName) && looseNameMatch(resolveFinanceCounterparty(entry, data), txCounterpartyName);

      return { entry, remaining, amountDiff, daysDiff, documentMatch, nameMatch };
    })
    .sort((a, b) => (a.amountDiff - b.amountDiff) || (a.daysDiff - b.daysDiff))
    .slice(0, 8);

  return candidates.map(({ entry, remaining, amountDiff, daysDiff, documentMatch, nameMatch }) => ({
    id: entry.id,
    description: entry.description,
    dueDate: financeEntryDueDate(entry),
    remaining,
    amountPrevisto: Number(entry.amount || 0),
    clienteFornecedor: resolveFinanceCounterparty(entry, data),
    exactAmountMatch: amountDiff < 0.01,
    matchScore: scoreBankTransactionMatch({ amountDiff, daysDiff, remaining, nameMatch, documentMatch })
  }));
}

// Ponte entre lib/openfinance/sync.js (que não conhece data/db.json — só
// recebe callbacks) e o armazenamento real de bank_accounts/bank_transactions
// hoje, que é o arquivo local (a versão Supabase dessas duas tabelas existe
// em lib/db/financeiro.js mas nenhuma rota usa ela ainda — ver db.js). Saldo
// (account_balances) é a exceção: tabela nova, sem equivalente no JSON, então
// vai direto pro Supabase via lib/db/openfinance.js.
//
// Cada callback faz seu PRÓPRIO loadData()/saveData(), em vez de carregar
// uma vez no início da sincronização inteira e salvar só no final — uma
// sincronização passa por vários "await" (chamadas ao provider, ao Supabase)
// e o resto do sistema não pausa nesse meio-tempo. Se outra rota gravasse
// data/db.json enquanto uma sincronização longa ainda está com uma cópia
// antiga em memória, a gravação final da sincronização apagaria essa outra
// mudança. Manter cada leitura+escrita curta e imediata (mesmo padrão já
// usado em toda rota HTTP deste arquivo) evita essa janela de corrida.
function buildOpenFinanceSyncDeps() {
  return {
    // Contas bancárias saíram do db.json na Fase M: leitura e escrita vão
    // direto ao Supabase, o que elimina de vez a janela de corrida que o
    // comentário acima descreve para este fluxo.
    getExistingAccounts: async (connectionId) => (await db.getBankAccounts()).filter((acc) => acc.connectionId === connectionId),
    persistAccount: async ({ connectionId, estabelecimentoId, account }) => {
      const criada = await db.createBankAccount({
        name: account.name || 'Conta sincronizada',
        bank: account.institutionName || '',
        agency: '',
        number: '',
        estabelecimentoId: estabelecimentoId || '',
        connectionId,
        provider: account.provider || '',
        providerAccountId: account.providerAccountId,
        accountType: account.accountType || '',
        currency: account.currency || 'BRL',
        status: 'ativa'
      });
      // createBankAccount não grava saldo (quem cuida disso é o update, que a
      // sincronização usa nas rodadas seguintes) — mas a conta precisa nascer
      // já com o saldo que veio do banco, senão aparece zerada até o próximo ciclo.
      return db.updateBankAccount(criada.id, {
        currentBalance: account.currentBalance ?? null,
        availableBalance: account.availableBalance ?? null,
        status: 'ativa',
        lastSyncAt: new Date().toISOString()
      });
    },
    updateAccount: async (localId, account) => {
      await db.updateBankAccount(localId, {
        currentBalance: account.currentBalance,
        availableBalance: account.availableBalance,
        status: 'ativa',
        lastSyncAt: new Date().toISOString()
      });
    },
    recordBalance: async (localId, balance) => {
      await openFinanceDb.recordAccountBalance({
        accountId: localId,
        currentBalance: balance.currentBalance,
        availableBalance: balance.availableBalance
      });
    },
    getExistingTransactions: async (localAccountId) => loadData().bankTransactions.filter((tx) => tx.bankAccountId === localAccountId),
    persistTransaction: async (localAccountId, tx) => {
      const data = loadData();
      const bankTransaction = {
        id: createId('btx'),
        bankAccountId: localAccountId,
        date: tx.date,
        description: tx.description || '',
        amount: Math.abs(Number(tx.amount || 0)),
        type: tx.direction === 'saida' ? 'saida' : 'entrada',
        status: 'nao_conciliado',
        matchedEntryId: '',
        matchedPaymentId: '',
        source: 'open_finance',
        createdBy: '',
        createdByName: 'Sincronização Open Finance',
        createdAt: new Date().toISOString(),
        provider: tx.provider || '',
        providerTransactionId: tx.providerTransactionId,
        processingDate: tx.processingDate || '',
        direction: tx.direction || '',
        category: tx.category || '',
        subcategory: tx.subcategory || '',
        merchantName: tx.merchantName || '',
        merchantDocument: tx.merchantDocument || '',
        counterpartyName: tx.counterpartyName || '',
        counterpartyDocument: tx.counterpartyDocument || '',
        paymentMethod: tx.paymentMethod || '',
        pixKey: tx.pixKey || '',
        pixEndToEndId: tx.pixEndToEndId || '',
        pixType: tx.pixType || '',
        documentNumber: tx.documentNumber || '',
        originalData: tx.raw || null
      };
      data.bankTransactions.push(bankTransaction);
      saveData(data);
      return bankTransaction;
    }
  };
}

// Sincroniza uma conexão de ponta a ponta. Falha parcial (ex.: 2ª conta deu
// erro) ainda mantém salvo o progresso da 1ª — cada conta/transação já foi
// gravada de forma independente pelos callbacks acima, não há nada a
// descartar nem um saveData() final pra esquecer de chamar no catch.
async function syncOpenFinanceConnection(connectionId) {
  const deps = buildOpenFinanceSyncDeps();
  return openFinanceSync.syncConnection(connectionId, deps);
}

// Janela de datas por granularidade — compartilhada entre o gráfico do Financeiro
// e o gráfico de Vendas do Dashboard Geral, pra manter os dois com o mesmo recorte
// de tempo/rótulos ao trocar "Diário/Semanal/Mensal/Anual".
function buildPeriodBuckets(granularity) {
  const today = getTodayLocal();
  const buckets = [];

  if (granularity === 'day') {
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const s = toDateStr(d);
      buckets.push({ label: s.slice(5), from: s, to: s });
    }
  } else if (granularity === 'week') {
    const day = today.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + diffToMonday);
    for (let i = 7; i >= 0; i -= 1) {
      const monday = new Date(thisMonday);
      monday.setDate(thisMonday.getDate() - i * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      buckets.push({ label: `${pad2(monday.getDate())}/${pad2(monday.getMonth() + 1)}`, from: toDateStr(monday), to: toDateStr(sunday) });
    }
  } else if (granularity === 'year') {
    for (let i = 4; i >= 0; i -= 1) {
      const y = today.getFullYear() - i;
      buckets.push({ label: String(y), from: `${y}-01-01`, to: `${y}-12-31` });
    }
  } else {
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      buckets.push({ label: `${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`, from: toDateStr(first), to: toDateStr(last) });
    }
  }

  return buckets;
}

function buildFinanceChartSeries(entries, granularity) {
  const buckets = buildPeriodBuckets(granularity);

  return buckets.map((bucket) => {
    const inRange = entries.filter((entry) => entry.date >= bucket.from && entry.date <= bucket.to);
    const receitas = sumFinanceAmount(inRange.filter((entry) => classifyFinanceEntry(entry) === 'receita' && isFinanceEntryRealized(entry)));
    const despesas = sumFinanceAmount(inRange.filter((entry) => classifyFinanceEntry(entry) === 'despesa' && isFinanceEntryRealized(entry)));
    return { label: bucket.label, from: bucket.from, to: bucket.to, receitas, despesas, saldo: receitas - despesas };
  });
}

// Fluxo de Vendas do Dashboard Geral: pedidos x orçamentos por período (mesmo
// recorte de tempo do gráfico do Financeiro, mesma ideia de "linhas por período").
function buildSalesChartSeries(data, granularity) {
  const buckets = buildPeriodBuckets(granularity);
  const orders = data.orders || [];
  const quotes = data.quotes || [];
  const amountOf = (record) => (typeof record.totalAmount === 'number' ? record.totalAmount : Number(record.amount || 0));

  return buckets.map((bucket) => {
    const pedidos = sumBy(orders.filter((o) => o.date >= bucket.from && o.date <= bucket.to).map((o) => ({ v: amountOf(o) })), 'v');
    const orcamentos = sumBy(quotes.filter((q) => q.date >= bucket.from && q.date <= bucket.to).map((q) => ({ v: amountOf(q) })), 'v');
    return { label: bucket.label, from: bucket.from, to: bucket.to, pedidos, orcamentos };
  });
}

function buildFinanceDashboardSummary(data, query) {
  const todayStr = toDateStr(getTodayLocal());
  const period = query.get('period') || 'month';
  const granularity = query.get('granularity') || 'month';
  const range = getPeriodRange(period, query.get('from'), query.get('to'));

  const entries = (data.finance || []).filter((entry) => !isFinanceEntryCancelled(entry));
  const receitaEntries = entries.filter((entry) => classifyFinanceEntry(entry) === 'receita');
  const despesaEntries = entries.filter((entry) => classifyFinanceEntry(entry) === 'despesa');

  const pendingOrPartial = (entry) => {
    const s = String(entry.status || '').toLowerCase();
    return s === 'pending' || s === 'parcial';
  };
  const isOverdue = (entry) => pendingOrPartial(entry) && financeEntryDueDate(entry) < todayStr;
  const isUpcoming = (entry) => pendingOrPartial(entry) && financeEntryDueDate(entry) >= todayStr;

  const contasAPagar = {
    total: sumFinanceAmount(despesaEntries.filter(pendingOrPartial)),
    vencidas: sumFinanceAmount(despesaEntries.filter(isOverdue)),
    aVencer: sumFinanceAmount(despesaEntries.filter(isUpcoming)),
    pagas: sumFinanceAmount(despesaEntries.filter(isFinanceEntryRealized))
  };

  const contasAReceber = {
    total: sumFinanceAmount(receitaEntries.filter(pendingOrPartial)),
    vencidas: sumFinanceAmount(receitaEntries.filter(isOverdue)),
    aReceber: sumFinanceAmount(receitaEntries.filter(isUpcoming)),
    recebidas: sumFinanceAmount(receitaEntries.filter(isFinanceEntryRealized))
  };

  const periodReceitas = sumFinanceAmount(
    receitaEntries.filter((entry) => isFinanceEntryRealized(entry) && entry.date >= range.from && entry.date <= range.to)
  );
  const periodDespesas = sumFinanceAmount(
    despesaEntries.filter((entry) => isFinanceEntryRealized(entry) && entry.date >= range.from && entry.date <= range.to)
  );

  const previousRange = getPreviousPeriodRange(range);
  const previousReceitas = sumFinanceAmount(
    receitaEntries.filter((entry) => isFinanceEntryRealized(entry) && entry.date >= previousRange.from && entry.date <= previousRange.to)
  );
  const previousDespesas = sumFinanceAmount(
    despesaEntries.filter((entry) => isFinanceEntryRealized(entry) && entry.date >= previousRange.from && entry.date <= previousRange.to)
  );
  const resultadoAnterior = previousReceitas - previousDespesas;
  const resultadoDeltaPercent = resultadoAnterior !== 0
    ? ((periodReceitas - periodDespesas - resultadoAnterior) / Math.abs(resultadoAnterior)) * 100
    : null;

  const saldoAtual = sumFinanceAmount(receitaEntries.filter(isFinanceEntryRealized)) - sumFinanceAmount(despesaEntries.filter(isFinanceEntryRealized));
  const previsaoFinanceira = saldoAtual + contasAReceber.aReceber - contasAPagar.aVencer;

  const dueBuckets = { hoje: [], amanha: [], proximos7: [], proximos30: [] };
  const amanhaDate = new Date(getTodayLocal());
  amanhaDate.setDate(amanhaDate.getDate() + 1);
  const amanhaStr = toDateStr(amanhaDate);
  // -6/-29 (não -7/-30): a janela já inclui hoje, então "próximos 7 dias" cobre exatamente 7 datas corridas (hoje..hoje+6)
  const sevenDaysStr = toDateStr(new Date(getTodayLocal().getFullYear(), getTodayLocal().getMonth(), getTodayLocal().getDate() + 6));
  const thirtyDaysStr = toDateStr(new Date(getTodayLocal().getFullYear(), getTodayLocal().getMonth(), getTodayLocal().getDate() + 29));

  entries
    .filter(pendingOrPartial)
    .forEach((entry) => {
      const dueDate = financeEntryDueDate(entry);
      if (dueDate < todayStr) return; // já contabilizado em "vencidas"
      const item = {
        id: entry.id,
        description: entry.description,
        type: classifyFinanceEntry(entry),
        clienteFornecedor: resolveFinanceCounterparty(entry, data),
        dueDate,
        amount: Number(entry.amount || 0),
        status: financeEntryStatusLabel(entry)
      };
      if (dueDate === todayStr) dueBuckets.hoje.push(item);
      else if (dueDate === amanhaStr) dueBuckets.amanha.push(item);
      if (dueDate <= sevenDaysStr) dueBuckets.proximos7.push(item);
      if (dueDate <= thirtyDaysStr) dueBuckets.proximos30.push(item);
    });

  const ultimosLancamentos = entries
    .slice()
    .sort((a, b) => (b.date === a.date ? String(b.id).localeCompare(String(a.id)) : String(b.date).localeCompare(String(a.date))))
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      date: entry.date,
      description: entry.description,
      type: classifyFinanceEntry(entry),
      clienteFornecedor: resolveFinanceCounterparty(entry, data),
      dueDate: financeEntryDueDate(entry),
      amount: Number(entry.amount || 0),
      status: financeEntryStatusLabel(entry)
    }));

  const nfes = data.nfes || [];
  const nfeStats = nfes.reduce((acc, nfe) => {
    const status = String(nfe.status || 'emitida').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const bankTransactions = data.bankTransactions || [];
  const movimentacoesBancarias = {
    available: true,
    total: bankTransactions.length,
    naoConciliado: bankTransactions.filter((tx) => tx.status === 'nao_conciliado').length,
    conciliado: bankTransactions.filter((tx) => tx.status === 'conciliado').length
  };

  return {
    period,
    range,
    granularity,
    saldoAtual,
    contasAPagar,
    contasAReceber,
    receitas: periodReceitas,
    despesas: periodDespesas,
    resultado: periodReceitas - periodDespesas,
    resultadoDeltaPercent,
    previsaoFinanceira,
    chartSeries: buildFinanceChartSeries(entries, granularity),
    proximosVencimentos: dueBuckets,
    ultimosLancamentos,
    totalNfesEmitidas: nfes.length,
    nfeStats,
    movimentacoesBancarias
  };
}

// Tipos servidos. Um mapa só: antes havia este e um segundo, quase igual, no
// handler de /assets — e só o de lá conhecia imagem.
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Comprimir PNG/JPG/ICO/WOFF gasta CPU para render alguns bytes: já são
// formatos comprimidos. Só texto entra.
const EXTENSOES_COMPRIMIVEIS = new Set(['.html', '.css', '.js', '.json', '.svg']);

function serveStatic(res, filePath, req) {
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }

    // ETag do conteúdo, não do mtime: `git checkout` mexe na data sem mudar o
    // arquivo, e um deploy que só recopia tudo invalidaria o cache inteiro à toa.
    const etag = `"${crypto.createHash('sha1').update(content).digest('base64url')}"`;

    // `no-cache` NÃO é "não guarde" — é "guarde, mas confirme antes de usar".
    // Aqui estava `no-store`, que proibia guardar: cada abertura do sistema
    // rebaixava ~1,2 MB em 107 arquivos. Com revalidação, o navegador continua
    // nunca servindo versão velha (a razão do no-store original), só que o
    // arquivo inalterado custa um 304 sem corpo em vez do download inteiro.
    const headersBase = {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag
    };

    if (req && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headersBase);
      res.end();
      return;
    }

    const aceita = String((req && req.headers['accept-encoding']) || '');
    if (EXTENSOES_COMPRIMIVEIS.has(ext) && /\bgzip\b/.test(aceita)) {
      zlib.gzip(content, (erroGzip, comprimido) => {
        if (erroGzip) {
          // Falhar em comprimir não é motivo para não entregar o arquivo.
          res.writeHead(200, { ...headersBase, 'Content-Length': content.length });
          res.end(content);
          return;
        }
        res.writeHead(200, {
          ...headersBase,
          'Content-Encoding': 'gzip',
          // Sem Vary, um proxy compartilhado poderia entregar o corpo gzipado
          // para um cliente que não pediu gzip.
          Vary: 'Accept-Encoding',
          'Content-Length': comprimido.length
        });
        res.end(comprimido);
      });
      return;
    }

    res.writeHead(200, { ...headersBase, 'Content-Length': content.length });
    res.end(content);
  });
}

/**
 * A OBSERVAÇÃO DO FISCO CABE NO CAMPO DO ITEM? (fase BL)
 *
 * Este texto vai para infAdProd, que a SEFAZ limita a 500 caracteres — dez
 * vezes menos que o rodé da nota. Não havia limite em lugar nenhum: nem na
 * textarea, nem aqui.
 *
 * A recusa é NA GRAVAÇÃO DA REGRA, e não só na emissão. Barrar só na emissão
 * chega tarde: a regra já está salva, e ela vale para TODO produto que casar
 * com ela. Uma linha errada aqui derruba a emissão de notas que nada têm a ver
 * com quem digitou o texto — e a mensagem de rejeição chega na tela de quem
 * está vendendo, no fim do dia, sem pista da origem.
 *
 * A conferiência na emissão continua existindo, para as regras gravadas antes
 * desta guarda.
 */
function conferirObservacaoDoFisco(body) {
  const texto = String(body.observacaoFisco || '');
  if (!textoNfe.excedeLimiteDoItem(texto)) return '';
  return `A observação do fisco tem ${texto.length} caracteres. Ela vai no campo de `
    + `informações adicionais do ITEM, que a SEFAZ limita a ${textoNfe.LIMITE_INFADPROD} — `
    + 'e toda nota que casar com esta regra seria rejeitada.';
}

function mapFocusStatusToNfeStatus(focusStatus) {
  const map = {
    autorizado: 'AUTORIZADO',
    processando_autorizacao: 'PROCESSANDO',
    erro_autorizacao: 'ERRO',
    cancelado: 'CANCELADO',
    denegado: 'DENEGADO',
    inutilizado: 'INUTILIZADO'
  };
  return map[focusStatus] || 'ERRO';
}

// Ordem importa: sufixos específicos (/cancelar, /cce, /eventos...) checados
// antes do prefixo genérico "/api/fiscal/nfe/" + GET, mesma ordem em que as
// próprias rotas abaixo fazem o match.
// Quantidade produzida de uma ordem = SOMA dos apontamentos dela.
//
// Recalcula do zero em vez de somar/subtrair o que mudou. Incremento erra
// sozinho: editar um apontamento de 10 para 8, ou excluir um, deixaria o total
// permanentemente inflado, e nada na tela denunciaria — "Produzido" e "Falta"
// continuariam parecendo números certos. Recalcular é mais caro e se conserta
// sozinho na gravação seguinte.
//
// Antes disto, `quantity_done` simplesmente nunca era escrito por ninguém: a
// tela prometia "o produzido é atualizado pelos apontamentos" e o campo ficava
// em zero para sempre.
async function recalcularProduzidoDaOrdem(ordemId) {
  if (!ordemId) return;
  const apontamentos = await modulosDb.listar('pcp/entries');
  const total = apontamentos
    .filter((a) => a.orderId === ordemId)
    .reduce((soma, a) => soma + Number(a.quantity || 0), 0);
  // 4 casas: é a precisão da coluna (numeric(14,4)). Sem o arredondamento, a
  // soma de frações vira dízima e o Postgres arredonda por conta própria.
  await modulosDb.atualizar('pcp/orders', ordemId, { quantityDone: Math.round(total * 10000) / 10000 });
}

// Apontar produção mexe no estoque dos DOIS lados: entra produto acabado e
// saem os componentes da ficha técnica (pcp_bom), já com a perda do processo.
//
// `delta` é a variação da quantidade apontada — positivo produz, negativo
// estorna. Editar um apontamento de 10 para 8 chama com -2; excluir chama com
// o negativo da quantidade inteira. É por isso que a função é uma só: o
// estorno é a mesma conta com o sinal trocado, e duas funções separadas
// divergiriam na primeira correção feita só numa delas.
//
// A ficha técnica usada é a ATUAL, não a da data do apontamento. O sistema não
// versiona BOM; estornar um apontamento antigo depois de alterar a ficha
// devolve pelas quantidades novas. Fica registrado aqui porque é uma limitação
// real, não um descuido.
async function aplicarConsumoDeProducao(data, { ordem, delta, user }) {
  const quantidade = Number(delta || 0);
  if (!quantidade || !ordem || !ordem.productId) return { consumidos: [], produzido: 0 };

  const ficha = (await modulosDb.listar('pcp/bom')).filter((linha) => linha.productId === ordem.productId);

  // Monta o efeito de cada produto antes de gravar qualquer coisa: se faltar
  // componente, nada é aplicado e a ordem não fica pela metade.
  const efeitos = new Map();
  const somar = (produtoId, valor) => {
    efeitos.set(produtoId, (efeitos.get(produtoId) || 0) + valor);
  };
  somar(ordem.productId, quantidade);
  for (const linha of ficha) {
    if (!linha.componentId) continue;
    const porUnidade = Number(linha.quantity || 0) * (1 + Number(linha.lossPercent || 0) / 100);
    somar(linha.componentId, -quantidade * porUnidade);
  }

  const produtos = new Map();
  for (const produtoId of efeitos.keys()) {
    produtos.set(produtoId, await db.getProductById(produtoId));
  }

  // ---- classe (cor): o PCP ainda não sabe de qual cor produz (fase BP) ----
  //
  // A ficha técnica não tem coluna de cor e a ordem também não. O movimento
  // saía com classValueId vazio, e o saldo por cor deixava de acompanhar o
  // total: o Estoque mostrava 100 Azuis DEPOIS de a produção ter consumido 10,
  // a venda de 100 Azuis era aceita e o total do produto ia a -10.
  //
  // A recusa é a mesma resposta que a entrada por NF-e já dá para o mesmo
  // problema — o XML também não traz cor. Produzir com cor exige a ficha e a
  // ordem saberem qual, e isso é assunto de outra fase; até lá, recusar é o
  // único jeito honesto de não corromper o saldo em silêncio.
  for (const produtoId of efeitos.keys()) {
    const produto = produtos.get(produtoId);
    if (!produto) continue;
    let classes = [];
    try {
      classes = await classesDb.classesDoProduto(produtoId);
    } catch (erroClasses) {
      classes = [];
    }
    const obrigatoria = (classes || []).find((c) => c.required);
    if (obrigatoria) {
      const err = new Error(
        `"${produto.name}" é controlado por ${obrigatoria.name}, e a ficha técnica da ordem `
        + `não diz qual ${String(obrigatoria.name).toLowerCase()}. Apontar assim faria o saldo por `
        + `${String(obrigatoria.name).toLowerCase()} parar de fechar com o total. `
        + 'Lance a produção pela tela de Movimentações, onde dá para escolher.'
      );
      err.status = 400;
      throw err;
    }
  }

  for (const [produtoId, variacao] of efeitos) {
    const produto = produtos.get(produtoId);
    if (!produto) continue;
    const disponivel = Number(produto.stockQuantity || 0);
    const projetado = disponivel + variacao;
    if (projetado < 0) {
      // A MENSAGEM DEPENDE DO SENTIDO. Estornar (excluir ou reduzir um
      // apontamento) também cai aqui, e mandava "dê entrada no componente
      // antes de apontar" para quem estava EXCLUINDO um apontamento cujo
      // produto acabado já foi vendido. Nome errado, ação errada, saída errada.
      const desfazendo = quantidade < 0;
      const ehProdutoFinal = produtoId === ordem.productId;
      const err = new Error(desfazendo
        ? `Não dá para desfazer esta produção: "${produto.name}" tem ${disponivel} em estoque e `
          + `seria preciso retirar ${Math.abs(Math.round(variacao * 10000) / 10000)}. `
          + 'O que foi produzido já saiu do estoque — estorne a saída antes de desfazer o apontamento.'
        : `Estoque insuficiente de ${ehProdutoFinal ? 'produto' : 'componente'} "${produto.name}" `
          + `para apontar esta produção: disponível ${disponivel}, `
          + `necessário ${Math.abs(Math.round(variacao * 10000) / 10000)}. `
          + 'Dê entrada no componente antes de apontar.');
      err.status = 400;
      throw err;
    }

    // ---- e o DEPÓSITO para onde o movimento vai (fase BP) ----------------
    //
    // A ordem de produção não tem depósito, então o movimento nasce no depósito
    // PADRÃO do produto. A suficiência, porém, era conferida contra o total do
    // produto: com 10 unidades no Galpão B e nenhuma no padrão, o consumo
    // passava e o depósito padrão ficava com saldo NEGATIVO enquanto o B
    // seguia cheio. Daí em diante qualquer saída daquele depósito era recusada.
    //
    // SÓ quando há depósito padrão: sem ele o movimento cai no saldo não
    // alocado, e cobrar um depósito que não existe travaria quem nunca usou o
    // campo.
    const depositoDoMovimento = stockCore.productMeta(data, produtoId).defaultDepositId || '';
    if (depositoDoMovimento && variacao < 0) {
      const noDeposito = stockCore.depositBalance(data, produtoId, depositoDoMovimento);
      if (noDeposito + variacao < 0) {
        const nomeDoDeposito = resolveById(data.deposits, depositoDoMovimento) || depositoDoMovimento;
        const err = new Error(
          `"${produto.name}" tem ${noDeposito} em ${nomeDoDeposito}, que é o depósito padrão dele, `
          + `e a produção precisa de ${Math.abs(Math.round(variacao * 10000) / 10000)}. `
          + 'Transfira para o depósito padrão ou troque o padrão no cadastro do produto.'
        );
        err.status = 400;
        throw err;
      }
    }
  }

  const consumidos = [];
  for (const [produtoId, variacao] of efeitos) {
    const produto = produtos.get(produtoId);
    if (!produto || !variacao) continue;
    const arredondado = Math.round(variacao * 10000) / 10000;
    // Fase AP: o total do produto e' somado pelo descarregamento, na mesma
    // transacao do razao. Ver a nota em transitionOrderStockEffect.
    registrarMovimentoEstoque(data, {
      productId: produtoId,
      productName: produto.name,
      type: arredondado > 0 ? 'entrada' : 'saida',
      quantityDelta: arredondado,
      referenceType: 'producao',
      referenceId: ordem.id,
      note: produtoId === ordem.productId
        ? `Produção da OP ${ordem.code || ordem.id.slice(-6)}`
        : `Consumo na OP ${ordem.code || ordem.id.slice(-6)}`,
      user
    });
    if (produtoId !== ordem.productId) consumidos.push({ productId: produtoId, name: produto.name, quantidade: -arredondado });
  }

  await descarregarMovimentosPendentes(data);
  return { consumidos, produzido: quantidade };
}

// Casca de gravação do efeito acima: carrega a ordem, aplica e persiste o
// ledger local (data.stockMovements). Sai calada quando não há o que fazer —
// delta zero, ordem inexistente — para o chamador não precisar se defender.
/**
 * A ordem ainda aceita apontamento? Devolve a recusa, ou vazio quando aceita.
 *
 * Ordem CANCELADA continuava aparecendo no select de Novo Apontamento e
 * aceitando produção: os insumos baixavam e a ordem passava a exibir
 * "Produzido: 50" com a etiqueta Cancelada ao lado. Concluir também é desfecho:
 * apontar depois refaz o total e desmente o fechamento.
 *
 * Ordem inexistente NÃO é recusada aqui — quem trata disso é o próprio
 * mexerNoEstoqueDaProducao, que sai calado, e o banco, pela chave estrangeira.
 */
async function ordemAceitaApontamento(ordemId) {
  if (!ordemId) return '';
  const ordem = await modulosDb.obter('pcp/orders', ordemId);
  if (!ordem) return '';
  const status = String(ordem.status || '').toLowerCase();
  if (status === 'cancelada') {
    return `A ordem ${ordem.code || ordemId} está cancelada e não aceita apontamento. `
      + 'Reabra a ordem antes de apontar produção nela.';
  }
  if (status === 'concluida') {
    return `A ordem ${ordem.code || ordemId} já está concluída. `
      + 'Reabra a ordem antes de apontar mais produção nela.';
  }
  return '';
}

async function mexerNoEstoqueDaProducao(ordemId, delta, user) {
  if (!ordemId || !Number(delta)) return null;
  const ordem = await modulosDb.obter('pcp/orders', ordemId);
  if (!ordem) return null;
  const data = loadData();
  // O razão e os depósitos: a projeção por depósito da fase BP soma
  // data.stockMovements, e o nome do depósito na mensagem sai de data.deposits.
  await Promise.all([sincronizarRazao(data), syncCadastroData(data)]);
  const efeito = await aplicarConsumoDeProducao(data, { ordem, delta: Number(delta), user });
  saveData(data);
  return efeito;
}

// Odômetro do veículo = a MAIOR leitura já registrada.
//
// A migração da Fase R dizia que "os abastecimentos e as manutenções escrevem
// aqui", e nenhuma linha escrevia: o odômetro ficava no número digitado no
// cadastro para sempre, e a coluna "Odômetro" da lista de Veículos mentia
// desde o primeiro abastecimento.
//
// AVANÇA, NÃO RECALCULA — e a diferença é proposital. O produzido de uma ordem
// de produção é uma SOMA (recalcular do zero é o certo, ver
// recalcularProduzidoDaOrdem). Odômetro não é soma: é uma leitura, e leitura de
// odômetro não anda para trás. Por isso:
//   - leitura maior que a atual: o veículo avança;
//   - leitura menor: ignorada, sem recusar o registro. Um abastecimento é fato
//     passado; recusá-lo por causa de um número digitado errado apagaria a
//     despesa junto. A tela marca a leitura suspeita, e alguém corrige.
//   - excluir um abastecimento NÃO faz o odômetro voltar: o quilômetro foi
//     rodado de verdade.
async function avancarOdometroDoVeiculo(vehicleId, leitura) {
  const km = Number(leitura || 0);
  if (!vehicleId || !(km > 0)) return;
  const veiculo = await modulosDb.obter('fleet/vehicles', vehicleId);
  if (!veiculo || km <= Number(veiculo.odometer || 0)) return;
  await modulosDb.atualizar('fleet/vehicles', vehicleId, { odometer: km });
}

// Contrato -> contas a receber/pagar, pelo ciclo de cobrança.
//
// O contrato guarda valor, ciclo e vigência; até aqui nada transformava isso em
// dinheiro previsto. O resultado era um Financeiro que não enxergava a receita
// recorrente já contratada — o número que mais importa para o fluxo de caixa,
// justamente porque é o mais previsível.
//
// DECISÕES QUE ESTA FUNÇÃO TOMA
//
// 1. Uma parcela por período, com vencimento no dia do início do contrato
//    dentro de cada mês. Data 31 em mês de 30 cai no último dia do mês, e não
//    escorrega para o dia 1º do mês seguinte (é o que `new Date(ano, mes+1, 0)`
//    resolve) — vencimento pulando de mês bagunça a competência.
//
// 2. Cliente gera RECEITA, fornecedor gera DESPESA. É o que `partyKind` já
//    dizia e que nada lia.
//
// 3. Contrato sem data de término não gera parcela infinita: para no horizonte
//    pedido (12 períodos por padrão). Contrato de prazo indeterminado é comum,
//    e gerar até o fim dos tempos encheria o Financeiro.
//
// 4. Não duplica: parcela que já existe para aquele vencimento é pulada. Assim
//    rodar de novo para estender o horizonte só acrescenta o que falta, em vez
//    de dobrar tudo o que já estava lá.
const MESES_POR_CICLO = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };

function vencimentoDoPeriodo(inicio, mesesAFrente) {
  const base = new Date(`${String(inicio).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const diaDesejado = base.getDate();
  const alvo = new Date(base.getFullYear(), base.getMonth() + mesesAFrente, 1);
  // Dia 0 do mês seguinte = último dia deste mês.
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(diaDesejado, ultimoDia));
  const iso = new Date(alvo.getTime() - alvo.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 10);
}

function parcelasDoContrato(contrato, { periodos = 12 } = {}) {
  const valor = Number(contrato.value || 0);
  if (!(valor > 0) || !contrato.startDate) return [];

  const ciclo = String(contrato.billingCycle || 'mensal');
  const rotulo = contrato.title || `Contrato ${contrato.code || contrato.id}`;

  if (ciclo === 'unico') {
    return [{ dueDate: String(contrato.startDate).slice(0, 10), amount: valor, description: `${rotulo} — parcela única` }];
  }

  const passo = MESES_POR_CICLO[ciclo] || 1;
  const fim = contrato.endDate ? String(contrato.endDate).slice(0, 10) : null;
  const linhas = [];
  for (let i = 0; i < periodos * 12; i += 1) {
    const vencimento = vencimentoDoPeriodo(contrato.startDate, i * passo);
    if (!vencimento) break;
    if (fim && vencimento > fim) break;
    linhas.push({
      dueDate: vencimento,
      amount: valor,
      description: `${rotulo} — ${vencimento.slice(0, 7)}`
    });
    // Sem data de término, o horizonte é o que segura a geração.
    if (!fim && linhas.length >= periodos) break;
  }
  return linhas;
}

function resolveFiscalPermission(pathname, method) {
  // Tabelas de referência: código oficial de CFOP/CST não é dado sensível da
  // empresa, e quem emite nota precisa consultá-las.
  if (pathname === '/api/fiscal/tabelas') return 'visualizar';

  if (pathname === '/api/fiscal/empresas') return method === 'GET' ? 'visualizar' : 'configurar';
  if (pathname.startsWith('/api/fiscal/empresas/')) return 'configurar';

  if (pathname === '/api/fiscal/estabelecimentos') return method === 'GET' ? 'visualizar' : 'configurar';
  if (pathname.endsWith('/focus-status')) return 'visualizar';
  if (pathname.endsWith('/webhook')) return 'configurar';
  if (pathname.startsWith('/api/fiscal/estabelecimentos/')) return 'configurar';

  if (pathname === '/api/fiscal/certificados') return method === 'GET' ? 'visualizar' : 'certificado';
  if (pathname.startsWith('/api/fiscal/certificados/')) return 'certificado';

  if (pathname === '/api/fiscal/regras') return method === 'GET' ? 'visualizar' : 'regras';
  // Simular é leitura: responde "qual regra se aplicaria", sem gravar nada.
  // Explícito antes do startsWith abaixo, senão cairia em 'regras' e quem só
  // consulta não conseguiria descobrir por que uma emissão foi recusada.
  if (pathname === '/api/fiscal/regras/simular') return 'visualizar';
  if (pathname.startsWith('/api/fiscal/regras/')) return 'regras';

  // DISTRIBUIÇÃO DE DF-e (fase AR). Antes de /api/fiscal/nfe porque manifestar
  // termina em /manifestar, e o endsWith('/eventos') logo abaixo não o pega —
  // mas a ordem explícita é o que impede que um sufixo novo mude a regra desta
  // rota sem ninguém perceber.
  if (pathname.endsWith('/manifestar')) return 'manifestar';
  if (pathname === '/api/fiscal/dfe' || pathname === '/api/fiscal/dfe/buscar') return 'documentos_recebidos';
  if (pathname.startsWith('/api/fiscal/dfe/')) return 'documentos_recebidos';

  if (pathname === '/api/fiscal/nfe') return 'visualizar';
  if (pathname === '/api/fiscal/nfe/emitir') return 'emitir';
  if (pathname.endsWith('/cancelar')) return 'cancelar';
  if (pathname.endsWith('/cce')) return 'cce';
  // Trilha de eventos do estabelecimento (CCE, cancelamento, inutilização).
  // Explícito antes do endsWith('/eventos') logo abaixo: os dois dão no mesmo
  // resultado hoje, mas depender do sufixo deixaria a regra desta rota
  // dependendo do nome escolhido para outra.
  if (pathname === '/api/fiscal/eventos') return 'visualizar';
  if (pathname.endsWith('/eventos')) return 'visualizar';
  if (pathname === '/api/fiscal/inutilizar') return 'inutilizar';
  if (pathname.endsWith('/xml')) return 'xml';
  if (pathname.endsWith('/danfe')) return 'danfe';
  if (pathname.startsWith('/api/fiscal/nfe/')) return 'visualizar';

  return 'configurar';
}

// Emissão real de NF-e: resolve a tributação de cada item via regra_fiscal,
// monta o payload da Focus NFe, grava um rascunho (auditoria mesmo se a
// chamada falhar) e só então transmite.
// Chave de comparação pra idempotência: mesmo destinatário + mesmos itens
// (não usa a referência, que é sempre nova por design).
function buildNfeConteudoKey(payloadFocus) {
  const documento = payloadFocus.cnpj_destinatario || payloadFocus.cpf_destinatario || '';
  const itensKey = (payloadFocus.items || [])
    .map((item) => `${item.codigo_produto}|${item.descricao}|${item.quantidade_comercial}|${item.valor_unitario_comercial}`)
    .join(';');
  return `${documento}::${itensKey}`;
}

// Evita criar uma NF-e duplicada quando o usuário clica duas vezes (ou o
// frontend reenvia por timeout): se já existe uma NF-e recente (últimos 2
// minutos) com o mesmo destinatário+itens ainda em PROCESSANDO ou já
// AUTORIZADA pra este estabelecimento, devolve ela em vez de emitir de novo.
const NFE_IDEMPOTENCIA_JANELA_MS = 2 * 60 * 1000;

async function encontrarNfeIdempotente(estabelecimentoId, payloadFocus) {
  const chave = buildNfeConteudoKey(payloadFocus);
  const recentes = await fiscalDb.getNfeRecords(estabelecimentoId);
  const agora = Date.now();
  return recentes.find((nfeExistente) => {
    if (!['PROCESSANDO', 'AUTORIZADO'].includes(nfeExistente.status)) return false;
    const criadoEmMs = new Date(nfeExistente.criadoEm).getTime();
    if (!Number.isFinite(criadoEmMs) || agora - criadoEmMs > NFE_IDEMPOTENCIA_JANELA_MS) return false;
    if (!nfeExistente.payloadEnviado) return false;
    return buildNfeConteudoKey(nfeExistente.payloadEnviado) === chave;
  });
}

// Condição de pagamento da NF-e avulsa, saneada. Sem isto, "60 parcelas de
// R$ 0,01" ou intervalo zero entrariam do jeito que viessem.
function condicaoPagamentoDoBody(body) {
  const parcelado = body.paymentType === 'parcelado';
  return {
    tipo: parcelado ? 'parcelado' : 'avista',
    parcelas: parcelado ? Math.min(60, Math.max(2, Math.round(Number(body.installmentsCount || 2)))) : 1,
    intervaloDias: Math.max(1, Number(body.installmentIntervalDays || 30))
  };
}

/**
 * O pedido de origem da nota passa a "Pedido Faturado" (fase AV).
 *
 * FALHAR AQUI NÃO DESFAZ A NOTA, e não pode mesmo: a NF-e está autorizada na
 * SEFAZ, é fato consumado e não se desfaz por erro nosso. O pedido fica como
 * estava, com o vínculo gravado — e o painel de Atenção o mostra, porque um
 * pedido com nota e sem faturar é exatamente o tipo de meia-operação que este
 * sistema não deve esconder.
 *
 * Só avança quem PODE avançar: um pedido já faturado, cancelado ou que seja
 * orçamento não é tocado. Quem responde isso é o catálogo de status, não um
 * `if` escrito aqui.
 */
/**
 * A NF-e que SUSTENTA o faturamento deste pedido, ou null.
 *
 * "Sustenta" e' um estado, nao a existencia da linha: uma nota CANCELADA ficou
 * gravada em orders.nfe_id e continua la para sempre, porque documento fiscal
 * nao se apaga. Perguntar so' "tem nfeId?" respondia sim para uma nota que a
 * SEFAZ ja' nao reconhece.
 *
 * PROCESSANDO conta junto com AUTORIZADO de proposito: a nota esta em voo e
 * pode virar autorizada a qualquer momento, inclusive pelo webhook. Tratar como
 * "nao sustenta" abriria a janela para desfaturar um pedido segundos antes de a
 * autorizacao chegar.
 *
 * Olha TODAS as notas do pedido, e nao so' orders.nfe_id: o pedido pode ter uma
 * nota cancelada e outra emitida depois, e o campo guarda uma so'.
 */
async function notaQueSustentaOFaturamento(pedido) {
  const VIVOS = new Set(['AUTORIZADO', 'PROCESSANDO']);
  const candidatas = [];
  try {
    const doPedido = await fiscalDb.getNfesPorPedido(pedido.id);
    if (Array.isArray(doPedido)) candidatas.push(...doPedido);
  } catch (erro) {
    // Tabela fiscal indisponivel nao pode travar a edicao de pedido: cai para
    // o vinculo direto, que e' o que existia antes de haver consulta por pedido.
    console.error('Falha ao consultar as NF-e do pedido', pedido.id, erro.message);
  }
  if (!candidatas.length && pedido.nfeId) {
    const nota = await fiscalDb.getNfeById(pedido.nfeId).catch(() => null);
    if (nota) candidatas.push(nota);
  }
  return candidatas.find((n) => VIVOS.has(String(n.status || '').toUpperCase())) || null;
}

/**
 * CANCELAR A NOTA DESFAZ O FATURAMENTO QUE ELA CAUSOU (fase BF).
 *
 * Ate aqui cancelarNfeFiscal falava com a SEFAZ, gravava o evento e a
 * auditoria — e nao tocava no pedido. A nota ficava cancelada e o pedido seguia
 * "Pedido Faturado": mercadoria baixada que voltou para a prateleira, e conta a
 * receber cobrando por uma nota que nao existe mais.
 *
 * O destino e' 'pedido-nao-faturado', e nao 'pedido-cancelado': cancelar uma
 * nota quase nunca quer dizer cancelar a venda. Cancela-se por erro de dados,
 * para reemitir — e o pedido precisa ficar pronto para a nota nova.
 *
 * Quem confere se NENHUMA outra nota ainda sustenta o faturamento e' a guarda
 * em aplicarEfeitosDeStatus, por onde esta transicao passa. Se sustentar, a
 * mudanca e' recusada e a recusa vira registro de auditoria aqui embaixo — que
 * e' a resposta certa: duas notas para um pedido e caso de gente olhar.
 */
async function desfaturarPedidoDaNota(nfe, user) {
  const pedidoId = nfe && nfe.orderId;
  if (!pedidoId) return;
  if (String(nfe.status || '').toUpperCase() !== 'CANCELADO') return;
  // Mesmo substituto de faturarPedidoDaNota, e pelo mesmo motivo: o
  // cancelamento tambem pode chegar sem sessao. Ver a nota la.
  const quemDesfatura = user && user.id ? user : { id: '', name: 'Cancelamento da NF-e' };
  try {
    const dataVendas = loadData();
    // syncFinanceData também: desfaturar CANCELA as parcelas em aberto, e
    // transitionOrderFinanceEffect as procura em `data.finance`. Sem o sync a
    // lista chega vazia, nenhuma parcela é encontrada e o pedido volta a não
    // faturado com a conta a receber cobrando por uma nota cancelada.
    // Provado: o estoque voltava (18 -> 20) e o lançamento seguia 'pending'.
    // Quem apontou foi scripts/test-sync-obrigatorio.js, pelo nome da função.
    await Promise.all([syncSalesData(dataVendas), syncCadastroData(dataVendas), syncFinanceData(dataVendas)]);
    const pedido = (dataVendas.orders || []).find((o) => o.id === pedidoId);
    if (!pedido) return;
    // So' desfaz o que a nota fez. Pedido que nunca chegou a faturado, ou que
    // ja' foi cancelado por outro caminho, nao e' assunto deste cancelamento.
    if (salesStatus.normalizar(pedido.status) !== 'pedido-faturado') return;
    await mudarStatusSalesRecord({ id: pedido.id, code: pedido.code }, 'pedido-nao-faturado', dataVendas, quemDesfatura);
  } catch (erro) {
    // A EXCECAO NAO SOBE. A nota ja' esta cancelada na SEFAZ; derrubar a
    // resposta por causa do pedido deixaria o sistema achando que o
    // cancelamento falhou, e a proxima tentativa bateria numa nota que a SEFAZ
    // ja' nao aceita cancelar de novo.
    console.error('NF-e cancelada, mas nao consegui desfaturar o pedido', pedidoId, erro.message);
    await registrarAuditoria({
      action: 'falhaAoDesfaturarPedidoDaNota',
      targetId: pedidoId,
      targetUsername: String(nfe.numero || nfe.referencia || nfe.id || ''),
      byId: quemDesfatura.id,
      byName: quemDesfatura.name,
      details: { erro: erro.message, nfeId: nfe.id || '' }
    });
  }
}

async function faturarPedidoDaNota(nfe, pedidoId, user) {
  if (!pedidoId) return;
  if (String(nfe && nfe.status || '').toUpperCase() !== 'AUTORIZADO') return;
  // QUEM FATURA QUANDO NINGUÉM ESTÁ LOGADO (fase BE).
  //
  // A autorização pode chegar pelo WEBHOOK da Focus, e aí não existe sessão:
  // quem chamou foi a Focus, não uma pessoa. mudarStatusSalesRecord lê
  // `user.name` e `user.id` direto, então sem isto a chamada estourava em
  // TypeError e morria no catch abaixo, calada: nota autorizada, pedido nunca
  // faturado, estoque parado e nenhuma conta a receber.
  //
  // O nome vai para a auditoria e para `updatedByName` do pedido, então diz o
  // que de fato aconteceu em vez de fingir um usuário.
  //
  // O id fica VAZIO, e não com um 'sistema' inventado: financial_entries.
  // created_by tem chave estrangeira para users, e um id que não existe lá
  // derruba a criação da conta a receber. Provado: com um id fictício o pedido
  // ficava faturado, o estoque baixava e o recebível não nascia — metade
  // aplicada, que é pior do que nada. Vazio vira NULL na coluna e passa.
  const quemFatura = user && user.id ? user : { id: '', name: 'Autorização da NF-e' };
  try {
    const dataVendas = loadData();
    // syncCadastroData: faturar baixa estoque, e a baixa resolve nome de
    // depósito por productBalances. syncFinanceData: as parcelas nascem em
    // `data.finance`, e o ramo da dispensa mais abaixo também as lê. Estava
    // só dentro daquele ramo — uma onda só aqui cobre os dois.
    await Promise.all([
      syncSalesData(dataVendas), syncCadastroData(dataVendas), syncFinanceData(dataVendas)
    ]);
    const pedido = (dataVendas.orders || []).find((o) => o.id === pedidoId);
    if (!pedido) return;
    if (!salesStatus.podeTransicionar(pedido.status, 'pedido-faturado')) {
      // JÁ FATURADO ANTES DA NOTA — é o caso da dispensa (fase AV): SEFAZ fora,
      // o pedido faturou com o motivo registrado, a nota saiu no dia seguinte.
      // As contas a receber existem e dizem "Sem NF-e (dispensada)", que a
      // partir de agora é mentira. Nada de novo a criar; só a descrição a
      // completar. Ver anotarNotaNoFinanceiroDoPedido.
      await anotarNotaNoFinanceiroDoPedido(dataVendas, pedido, nfe.numero);
      return;
    }
    await mudarStatusSalesRecord({ id: pedido.id, code: pedido.code }, 'pedido-faturado', dataVendas, quemFatura);
  } catch (erro) {
    // A EXCEÇÃO NÃO SOBE, MAS TAMBÉM NÃO SOME.
    //
    // Não sobe porque a nota já existe para a SEFAZ: derrubar a autorização
    // por causa do faturamento deixaria o sistema em desacordo com o Fisco,
    // que é pior. Mas um console.error num servidor é o mesmo que nada — a
    // nota fica autorizada, o pedido não fatura e ninguém descobre até o
    // cliente não receber a cobrança.
    console.error('NF-e autorizada, mas nao consegui faturar o pedido', pedidoId, erro.message);
    await registrarAuditoria({
      action: 'falhaAoFaturarPedidoDaNota',
      targetId: pedidoId,
      targetUsername: String(nfe.numero || nfe.referencia || nfe.id || ''),
      byId: quemFatura.id,
      byName: quemFatura.name,
      details: { erro: erro.message, nfeId: nfe.id || '', status: nfe.status || '' }
    });
  }
}

async function emitirNfeFiscal(body, user) {
  const estabelecimento = await fiscalDb.getEstabelecimentoById(body.estabelecimentoId);
  if (!estabelecimento) {
    const err = new Error('Estabelecimento não encontrado.');
    err.status = 404;
    throw err;
  }
  if (!estabelecimento.ativo || !estabelecimento.emiteNfe) {
    const err = new Error('Este estabelecimento não está habilitado para emitir NF-e.');
    err.status = 400;
    throw err;
  }

  const empresa = await fiscalDb.getEmpresaById(estabelecimento.empresaId);
  if (!empresa) {
    const err = new Error('Empresa do estabelecimento não encontrada.');
    err.status = 404;
    throw err;
  }

  const destinatario = body.destinatario || {};
  if (!destinatario.nome || !destinatario.documento || !destinatario.uf) {
    const err = new Error('Preencha os dados do destinatário (nome, documento e UF).');
    err.status = 400;
    throw err;
  }

  const itensBody = Array.isArray(body.itens) ? body.itens : [];
  if (!itensBody.length) {
    const err = new Error('Adicione ao menos um item para emitir a NF-e.');
    err.status = 400;
    throw err;
  }

  const dataEmissao = body.dataEmissao || new Date().toISOString();
  const dataReferencia = dataEmissao.slice(0, 10);
  const tipoOperacao = body.tipoOperacao || 'VENDA';
  const dentroDoEstado = destinatario.uf === estabelecimento.uf;

  // A OPERAÇÃO manda na finalidade, não o que veio da tela: uma complementar
  // com finalidade 1 é recusada pela SEFAZ, e deixar a tela escolher abre
  // espaço para a divergência.
  const opFiscal = operacaoFiscal.operacao(tipoOperacao);
  const referencias = (Array.isArray(body.referencias) ? body.referencias : [])
    .concat(body.nfeOriginalChave ? [{ chaveAcesso: body.nfeOriginalChave }] : []);
  const chaveOriginal = referencias
    .map((r) => String(r?.chaveAcesso || r?.chave || '').replace(/\D/g, ''))
    .find((c) => c.length === 44) || null;

  // UM PEDIDO, UMA NOTA. O caminho MANUAL (POST /api/finance/nfe) já barrava a
  // segunda emissão; o caminho FISCAL, que é o que vai à SEFAZ, não barrava
  // nada — dava para faturar o mesmo pedido duas vezes e ficar com dois
  // documentos na SEFAZ. E documento fiscal não se apaga: sobraria cancelar um
  // deles, com justificativa, dentro do prazo.
  //
  // Nota que terminou em ERRO ou foi CANCELADA não conta: o pedido precisa
  // poder tentar de novo.
  const pedidoDaNota = body.orderId || body.saleId || '';
  if (pedidoDaNota) {
    const jaEmitidas = await fiscalDb.getNfesPorPedido(pedidoDaNota);
    const viva = jaEmitidas.find((n) => !['ERRO', 'CANCELADO', 'DENEGADO'].includes(String(n.status || '').toUpperCase()));
    if (viva) {
      const err = new Error(
        `Este pedido já tem a NF-e ${viva.numero || viva.referencia} (${viva.status}). `
        + 'Cancele a nota existente antes de emitir outra — duas notas para o mesmo pedido são dois documentos na SEFAZ.'
      );
      err.status = 409;
      throw err;
    }
  }

  const itens = [];
  for (let index = 0; index < itensBody.length; index += 1) {
    const bruto = itensBody[index];
    // Quando o item aponta para um produto cadastrado, a classificação fiscal
    // vem do CADASTRO, não do que foi digitado na tela: NCM, CEST e origem são
    // atributos da mercadoria, e deixá-los editáveis na emissão significa que
    // duas notas do mesmo produto podem sair com classificações diferentes.
    // O digitado só preenche o que o cadastro não tem (item avulso, serviço).
    // O item escritural é pedido pelo SKU, não pelo id: a tela não precisa
    // conhecer o id gerado pela migração, e o servidor CONFERE que o que veio
    // é mesmo escritural — sem isso, mandar o SKU de uma mercadoria faria uma
    // venda real sair sem baixar estoque.
    let produto = bruto.produtoId ? await db.getProductById(bruto.produtoId) : null;
    if (!produto && bruto.produtoEscritural) {
      // O ÚNICO lugar que pede escriturais: eles ficam fora da lista de
      // mercadorias por padrão, e é aqui que a nota complementar os encontra.
      const todos = await db.getProducts({ incluirEscriturais: true });
      produto = todos.find((p) => p.escritural && String(p.sku || '') === String(bruto.produtoEscritural)) || null;
      if (!produto) {
        const err = new Error(
          `Produto escritural "${bruto.produtoEscritural}" não encontrado. `
          + 'Rode a migração fase-ab-nfe-complementar-icms.sql, que o cadastra.'
        );
        err.status = 400;
        throw err;
      }
    }
    const item = produto
      ? {
        ...bruto,
        descricao: bruto.descricao || produto.name,
        codigoProduto: bruto.codigoProduto || produto.sku || '',
        ncm: produto.ncm || bruto.ncm,
        cest: produto.cest || bruto.cest,
        ean: produto.ean || bruto.ean,
        origem: produto.origem === null || produto.origem === undefined ? (bruto.origem || 0) : produto.origem,
        unidadeComercial: produto.unidadeComercial || bruto.unidadeComercial || 'UN',
        unidadeTributavel: produto.unidadeTributavel || bruto.unidadeTributavel || produto.unidadeComercial || bruto.unidadeComercial || 'UN',
        // Escritural vem do CADASTRO, nunca do que a tela mandou: senão
        // bastaria marcar a flag no corpo da requisição para um produto real
        // sair de uma nota sem baixar estoque.
        escritural: produto.escritural === true,
        movimentaEstoque: produto.movimentaEstoque !== false,
        geraFinanceiro: produto.geraFinanceiro !== false
      }
      : bruto;

    if (!item.ncm) {
      const err = new Error(
        `Item ${index + 1} (${item.descricao || 'sem descrição'}) está sem NCM. ` +
        (produto
          ? 'Preencha o NCM no cadastro do produto, em Estoque → Produtos.'
          : 'Informe o NCM do item.')
      );
      err.status = 400;
      throw err;
    }

    const regra = await fiscalDb.resolverRegraFiscal({
      empresaId: empresa.id,
      ncm: item.ncm,
      origem: item.origem || 0,
      tipoOperacao,
      ufDestino: destinatario.uf,
      dentroDoEstado,
      destinatarioContribuinte: Boolean(destinatario.contribuinte),
      data: dataReferencia
    });
    if (!regra) {
      const err = new Error(`Nenhuma regra fiscal encontrada para o item ${index + 1} (NCM ${item.ncm || 'não informado'}). Cadastre uma regra fiscal para esta empresa antes de emitir.`);
      err.status = 400;
      throw err;
    }
    itens.push({
      ...item,
      regraFiscal: regra,
      // DIFAL só existe em venda interestadual para quem NÃO é contribuinte.
      // Contribuinte recolhe por conta própria; operação interna não tem
      // diferencial nenhum a partilhar.
      difal: !dentroDoEstado && !destinatario.contribuinte,
      // Percentual de crédito do Simples: é da EMPRESA (faixa do SN), não do
      // item. Só sai na nota quando o CSOSN é 101 ou 201.
      aliquotaCreditoSn: empresa.aliquotaCreditoIcmsSn
    });
  }

  // VALOR COMERCIAL. Item escritural vale zero e não entra: ele carrega
  // imposto, não mercadoria. Somá-lo faria uma nota complementar aparecer no
  // faturamento como venda.
  const valorTotal = itens.reduce((sum, item) => (item.escritural
    ? sum
    : sum + Math.round(Number(item.quantidade || 0) * Number(item.valorUnitario || 0) * 100) / 100), 0);
  // VALOR FISCAL. Separado do comercial de propósito — é o número que a nota
  // complementar existe para destacar, e ele NÃO é receita.
  const valorIcmsComplementar = Math.round(itens.reduce(
    (sum, item) => sum + Number(item.valorIcms || 0), 0) * 100) / 100;

  const referencia = createId('nfe');
  const tipoDocumento = body.tipoDocumento !== undefined ? Number(body.tipoDocumento) : 1;
  const finalidadeEmissao = operacaoFiscal.finalidadeDaOperacao(tipoOperacao, body.finalidadeEmissao);
  const naturezaOperacao = body.naturezaOperacao
    || (opFiscal ? opFiscal.rotulo : 'Venda de mercadoria');

  // Trava da operação ANTES de gravar rascunho e de falar com a Focus: erro de
  // preenchimento não pode virar rascunho órfão nem chamada gasta.
  const errosOperacao = operacaoFiscal.validarOperacao({
    tipoOperacao,
    finalidade: finalidadeEmissao,
    referencias,
    itens,
    valorIcmsComplementar
  });
  if (errosOperacao.length) {
    const err = new Error(errosOperacao.join(' '));
    err.status = 400;
    throw err;
  }

  const payload = buildNfePayload({
    estabelecimento,
    empresa,
    destinatario,
    itens,
    naturezaOperacao,
    tipoDocumento,
    finalidadeEmissao,
    dataEmissao,
    // Grupo de pagamento é obrigatório no layout 4.0 da NF-e. Sem nada
    // informado, o builder monta uma parcela única "Outros" — a nota passa,
    // e fica visível na tela que ninguém escolheu a forma.
    pagamentos: Array.isArray(body.pagamentos) ? body.pagamentos : null,
    frete: body.frete,
    seguro: body.seguro,
    desconto: body.desconto,
    outrasDespesas: body.outrasDespesas,
    modalidadeFrete: body.modalidadeFrete,
    informacoesAdicionais: body.informacoesAdicionais,
    // Quem manda é o ambiente EFETIVO (já considerando a trava de
    // homologação), não o que está salvo no estabelecimento: é ele que decide
    // se o nome do destinatário vai ser o texto obrigatório de teste.
    ambiente: focusNfe.ambienteEfetivo(estabelecimento.focusAmbiente).efetivo,
    // Grupo NFref. Sem ele a SEFAZ recusa a complementar, e a devolução perde
    // o vínculo com a nota devolvida.
    referencias
  });

  // OS TEXTOS CABEM? ANTES DE GRAVAR QUALQUER COISA (fase BL).
  //
  // A tela ja media as observacoes, mas so no navegador — e media a string
  // ERRADA: em homologacao o builder acrescenta ao rodape o aviso obrigatorio
  // de teste com o nome do destinatario, 75 a 123 caracteres que a tela nao
  // conta. Um texto de exatamente 5000, aprovado na tela, chega a SEFAZ com
  // 5081 e volta rejeitado.
  //
  // E a observacao do fisco da REGRA FISCAL, que vai no campo do item, nao
  // tinha limite nenhum em lugar nenhum. Ali o estrago e maior: uma regra com
  // texto longo demais rejeita TODA nota que casar com ela.
  //
  // Aqui, e nao depois: passar deste ponto consome numeracao, e nota rejeitada
  // por texto longo nao se conserta — a numeracao ja foi.
  const textoLongo = conferirLimitesDeTexto(payload, { informacoesAdicionais: body.informacoesAdicionais });
  if (textoLongo) {
    const err = new Error(textoLongo);
    err.status = 400;
    throw err;
  }

  const nfeExistente = await encontrarNfeIdempotente(estabelecimento.id, payload);
  if (nfeExistente) {
    return nfeExistente;
  }

  let nfe = await fiscalDb.createNfeRascunho({
    estabelecimentoId: estabelecimento.id,
    referencia,
    naturezaOperacao,
    tipoDocumento,
    finalidadeEmissao,
    valorTotal,
    dataEmissao,
    // O destinatário REAL, não o que foi para a SEFAZ: em homologação o nome
    // enviado é o texto fixo exigido por ela, e a lista mostraria a mesma
    // frase em toda linha. Sem isto, também não há como filtrar por cliente.
    destinatarioNome: destinatario.nome || '',
    destinatarioDocumento: String(destinatario.documento || '').replace(/\D/g, ''),
    orderId: body.orderId || body.saleId || '',
    // Só na nota AVULSA que gera financeiro. Numa operação que não gera
    // (complemento, transferência, bonificação), gravar a condição faria o
    // recebível nascer na autorização — exatamente o que a operação proíbe.
    condicaoPagamento: (body.orderId || body.saleId) || !operacaoFiscal.deveGerarFinanceiro({ tipoOperacao })
      ? null
      : condicaoPagamentoDoBody(body),
    tipoOperacaoFiscal: tipoOperacao,
    valorIcmsComplementar,
    nfeOriginalChave: chaveOriginal,
    payloadEnviado: payload
  });

  // O PEDIDO PASSA A SABER QUAL NOTA SAIU DELE.
  //
  // A coluna orders.nfe_id existe desde a fase-P e NINGUÉM a preenchia por este
  // caminho: em 22/08/2026 havia 7 pedidos no banco, 3 deles faturados, e zero
  // com nfe_id. O sentido contrário (nfe.order_id) já era gravado, então o
  // vínculo existia pela metade — dava para ir da nota ao pedido, nunca do
  // pedido à nota.
  //
  // É gravado AGORA, logo após criar o registro da nota e ANTES de mandar para
  // a Focus, porque é dele que a guarda acima depende: se a transmissão falhar
  // e o usuário clicar de novo, a segunda tentativa precisa encontrar a
  // primeira. Nota que terminar em ERRO não trava o pedido — a guarda ignora
  // ERRO, CANCELADO e DENEGADO.
  //
  // Falhar aqui NÃO derruba a emissão: a nota é o documento, o vínculo é
  // conveniência. Mas precisa aparecer no log, e não virar exceção calada.
  if (pedidoDaNota) {
    try {
      const pedido = await db.getOrderById(pedidoDaNota);
      if (pedido) await db.updateOrder(pedido.id, { ...pedido, nfeId: nfe.id });
    } catch (error) {
      console.error('NF-e emitida, mas não consegui gravar o vínculo no pedido', pedidoDaNota, error.message);
    }
  }

  try {
    const client = await focusNfe.forEstabelecimento(estabelecimento.id);
    const resposta = await client.emitirNfe(referencia, payload);
    // EMITIR FATURA O PEDIDO (fase AV) — a outra metade da unificação.
    // Faturar passou a exigir documento fiscal; sem isto, o usuário emitiria a
    // nota e ainda teria de voltar ao pedido para mudar o status à mão. Emitir
    // é o ato que prova que a venda saiu: é ele que fatura.
    //
    // A CHAMADA MUDOU DE LUGAR NA FASE BE: está dentro de
    // aplicarRespostaFocusNaNfe, no ramo da AUTORIZAÇÃO. Aqui embaixo ela só
    // pegava a resposta síncrona, e o caminho normal da Focus é assíncrono — a
    // nota voltava PROCESSANDO e o faturamento nunca acontecia.
    //
    // DEPOIS DA AUTORIZAÇÃO, e não antes: nota rejeitada não baixa estoque nem
    // cria conta a receber. O vínculo (nfe_id) é gravado antes porque serve de
    // guarda contra clique duplo; o faturamento só quando a SEFAZ disse sim.
    nfe = await aplicarRespostaFocusNaNfe(nfe, resposta, user);
    const data = loadData();
    data.auditLogs = data.auditLogs || [];
    await registrarAuditoria({ action: 'emitirNfeFiscal', targetId: nfe.id, targetUsername: referencia, byId: user.id, byName: user.name });
    saveData(data);
    return nfe;
  } catch (error) {
    await fiscalDb.updateNfeAposResposta(nfe.id, {
      status: 'ERRO',
      mensagemSefaz: error.message,
      respostaFocus: error.payload || null
    });
    throw error;
  }
}

// Usado tanto pela resposta síncrona da emissão quanto pelo webhook — é o
// único lugar que decide o novo status de uma NF-e a partir da Focus NFe.
// Idempotente: se o status recebido já é o mesmo que já estava salvo, não
// faz nada (evita reprocessar o mesmo evento duas vezes).
/**
 * Contas a receber de uma NF-e AVULSA (emitida sem pedido).
 *
 * Quando a nota nasce de um pedido, quem gera o financeiro é o pedido —
 * gerar de novo aqui duplicaria o recebível, e ninguém percebe até a
 * conciliação não fechar. Por isso a condição só existe na nota avulsa.
 *
 * Roda no momento em que a nota é AUTORIZADA, e não na emissão: nota que a
 * SEFAZ rejeitou não pode deixar recebível para trás. Como a autorização pode
 * chegar por webhook, minutos depois e sem usuário na tela, isto precisa ser
 * idempotente — a checagem de lançamento já existente é o que garante.
 */
// Quais CFOPs da nota criam recebível.
//
// Emitir nota não é sinônimo de vender: devolução (1202) não gera nada, venda
// (5405) gera. A classificação mora na COLUNA cfop.gera_financeiro, não aqui —
// quando um CFOP fugir do padrão, a correção é um UPDATE, não um deploy.
//
// Falha ao consultar devolve `null`, que quem chama trata como "não sei" e não
// como "não gera": deixar de criar recebível por instabilidade de rede seria
// perder dinheiro em silêncio.
async function cfopsDaNfeGeramFinanceiro(nfe) {
  const itens = Array.isArray(nfe?.payloadEnviado?.items) ? nfe.payloadEnviado.items : [];
  const codigos = [...new Set(itens.map((i) => String(i?.cfop || '').replace(/\D/g, '')).filter(Boolean))];
  if (!codigos.length) return null;
  try {
    const tabela = await fiscalDb.getCfopsPorCodigo(codigos);
    // Basta UM item de venda para a nota gerar: nota mista (venda + remessa)
    // tem valor a receber pela parte vendida.
    const conhecidos = codigos.filter((c) => tabela[c] !== undefined);
    if (!conhecidos.length) return null;
    return conhecidos.some((c) => tabela[c] === true);
  } catch (error) {
    console.error('Falha ao classificar o CFOP da NF-e', nfe.id, error.message);
    return null;
  }
}

async function gerarFinanceiroDaNfeAvulsa(nfe, user) {
  if (!nfe || nfe.orderId) return 0;
  const condicao = nfe.condicaoPagamento;
  if (!condicao) return 0;

  // A OPERAÇÃO manda primeiro: transferência entre estabelecimentos próprios,
  // remessa, retorno e devolução não são receita, ainda que tenham condição de
  // pagamento preenchida. O catálogo já declarava isso em operacaoFiscal.js e
  // esta função não consultava — uma devolução gerava recebível.
  const operacao = operacaoFiscal.operacao(nfe.tipoOperacaoFiscal);
  if (operacao && !operacao.geraFinanceiro) return 0;

  // E o CFOP confirma. Os dois podem discordar: a operação é escolhida na tela,
  // o CFOP vem da regra fiscal do item. Quando o CFOP diz que não é venda, ele
  // vence — é ele que vai no documento e é por ele que o contador confere.
  const porCfop = await cfopsDaNfeGeramFinanceiro(nfe);
  if (porCfop === false) return 0;

  // A NOTA PRECISA EXISTIR. Esta checagem era do banco (uma FK), e o banco não
  // consegue mais fazê-la: financial_entries.nfe_id aponta ora para `nfe`
  // (uuid, fiscal), ora para `nfes` (texto, manual), e uma FK só sabe apontar
  // para uma tabela. Ver fase-ae.
  //
  // Sem isto, parcela órfã de documento fiscal entra calada — e é o tipo de
  // inconsistência que só aparece na conferência do contador.
  const existe = await fiscalDb.getNfeById(nfe.id);
  if (!existe) {
    console.error('NF-e não encontrada ao gerar o financeiro; parcela NÃO criada:', nfe.id);
    return 0;
  }

  const data = loadData();
  await syncFinanceData(data);
  // Idempotência: o webhook pode chegar duas vezes, e a Focus reenvia.
  if ((data.finance || []).some((entry) => entry.nfeId === nfe.id)) return 0;

  const emissao = String(nfe.dataEmissao || '').slice(0, 10) || getTodayLocal().toISOString().slice(0, 10);
  const parcelas = buildNfeInstallments({
    amount: Number(nfe.valorTotal || 0),
    date: emissao,
    installmentsCount: condicao.tipo === 'parcelado' ? condicao.parcelas : 1,
    installmentIntervalDays: condicao.intervaloDias
  });

  // Sem número, a referência: a nota existe e precisa ser achável mesmo antes
  // de a SEFAZ devolver o número.
  const numeroOuReferencia = nfe.numero || nfe.referencia;
  for (const parcela of parcelas) {
    await db.createFinancialEntry({
      type: 'RECEITA',
      date: emissao,
      dueDate: parcela.dueDate,
      amount: parcela.amount,
      description: descricaoLancamento.montar({
        qual: 'receita',
        tipo: 'venda',
        nota: numeroOuReferencia,
        parcela: parcela.number,
        parcelas: parcelas.length
      }),
      document: String(nfe.numero || ''),
      clientSupplierId: '',
      clientSupplierName: nfe.destinatarioNome || '',
      referenceId: '',
      nfeId: nfe.id,
      status: 'pending',
      // Autorização por webhook não tem usuário na tela.
      createdBy: user?.id || '',
      createdByName: user?.name || 'Sistema (webhook fiscal)'
    });
  }
  return parcelas.length;
}

async function aplicarRespostaFocusNaNfe(nfe, resposta, user) {
  const novoStatus = mapFocusStatusToNfeStatus(resposta.status);
  if (novoStatus === nfe.status) {
    return nfe;
  }
  const atualizada = await fiscalDb.updateNfeAposResposta(nfe.id, {
    status: novoStatus,
    serie: resposta.serie,
    numero: resposta.numero,
    // A Focus devolve a chave PREFIXADA: "NFe4226084379...". São 47
    // caracteres, e a coluna é character(44) — a gravação estourava com
    // "value too long for type character(44)", derrubando a atualização
    // INTEIRA. O efeito era grotesco e silencioso: nota AUTORIZADA pela SEFAZ,
    // com protocolo e DANFE prontos, e o sistema preso em "Processando" para
    // sempre. Valia tanto pelo webhook quanto pela consulta manual, porque as
    // duas passam por aqui.
    //
    // Só dígitos: a chave de acesso da NF-e é numérica de 44 posições, e é
    // assim que ela entra em consulta na SEFAZ, em carta de correção e em
    // referência de nota complementar.
    chaveAcesso: String(resposta.chave_nfe || '').replace(/\D/g, '') || null,
    mensagemSefaz: resposta.mensagem_sefaz,
    protocolo: resposta.protocolo,
    urlXml: resposta.caminho_xml_nota_fiscal,
    urlDanfe: resposta.caminho_danfe,
    respostaFocus: resposta,
    autorizadoEm: novoStatus === 'AUTORIZADO' ? new Date().toISOString() : null
  });

  if (novoStatus === 'AUTORIZADO') {
    // Melhor esforço: guarda uma cópia local do XML/DANFE pra não depender
    // do link da Focus continuar disponível pra sempre. Se falhar (rede,
    // arquivo ainda não gerado etc.), não derruba a autorização — a NF-e já
    // está autorizada pela SEFAZ de qualquer forma.
    baixarEGuardarArquivosNfe(atualizada).catch((error) => {
      console.error('Falha ao baixar XML/DANFE da NF-e', atualizada.id, error.message);
    });

    // Nota avulsa (sem pedido) vira contas a receber agora, não na emissão:
    // recebível de nota rejeitada é pior do que recebível atrasado. Falhar
    // aqui NÃO desautoriza a nota — ela já existe para a SEFAZ, e o erro
    // precisa aparecer no log, não virar exceção que engole a autorização.
    try {
      const criadas = await gerarFinanceiroDaNfeAvulsa(atualizada, user);
      if (criadas) console.log(`NF-e avulsa ${atualizada.id}: ${criadas} parcela(s) em contas a receber.`);
    } catch (error) {
      console.error('Falha ao gerar o financeiro da NF-e avulsa', atualizada.id, error.message);
    }

    // AUTORIZAR FATURA O PEDIDO — E É AQUI, NÃO NA EMISSÃO (fase BE).
    //
    // Estava em emitirNfeFiscal, logo depois da resposta SÍNCRONA da Focus.
    // Só que o caminho normal da Focus é assíncrono: ela devolve 202 e a nota
    // fica PROCESSANDO. Nesse instante faturarPedidoDaNota via status
    // "PROCESSANDO" e saia na primeira linha. A autorização chegava depois,
    // pelo webhook ou por uma reconsulta — e as duas passam por AQUI, que
    // não faturava. Resultado: NF-e autorizada na SEFAZ, pedido em aberto,
    // mercadoria em estoque e nenhuma conta a receber.
    //
    // Esta função é o ÚNICO lugar que decide que uma nota passou a AUTORIZADO,
    // e só entra aqui quando o status MUDOU (a guarda no topo). Por isso o
    // faturamento acontece uma vez, venha a autorização por onde vier.
    //
    // `orderId` e não um parâmetro: o webhook só tem a referência da nota nas
    // mãos, e é a própria nota que guarda de qual pedido ela nasceu.
    await faturarPedidoDaNota(atualizada, atualizada.orderId, user);
  }

  return atualizada;
}

async function baixarEGuardarArquivosNfe(nfe) {
  const client = await focusNfe.forEstabelecimento(nfe.estabelecimentoId);
  if (nfe.urlXml) {
    const conteudo = await client.baixarArquivo(nfe.urlXml);
    await fiscalDb.createNfeArquivo({ nfeId: nfe.id, tipo: 'xml', conteudo });
  }
  if (nfe.urlDanfe) {
    const conteudo = await client.baixarArquivo(nfe.urlDanfe);
    await fiscalDb.createNfeArquivo({ nfeId: nfe.id, tipo: 'danfe', conteudo });
  }
}

// Cadastra na Focus NFe a URL de callback pra este estabelecimento — sem
// isso, a Focus nunca chama nosso webhook e NF-e assíncrona (202) fica presa
// em PROCESSANDO até alguém consultar manualmente.
async function registrarWebhookFiscal(estabelecimentoId) {
  const webhookUrl = String(process.env.FISCAL_WEBHOOK_URL || '').trim();
  const webhookSecret = String(process.env.FISCAL_WEBHOOK_SECRET || '').trim();
  if (!webhookUrl || !webhookSecret) {
    const err = new Error('Configure FISCAL_WEBHOOK_URL e FISCAL_WEBHOOK_SECRET no .env do servidor antes de registrar o webhook.');
    err.status = 400;
    throw err;
  }
  const estabelecimento = await fiscalDb.getEstabelecimentoById(estabelecimentoId);
  if (!estabelecimento) {
    const err = new Error('Estabelecimento não encontrado.');
    err.status = 404;
    throw err;
  }
  const client = await focusNfe.forEstabelecimento(estabelecimentoId);

  // A Focus ACUMULA webhooks: registrar de novo com outra URL não substitui,
  // adiciona. A URL velha continua sendo chamada e gerando retentativa para
  // sempre. Por isso, antes de criar, remove os hooks do MESMO CNPJ e MESMO
  // evento que apontam para outro lugar — trocar de domínio é o caso comum.
  //
  // O filtro é estreito de propósito: hook de outro CNPJ ou de outro evento
  // não é nosso para apagar.
  const cnpjLimpo = String(estabelecimento.cnpj || '').replace(/\D/g, '');
  const removidos = [];
  let jaRegistrado = false;
  try {
    const existentes = await client.listarWebhooks();
    const lista = Array.isArray(existentes) ? existentes : (existentes && Array.isArray(existentes.hooks) ? existentes.hooks : []);
    for (const hook of lista) {
      if (!hook || !hook.id) continue;
      if (String(hook.event || '') !== 'nfe') continue;
      if (String(hook.cnpj || '').replace(/\D/g, '') !== cnpjLimpo) continue;
      if (String(hook.url || '') === webhookUrl) {
        jaRegistrado = true;
        continue;
      }
      try {
        await client.excluirWebhook(hook.id);
        removidos.push(hook.url);
      } catch (error) {
        // Não aborta: falhar em limpar o antigo não é motivo para deixar o
        // novo sem registrar. O retorno conta o que ficou para trás.
        removidos.push(`${hook.url} (falha ao remover: ${error.message})`);
      }
    }
  } catch (error) {
    // Listar pode falhar sem que o registro precise falhar junto.
    removidos.push(`(não foi possível listar os webhooks existentes: ${error.message})`);
  }

  // Recriar um hook idêntico duplicaria a chamada para a mesma URL.
  if (jaRegistrado) {
    return { jaRegistrado: true, url: webhookUrl, removidos };
  }

  const webhook = await client.criarWebhook({
    event: 'nfe',
    cnpj: estabelecimento.cnpj,
    url: webhookUrl,
    secret: webhookSecret,
    secretHeader: 'X-Fiscal-Webhook-Secret'
  });
  return { ...webhook, url: webhookUrl, removidos };
}

async function cancelarNfeFiscal(id, justificativa, user, opcoes = {}) {
  if (!justificativa || justificativa.trim().length < 15) {
    const err = new Error('Justificativa do cancelamento precisa ter ao menos 15 caracteres (exigência da SEFAZ).');
    err.status = 400;
    throw err;
  }
  const nfe = await fiscalDb.getNfeById(id);
  if (!nfe) {
    const err = new Error('NF-e não encontrada.');
    err.status = 404;
    throw err;
  }

  // PRAZO DE 24 HORAS. A regra vive aqui, e não só na tela: botão desabilitado
  // é conforto, não trava — a rota continua aberta para qualquer chamada.
  //
  // O relógio começa na AUTORIZAÇÃO, não na emissão: a nota pode ficar minutos
  // (ou horas, quando o webhook não chega) entre transmitida e autorizada, e é
  // a autorização que a SEFAZ registra.
  //
  // Nota sem carimbo de autorização NÃO é bloqueada: seria impedir o
  // cancelamento legítimo de uma nota recém-autorizada cujo horário ainda não
  // voltou. Nesse caso quem decide é a SEFAZ, que recusa por prazo excedido.
  const prazo = prazoCancelamento.avaliar(nfe.autorizadoEm);
  if (!prazo.dentroDoPrazo && !opcoes.extemporaneo) {
    const err = new Error(prazo.motivo);
    err.status = 409;
    throw err;
  }

  const client = await focusNfe.forEstabelecimento(nfe.estabelecimentoId);
  const resposta = await client.cancelarNfe(nfe.referencia, justificativa);
  const updated = await fiscalDb.updateNfeAposResposta(nfe.id, {
    status: mapFocusStatusToNfeStatus(resposta.status) === 'AUTORIZADO' ? 'CANCELADO' : mapFocusStatusToNfeStatus(resposta.status),
    mensagemSefaz: resposta.mensagem_sefaz,
    respostaFocus: resposta
  });
  await fiscalDb.createNfeEvento({
    nfeId: nfe.id,
    estabelecimentoId: nfe.estabelecimentoId,
    tipo: 'CANCELAMENTO',
    payloadEnviado: { justificativa },
    respostaFocus: resposta,
    status: updated.status
  });
  const data = loadData();
  data.auditLogs = data.auditLogs || [];
  await registrarAuditoria({ action: 'cancelarNfeFiscal', targetId: nfe.id, targetUsername: nfe.referencia, byId: user.id, byName: user.name, details: { justificativa } });
  saveData(data);
  // DEPOIS de a SEFAZ confirmar e de o evento estar gravado: se o
  // cancelamento nao vingou, nao ha faturamento a desfazer.
  await desfaturarPedidoDaNota(updated, user);
  return updated;
}

async function emitirCartaCorrecaoFiscal(id, correcao, user) {
  if (!correcao || correcao.trim().length < 15 || correcao.trim().length > 1000) {
    const err = new Error('A correção precisa ter entre 15 e 1000 caracteres (exigência da SEFAZ).');
    err.status = 400;
    throw err;
  }
  const nfe = await fiscalDb.getNfeById(id);
  if (!nfe) {
    const err = new Error('NF-e não encontrada.');
    err.status = 404;
    throw err;
  }
  if (nfe.status !== 'AUTORIZADO') {
    const err = new Error('Só é possível emitir Carta de Correção para uma NF-e autorizada.');
    err.status = 400;
    throw err;
  }
  const client = await focusNfe.forEstabelecimento(nfe.estabelecimentoId);
  const resposta = await client.emitirCartaCorrecao(nfe.referencia, correcao);
  const evento = await fiscalDb.createNfeEvento({
    nfeId: nfe.id,
    estabelecimentoId: nfe.estabelecimentoId,
    tipo: 'CCE',
    payloadEnviado: { correcao },
    respostaFocus: resposta,
    status: resposta.status
  });
  const data = loadData();
  data.auditLogs = data.auditLogs || [];
  await registrarAuditoria({ action: 'emitirCartaCorrecaoFiscal', targetId: nfe.id, targetUsername: nfe.referencia, byId: user.id, byName: user.name, details: { correcao } });
  saveData(data);
  return evento;
}

async function inutilizarNumeracaoFiscal(body, user) {
  const justificativa = String(body.justificativa || '');
  if (justificativa.trim().length < 15) {
    const err = new Error('Justificativa precisa ter ao menos 15 caracteres (exigência da SEFAZ).');
    err.status = 400;
    throw err;
  }
  const numeroInicial = Number(body.numeroInicial);
  const numeroFinal = Number(body.numeroFinal);
  if (!body.serie || !Number.isFinite(numeroInicial) || !Number.isFinite(numeroFinal) || numeroFinal < numeroInicial) {
    const err = new Error('Informe série e uma faixa de numeração válida (número final maior ou igual ao inicial).');
    err.status = 400;
    throw err;
  }
  const estabelecimento = await fiscalDb.getEstabelecimentoById(body.estabelecimentoId);
  if (!estabelecimento) {
    const err = new Error('Estabelecimento não encontrado.');
    err.status = 404;
    throw err;
  }

  const client = await focusNfe.forEstabelecimento(estabelecimento.id);
  const resposta = await client.inutilizarNumeracao({
    cnpj: estabelecimento.cnpj,
    serie: body.serie,
    numeroInicial,
    numeroFinal,
    justificativa
  });
  const evento = await fiscalDb.createNfeEvento({
    nfeId: null,
    estabelecimentoId: estabelecimento.id,
    tipo: 'INUTILIZACAO',
    payloadEnviado: { serie: body.serie, numeroInicial, numeroFinal, justificativa },
    respostaFocus: resposta,
    status: resposta.status
  });
  // A faixa inutilizada e a justificativa ficam nos detalhes: é o que o fisco
  // pergunta depois, e sem isso o registro só diz que alguém inutilizou algo.
  await registrarAuditoria({
    action: 'inutilizarNumeracaoFiscal',
    targetId: estabelecimento.id,
    targetUsername: `${body.serie}: ${numeroInicial}-${numeroFinal}`,
    byId: user.id,
    byName: user.name,
    details: { serie: body.serie, numeroInicial, numeroFinal, justificativa: body.justificativa }
  });
  return evento;
}

// ============================================================================
// ESTOQUE — helpers das rotas
// ============================================================================

// Paginação: um valor não numérico na query (?page=abc) virava NaN e devolvia
// lista vazia em vez de cair na primeira página.
// ORDENAÇÃO DA LISTA DE VENDAS.
//
// Lista branca, e não `record[campo]` direto: o campo vem da query string, e
// deixar o cliente escolher qualquer chave é entregar a ele a forma de ler o
// objeto inteiro — inclusive o que o serializer não deveria expor.
//
// Ordena sobre o registro JÁ SERIALIZADO. Empresa e vendedor são ids no
// registro cru e viram nome só na serialização: ordenar antes colocaria a
// lista em ordem de id, que não é ordem nenhuma para quem lê.
const CAMPOS_ORDENAVEIS = {
  code: (r) => Number(r.code) || 0,
  date: (r) => String(r.date || ''),
  updatedAt: (r) => String(r.updatedAt || ''),
  status: (r) => String(r.status || ''),
  companyName: (r) => String(r.companyName || '').toLowerCase(),
  customer: (r) => String(r.customer || '').toLowerCase(),
  nfeNumero: (r) => Number(r.nfeNumero) || 0,
  sellerName: (r) => String(r.sellerName || '').toLowerCase(),
  clientContact: (r) => String(r.clientContact || '').toLowerCase(),
  amount: (r) => Number(r.totalAmount ?? r.amount ?? 0),
  dataEnvio: (r) => String(r.dataEnvio || ''),
  saleOrigin: (r) => String(r.saleOrigin || '').toLowerCase()
};

function ordenarSalesRecords(registros, campo, direcao) {
  const ler = CAMPOS_ORDENAVEIS[campo];
  // Sem campo válido, a ordem histórica: código decrescente, que é "o mais
  // recente primeiro" para quem cria pedido em sequência.
  if (!ler) {
    return registros.sort((a, b) => (Number(b.code) || 0) - (Number(a.code) || 0)
      || String(b.date || '').localeCompare(String(a.date || '')));
  }
  const sinal = direcao === 'asc' ? 1 : -1;
  return registros.sort((a, b) => {
    const x = ler(a);
    const y = ler(b);
    if (x < y) return -1 * sinal;
    if (x > y) return 1 * sinal;
    // Desempate estável pelo código: sem isto, duas linhas com a mesma data
    // trocam de lugar a cada recarga e parecem bug de paginação.
    return (Number(b.code) || 0) - (Number(a.code) || 0);
  });
}

function parsePageParams(searchParams, defaultLimit = 20, maxLimit = 100) {
  const rawPage = Number(searchParams.get('page'));
  const rawLimit = Number(searchParams.get('limit'));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(maxLimit, Math.floor(rawLimit))
    : defaultLimit;
  return { page, limit };
}

function userCanStock(user) {
  return Boolean(user && user.allowedModules.includes('stock'));
}

// Produtos vêm do Supabase; o resto do estoque, do db.json. Quase toda rota
// precisa dos dois lados, então carrega junto.
//
// syncCadastroData é obrigatório: depósitos migraram para o Supabase junto com
// pessoas/CNPJs, mas o módulo de Estoque lê `data.deposits` do db.json (é assim
// que stockCore calcula saldo por depósito). Sem o sync, todo depósito criado
// pela tela de Cadastros era invisível aqui e as rotas respondiam
// "Depósito não encontrado".
/**
 * `comReservas` é opcional porque custa: ler os pedidos é uma consulta a mais
 * em toda requisição do Estoque. Só as rotas que MOSTRAM a reserva pagam por
 * ela — registrar movimentação, por exemplo, não precisa saber o que está
 * prometido, e cobrar a consulta ali seria custo sem uso.
 */
/**
 * Monta o documento de compra a partir do que a tela mandou.
 *
 * O TIPO NAO VEM DA TELA: vem do status, pelo catalogo. Aceitar um `type` do
 * corpo permitiria gravar uma cotacao marcada como ordem — dois campos dizendo
 * coisas diferentes sobre o mesmo registro, e nenhuma tela saberia qual dos
 * dois obedecer.
 *
 * Os TOTAIS tambem nao vem da tela: sao recalculados aqui pelo mesmo modulo que
 * a tela usou para mostra-los. A tela mostra; o servidor decide.
 */
function montarDocumentoDeCompra(body, data, user) {
  const status = String(body.status || 'cotacao');
  if (!purchaseStatus.CATALOGO.some((s) => s.value === status)) {
    const erro = new Error('Status de compra desconhecido: ' + status);
    erro.status = 400;
    throw erro;
  }

  // Fornecedor: o id aponta pro Cadastro; o nome viaja junto para a lista
  // continuar legivel se o cadastro for excluido depois. Mesmo par que Vendas
  // usa em clientSupplierId/clientSupplierName.
  let supplierName = String(body.supplierName || '').trim();
  if (body.supplierId) {
    const achado = getCadastroDirectory(data).find((entry) => entry.id === body.supplierId);
    if (achado) supplierName = achado.name;
  }
  if (!supplierName) {
    const erro = new Error('Informe o fornecedor.');
    erro.status = 400;
    throw erro;
  }

  const totais = purchaseTotals.calcular(body);
  if (!totais.items.length) {
    const erro = new Error('Inclua ao menos um item com produto e quantidade.');
    erro.status = 400;
    throw erro;
  }

  return {
    type: purchaseStatus.tipoDoStatus(status),
    status,
    supplierId: body.supplierId || '',
    supplierName,
    companyId: body.companyId || '',
    depositId: body.depositId || '',
    date: body.date || new Date().toISOString().slice(0, 10),
    deliveryDate: body.deliveryDate || null,
    note: String(body.note || ''),
    ...totais,
    createdBy: user?.id || '',
    createdByName: user?.name || ''
  };
}

/**
 * MUDA O STATUS DO DOCUMENTO E APLICA O QUE O STATUS NOVO DECLARA.
 *
 * E o equivalente de transitionOrderStockEffect em Vendas, e a diferenca
 * importante esta no primeiro paragrafo abaixo.
 *
 * A ENTRADA EM DOBRO E O RISCO DESTE MODULO. A mesma mercadoria pode chegar por
 * dois caminhos: receber a ordem, ou lancar a Nota de Entrada do fornecedor
 * (XML). Se os dois movimentarem, o saldo dobra — e dobra em silencio, porque
 * cada tela, sozinha, esta certa. Quem impede e `entradaNfeId`: ordem com nota
 * ligada nao movimenta por conta propria, porque a nota ja movimentou.
 *
 * OS EFEITOS SAO GRAVADOS NO DOCUMENTO (stockApplied/financeApplied), e nao
 * deduzidos do status. Status muda; o que ja aconteceu nao desacontece. Sem
 * essas duas colunas, receber -> cancelar -> receber lancaria a mercadoria duas
 * vezes, e cada passo pareceria correto.
 */
async function transicionarDocumentoDeCompra(data, { id, novoStatus, user }) {
  const documento = await comprasDb.obterDocumento(id);
  if (!documento) {
    const erro = new Error('Documento nao encontrado');
    erro.status = 404;
    throw erro;
  }
  const alvo = purchaseStatus.CATALOGO.find((s) => s.value === novoStatus);
  if (!alvo) {
    const erro = new Error('Status de compra desconhecido: ' + novoStatus);
    erro.status = 400;
    throw erro;
  }

  const deveEntrarNoEstoque = alvo.entraEstoque && !documento.stockApplied;
  const deveSairDoEstoque = !alvo.entraEstoque && documento.stockApplied;
  // CANCELAR e o unico gatilho, de proposito (fase BI). Cobrar
  // `!alvo.geraFinanceiro` cancelaria o pagavel tambem ao ir de "Ordem
  // Recebida" para "Recebida Parcialmente", que nao e o mesmo assunto — la a
  // divida continua existindo, so o recebimento e que foi parcial.
  const deveCancelarFinanceiro = Boolean(alvo.cancelado) && documento.financeApplied;

  // O INDICE de produtos, montado uma vez e passado adiante. Inclui os
  // escriturais de proposito: e indice de RESOLUCAO, nao lista de mercadoria —
  // um documento antigo que aponte para um escritural precisa continuar
  // resolvendo, do mesmo jeito que o productsById do loadStockContext. Nao vai
  // para tela nenhuma.
  let productsById = null;
  if (deveEntrarNoEstoque || deveSairDoEstoque) {
    const todos = await db.getProducts({ incluirEscriturais: true });
    productsById = new Map(todos.map((produto) => [produto.id, produto]));
  }

  // --- estorno: o documento tinha entrado e agora nao entra mais ------------
  if (deveSairDoEstoque) {
    await estornarRecebimentoDeCompra(data, { documento, novoStatus: alvo, user, productsById });
    // ANTES do return: era exatamente este atalho que deixava a conta a pagar
    // viva. O bloco de financeiro fica la embaixo e nunca era alcancado por
    // um cancelamento de ordem ja recebida.
    if (deveCancelarFinanceiro) {
      await cancelarFinanceiroDaCompra(data, { documentoId: id, user });
      await comprasDb.atualizarStatus(id, { status: alvo.value, type: alvo.tipo, financeApplied: false });
    }
    return comprasDb.obterDocumento(id);
  }

  // Cancelar sem estorno de estoque tambem passa por aqui: uma ordem com
  // financeApplied e stockApplied false (recebida por Nota de Entrada, ou
  // "Recebida Sem Financeiro") nao entra no ramo acima e mesmo assim tem
  // conta a pagar para matar.
  if (deveCancelarFinanceiro) {
    await cancelarFinanceiroDaCompra(data, { documentoId: id, user });
    await comprasDb.atualizarStatus(id, { status: alvo.value, type: alvo.tipo, financeApplied: false });
  }

  // --- entrada -------------------------------------------------------------
  if (deveEntrarNoEstoque) {
    if (documento.entradaNfeId) {
      const erro = new Error(
        'Esta ordem ja tem uma Nota de Entrada lancada, e foi ela que deu entrada no estoque. '
        + 'Receber de novo lancaria a mesma mercadoria duas vezes.'
      );
      erro.status = 400;
      throw erro;
    }
    const faltando = documento.items.filter((item) => !productsById.has(item.productId));
    if (faltando.length) {
      const erro = new Error(
        'Produto nao encontrado: ' + faltando.map((i) => i.name || i.productId).join(', ')
        + '. A ordem nao foi recebida.'
      );
      erro.status = 400;
      throw erro;
    }

    const movimentos = documento.items.map((item) => buildMovementRecord(data, {
      type: 'entrada',
      productId: item.productId,
      depositId: documento.depositId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      classId: item.classId,
      classValueId: item.classValueId,
      referenceType: 'purchase-order',
      referenceId: documento.id,
      document: 'Ordem de Compra ' + (documento.code || documento.id),
      note: 'Recebimento da ordem de ' + documento.supplierName,
      origin: 'ordem-de-compra'
    }, user));

    // O estoque e a marca de recebido entram JUNTOS: ver o gancho
    // tambemNaTransacao em commitStockMovements.
    await commitStockMovements(data, movimentos, productsById, {
      tambemNaTransacao: (cliente) => comprasDb.atualizarStatus(id, {
        status: alvo.value, type: alvo.tipo, stockApplied: true
      }, cliente)
    });
  } else {
    await comprasDb.atualizarStatus(id, { status: alvo.value, type: alvo.tipo });
  }

  // --- financeiro ----------------------------------------------------------
  // Fora da transacao do estoque de proposito: o financeiro tem tabela e rotina
  // proprias, e falhar ao criar a conta a pagar nao pode desfazer a entrada da
  // mercadoria — a mercadoria chegou de verdade. O documento guarda
  // financeApplied, entao a conta nao nasce duas vezes.
  if (alvo.geraFinanceiro && !documento.financeApplied) {
    const lancamento = await db.createFinancialEntry({
      type: 'purchase',
      referenceId: documento.id,
      clientSupplierId: documento.supplierId || '',
      clientSupplierName: documento.supplierName,
      date: documento.deliveryDate || documento.date,
      // O nome do fornecedor sai daqui e fica em clientSupplierName, que a
      // lista já mostra em coluna própria — ver o cabeçalho do catálogo.
      description: descricaoLancamento.montar({
        qual: 'despesa',
        tipo: 'compra',
        ordem: documento.code || documento.id
      }),
      amount: documento.totalAmount,
      status: 'pending',
      createdBy: user?.id,
      createdByName: user?.name
    });
    data.finance.push(lancamento);
    await comprasDb.atualizarStatus(id, { status: alvo.value, type: alvo.tipo, financeApplied: true });
  }

  return comprasDb.obterDocumento(id);
}

/**
 * Desfaz o recebimento: tira a mercadoria que entrou e desmarca o documento.
 *
 * Nao apaga os movimentos originais — lanca os CONTRARIOS. Apagar deixaria o
 * razao sem a prova de que a mercadoria chegou e voltou, e e justamente essa
 * prova que a conferencia fisica procura quando o saldo nao bate.
 */
/**
 * CANCELAR A COMPRA MATA A CONTA A PAGAR QUE ELA CRIOU (fase BI).
 *
 * O espelho de transitionOrderFinanceEffect no lado das compras, e ele faltava
 * inteiro. Os dois caminhos de compra deixavam o pagavel vivo, por motivos
 * diferentes:
 *
 *   - purchase_orders: transicionarDocumentoDeCompra estornava o estoque e dava
 *     `return` ANTES do bloco de financeiro. A conta a pagar do recebimento
 *     ficava 'pending' e financeApplied continuava true.
 *
 *   - purchases (compra rapida): o codigo PARECIA tratar — havia um
 *     `financeEntry.status = 'cancelado'` — mas so mudava o objeto em memoria.
 *     Faltava o db.updateFinancialEntry, e `financial_entries` mora no Postgres:
 *     a mutacao nunca chegava la, e o proximo syncFinanceData a sobrescrevia
 *     com o que o banco ainda dizia.
 *
 * Nos dois casos a mercadoria voltava e o fornecedor continuava sendo cobrado
 * pelo Contas a Pagar, sem nenhum documento por tras.
 *
 * BAIXA REGISTRADA NAO SOME. Se alguem ja pagou, o dinheiro saiu de verdade:
 * cancelar o lancamento apagaria o rastro do pagamento. E a mesma regra do lado
 * das vendas. Quem chama recebe a lista do que ficou, para poder avisar.
 */
async function cancelarFinanceiroDaCompra(data, { documentoId, user }) {
  const vinculadas = (data.finance || []).filter((entry) => entry.referenceId === documentoId
    && entry.status !== 'cancelado');
  const canceladas = [];
  const mantidas = [];
  for (const entry of vinculadas) {
    if (getFinanceEntryPayments(data, entry.id).length) {
      mantidas.push(entry);
      continue;
    }
    entry.status = 'cancelado';
    entry.updatedAt = new Date().toISOString();
    await db.updateFinancialEntry(entry.id, { status: 'cancelado' });
    await addFinanceAuditLog(data, {
      action: 'cancelarContaAPagarDaCompra',
      entry,
      byId: user?.id,
      byName: user?.name,
      details: { documentoId }
    });
    canceladas.push(entry);
  }
  return { canceladas, mantidas };
}

async function estornarRecebimentoDeCompra(data, { documento, novoStatus, user, productsById }) {
  const estornos = documento.items
    .filter((item) => productsById.has(item.productId))
    .map((item) => buildMovementRecord(data, {
      type: 'saida',
      productId: item.productId,
      depositId: documento.depositId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      classId: item.classId,
      classValueId: item.classValueId,
      referenceType: 'purchase-order-estorno',
      referenceId: documento.id,
      document: 'Ordem de Compra ' + (documento.code || documento.id),
      note: 'Estorno do recebimento da ordem de ' + documento.supplierName,
      origin: 'ordem-de-compra'
    }, user));

  await commitStockMovements(data, estornos, productsById, {
    tambemNaTransacao: (cliente) => comprasDb.atualizarStatus(documento.id, {
      status: novoStatus.value, type: novoStatus.tipo, stockApplied: false
    }, cliente)
  });
}

/**
 * Poe o razao de estoque dentro de `data` — o que loadStockContext fazia
 * sozinho ate a fase BD.
 *
 * FASE AP: o razao vem do Postgres, nao mais do db.json.
 *
 * Continua entrando em `data` com o mesmo nome e no mesmo formato de antes,
 * de proposito: quem calcula saldo e' lib/stock-core.js, em memoria, e essas
 * funcoes sao o miolo do modulo. Trocar o ARMAZENAMENTO e a MATEMATICA na
 * mesma mudanca seria nao saber qual das duas errou o saldo.
 *
 * POR QUE VIROU FUNCAO SEPARADA (fase BD)
 * ---------------------------------------
 * Quem projeta saldo nao e' so o modulo Estoque. Vendas, Compras, Fiscal e os
 * paineis tambem projetam — e chamavam `loadData()`, que devolve
 * `stockMovements: []` porque a colecao esta em NAO_PERSISTIR. Com a lista
 * vazia, `classValueBalance` somava zero linhas e TODO item com cor era
 * recusado com "disponivel: 0", mesmo com saldo no razao. Reproduzido num banco
 * de prova: 10 unidades Brancas no razao, pedido de 1 Branca recusado, o mesmo
 * pedido sem cor aceito, e a mesma baixa aceita pela tela de Estoque.
 *
 * Nao da' para essas rotas chamarem loadStockContext: ela cria o proprio
 * `data`, e a rota ja mexeu no dela (pedido gravado, financeiro gerado).
 *
 * A BANDEIRA. Chamar duas vezes na mesma requisicao trocaria `stockMovements`
 * por uma releitura do banco — e levaria junto os movimentos que
 * registrarMovimentoEstoque ja empilhou em memoria mas ainda nao descarregou.
 * Por isso a segunda chamada sai calada.
 *
 * Quando o razao passar de algumas dezenas de milhares de linhas, o saldo vira
 * agregacao em SQL — os indices por (product_id, deposit_id) e
 * (product_id, class_value_id) ja estao la esperando esse dia.
 */
async function sincronizarRazao(data) {
  if (data.__razaoCarregado) return data;
  data.stockMovements = await razaoEstoque.listarMovimentos();
  data.stockTransfers = await razaoEstoque.listarTransferencias();
  // Fila dos movimentos que Vendas/Compras/PCP empilham durante a requisicao e
  // que so viram linha no banco no descarregarMovimentosPendentes(). So' nasce
  // aqui se ainda nao existir, pelo mesmo motivo da bandeira.
  if (!Array.isArray(data.__movimentosPendentes)) data.__movimentosPendentes = [];
  data.__razaoCarregado = true;
  return data;
}

async function loadStockContext({ comReservas = false } = {}) {
  const data = loadData();
  await syncCadastroData(data);
  await sincronizarRazao(data);
  let reservas = null;
  if (comReservas) {
    try {
      reservas = reservasLib.calcularReservas(await db.getOrders());
    } catch (erroReservas) {
      // Falha ao ler pedidos não pode derrubar a tela de Estoque: sem reservas
      // as colunas saem em branco (null, não zero), e o saldo continua certo.
      reservas = null;
    }
  }
  // Duas coisas diferentes, de propósito:
  //   products     — o que se MOSTRA como mercadoria (sem escriturais).
  //   productsById — o que se RESOLVE por id, completo.
  // Filtrar o índice junto faria qualquer registro histórico que apontasse
  // para um escritural responder "produto não encontrado".
  const todos = await db.getProducts({ incluirEscriturais: true });
  return {
    data,
    reservas,
    products: todos.filter((p) => !p.escritural),
    productsById: new Map(todos.map((p) => [p.id, p]))
  };
}

function sendStockError(res, error, fallback) {
  return sendJson(res, { error: error && error.status ? error.message : fallback }, (error && error.status) || 400);
}

/**
 * GRAVA O RAZAO E O TOTAL DO PRODUTO NA MESMA TRANSACAO (fase AP).
 *
 * O QUE ISTO CONSERTA
 * -------------------
 * 1. Eram duas escritas em lugares diferentes, sem transacao nenhuma: o total
 *    do produto ia para o Postgres e os movimentos para o db.json. Processo
 *    morto entre as duas deixava o total mudado e o razao sem o registro —
 *    divergencia que nao da erro, so aparece na contagem fisica meses depois.
 *
 * 2. O total era read-modify-write: lia stock_quantity, somava no Node e
 *    gravava o ABSOLUTO. Entre a leitura (feita la atras, no loadStockContext)
 *    e a gravacao cabia outra requisicao inteira: as duas liam 100, as duas
 *    gravavam 105, e 5 unidades sumiam sem erro. Agora o `+ delta` e' do
 *    Postgres, que serializa o UPDATE da mesma linha.
 *
 * 3. `saveData(data)` reescrevia o db.json INTEIRO a cada movimentacao, e quem
 *    tivesse lido o arquivo antes sobrescrevia o que o outro acabara de gravar.
 *
 * A TRAVA POR PRODUTO fecha a janela entre VALIDAR o saldo e GRAVAR: sem ela,
 * duas saidas simultaneas do ultimo item passam as duas na validacao (que soma
 * o razao lido no comeco da requisicao) e o deposito termina negativo.
 *
 * O CODIGO (MOV-0001) sai daqui, da sequence do banco. Era max+1 calculado no
 * Node lendo a lista inteira: reusava codigo depois de um DELETE e, com duas
 * requisicoes ao mesmo tempo, gerava o mesmo numero duas vezes.
 */
async function commitStockMovements(data, movements, productsById, opcoes = {}) {
  // O GANCHO TAMBÉM É MOTIVO PARA ABRIR A TRANSAÇÃO (fase BH). Uma nota de
  // entrada em que nenhum item movimenta estoque ainda precisa marcar a ordem
  // de compra vinculada; sem esta condição a função saía na primeira linha e a
  // ordem ficava por marcar, em silêncio.
  if (!movements.length && !(opcoes.transferencias || []).length
    && typeof opcoes.tambemNaTransacao !== 'function') return;
  const transferencias = opcoes.transferencias || [];

  const deltaByProduct = new Map();
  movements.forEach((movement) => {
    const delta = stockCore.movementSignedQuantity(movement);
    deltaByProduct.set(movement.productId, (deltaByProduct.get(movement.productId) || 0) + delta);
  });

  await emTransacao(async (cliente) => {
    // Ordena os ids antes de travar: duas requisicoes que travem os mesmos dois
    // produtos em ordens opostas esperam uma pela outra para sempre. Ordem fixa
    // e' o que garante que uma delas sempre passa.
    for (const productId of [...deltaByProduct.keys()].sort()) {
      await razaoEstoque.travarProduto(cliente, productId);
    }
    for (const movimento of movements) {
      if (!movimento.code) movimento.code = await razaoEstoque.proximoCodigo(cliente, 'stock_movements_code_seq', 'MOV');
    }
    for (const transferencia of transferencias) {
      if (!transferencia.code) transferencia.code = await razaoEstoque.proximoCodigo(cliente, 'stock_transfers_code_seq', 'TRA');
    }
    await razaoEstoque.inserirMovimentos(cliente, movements);
    await razaoEstoque.inserirTransferencias(cliente, transferencias);
    for (const [productId, delta] of deltaByProduct.entries()) {
      if (delta === 0) continue;
      await razaoEstoque.somarNoTotalDoProduto(cliente, productId, delta);
    }
    // Gancho para quem precisa gravar MAIS COISA no mesmo instante do razão.
    // Quem usa hoje: o recebimento de uma ordem de compra, que marca o
    // documento como recebido. Fora daqui, a marca sobreviveria a um rollback
    // que desfez a entrada — a ordem diria "recebida" com o estoque intacto,
    // e essa é a divergência que ninguém confere porque as duas telas estão
    // certas separadamente.
    if (typeof opcoes.tambemNaTransacao === 'function') {
      await opcoes.tambemNaTransacao(cliente);
    }
  });

  // O `data` em memoria e' a foto que a resposta desta requisicao serializa.
  // Nao ha saveData: o razao nao mora mais no arquivo.
  if (!opcoes.jaEmMemoria) {
    movements.forEach((movement) => data.stockMovements.push(movement));
    transferencias.forEach((t) => data.stockTransfers.push(t));
  }
}

/**
 * Descarrega no banco os movimentos que Vendas/Compras/PCP empilharam.
 *
 * registrarMovimentoEstoque continua sendo SINCRONO e continua so empilhando —
 * mudar isso obrigaria a tornar assincrona meia duzia de funcoes que hoje nao
 * sao. O que muda e' o destino da pilha: antes era o `saveData` no fim da rota,
 * agora e' este descarregamento, que grava tudo numa transacao so.
 *
 * Chamado no fim de quem TOMA a decisao de mexer no estoque (a transicao de
 * status do pedido, o consumo de producao, a compra), e nao em cada rota: e' la
 * que se sabe que a operacao terminou.
 */
async function descarregarMovimentosPendentes(data, productsById) {
  const pendentes = data.__movimentosPendentes || [];
  if (!pendentes.length) return;
  data.__movimentosPendentes = [];
  // jaEmMemoria: o registrarMovimentoEstoque ja empurrou para data.stockMovements
  // para que qualquer leitura no meio da requisicao enxergue o movimento, como
  // era antes. Empurrar de novo aqui duplicaria a linha na resposta.
  await commitStockMovements(data, pendentes, productsById, { jaEmMemoria: true });
}

function buildMovementRecord(data, { type, productId, depositId, quantity, unitCost, categoryId, date, document, note, transferId, origin, classId, classValueId, referenceType, referenceId }, user) {
  return {
    id: stockCore.createId('mov'),
    // Vazio de proposito: quem numera e' a sequence do banco, dentro da
    // transacao do commitStockMovements. Ver o bloco la.
    code: '',
    type,
    date: date || stockCore.todayStr(),
    productId,
    depositId,
    // A COR VIVE NO MOVIMENTO, e é daqui que sai o saldo por cor. Guardar o
    // saldo numa tabela à parte criaria um segundo número, atualizado por
    // outro caminho e livre para discordar deste razão.
    classId: classId || '',
    classValueId: classValueId || '',
    quantity: stockCore.toNumber(quantity),
    unitCost: stockCore.toNumber(unitCost),
    categoryId: categoryId || '',
    document: document || '',
    note: note || '',
    transferId: transferId || '',
    origin: origin || 'manual',
    // De onde este movimento veio, por id e nao so por texto. As colunas ja
    // existiam (a fase AP as criou) e o outro construtor ja as gravava; este
    // aqui as descartava calado, entao a entrada de uma ordem de compra chegava
    // ao razao sem dizer de que ordem era. Rastrear virava leitura do campo
    // `document`, que e frase, nao chave.
    referenceType: referenceType || '',
    referenceId: referenceId || '',
    createdBy: user.id,
    createdByName: user.name,
    createdAt: new Date().toISOString()
  };
}

// Valida produto/depósito/quantidade e, na saída, o saldo do depósito.
function assertMovementIsPossible(data, productsById, { productId, depositId, type, quantity, classValueId, classesDoProduto }) {
  const product = productsById.get(productId);
  if (!product) throw stockCore.stockError('Produto não encontrado.', 404);
  const deposit = (data.deposits || []).find((d) => d.id === depositId);
  if (!deposit) throw stockCore.stockError('Depósito não encontrado.', 404);
  const qty = stockCore.toNumber(quantity);
  if (!(qty > 0)) throw stockCore.stockError('Informe uma quantidade maior que zero.');

  // ---- classe (cor) ------------------------------------------------------
  const classes = Array.isArray(classesDoProduto) ? classesDoProduto : [];
  const obrigatoria = classes.find((c) => c.required);
  if (obrigatoria && !classValueId) {
    throw stockCore.stockError(
      `Este produto é controlado por ${obrigatoria.name}. Informe qual ${String(obrigatoria.name).toLowerCase()} está sendo movimentada.`
    );
  }
  if (classValueId) {
    // O valor tem de ser um dos que ESTE produto oferece. Sem esta checagem,
    // um id qualquer criaria um saldo de cor que o produto não tem — e o
    // total continuaria fechando, escondendo o erro.
    const permitido = classes.some((c) => c.valores.some((v) => v.id === classValueId));
    if (!permitido) {
      throw stockCore.stockError('Este valor de classe não está disponível para o produto.');
    }
  }

  if (type === 'saida') {
    // Com cor, o saldo que limita é o DAQUELA cor. Validar só o total deixaria
    // vender 10 pretos existindo 2 pretos e 8 brancos — o total fecharia e o
    // saldo do preto ficaria negativo (§21.3 e §21.4).
    if (classValueId) {
      const disponivel = stockCore.classValueBalance(data, productId, classValueId, depositId);
      if (qty > disponivel) {
        const nome = classes.flatMap((c) => c.valores).find((v) => v.id === classValueId)?.name || 'valor';
        throw stockCore.stockError(`Saldo insuficiente de ${nome} em ${deposit.name}: disponível ${disponivel}, solicitado ${qty}.`);
      }
    } else {
      const available = stockCore.depositBalance(data, productId, depositId);
      if (qty > available) {
        throw stockCore.stockError(`Saldo insuficiente em ${deposit.name}: disponível ${available}, solicitado ${qty}.`);
      }
    }
  }
  return { product, deposit, quantity: qty };
}

function filterStockMovements(data, params, productsById) {
  const search = String(params.get('search') || '').trim().toLowerCase();
  const type = params.get('type') || '';
  const productId = params.get('productId') || '';
  const depositId = params.get('depositId') || '';
  const categoryId = params.get('categoryId') || '';
  // §19: "quanto vendi de preto no mês" é uma pergunta que se responde com o
  // razão filtrado, não com um relatório novo. `_sem` isola o saldo que ficou
  // sem cor — sem isso não há como listar o que precisa ser classificado.
  const classValueId = params.get('classValueId') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';

  return (data.stockMovements || []).filter((movement) => {
    if (type && movement.type !== type) return false;
    if (productId && movement.productId !== productId) return false;
    if (depositId && movement.depositId !== depositId) return false;
    if (categoryId && movement.categoryId !== categoryId) return false;
    if (classValueId === '_sem' && movement.classValueId) return false;
    if (classValueId && classValueId !== '_sem' && movement.classValueId !== classValueId) return false;
    if (dateFrom && movement.date < dateFrom) return false;
    if (dateTo && movement.date > dateTo) return false;
    if (search) {
      const product = productsById.get(movement.productId);
      const haystack = [
        movement.code, movement.document, movement.note,
        product ? product.name : '', product ? product.sku : ''
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

// ============================================================================
// ENTRADA DE NF-e — a nota que o FORNECEDOR emitiu contra nós.
//
// TRÊS PASSOS, E O SEGUNDO É DE UMA PESSOA
// ----------------------------------------
//   analisar  ->  lê o XML e diz o que dele já existe aqui. NÃO GRAVA NADA.
//   (pessoa)  ->  cadastra o fornecedor que faltava, vincula os itens.
//   lançar    ->  grava a entrada, o estoque e o contas a pagar.
//
// Analisar não grava de propósito. Arrastar um XML para a tela é "deixa eu ver
// o que tem aqui", não "lança isso" — e um fornecedor criado por engano, ou uma
// entrada em duplicidade, é bem mais difícil de desfazer do que de evitar.
//
// O SERVIDOR RELÊ O XML NO LANÇAMENTO
// -----------------------------------
// A rota de lançar recebe o XML de novo e o processa outra vez, do zero. Ela
// NÃO aceita os valores que a tela leu. Se aceitasse, o navegador poderia
// mandar uma nota de R$ 600 com total de R$ 60.000 e o sistema gravaria os dois
// números que ele quisesse. O que a tela manda são DECISÕES (qual produto é
// cada item, o que movimenta estoque) — nunca os fatos da nota.
//
// CADASTRO DE FORNECEDOR E DE PRODUTO NÃO ESTÃO AQUI
// --------------------------------------------------
// A tela posta na rota que já existe (/api/cadastros/cnpjs, /api/cadastros/
// pessoas, /api/stock/products). Um segundo caminho de criação significaria uma
// segunda validação de CNPJ, uma segunda checagem de duplicidade e uma segunda
// permissão para manter em dia — e a que ficasse para trás seria a porta aberta.
// Efeito colateral bem-vindo: quem só tem Compras consegue LANÇAR a entrada,
// mas cadastrar o fornecedor continua exigindo Cadastros, como sempre exigiu.
// ============================================================================

// Sem a migração, `nfe_entrada` não existe e o erro do PostgREST não diz a
// ninguém o que fazer. Pior: a checagem de duplicidade mora nessa tabela, então
// engolir o erro deixaria a mesma nota entrar duas vezes em silêncio.
function traduzirErroDaEntrada(error) {
  const texto = String((error && error.message) || '');
  if (/nfe_entrada/.test(texto) && /(does not exist|schema cache|Could not find the table)/i.test(texto)) {
    const err = new Error('As tabelas da Entrada de NF-e ainda não existem no banco. Rode banco/migrations/fase-ak-entrada-de-nfe.sql no SQL Editor do Supabase.');
    err.status = 503;
    return err;
  }
  return error;
}

async function conferirEntradaDeNfe(xml) {
  const nota = entradaNfe.lerNotaDeEntrada(xml);
  const data = loadData();
  // O razão vem junto porque quem chama grava a entrada com este mesmo
  // `data`, e assertMovementIsPossible confere saldo por cor em cima dele.
  await Promise.all([syncCadastroData(data), sincronizarRazao(data)]);

  const produtos = await db.getProducts();
  const vinculosAnteriores = await entradaNfeDb.vinculosDoFornecedor(nota.emitente.documento);
  const entradaExistente = await entradaNfeDb.buscarPorChave(nota.chave);
  // Estabelecimento é opcional no sistema: sem nenhum cadastrado, as checagens
  // de "esta nota é minha?" simplesmente não rodam, em vez de acusar toda nota.
  let estabelecimentos = [];
  try {
    estabelecimentos = await fiscalDb.getEstabelecimentos();
  } catch (erroEstab) {
    estabelecimentos = [];
  }

  const conferencia = entradaNfe.montarConferencia({
    nota,
    diretorio: getCadastroDirectory(data),
    produtos,
    vinculosAnteriores,
    documentosProprios: estabelecimentos.map((e) => e.cnpj),
    entradaExistente
  });

  return { conferencia, data, produtos };
}

/**
 * Junta o que a NOTA diz com o que a TELA decidiu.
 *
 * A lista percorrida é a da nota, nunca a do corpo da requisição: item que a
 * tela não mencionou fica com o vínculo sugerido e sem movimentar estoque, em
 * vez de sumir do lançamento.
 */
function decisoesDosItens(conferencia, body) {
  const enviados = new Map(
    (Array.isArray(body.itens) ? body.itens : []).map((i) => [Number(i.numero), i])
  );
  return conferencia.itens.map((item) => {
    const escolha = enviados.get(item.numero) || {};
    const sugerido = item.vinculo ? item.vinculo.produtoId : '';
    const escolheu = Object.prototype.hasOwnProperty.call(escolha, 'produtoId');
    const produtoId = escolheu ? String(escolha.produtoId || '') : sugerido;
    return {
      item,
      produtoId,
      // Vínculo escolhido na tela é 'manual' — e é ele que alimenta o de-para
      // da próxima nota deste fornecedor. Sugestão aceita mantém a origem
      // original (gtin/codigo/descricao), que diz o quanto se pode confiar.
      vinculoOrigem: produtoId ? (produtoId === sugerido && item.vinculo ? item.vinculo.por : 'manual') : '',
      movimentarEstoque: Boolean(produtoId) && escolha.movimentarEstoque !== false && body.movimentarEstoque !== false,
      depositoId: String(escolha.depositoId || body.depositoId || '')
    };
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // Sessão encerrada — por login em outra máquina ou pela virada do dia. Vem
  // ANTES de qualquer rota: o token está morto, então nada adiante vai
  // funcionar mesmo, e responder aqui garante a MESMA explicação em todas as
  // telas. Se cada rota tratasse por conta própria, uma delas esqueceria e
  // mostraria "Erro inesperado".
  const tokenRecebido = req.headers['x-auth-token'];
  // Vence agora, se for o caso, para cair no `if` de baixo já com o motivo.
  if (tokenRecebido) derrubarSeExpirou(tokenRecebido);
  if (tokenRecebido && !sessions[tokenRecebido] && sessoesEncerradas.has(tokenRecebido)) {
    const { motivo } = sessoesEncerradas.get(tokenRecebido);
    return sendJson(res, { error: sessaoUtil.mensagemDoMotivo(motivo), motivo }, 401);
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const user = await db.authenticateUser(body.username, body.password);

      if (!user) {
        // Senha errada não diz se o usuário existe — só o login inteiro falha.
        await db.rbac.registrarAcesso({
          action: 'login', resourceType: 'sessao', result: 'NEGADO', ip: ipDaRequisicao(req),
          detail: { motivo: 'credenciais inválidas', usuarioInformado: String(body.username || '').slice(0, 80) }
        });
        return sendJson(res, { error: 'Credenciais inválidas' }, 401);
      }

      if (user.active === false) {
        await db.rbac.registrarAcesso({
          userId: user.id, userName: user.name, action: 'login', resourceType: 'sessao',
          result: 'NEGADO', ip: ipDaRequisicao(req), detail: { motivo: 'usuário bloqueado' }
        });
        return sendJson(res, { error: 'Usuário bloqueado. Procure um administrador.' }, 403);
      }

      const token = createId('token');
      // Derruba ANTES de registrar a nova: se a ordem fosse inversa, a sessão
      // que acabou de nascer entraria na varredura e se derrubaria sozinha.
      const derrubadas = encerrarSessoesDoUsuario(user.id, 'outro-dispositivo', token);
      const agora = new Date();
      sessions[token] = {
        userId: user.id,
        criadaEm: agora.getTime(),
        // Vale até a virada do dia, sempre — mesmo que faltem minutos.
        expiraEm: sessaoUtil.proximaViradaDeDia(agora)
      };

      await db.registrarLogin(user.id);
      await db.rbac.registrarAcesso({
        userId: user.id, userName: user.name, action: 'login', resourceType: 'sessao',
        result: 'PERMITIDO', ip: ipDaRequisicao(req),
        // Fica na auditoria: sessão derrubada é o rastro de alguém entrando com
        // a conta de outro, e sem registro ninguém consegue investigar depois.
        detail: derrubadas ? { sessoesDerrubadas: derrubadas } : undefined
      });
      const acesso = await db.rbac.carregarAcessoDoUsuario(user.id);
      // `sessaoExpiraEm` é o relógio do SERVIDOR. A tela agenda a própria saída
      // por ele, e não pela meia-noite do computador do usuário — máquina com
      // hora errada sairia cedo demais ou continuaria aberta depois do corte.
      return sendJson(res, {
        token,
        sessaoExpiraEm: sessions[token].expiraEm,
        user: serializeUserForClient(user, acesso)
      });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao autenticar' }, 400);
    }
  }

  // ---------------------------------------------------------------------
  // Portão de acesso. Fica ANTES de todas as rotas de API (menos login) para
  // que nenhuma rota nova nasça sem verificação — era exatamente esse o furo
  // do modelo anterior, em que cada rota lembrava (ou não) de checar sozinha.
  // ---------------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    const { permitido, permissao, usuario } = await verificarAcesso(req, pathname);
    if (permissao && deveRegistrar(req.method, permitido)) {
      await db.rbac.registrarAcesso({
        userId: usuario?.id,
        userName: usuario?.name,
        action: permissao,
        resourceType: permissao.split('.')[0],
        result: permitido ? 'PERMITIDO' : 'NEGADO',
        ip: ipDaRequisicao(req),
        detail: { metodo: req.method, rota: pathname }
      });
    }
    if (!permitido) {
      return sendJson(res, {
        error: usuario ? `Sem permissão para "${permissao}".` : 'Não autenticado'
      }, usuario ? 403 : 401);
    }
  }

  if (pathname === '/api/me') {
    const user = await getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    // Recarregar a página (F5) passa por aqui, não pelo login — sem devolver o
    // vencimento a tela reaberta ficaria sem o agendamento da saída.
    return sendJson(res, {
      sessaoExpiraEm: sessions[req.headers['x-auth-token']]?.expiraEm || null,
      user: serializeUserForClient(user, await db.rbac.carregarAcessoDoUsuario(user.id))
    });
  }

  if (pathname === '/api/me/theme' && req.method === 'PUT') {
    try {
      const user = await getCurrentUser(req);
      if (!user) {
        return sendJson(res, { error: 'Não autenticado' }, 401);
      }
      const body = await readBody(req);
      const theme = body.theme === 'dark' ? 'dark' : 'light';
      await db.updateUserTheme(user.id, theme);
      return sendJson(res, { success: true, theme });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar preferência de tema' }, 400);
    }
  }

  if (pathname === '/api/me/dashboard-pins') {
    try {
      const user = await getCurrentUser(req);
      if (!user) {
        return sendJson(res, { error: 'Não autenticado' }, 401);
      }

      if (req.method === 'GET') {
        return sendJson(res, { dashboardPins: normalizeDashboardPins(user.dashboardPins) });
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const dashboardPins = normalizeDashboardPins(body.dashboardPins);
        await db.updateUserDashboardPins(user.id, dashboardPins);
        return sendJson(res, { success: true, dashboardPins });
      }

      return sendJson(res, { error: 'Método não permitido' }, 405);
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar favoritos do dashboard' }, 400);
    }
  }

  // PREFERENCIAS DE TELA por usuario (fase-ag).
  //
  // Uma rota generica, e nao uma por tela: a proxima lista que precisar lembrar
  // de algo entra sem rota nova. O corpo e { tela, valor } e cada tela decide o
  // formato do proprio valor.
  //
  // Grava preservando as outras telas — o lib/db/auth faz o merge. Mandar o
  // objeto inteiro do cliente deixaria uma tela apagar a preferencia de outra.
  if (pathname === '/api/preferencias') {
    try {
      const user = await getCurrentUser(req);
      if (!user) return sendJson(res, { error: 'Não autenticado' }, 401);

      if (req.method === 'GET') {
        return sendJson(res, { preferences: user.preferences || {} });
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const tela = String(body.tela || '').trim();
        if (!tela || !/^[a-z_0-9.]{1,40}$/i.test(tela)) {
          return sendJson(res, { error: 'Informe a tela da preferência.' }, 400);
        }
        // Só objeto: string ou array solto aqui viraria formato imprevisível
        // para quem lê depois.
        if (!body.valor || typeof body.valor !== 'object' || Array.isArray(body.valor)) {
          return sendJson(res, { error: 'A preferência precisa ser um objeto.' }, 400);
        }
        const preferences = await db.updateUserPreference(user.id, tela, body.valor);
        // null = coluna ainda não existe (fase-ag não rodada). A tela segue no
        // padrão em vez de mostrar erro por algo que não impede trabalhar.
        return sendJson(res, { success: true, preferences: preferences || {}, gravado: preferences !== null });
      }

      return sendJson(res, { error: 'Método não permitido' }, 405);
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar a preferência' }, 400);
    }
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = req.headers['x-auth-token'];
    if (token && sessions[token]) {
      delete sessions[token];
    }
    return sendJson(res, { success: true });
  }

  if (pathname === '/api/dashboard') {
    const data = loadData();
    // sincronizarRazao entra na mesma onda: o painel mostra saldo por
    // depósito, e sem o razão em memória todo depósito aparecia zerado.
    await Promise.all([syncNfeData(data), syncCadastroData(data), sincronizarRazao(data)]);
    const user = await getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }

    const canSales = user.allowedModules.includes('sales');
    const canPurchases = user.allowedModules.includes('purchases');
    const canStock = user.allowedModules.includes('stock');
    const canFinance = user.allowedModules.includes('finance');

    // As coleções legadas data.sales/data.purchases do db.json não recebem mais
    // escrita: vendas viraram orders/quotes e compras viraram purchases, ambas no
    // Supabase. Sem estes syncs o painel somava arrays sempre vazios e exibia R$ 0.
    // Uma ida so' ao banco. Eram tres syncs em fila mais a consulta de
    // produtos -- quatro viagens de ~260ms cada (medido) para buscar colecoes
    // que nao dependem umas das outras. O `if` na frente escondia o custo.
    const [products] = await Promise.all([
      canStock ? db.getProducts() : Promise.resolve([]),
      canSales ? syncSalesData(data) : null,
      canPurchases ? syncPurchasesData(data) : null,
      syncFinanceData(data)
    ]);

    // Reaproveita o mesmo cálculo do Painel de Vendas para que os dois batam —
    // inclusive no recorte. Sem o escopo aqui, o cartão de vendas do Dashboard
    // Geral mostraria o faturamento da empresa inteira para um vendedor que,
    // duas telas adiante, só consegue ver os próprios pedidos: os dois números
    // discordariam, e o maior deles seria o que ele não deveria ver.
    const salesSummary = canSales
      ? buildSalesDashboardSummary(data, escopoLib.escopoDeVendas(user, { ehAdmin: await ehAdmin(user) })).overview
      : null;
    const salesTotal = salesSummary ? salesSummary.valorPedidos : 0;

    // Compra cancelada não é custo — o Histórico de Compras usa o mesmo critério.
    const activePurchases = canPurchases
      ? (data.purchases || []).filter((purchase) => purchase.status !== 'cancelada')
      : [];
    const purchaseTotal = activePurchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
    const stockValue = canStock ? products.reduce((sum, product) => sum + Number(product.stockQuantity || 0) * Number(product.costPrice || 0), 0) : 0;

    // O fluxo novo de Vendas não gera lançamento financeiro por pedido, então medir
    // "a conciliar" a partir dos próprios lançamentos de venda em aberto.
    const pendingReconciliation = (canSales && canFinance)
      ? (data.finance || []).filter((entry) => entry.type === 'sale' && entry.status !== 'paid' && !isFinanceEntryCancelled(entry)).length
      : 0;

    // Cartões do topo do hub. Cada um traz o valor, a variação contra o
    // MESMO intervalo anterior e a proporção que merece alarme — número
    // sozinho não vira decisão.
    const intervalo = getPeriodRange(url.searchParams.get('period') || 'month',
      url.searchParams.get('from'), url.searchParams.get('to'));
    const entradasClassificadas = (data.finance || [])
      .filter((e) => !isFinanceEntryCancelled(e))
      .map((e) => ({ ...e, tipo: classifyFinanceEntry(e) }));
    const kpiCards = kpis.montarKpis({
      pedidos: data.orders || [],
      compras: activePurchases,
      entradas: entradasClassificadas,
      // serializeProduct traz `situation` (abaixo-minimo/zerado), que é o que
      // alimenta a faixa de alerta do cartão de Estoque.
      produtos: canStock ? products.map((p) => stockCore.serializeProduct(p, data)) : [],
      depositos: data.deposits || [],
      intervalo,
      serieVendas: canSales ? buildSalesChartSeries(data, 'month') : [],
      permissoes: { sales: canSales, finance: canFinance, stock: canStock, purchases: canPurchases },
      hoje: toDateStr(getTodayLocal())
    });

    return sendJson(res, {
      salesTotal,
      purchaseTotal,
      stockValue,
      balance: salesTotal - purchaseTotal,
      pendingReconciliation,
      totalProducts: canStock ? products.length : 0,
      totalSales: salesSummary ? salesSummary.totalPedidos : 0,
      totalPurchases: activePurchases.length,
      kpis: kpiCards,
      periodo: intervalo,
      permissions: {
        sales: canSales,
        purchases: canPurchases,
        stock: canStock,
        finance: canFinance
      }
    });
  }

  // Gráficos do Dashboard Geral (fluxo de Vendas + fluxo do Financeiro), no mesmo
  // recorte de período — reaproveita os construtores de série já usados pelos
  // dashboards de cada módulo, só filtrados pelo que o usuário tem permissão de ver.
  // Painel "Atenção" do hub. Rota própria, e não um campo de /api/dashboard,
  // porque ela varre quatro fontes e é a parte cara da tela: assim o painel
  // carrega depois, sem segurar os KPIs e os gráficos.
  if (pathname === '/api/dashboard/atencao' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!user) return sendJson(res, { error: 'Não autenticado' }, 401);

      const permissoes = {
        finance: user.allowedModules.includes('finance'),
        fiscal: user.allowedModules.includes('fiscal'),
        sales: user.allowedModules.includes('sales'),
        stock: user.allowedModules.includes('stock')
      };

      const data = loadData();
      // Uma ida so': os syncs escrevem em chaves distintas de `data` e
      // nenhum le o do outro, entao esperar um pelo outro era so' latencia.
      await Promise.all([
        syncCadastroData(data),
        permissoes.finance ? syncFinanceData(data) : null,
        permissoes.sales ? syncSalesData(data) : null,
        // O aviso de estoque baixo compara saldo por depósito; sem o razão
        // em memória todo produto parecia zerado e o painel ou gritava por
        // tudo ou por nada, dependendo do limite cadastrado.
        permissoes.stock ? sincronizarRazao(data) : null
      ]);

      // A tabela fiscal pode não responder (migração pendente, estabelecimento
      // ainda não cadastrado). O painel degrada para as outras fontes em vez
      // de a tela não abrir — um alerta a menos é melhor do que nenhum.
      let notasFiscais = [];
      if (permissoes.fiscal) {
        try {
          notasFiscais = await fiscalDb.getNfeRecords();
        } catch (erroFiscal) {
          notasFiscais = [];
        }
      }

      const produtos = permissoes.stock
        ? (await db.getProducts()).map((p) => stockCore.serializeProduct(p, data))
        : [];

      // Quais status significam "a venda se concretizou". Vem do catálogo, não
      // de uma lista escrita aqui: um status novo que gere financeiro entra
      // sozinho no alerta.
      const statusQueFaturam = salesStatus.CATALOGO
        .filter((s) => s.geraFinanceiro)
        .map((s) => s.value);

      const painel = atencao.montarAtencao({
        entradas: data.finance || [],
        notasFiscais,
        // `data.orders`, e NÃO `data.sales`.
        //
        // O painel varria a coleção LEGADA, que não recebe escrita desde que as
        // vendas viraram orders/quotes — está sempre vazia. O alerta "pedidos
        // faturados sem NF-e" existia, tinha teste e nunca disparou: com os
        // dados reais deste banco eram 8 pedidos e R$ 26.033,80 sem documento
        // fiscal, invisíveis.
        //
        // É o defeito mais difícil de achar: o código está certo, o teste passa,
        // e a ligação é que aponta para o lugar errado. O syncSalesData logo
        // acima já enche `data.orders` nesta mesma rota.
        pedidos: data.orders || [],
        produtos,
        statusQueFaturam,
        permissoes
      });
      return sendJson(res, painel);
    } catch (error) {
      return sendJson(res, { error: 'Erro ao montar o painel de atenção' }, 500);
    }
  }

  if (pathname === '/api/dashboard/charts' && req.method === 'GET') {
    const data = loadData();
    await syncFinanceData(data);
    const user = await getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    const granularity = url.searchParams.get('granularity') || 'month';
    const canSales = user.allowedModules.includes('sales');
    const canFinance = user.allowedModules.includes('finance');
    if (canSales) await syncSalesData(data);

    const salesChartSeries = canSales ? buildSalesChartSeries(data, granularity) : [];
    const financeEntries = canFinance ? (data.finance || []).filter((entry) => !isFinanceEntryCancelled(entry)) : [];
    const financeChartSeries = canFinance ? buildFinanceChartSeries(financeEntries, granularity) : [];

    return sendJson(res, {
      granularity,
      salesChartSeries,
      financeChartSeries,
      permissions: { sales: canSales, finance: canFinance }
    });
  }

  // ==========================================================================
  // CRM — ponte para o CRM externo.
  //
  // Este módulo NÃO guarda oportunidade nem conta: por decisão de projeto quem
  // guarda isso é o outro sistema, e duplicar aqui criaria duas fontes da
  // verdade divergindo. O que mora no banco é só a CONEXÃO (uma linha).
  //
  // O token NUNCA volta para a tela: a resposta diz se existe um token salvo,
  // não qual é. Enviar o segredo de volta a cada carregamento o deixaria no
  // histórico do navegador e em qualquer log de rede pelo caminho.
  // ==========================================================================
  if (pathname === '/api/crm/connection') {
    try {
      if (req.method === 'GET') return sendJson(res, { connection: await crmDb.getConexao() });
      if (req.method === 'PUT') return sendJson(res, { connection: await crmDb.salvarConexao(await readBody(req)) });
      return sendJson(res, { error: 'Método não suportado' }, 405);
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro na conexão do CRM' }, 400);
    }
  }

  if (pathname === '/api/crm/test' && req.method === 'POST') {
    return sendJson(res, await crmDb.testarConexao());
  }

  // ==========================================================================
  // Frota, RH, PCP e Contratos — CRUD dos 11 recursos numa rota só.
  //
  //   GET    /api/<modulo>/<recurso>        lista
  //   GET    /api/<modulo>/<recurso>/:id    um registro
  //   POST   /api/<modulo>/<recurso>        cria
  //   PUT    /api/<modulo>/<recurso>/:id    edita
  //   DELETE /api/<modulo>/<recurso>/:id    exclui
  //
  // Permissão: o portão central (verificarAcesso, lá em cima) já traduziu o
  // caminho para fleet.criar, hr.editar e assim por diante antes de chegar
  // aqui — por isso este bloco não repete a checagem.
  //
  // O 404 quando o recurso não existe é deliberado: assim uma rota digitada
  // errado falha na hora, em vez de cair silenciosamente no `next` e devolver
  // a página inicial.
  // ==========================================================================
  //
  // A única regra de negócio deste bloco é o recálculo do produzido da ordem
  // de produção (recalcularProduzidoDaOrdem, definida acima) — e ela fica aqui,
  // na rota, e não no lib/db/modulos.js, que é só tradução camelCase/snake_case.
  // Contrato -> parcelas no Financeiro.
  //
  // ANTES do bloco genérico pelo mesmo motivo da rota de produção: o regex
  // leria "billing" como um recurso e devolveria 404.
  if (pathname === '/api/contracts/billing' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      // A permissão de contratos já passou no portão central, mas quem cria
      // lançamento é o Financeiro — e quem não tem o módulo não pode escrever
      // lá por uma porta lateral.
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Gerar o financeiro do contrato exige acesso ao módulo Financeiro.' }, 403);
      }
      const body = await readBody(req);
      const contrato = await modulosDb.obter('contracts/contracts', body.contractId);
      if (!contrato) return sendJson(res, { error: 'Contrato não encontrado' }, 404);
      if (contrato.status === 'encerrado' || contrato.status === 'rascunho') {
        return sendJson(res, { error: `Contrato ${contrato.status} não gera financeiro.` }, 400);
      }

      const periodos = Math.min(60, Math.max(1, Number(body.periodos || 12)));
      const linhas = parcelasDoContrato(contrato, { periodos });
      if (!linhas.length) {
        return sendJson(res, { error: 'O contrato precisa de valor maior que zero e data de início para gerar parcelas.' }, 400);
      }

      const dados = loadData();
      await syncFinanceData(dados);
      // Canceladas não contam como existentes: quem cancelou uma parcela e
      // mandou gerar de novo quer a parcela de volta.
      const jaExistem = new Set((dados.finance || [])
        .filter((e) => e.referenceId === contrato.id && e.status !== 'cancelado')
        .map((e) => String(e.dueDate || '').slice(0, 10)));

      const tipo = contrato.partyKind === 'fornecedor' ? 'DESPESA' : 'RECEITA';
      const criadas = [];
      for (const linha of linhas) {
        if (jaExistem.has(linha.dueDate)) continue;
        const entry = await db.createFinancialEntry({
          type: tipo,
          date: String(contrato.startDate).slice(0, 10),
          dueDate: linha.dueDate,
          amount: linha.amount,
          description: linha.description,
          document: String(contrato.code || ''),
          clientSupplierId: contrato.partyId || '',
          clientSupplierName: contrato.partyName || '',
          // É por aqui que a próxima geração sabe o que já existe.
          referenceId: contrato.id,
          status: 'pending',
          createdBy: user.id,
          createdByName: user.name
        });
        dados.finance.push(entry);
        criadas.push(entry);
      }
      saveData(dados);

      await db.rbac.registrarAcesso({
        userId: user.id, userName: user.name, action: 'contracts.criar', resourceType: 'contracts',
        result: 'PERMITIDO', ip: ipDaRequisicao(req),
        detail: { contrato: contrato.code || contrato.id, tipo, parcelasCriadas: criadas.length }
      });
      return sendJson(res, {
        success: true, tipo, criadas: criadas.length,
        jaExistiam: linhas.length - criadas.length,
        previstas: linhas.length
      });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao gerar o financeiro do contrato' }, erro.status || 400);
    }
  }

  // Pedido de venda -> ordens de produção.
  //
  // Fica ANTES do bloco genérico de propósito: o regex abaixo leria
  // "orders/from-sale" como o recurso "orders" com id "from-sale" e devolveria
  // 405. E fica sob /api/pcp/ para a permissão exigida ser pcp.criar — quem
  // abre ordem de produção é o PCP, mesmo que o gatilho venha de Vendas.
  //
  // Uma OP por ITEM do pedido, e só para item que TEM ficha técnica: produto
  // revendido não se fabrica, e abrir ordem para ele encheria o chão de
  // fábrica de ordens que ninguém vai produzir.
  if (pathname === '/api/pcp/orders/from-sale' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      const body = await readBody(req);
      const dados = loadData();
      await syncSalesData(dados);
      await syncNfeData(dados);
      const pedido = [...(dados.orders || []), ...(dados.quotes || [])].find((r) => r.id === body.recordId);
      if (!pedido) return sendJson(res, { error: 'Pedido não encontrado' }, 404);
      if (pedido.type !== 'order') {
        return sendJson(res, { error: 'Só pedido gera ordem de produção — aprove o orçamento primeiro.' }, 400);
      }

      const fichas = await modulosDb.listar('pcp/bom');
      const temFicha = new Set(fichas.map((linha) => linha.productId));
      const existentes = (await modulosDb.listar('pcp/orders')).filter((o) => o.orderId === pedido.id);

      const criadas = [];
      const ignorados = [];
      for (const item of (pedido.items || [])) {
        if (!item.productId || !temFicha.has(item.productId)) {
          ignorados.push(item.name || item.productId || 'item sem produto');
          continue;
        }
        // Não duplica: chamar duas vezes não pode abrir a mesma OP de novo.
        if (existentes.some((o) => o.productId === item.productId)) continue;
        criadas.push(await modulosDb.criar('pcp/orders', {
          productId: item.productId,
          quantity: Number(item.quantity || 0),
          status: 'aberta',
          dueDate: pedido.dueDate || null,
          orderId: pedido.id,
          notes: `Gerada do pedido ${pedido.code || pedido.id} — ${pedido.clientSupplierName || ''}`.trim()
        }));
      }

      await db.rbac.registrarAcesso({
        userId: user?.id, userName: user?.name, action: 'pcp.criar', resourceType: 'pcp',
        result: 'PERMITIDO', ip: ipDaRequisicao(req),
        detail: { origem: 'pedido', pedido: pedido.code || pedido.id, ordensCriadas: criadas.length }
      });
      return sendJson(res, { success: true, criadas, ignorados, jaExistiam: existentes.length });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao gerar ordens de produção' }, erro.status || 400);
    }
  }

  // ==========================================================================
  // PAINÉIS POR MÓDULO — /api/<modulo>/dashboard
  //
  // ANTES do bloco genérico logo abaixo: o regex dele leria "dashboard" como
  // nome de recurso e responderia 404.
  //
  // Uma rota por módulo em vez de uma só com parâmetro: cada painel lê tabelas
  // diferentes, e uma rota genérica teria de carregar tudo para todo mundo —
  // quem abre o painel de Contratos pagaria a leitura da frota inteira.
  //
  // A CONTA não está aqui: fica em lib/painel-modulos.js, em funções puras que
  // o teste prova com quatro linhas de dado em vez de um banco. Aqui só se lê
  // do banco e se entrega o resultado.
  // ==========================================================================
  const rotaPainel = pathname.match(/^\/api\/(purchases|stock|fiscal|fleet|hr|pcp|contracts)\/dashboard$/);
  if (rotaPainel && req.method === 'GET') {
    const modulo = rotaPainel[1];
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes(modulo)) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const hoje = stockCore.todayStr();
      const intervalo = painelModulos.intervaloDoPeriodo(url.searchParams.get('periodo') || 'mes', hoje);

      if (modulo === 'purchases') {
        return sendJson(res, {
          intervalo,
          ...painelModulos.painelCompras({ compras: await db.getPurchases(), intervalo })
        });
      }

      if (modulo === 'stock') {
        const { data, products, reservas } = await loadStockContext({ comReservas: true });
        return sendJson(res, {
          intervalo,
          ...painelModulos.painelEstoque({
            produtos: products.map((p) => stockCore.serializeProduct(p, data, reservas)),
            movimentos: data.stockMovements || [],
            depositos: data.deposits || [],
            reservas,
            intervalo
          })
        });
      }

      if (modulo === 'fiscal') {
        return sendJson(res, {
          intervalo,
          // db.getNfes() e não fiscalDb: é a mesma lista que a tela "NF-e
          // Emitidas" mostra, então painel e listagem nunca discordam.
          ...painelModulos.painelFiscal({ notas: await db.getNfes(), intervalo })
        });
      }

      if (modulo === 'fleet') {
        const [veiculos, manutencoes, abastecimentos] = await Promise.all([
          modulosDb.listar('fleet/vehicles'),
          modulosDb.listar('fleet/maintenances'),
          modulosDb.listar('fleet/refuels')
        ]);
        return sendJson(res, { intervalo, ...painelModulos.painelFrota({ veiculos, manutencoes, abastecimentos, intervalo }) });
      }

      if (modulo === 'hr') {
        const [colaboradores, afastamentos, departamentos] = await Promise.all([
          modulosDb.listar('hr/employees'),
          modulosDb.listar('hr/leaves'),
          modulosDb.listar('hr/departments')
        ]);
        return sendJson(res, { intervalo, ...painelModulos.painelRh({ colaboradores, afastamentos, departamentos, intervalo, hoje }) });
      }

      if (modulo === 'pcp') {
        const [ordens, apontamentos, setores, inspecoes] = await Promise.all([
          modulosDb.listar('pcp/orders'),
          modulosDb.listar('pcp/entries'),
          modulosDb.listar('pcp/sectors'),
          modulosDb.listar('pcp/quality-checks')
        ]);
        return sendJson(res, { intervalo, ...painelModulos.painelPcp({ ordens, apontamentos, setores, inspecoes, intervalo, hoje }) });
      }

      if (modulo === 'contracts') {
        const [contratos, tipos] = await Promise.all([
          modulosDb.listar('contracts/contracts'),
          modulosDb.listar('contracts/types')
        ]);
        return sendJson(res, { intervalo, ...painelModulos.painelContratos({ contratos, tipos, intervalo, hoje }) });
      }

      return sendJson(res, { error: 'Painel não disponível para este módulo' }, 404);
    } catch (error) {
      // Mensagem crua do banco não vai para a tela; o painel mostra o aviso de
      // falha e o resto do módulo continua utilizável.
      console.error(`Falha ao montar o painel de ${modulo}:`, error.message);
      return sendJson(res, { error: 'Não foi possível montar o painel deste módulo.' }, 500);
    }
  }

  const rotaModulo = pathname.match(/^\/api\/(fleet|hr|pcp|contracts)\/([a-z-]+)(?:\/([^/?]+))?$/);
  if (rotaModulo) {
    const [, modulo, nomeRecurso, idBruto] = rotaModulo;

    // /api/<modulo>/meta — as listas que os SELECTS dos formulários precisam
    // (o veículo da manutenção, o cargo do colaborador, o produto da ordem).
    // Cada módulo devolve só o que é seu: pedir tudo faria a tela de Frota
    // carregar produtos e pessoas que ela nunca usa.
    //
    // `name` é montado aqui, e não na tela, porque o <select> genérico exibe
    // sempre o campo `name` — um veículo tem placa e descrição, e quem decide
    // como isso vira um rótulo é quem conhece o dado.
    if (nomeRecurso === 'meta') {
      if (req.method !== 'GET') return sendJson(res, { error: 'Método não suportado' }, 405);
      try {
        const apoio = {};
        if (modulo === 'fleet') {
          // `odometer` vai junto para as telas de abastecimento e manutenção
          // marcarem leitura menor que a atual do veículo — sinal de dígito
          // trocado, que sem isso passaria despercebido.
          apoio.vehicles = (await modulosDb.listar('fleet/vehicles')).map((v) => ({
            id: v.id,
            name: [v.plate, v.description].filter(Boolean).join(' — '),
            odometer: v.odometer
          }));
        }
        if (modulo === 'hr') {
          // Só o que os selects precisam (id + nome). As listas de apoio
          // inativas continuam vindo: um colaborador antigo pode estar
          // classificado num departamento já desativado, e omiti-lo faria a
          // ficha dele abrir com o campo em branco e perder o vínculo ao salvar.
          const nomes = (lista) => lista.map((i) => ({ id: i.id, name: i.name }));
          const [positions, employees, departments, workSchedules, employeeTypes, employeeCategories] = await Promise.all([
            modulosDb.listar('hr/positions'),
            modulosDb.listar('hr/employees'),
            modulosDb.listar('hr/departments'),
            modulosDb.listar('hr/work-schedules'),
            modulosDb.listar('hr/employee-types'),
            modulosDb.listar('hr/employee-categories')
          ]);
          apoio.positions = nomes(positions);
          apoio.employees = nomes(employees);
          apoio.departments = nomes(departments);
          apoio.workSchedules = nomes(workSchedules);
          apoio.employeeTypes = nomes(employeeTypes);
          apoio.employeeCategories = nomes(employeeCategories);
        }
        if (modulo === 'pcp') {
          const [produtos, ordens, setores, statuses, pessoal] = await Promise.all([
            db.getProducts(),
            modulosDb.listar('pcp/orders'),
            modulosDb.listar('pcp/sectors'),
            modulosDb.listar('pcp/statuses'),
            // Encarregado de setor e inspetor de qualidade são colaboradores.
            // Vem do RH porque é lá que o quadro de pessoal mora — duplicar a
            // lista aqui criaria duas fontes divergindo.
            modulosDb.listar('hr/employees')
          ]);
          apoio.products = produtos.map((p) => ({ id: p.id, name: p.name }));
          apoio.orders = ordens.map((o) => ({ id: o.id, name: `OP ${o.code || o.id.slice(-6)}` }));
          apoio.sectors = setores.map((s) => ({ id: s.id, name: s.name }));
          apoio.statuses = statuses.map((s) => ({ id: s.id, name: s.name }));
          apoio.employees = pessoal.map((e) => ({ id: e.id, name: e.name }));
        }
        if (modulo === 'contracts') {
          const [modelos, tipos] = await Promise.all([
            modulosDb.listar('contracts/templates'),
            modulosDb.listar('contracts/types')
          ]);
          apoio.templates = modelos.map((t) => ({ id: t.id, name: t.name }));
          // `types` leva o prazo de aviso prévio junto: é a tela de Contratos
          // que calcula "faltam N dias para avisar", e sem o prazo aqui ela
          // teria que buscar o tipo de cada contrato uma requisição por linha.
          apoio.types = tipos.map((t) => ({
            id: t.id, name: t.name, natureza: t.natureza, avisoPreviaDias: t.avisoPreviaDias
          }));
          const dados = loadData();
          await syncCadastroData(dados);
          apoio.directory = getCadastroDirectory(dados);
        }
        return sendJson(res, apoio);
      } catch (erro) {
        return sendJson(res, { error: erro.message || 'Erro ao carregar dados de apoio' }, 400);
      }
    }

    const recurso = `${modulo}/${nomeRecurso}`;
    if (!modulosDb.RECURSOS[recurso]) {
      return sendJson(res, { error: `Recurso desconhecido: ${recurso}` }, 404);
    }

    const def = modulosDb.descritor(recurso);
    const id = idBruto ? decodeURIComponent(idBruto) : null;
    // O portão central já autorizou; aqui o usuário serve só para assinar as
    // movimentações de estoque geradas pelo apontamento de produção.
    const usuarioDaRequisicao = await getCurrentUser(req);

    try {
      if (req.method === 'GET' && !id) {
        return sendJson(res, { [def.lista]: await modulosDb.listar(recurso) });
      }
      if (req.method === 'GET') {
        const registro = await modulosDb.obter(recurso, id);
        if (!registro) return sendJson(res, { error: 'Registro não encontrado' }, 404);
        return sendJson(res, { [def.item]: registro });
      }
      if (req.method === 'POST') {
        const corpo = await readBody(req);
        if (recurso === 'pcp/entries') {
          const recusa = await ordemAceitaApontamento(corpo.orderId);
          if (recusa) return sendJson(res, { error: recusa }, 400);
        }
        // Estoque ANTES de gravar o apontamento: faltando componente, nada é
        // criado, em vez de sobrar um apontamento que não baixou nada.
        const efeito = recurso === 'pcp/entries'
          ? await mexerNoEstoqueDaProducao(corpo.orderId, Number(corpo.quantity || 0), usuarioDaRequisicao)
          : null;
        const criado = await modulosDb.criar(recurso, corpo);
        if (recurso === 'pcp/entries') await recalcularProduzidoDaOrdem(criado.orderId);
        if (recurso === 'fleet/refuels' || recurso === 'fleet/maintenances') {
          await avancarOdometroDoVeiculo(criado.vehicleId, criado.odometer);
        }
        return sendJson(res, { [def.item]: criado, estoque: efeito || undefined }, 201);
      }
      if (req.method === 'PUT' && id) {
        // O apontamento pode ter MUDADO de ordem na edição: as duas precisam
        // ser recalculadas, senão a de origem fica contando o que saiu dela.
        const anterior = recurso === 'pcp/entries' ? await modulosDb.obter(recurso, id) : null;
        const corpo = await readBody(req);
        if (anterior) {
          const novaOrdem = corpo.orderId ?? anterior.orderId;
          const novaQtd = corpo.quantity === undefined ? Number(anterior.quantity || 0) : Number(corpo.quantity || 0);
          const recusa = await ordemAceitaApontamento(novaOrdem);
          if (recusa) return sendJson(res, { error: recusa }, 400);
          if (novaOrdem === anterior.orderId) {
            // Mesma ordem: aplica só a diferença.
            await mexerNoEstoqueDaProducao(novaOrdem, novaQtd - Number(anterior.quantity || 0), usuarioDaRequisicao);
          } else {
            // TROCOU DE ORDEM: duas escritas, e a segunda pode recusar.
            //
            // Eram dois mexerNoEstoqueDaProducao soltos: o estorno da ordem
            // antiga commitava, o consumo da nova era recusado por falta de
            // componente, a rota devolvia 400 — e o estorno FICAVA. A tela
            // mostrava o apontamento intacto na ordem antiga, com o estoque já
            // mexido pelas costas.
            //
            // Refazer o estorno é possível porque ele é exatamente simétrico: o
            // movimento contrário do que acabou de ser gravado, com os mesmos
            // números. Se nem isso passar, o erro diz as duas coisas — melhor
            // do que uma mensagem que esconde metade do estrago.
            await mexerNoEstoqueDaProducao(anterior.orderId, -Number(anterior.quantity || 0), usuarioDaRequisicao);
            try {
              await mexerNoEstoqueDaProducao(novaOrdem, novaQtd, usuarioDaRequisicao);
            } catch (erroDaNova) {
              try {
                await mexerNoEstoqueDaProducao(anterior.orderId, Number(anterior.quantity || 0), usuarioDaRequisicao);
              } catch (erroAoRefazer) {
                console.error('PCP: nao consegui refazer o estorno da ordem antiga', anterior.orderId, erroAoRefazer.message);
                erroDaNova.message += ' ATENÇÃO: o estorno na ordem anterior já tinha sido gravado e '
                  + 'não consegui desfazê-lo — confira o estoque dos itens dessa ordem.';
              }
              throw erroDaNova;
            }
          }
        }
        const registro = await modulosDb.atualizar(recurso, id, corpo);
        if (!registro) return sendJson(res, { error: 'Registro não encontrado' }, 404);
        if (recurso === 'pcp/entries') {
          await recalcularProduzidoDaOrdem(registro.orderId);
          if (anterior && anterior.orderId !== registro.orderId) {
            await recalcularProduzidoDaOrdem(anterior.orderId);
          }
        }
        if (recurso === 'fleet/refuels' || recurso === 'fleet/maintenances') {
          await avancarOdometroDoVeiculo(registro.vehicleId, registro.odometer);
        }
        return sendJson(res, { [def.item]: registro });
      }
      if (req.method === 'DELETE' && id) {
        // EXCLUIR A ORDEM NÃO PODE LEVAR O ESTOQUE JUNTO (fase BP).
        //
        // pcp_entries tem `on delete cascade` para pcp_orders: apagar a ordem
        // apagava todos os apontamentos SEM estornar nada. O produto acabado
        // ficava no estoque, os insumos continuavam consumidos, e o razão ficava
        // com linhas "Produção da OP 42" apontando para uma ordem que sumiu.
        //
        // RECUSAR, e não estornar por conta própria: excluir os apontamentos um
        // a um já estorna, e é o caminho em que a pessoa vê o que está desfazendo.
        // Estornar em cascata esconderia a mesma decisão atrás de um clique.
        if (recurso === 'pcp/orders') {
          const apontamentos = (await modulosDb.listar('pcp/entries'))
            .filter((entrada) => entrada.orderId === id);
          if (apontamentos.length) {
            const total = apontamentos.reduce((soma, e) => soma + Number(e.quantity || 0), 0);
            return sendJson(res, {
              error: `Esta ordem tem ${apontamentos.length} `
                + `${apontamentos.length === 1 ? 'apontamento' : 'apontamentos'} (${total} produzido). `
                + 'Exclua os apontamentos primeiro — cada um devolve ao estoque o que consumiu — '
                + 'ou cancele a ordem em vez de excluí-la.'
            }, 409);
          }
        }
        // Lê ANTES de apagar: depois não há como saber de que ordem era.
        const removido = recurso === 'pcp/entries' ? await modulosDb.obter(recurso, id) : null;
        if (removido) {
          await mexerNoEstoqueDaProducao(removido.orderId, -Number(removido.quantity || 0), usuarioDaRequisicao);
        }
        const resposta = await modulosDb.remover(recurso, id);
        if (removido) await recalcularProduzidoDaOrdem(removido.orderId);
        return sendJson(res, resposta);
      }
      return sendJson(res, { error: 'Método não suportado' }, 405);
    } catch (erro) {
      // A mensagem do Postgres é o que explica a recusa (placa repetida, status
      // fora da lista, vínculo obrigatório). Engolir isso deixaria a tela com
      // "erro ao salvar" e ninguém saberia o quê.
      return sendJson(res, { error: erro.message || 'Erro ao processar a requisição' }, 400);
    }
  }

  // Módulo Relatórios — uma rota só, com os números de vendas, financeiro e
  // estoque juntos.
  //
  // Rota PRÓPRIA, e não as de cada módulo, por causa da permissão: as rotas de
  // Vendas e Estoque exigem acesso àqueles módulos, então um usuário que só
  // deve ver relatórios ficaria trancado do lado de fora do próprio relatório.
  // Aqui quem manda é o acesso a `reports`.
  //
  // Os cálculos são os MESMOS construtores dos painéis de cada módulo. Refazer
  // a conta aqui daria dois números diferentes para a mesma pergunta — e o
  // relatório seria o que perderia a confiança.

  // ==========================================================================
  // RELATÓRIO DE VENDAS
  //
  // O ESCOPO É MONTADO AQUI, A PARTIR DO USUÁRIO AUTENTICADO — nunca do que a
  // tela mandou. As duas rotas abaixo (ver e exportar) chamam a MESMA função de
  // cálculo com o MESMO escopo, e é isso que faz o CSV nunca conter uma linha
  // que a tabela não mostrava.
  //
  // O parâmetro `vendedorId` da query string é aceito e depois IGNORADO para
  // quem não pode escolher vendedor (ver vendedoresPermitidos em
  // lib/relatorios-escopo.js). Ignorar, e não recusar: recusar contaria a quem
  // sondasse que existe algo ali; ignorar simplesmente devolve o que a pessoa
  // sempre pôde ver.
  // ==========================================================================
  async function montarRelatorioDeVendas(req, params) {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 2x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncSalesData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user) return { erro: 'Não autenticado', status: 401 };

    // ehAdmin() consulta o RBAC (com cache de 5 min) — por isso o escopo recebe
    // a resposta pronta em vez de descobrir sozinho: a função da regra é pura.
    const escopo = escopoLib.escopoDeVendas(user, { ehAdmin: await ehAdmin(user) });

    const registros = [...data.orders, ...data.quotes].map((r) => serializeSalesRecord(r, data));
    const filtros = {
      dataDe: params.get('dataDe') || '',
      dataAte: params.get('dataAte') || '',
      vendedorId: params.get('vendedorId') || '',
      clienteId: params.get('clienteId') || '',
      produtoId: params.get('produtoId') || '',
      status: params.get('status') || '',
      tipo: params.get('tipo') || '',
      busca: params.get('busca') || '',
      ordem: params.get('ordem') || 'data',
      direcao: params.get('direcao') || 'desc',
      pagina: params.get('pagina') || 1,
      porPagina: params.get('porPagina') || 25
    };
    return { relatorio: relatoriosVendas.montarRelatorio({ registros, filtros, escopo }), filtros, escopo, registros };
  }

  if (pathname === '/api/reports/vendas' && req.method === 'GET') {
    try {
      const { erro, status, relatorio } = await montarRelatorioDeVendas(req, url.searchParams);
      if (erro) return sendJson(res, { error: erro }, status);
      return sendJson(res, relatorio);
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao montar o relatório de vendas' }, 400);
    }
  }

  if (pathname === '/api/reports/vendas/export' && req.method === 'GET') {
    try {
      const contexto = await montarRelatorioDeVendas(req, url.searchParams);
      if (contexto.erro) return sendJson(res, { error: contexto.erro }, contexto.status);
      // Reaplica o filtro SEM paginação: a exportação leva o resultado inteiro,
      // e não a página que estava na tela. Mesmo escopo, mesmos filtros — só o
      // recorte de página é que não faz sentido num arquivo.
      const linhas = relatoriosVendas.ordenar(
        relatoriosVendas.filtrar(
          contexto.registros.flatMap(relatoriosVendas.linhasDoRegistro),
          contexto.filtros,
          contexto.escopo
        ),
        contexto.filtros.ordem,
        contexto.filtros.direcao
      );
      const csv = relatoriosVendas.montarCsv(linhas);
      const hoje = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relatorio-de-vendas-${hoje}.csv"`
      });
      return res.end(csv);
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao exportar' }, 400);
    }
  }

  if (pathname === '/api/reports/overview' && req.method === 'GET') {
    const data = loadData();
    await Promise.all([syncNfeData(data), syncPurchasesData(data)]);
    // Sem checagem de permissão aqui: o portão central já traduziu esta rota
    // para reports.ler e decidiu. Repetir com allowedModules seria MAIS
    // restrito que o portão — administrador passa por lá e era barrado aqui.
    const user = await getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }

    const granularity = url.searchParams.get('granularity') || 'month';
    // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 3x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncSalesData(data),
      syncFinanceData(data)
    ]);
    const products = await db.getProducts();

    // Mesmo recorte do Painel Vendedor, e pelo mesmo motivo: o bloco
    // "vendedores" deste relatório mostra o total de cada pessoa da equipe.
    // Sem escopo, um vendedor comum com acesso a Relatórios lia o faturamento
    // do colega — sem a lista de pedidos, mas com o número, que é o que
    // interessa a quem está comparando comissão.
    const escopoVendas = escopoLib.escopoDeVendas(user, { ehAdmin: await ehAdmin(user) });
    const vendas = buildSalesDashboardSummary(data, escopoVendas);
    const financeiro = buildFinanceDashboardSummary(data, url.searchParams);
    const lancamentos = (data.finance || []).filter((entry) => !isFinanceEntryCancelled(entry));

    const comSaldo = products.map((produto) => {
      const quantidade = Number(produto.stockQuantity || 0);
      const custo = Number(produto.costPrice || 0);
      return {
        id: produto.id,
        name: produto.name,
        sku: produto.sku || '',
        quantidade,
        custo,
        valor: Math.round(quantidade * custo * 100) / 100
      };
    });

    return sendJson(res, {
      granularity,
      vendas: vendas.overview,
      // O relatório mostra o total de cada vendedor; a lista de pedidos de cada
      // um fica no Painel Vendedor, e mandá-la aqui inflaria a resposta à toa.
      vendedores: vendas.bySeller.map(({ sellerId, sellerName, totalPedidos, valorTotal, ticketMedio }) => ({
        sellerId, sellerName, totalPedidos, valorTotal, ticketMedio
      })),
      serieVendas: buildSalesChartSeries(data, granularity),
      serieFinanceiro: buildFinanceChartSeries(lancamentos, granularity),
      financeiro: {
        contasAPagar: financeiro.contasAPagar,
        contasAReceber: financeiro.contasAReceber
      },
      estoque: {
        totalProdutos: comSaldo.length,
        semSaldo: comSaldo.filter((p) => p.quantidade <= 0).length,
        valorTotal: Math.round(comSaldo.reduce((soma, p) => soma + p.valor, 0) * 100) / 100,
        // Os que mais prendem dinheiro: é a pergunta que o relatório responde.
        maiores: comSaldo.filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 15)
      }
    });
  }

  if (pathname === '/api/sales/meta' && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    await syncNfeData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const products = await db.getProducts();
    // Reserva: o que outros pedidos abertos já prometeram. Sem este número a
    // tela mostra o saldo físico, e dois vendedores prometem as mesmas dez
    // unidades sem que nada reclame até o segundo faturamento.
    //
    // Vai como objeto simples chaveado por `produto|cor` — a tela precisa fazer
    // a conta por linha de item, e um Map não atravessa JSON.
    let reservas = {};
    try {
      const calculadas = reservasLib.calcularReservas(await db.getOrders());
      reservas = Object.fromEntries(calculadas.porChave);
    } catch (erroReservas) {
      // Sem reservas a tela cai no comportamento antigo (saldo físico) em vez
      // de não abrir. O aviso some; a venda continua possível.
      reservas = {};
    }
    return sendJson(res, {
      reservas,
      companies: data.companies,
      sellers: getSellersDirectory(data),
      deposits: data.deposits,
      directory: getCadastroDirectory(data),
      products,
      // Categoria e Tabela de Preços eram texto livre na tela de venda. Digitar
      // à mão gera "Revenda", "revenda" e "Revensa" como se fossem coisas
      // diferentes, e aí nenhum relatório por categoria fecha.
      //
      // FASE AS: a categoria da VENDA passou a ter cadastro proprio. Antes o
      // campo era preenchido com as categorias de PRODUTO — o cadastro que
      // havia à mão —, e os dois respondem perguntas diferentes: "Parafusos"
      // classifica o que se vende, "Varejo" classifica a venda. Misturados,
      // nenhum dos dois relatórios fecha.
      //
      // productCategories continua indo: outras partes da tela de venda a usam.
      // So as ATIVAS: inativar existe para a origem sumir do formulario sem
      // sumir do historico. A lista de manutencao (rota /origins) traz todas.
      salesOrigins: (await origensVendaDb.listar({ apenasAtivas: true })).map((o) => o.name),
      salesCategories: (await categoriasVendaDb.listar({ apenasAtivas: true }))
        .map((c) => ({ id: c.id, name: c.name })),
      productCategories: (data.productCategories || []).filter((c) => c.status !== 'inativo'),
      priceTables: (data.priceTables || []).map((t) => ({ id: t.id, name: t.name, type: t.type })),
      // Abas Pagamentos e Entrega: formas de pagamento e transportadoras vêm do
      // Cadastro, não de lista fixa no formulário.
      paymentMethods: (data.paymentMethods || []).filter((forma) => forma.status !== 'inativo'),
      carriers: getCarriersDirectory(data)
    });
  }

  // Tributos de um pedido — leitura, nunca gravação. Recebe o pedido COMO ESTÁ
  // NA TELA (POST com o corpo, não GET por id) para a aba poder mostrar o
  // imposto do que a pessoa acabou de digitar, antes de salvar. Uma prévia que
  // só funcionasse depois de salvar não serviria para conferir antes.
  if (pathname === '/api/sales/tributos' && req.method === 'POST') {
    const data = loadData();
    await syncCadastroData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    try {
      const body = await readBody(req);
      const contexto = await montarContextoFiscalDoPedido(body, data);
      const resultado = await calcularTributos({
        ...contexto,
        tipoOperacao: body.tipoOperacao || 'VENDA',
        data: body.date || new Date().toISOString().slice(0, 10)
      }, { resolverRegraFiscal: fiscalDb.resolverRegraFiscal });
      return sendJson(res, { tributos: resultado, contexto: contexto.resumo });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Não foi possível calcular os tributos.' }, error.status || 400);
    }
  }

  if (pathname === '/api/sales/dashboard' && req.method === 'GET') {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 2x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncSalesData(data),
      syncNfeData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    // O Painel Vendedor é PRIVADO POR VENDEDOR: o gestor vê o time inteiro, o
    // vendedor comum vê só a si mesmo, e quem não tem vínculo não vê ninguém.
    // O escopo vai junto na resposta porque a tela precisa saber se desenha o
    // seletor de vendedor (gestor) ou o nome fixo de uma pessoa só (vendedor) —
    // mas quem decide o CONTEÚDO é o recorte aqui, não esse campo.
    const escopo = escopoLib.escopoDeVendas(user, { ehAdmin: await ehAdmin(user) });
    const resumo = buildSalesDashboardSummary(data, escopo);
    return sendJson(res, {
      ...resumo,
      escopo: {
        tipo: escopo.tipo,
        rotulo: escopo.rotulo,
        motivo: escopo.motivo,
        podeEscolherVendedor: escopo.podeEscolherVendedor,
        temAcesso: escopo.tipo !== escopoLib.NENHUM
      }
    });
  }

  // ==========================================================================
  // MEU PAINEL — as vendas do usuário autenticado, e só delas.
  //
  // A diferença para /api/sales/dashboard, que fica logo acima, é toda a razão
  // desta rota existir: aquela devolve `bySeller` com a lista de pedidos de
  // TODO MUNDO e deixa a tela escolher qual mostrar. Serve para o Painel
  // Vendedor, que é uma tela de gestão. Não serve aqui: quem tem acesso ao
  // módulo Vendas receberia, no corpo da resposta, os pedidos dos colegas — e o
  // fato de a tela mostrar só um deles não muda o que trafegou.
  //
  // Aqui o recorte é feito ANTES de montar a resposta, a partir do usuário da
  // sessão. Não existe parâmetro de vendedor para mandar: escopoPessoal() não
  // lê a query string, e o que ela devolve nunca é "sem restrição" — nem para
  // administrador (ver o cabeçalho em lib/relatorios-escopo.js).
  //
  // syncNfeData é obrigatório e não é detalhe: sem ele `data.nfe` vem vazio, o
  // serializer não acha a nota do pedido e a coluna NF-e — que é metade do que
  // esta tela existe para mostrar — sai em branco em toda linha, sem erro
  // nenhum aparecer.
  // ==========================================================================
  if (pathname === '/api/sales/meu-painel' && req.method === 'GET') {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 3x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncSalesData(data),
      syncNfeData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const escopo = escopoLib.escopoPessoal(user);
    const registros = [...data.orders, ...data.quotes].map((r) => serializeSalesRecord(r, data));
    return sendJson(res, painelPessoal.montarPainel({
      registros,
      escopo,
      // Só o período vem da tela. Qualquer outro parâmetro na URL é ignorado
      // por não ser lido — inclusive um `vendedorId` que alguém tente forjar.
      filtros: {
        dataDe: url.searchParams.get('dataDe') || '',
        dataAte: url.searchParams.get('dataAte') || ''
      }
    }));
  }

  if (pathname === '/api/sales/records' && req.method === 'GET') {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 3x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncSalesData(data),
      syncNfeData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const view = url.searchParams.get('view') || 'orders_quotes';
    if (view === 'orders_quotes') {
      const combined = [...data.orders, ...data.quotes];
      // SERIALIZA -> FILTRA -> ORDENA -> FATIA, nesta ordem.
      //
      // Serializar primeiro porque a Busca Avançada filtra por campos que só
      // existem depois: o número da NF-e (o registro guarda o id), a
      // transportadora e a data de faturamento (que moram dentro de grupos).
      // Ordenar antes de serializar poria empresa e vendedor em ordem de id, e
      // fatiar antes de ordenar ordenaria só a página — o clássico "ordenei e
      // mudou só um pedaço da lista".
      const serializados = combined.map((record) => serializeSalesRecord(record, data));
      const filtered = filterSalesRecords(serializados, url.searchParams);
      const { page, limit } = parsePageParams(url.searchParams, 15);
      const ordenados = ordenarSalesRecords(
        filtered,
        url.searchParams.get('sort') || '',
        url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc'
      );
      const start = (page - 1) * limit;
      const records = ordenados.slice(start, start + limit);
      return sendJson(res, {
        records,
        total: filtered.length,
        page,
        limit,
        orders: data.orders,
        quotes: data.quotes,
        nfes: data.nfes,
        importLogs: data.importLogs,
        meta: {
          companies: data.companies,
          sellers: getSellersDirectory(data),
          deposits: data.deposits,
          directory: getCadastroDirectory(data),
          // Transportadora e Categoria viram select na Busca Avançada, e as
          // duas listas vêm do Cadastro. Digitadas à mão virariam "Revenda",
          // "revenda" e "Revensa" como se fossem coisas diferentes, e aí
          // nenhum filtro por categoria fecha.
          carriers: getCarriersDirectory(data),
          productCategories: (data.productCategories || []).filter((c) => c.status !== 'inativo')
        }
      });
    }
    if (view === 'nfes') {
      return sendJson(res, { nfes: data.nfes });
    }
    if (view === 'import_logs') {
      return sendJson(res, { importLogs: data.importLogs });
    }
    return sendJson(res, { orders: data.orders, quotes: data.quotes, nfes: data.nfes, importLogs: data.importLogs });
  }

  if (pathname === '/api/sales/records' && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncNfeData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const tipoPedido = body.type || 'order';
      // Quem manda no tipo é o STATUS, não o campo `type` — a tela é uma só e
      // o usuário escolhe "Orçamento" ou "Pedido" no campo Status. `type` só
      // decide quando não vem status (importação, integração antiga) e para
      // separar o ramo de NF-e, que não é pedido nem orçamento.
      const status = tipoPedido === 'nfe'
        ? ''
        : salesStatus.normalizar(body.status || salesStatus.padraoDoTipo(tipoPedido === 'quote' ? 'quote' : 'order'));
      const type = tipoPedido === 'nfe' ? 'nfe' : salesStatus.tipoDoStatus(status);
      let record;
      if (type === 'order' || type === 'quote') {
        const itensBrutos = normalizeSalesItems(await completarNomesDosItens(body.items));
        if (!itensBrutos.length) {
          return sendJson(res, { error: mensagemItensInvalidos(body.items) }, 400);
        }
        const items = itensBrutos;
        // Aceita id OU nome: a tela sempre manda o id, mas registros importados
        // (CSV) só têm o nome. Sem nenhum dos dois o pedido nascia sem cliente.
        if (!body.clientSupplierId && !String(body.clientSupplierName || '').trim()) {
          return sendJson(res, { error: 'Selecione o cliente/fornecedor do pedido/orçamento' }, 400);
        }
        const totais = computeSalesTotals(items, body);
        record = {
          id: createId(type === 'order' ? 'ord' : 'qte'),
          type,
          code: await db.getNextSalesCode(),
          clientSupplierId: body.clientSupplierId || '',
          clientSupplierName: body.clientSupplierName || '',
          companyId: body.companyId || '',
          sellerId: body.sellerId || '',
          depositId: body.depositId || '',
          date: body.date || new Date().toISOString().slice(0, 10),
          dueDate: body.dueDate || '',
          items,
          ...salesFinanceFields(body, totais),
          ...salesInfoFields(body),
          paymentInfo: salesPaymentInfo(body),
          payments: salesPaymentLines(body),
          delivery: salesDelivery(body),
          salesTerms: String(body.salesTerms || '').trim().slice(0, 5000),
          note: body.note || '',
          status,
          stockApplied: false,
          createdBy: user.id,
          createdByName: user.name,
          updatedByName: user.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        // Orçamento nunca mexe em estoque (é só proposta). Pedido desconta se o
        // status já nasce com baixa — o caminho normal é criar "Pedido" e
        // faturar depois via PUT (ver rota de atualização, mais abaixo). Roda
        // ANTES de gravar no Supabase: se faltar estoque, nada é criado.
        //
        // Os dois efeitos são decididos SEPARADAMENTE pelo catálogo: "Pedido
        // Aprovado Sem Faturamento" baixa estoque e não gera financeiro.
        if (type === 'order' && salesStatus.baixaEstoque(status)) {
          await transitionOrderStockEffect(data, { oldItems: [], newItems: items, wasApplied: false, willApply: true, record, user });
          record.stockApplied = true;
        }
        record.financeApplied = type === 'order' && salesStatus.geraFinanceiro(status);
        record = type === 'order' ? await db.createOrder(record) : await db.createQuote(record);
        // As contas a receber vêm DEPOIS de gravar o pedido: elas apontam para
        // o id dele, e um lançamento apontando para pedido que falhou ao salvar
        // seria dinheiro no financeiro sem venda por trás.
        if (record.financeApplied) {
          await transitionOrderFinanceEffect(data, { record, wasApplied: false, willApply: true, user });
        }
      } else if (type === 'nfe') {
        record = await db.createNfe({
          number: body.number || createId('nfe-num'),
          customer: body.customer || 'Cliente',
          date: body.date || new Date().toISOString().slice(0, 10),
          amount: Number(body.amount || 0),
          status: body.status || 'emitida',
          key: body.key || '',
          createdBy: user.id,
          createdByName: user.name
        }, []);
        data.nfes.push(record);
      } else {
        return sendJson(res, { error: 'Tipo inválido' }, 400);
      }
      // O registro em si (order/quote) já foi gravado no Supabase acima; isso
      // aqui persiste o que ainda é do arquivo local — nfe (branch acima) e,
      // mais importante, data.stockMovements (ledger do estoque), que
      // transitionOrderStockEffect pode ter alterado mesmo no branch de pedido.
      saveData(data);
      const responseRecord = (type === 'order' || type === 'quote') ? serializeSalesRecord(record, data) : record;
      return sendJson(res, { success: true, record: responseRecord });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar venda' }, error.status || 400);
    }
  }

  // Um pedido/orçamento pelo id. Existe para o fluxo Aprovar -> Financeiro ->
  // voltar ao pedido: sem isto, a volta teria que baixar a lista inteira e
  // procurar o registro nela.
  // AÇÕES EM LOTE. Vem antes das rotas de /api/sales/records/:id pelo mesmo
  // motivo dos anexos: o path genérico casaria com "lote" achando que é um id.
  if (pathname === '/api/sales/records/lote' && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 2x essa latencia por nada.
      //
      // syncFinanceData entra porque a acao em lote pode DESFATURAR, e
      // transitionOrderFinanceEffect procura em `data.finance` as parcelas a
      // cancelar. Sem ele a lista chegava vazia: o pedido voltava a nao
      // faturado e as contas a receber dele continuavam de pe, cobrando um
      // faturamento que nao existe mais (fase BC).
      await Promise.all([
        syncCadastroData(data),
        syncSalesData(data),
        syncNfeData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const acaoId = String(body.acao || '');
      if (!ids.length) return sendJson(res, { error: 'Selecione ao menos um registro.' }, 400);
      // Teto: uma seleção de milhares viraria milhares de idas ao Supabase numa
      // requisição só, e o navegador desistiria antes do fim.
      if (ids.length > 200) return sendJson(res, { error: 'Selecione no máximo 200 registros por vez.' }, 400);

      const todos = [...(data.orders || []), ...(data.quotes || [])];
      const selecionados = ids
        .map((id) => todos.find((r) => r.id === id))
        .filter(Boolean)
        .map((r) => serializeSalesRecord(r, data));

      // A ELEGIBILIDADE É AVALIADA AQUI TAMBÉM, e não só na tela. A tela avalia
      // para não oferecer o que não dá; o servidor avalia porque a tela pode
      // estar com dado velho — outra pessoa faturou o pedido enquanto este
      // usuário olhava a lista.
      const { acao, elegiveis, ignorados } = salesBulk.avaliar(acaoId, selecionados);
      if (!acao) return sendJson(res, { error: 'Ação desconhecida.' }, 400);

      const resultados = [];
      const falhas = [];
      for (const registro of elegiveis) {
        try {
          if (acaoId === 'duplicar') {
            const copia = await duplicarSalesRecord(registro, data, user);
            resultados.push({ id: registro.id, code: registro.code, novo: copia.code });
          } else if (acaoId === 'excluir') {
            await excluirSalesRecord(registro.id, data, user);
            resultados.push({ id: registro.id, code: registro.code });
          } else if (acao.destino) {
            await mudarStatusSalesRecord(registro, acao.destino(registro), data, user);
            resultados.push({ id: registro.id, code: registro.code });
          } else {
            falhas.push({ code: registro.code, motivo: 'Ação sem execução no servidor.' });
          }
        } catch (erro) {
          // Falha de UM registro não derruba a leva: o resto continua, e o
          // motivo aparece junto dos ignorados. Abortar tudo no primeiro erro
          // deixaria a pessoa sem saber o que foi feito e o que não foi.
          falhas.push({ code: registro.code, motivo: erro.message || 'Falhou.' });
        }
      }
      saveData(data);

      const naoFeitos = [
        ...ignorados.map((i) => ({ code: i.registro.code, motivo: i.motivo })),
        ...falhas
      ];
      return sendJson(res, {
        acao: acaoId,
        processados: resultados.length,
        ignorados: naoFeitos,
        resumo: salesBulk.resumo(resultados.length, naoFeitos.length),
        resultados
      });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao executar a ação em lote' }, error.status || 400);
    }
  }

  // ANEXOS. Estas rotas vêm ANTES das genéricas de /api/sales/records/:id —
  // o GET genérico casa com qualquer coisa depois da barra e engoliria
  // ".../anexos/<id>" achando que "<id>/anexos/<id>" é um código de pedido.
  const rotaAnexo = pathname.match(/^\/api\/sales\/records\/([^/]+)\/anexos(?:\/([^/]+))?$/);
  if (rotaAnexo) {
    const registroId = decodeURIComponent(rotaAnexo[1]);
    const anexoId = rotaAnexo[2] ? decodeURIComponent(rotaAnexo[2]) : '';
    try {
      const data = loadData();
      await syncSalesData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const ehPedido = (data.orders || []).some((o) => o.id === registroId);
      const registro = [...(data.orders || []), ...(data.quotes || [])].find((r) => r.id === registroId);
      if (!registro) return sendJson(res, { error: 'Pedido/orçamento não encontrado' }, 404);
      const fichas = Array.isArray(registro.attachments) ? registro.attachments : [];
      const gravar = async (novas) => {
        const atualizado = { ...registro, attachments: novas };
        return ehPedido ? db.updateOrder(registroId, atualizado) : db.updateQuote(registroId, atualizado);
      };

      if (req.method === 'GET' && !anexoId) {
        return sendJson(res, { attachments: fichas });
      }

      if (req.method === 'POST' && !anexoId) {
        // Teto próprio: o arquivo vem em base64, que é ~33% maior que o
        // binário, e o limite por arquivo é de 10 MB.
        const body = await readBody(req, 16 * 1024 * 1024);
        const arquivos = Array.isArray(body.arquivos) ? body.arquivos : [];
        if (!arquivos.length) return sendJson(res, { error: 'Nenhum arquivo enviado.' }, 400);
        const enviados = [];
        const erros = [];
        for (const arquivo of arquivos) {
          try {
            enviados.push(await anexosDb.enviarAnexo(registroId, arquivo, user));
          } catch (erro) {
            // Um arquivo grande demais no meio da seleção não pode derrubar os
            // outros: sobe o que dá, e diz quais não deram.
            erros.push(erro.message);
          }
        }
        if (enviados.length) {
          await gravar([...fichas, ...enviados]);
          await registrarAuditoria({
            action: 'anexarArquivoPedido',
            targetId: registroId,
            targetUsername: String(registro.code || registroId),
            byId: user.id,
            byName: user.name,
            details: { arquivos: enviados.map((a) => a.nome) }
          });
        }
        return sendJson(res, {
          attachments: [...fichas, ...enviados],
          enviados: enviados.length,
          erros
        }, enviados.length ? 200 : 400);
      }

      if (req.method === 'GET' && anexoId) {
        const ficha = fichas.find((a) => a.id === anexoId);
        if (!ficha) return sendJson(res, { error: 'Anexo não encontrado' }, 404);
        const { bytes, tipo } = await anexosDb.baixarAnexo(ficha);
        // Os bytes saem por aqui, e nao existe URL nenhuma para o arquivo:
        // URL vaza facil (e-mail, print, log de proxy), e um anexo de pedido
        // tem contrato e dado de cliente dentro. Desde a fase AM o binario e
        // uma linha de tabela — so alcancavel por consulta do servidor.
        res.writeHead(200, {
          'Content-Type': tipo,
          'Content-Length': bytes.length,
          // `inline` para PDF e imagem abrirem no navegador; o nome original
          // (com acento) vai no filename* como manda a RFC 5987.
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(ficha.nome)}`,
          'Cache-Control': 'private, no-store'
        });
        return res.end(bytes);
      }

      if (req.method === 'DELETE' && anexoId) {
        const ficha = fichas.find((a) => a.id === anexoId);
        if (!ficha) return sendJson(res, { error: 'Anexo não encontrado' }, 404);
        await anexosDb.removerAnexo(ficha);
        const restantes = fichas.filter((a) => a.id !== anexoId);
        await gravar(restantes);
        await registrarAuditoria({
          action: 'excluirAnexoPedido',
          targetId: registroId,
          targetUsername: String(registro.code || registroId),
          byId: user.id,
          byName: user.name,
          details: { arquivo: ficha.nome, caminho: ficha.caminho }
        });
        return sendJson(res, { attachments: restantes });
      }

      return sendJson(res, { error: 'Método não permitido' }, 405);
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao tratar o anexo' }, error.status || 400);
    }
  }

  // =========================================================================
  // CATEGORIAS DE VENDA (fase AS)
  //
  // Antes de /api/sales/records/ so por clareza de leitura: os prefixos nao se
  // cruzam ('categories' nao e 'records'), mas manter o catalogo junto e no
  // topo poupa quem for procurar por ele.
  // =========================================================================

  if (pathname === '/api/sales/categories' && req.method === 'GET') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissao' }, 403);
    }
    const categorias = await categoriasVendaDb.listar();
    // Quantos pedidos usam cada uma. A lista mostra isso para quem for excluir
    // saber ANTES de clicar por que o sistema vai recusar — e porque "esta
    // categoria nao e usada por ninguem" e a informacao que decide se ela pode
    // sumir ou se deve so ser inativada.
    const comUso = [];
    for (const categoria of categorias) {
      comUso.push({ ...categoria, pedidos: await categoriasVendaDb.pedidosQueUsam(categoria.name) });
    }
    return sendJson(res, { categories: comUso });
  }

  if (pathname === '/api/sales/categories' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissao' }, 403);
      }
      const body = await readBody(req);
      const category = await categoriasVendaDb.criar(body);
      return sendJson(res, { success: true, category });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao criar a categoria' }, erro.status || 400);
    }
  }

  if (pathname.startsWith('/api/sales/categories/') && req.method === 'PUT') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissao' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/categories/', ''));
      const atual = await categoriasVendaDb.obter(id);
      if (!atual) return sendJson(res, { error: 'Categoria nao encontrada' }, 404);

      const body = await readBody(req);
      const category = await categoriasVendaDb.atualizar(id, body);

      // RENOMEAR NAO RENOMEIA NOS PEDIDOS, e quem renomeou precisa saber disso
      // na hora. `orders.category` guarda o NOME (ver o cabecalho da migracao),
      // entao os pedidos antigos continuam com o nome velho — e some do
      // formulario a opcao que os explicava. O aviso vai na resposta em vez de
      // um `console.log` que ninguem le.
      let aviso = '';
      if (category.name !== atual.name) {
        const presos = await categoriasVendaDb.pedidosQueUsam(atual.name);
        if (presos > 0) {
          aviso = `${presos} ${presos === 1 ? 'pedido continua' : 'pedidos continuam'} com o nome antigo `
            + `("${atual.name}"): a categoria e gravada por nome no pedido, e renomear aqui nao os reescreve.`;
        }
      }
      return sendJson(res, { success: true, category, aviso });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao salvar a categoria' }, erro.status || 400);
    }
  }

  if (pathname.startsWith('/api/sales/categories/') && req.method === 'DELETE') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissao' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/categories/', ''));
      const apagou = await categoriasVendaDb.excluir(id);
      if (!apagou) return sendJson(res, { error: 'Categoria nao encontrada' }, 404);
      return sendJson(res, { success: true });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao excluir' }, erro.status || 400);
    }
  }

  // =========================================================================
  // ORIGENS DE VENDA (fase AZ). Mesma forma das categorias acima, e de
  // proposito: sao dois cadastros de apoio da mesma tela, e quem mexer num vai
  // procurar o outro do lado.
  // =========================================================================

  if (pathname === '/api/sales/origins' && req.method === 'GET') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissao' }, 403);
    }
    const origens = await origensVendaDb.listar();
    // Quantos registros usam cada uma — e' o que decide se a origem pode ser
    // excluida ou se deve so ser inativada. Mostrar o numero aqui evita o
    // clique que ja nasce recusado.
    const comUso = [];
    for (const origem of origens) {
      const uso = await origensVendaDb.registrosQueUsam(origem.name);
      comUso.push({ ...origem, pedidos: uso.pedidos, orcamentos: uso.orcamentos, usos: uso.total });
    }
    return sendJson(res, { origins: comUso });
  }

  if (pathname === '/api/sales/origins' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissao' }, 403);
      }
      const body = await readBody(req);
      const origin = await origensVendaDb.criar(body);
      return sendJson(res, { success: true, origin });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao criar a origem' }, erro.status || 400);
    }
  }

  if (pathname.startsWith('/api/sales/origins/') && req.method === 'PUT') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissao' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/origins/', ''));
      const atual = await origensVendaDb.obter(id);
      if (!atual) return sendJson(res, { error: 'Origem nao encontrada' }, 404);

      const body = await readBody(req);
      const origin = await origensVendaDb.atualizar(id, body);

      // RENOMEAR NAO RENOMEIA NOS REGISTROS. `sale_origin` guarda o NOME (ver o
      // cabecalho da migracao), entao os pedidos e orcamentos antigos continuam
      // com o nome velho — e some do formulario a opcao que os explicava.
      let aviso = '';
      if (origin.name !== atual.name) {
        const presos = await origensVendaDb.registrosQueUsam(atual.name);
        if (presos.total > 0) {
          aviso = `${presos.total} ${presos.total === 1 ? 'registro continua' : 'registros continuam'} com o nome antigo `
            + `("${atual.name}"): a origem e gravada por nome no pedido, e renomear aqui nao os reescreve.`;
        }
      }
      return sendJson(res, { success: true, origin, aviso });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao salvar a origem' }, erro.status || 400);
    }
  }

  if (pathname.startsWith('/api/sales/origins/') && req.method === 'DELETE') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissao' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/origins/', ''));
      const apagou = await origensVendaDb.excluir(id);
      if (!apagou) return sendJson(res, { error: 'Origem nao encontrada' }, 404);
      return sendJson(res, { success: true });
    } catch (erro) {
      return sendJson(res, { error: erro.message || 'Erro ao excluir' }, erro.status || 400);
    }
  }

  if (pathname.startsWith('/api/sales/records/') && req.method === 'GET') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 2x essa latencia por nada.
      //
      // syncNfeData entra na onda porque serializeSalesRecord resolve o NUMERO
      // da nota do pedido em `data.nfe`/`data.nfes` — sem ele, abrir um pedido
      // faturado mostrava o campo NF-e em branco (fase BC).
      await Promise.all([
        syncCadastroData(data),
        syncSalesData(data),
        syncNfeData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/records/', ''));
      const registro = [...(data.orders || []), ...(data.quotes || [])].find((entrada) => entrada.id === id);
      if (!registro) return sendJson(res, { error: 'Pedido/orçamento não encontrado' }, 404);
      return sendJson(res, { record: serializeSalesRecord(registro, data) });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao carregar o registro' }, 500);
    }
  }

  if (pathname.startsWith('/api/sales/records/') && req.method === 'PUT') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncSalesData(data),
        syncFinanceData(data),
        syncNfeData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/records/', ''));
      const isOrder = data.orders.some((entry) => entry.id === id);
      const list = isOrder ? data.orders : data.quotes;
      const current = list.find((entry) => entry.id === id);
      if (!current) {
        return sendJson(res, { error: 'Pedido/orçamento não encontrado' }, 404);
      }
      const body = await readBody(req);
      const itensBrutos = normalizeSalesItems(await completarNomesDosItens(body.items));
      if (!itensBrutos.length) {
        return sendJson(res, { error: mensagemItensInvalidos(body.items) }, 400);
      }
      const items = itensBrutos;
      if (!body.clientSupplierId && !String(body.clientSupplierName || '').trim()) {
        return sendJson(res, { error: 'Selecione o cliente/fornecedor do pedido/orçamento' }, 400);
      }
      // O status novo pode trocar o TIPO do documento (orçamento -> pedido e
      // vice-versa). Normaliza sem passar o tipo atual de propósito: passá-lo
      // faria a troca ser revertida para o padrão do tipo antigo.
      const statusNovo = salesStatus.normalizar(body.status || current.status, undefined);

      // TRANSICAO. Antes disto qualquer status virava qualquer outro: bastava
      // um PUT com o campo preenchido. Um pedido faturado voltava a
      // "Orcamento" sem estornar nada, e o estoque baixado e o contas a
      // receber criado ficavam la, agora sem documento nenhum que os
      // explicasse. A tela ja escondia o caminho -- mas esconder nao e barrar,
      // e quem chama a API direto passava.
      if (!salesStatus.podeTransicionar(current.status, statusNovo)) {
        return sendJson(res, { error: salesStatus.motivoDaRecusa(current.status, statusNovo) }, 409);
      }

      const tipoNovo = salesStatus.tipoDoStatus(statusNovo);

      const totais = computeSalesTotals(items, body);
      let updated = {
        ...current,
        type: tipoNovo,
        clientSupplierId: body.clientSupplierId || '',
        clientSupplierName: body.clientSupplierName || '',
        companyId: body.companyId || '',
        sellerId: body.sellerId || '',
        depositId: body.depositId || '',
        date: body.date || current.date,
        dueDate: body.dueDate || '',
        items,
        ...salesFinanceFields(body, totais),
        ...salesInfoFields(body),
        paymentInfo: salesPaymentInfo(body),
        payments: salesPaymentLines(body),
        delivery: salesDelivery(body),
        salesTerms: String(body.salesTerms || '').trim().slice(0, 5000),
        note: body.note || '',
        status: statusNovo,
        // "Alterado por" na tela — quem salvou por último, não quem criou.
        updatedByName: user.name,
        updatedAt: new Date().toISOString()
      };

      // Estoque, financeiro e a eventual troca de tabela saem daqui — ver
      // aplicarEfeitosDeStatus(). Antes esta orquestração morava só nesta rota,
      // e as ações em lote precisariam de uma segunda cópia: aprovar em lote
      // sem gerar as contas a receber seria "aprovado" na tela e nada no
      // Financeiro.
      const efeitos = await aplicarEfeitosDeStatus({
        id, current, updated, items, statusNovo, tipoNovo, isOrder, data, user
      });
      updated = efeitos.updated;
      const efeitoFinanceiro = efeitos.efeitoFinanceiro;
      // updateOrder/updateQuote não tocam data.orders/data.quotes (já
      // gravaram no Supabase direto) — saveData aqui é só pra persistir
      // data.stockMovements, que transitionOrderStockEffect pode ter alterado.
      saveData(data);
      // `financeiro` diz o que aconteceu com as contas a receber nesta gravação
      // — é o que permite à tela levar o usuário direto ao lançamento gerado
      // depois de aprovar, em vez de mandá-lo procurar no Financeiro.
      const lancamentosDoPedido = (data.finance || [])
        .filter((entry) => entry.referenceId === updated.id && entry.status !== 'cancelado')
        .map((entry) => entry.id);
      return sendJson(res, {
        success: true,
        record: serializeSalesRecord(updated, data),
        financeiro: { ...efeitoFinanceiro, entryIds: lancamentosDoPedido }
      });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao atualizar pedido/orçamento' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/sales/records/') && req.method === 'DELETE') {
    try {
      const data = loadData();
      // Excluir um pedido faturado devolve estoque, e a devolução resolve
      // nome de depósito por productBalances.
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/records/', ''));
      // A exclusão inteira — devolução de estoque, remoção dos anexos e a
      // saída da lista em memória — mora em excluirSalesRecord,
      // porque as ações em lote fazem exatamente isto. Duas cópias divergem, e
      // aqui a divergência custaria reserva de estoque presa para sempre ou
      // arquivo órfão em pedido_anexo.
      try {
        await excluirSalesRecord(id, data, user);
      } catch (erro) {
        if (/não encontrado/.test(erro.message)) {
          return sendJson(res, { error: 'Pedido/orçamento não encontrado' }, 404);
        }
        throw erro;
      }
      // saveData aqui é só pra persistir data.stockMovements — o registro em si
      // já saiu do Supabase.
      saveData(data);
      return sendJson(res, { success: true });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao excluir pedido/orçamento' }, error.status || 400);
    }
  }

  if (pathname === '/api/sales/import' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncNfeData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const rows = body.rows || (body.text ? parseCsv(body.text) : []);
      const type = body.type || 'order';
      const created = [];
      // CSV importado é sempre "achatado" (sem itens/desconto/frete) — cai
      // nos defaults de buildOrderQuoteRow (items: [], etc.). clientSupplierName
      // preenchido explicitamente com o nome da planilha, não só o fallback
      // da coluna antiga "customer".
      for (const row of rows) {
        const customer = row.customer || row.cliente || row.Cliente || '';
        const amount = Number(row.amount || row.valor || row.total || 0);
        const date = row.date || row.data || new Date().toISOString().slice(0, 10);
        const statusBruto = row.status || row.statusPedido || '';
        // Planilha traz o status escrito à mão ("faturado", "Em aberto"…) —
        // normaliza contra o tipo escolhido na importação para não entrar valor
        // fora do catálogo nem status de orçamento num pedido. NF-e tem catálogo
        // próprio e fica de fora.
        const status = type === 'nfe'
          ? (statusBruto || 'emitida')
          : salesStatus.normalizar(statusBruto, type === 'quote' ? 'quote' : 'order');
        if (type === 'order') {
          const record = await db.createOrder({
            clientSupplierName: customer, date, totalAmount: amount, itemsTotal: amount, status, note: row.note || '',
            createdBy: user.id, createdByName: user.name, code: await db.getNextSalesCode()
          });
          created.push(record);
        } else if (type === 'quote') {
          const record = await db.createQuote({
            clientSupplierName: customer, date, totalAmount: amount, itemsTotal: amount, status, note: row.note || '',
            createdBy: user.id, createdByName: user.name, code: await db.getNextSalesCode()
          });
          created.push(record);
        } else if (type === 'nfe') {
          const record = await db.createNfe({
            number: row.number || row.numero || createId('nfe-num'),
            customer, date, amount, status, key: row.key || '',
            createdBy: user.id, createdByName: user.name
          }, []);
          data.nfes.push(record);
          created.push(record);
        }
      }
      await db.addImportLog({ type, source: body.source || 'manual', count: created.length });
      saveData(data);
      return sendJson(res, { success: true, created, count: created.length });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao importar vendas' }, error.status || 400);
    }
  }

  if (pathname === '/api/sales' && req.method === 'GET') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const products = await db.getProducts();
    return sendJson(res, { sales: data.sales, products });
  }

  if (pathname === '/api/sales' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const product = await db.getProductById(body.productId);
      if (!product) {
        return sendJson(res, { error: 'Produto não encontrado' }, 400);
      }
      if (Number(product.stockQuantity || 0) < Number(body.quantity || 0)) {
        return sendJson(res, { error: 'Estoque insuficiente' }, 400);
      }

      const sale = {
        id: createId('sale'),
        date: body.date || new Date().toISOString().slice(0, 10),
        customer: body.customer || 'Cliente sem nome',
        productId: product.id,
        quantity: Number(body.quantity || 0),
        unitPrice: Number(body.unitPrice || product.salePrice || 0),
        total: Number(body.quantity || 0) * Number(body.unitPrice || product.salePrice || 0),
        status: 'faturado'
      };

      data.sales.push(sale);
      await db.upsertProduct({ ...product, stockQuantity: Number(product.stockQuantity || 0) - Number(body.quantity || 0) });

      // `method` saiu junto com a migração para o Supabase: era um rótulo fixo
      // ('Pix'/'Boleto') que nunca foi lido por tela nenhuma nem existe na
      // tabela — mantê-lo só criaria um campo que mente sobre a forma de
      // pagamento real.
      const financeEntry = await db.createFinancialEntry({
        type: 'sale',
        referenceId: sale.id,
        date: sale.date,
        description: `Venda ${sale.id}`,
        amount: sale.total,
        status: 'paid',
        createdBy: user?.id,
        createdByName: user?.name
      });
      data.finance.push(financeEntry);

      saveData(data);
      return sendJson(res, { success: true, sale, financeEntry });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar venda' }, 400);
    }
  }

  if (pathname === '/api/cadastros' && req.method === 'GET') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    // Sem o sync esta rota devolvia o retrato congelado do db.json, divergindo
    // de /api/cadastros/pessoas (que lê o Supabase).
    await syncCadastroData(data);
    return sendJson(res, { people: data.people, cnpjs: data.cnpjs });
  }

  if (pathname === '/api/cadastros/pessoas' && req.method === 'GET') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { people: await db.getPeople() });
  }

  if (pathname === '/api/cadastros/cnpjs' && req.method === 'GET') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { cnpjs: await db.getCnpjs() });
  }

  if (pathname.startsWith('/api/cnpj/') && req.method === 'GET') {
    try {
      const data = loadData();
      const user = await getCurrentUser(req);
      if (!user || !(user.allowedModules.includes('cadastros') || user.allowedModules.includes('finance'))) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const cnpj = sanitizeDigits(pathname.replace('/api/cnpj/', ''));
      if (!isValidCnpj(cnpj)) {
        return sendJson(res, { error: 'CNPJ inválido. Informe 14 dígitos válidos.' }, 400);
      }

      const officialData = await fetchCnpjOfficialData(cnpj);
      return sendJson(res, { valid: true, officialData });
    } catch (error) {
      const status = error.status || 502;
      return sendJson(res, { error: error.message || 'Erro ao consultar API de CNPJ' }, status);
    }
  }

  if (pathname.startsWith('/api/cep/') && req.method === 'GET') {
    try {
      const data = loadData();
      const user = await getCurrentUser(req);
      // 'sales' entrou aqui junto com o endereço de entrega do Pedido/Orçamento:
      // sem isso, quem só tem acesso a Vendas tomava 403 ao buscar o CEP.
      if (!user || !['cadastros', 'finance', 'sales'].some((modulo) => user.allowedModules.includes(modulo))) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const cep = sanitizeDigits(pathname.replace('/api/cep/', ''));
      if (cep.length !== 8) {
        return sendJson(res, { error: 'CEP inválido. Informe 8 dígitos.' }, 400);
      }

      const address = await fetchCepData(cep);
      return sendJson(res, { valid: true, address });
    } catch (error) {
      const status = error.status || 502;
      return sendJson(res, { error: error.message || 'Erro ao consultar CEP' }, status);
    }
  }

  if (pathname === '/api/focusnfe/status' && req.method === 'GET') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('settings')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const status = await focusNfe.checkStatus();
    return sendJson(res, status);
  }

  // Webhook da Focus NFe — chamado por ELES, não pelo navegador do usuário.
  // Não usa sessão/login: autentica pelo segredo compartilhado configurado
  // no registro do webhook (ver criarWebhookFiscal). Fica fora do gate
  // `/api/fiscal/` de propósito, que exige usuário logado.
  if (pathname === '/api/fiscal/webhooks/focus' && req.method === 'POST') {
    try {
      const secretEsperado = String(process.env.FISCAL_WEBHOOK_SECRET || '').trim();
      const secretRecebido = req.headers['x-fiscal-webhook-secret'];
      if (!secretEsperado || secretRecebido !== secretEsperado) {
        return sendJson(res, { error: 'Não autorizado' }, 401);
      }
      const body = await readBody(req);
      const referencia = body.ref || body.referencia;
      if (!referencia) {
        return sendJson(res, { error: 'Payload sem referência (ref)' }, 400);
      }
      const nfe = await fiscalDb.getNfeByReferencia(referencia);
      if (!nfe) {
        // Não é erro nosso — pode ser webhook de outro ambiente/empresa.
        return sendJson(res, { success: true, ignorado: true });
      }
      await aplicarRespostaFocusNaNfe(nfe, body);
      return sendJson(res, { success: true });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao processar webhook' }, error.status || 500);
    }
  }

  // Webhook do Open Finance — chamado pelo provider (Pluggy/Polp/Celcoin),
  // não pelo navegador. Mesmo padrão do webhook fiscal acima: fora do gate
  // de sessão, autenticado por segredo compartilhado no header. O provider
  // vem da própria URL porque mais de um pode estar configurado.
  if (/^\/api\/open-finance\/webhooks\/[^/]+$/.test(pathname) && req.method === 'POST') {
    try {
      const secretEsperado = String(process.env.OPEN_FINANCE_WEBHOOK_SECRET || '').trim();
      const secretRecebido = req.headers['x-open-finance-webhook-secret'];
      if (!secretEsperado || secretRecebido !== secretEsperado) {
        return sendJson(res, { error: 'Não autorizado' }, 401);
      }
      const provider = decodeURIComponent(pathname.replace('/api/open-finance/webhooks/', ''));
      const body = await readBody(req);

      // Formato exato do payload (nome dos campos de id do evento/conexão)
      // ainda não é conhecido pra nenhum dos 3 providers — sem credencial
      // real, isso só pode ser confirmado quando o primeiro webhook de
      // verdade chegar. providerEventId e connectionId ficam null até lá,
      // mas o evento bruto é gravado do mesmo jeito (nunca se perde).
      const providerEventId = body.eventId || body.id || null;
      const connectionId = body.connectionId || body.itemId || null;
      const evento = await openFinanceDb.recordWebhookEvent({ provider, connectionId, providerEventId, payload: body });

      if (evento.processed) {
        // Reenvio do provider pro mesmo evento — já processamos antes.
        return sendJson(res, { success: true, jaProcessado: true });
      }

      try {
        if (connectionId) {
          await syncOpenFinanceConnection(connectionId);
        }
        await openFinanceDb.markWebhookEventProcessed(evento.id, null);
      } catch (syncError) {
        await openFinanceDb.markWebhookEventProcessed(evento.id, syncError.message);
        // Evento já está salvo — não propaga como erro HTTP pro provider
        // ficar reenviando indefinidamente por causa de uma falha nossa.
      }

      return sendJson(res, { success: true });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao processar webhook' }, error.status || 500);
    }
  }

  // ---------------------------------------------------------------------
  // Fiscal: empresa / estabelecimento / certificado / regras / NF-e (base
  // pra emissão real via Focus NFe). Permissão granular por ação
  // (fiscal.emitir, fiscal.cancelar etc. — user.fiscalPermissions), em vez
  // do padrão de permissão-por-módulo-inteiro que o resto do sistema usa —
  // decisão explícita do usuário, dado o tanto de coisa sensível aqui
  // (CNPJ, regime tributário, token, emissão de documento fiscal real).
  // Admin sempre passa (mesmo padrão do resto do app).
  // ---------------------------------------------------------------------
  if (pathname.startsWith('/api/fiscal/')) {
    const user = await getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const method = req.method;
    const requiredPermission = resolveFiscalPermission(pathname, method);
    // 'fiscal' precisa estar aqui: é um módulo que o usuário pode receber na
    // tela de Usuários, e sem ele quem tinha o módulo Fiscal marcado (com as
    // permissões fiscais marcadas junto) não passava por este caminho — só
    // entrava por papel do RBAC ou sendo admin, o que fazia a tela de Usuários
    // parecer ter funcionado sem ter.
    const temAcessoAoModulo = fiscalPermissoes.habilitadoPor(user.allowedModules);
    // O RBAC entra como caminho ADICIONAL, nunca como restrição nova: quem já
    // podia emitir por fiscal_permissions continua podendo, e agora também
    // passa quem recebeu fiscal.<ação> por papel. A migração para um modelo só
    // é o passo seguinte, não este.
    const acessoRbac = await db.rbac.carregarAcessoDoUsuario(user.id);
    const hasPermission = user.role === 'admin'
      || (temAcessoAoModulo && (user.fiscalPermissions || []).includes(requiredPermission))
      || (acessoRbac && permissoes.usuarioPode({ ...user, roles: acessoRbac.roles }, `fiscal.${requiredPermission}`, acessoRbac));
    if (!hasPermission) {
      await db.rbac.registrarAcesso({
        userId: user.id, userName: user.name, action: `fiscal.${requiredPermission}`,
        resourceType: 'fiscal', result: 'NEGADO', ip: ipDaRequisicao(req),
        detail: { metodo: method, rota: pathname }
      });
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    if (method !== 'GET') {
      await db.rbac.registrarAcesso({
        userId: user.id, userName: user.name, action: `fiscal.${requiredPermission}`,
        resourceType: 'fiscal', result: 'PERMITIDO', ip: ipDaRequisicao(req),
        detail: { metodo: method, rota: pathname }
      });
    }

    try {
      // Tabelas de referência (CFOP, CST, CSOSN, origem). São códigos oficiais,
      // iguais para qualquer empresa — só leitura, sem parâmetro.
      // =========================================================================
      // NOTAS EMITIDAS CONTRA O NOSSO CNPJ — Distribuicao de DF-e (fase AR)
      //
      // O portao fiscal la em cima ja conferiu a permissao (documentos_recebidos
      // para consultar, manifestar para o evento) — ver resolveFiscalPermission.
      // =========================================================================

      if (pathname === '/api/fiscal/dfe' && req.method === 'GET') {
        const cnpj = url.searchParams.get('cnpj') || '';
        const [documentos, estabelecimentos] = await Promise.all([
          dfeDb.listarDocumentos(cnpj ? { cnpj } : {}),
          fiscalDb.getEstabelecimentos()
        ]);
        // O ponteiro de NSU de cada empresa vai junto: e ele que a tela mostra para
        // dizer ate onde ja sincronizou, e sem isso "a partir do ultimo NSU" seria
        // um botao que nao diz de onde parte.
        const ponteiros = {};
        for (const estabelecimento of estabelecimentos) {
          const documento = String(empresa.cnpj || '').replace(/\D/g, '');
          if (documento) ponteiros[documento] = await dfeDb.obterNsu(documento);
        }
        return sendJson(res, {
          documentos,
          // A tela chama de "empresa", que e como o usuario pensa. Aqui sao
          // ESTABELECIMENTOS: `empresa` guarda so a raiz do CNPJ (8 digitos), e
          // a SEFAZ consulta o CNPJ inteiro — que so o estabelecimento tem,
          // junto com as credenciais da Focus.
          empresas: estabelecimentos.map((e) => ({ id: e.id, nome: e.razaoSocial || e.nomeFantasia || '', cnpj: e.cnpj })),
          ponteiros,
          manifestacoes: manifestacao.CATALOGO,
          focusConfigurado: focusNfe.isConfigured()
        });
      }

      if (pathname === '/api/fiscal/dfe/buscar' && req.method === 'POST') {
        try {
          const user = await getCurrentUser(req);
          const body = await readBody(req);
          const estabelecimentos = await fiscalDb.getEstabelecimentos();
          const estabelecimento = estabelecimentos.find((e) => e.id === body.empresaId);
          if (!estabelecimento) {
            return sendJson(res, { error: 'Escolha a empresa cujo CNPJ sera consultado na SEFAZ.' }, 400);
          }
          const cnpj = String(empresa.cnpj || '').replace(/\D/g, '');
          const nomeEmpresa = empresa.razaoSocial || empresa.nomeFantasia || '';

          const modo = String(body.modo || 'ultimo-nsu');
          const ponteiro = await dfeDb.obterNsu(cnpj);

          // DE ONDE CADA MODO PARTE.
          //
          // 'tres-meses' comeca do ZERO, e nao de uma data: a SEFAZ nao filtra por
          // periodo — ela pagina por NSU. O recorte de tres meses e feito DEPOIS,
          // sobre o que voltou. Fingir um filtro que o servico nao tem devolveria
          // silenciosamente menos notas do que o usuario pediu.
          let nsuInicial = 0;
          if (modo === 'ultimo-nsu') nsuInicial = ponteiro.ultimoNsu;
          if (modo === 'nsu') {
            const pedido = Number(body.nsu || 0);
            if (!pedido) return sendJson(res, { error: 'Informe o NSU que deseja consultar.' }, 400);
            // Menos 1 porque a SEFAZ devolve os documentos SEGUINTES ao NSU pedido:
            // pedir exatamente o NSU 4131 traria do 4132 em diante, e o usuario
            // que digitou 4131 receberia tudo menos o que procurava.
            nsuInicial = Math.max(0, pedido - 1);
          }

          const resultado = await focusNfe.distribuicaoDfe({
            cnpj, modo, nsu: nsuInicial, chave: body.chave
          }, await focusNfe.forEstabelecimento(estabelecimento.id));

          // O recorte de data, quando o modo pede.
          let documentos = resultado.documentos;
          if (modo === 'tres-meses') {
            const limite = new Date();
            limite.setMonth(limite.getMonth() - 3);
            documentos = documentos.filter((d) => !d.dataEmissao || new Date(d.dataEmissao) >= limite);
          }

          let novos = 0;
          let maiorNsu = nsuInicial;
          for (const documento of documentos) {
            const gravado = await dfeDb.gravarDocumento({
              cnpjDestinatario: cnpj, empresaNome: nomeEmpresa, documento
            });
            if (gravado.novo) novos += 1;
            if (documento.nsu > maiorNsu) maiorNsu = documento.nsu;
          }

          // O ponteiro so avanca nos modos que VARREM. Buscar uma chave ou um NSU
          // antigo nao pode mover o marcador de "ja sincronizei ate aqui" — seria
          // pular tudo o que existe entre o antigo e o atual.
          let ponteiroFinal = ponteiro;
          if (modo === 'ultimo-nsu' || modo === 'tres-meses') {
            ponteiroFinal = await dfeDb.avancarNsu(cnpj, {
              ultimoNsu: maiorNsu, maxNsu: resultado.maxNsu
            });
          }

          await db.rbac.registrarAcesso({
            userId: user?.id, userName: user?.name, action: 'fiscal.documentos_recebidos',
            resourceType: 'dfe', result: 'PERMITIDO', ip: ipDaRequisicao(req),
            detail: { cnpj, modo, encontrados: documentos.length, novos }
          });

          return sendJson(res, {
            success: true,
            encontrados: documentos.length,
            novos,
            ponteiro: ponteiroFinal,
            // A SEFAZ entrega no maximo 50 por consulta: dizer que ainda falta e o
            // que evita alguem achar que sincronizou tudo com uma clicada.
            faltaBuscar: ponteiroFinal.maxNsu > ponteiroFinal.ultimoNsu,
            documentos: await dfeDb.listarDocumentos({ cnpj })
          });
        } catch (erro) {
          return sendJson(res, { error: erro.message || 'Erro ao consultar a SEFAZ' }, erro.status || 400);
        }
      }

      if (pathname.startsWith('/api/fiscal/dfe/') && pathname.endsWith('/manifestar') && req.method === 'POST') {
        try {
          const user = await getCurrentUser(req);
          const id = decodeURIComponent(pathname.slice('/api/fiscal/dfe/'.length, -('/manifestar'.length)));
          const documento = await dfeDb.obterDocumento(id);
          if (!documento) return sendJson(res, { error: 'Documento nao encontrado' }, 404);

          const body = await readBody(req);
          // AS CREDENCIAIS SAO DO CNPJ CONTRA O QUAL A NOTA FOI EMITIDA, e o
          // documento ja o guarda. Pedir o estabelecimento a tela abriria a
          // porta para manifestar uma nota de um CNPJ usando o certificado de
          // outro — a SEFAZ recusaria, mas com um codigo numerico que ninguem
          // liga a essa causa.
          const estabelecimentos = await fiscalDb.getEstabelecimentos();
          const estabelecimento = estabelecimentos.find(
            (e) => String(e.cnpj || '').replace(/\D/g, '') === documento.cnpjDestinatario
          );
          if (!estabelecimento) {
            return sendJson(res, {
              error: `Nao ha estabelecimento cadastrado com o CNPJ ${documento.cnpjDestinatario}. `
                + 'Manifestar exige o certificado desse CNPJ.'
            }, 400);
          }

          const evento = manifestacao.obter(body.tipo);
          if (!manifestacao.CATALOGO.some((m) => m.value === evento.value)) {
            return sendJson(res, { error: 'Escolha o tipo de manifestacao.' }, 400);
          }
          if (documento.manifestacaoCodigo) {
            return sendJson(res, {
              error: `Esta nota ja foi manifestada como "${manifestacao.rotulo(documento.manifestacaoCodigo)}". `
                + 'Manifestacao e evento fiscal: para mudar, o caminho e a SEFAZ, nao esta tela.'
            }, 400);
          }

          // A SEFAZ PRIMEIRO, o banco depois. Gravar antes e depois falhar deixaria
          // a tela dizendo "manifestada" sobre uma nota que a Receita continua
          // esperando — e o usuario nao tentaria de novo.
          const resposta = await focusNfe.manifestarNfe({
            chave: documento.chave,
            codigo: evento.codigo,
            justificativa: body.justificativa,
            cnpj: documento.cnpjDestinatario
          }, await focusNfe.forEstabelecimento(estabelecimento.id));

          const atualizado = await dfeDb.registrarManifestacao(id, {
            codigo: evento.codigo, usuarioId: user?.id, usuarioNome: user?.name
          });

          // O XML COMPLETO SO EXISTE DEPOIS DA MANIFESTACAO. Buscar agora, na mesma
          // requisicao, e o que permite lancar a entrada em seguida sem uma segunda
          // ida a SEFAZ. Falhar aqui NAO desfaz a manifestacao (ela ja aconteceu, e
          // nao se desfaz): a nota fica manifestada e sem XML, e a tela oferece
          // buscar de novo.
          let temXml = documento.tipoDocumento === 'completo';
          if (evento.liberaXml && !temXml) {
            try {
              const completo = await focusNfe.distribuicaoDfe({
                cnpj: documento.cnpjDestinatario, modo: 'chave', chave: documento.chave
              }, await focusNfe.forEstabelecimento(estabelecimento.id));
              const achado = completo.documentos.find((d) => d.chave === documento.chave && d.xml);
              if (achado) {
                await dfeDb.guardarXml(id, achado.xml);
                temXml = true;
              }
            } catch (erroXml) {
              temXml = false;
            }
          }

          await db.rbac.registrarAcesso({
            userId: user?.id, userName: user?.name, action: 'fiscal.manifestar',
            resourceType: 'dfe', resourceId: id, result: 'PERMITIDO', ip: ipDaRequisicao(req),
            detail: { chave: documento.chave, evento: evento.codigo }
          });

          return sendJson(res, {
            success: true,
            documento: { ...atualizado, tipoDocumento: temXml ? 'completo' : atualizado.tipoDocumento },
            // A tela usa os dois para decidir se encadeia a entrada.
            geraEntrada: evento.geraEntrada,
            temXml,
            sefaz: resposta
          });
        } catch (erro) {
          return sendJson(res, { error: erro.message || 'Erro ao manifestar' }, erro.status || 400);
        }
      }

      if (pathname.startsWith('/api/fiscal/dfe/') && pathname.endsWith('/xml') && req.method === 'GET') {
        const id = decodeURIComponent(pathname.slice('/api/fiscal/dfe/'.length, -('/xml'.length)));
        const xml = await dfeDb.obterXml(id);
        if (!xml) {
          return sendJson(res, {
            error: 'O XML completo desta nota ainda nao foi liberado. Manifeste ciencia ou confirmacao para a SEFAZ libera-lo.'
          }, 404);
        }
        return sendJson(res, { xml });
      }

      if (pathname.startsWith('/api/fiscal/dfe/') && pathname.endsWith('/entrada') && req.method === 'POST') {
        try {
          const id = decodeURIComponent(pathname.slice('/api/fiscal/dfe/'.length, -('/entrada'.length)));
          const documento = await dfeDb.obterDocumento(id);
          if (!documento) return sendJson(res, { error: 'Documento nao encontrado' }, 404);
          const body = await readBody(req);
          if (!body.entradaId) return sendJson(res, { error: 'Falta o id da entrada lancada.' }, 400);
          // Registra que esta nota virou aquela entrada. E o que faz a tela parar de
          // oferecer o lancamento e o que responde "essa nota ja entrou?" sem
          // varrer nfe_entrada por chave.
          const atualizado = await dfeDb.ligarEntrada(id, String(body.entradaId));
          return sendJson(res, { success: true, documento: atualizado });
        } catch (erro) {
          return sendJson(res, { error: erro.message || 'Erro ao ligar a entrada' }, erro.status || 400);
        }
      }

      if (pathname === '/api/fiscal/tabelas' && req.method === 'GET') {
        return sendJson(res, await fiscalDb.getTabelasFiscais());
      }

      if (pathname === '/api/fiscal/empresas' && req.method === 'GET') {
        const empresas = await fiscalDb.getEmpresas();
        return sendJson(res, { empresas });
      }

      if (pathname === '/api/fiscal/empresas' && req.method === 'POST') {
        const body = await readBody(req);
        const empresa = await fiscalDb.createEmpresa(body);
        return sendJson(res, { success: true, empresa });
      }

      if (pathname.startsWith('/api/fiscal/empresas/') && req.method === 'PUT') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/empresas/', ''));
        const body = await readBody(req);
        const empresa = await fiscalDb.updateEmpresa(id, body);
        return sendJson(res, { success: true, empresa });
      }

      if (pathname.startsWith('/api/fiscal/empresas/') && req.method === 'DELETE') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/empresas/', ''));
        await fiscalDb.deleteEmpresa(id);
        return sendJson(res, { success: true });
      }

      if (pathname === '/api/fiscal/estabelecimentos' && req.method === 'GET') {
        const empresaId = url.searchParams.get('empresaId') || undefined;
        const estabelecimentos = await fiscalDb.getEstabelecimentos(empresaId);
        // A tela precisa saber da trava para não oferecer "Produção" num
        // sistema que vai recusar produção na hora de emitir.
        return sendJson(res, { estabelecimentos, travadoEmHomologacao: focusNfe.somenteHomologacao() });
      }

      if (pathname === '/api/fiscal/estabelecimentos' && req.method === 'POST') {
        const body = await readBody(req);
        const estabelecimento = await fiscalDb.createEstabelecimento(body);
        return sendJson(res, { success: true, estabelecimento });
      }

      if (pathname.startsWith('/api/fiscal/estabelecimentos/') && pathname.endsWith('/focus-status') && req.method === 'GET') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/estabelecimentos/', '').replace('/focus-status', ''));
        const creds = await fiscalDb.getEstabelecimentoFocusCredentials(id);
        if (!creds) {
          return sendJson(res, { configured: false, connected: false, message: 'Token não configurado para este estabelecimento.' });
        }
        const status = await focusNfe.checkStatus(creds);
        return sendJson(res, status);
      }

      if (pathname.startsWith('/api/fiscal/estabelecimentos/') && pathname.endsWith('/webhook') && req.method === 'POST') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/estabelecimentos/', '').replace('/webhook', ''));
        const resultado = await registrarWebhookFiscal(id);
        return sendJson(res, { success: true, webhook: resultado });
      }

      if (pathname.startsWith('/api/fiscal/estabelecimentos/') && req.method === 'PUT') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/estabelecimentos/', ''));
        const body = await readBody(req);
        const estabelecimento = await fiscalDb.updateEstabelecimento(id, body);
        return sendJson(res, { success: true, estabelecimento });
      }

      if (pathname.startsWith('/api/fiscal/estabelecimentos/') && req.method === 'DELETE') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/estabelecimentos/', ''));
        await fiscalDb.deleteEstabelecimento(id);
        return sendJson(res, { success: true });
      }

      if (pathname === '/api/fiscal/certificados' && req.method === 'GET') {
        const empresaId = url.searchParams.get('empresaId') || undefined;
        const certificados = await fiscalDb.getCertificados(empresaId);
        return sendJson(res, { certificados });
      }

      if (pathname === '/api/fiscal/certificados' && req.method === 'POST') {
        const body = await readBody(req);
        const certificado = await fiscalDb.createCertificado(body);
        return sendJson(res, { success: true, certificado });
      }

      if (pathname.startsWith('/api/fiscal/certificados/') && req.method === 'DELETE') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/certificados/', ''));
        await fiscalDb.deleteCertificado(id);
        return sendJson(res, { success: true });
      }

      // "Qual regra se aplicaria a este item?" — mesma função que a emissão
      // usa (resolverRegraFiscal), então a resposta aqui é literalmente o que
      // vai acontecer na hora de emitir. Existe porque a falha mais comum da
      // emissão é "Nenhuma regra fiscal encontrada", e sem isto não há como
      // descobrir o porquê: a escolha passa por coringa (NULL), especificidade,
      // prioridade e vigência, que ninguém acerta de cabeça olhando a lista.
      if (pathname === '/api/fiscal/regras/simular' && req.method === 'GET') {
        const q = url.searchParams;
        const empresaId = q.get('empresaId') || '';
        const tipoOperacao = q.get('tipoOperacao') || '';
        if (!empresaId || !tipoOperacao) {
          return sendJson(res, { error: 'Informe a empresa e o tipo de operação.' }, 400);
        }
        // Tri-estado: ausente/'' = "não informado" (a regra coringa passa),
        // 'true'/'false' = critério de verdade. Boolean('false') seria true.
        const booleano = (chave) => {
          const bruto = q.get(chave);
          if (bruto === null || bruto === '') return undefined;
          return bruto === 'true' || bruto === '1';
        };
        const regra = await fiscalDb.resolverRegraFiscal({
          empresaId,
          tipoOperacao,
          ncm: q.get('ncm') || undefined,
          origem: q.get('origem') === null || q.get('origem') === '' ? undefined : Number(q.get('origem')),
          ufDestino: q.get('ufDestino') || undefined,
          dentroDoEstado: booleano('dentroDoEstado'),
          destinatarioContribuinte: booleano('destinatarioContribuinte'),
          data: q.get('data') || undefined
        });
        return sendJson(res, { encontrou: Boolean(regra), regra: regra || null });
      }

      if (pathname === '/api/fiscal/regras' && req.method === 'GET') {
        const empresaId = url.searchParams.get('empresaId') || undefined;
        const regras = await fiscalDb.getRegrasFiscais(empresaId);
        return sendJson(res, { regras });
      }

      if (pathname === '/api/fiscal/regras' && req.method === 'POST') {
        const body = await readBody(req);
        const textoDoFisco = conferirObservacaoDoFisco(body);
        if (textoDoFisco) return sendJson(res, { error: textoDoFisco }, 400);
        const regra = await fiscalDb.createRegraFiscal(body);
        return sendJson(res, { success: true, regra });
      }

      if (pathname.startsWith('/api/fiscal/regras/') && req.method === 'PUT') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/regras/', ''));
        const body = await readBody(req);
        const textoDoFisco = conferirObservacaoDoFisco(body);
        if (textoDoFisco) return sendJson(res, { error: textoDoFisco }, 400);
        const regra = await fiscalDb.updateRegraFiscal(id, body);
        return sendJson(res, { success: true, regra });
      }

      if (pathname.startsWith('/api/fiscal/regras/') && req.method === 'DELETE') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/regras/', ''));
        await fiscalDb.deleteRegraFiscal(id);
        return sendJson(res, { success: true });
      }

      if (pathname === '/api/fiscal/nfe' && req.method === 'GET') {
        const estabelecimentoId = url.searchParams.get('estabelecimentoId') || undefined;
        const records = await fiscalDb.getNfeRecords(estabelecimentoId);
        return sendJson(res, { records });
      }

      // Eventos do estabelecimento inteiro. A inutilização de numeração só
      // aparece por aqui: ela não pertence a nenhuma nota (nfe_id nulo), então
      // a consulta por nota nunca a encontrava.
      if (pathname === '/api/fiscal/eventos' && req.method === 'GET') {
        const estabelecimentoId = url.searchParams.get('estabelecimentoId') || undefined;
        const tipoBruto = String(url.searchParams.get('tipo') || '').toUpperCase();
        const tipo = ['CCE', 'CANCELAMENTO', 'INUTILIZACAO'].includes(tipoBruto) ? tipoBruto : undefined;
        const eventos = await fiscalDb.getEventosFiscais({ estabelecimentoId, tipo });
        return sendJson(res, { eventos });
      }

      if (pathname === '/api/fiscal/nfe/emitir' && req.method === 'POST') {
        const body = await readBody(req);
        const nfe = await emitirNfeFiscal(body, user);
        return sendJson(res, { success: true, nfe });
      }

      if (pathname.startsWith('/api/fiscal/nfe/') && pathname.endsWith('/cancelar') && req.method === 'POST') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/nfe/', '').replace('/cancelar', ''));
        const body = await readBody(req);
        // `extemporaneo` precisa vir DECLARADO pela tela. Sem isso, a única
        // forma de o servidor saber que quem chamou aceitou o risco seria
        // adivinhar pelo prazo — e aí a trava não travaria nada.
        const nfe = await cancelarNfeFiscal(id, body.justificativa || '', user, { extemporaneo: body.extemporaneo === true });
        return sendJson(res, { success: true, nfe });
      }

      if (pathname.startsWith('/api/fiscal/nfe/') && pathname.endsWith('/cce') && req.method === 'POST') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/nfe/', '').replace('/cce', ''));
        const body = await readBody(req);
        const evento = await emitirCartaCorrecaoFiscal(id, body.correcao || '', user);
        return sendJson(res, { success: true, evento });
      }

      if (pathname.startsWith('/api/fiscal/nfe/') && pathname.endsWith('/eventos') && req.method === 'GET') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/nfe/', '').replace('/eventos', ''));
        const eventos = await fiscalDb.getNfeEventos(id);
        return sendJson(res, { eventos });
      }

      if (pathname === '/api/fiscal/inutilizar' && req.method === 'POST') {
        const body = await readBody(req);
        const evento = await inutilizarNumeracaoFiscal(body, user);
        return sendJson(res, { success: true, evento });
      }

      if (pathname.startsWith('/api/fiscal/nfe/') && (pathname.endsWith('/xml') || pathname.endsWith('/danfe')) && req.method === 'GET') {
        const tipo = pathname.endsWith('/xml') ? 'xml' : 'danfe';
        const id = decodeURIComponent(pathname.replace('/api/fiscal/nfe/', '').replace(`/${tipo}`, ''));
        const arquivo = await fiscalDb.getNfeArquivo(id, tipo);
        if (!arquivo || !arquivo.conteudo) {
          return sendJson(res, { error: `${tipo.toUpperCase()} ainda não disponível para esta NF-e (só existe depois de autorizada).` }, 404);
        }
        res.writeHead(200, {
          'Content-Type': tipo === 'xml' ? 'application/xml; charset=utf-8' : 'application/pdf',
          'Content-Disposition': `inline; filename="nfe-${id}.${tipo === 'xml' ? 'xml' : 'pdf'}"`
        });
        return res.end(arquivo.conteudo);
      }

      // Ler a NF-e RECONSULTA a SEFAZ quando ela ainda está em trânsito.
      //
      // A emissão assíncrona devolve 202 e a Focus avisa o desfecho por
      // webhook. Quando o webhook não chega — não registrado, URL fora do ar,
      // servidor local sem endereço público — a nota fica em PROCESSANDO para
      // sempre. A tela tem a ação "Consultar Status" justamente para isso, e
      // ela chamava ESTA rota, que só relia o banco: o botão respondia
      // "Nenhuma mudança de status" e parecia confirmar que estava tudo bem.
      //
      // Encontrado emitindo em homologação em 14/08/2026: a nota estava
      // AUTORIZADA na SEFAZ havia minutos, com chave e protocolo, e o sistema
      // insistia em PROCESSANDO — o pior tipo de erro, porque a tela mostrava
      // uma resposta tranquilizadora.
      if (pathname.startsWith('/api/fiscal/nfe/') && req.method === 'GET') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/nfe/', ''));
        let nfe = await fiscalDb.getNfeById(id);
        if (!nfe) return sendJson(res, { error: 'NF-e não encontrada' }, 404);

        // Só PROCESSANDO reconsulta. Autorizada e cancelada são desfechos
        // finais, e nota do Financeiro sem referência nunca foi transmitida —
        // consultar as três seria uma ida à Focus por linha de listagem.
        if (nfe.status === 'PROCESSANDO' && nfe.referencia && nfe.estabelecimentoId) {
          try {
            const client = await focusNfe.forEstabelecimento(nfe.estabelecimentoId);
            const resposta = await client.consultarNfe(nfe.referencia);
            nfe = await aplicarRespostaFocusNaNfe(nfe, resposta, user);
          } catch (error) {
            // Falha ao consultar NÃO é falha ao ler: a nota continua existindo
            // e o usuário continua vendo o que já havia. Devolver 500 aqui
            // esconderia a nota inteira por causa de uma instabilidade de rede.
            console.error('Falha ao reconsultar NF-e', id, error.message);
          }
        }
        return sendJson(res, { nfe });
      }
    } catch (error) {
      const status = error.status || 500;
      return sendJson(res, { error: error.message || 'Erro ao processar dados fiscais' }, status);
    }
  }

  if (pathname === '/api/cadastros/pessoas' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const document = sanitizeDigits(body.document || '');
      const type = body.type || (document.length === 14 ? 'pessoa-juridica' : 'pessoa-fisica');

      if (!isValidDocument(document)) {
        return sendJson(res, { error: 'CPF/CNPJ inválido. Não foi possível concluir o cadastro.' }, 400);
      }

      let officialData = null;
      if (type === 'pessoa-juridica' && body.lookupCnpj !== false) {
        try {
          officialData = await fetchCnpjOfficialData(document);
        } catch (error) {
          officialData = null;
        }
      }

      const person = {
        id: body.id || createId('pes'),
        ...body,
        type,
        document,
        name: (officialData && officialData.razaoSocial) || body.name || '',
        tradeName: (officialData && officialData.nomeFantasia) || body.tradeName || '',
        email: body.email || (officialData?.contatos || []).find((contact) => contact.type === 'email')?.value || '',
        phone: body.phone || (officialData?.contatos || []).find((contact) => contact.type === 'phone')?.value || '',
        address: (officialData && officialData.enderecoCompleto) || body.address || '',
        city: (officialData && officialData.endereco?.cidade) || body.city || '',
        state: (officialData && officialData.endereco?.estado) || body.state || '',
        zipCode: (officialData && officialData.endereco?.cep) || body.zipCode || '',
        neighborhood: (officialData && officialData.endereco?.bairro) || body.neighborhood || '',
        addressNumber: (officialData && officialData.endereco?.numero) || body.addressNumber || '',
        addressComplement: (officialData && officialData.endereco?.complemento) || body.addressComplement || '',
        registrationStatus: (officialData && officialData.situacaoCadastral) || body.registrationStatus || '',
        mainCnae: (officialData && officialData.cnaePrincipal) || body.mainCnae || '',
        openingDate: (officialData && officialData.dataAbertura) || body.openingDate || '',
        contacts: (officialData && officialData.contatos) || body.contacts || [],
        cnpjVerifiedAt: officialData ? new Date().toISOString() : null,
        createdAt: body.createdAt || new Date().toISOString()
      };

      const missingFields = validateRequiredRegistrationFields(person);
      if (missingFields.length) {
        return sendJson(res, { error: `Preencha os campos obrigatórios: ${missingFields.join(', ')}.` }, 400);
      }

      const duplicateMessage = findDuplicateRegistration(data, person);
      if (duplicateMessage) {
        return sendJson(res, { error: duplicateMessage }, 409);
      }

      const created = await db.createPerson(person);
      return sendJson(res, { success: true, person: created });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar pessoa' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/pessoas/') && req.method === 'PUT') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const id = decodeURIComponent(pathname.replace('/api/cadastros/pessoas/', ''));
      const index = data.people.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return sendJson(res, { error: 'Pessoa não encontrada' }, 404);
      }

      const body = await readBody(req);
      const current = data.people[index];
      const document = sanitizeDigits(body.document ?? current.document ?? '');
      const type = body.type || current.type || (document.length === 14 ? 'pessoa-juridica' : 'pessoa-fisica');

      if (!isValidDocument(document)) {
        return sendJson(res, { error: 'CPF/CNPJ inválido. Não foi possível concluir o cadastro.' }, 400);
      }

      let officialData = null;
      if (type === 'pessoa-juridica' && body.lookupCnpj !== false) {
        try {
          officialData = await fetchCnpjOfficialData(document);
        } catch (error) {
          officialData = null;
        }
      }

      const person = {
        ...current,
        ...body,
        id: current.id,
        type,
        document,
        code: current.code,
        name: (officialData && officialData.razaoSocial) || body.name || current.name || '',
        tradeName: (officialData && officialData.nomeFantasia) || body.tradeName || current.tradeName || '',
        email: body.email || (officialData?.contatos || []).find((contact) => contact.type === 'email')?.value || current.email || '',
        phone: body.phone || (officialData?.contatos || []).find((contact) => contact.type === 'phone')?.value || current.phone || '',
        address: (officialData && officialData.enderecoCompleto) || body.address || current.address || '',
        city: (officialData && officialData.endereco?.cidade) || body.city || current.city || '',
        state: (officialData && officialData.endereco?.estado) || body.state || current.state || '',
        zipCode: (officialData && officialData.endereco?.cep) || body.zipCode || current.zipCode || '',
        neighborhood: (officialData && officialData.endereco?.bairro) || body.neighborhood || current.neighborhood || '',
        addressNumber: (officialData && officialData.endereco?.numero) || body.addressNumber || current.addressNumber || '',
        addressComplement: (officialData && officialData.endereco?.complemento) || body.addressComplement || current.addressComplement || '',
        registrationStatus: (officialData && officialData.situacaoCadastral) || body.registrationStatus || current.registrationStatus || '',
        mainCnae: (officialData && officialData.cnaePrincipal) || body.mainCnae || current.mainCnae || '',
        openingDate: (officialData && officialData.dataAbertura) || body.openingDate || current.openingDate || '',
        contacts: (officialData && officialData.contatos) || body.contacts || current.contacts || [],
        cnpjVerifiedAt: officialData ? new Date().toISOString() : current.cnpjVerifiedAt || null,
        createdAt: current.createdAt || new Date().toISOString()
      };

      const missingFields = validateRequiredRegistrationFields(person);
      if (missingFields.length) {
        return sendJson(res, { error: `Preencha os campos obrigatórios: ${missingFields.join(', ')}.` }, 400);
      }

      const duplicateMessage = findDuplicateRegistration(data, person, person.id);
      if (duplicateMessage) {
        return sendJson(res, { error: duplicateMessage }, 409);
      }

      const updated = await db.updatePerson(id, person);
      return sendJson(res, { success: true, person: updated });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao atualizar pessoa' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/pessoas/') && req.method === 'DELETE') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }

    const id = decodeURIComponent(pathname.replace('/api/cadastros/pessoas/', ''));
    const existing = await db.getPersonById(id);
    if (!existing) {
      return sendJson(res, { error: 'Pessoa não encontrada' }, 404);
    }

    // Fase BB: a checagem pergunta ao BANCO o que mora no banco (lançamentos,
    // equipamentos) e ao db.json o que mora nele (contatos, tarefas,
    // agendamentos). Ver contrapartidaEmUso.
    const pessoaEmUso = await contrapartidaEmUso(id);
    if (pessoaEmUso) {
      return sendJson(res, { error: pessoaEmUso }, 409);
    }

    await db.deletePerson(id);
    return sendJson(res, { success: true });
  }

  if (pathname === '/api/cadastros/cnpjs' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const cnpj = sanitizeDigits(body.document);
      if (!isValidCnpj(cnpj)) {
        return sendJson(res, { error: 'CNPJ inválido. Não foi possível concluir o cadastro.' }, 400);
      }

      let cnpjValidation = null;
      if (body.lookupCnpj !== false) {
        try {
          cnpjValidation = await fetchCnpjOfficialData(cnpj);
        } catch (error) {
          cnpjValidation = null;
        }
      }

      const company = {
        id: body.id || createId('cnpj'),
        ...body,
        type: 'pessoa-juridica',
        document: cnpj,
        name: (cnpjValidation && cnpjValidation.razaoSocial) || body.name || '',
        tradeName: (cnpjValidation && cnpjValidation.nomeFantasia) || body.tradeName || '',
        email: body.email || (cnpjValidation?.contatos || []).find((contact) => contact.type === 'email')?.value || '',
        phone: body.phone || (cnpjValidation?.contatos || []).find((contact) => contact.type === 'phone')?.value || '',
        address: (cnpjValidation && cnpjValidation.enderecoCompleto) || body.address || '',
        city: (cnpjValidation && cnpjValidation.endereco?.cidade) || body.city || '',
        state: (cnpjValidation && cnpjValidation.endereco?.estado) || body.state || '',
        zipCode: (cnpjValidation && cnpjValidation.endereco?.cep) || body.zipCode || '',
        neighborhood: (cnpjValidation && cnpjValidation.endereco?.bairro) || body.neighborhood || '',
        addressNumber: (cnpjValidation && cnpjValidation.endereco?.numero) || body.addressNumber || '',
        addressComplement: (cnpjValidation && cnpjValidation.endereco?.complemento) || body.addressComplement || '',
        registrationStatus: (cnpjValidation && cnpjValidation.situacaoCadastral) || body.registrationStatus || '',
        mainCnae: (cnpjValidation && cnpjValidation.cnaePrincipal) || body.mainCnae || '',
        openingDate: (cnpjValidation && cnpjValidation.dataAbertura) || body.openingDate || '',
        contacts: (cnpjValidation && cnpjValidation.contatos) || body.contacts || [],
        notes: body.notes || '',
        status: body.status || 'ativo',
        cnpjVerifiedAt: cnpjValidation ? new Date().toISOString() : null,
        createdAt: body.createdAt || new Date().toISOString()
      };

      const missingFields = validateRequiredRegistrationFields(company);
      if (missingFields.length) {
        return sendJson(res, { error: `Preencha os campos obrigatórios: ${missingFields.join(', ')}.` }, 400);
      }

      const duplicateMessage = findDuplicateRegistration(data, company);
      if (duplicateMessage) {
        return sendJson(res, { error: duplicateMessage }, 409);
      }

      const created = await db.createCnpj(company);
      return sendJson(res, { success: true, company: created });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar CNPJ' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/cnpjs/') && req.method === 'PUT') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const id = decodeURIComponent(pathname.replace('/api/cadastros/cnpjs/', ''));
      const index = data.cnpjs.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return sendJson(res, { error: 'CNPJ não encontrado' }, 404);
      }

      const body = await readBody(req);
      const current = data.cnpjs[index];
      const cnpj = sanitizeDigits(body.document ?? current.document ?? '');
      if (!isValidCnpj(cnpj)) {
        return sendJson(res, { error: 'CNPJ inválido. Não foi possível concluir o cadastro.' }, 400);
      }

      let cnpjValidation = null;
      if (body.lookupCnpj !== false) {
        try {
          cnpjValidation = await fetchCnpjOfficialData(cnpj);
        } catch (error) {
          cnpjValidation = null;
        }
      }

      const company = {
        ...current,
        ...body,
        id: current.id,
        type: 'pessoa-juridica',
        document: cnpj,
        code: current.code,
        name: (cnpjValidation && cnpjValidation.razaoSocial) || body.name || current.name || '',
        tradeName: (cnpjValidation && cnpjValidation.nomeFantasia) || body.tradeName || current.tradeName || '',
        email: body.email || (cnpjValidation?.contatos || []).find((contact) => contact.type === 'email')?.value || current.email || '',
        phone: body.phone || (cnpjValidation?.contatos || []).find((contact) => contact.type === 'phone')?.value || current.phone || '',
        address: (cnpjValidation && cnpjValidation.enderecoCompleto) || body.address || current.address || '',
        city: (cnpjValidation && cnpjValidation.endereco?.cidade) || body.city || current.city || '',
        state: (cnpjValidation && cnpjValidation.endereco?.estado) || body.state || current.state || '',
        zipCode: (cnpjValidation && cnpjValidation.endereco?.cep) || body.zipCode || current.zipCode || '',
        neighborhood: (cnpjValidation && cnpjValidation.endereco?.bairro) || body.neighborhood || current.neighborhood || '',
        addressNumber: (cnpjValidation && cnpjValidation.endereco?.numero) || body.addressNumber || current.addressNumber || '',
        addressComplement: (cnpjValidation && cnpjValidation.endereco?.complemento) || body.addressComplement || current.addressComplement || '',
        registrationStatus: (cnpjValidation && cnpjValidation.situacaoCadastral) || body.registrationStatus || current.registrationStatus || '',
        mainCnae: (cnpjValidation && cnpjValidation.cnaePrincipal) || body.mainCnae || current.mainCnae || '',
        openingDate: (cnpjValidation && cnpjValidation.dataAbertura) || body.openingDate || current.openingDate || '',
        contacts: (cnpjValidation && cnpjValidation.contatos) || body.contacts || current.contacts || [],
        notes: body.notes || current.notes || '',
        status: body.status || current.status || 'ativo',
        cnpjVerifiedAt: cnpjValidation ? new Date().toISOString() : current.cnpjVerifiedAt || null,
        createdAt: current.createdAt || new Date().toISOString()
      };

      const missingFields = validateRequiredRegistrationFields(company);
      if (missingFields.length) {
        return sendJson(res, { error: `Preencha os campos obrigatórios: ${missingFields.join(', ')}.` }, 400);
      }

      const duplicateMessage = findDuplicateRegistration(data, company, company.id);
      if (duplicateMessage) {
        return sendJson(res, { error: duplicateMessage }, 409);
      }

      const updated = await db.updateCnpj(id, company);
      return sendJson(res, { success: true, company: updated });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao atualizar CNPJ' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/cnpjs/') && req.method === 'DELETE') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }

    const id = decodeURIComponent(pathname.replace('/api/cadastros/cnpjs/', ''));
    const existing = await db.getCnpjById(id);
    if (!existing) {
      return sendJson(res, { error: 'CNPJ não encontrado' }, 404);
    }

    const cnpjEmUso = await contrapartidaEmUso(id);
    if (cnpjEmUso) {
      return sendJson(res, { error: cnpjEmUso }, 409);
    }

    await db.deleteCnpj(id);
    return sendJson(res, { success: true });
  }

  // Metadados dos cadastros: diretório de pessoas/empresas, produtos, contas,
  // usuários — usados pelos selects das telas do módulo.
  if (pathname === '/api/cadastros/meta' && req.method === 'GET') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      // syncNfeData tambem: o cadastro de equipamento escolhe a NF-e que vendeu
      // a maquina, e e' dela que sai a data de inicio da garantia (fase BB).
      await Promise.all([syncFinanceData(data), syncNfeData(data)]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      let products = [];
      try {
        products = (await db.getProducts()).map((p) => ({ id: p.id, name: p.name, sku: p.sku, salePrice: p.salePrice }));
      } catch (error) {
        products = [];
      }
      return sendJson(res, {
        directory: cadastrosCore.directory(data),
        products,
        deposits: data.deposits,
        bankAccounts: data.bankAccounts,
        paymentMethods: data.paymentMethods,
        saleStatuses: data.saleStatuses,
        companies: data.companies,
        // OS USUARIOS VEM DO BANCO, e nao de `data.users` (fase BC).
        //
        // `normalizeData` APAGA data.users em toda carga, de proposito: era
        // residuo do modelo pre-Supabase, guardava senha em texto puro e nunca
        // foi lido. Este `map` sobre ele sempre devolveu [] — e os selects
        // "Responsavel" de Tarefas e de Agendamentos nunca tiveram uma opcao
        // sequer, sem nada na tela dizendo por que.
        //
        // So id e nome saem daqui: e' um select, e o resto do cadastro de
        // usuario (papel, permissoes, hash de senha) nao tem por que trafegar.
        users: (await db.getUsers().catch(() => []))
          .filter((u) => u.active !== false)
          .map((u) => ({ id: u.id, name: u.name })),
        // Fase BB: as notas que o cadastro de equipamento pode escolher.
        //
        // SO AS QUE VALEM COMO DOCUMENTO. Nota cancelada, denegada ou que
        // terminou em erro nao vendeu nada — contar garantia a partir dela seria
        // contar a partir de uma venda que nao existiu.
        //
        // O rotulo carrega numero, data e destinatario porque e' assim que
        // alguem acha a nota certa numa lista: pelo cliente e pelo dia, nao pelo
        // uuid.
        notasFiscais: notasParaEquipamento(data)
      });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao carregar dados dos cadastros' }, 500);
    }
  }

  // Cashback precisa do nome do produto, que vem do Supabase — por isso tem
  // listagem própria, fora do CRUD genérico abaixo.
  if (pathname === '/api/cadastros/product-cashbacks' && req.method === 'GET') {
    try {
      const data = loadData();
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      let productsById = new Map();
      try {
        // Índice de RESOLUÇÃO: completo, inclusive escriturais. Quem lê um
        // registro antigo precisa achar o produto, mesmo o que não é mercadoria.
        productsById = new Map((await db.getProducts({ incluirEscriturais: true })).map((p) => [p.id, p]));
      } catch (error) {
        productsById = new Map();
      }
      const cashbacks = (data.productCashbacks || [])
        .map((item) => {
          const product = productsById.get(item.productId);
          return {
            ...item,
            productName: product ? product.name : '(produto removido)',
            productSku: product ? product.sku : '',
            salePrice: product ? product.salePrice : 0,
            estimatedReturn: item.type === 'percentual'
              ? (Number(product ? product.salePrice : 0) * Number(item.value || 0)) / 100
              : Number(item.value || 0)
          };
        })
        .sort((a, b) => String(a.productName).localeCompare(String(b.productName)));
      return sendJson(res, { cashbacks });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar cashback' }, 500);
    }
  }

  // CRUD genérico dos cadastros auxiliares (contatos, equipamentos, formas de
  // pagamento, status de venda, cashback, agenda, agendamentos, contas e
  // empresas). Pessoas/CNPJs continuam com as rotas próprias.
  // `bank-accounts` SAIU DESTA LISTA (fase BA), e e' o unico que saiu.
  //
  // Esta rota grava em data[colecao] e chama saveData. `bankAccounts` esta em
  // NAO_PERSISTIR desde que o db.json parou de guardar copia do que e' do
  // Postgres — entao saveData removia a colecao e ninguem gravava no banco. A
  // rota respondia `success: true` com o registro completo e a conta nao
  // existia em lugar nenhum. As rotas proprias estao logo abaixo.
  const cadastroCollectionMatch = pathname.match(/^\/api\/cadastros\/(contacts|payment-methods|sale-statuses|product-cashbacks|tasks|appointments|companies)(?:\/([^/]+))?$/);
  if (cadastroCollectionMatch) {
    try {
      const data = loadData();
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const config = cadastrosCore.CADASTRO_COLLECTIONS[cadastroCollectionMatch[1]];
      const id = cadastroCollectionMatch[2] ? decodeURIComponent(cadastroCollectionMatch[2]) : '';
      const list = data[config.key];
      const helpers = { sanitizeDigits, isValidCnpj, isValidCpf, isValidDocument };
      const serialize = (item) => (config.serialize ? config.serialize(item, data) : item);

      if (req.method === 'GET' && !id) {
        const ordered = list.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        return sendJson(res, { [config.listKey]: ordered.map(serialize) });
      }

      if (req.method === 'GET') {
        const item = list.find((entry) => entry.id === id);
        if (!item) return sendJson(res, { error: config.notFound }, 404);
        return sendJson(res, { [config.itemKey]: serialize(item) });
      }

      if (req.method === 'POST' && !id) {
        const body = await readBody(req);
        const built = config.build(body, null, data, helpers);
        if (built.code && list.some((entry) => String(entry.code || '').toLowerCase() === String(built.code).toLowerCase())) {
          return sendJson(res, { error: 'Já existe um registro com este código.' }, 409);
        }
        const duplicated = config.duplicate ? config.duplicate(built, data, null) : null;
        if (duplicated) return sendJson(res, { error: duplicated }, 409);
        const item = {
          id: cadastrosCore.createId(config.prefix),
          ...built,
          createdBy: user.id,
          createdByName: user.name,
          createdAt: new Date().toISOString()
        };
        list.push(item);
        if (config.afterSave) config.afterSave(item, data);
        saveData(data);
        return sendJson(res, { success: true, [config.itemKey]: serialize(item) });
      }

      if (req.method === 'PUT' && id) {
        const index = list.findIndex((entry) => entry.id === id);
        if (index < 0) return sendJson(res, { error: config.notFound }, 404);
        const body = await readBody(req);
        const built = config.build(body, list[index], data, helpers);
        if (built.code && list.some((entry) => entry.id !== id && String(entry.code || '').toLowerCase() === String(built.code).toLowerCase())) {
          return sendJson(res, { error: 'Já existe um registro com este código.' }, 409);
        }
        const duplicated = config.duplicate ? config.duplicate(built, data, id) : null;
        if (duplicated) return sendJson(res, { error: duplicated }, 409);
        const item = { ...list[index], ...built, updatedAt: new Date().toISOString() };
        list[index] = item;
        if (config.afterSave) config.afterSave(item, data);
        saveData(data);
        return sendJson(res, { success: true, [config.itemKey]: serialize(item) });
      }

      if (req.method === 'DELETE' && id) {
        const index = list.findIndex((entry) => entry.id === id);
        if (index < 0) return sendJson(res, { error: config.notFound }, 404);
        // A GUARDA DA EMPRESA PERGUNTA AO BANCO (fase BO).
        //
        // config.inUse varre data.orders e data.quotes, que estao em
        // NAO_PERSISTIR e que esta rota nunca sincroniza — ela respondia
        // SEMPRE "nao esta em uso". A empresa saia levando junto a
        // explicacao de todo pedido faturado por ela, e os depositos dela
        // ficavam apontando para um id que nao existe mais.
        //
        // Mesmo caminho de contrapartidaEmUso e depositoEmUso: contagem no
        // Postgres, e nao varredura de colecao em memoria.
        if (cadastroCollectionMatch[1] === 'companies') {
          const emUso = await empresaEmUso(id);
          if (emUso) return sendJson(res, { error: emUso }, 409);
        }
        const blocked = config.inUse(id, data);
        if (blocked) return sendJson(res, { error: blocked }, 409);
        list.splice(index, 1);
        saveData(data);
        return sendJson(res, { success: true });
      }
    } catch (error) {
      return sendJson(res, { error: error.status ? error.message : 'Erro ao salvar cadastro' }, error.status || 400);
    }
  }

  // =========================================================================
  // CONTAS BANCARIAS (fase BA). Postgres, e nao db.json.
  //
  // A forma da resposta e' identica a da rota generica de cadastros
  // (`bankAccounts` na lista, `bankAccount` no item) porque a tela e' a mesma:
  // Cadastros > Contas Bancarias, montada pela fabrica makeListScreen. Mudou
  // onde o dado mora, nao o contrato.
  // =========================================================================

  // =========================================================================
  // EQUIPAMENTOS (fase BB). Postgres, e a garantia CONTADA a partir da NF-e.
  //
  // A forma da resposta e' a mesma da rota generica de cadastros (`equipments`
  // na lista, `equipment` no item): a tela e' a mesma, montada pela fabrica
  // makeListScreen. Mudou onde o dado mora e de onde a garantia sai — nao o
  // contrato.
  // =========================================================================

  const equipamentoMatch = pathname.match(/^\/api\/cadastros\/equipments(?:\/([^/]+))?$/);
  if (equipamentoMatch) {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = equipamentoMatch[1] ? decodeURIComponent(equipamentoMatch[1]) : '';

      // As notas, para resolver numero e data de cada equipamento. Uma vez por
      // requisicao, e nao uma consulta por linha da lista.
      const dados = loadData();
      await Promise.all([syncCadastroData(dados), syncNfeData(dados)]);

      if (req.method === 'GET' && !id) {
        const lista = await equipamentosDb.listar();
        return sendJson(res, { equipments: lista.map((e) => serializarEquipamento(e, dados)) });
      }

      if (req.method === 'GET') {
        const item = await equipamentosDb.obter(id);
        if (!item) return sendJson(res, { error: 'Equipamento não encontrado.' }, 404);
        return sendJson(res, { equipment: serializarEquipamento(item, dados) });
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        const atual = id ? await equipamentosDb.obter(id) : null;
        if (id && !atual) return sendJson(res, { error: 'Equipamento não encontrado.' }, 404);
        const body = await readBody(req);

        // A MONTAGEM E VALIDACAO CONTINUAM NO cadastros-core: e' o mesmo
        // formulario, com as mesmas regras. Copiar aqui deixaria as duas
        // metades divergirem na primeira mudanca.
        const config = cadastrosCore.CADASTRO_COLLECTIONS.equipments;
        const helpers = { sanitizeDigits, isValidCnpj, isValidCpf, isValidDocument };
        const built = config.build(body, atual, dados, helpers);

        // Codigo interno repetido — a rota generica conferia isto para todas as
        // colecoes, e a conferencia veio junto. Contra o BANCO, e nao contra
        // `data.equipments`, que nesta rota chega vazio de proposito.
        const todos = await equipamentosDb.listar();
        if (built.code && todos.some((e) => e.id !== id
          && String(e.code || '').toLowerCase() === String(built.code).toLowerCase())) {
          return sendJson(res, { error: 'Já existe um registro com este código.' }, 409);
        }

        // A NOTA PRECISA EXISTIR. Sem isto, um id errado deixaria a garantia
        // sendo contada a partir de lugar nenhum, sem nada na tela explicando.
        const nota = notaDoEquipamento(built.nfeId, dados);
        if (built.nfeId && !nota) {
          return sendJson(res, { error: 'NF-e não encontrada.' }, 404);
        }

        const equipamento = id
          ? await equipamentosDb.atualizar(id, built, nota)
          : await equipamentosDb.criar(built, nota, user);
        return sendJson(res, { success: true, equipment: serializarEquipamento(equipamento, dados) });
      }

      if (req.method === 'DELETE' && id) {
        const item = await equipamentosDb.obter(id);
        if (!item) return sendJson(res, { error: 'Equipamento não encontrado.' }, 404);
        await equipamentosDb.excluir(id);
        return sendJson(res, { success: true });
      }
    } catch (error) {
      return sendJson(res, { error: error.status ? error.message : 'Erro ao salvar o equipamento' }, error.status || 400);
    }
  }

  const contaBancariaMatch = pathname.match(/^\/api\/cadastros\/bank-accounts(?:\/([^/]+))?$/);
  if (contaBancariaMatch) {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = contaBancariaMatch[1] ? decodeURIComponent(contaBancariaMatch[1]) : '';

      if (req.method === 'GET' && !id) {
        return sendJson(res, { bankAccounts: await db.getBankAccounts() });
      }

      if (req.method === 'GET') {
        const conta = await db.getBankAccountById(id);
        if (!conta) return sendJson(res, { error: 'Conta bancária não encontrada.' }, 404);
        return sendJson(res, { bankAccount: conta });
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        const atual = id ? await db.getBankAccountById(id) : null;
        if (id && !atual) return sendJson(res, { error: 'Conta bancária não encontrada.' }, 404);
        const body = await readBody(req);

        // A MONTAGEM E VALIDACAO CONTINUAM NO cadastros-core, e nao copiadas
        // aqui: e' o mesmo formulario, com as mesmas regras (nome obrigatorio,
        // CPF/CNPJ do titular valido, tipo e status dentro da lista). Duplicar
        // deixaria as duas metades divergirem na primeira mudanca.
        const config = cadastrosCore.CADASTRO_COLLECTIONS['bank-accounts'];
        const helpers = { sanitizeDigits, isValidCnpj, isValidCpf, isValidDocument };
        const built = config.build(body, atual, loadData(), helpers);

        // Duplicata: mesma conta (banco + agencia + numero) ja cadastrada. A
        // checagem e' contra o BANCO, e nao contra `data.bankAccounts`, que
        // nesta rota chegaria vazio — era parte do mesmo bug.
        const todas = await db.getBankAccounts();
        if (built.agency && built.number) {
          const igual = todas.find((c) => c.id !== id
            && String(c.bank || '').toLowerCase() === String(built.bank || '').toLowerCase()
            && String(c.agency || '') === built.agency
            && String(c.number || '') === built.number);
          if (igual) {
            return sendJson(res, { error: 'Já existe uma conta com este banco, agência e número.' }, 409);
          }
        }

        // `status` do formulario e' ativo/inativo (o CADASTRO). A coluna
        // `status` da tabela guarda o estado da CONEXAO Open Finance — ver a
        // migracao fase-ba. Por isso vira `ativo`, e o `status` nao e' mandado.
        const payload = { ...built, ativo: built.status !== 'inativo' };
        delete payload.status;

        const bankAccount = id
          ? await db.updateBankAccount(id, payload)
          : await db.createBankAccount(payload);
        return sendJson(res, { success: true, bankAccount });
      }

      if (req.method === 'DELETE' && id) {
        const conta = await db.getBankAccountById(id);
        if (!conta) return sendJson(res, { error: 'Conta bancária não encontrada.' }, 404);

        // Conta usada em lancamento, baixa ou extrato nao pode sumir sem
        // quebrar o Financeiro. A conferencia le o BANCO — a mesma regra do
        // cadastros-core, sobre a fonte certa.
        const dados = loadData();
        await syncFinanceData(dados);
        const bloqueio = cadastrosCore.CADASTRO_COLLECTIONS['bank-accounts'].inUse(id, dados);
        if (bloqueio) return sendJson(res, { error: bloqueio }, 409);

        await db.deleteBankAccount(id);
        return sendJson(res, { success: true });
      }
    } catch (error) {
      return sendJson(res, { error: error.status ? error.message : 'Erro ao salvar a conta bancária' }, error.status || 400);
    }
  }

  if (pathname === '/api/cadastros/deposits' && req.method === 'GET') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { deposits: await db.getDeposits() });
  }

  if (pathname === '/api/cadastros/deposits' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome do depósito.' }, 400);
      }
      const code = String(body.code || '').trim();
      const deposits = await db.getDeposits();
      if (code && deposits.some((entry) => entry.code && entry.code.toLowerCase() === code.toLowerCase())) {
        return sendJson(res, { error: 'Já existe um depósito com este código interno.' }, 409);
      }
      // Fase AW: a loja do deposito. Conferida contra o cadastro em vez de
      // aceita crua — id de empresa que nao existe deixaria o deposito orfao de
      // um jeito que nenhuma tela explica.
      const companyId = String(body.companyId ?? '' ?? '').trim();
      if (companyId && !(loadData().companies || []).some((c) => c.id === companyId)) {
        return sendJson(res, { error: 'Empresa não encontrada.' }, 404);
      }
      const created = await db.createDeposit({
        name,
        code,
        companyId,
        status: String(body.status || 'ativo').trim() || 'ativo',
        address: body.address || '',
        city: body.city || '',
        state: body.state || '',
        manager: body.manager || '',
        notes: body.notes || ''
      });
      return sendJson(res, { success: true, deposit: created });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar depósito' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/deposits/') && req.method === 'PUT') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/cadastros/deposits/', ''));
      const deposits = await db.getDeposits();
      const current = deposits.find((entry) => entry.id === id);
      if (!current) {
        return sendJson(res, { error: 'Depósito não encontrado' }, 404);
      }
      const body = await readBody(req);
      const name = String(body.name ?? current.name ?? '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome do depósito.' }, 400);
      }
      const code = String(body.code ?? current.code ?? '').trim();
      if (code && deposits.some((entry) => entry.id !== id && entry.code && entry.code.toLowerCase() === code.toLowerCase())) {
        return sendJson(res, { error: 'Já existe um depósito com este código interno.' }, 409);
      }
      // Fase AW: a loja do deposito. Conferida contra o cadastro em vez de
      // aceita crua — id de empresa que nao existe deixaria o deposito orfao de
      // um jeito que nenhuma tela explica.
      const companyId = String(body.companyId ?? current.companyId ?? '').trim();
      if (companyId && !(loadData().companies || []).some((c) => c.id === companyId)) {
        return sendJson(res, { error: 'Empresa não encontrada.' }, 404);
      }
      const updated = await db.updateDeposit(id, {
        name,
        code,
        companyId,
        status: String(body.status ?? current.status ?? 'ativo').trim() || 'ativo',
        address: body.address ?? current.address ?? '',
        city: body.city ?? current.city ?? '',
        state: body.state ?? current.state ?? '',
        manager: body.manager ?? current.manager ?? '',
        notes: body.notes ?? current.notes ?? ''
      });
      return sendJson(res, { success: true, deposit: updated });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao atualizar depósito' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/deposits/') && req.method === 'DELETE') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.replace('/api/cadastros/deposits/', ''));
    const deposits = await db.getDeposits();
    if (!deposits.some((entry) => entry.id === id)) {
      return sendJson(res, { error: 'Depósito não encontrado' }, 404);
    }
    const bloqueio = await depositoEmUso(id);
    if (bloqueio) {
      return sendJson(res, { error: bloqueio }, 409);
    }
    await db.deleteDeposit(id);
    return sendJson(res, { success: true });
  }

  // As rotas /api/cadastros/empresas (GET/POST/DELETE) viviam aqui. Foram
  // substituídas pelo handler genérico de coleções de cadastro mais acima
  // (cadastroCollectionMatch), que atende /api/cadastros/companies a partir do
  // descritor em lib/cadastros-core.js — que é o endpoint que a tela de
  // Empresas realmente chama. Ninguém chamava a versão em português.

  // --------------------------------------------------------------------------
  // ENTRADA DE NF-e — ver o bloco de comentário antes de conferirEntradaDeNfe().
  // Vêm ANTES de /api/purchases porque as rotas de compra casam por prefixo.
  // --------------------------------------------------------------------------

  if (pathname === '/api/purchases/entrada-nfe/analisar' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      if (!String(body.xml || '').trim()) {
        return sendJson(res, { error: 'Envie o XML da NF-e.' }, 400);
      }
      const { conferencia, data, produtos } = await conferirEntradaDeNfe(body.xml);
      // AS ORDENS EM ABERTO DESTE FORNECEDOR (fase AQ).
      //
      // Vai junto da analise porque e aqui que o sistema descobre de QUEM e a
      // nota. Pedir ao usuario para procurar a ordem numa segunda tela seria
      // devolver a ele um trabalho que o XML ja fez.
      //
      // So as nao recebidas e nao canceladas: ligar a nota a uma ordem ja
      // recebida seria oferecer justamente a entrada em dobro que a ligacao
      // existe para impedir.
      const ordensDoFornecedor = conferencia.fornecedor.cadastro
        ? (await comprasDb.listarDocumentos({ tipo: 'order' })).filter((doc) =>
            doc.supplierId === conferencia.fornecedor.cadastro.id
            && !doc.stockApplied
            && !doc.entradaNfeId
            && !purchaseStatus.ehCancelado(doc.status))
        : [];
      return sendJson(res, {
        ...conferencia,
        ordensAbertas: ordensDoFornecedor.map((doc) => ({
          id: doc.id, code: doc.code, date: doc.date, deliveryDate: doc.deliveryDate,
          totalAmount: doc.totalAmount, itens: doc.items.length, status: doc.status
        })),
        // A tela precisa da lista para vincular item na mão. Vai daqui, e não
        // de /api/stock/products, para que quem tem só Compras consiga
        // conferir a nota inteira — cadastrar produto novo continua sendo
        // do Estoque.
        produtos: produtos.map((p) => ({ id: p.id, name: p.name, sku: p.sku || '', ean: p.ean || '' })),
        depositos: (data.deposits || []).map((d) => ({ id: d.id, name: d.name })),
        permissoes: {
          cadastrarFornecedor: user.allowedModules.includes('cadastros'),
          cadastrarProduto: user.allowedModules.includes('stock')
        }
      });
    } catch (error) {
      const traduzido = traduzirErroDaEntrada(error);
      return sendJson(res, { error: traduzido.message || 'Não consegui ler o XML.' }, traduzido.status || 400);
    }
  }

  if (pathname === '/api/purchases/entrada-nfe' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      return sendJson(res, { entradas: await entradaNfeDb.listarEntradas({}) });
    } catch (error) {
      const traduzido = traduzirErroDaEntrada(error);
      return sendJson(res, { error: traduzido.message || 'Erro ao listar entradas' }, traduzido.status || 400);
    }
  }

  if (pathname.startsWith('/api/purchases/entrada-nfe/') && pathname.endsWith('/xml') && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/purchases/entrada-nfe/', '').replace('/xml', ''));
      const registro = await entradaNfeDb.obterXml(id);
      if (!registro) return sendJson(res, { error: 'Entrada não encontrada' }, 404);
      // O XML é o documento fiscal: entregue como arquivo, com o nome que a
      // contabilidade espera (a chave), não como texto solto na tela.
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${registro.chave}.xml"`
      });
      return res.end(registro.xml || '');
    } catch (error) {
      const traduzido = traduzirErroDaEntrada(error);
      return sendJson(res, { error: traduzido.message || 'Erro ao baixar o XML' }, traduzido.status || 400);
    }
  }

  if (pathname.startsWith('/api/purchases/entrada-nfe/') && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/purchases/entrada-nfe/', ''));
      const entrada = await entradaNfeDb.obterEntrada(id);
      if (!entrada) return sendJson(res, { error: 'Entrada não encontrada' }, 404);
      return sendJson(res, { entrada });
    } catch (error) {
      const traduzido = traduzirErroDaEntrada(error);
      return sendJson(res, { error: traduzido.message || 'Erro ao abrir a entrada' }, traduzido.status || 400);
    }
  }

  if (pathname === '/api/purchases/entrada-nfe' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      if (!String(body.xml || '').trim()) {
        return sendJson(res, { error: 'Envie o XML da NF-e.' }, 400);
      }

      // Releitura completa do XML: o que vale são os dados da nota lidos AQUI.
      const { conferencia, data, produtos } = await conferirEntradaDeNfe(body.xml);
      const nota = conferencia.nota;

      if (conferencia.bloqueios.length) {
        return sendJson(res, {
          error: conferencia.bloqueios.map((b) => b.mensagem).join(' '),
          bloqueios: conferencia.bloqueios
        }, 409);
      }

      const decisoes = decisoesDosItens(conferencia, body);
      const produtosPorId = new Map(produtos.map((p) => [p.id, p]));

      // ---- validação ANTES de gravar qualquer coisa -------------------------
      // Um item recusado no meio da gravação deixaria a nota lançada pela
      // metade: estoque de dois itens dentro, do terceiro fora, e nenhum aviso.
      for (const decisao of decisoes) {
        const rotulo = `Item ${decisao.item.numero} (${decisao.item.descricao})`;
        if (decisao.produtoId && !produtosPorId.has(decisao.produtoId)) {
          return sendJson(res, { error: `${rotulo}: o produto vinculado não existe mais.` }, 400);
        }
        if (!decisao.movimentarEstoque) continue;
        if (!decisao.depositoId) {
          return sendJson(res, { error: `${rotulo}: escolha o depósito antes de dar entrada no estoque.` }, 400);
        }
        let classesDoProduto = [];
        try {
          classesDoProduto = await classesDb.classesDoProduto(decisao.produtoId);
        } catch (erroClasses) {
          classesDoProduto = [];
        }
        try {
          assertMovementIsPossible(data, produtosPorId, {
            productId: decisao.produtoId,
            depositId: decisao.depositoId,
            type: 'entrada',
            quantity: decisao.item.quantidade,
            classValueId: '',
            classesDoProduto
          });
        } catch (erroMovimento) {
          // O XML não traz cor/voltagem: produto controlado por classe não tem
          // como entrar direto da nota. Dizer QUAL item trava é o que permite
          // desmarcar só ele e lançar o resto.
          return sendJson(res, { error: `${rotulo}: ${erroMovimento.message}` }, erroMovimento.status || 400);
        }
      }

      // A ORDEM DE COMPRA VINCULADA É CONFERIDA AQUI (fase BH).
      //
      // Estava depois do commitStockMovements, e as duas recusas devolviam 400
      // sem desfazer nada. O que ficava no banco depois de um "A ordem de
      // compra escolhida nao existe mais": a nota gravada como LANCADA com
      // movimentouEstoque e gerouFinanceiro em true, o razão lançado, o custo do
      // produto sobrescrito — e nenhuma conta a pagar, porque o bloco do
      // financeiro vem depois e nunca era alcançado. O próprio registro dizia
      // que o financeiro tinha sido gerado, então nenhuma conferência acusava a
      // falta. E refazer a nota era impossível: o reenvio do mesmo XML bate no
      // bloqueio de duplicidade por chave.
      //
      // A conferência aqui não dispensa a de dentro da transação, mais abaixo:
      // entre este ponto e o commit a ordem pode mudar. Esta existe para o
      // caso comum — recusar com o banco ainda intacto e uma mensagem que o
      // usuário pode agir sobre.
      let ordemDaNota = null;
      if (body.purchaseOrderId) {
        ordemDaNota = await comprasDb.obterDocumento(body.purchaseOrderId);
        if (!ordemDaNota) {
          return sendJson(res, { error: 'A ordem de compra escolhida não existe mais.' }, 400);
        }
        if (ordemDaNota.stockApplied) {
          return sendJson(res, {
            error: `A ordem ${ordemDaNota.code || ordemDaNota.id} já deu entrada no estoque por conta própria. `
              + 'Estorne o recebimento dela antes de ligar esta nota.'
          }, 400);
        }
      }

      const querFinanceiro = body.gerarFinanceiro !== false;
      const vaiMovimentar = decisoes.some((d) => d.movimentarEstoque);
      const status = decisoes.some((d) => !d.produtoId) ? 'REVISAR' : 'LANCADA';

      // ---- a nota --------------------------------------------------------
      const entrada = await entradaNfeDb.criarEntrada({
        entrada: {
          chave: nota.chave,
          modelo: nota.modelo,
          serie: nota.serie,
          numero: nota.numero,
          dataEmissao: nota.dataEmissao,
          naturezaOperacao: nota.naturezaOperacao,
          emitenteDocumento: nota.emitente.documento,
          emitenteNome: nota.emitente.nome,
          emitenteIe: nota.emitente.inscricaoEstadual,
          cadastroId: conferencia.fornecedor.cadastro ? conferencia.fornecedor.cadastro.id : '',
          destinatarioDocumento: nota.destinatario ? nota.destinatario.documento : '',
          valorProdutos: nota.totais.produtos || 0,
          valorTotal: nota.totais.nota || 0,
          status,
          movimentouEstoque: vaiMovimentar,
          gerouFinanceiro: querFinanceiro,
          xml: String(body.xml),
          resumo: nota,
          criadoPor: user.id,
          criadoPorNome: user.name
        },
        itens: decisoes.map((d) => ({
          numero: d.item.numero,
          codigo: d.item.codigo,
          ean: d.item.ean,
          descricao: d.item.descricao,
          ncm: d.item.ncm,
          cfop: d.item.cfop,
          unidade: d.item.unidade,
          quantidade: d.item.quantidade,
          valorUnitario: d.item.valorUnitario,
          valorTotal: d.item.valorTotal,
          produtoId: d.produtoId,
          vinculoOrigem: d.vinculoOrigem,
          movimentouEstoque: d.movimentarEstoque,
          imposto: { icms: d.item.icms, ipi: d.item.ipi, pis: d.item.pis, cofins: d.item.cofins }
        }))
      });

      // ---- estoque -------------------------------------------------------
      const movimentados = [];
      // Fase AP: os movimentos da nota sao juntados e gravados numa transacao
      // so, no fim. Antes cada um era empurrado no array e o total do produto
      // era atualizado por fora, num upsert absoluto — nota com 30 itens eram
      // 30 janelas para o processo morrer com metade do estoque lancado.
      const movimentosDaNota = [];
      for (const decisao of decisoes.filter((d) => d.movimentarEstoque)) {
        const produto = produtosPorId.get(decisao.produtoId);
        movimentosDaNota.push(buildMovementRecord(data, {
          type: 'entrada',
          productId: produto.id,
          depositId: decisao.depositoId,
          quantity: decisao.item.quantidade,
          unitCost: decisao.item.valorUnitario,
          date: nota.dataEmissao,
          document: `NF-e ${nota.numero}/${nota.serie}`,
          note: `Entrada da NF-e ${nota.numero} de ${nota.emitente.nome}`,
          origin: 'entrada-nfe'
        }, user));
        // O total NÃO se mexe aqui: quem soma é a transação do
        // commitStockMovements, junto com o razão. E não dá para usar
        // upsertProduct nem "só para o custo" — ele grava a linha inteira, e o
        // `...produto` levaria de volta o saldo lido ANTES desta nota.
        //
        // Custo do produto passa a ser o desta nota quando a tela pediu.
        // vUnCom é o preço da mercadoria: NÃO inclui frete, IPI nem ST. Custo
        // de reposição de verdade sai de rateio, e rateio é decisão de quem
        // apura — não de quem lança a nota.
        if (body.atualizarCusto !== false) {
          await db.atualizarCusto(produto.id, Number(decisao.item.valorUnitario || 0));
        }
        movimentados.push(produto.name);
      }
      // ---- o razão E a marca na ordem, no MESMO instante (fase AQ + BH) -----
      //
      // Quem move o estoque e a NOTA, nunca as duas. A ordem e o compromisso; a
      // nota e a prova de que a mercadoria chegou. Por isso o documento e
      // marcado como recebido SEM lancar movimento nenhum: o
      // commitStockMovements ja lancou, com os dados da nota, que sao os que
      // valem.
      //
      // A gravacao de entrada_nfe_id e o que fecha a porta do outro lado:
      // transicionarDocumentoDeCompra recusa receber uma ordem que ja tem nota.
      //
      // FASE BH: A MARCA ENTRA PELO GANCHO `tambemNaTransacao`, como na rota
      // irma (transicionarDocumentoDeCompra). Antes eram duas escritas soltas:
      // o razão commitava, e só depois a ordem era lida e marcada. Se a marca
      // falhasse — erro de banco, ou a ordem tendo sumido no meio — o estoque
      // ficava lançado com a ordem intacta, e recebê-la depois lançaria a mesma
      // mercadoria uma segunda vez. Juntas, ou nenhuma das duas.
      //
      // O `for update` e a reconferência aqui dentro fecham a janela entre a
      // validação lá de cima e este commit: duas notas apontando para a mesma
      // ordem, ao mesmo tempo, esperam uma pela outra e a segunda é recusada.
      try {
        await commitStockMovements(data, movimentosDaNota, produtosPorId, {
          tambemNaTransacao: body.purchaseOrderId
            ? async (cliente) => {
              await comprasDb.travarDocumento(cliente, body.purchaseOrderId);
              const { rows } = await cliente.query(
                'select stock_applied from purchase_orders where id = $1', [body.purchaseOrderId]
              );
              if (!rows.length) {
                const erro = new Error('A ordem de compra escolhida não existe mais.');
                erro.status = 400;
                throw erro;
              }
              if (rows[0].stock_applied) {
                const erro = new Error(
                  `A ordem ${ordemDaNota.code || body.purchaseOrderId} já deu entrada no estoque por conta própria. `
                  + 'Estorne o recebimento dela antes de ligar esta nota.'
                );
                erro.status = 400;
                throw erro;
              }
              await comprasDb.atualizarStatus(body.purchaseOrderId, {
                status: 'ordem-recebida',
                type: 'order',
                // stockApplied fica TRUE mesmo tendo sido a nota a movimentar: a
                // coluna responde "esta ordem ja virou estoque?", e a resposta e sim.
                // Fosse false, receber a ordem depois lancaria tudo de novo.
                stockApplied: true,
                entradaNfeId: entrada.id
              }, cliente);
            }
            : undefined
        });
      } catch (erroDoRazao) {
        // A NOTA VOLTA A NÃO EXISTIR (fase BH).
        //
        // A transação desfez o razão sozinha, mas a nota foi gravada ANTES dela
        // e sobreviveria — dizendo LANCADA, com movimentouEstoque em true, sem
        // um movimento sequer. E a chave de acesso é única: a nota ficaria
        // queimada, impossível de relançar, inclusive por quem quisesse
        // corrigir. Mesmo raciocínio do desfazer que criarEntrada já faz
        // quando os itens falham.
        try {
          await entradaNfeDb.desfazerEntrada(entrada.id);
        } catch (erroAoDesfazer) {
          console.error('Entrada de NF-e falhou e nao consegui desfaze-la', entrada.id, erroAoDesfazer.message);
        }
        return sendJson(res, { error: erroDoRazao.message || 'Erro ao lançar o estoque da nota.' }, erroDoRazao.status || 400);
      }

      // Relido DEPOIS do commit: dentro da transação atualizarStatus devolve
      // null de propósito (a linha ainda não está visível para outra conexão).
      const ordemLigada = body.purchaseOrderId
        ? await comprasDb.obterDocumento(body.purchaseOrderId)
        : null;

      // ---- contas a pagar --------------------------------------------------
      // Nota ligada a uma ordem gera o financeiro DELA, pelas duplicatas do
      // XML — que e o valor que o fornecedor vai cobrar de fato. A ordem nao
      // gera o seu: o total dela era estimativa, e duas contas a pagar para a
      // mesma mercadoria e pior do que uma com o valor errado.
      const financeiro = [];
      if (querFinanceiro) {
        await syncFinanceData(data);
        // Sem duplicata na nota (à vista, ou emissor que não preencheu cobr),
        // vira uma parcela só vencendo na emissão — melhor do que sumir com a
        // dívida porque o XML não detalhou o parcelamento.
        try {
          const parcelas = nota.duplicatas.length
            ? nota.duplicatas
            : [{ numero: '001', vencimento: nota.dataEmissao, valor: nota.totais.nota || 0 }];
          for (let i = 0; i < parcelas.length; i += 1) {
            const parcela = parcelas[i];
            const lancamento = await db.createFinancialEntry({
              type: 'purchase',
              referenceId: entrada.id,
              date: nota.dataEmissao,
              dueDate: parcela.vencimento || nota.dataEmissao,
              description: descricaoLancamento.montar({
                qual: 'despesa',
                tipo: 'compra',
                nota: nota.numero,
                parcela: i + 1,
                parcelas: parcelas.length
              }),
              amount: Number(parcela.valor || 0),
              // A chave no campo Documento é o que liga a conta a pagar à nota na
              // conciliação — nome de fornecedor muda, chave não.
              document: nota.chave,
              clientSupplierId: conferencia.fornecedor.cadastro ? conferencia.fornecedor.cadastro.id : '',
              clientSupplierName: nota.emitente.nome,
              status: 'pending',
              createdBy: user.id,
              createdByName: user.name
            });
            data.finance.push(lancamento);
            financeiro.push(lancamento);
          }
          saveData(data);
        } catch (erroDoFinanceiro) {
          // A MERCADORIA CHEGOU: o estoque NÃO se desfaz aqui — mesmo
          // raciocínio da rota irmã de recebimento de ordem. Mas a nota parava
          // de contar a verdade: ficava com gerouFinanceiro em true e sem
          // conta a pagar nenhuma, e era esse `true` que impedia qualquer
          // conferência de apontar a falta.
          console.error('Entrada de NF-e lancada, mas o financeiro falhou', entrada.id, erroDoFinanceiro.message);
          await entradaNfeDb.atualizarSinalizadores(entrada.id, { gerouFinanceiro: false, status: 'REVISAR' });
          await registrarAuditoria({
            action: 'falhaAoGerarFinanceiroDaEntrada',
            targetId: entrada.id,
            targetUsername: nota.emitente.nome,
            byId: user.id,
            byName: user.name,
            details: { erro: erroDoFinanceiro.message, chave: nota.chave, parcelasCriadas: financeiro.length }
          });
        }
      }

      await registrarAuditoria({
        action: 'entrada-nfe-lancada',
        targetId: entrada.id,
        targetUsername: nota.emitente.nome,
        byId: user.id,
        byName: user.name,
        details: `NF-e ${nota.numero}/${nota.serie} — chave ${nota.chave} — R$ ${Number(nota.totais.nota || 0).toFixed(2)}`
      });

      return sendJson(res, {
        success: true,
        entrada,
        estoque: movimentados,
        financeiro,
        status
      });
    } catch (error) {
      const traduzido = traduzirErroDaEntrada(error);
      return sendJson(res, { error: traduzido.message || 'Erro ao lançar a entrada' }, traduzido.status || 400);
    }
  }

  // =========================================================================
  // O DOCUMENTO DE COMPRA (fase AQ) — cotação e ordem, o mesmo registro.
  //
  // Estas rotas vêm ANTES da `/api/purchases/` genérica de propósito: aquela
  // casa com startsWith e engoliria `PUT /api/purchases/documentos/<id>`,
  // tratando o documento como se fosse uma linha da tabela `purchases` antiga.
  // =========================================================================

  if (pathname === '/api/purchases/documentos' && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('purchases')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const tipo = url.searchParams.get('tipo') || '';
    const documentos = await comprasDb.listarDocumentos(tipo ? { tipo } : {});
    return sendJson(res, { documentos });
  }

  if (pathname === '/api/purchases/documentos' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const documento = await comprasDb.criarDocumento(
        montarDocumentoDeCompra(body, data, user)
      );
      return sendJson(res, { success: true, documento });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao gravar o documento' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/purchases/documentos/') && pathname.endsWith('/status') && req.method === 'POST') {
    try {
      const data = loadData();
      await Promise.all([syncCadastroData(data), syncFinanceData(data)]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.slice('/api/purchases/documentos/'.length, -('/status'.length)));
      const body = await readBody(req);
      const documento = await transicionarDocumentoDeCompra(data, {
        id, novoStatus: body.status, user
      });
      return sendJson(res, { success: true, documento });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao mudar o status' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/purchases/documentos/') && req.method === 'PUT') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/purchases/documentos/', ''));
      const atual = await comprasDb.obterDocumento(id);
      if (!atual) return sendJson(res, { error: 'Documento não encontrado' }, 404);
      // Documento que já deu entrada no estoque não se edita: os itens dele já
      // viraram linhas do razão, e mudar a quantidade aqui deixaria a ordem
      // dizendo 8 com 10 unidades lançadas. Estorne o recebimento primeiro.
      if (atual.stockApplied) {
        return sendJson(res, { error: 'Esta ordem já deu entrada no estoque. Estorne o recebimento antes de editar.' }, 400);
      }
      const body = await readBody(req);
      const documento = await comprasDb.atualizarDocumento(id, montarDocumentoDeCompra(body, data, user));
      return sendJson(res, { success: true, documento });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao gravar o documento' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/purchases/documentos/') && req.method === 'DELETE') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/purchases/documentos/', ''));
      const apagou = await comprasDb.excluirDocumento(id);
      if (!apagou) return sendJson(res, { error: 'Documento não encontrado' }, 404);
      return sendJson(res, { success: true });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao excluir' }, error.status || 400);
    }
  }

  if (pathname === '/api/purchases' && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('purchases')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const [products, purchases] = await Promise.all([db.getProducts(), db.getPurchases()]);
    // `deposits` veio junto na fase AQ: a ordem de compra diz em QUE depósito a
    // mercadoria entra, e sem a lista o formulário só ofereceria "sem depósito".
    // syncCadastroData já os carregou logo acima — é dado que já está na mão.
    return sendJson(res, {
      purchases, products,
      directory: getCadastroDirectory(data),
      deposits: data.deposits || []
    });
  }

  if (pathname === '/api/purchases' && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 2x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncFinanceData(data),
        // O razão precisa estar em memória porque a compra empilha movimento
        // e o descarregamento soma saldo por depósito em cima dele.
        sincronizarRazao(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const product = await db.getProductById(body.productId);
      if (!product) {
        return sendJson(res, { error: 'Produto não encontrado' }, 400);
      }

      // supplierId aponta pro Cadastro (pessoa ou CNPJ) quando o usuário
      // escolheu um fornecedor cadastrado; supplierName fica salvo junto
      // (mesmo padrão de clientSupplierId/clientSupplierName em Vendas) pra
      // exibição continuar funcionando mesmo que o cadastro mude depois.
      // Sem supplierId, cai pro texto livre antigo (compatibilidade).
      let supplierName = body.supplier || 'Fornecedor';
      if (body.supplierId) {
        const found = getCadastroDirectory(data).find((entry) => entry.id === body.supplierId);
        if (found) supplierName = found.name;
      }

      const quantity = Number(body.quantity || 0);
      const costPrice = Number(body.costPrice || product.costPrice || 0);
      const purchase = await db.createPurchase({
        date: body.date || new Date().toISOString().slice(0, 10),
        supplierId: body.supplierId || '',
        supplier: supplierName,
        productId: product.id,
        quantity,
        costPrice,
        total: quantity * costPrice,
        status: 'pendente'
      });

      // O SALDO NÃO É SOMADO AQUI. Quem soma é a transação do
      // descarregamento, com `stock_quantity + delta` (fase AP). Esta linha
      // gravava o total absoluto ANTES daquela fase existir, e depois dela
      // passou a somar a mesma compra duas vezes: comprar 10 subia o total para
      // 20 enquanto o razão, corretamente, dizia 10.
      await db.atualizarCusto(product.id, costPrice);
      registrarMovimentoEstoque(data, {
        productId: product.id, productName: product.name, type: 'compra',
        quantityDelta: quantity, referenceType: 'purchase', referenceId: purchase.id,
        // Direto do corpo da requisição, e não do registro: a tabela
        // `purchases` não tem coluna de depósito (quem tem é purchase_orders,
        // outra tabela, usada pela entrada por NF-e). A tela de compra rápida
        // ainda não pergunta o depósito; quando perguntar, chega aqui. Quem
        // guarda a resposta é o razão — e é dele que o estorno a lê.
        depositId: body.depositId || '',
        note: `Compra de ${purchase.supplier}`, user
      });

      const financeEntry = await db.createFinancialEntry({
        type: 'purchase',
        referenceId: purchase.id,
        date: purchase.date,
        description: `Compra ${purchase.id}`,
        amount: purchase.total,
        status: 'pending',
        createdBy: user?.id,
        createdByName: user?.name
      });
      data.finance.push(financeEntry);

      // Fase AP: os movimentos que esta compra empilhou viram linhas do razao
      // aqui, numa transacao so, junto com o total do produto.
      await descarregarMovimentosPendentes(data);
      saveData(data);
      return sendJson(res, { success: true, purchase, financeEntry });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao criar compra' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/purchases/') && req.method === 'PUT') {
    try {
      const data = loadData();
      // Cancelar a compra estorna o estoque, e o estorno precisa saber de
      // qual depósito a compra entrou — quem sabe isso é o razão.
      await Promise.all([syncFinanceData(data), syncCadastroData(data), sincronizarRazao(data)]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/purchases/', ''));
      const purchase = await db.getPurchaseById(id);
      if (!purchase) {
        return sendJson(res, { error: 'Compra não encontrada' }, 404);
      }
      const body = await readBody(req);
      const novoStatus = body.status;
      if (!['pendente', 'recebida', 'cancelada'].includes(novoStatus)) {
        return sendJson(res, { error: 'Status inválido' }, 400);
      }
      if (purchase.status === 'cancelada') {
        return sendJson(res, { error: 'Esta compra já está cancelada' }, 400);
      }

      // Cancelar devolve o estoque que a compra tinha somado (o modelo atual
      // não tem uma etapa separada de "recebimento" — o estoque já entra na
      // criação) e cancela o lançamento financeiro se ele ainda não foi pago.
      if (novoStatus === 'cancelada' && purchase.status !== 'cancelada') {
        const product = await db.getProductById(purchase.productId);
        if (product) {
          if (Number(product.stockQuantity || 0) < Number(purchase.quantity || 0)) {
            const err = new Error(`Não é possível cancelar: das ${purchase.quantity} unidades desta compra, só há ${product.stockQuantity} em estoque hoje (parte já deve ter sido vendida ou ajustada).`);
            err.status = 409;
            throw err;
          }
          // Mesma correção do lançamento: o estorno empilha o movimento e é
          // a transação que subtrai. Subtrair aqui também tirava em dobro.
          registrarMovimentoEstoque(data, {
            productId: purchase.productId, productName: product.name, type: 'estorno',
            quantityDelta: -Number(purchase.quantity || 0), referenceType: 'purchase', referenceId: purchase.id,
            // Tira do depósito em que a compra ENTROU, não do saldo geral.
            depositId: depositoDoMovimentoDeOrigem(data, {
              referenceType: 'purchase', referenceId: purchase.id, motivo: 'compra',
              productId: purchase.productId, classValueId: ''
            }),
            note: `Cancelamento da compra de ${purchase.supplier}`, user
          });
        }
        // A MUTACAO EM MEMORIA NAO BASTAVA (fase BI). Aqui havia
        // `financeEntry.status = 'cancelado'` e mais nada: faltava o
        // db.updateFinancialEntry, e `financial_entries` mora no Postgres. A
        // mudanca nunca chegava la, e o syncFinanceData da requisicao seguinte
        // trazia o 'pending' de volta. A compra era cancelada, a mercadoria
        // saia do estoque e o fornecedor seguia sendo cobrado.
        await cancelarFinanceiroDaCompra(data, { documentoId: purchase.id, user });
      }

      const updated = await db.updatePurchase(id, { status: novoStatus });
      // Fase AP: os movimentos que esta compra empilhou viram linhas do razao
      // aqui, numa transacao so, junto com o total do produto.
      await descarregarMovimentosPendentes(data);
      saveData(data);
      return sendJson(res, { success: true, purchase: updated });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao atualizar compra' }, error.status || 400);
    }
  }

  // --------------------------------------------------------------------------
  // ESTOQUE
  // --------------------------------------------------------------------------

  // Metadados para preencher selects das telas do módulo.
  if (pathname === '/api/stock/meta' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const { data, products } = await loadStockContext();
      // Catálogo de cores no meta: o movimento guarda só o classValueId, e sem
      // esta lista cada linha da tabela precisaria de uma consulta para virar
      // "Preto". São poucas dezenas de valores — cabem no meta que a tela já
      // carrega uma vez. Falha aqui não pode derrubar o módulo inteiro: sem
      // catálogo a coluna mostra "-", o resto do Estoque continua de pé.
      let classes = [];
      try {
        const catalogo = await classesDb.listarClasses();
        const valores = await classesDb.listarValores(null);
        classes = catalogo.map((c) => ({ ...c, valores: valores.filter((v) => v.classId === c.id) }));
      } catch (erroClasses) {
        classes = [];
      }
      return sendJson(res, {
        deposits: data.deposits,
        classes,
        productCategories: data.productCategories,
        movementCategories: data.movementCategories,
        priceTables: (data.priceTables || []).map((t) => ({ id: t.id, name: t.name, type: t.type, markupPercent: t.markupPercent })),
        catalogs: (data.productCatalogs || []).map((c) => ({ id: c.id, name: c.name })),
        products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, costPrice: p.costPrice, salePrice: p.salePrice, stockQuantity: p.stockQuantity }))
      });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao carregar dados do estoque' }, 500);
    }
  }

  // ---------------------------------------------------- classes de produto
  // Catálogo (COR e seus valores) e a atribuição por produto. O SALDO por cor
  // não passa por aqui: ele é derivado do razão de movimentos, como o saldo
  // por depósito — ver a camada de estoque.
  if (pathname.startsWith('/api/stock/classes')) {
    const user = await getCurrentUser(req);
    // Estoque OU Cadastros: a mesma tela de catálogo aparece nos dois módulos,
    // e o catálogo é cadastro — quem cadastra produto precisa poder cadastrar a
    // cor que falta. Aceitar só 'stock' faria a tela existir no menu de
    // Cadastros e responder "Sem permissão" a quem a abrisse por lá.
    if (!user || !(user.allowedModules.includes('stock') || user.allowedModules.includes('cadastros'))) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    try {
      if (pathname === '/api/stock/classes' && req.method === 'GET') {
        const classes = await classesDb.listarClasses({ incluirInativas: url.searchParams.get('todas') === '1' });
        // Os valores vêm juntos: a tela sempre precisa dos dois, e duas
        // chamadas fariam a lista piscar meia preenchida.
        const valores = await classesDb.listarValores(null, { incluirInativos: url.searchParams.get('todas') === '1' });
        return sendJson(res, {
          classes: classes.map((c) => ({ ...c, valores: valores.filter((v) => v.classId === c.id) }))
        });
      }

      if (pathname === '/api/stock/classes' && req.method === 'POST') {
        const body = await readBody(req);
        const classe = await classesDb.criarClasse({ id: createId('pclass'), ...body });
        return sendJson(res, { success: true, classe });
      }

      if (pathname === '/api/stock/classes/valores' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.classId) return sendJson(res, { error: 'Informe a classe do valor.' }, 400);
        if (!String(body.name || '').trim()) return sendJson(res, { error: 'Informe o nome do valor.' }, 400);
        const valor = await classesDb.criarValor({ id: createId('pcval'), ...body });
        return sendJson(res, { success: true, valor });
      }

      if (pathname.startsWith('/api/stock/classes/valores/')) {
        const id = decodeURIComponent(pathname.replace('/api/stock/classes/valores/', ''));
        if (req.method === 'PUT') {
          const valor = await classesDb.atualizarValor(id, await readBody(req));
          return sendJson(res, { success: true, valor });
        }
        if (req.method === 'DELETE') {
          await classesDb.excluirValor(id);
          return sendJson(res, { success: true });
        }
      }

      if (pathname.startsWith('/api/stock/classes/')) {
        const id = decodeURIComponent(pathname.replace('/api/stock/classes/', ''));
        if (req.method === 'PUT') {
          const classe = await classesDb.atualizarClasse(id, await readBody(req));
          return sendJson(res, { success: true, classe });
        }
        if (req.method === 'DELETE') {
          await classesDb.excluirClasse(id);
          return sendJson(res, { success: true });
        }
      }

      return sendJson(res, { error: 'Rota não encontrada' }, 404);
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro nas classes de produto' }, error.status || 500);
    }
  }

  // Classes que um produto usa. Rota separada da do produto porque a tela de
  // Classes salva sozinha, sem exigir que o resto do cadastro seja reenviado.
  if (/^\/api\/stock\/products\/[^/]+\/classes$/.test(pathname)) {
    const user = await getCurrentUser(req);
    // Ler as cores de um produto é necessário para VENDER, não só para mexer no
    // cadastro: a tela de venda precisa da lista para pedir a cor do item. Quem
    // ALTERA a atribuição continua sendo só o Estoque.
    const podeLer = user && (user.allowedModules.includes('stock') || user.allowedModules.includes('sales'));
    if (!podeLer || (req.method !== 'GET' && !user.allowedModules.includes('stock'))) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const productId = decodeURIComponent(pathname.split('/')[4]);
    try {
      if (req.method === 'GET') {
        const classes = await classesDb.classesDoProduto(productId);
        // O saldo vem junto porque escolher a cor às cegas é o mesmo erro que
        // escolher o depósito às cegas. Derivado do razão, como sempre — aqui
        // não existe tabela de saldo por cor para consultar.
        const depositId = url.searchParams.get('depositId') || '';
        // loadData() sozinho devolvia `stockMovements: []` e o quadro de cores
        // aparecia VAZIO logo depois de uma entrada. Reproduzido: 10 Brancas
        // no razao, `saldos: {}` na resposta desta rota.
        const dadosDoSaldo = loadData();
        await sincronizarRazao(dadosDoSaldo);
        const quebra = stockCore.classBalances(dadosDoSaldo, productId, depositId);
        const saldos = {};
        for (const linha of quebra.valores) saldos[linha.classValueId] = linha.quantity;
        return sendJson(res, { classes, saldos, semClasse: quebra.semClasse });
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const classes = await classesDb.definirClassesDoProduto(productId, body.classes);
        return sendJson(res, { success: true, classes });
      }
      return sendJson(res, { error: 'Método não suportado' }, 405);
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar as classes do produto' }, error.status || 500);
    }
  }

  if (pathname === '/api/stock/products' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const { data, products, reservas } = await loadStockContext({ comReservas: true });
      const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
      const categoryId = url.searchParams.get('categoryId') || '';
      const status = url.searchParams.get('status') || '';
      const situation = url.searchParams.get('situation') || '';
      const depositId = url.searchParams.get('depositId') || '';

      let list = products.map((product) => stockCore.serializeProduct(product, data, reservas));
      if (search) {
        list = list.filter((p) => `${p.name} ${p.sku} ${p.ean}`.toLowerCase().includes(search));
      }
      if (categoryId) list = list.filter((p) => p.categoryId === categoryId);
      if (status) list = list.filter((p) => p.status === status);
      if (situation) list = list.filter((p) => p.situation === situation);
      if (depositId) {
        list = list.filter((p) => (p.balances.find((b) => b.depositId === depositId) || {}).quantity > 0);
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      return sendJson(res, { products: list });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar produtos' }, 500);
    }
  }

  // Status do Produto: posição por depósito + histórico recente.
  if (/^\/api\/stock\/products\/[^/]+$/.test(pathname) && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const id = decodeURIComponent(pathname.replace('/api/stock/products/', ''));
      const { data, productsById, reservas } = await loadStockContext({ comReservas: true });
      const product = productsById.get(id);
      if (!product) return sendJson(res, { error: 'Produto não encontrado' }, 404);
      const movements = (data.stockMovements || [])
        .filter((m) => m.productId === id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 50)
        .map((m) => stockCore.serializeMovement(m, data, productsById));
      // A quebra por cor da reserva vai junto: quem escolhe a cor na venda ou
      // na saída precisa saber quanto DAQUELA cor já está prometido, não só o
      // total do produto.
      const reservasPorCor = reservas
        ? [...reservas.porChave.entries()]
          .filter(([chave]) => chave.startsWith(`${id}|`) && !chave.endsWith('|'))
          .map(([chave, quantity]) => ({ classValueId: chave.slice(id.length + 1), quantity }))
        : null;
      return sendJson(res, {
        product: stockCore.serializeProduct(product, data, reservas),
        reservasPorCor,
        movements
      });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao carregar produto' }, 500);
    }
  }

  if (pathname === '/api/stock/products' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const body = await readBody(req);
      const { data, products, productsById } = await loadStockContext();

      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, { error: 'Informe o nome do produto.' }, 400);
      const sku = String(body.sku || '').trim();
      if (!sku) return sendJson(res, { error: 'Informe o SKU do produto.' }, 400);
      const duplicated = products.some((p) => p.id !== body.id && String(p.sku || '').toLowerCase() === sku.toLowerCase());
      if (duplicated) return sendJson(res, { error: 'Já existe um produto com este SKU.' }, 409);

      const existing = body.id ? productsById.get(body.id) : null;
      if (body.id && !existing) return sendJson(res, { error: 'Produto não encontrado' }, 404);

      // Estoque inicial só vale na criação e vira uma movimentação de entrada,
      // para o saldo do depósito nascer coerente com o saldo total. Valida antes
      // de gravar: senão um erro aqui deixaria o produto criado pela metade.
      const initialQuantity = existing ? stockCore.toNumber(existing.stockQuantity) : stockCore.toNumber(body.stockQuantity);
      const initialDepositId = String(body.defaultDepositId || '').trim();
      if (!existing && initialQuantity > 0) {
        if (!initialDepositId) {
          return sendJson(res, { error: 'Para lançar estoque inicial, selecione o depósito padrão.' }, 400);
        }
        if (!(data.deposits || []).some((d) => d.id === initialDepositId)) {
          return sendJson(res, { error: 'Depósito não encontrado.' }, 404);
        }
      }

      const product = await db.upsertProduct({
        id: body.id || undefined,
        name,
        sku,
        stockQuantity: existing ? stockCore.toNumber(existing.stockQuantity) : 0,
        costPrice: stockCore.toNumber(body.costPrice),
        salePrice: stockCore.toNumber(body.salePrice),
        // Campos fiscais vão para as COLUNAS de products, não para o db.json:
        // a emissão de NF-e lê o Supabase direto e não enxerga o arquivo local.
        // Sem NCM na coluna, resolverRegraFiscal não acha regra e a nota é
        // recusada — era esse o furo entre cadastrar o produto e emitir.
        ncm: String(body.ncm ?? '').replace(/\D/g, ''),
        cest: String(body.cest ?? '').replace(/\D/g, ''),
        ean: String(body.ean ?? '').trim(),
        origem: body.origem === '' || body.origem === undefined || body.origem === null ? null : Number(body.origem),
        // A NF-e pede unidade comercial e tributável separadas; o cadastro tem
        // um campo só ("Unidade"), que serve de padrão para as duas.
        unidadeComercial: String(body.unit ?? 'UN').trim() || 'UN',
        unidadeTributavel: String(body.unidadeTributavel || body.unit || 'UN').trim() || 'UN',
        numeroFci: String(body.numeroFci ?? '').trim()
      });

      data.productMeta[product.id] = stockCore.buildProductMeta(body, stockCore.productMeta(data, product.id));

      if (!existing && initialQuantity > 0) {
        const movement = buildMovementRecord(data, {
          type: 'entrada',
          productId: product.id,
          depositId: initialDepositId,
          quantity: initialQuantity,
          unitCost: stockCore.toNumber(body.costPrice),
          categoryId: body.movementCategoryId || '',
          note: 'Estoque inicial do cadastro do produto',
          origin: 'saldo-inicial'
        }, user);
        productsById.set(product.id, { ...product, stockQuantity: 0 });
        await commitStockMovements(data, [movement], productsById);
      } else {
        saveData(data);
      }

      const refreshed = await db.getProductById(product.id);
      return sendJson(res, { success: true, product: stockCore.serializeProduct(refreshed, loadData()) });
    } catch (error) {
      return sendStockError(res, error, 'Erro ao salvar produto');
    }
  }

  if (/^\/api\/stock\/products\/[^/]+$/.test(pathname) && req.method === 'DELETE') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const id = decodeURIComponent(pathname.replace('/api/stock/products/', ''));
      const { data, productsById } = await loadStockContext();
      if (!productsById.get(id)) return sendJson(res, { error: 'Produto não encontrado' }, 404);
      if ((data.stockMovements || []).some((m) => m.productId === id)) {
        return sendJson(res, { error: 'Produto com movimentações não pode ser excluído. Zere o estoque e mantenha o cadastro inativo.' }, 409);
      }
      if ((data.productCatalogs || []).some((c) => (c.productIds || []).includes(id))) {
        return sendJson(res, { error: 'Produto vinculado a um catálogo. Remova-o do catálogo antes de excluir.' }, 409);
      }
      await db.deleteProduct(id);
      delete data.productMeta[id];
      data.priceTables = (data.priceTables || []).map((table) => ({
        ...table,
        items: (table.items || []).filter((item) => item.productId !== id)
      }));
      saveData(data);
      return sendJson(res, { success: true });
    } catch (error) {
      return sendStockError(res, error, 'Erro ao excluir produto');
    }
  }

  if (pathname === '/api/stock/movements' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const { data, productsById } = await loadStockContext();
      const filtered = filterStockMovements(data, url.searchParams, productsById)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const { page, limit } = parsePageParams(url.searchParams, 20);
      const start = (page - 1) * limit;
      return sendJson(res, {
        movements: filtered.slice(start, start + limit).map((m) => stockCore.serializeMovement(m, data, productsById)),
        total: filtered.length,
        page,
        limit
      });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar movimentações' }, 500);
    }
  }

  if (pathname === '/api/stock/movements' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const body = await readBody(req);
      const { data, productsById } = await loadStockContext();
      const type = String(body.type || '').trim().toLowerCase();
      if (!['entrada', 'saida'].includes(type)) {
        return sendJson(res, { error: 'Tipo de movimentação inválido. Use entrada ou saída.' }, 400);
      }
      // Falha de catálogo não pode travar a movimentação de um produto que
      // não usa classe nenhuma — a lista vazia é o comportamento de sempre.
      let classesDoProduto = [];
      try {
        classesDoProduto = await classesDb.classesDoProduto(body.productId);
      } catch (erroClasses) {
        classesDoProduto = [];
      }
      assertMovementIsPossible(data, productsById, {
        productId: body.productId,
        depositId: body.depositId,
        type,
        quantity: body.quantity,
        classValueId: body.classValueId,
        classesDoProduto
      });
      const movement = buildMovementRecord(data, { ...body, type }, user);
      await commitStockMovements(data, [movement], productsById);
      return sendJson(res, { success: true, movement: stockCore.serializeMovement(movement, data, productsById) });
    } catch (error) {
      return sendStockError(res, error, 'Erro ao registrar movimentação');
    }
  }

  if (/^\/api\/stock\/movements\/[^/]+$/.test(pathname) && req.method === 'DELETE') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const id = decodeURIComponent(pathname.replace('/api/stock/movements/', ''));
      const { data, productsById } = await loadStockContext();
      const movement = (data.stockMovements || []).find((m) => m.id === id);
      if (!movement) return sendJson(res, { error: 'Movimentação não encontrada' }, 404);
      if (movement.transferId) {
        return sendJson(res, { error: 'Esta movimentação faz parte de uma transferência. Estorne pela tela Entre Depósitos.' }, 409);
      }
      // Estornar uma entrada não pode deixar o saldo negativo. Com cor, o que
      // limita é o saldo DAQUELA cor: estornar a entrada de 10 pretos quando
      // 8 já saíram deixaria o preto em -8, mesmo com o total do produto
      // ainda positivo por causa das outras cores.
      if (movement.type === 'entrada') {
        const available = movement.classValueId
          ? stockCore.classValueBalance(data, movement.productId, movement.classValueId, movement.depositId)
          : stockCore.depositBalance(data, movement.productId, movement.depositId);
        if (stockCore.toNumber(movement.quantity) > available) {
          return sendJson(res, { error: `Não é possível estornar: o saldo ficaria negativo (disponível ${available}).` }, 409);
        }
      }
      // Fase AP: apagar a linha e corrigir o total viram uma coisa so. Antes
      // eram duas escritas em lugares diferentes — o total ia para o Postgres e
      // a remocao para o db.json —, e um processo morto entre elas deixava o
      // total ja corrigido com o movimento ainda no razao.
      const reversal = { ...movement, type: movement.type === 'entrada' ? 'saida' : 'entrada' };
      const delta = stockCore.movementSignedQuantity(reversal);
      await emTransacao(async (cliente) => {
        await razaoEstoque.travarProduto(cliente, movement.productId);
        await razaoEstoque.apagarMovimento(cliente, id);
        if (delta !== 0) await razaoEstoque.somarNoTotalDoProduto(cliente, movement.productId, delta);
      });
      data.stockMovements = data.stockMovements.filter((m) => m.id !== id);
      return sendJson(res, { success: true });
    } catch (error) {
      return sendStockError(res, error, 'Erro ao estornar movimentação');
    }
  }

  if (pathname === '/api/stock/transfers' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const { data, productsById } = await loadStockContext();
      const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
      const productId = url.searchParams.get('productId') || '';
      const depositId = url.searchParams.get('depositId') || '';
      let list = (data.stockTransfers || []).slice();
      if (productId) list = list.filter((t) => t.productId === productId);
      if (depositId) list = list.filter((t) => t.originDepositId === depositId || t.destinationDepositId === depositId);
      if (search) {
        list = list.filter((t) => {
          const product = productsById.get(t.productId);
          return [t.code, t.note, product ? product.name : '', product ? product.sku : '']
            .join(' ').toLowerCase().includes(search);
        });
      }
      list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return sendJson(res, { transfers: list.map((t) => stockCore.serializeTransfer(t, data, productsById)) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar transferências' }, 500);
    }
  }

  if (pathname === '/api/stock/transfers' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const body = await readBody(req);
      const { data, productsById } = await loadStockContext();
      const originDepositId = String(body.originDepositId || '').trim();
      const destinationDepositId = String(body.destinationDepositId || '').trim();
      if (!originDepositId || !destinationDepositId) {
        return sendJson(res, { error: 'Selecione o depósito de origem e o de destino.' }, 400);
      }
      if (originDepositId === destinationDepositId) {
        return sendJson(res, { error: 'Origem e destino não podem ser o mesmo depósito.' }, 400);
      }
      if (!(data.deposits || []).some((d) => d.id === destinationDepositId)) {
        return sendJson(res, { error: 'Depósito de destino não encontrado.' }, 404);
      }

      // UMA TRANSFERÊNCIA, VÁRIOS ITENS — e o formato antigo continua valendo.
      //
      // A tela passou a montar uma lista de produtos antes de enviar (é uma
      // movimentação com itens, como a da referência), mas `{ productId,
      // quantity }` solto continua sendo aceito: é o que os testes e qualquer
      // integração existente mandam, e quebrá-los para mudar o desenho de uma
      // tela seria trocar um problema de forma por um de funcionamento.
      const itensBrutos = Array.isArray(body.items) && body.items.length
        ? body.items
        : [{ productId: body.productId, quantity: body.quantity, classId: body.classId, classValueId: body.classValueId }];
      if (!itensBrutos.length) return sendJson(res, { error: 'Adicione ao menos um produto à movimentação.' }, 400);
      if (itensBrutos.length > 200) return sendJson(res, { error: 'Máximo de 200 itens por movimentação.' }, 400);

      // O MESMO PRODUTO DUAS VEZES SOMA, NÃO CONCORRE CONSIGO MESMO.
      //
      // Sem juntar, cada linha seria conferida contra o saldo INTEIRO da
      // origem: com 5 em estoque, duas linhas de 3 passariam nas duas
      // validações e o depósito terminaria com -1. A cor faz parte da chave
      // porque 3 pretos e 3 brancos são saldos diferentes.
      const porChave = new Map();
      for (const item of itensBrutos) {
        const productId = String(item?.productId || '').trim();
        const classValueId = String(item?.classValueId || '').trim();
        if (!productId) return sendJson(res, { error: 'Há um item sem produto na movimentação.' }, 400);
        const chave = `${productId}::${classValueId}`;
        const anterior = porChave.get(chave);
        if (anterior) {
          anterior.quantity = stockCore.toNumber(anterior.quantity) + stockCore.toNumber(item.quantity);
        } else {
          porChave.set(chave, {
            productId,
            classValueId,
            classId: String(item?.classId || '').trim(),
            quantity: stockCore.toNumber(item.quantity)
          });
        }
      }
      const itens = [...porChave.values()];

      // TUDO É CONFERIDO ANTES DE QUALQUER COISA SER GRAVADA.
      //
      // Validar-e-gravar item a item deixaria o quinto item sem saldo depois de
      // os quatro primeiros já terem saído da origem: metade de uma
      // movimentação, com uma mensagem de erro que não diz o que ficou feito.
      const validados = [];
      for (const item of itens) {
        let classesDoProduto = [];
        try {
          classesDoProduto = await classesDb.classesDoProduto(item.productId);
        } catch (erroClasses) {
          classesDoProduto = [];
        }
        const { quantity } = assertMovementIsPossible(data, productsById, {
          productId: item.productId,
          depositId: originDepositId,
          type: 'saida',
          quantity: item.quantity,
          classValueId: item.classValueId,
          classesDoProduto
        });
        validados.push({ ...item, quantity });
      }

      const date = body.date || stockCore.todayStr();
      // Liga os itens enviados juntos. A lista de transferências continua com
      // uma linha por produto (é assim que ela sempre foi, e é o que o estorno
      // por linha espera), mas quem precisar reconstruir a movimentação inteira
      // tem por onde.
      const batchId = stockCore.createId('lot');
      const movimentos = [];
      const transferencias = [];

      for (const item of validados) {
        const transferId = stockCore.createId('tra');
        const shared = {
          productId: item.productId,
          quantity: item.quantity,
          unitCost: body.unitCost,
          categoryId: body.categoryId || '',
          document: body.document || '',
          date,
          transferId,
          origin: 'transferencia',
          // §18: a cor atravessa a transferência. Sem isto, transferir 4 pretos
          // tiraria 4 pretos da origem e daria 4 SEM COR ao destino — o total do
          // produto continuaria certo, e o preto teria sumido de um depósito
          // sem aparecer no outro.
          classId: item.classId || '',
          classValueId: item.classValueId || ''
        };
        const out = buildMovementRecord(data, {
          ...shared, type: 'saida', depositId: originDepositId,
          note: body.note || 'Transferência entre depósitos (saída)'
        }, user);
        // Cada código precisa considerar os anteriores, que ainda não estão na
        // lista — daí o cálculo manual com os pendentes junto.
        // O codigo sai da sequence do banco, dentro da transacao do
        // commitStockMovements. Calcular max+1 aqui gerava o mesmo MOV duas
        // vezes quando duas movimentacoes saiam ao mesmo tempo.
        movimentos.push(out);
        const into = buildMovementRecord(data, {
          ...shared, type: 'entrada', depositId: destinationDepositId,
          note: body.note || 'Transferência entre depósitos (entrada)'
        }, user);
        movimentos.push(into);

        transferencias.push({
          id: transferId,
          // Numerada pela sequence stock_transfers_code_seq, no commit.
          code: '',
          batchId,
          date,
          productId: item.productId,
          originDepositId,
          destinationDepositId,
          // Repetido no registro da transferência, além dos dois movimentos: a
          // tela de transferências lista daqui e teria de abrir os movimentos
          // para descobrir qual cor foi transferida.
          classId: item.classId || '',
          classValueId: item.classValueId || '',
          quantity: item.quantity,
          note: body.note || '',
          movementOutId: out.id,
          movementInId: into.id,
          createdBy: user.id,
          createdByName: user.name,
          createdAt: new Date().toISOString()
        });
      }

      // Saída + entrada de mesma quantidade: o saldo total não muda, só a
      // distribuição entre depósitos. Os dois movimentos e o registro da
      // transferência entram na MESMA transação — antes eram um writeFileSync,
      // atômico por acidente; agora é atômico por garantia.
      await commitStockMovements(data, movimentos, productsById, { transferencias });
      const serializadas = transferencias.map((t) => stockCore.serializeTransfer(t, data, productsById));
      // `transfer` no singular fica para quem já consumia esta rota antes de ela
      // aceitar lista.
      return sendJson(res, { success: true, transfer: serializadas[0], transfers: serializadas });
    } catch (error) {
      return sendStockError(res, error, 'Erro ao transferir entre depósitos');
    }
  }

  if (/^\/api\/stock\/transfers\/[^/]+$/.test(pathname) && req.method === 'DELETE') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const id = decodeURIComponent(pathname.replace('/api/stock/transfers/', ''));
      const { data } = await loadStockContext();
      const transfer = (data.stockTransfers || []).find((t) => t.id === id);
      if (!transfer) return sendJson(res, { error: 'Transferência não encontrada' }, 404);
      // O SALDO CONFERIDO E' O DA COR, quando a transferencia tem cor (fase BO).
      //
      // depositBalance soma o deposito INTEIRO, sem olhar classValueId. Com 10
      // Pretos e 10 Brancos no destino, estornar os Pretos depois de eles ja
      // terem saido passava — porque os 10 Brancos cobriam a conta —, e o
      // destino ficava com Preto -10 enquanto a origem recebia de volta 10
      // Pretos que ja tinham sido consumidos. A partir dai o sistema autoriza
      // vender esses 10 fantasmas, porque a validacao de saida olha justamente
      // esse saldo por cor agora inflado.
      //
      // A rota irma — o estorno de MOVIMENTACAO, logo acima — ja fazia assim.
      const cor = transfer.classValueId || '';
      const available = cor
        ? stockCore.classValueBalance(data, transfer.productId, cor, transfer.destinationDepositId)
        : stockCore.depositBalance(data, transfer.productId, transfer.destinationDepositId);
      if (stockCore.toNumber(transfer.quantity) > available) {
        // Nomear a cor: "disponivel 0" num deposito visivelmente cheio nao
        // explica nada a quem esta olhando a tela.
        const nomeDaCor = cor ? ` de ${await classesDb.nomeDoValor(cor)}` : '';
        return sendJson(res, {
          error: `Não é possível estornar: o depósito de destino ficaria negativo${nomeDaCor} `
            + `(disponível ${available}).`
        }, 409);
      }
      // Os dois movimentos e o registro saem juntos. O total do produto NAO
      // muda: a transferencia moveu entre depositos, nao criou nem consumiu.
      await emTransacao(async (cliente) => {
        await razaoEstoque.apagarTransferencia(cliente, id);
      });
      data.stockMovements = data.stockMovements.filter((m) => m.transferId !== id);
      data.stockTransfers = data.stockTransfers.filter((t) => t.id !== id);
      return sendJson(res, { success: true });
    } catch (error) {
      return sendStockError(res, error, 'Erro ao estornar transferência');
    }
  }

  // Gestor de Preços: custo, venda e margem de todos os produtos, com o preço
  // resultante da tabela selecionada, e gravação em lote.
  if (pathname === '/api/stock/price-manager' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const { data, products } = await loadStockContext();
      const priceTableId = url.searchParams.get('priceTableId') || '';
      const priceTable = (data.priceTables || []).find((t) => t.id === priceTableId) || null;
      const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
      let list = products.map((product) => {
        const serialized = stockCore.serializeProduct(product, data);
        return { ...serialized, tablePrice: stockCore.priceForProduct(priceTable, product) };
      });
      if (search) list = list.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(search));
      list.sort((a, b) => a.name.localeCompare(b.name));
      return sendJson(res, { products: list, priceTables: data.priceTables, priceTableId });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao carregar gestor de preços' }, 500);
    }
  }

  if (pathname === '/api/stock/price-manager' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const body = await readBody(req);
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (!updates.length) return sendJson(res, { error: 'Nenhuma alteração para salvar.' }, 400);
      const { data, productsById } = await loadStockContext();

      for (const update of updates) {
        const product = productsById.get(update.productId);
        if (!product) throw stockCore.stockError(`Produto ${update.productId} não encontrado.`, 404);
        const costPrice = stockCore.toNumber(update.costPrice, product.costPrice);
        const salePrice = stockCore.toNumber(update.salePrice, product.salePrice);
        if (costPrice < 0 || salePrice < 0) throw stockCore.stockError('Preços não podem ser negativos.');
        await db.upsertProduct({
          id: product.id,
          name: product.name,
          sku: product.sku,
          stockQuantity: product.stockQuantity,
          costPrice,
          salePrice
        });
      }

      // Preço fixo digitado na tabela é gravado como item dela.
      const priceTable = (data.priceTables || []).find((t) => t.id === body.priceTableId);
      if (priceTable && priceTable.type === 'fixo') {
        updates.forEach((update) => {
          if (update.tablePrice === undefined || update.tablePrice === null || update.tablePrice === '') return;
          const items = priceTable.items || [];
          const index = items.findIndex((item) => item.productId === update.productId);
          const item = { productId: update.productId, price: stockCore.toNumber(update.tablePrice) };
          if (index >= 0) items[index] = item; else items.push(item);
          priceTable.items = items;
        });
        saveData(data);
      }

      return sendJson(res, { success: true, updated: updates.length });
    } catch (error) {
      return sendStockError(res, error, 'Erro ao salvar preços');
    }
  }

  // =========================================================================
  // DEPOSITOS PELO MODULO ESTOQUE (fase BC). Postgres, e nao db.json.
  //
  // A forma da resposta e' a mesma da rota generica (`deposits` na lista,
  // `deposit` no item) porque a tela e' a mesma, montada por makeListScreen.
  // Mudou onde o dado mora, nao o contrato.
  //
  // POR QUE NAO REDIRECIONAR PARA /api/cadastros/deposits: aquelas rotas exigem
  // o modulo `cadastros`, e quem abre Estoque > Depositos pode ter so `stock`.
  // Duas portas para a mesma tabela, cada uma com a permissao do seu modulo.
  // =========================================================================

  const depositoEstoqueMatch = pathname.match(/^\/api\/stock\/deposits(?:\/([^/]+))?$/);
  if (depositoEstoqueMatch) {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const id = depositoEstoqueMatch[1] ? decodeURIComponent(depositoEstoqueMatch[1]) : '';

      if (req.method === 'GET' && !id) {
        const lista = await db.getDeposits();
        return sendJson(res, { deposits: lista.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))) });
      }

      if (req.method === 'GET') {
        const deposito = (await db.getDeposits()).find((d) => d.id === id);
        if (!deposito) return sendJson(res, { error: 'Depósito não encontrado.' }, 404);
        return sendJson(res, { deposit: deposito });
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        const todos = await db.getDeposits();
        const atual = id ? todos.find((d) => d.id === id) : null;
        if (id && !atual) return sendJson(res, { error: 'Depósito não encontrado.' }, 404);
        const body = await readBody(req);

        // A montagem e validacao continuam no stock-core: e' o mesmo
        // formulario, e copiar as regras aqui deixaria as duas metades
        // divergirem na primeira mudanca.
        const built = stockCore.STOCK_COLLECTIONS.deposits.build(body, atual);

        // Codigo repetido conferido contra o BANCO — contra `data.deposits` a
        // checagem leria vazio, que era parte do mesmo bug.
        if (built.code && todos.some((d) => d.id !== id
          && String(d.code || '').toLowerCase() === String(built.code).toLowerCase())) {
          return sendJson(res, { error: 'Já existe um registro com este código.' }, 409);
        }

        // Fase AW: a loja do deposito. Mesma conferencia da rota de Cadastros.
        const companyId = String(body.companyId ?? (atual ? atual.companyId : '') ?? '').trim();
        if (companyId && !(loadData().companies || []).some((c) => c.id === companyId)) {
          return sendJson(res, { error: 'Empresa não encontrada.' }, 404);
        }

        const deposit = id
          ? await db.updateDeposit(id, { ...built, companyId })
          : await db.createDeposit({ ...built, companyId });
        return sendJson(res, { success: true, deposit });
      }

      if (req.method === 'DELETE' && id) {
        const deposito = (await db.getDeposits()).find((d) => d.id === id);
        if (!deposito) return sendJson(res, { error: 'Depósito não encontrado.' }, 404);
        // A MESMA guarda da fase BB, que pergunta ao banco em vez de a uma
        // colecao vazia — ver depositoEmUso.
        const bloqueio = await depositoEmUso(id);
        if (bloqueio) return sendJson(res, { error: bloqueio }, 409);
        await db.deleteDeposit(id);
        return sendJson(res, { success: true });
      }
    } catch (error) {
      return sendStockError(res, error, 'Erro ao salvar o depósito');
    }
  }

  // CRUD genérico dos cadastros auxiliares do estoque.
  // `deposits` SAIU DESTA LISTA (fase BC), pelo mesmo motivo que
  // `bank-accounts` saiu da rota generica de cadastros na fase BA: esta rota
  // grava em data[colecao] e chama saveData, e `deposits` esta em
  // NAO_PERSISTIR desde que os depositos passaram para o Postgres.
  //
  // Provado contra a API antes de mexer:
  //   POST /api/stock/deposits -> 200 {"success":true,"deposit":{"id":"dep-..."}}
  //   GET  /api/stock/deposits -> {"deposits":[]}
  //
  // A tela Estoque > Depositos nao listava e nao gravava. As rotas proprias
  // estao logo abaixo.
  const stockCollectionMatch = pathname.match(/^\/api\/stock\/(product-categories|movement-categories|price-tables|catalogs)(?:\/([^/]+))?$/);
  if (stockCollectionMatch) {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const config = stockCore.STOCK_COLLECTIONS[stockCollectionMatch[1]];
      const id = stockCollectionMatch[2] ? decodeURIComponent(stockCollectionMatch[2]) : '';
      const data = loadData();
      const list = data[config.key];
      const serialize = (item) => (config.serialize ? config.serialize(item, data) : item);

      if (req.method === 'GET' && !id) {
        const ordered = list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return sendJson(res, { [config.listKey]: ordered.map(serialize) });
      }

      if (req.method === 'GET') {
        const item = list.find((entry) => entry.id === id);
        if (!item) return sendJson(res, { error: config.notFound }, 404);
        return sendJson(res, { [config.itemKey]: serialize(item) });
      }

      if (req.method === 'POST' && !id) {
        const body = await readBody(req);
        const built = config.build(body, null, data);
        if (built.code && list.some((entry) => String(entry.code || '').toLowerCase() === built.code.toLowerCase())) {
          return sendJson(res, { error: 'Já existe um registro com este código.' }, 409);
        }
        const item = { id: stockCore.createId(config.prefix), ...built, createdAt: new Date().toISOString() };
        list.push(item);
        saveData(data);
        return sendJson(res, { success: true, [config.itemKey]: serialize(item) });
      }

      if (req.method === 'PUT' && id) {
        const index = list.findIndex((entry) => entry.id === id);
        if (index < 0) return sendJson(res, { error: config.notFound }, 404);
        const body = await readBody(req);
        const built = config.build(body, list[index], data);
        if (built.code && list.some((entry) => entry.id !== id && String(entry.code || '').toLowerCase() === built.code.toLowerCase())) {
          return sendJson(res, { error: 'Já existe um registro com este código.' }, 409);
        }
        const item = { ...list[index], ...built, updatedAt: new Date().toISOString() };
        list[index] = item;
        saveData(data);
        return sendJson(res, { success: true, [config.itemKey]: serialize(item) });
      }

      if (req.method === 'DELETE' && id) {
        const index = list.findIndex((entry) => entry.id === id);
        if (index < 0) return sendJson(res, { error: config.notFound }, 404);
        // A CATEGORIA DE MOVIMENTACAO PERGUNTA AO RAZAO (fase BO).
        //
        // config.inUse varre data.stockMovements, que saiu do db.json na
        // fase AP: a lista chega vazia e a guarda respondia sempre "pode
        // excluir". As movimentacoes ficavam com category_id apontando para
        // uma categoria que nao existe, e a coluna Categoria da tela de
        // Movimentacoes passava a sair em branco no historico inteiro.
        //
        // Contagem, e nao varredura: o razao nao entra em memoria para
        // responder "tem algum?".
        if (stockCollectionMatch[1] === 'movement-categories') {
          const movimentos = await razaoEstoque.contarPorCategoria(id).catch(() => 0);
          if (movimentos > 0) {
            return sendJson(res, {
              error: `${movimentos === 1 ? 'Existe 1 movimentação' : `Existem ${movimentos} movimentações`} `
                + 'usando esta categoria. Marque como inativa em vez de excluir: assim ela some '
                + 'do formulário e o histórico continua explicável.'
            }, 409);
          }
        }
        const blocked = config.inUse(id, data);
        if (blocked) return sendJson(res, { error: blocked }, 409);
        list.splice(index, 1);
        saveData(data);
        return sendJson(res, { success: true });
      }
    } catch (error) {
      return sendStockError(res, error, 'Erro ao salvar cadastro do estoque');
    }
  }

  if (pathname === '/api/stock' && req.method === 'GET') {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('stock')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const products = await db.getProducts();
    return sendJson(res, { products });
  }

  if (pathname === '/api/stock' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('stock')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const product = await db.upsertProduct({
        id: body.id,
        name: body.name,
        sku: body.sku,
        stockQuantity: Number(body.stockQuantity || 0),
        costPrice: Number(body.costPrice || 0),
        salePrice: Number(body.salePrice || 0)
      });

      return sendJson(res, { success: true, product });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar produto' }, 400);
    }
  }

  if (pathname.startsWith('/api/stock/') && req.method === 'DELETE') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('stock')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/stock/', ''));

      // Vendas e Compras já são Supabase (a FK do schema em sales/purchases
      // não protege esse caso — são tabelas diferentes das de verdade usadas
      // aqui, orders/quotes/purchases). Checa direto nas duas fontes.
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncSalesData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const emUsoEmVendas = [...data.orders, ...data.quotes].some((record) =>
        (record.items || []).some((item) => item.productId === id));
      const emUsoEmCompras = (data.purchases || []).some((purchase) => purchase.productId === id);
      if (emUsoEmVendas || emUsoEmCompras) {
        return sendJson(res, { error: 'Não é possível excluir: este produto está vinculado a pedidos, orçamentos ou compras existentes.' }, 409);
      }

      await db.deleteProduct(id);
      return sendJson(res, { success: true });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao excluir produto' }, error.status || 400);
    }
  }

  if (pathname === '/api/finance' && req.method === 'GET') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    // data.purchases só é populado pelo sync com o Supabase; sem isto vinha vazio.
    // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 2x essa latencia por nada.
    await Promise.all([
      syncPurchasesData(data),
      syncFinanceData(data)
    ]);
    return sendJson(res, { finance: data.finance, sales: data.sales, purchases: data.purchases });
  }

  if (pathname === '/api/finance/summary' && req.method === 'GET') {
    try {
      const data = loadData();
      // O DASHBOARD DO FINANCEIRO SAIA TODO ZERADO (fase BC). Esta rota nao
      // sincronizava nada: `finance`, `financialPayments` e `bankAccounts` estao
      // em NAO_PERSISTIR e chegavam vazios, entao Contas a Pagar, Contas a
      // Receber, saldo, previsao e grafico saiam R$ 0,00 com HTTP 200 e sem erro
      // nenhum na tela — enquanto a lista de lancamentos, que sincroniza,
      // mostrava os titulos. As duas telas do MESMO modulo discordavam.
      //
      // syncCadastroData e syncPurchasesData entram porque
      // resolveFinanceCounterparty le people/cnpjs/purchases para escrever o
      // nome do cliente/fornecedor de cada linha.
      await Promise.all([
        syncFinanceData(data),
        syncCadastroData(data),
        syncPurchasesData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const summary = buildFinanceDashboardSummary(data, url.searchParams);
      return sendJson(res, summary);
    } catch (error) {
      return sendJson(res, { error: 'Erro ao carregar o resumo financeiro' }, 500);
    }
  }

  if (pathname === '/api/finance/meta' && req.method === 'GET') {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 2x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncFinanceData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, {
      categories: data.financialCategories,
      costCenters: data.costCenters,
      bankAccounts: data.bankAccounts,
      directory: getCadastroDirectory(data),
      // Produtos com a classificação fiscal: é o que permite montar o item da
      // NF-e a partir do cadastro em vez de digitar NCM e origem a cada
      // emissão — digitado à mão, o NCM erra e a regra fiscal não casa.
      produtos: (await db.getProducts()).map((p) => ({
        id: p.id, name: p.name, sku: p.sku, salePrice: p.salePrice,
        ncm: p.ncm, cest: p.cest, ean: p.ean, origem: p.origem,
        unidadeComercial: p.unidadeComercial, unidadeTributavel: p.unidadeTributavel
      }))
    });
  }

  if (pathname === '/api/finance/categories' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome da categoria' }, 400);
      }
      const category = await db.createFinancialCategory({ name, type: body.type || 'ambos' });
      return sendJson(res, { success: true, category });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar categoria' }, 400);
    }
  }

  if (pathname === '/api/finance/cost-centers' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome do centro de custo' }, 400);
      }
      const costCenter = await db.createCostCenter({ name });
      return sendJson(res, { success: true, costCenter });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar centro de custo' }, 400);
    }
  }

  if (pathname === '/api/finance/bank-accounts' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome da conta bancária' }, 400);
      }
      const bankAccount = await db.createBankAccount({
        name,
        bank: body.bank || '',
        agency: body.agency || '',
        number: body.number || ''
      });
      return sendJson(res, { success: true, bankAccount });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar conta bancária' }, 400);
    }
  }

  if (pathname === '/api/finance/entries' && req.method === 'GET') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const filtered = filterFinanceEntries(data, url.searchParams)
        .sort((a, b) => (b.date === a.date ? String(b.id).localeCompare(String(a.id)) : String(b.date).localeCompare(String(a.date))));
      const { page, limit } = parsePageParams(url.searchParams, 20);
      const start = (page - 1) * limit;
      const pageEntries = filtered.slice(start, start + limit).map((entry) => serializeFinanceEntry(entry, data));
      return sendJson(res, { entries: pageEntries, total: filtered.length, page, limit });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar lançamentos' }, 500);
    }
  }

  if (pathname === '/api/finance/entries' && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const type = String(body.type || 'DESPESA').toUpperCase();
      if (!['RECEITA', 'DESPESA', 'TRANSFERENCIA'].includes(type)) {
        return sendJson(res, { error: 'Tipo de lançamento inválido' }, 400);
      }
      const amount = Number(body.amount || 0);
      const invalido = validarLancamentoFinanceiro({ ...body, type, amount });
      if (invalido) return sendJson(res, { error: invalido }, 400);
      const today = new Date().toISOString().slice(0, 10);
      const entry = await db.createFinancialEntry({
        type,
        date: body.date || today,
        dueDate: body.dueDate || body.date || today,
        amount,
        description: String(body.description).trim(),
        document: body.document || '',
        note: body.note || '',
        category: body.category || '',
        costCenter: body.costCenter || '',
        bankAccountId: body.bankAccountId || '',
        targetBankAccountId: type === 'TRANSFERENCIA' ? (body.targetBankAccountId || '') : '',
        clientSupplierId: body.clientSupplierId || '',
        clientSupplierName: body.clientSupplierName || '',
        referenceId: '',
        status: 'pending',
        createdBy: user.id,
        createdByName: user.name
      });
      // O lançamento acabou de nascer no Supabase; a lista em memória ainda é a
      // de antes da gravação, e serializeFinanceEntry lê dela para resolver
      // categoria/conta. Sem isto, a resposta sairia sem o registro novo.
      data.finance.push(entry);
      await addFinanceAuditLog(data, { action: 'criarLancamento', entry, byId: user.id, byName: user.name });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar lançamento' }, 400);
    }
  }

  if (/^\/api\/finance\/entries\/[^/]+\/payments$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.split('/')[4]);
      const entry = data.finance.find((item) => item.id === id);
      if (!entry) {
        return sendJson(res, { error: 'Lançamento não encontrado' }, 404);
      }
      if (entry.status === 'cancelado') {
        return sendJson(res, { error: 'Lançamento cancelado não pode receber baixa.' }, 400);
      }

      const body = await readBody(req);
      const amount = Number(body.amount || 0);
      const interest = Number(body.interest || 0);
      const fine = Number(body.fine || 0);
      const discount = Number(body.discount || 0);
      if (!(amount > 0)) {
        return sendJson(res, { error: 'Informe um valor de pagamento maior que zero' }, 400);
      }
      if (interest < 0 || fine < 0 || discount < 0) {
        return sendJson(res, { error: 'Juros, multa e desconto não podem ser negativos' }, 400);
      }

      const existingPayments = getFinanceEntryPayments(data, entry.id);
      const dueBeforeThisPayment = financeEntryEffectiveDue(entry, existingPayments);
      const paidBeforeThisPayment = financeEntryPaidTotal(existingPayments);
      const maxAllowedAmount = (dueBeforeThisPayment - paidBeforeThisPayment) + interest + fine - discount;
      if (amount > maxAllowedAmount + 0.01) {
        return sendJson(res, { error: `Valor do pagamento (${amount.toFixed(2)}) é maior que o saldo em aberto (${Math.max(0, maxAllowedAmount).toFixed(2)}).` }, 400);
      }

      const payment = await db.createFinancialPayment({
        entryId: entry.id,
        amount,
        date: body.date || new Date().toISOString().slice(0, 10),
        bankAccountId: body.bankAccountId || entry.bankAccountId || '',
        interest,
        fine,
        discount,
        note: body.note || '',
        createdBy: user.id,
        createdByName: user.name
      });
      // A baixa entra na lista em memória ANTES de recalcular o status: é ela
      // que decide se o lançamento virou parcial ou pago.
      data.financialPayments.push(payment);
      entry.status = recomputeFinanceEntryStatus(entry, data);
      entry.updatedAt = new Date().toISOString();
      await db.updateFinancialEntry(entry.id, { status: entry.status });
      await addFinanceAuditLog(data, { action: 'baixarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: payment.id, amount } });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao registrar pagamento' }, 400);
    }
  }

  if (/^\/api\/finance\/entries\/[^/]+\/estorno$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.split('/')[4]);
      const entry = data.finance.find((item) => item.id === id);
      if (!entry) {
        return sendJson(res, { error: 'Lançamento não encontrado' }, 404);
      }
      if (entry.status === 'cancelado') {
        return sendJson(res, { error: 'Lançamento cancelado não pode ter baixa estornada.' }, 400);
      }

      const payments = getFinanceEntryPayments(data, entry.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const last = payments[payments.length - 1];
      if (!last) {
        return sendJson(res, { error: 'Não há baixa para estornar neste lançamento.' }, 400);
      }

      await db.deleteFinancialPayment(last.id);
      data.financialPayments = data.financialPayments.filter((p) => p.id !== last.id);
      entry.status = recomputeFinanceEntryStatus(entry, data);
      entry.updatedAt = new Date().toISOString();
      await db.updateFinancialEntry(entry.id, { status: entry.status });
      await addFinanceAuditLog(data, { action: 'estornarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: last.id, amount: last.amount } });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao estornar lançamento' }, 400);
    }
  }

  if (/^\/api\/finance\/entries\/[^/]+\/cancelar$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.split('/')[4]);
      const entry = data.finance.find((item) => item.id === id);
      if (!entry) {
        return sendJson(res, { error: 'Lançamento não encontrado' }, 404);
      }
      if (entry.status === 'paid' || entry.status === 'parcial') {
        return sendJson(res, { error: 'Lançamento com baixa registrada (parcial ou total) não pode ser cancelado. Estorne as baixas primeiro.' }, 400);
      }
      if (entry.status === 'cancelado') {
        return sendJson(res, { error: 'Este lançamento já está cancelado.' }, 400);
      }

      // FASE AX: MOTIVO OBRIGATÓRIO.
      //
      // Cancelar era um clique e um "confirma?". Meses depois, um lançamento
      // cancelado de R$ 8.400 é um registro que ninguém explica: a trilha de
      // auditoria diz quem cancelou, e o porquê — que é o que decide se foi
      // erro de digitação, venda desfeita ou cobrança abandonada — não existia
      // em lugar nenhum.
      //
      // O MÍNIMO É 10, o mesmo da dispensa de documento fiscal (fase AV). Não
      // impede um "aaaaaaaaaa", e não é isso que ele faz: impede a tecla
      // apertada sem querer e a letra solta, que é o que aparece quando o campo
      // aceita qualquer coisa. Um número maior só ensinaria a repetir letra.
      const body = await readBody(req);
      const motivo = String(body.motivo || body.reason || '').trim();
      if (motivo.length < 10) {
        return sendJson(res, {
          error: 'Informe o motivo do cancelamento (pelo menos 10 caracteres). '
            + 'Lançamento cancelado sem motivo é um valor que some do caixa sem explicação.'
        }, 400);
      }

      const agora = new Date().toISOString();
      entry.status = 'cancelado';
      entry.cancelReason = motivo;
      entry.cancelledAt = agora;
      entry.cancelledByName = user.name || '';
      entry.updatedAt = agora;
      await db.updateFinancialEntry(entry.id, {
        status: 'cancelado',
        cancelReason: motivo,
        cancelledAt: agora,
        cancelledByName: user.name || ''
      });
      // A trilha continua sendo a prova (ninguém a edita); as colunas acima são
      // a leitura, onde quem abre o lançamento procura. Ver a migração fase-ax.
      await addFinanceAuditLog(data, { action: 'cancelarLancamento', entry, byId: user.id, byName: user.name, details: { motivo } });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao cancelar lançamento' }, 400);
    }
  }

  if (pathname.startsWith('/api/finance/entries/') && req.method === 'PUT') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/finance/entries/', ''));
      const entry = data.finance.find((item) => item.id === id);
      if (!entry) {
        return sendJson(res, { error: 'Lançamento não encontrado' }, 404);
      }
      if (entry.status !== 'pending') {
        return sendJson(res, { error: 'Só é possível editar lançamentos ainda pendentes (sem baixa registrada).' }, 400);
      }

      const body = await readBody(req);

      // AS MESMAS REGRAS DO POST, sobre o estado PROPOSTO (fase BG).
      //
      // Vem antes dos dois ramos porque vale para os dois: o vinculado protege
      // valor e descrição, mas deixa as contas bancárias editáveis, e era por
      // aí que a transferência para si mesma passava.
      //
      // O merge com o registro atual é o ponto: um PUT que manda só `amount`
      // precisa ser conferido contra a descrição que já estava gravada.
      const proposto = {
        type: entry.type,
        description: body.description !== undefined ? body.description : entry.description,
        amount: body.amount !== undefined ? body.amount : entry.amount,
        bankAccountId: body.bankAccountId !== undefined ? body.bankAccountId : entry.bankAccountId,
        targetBankAccountId: body.targetBankAccountId !== undefined
          ? body.targetBankAccountId : entry.targetBankAccountId
      };
      const invalido = validarLancamentoFinanceiro(proposto);
      if (invalido) return sendJson(res, { error: invalido }, 400);

      // LANÇAMENTO VINCULADO a um pedido (referenceId) ou a uma NF-e (nfeId).
      //
      // Antes daqui saía um "não pode editar" seco, e o sistema se contradizia:
      // ao FATURAR um pedido, o próprio app leva o usuário a esta tela para
      // "ajustar forma de pagamento e vencimento" (ver public/app.js, no fluxo
      // de mudança de status da venda). A pessoa preenchia tudo e o servidor
      // recusava — um beco sem saída que o sistema mesmo criava. Relatado em
      // 22/08/2026, num recebível do Pedido 1009.
      //
      // A saída não é liberar tudo. Valor, data, descrição e cliente PERTENCEM
      // ao pedido: mudá-los aqui faria o Financeiro divergir da venda, e a
      // conferência só acusaria isso muito depois. O que não pertence — quando
      // vence, em que conta cai, em que plano de contas e centro de custo
      // entra, documento e observação — é justamente o que faltava ajustar.
      const vinculadoAoPedido = Boolean(entry.referenceId);
      const vinculadoANfe = Boolean(entry.nfeId);
      if (vinculadoAoPedido || vinculadoANfe) {
        const mudou = (campo, comparar) => body[campo] !== undefined && comparar(body[campo]);
        const texto = (v) => String(v == null ? '' : v).trim();
        const protegidos = [
          ['valor', mudou('amount', (v) => Number(v || 0) !== Number(entry.amount || 0))],
          ['data', mudou('date', (v) => texto(v) !== texto(entry.date))],
          ['descrição', mudou('description', (v) => texto(v) !== texto(entry.description))],
          ['cliente', mudou('clientSupplierId', (v) => texto(v) !== texto(entry.clientSupplierId))
            || mudou('clientSupplierName', (v) => texto(v) !== texto(entry.clientSupplierName))],
          ['tipo', mudou('type', (v) => texto(v).toUpperCase() !== texto(entry.type).toUpperCase())]
        ].filter(([, alterado]) => alterado).map(([nome]) => nome);

        // Recusa em vez de ignorar em silêncio: aceitar o salvamento e manter o
        // valor antigo é pior do que negar — a tela diria "salvo" e o número
        // continuaria o outro.
        if (protegidos.length) {
          const onde = vinculadoANfe
            ? 'Esses dados vêm da NF-e; para corrigi-los é preciso cancelar a nota e emitir outra.'
            : 'Esses dados vêm do pedido de origem; corrija por lá e o financeiro acompanha.';
          return sendJson(res, {
            error: `Neste lançamento não dá para alterar: ${protegidos.join(', ')}. ${onde} `
              + 'Vencimento, conta bancária, plano de contas, centro de custo, documento e observação continuam editáveis aqui.'
          }, 400);
        }

        // Só o que o pedido/NF-e não possui.
        if (body.dueDate !== undefined) entry.dueDate = body.dueDate;
        // Fase AY: o numero volta na frente mesmo que o usuario o apague do campo —
        // e' o que faz "padronizado" valer tambem depois da edicao. `documento`
        // nunca duplica o prefixo (ver shared/lancamento_codigo.js).
        if (body.document !== undefined) entry.document = lancamentoCodigo.documento(entry.code, body.document);
        if (body.note !== undefined) entry.note = body.note;
        if (body.category !== undefined) entry.category = body.category;
        if (body.costCenter !== undefined) entry.costCenter = body.costCenter;
        if (body.bankAccountId !== undefined) entry.bankAccountId = body.bankAccountId;
        if (body.targetBankAccountId !== undefined) entry.targetBankAccountId = body.targetBankAccountId;
        entry.status = recomputeFinanceEntryStatus(entry, data);
        entry.updatedAt = new Date().toISOString();
        // Mesmo caminho de persistência da edição livre, logo abaixo: registro
        // inteiro no banco, auditoria e só então o arquivo local.
        await db.updateFinancialEntry(entry.id, entry);
        await addFinanceAuditLog(data, {
          action: 'editarLancamentoVinculado',
          entry,
          byId: user.id,
          byName: user.name,
          details: { referenceId: entry.referenceId || '', nfeId: entry.nfeId || '' }
        });
        saveData(data);
        return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
      }
      if (body.description !== undefined) entry.description = String(body.description).trim();
      if (body.amount !== undefined) entry.amount = Number(body.amount || 0);
      if (body.date !== undefined) entry.date = body.date;
      if (body.dueDate !== undefined) entry.dueDate = body.dueDate;
      // Fase AY: o numero volta na frente mesmo que o usuario o apague do campo —
      // e' o que faz "padronizado" valer tambem depois da edicao. `documento`
      // nunca duplica o prefixo (ver shared/lancamento_codigo.js).
      if (body.document !== undefined) entry.document = lancamentoCodigo.documento(entry.code, body.document);
      if (body.note !== undefined) entry.note = body.note;
      if (body.category !== undefined) entry.category = body.category;
      if (body.costCenter !== undefined) entry.costCenter = body.costCenter;
      if (body.bankAccountId !== undefined) entry.bankAccountId = body.bankAccountId;
      if (body.targetBankAccountId !== undefined) entry.targetBankAccountId = body.targetBankAccountId;
      if (body.clientSupplierId !== undefined) entry.clientSupplierId = body.clientSupplierId;
      if (body.clientSupplierName !== undefined) entry.clientSupplierName = body.clientSupplierName;
      entry.status = recomputeFinanceEntryStatus(entry, data);
      entry.updatedAt = new Date().toISOString();
      // Manda o registro inteiro: a edição pode ter mexido em qualquer campo, e
      // updateFinancialEntry só grava o que vier definido.
      await db.updateFinancialEntry(entry.id, entry);
      await addFinanceAuditLog(data, { action: 'editarLancamento', entry, byId: user.id, byName: user.name });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao editar lançamento' }, 400);
    }
  }

  if (pathname.startsWith('/api/finance/entries/') && req.method === 'GET') {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 3x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncPurchasesData(data),
      syncFinanceData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.replace('/api/finance/entries/', ''));
    const entry = data.finance.find((item) => item.id === id);
    if (!entry) {
      return sendJson(res, { error: 'Lançamento não encontrado' }, 404);
    }
    return sendJson(res, { entry: serializeFinanceEntry(entry, data) });
  }

  if (pathname === '/api/finance/nfe' && req.method === 'GET') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 2x essa latencia por nada.
      await Promise.all([
        syncNfeData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      // A LISTA É UMA SÓ. Antes esta rota mostrava apenas `data.nfes` — o
      // registro manual do Financeiro — e a nota realmente transmitida à
      // SEFAZ não aparecia em lugar nenhum que o usuário fosse olhar.
      //
      // As notas fiscais vêm primeiro na ordenação por serem as que valem;
      // as manuais continuam visíveis para o histórico não sumir da tela.
      // Se a tabela fiscal não responder (migração pendente, por exemplo), a
      // lista degrada para as manuais em vez de a tela não abrir.
      let fiscais = [];
      try {
        fiscais = (await fiscalDb.getNfeRecords()).map(fiscalNfeParaLista);
      } catch (erroFiscal) {
        fiscais = [];
      }
      const manuais = (data.nfes || []).map((nfe) => ({ ...serializeNfe(nfe, data), origem: 'financeiro' }));
      const todas = fiscais.concat(manuais);

      const filtered = filterNfes(data, url.searchParams, todas)
        .sort((a, b) => (String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))));
      const { page, limit } = parsePageParams(url.searchParams, 15);
      const start = (page - 1) * limit;
      const pageItems = filtered.slice(start, start + limit);
      return sendJson(res, { nfes: pageItems, total: filtered.length, page, limit });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar NF-e' }, 500);
    }
  }

  if (pathname === '/api/finance/nfe' && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 2x essa latencia por nada.
      await Promise.all([
        syncFinanceData(data),
        syncNfeData(data),
        syncSalesData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);

      const clientName = String(body.customer || '').trim();
      if (!clientName) {
        return sendJson(res, { error: 'Informe o nome do cliente' }, 400);
      }
      const document = sanitizeDigits(body.clientDocument || '');
      if (!isValidDocument(document)) {
        return sendJson(res, { error: 'CPF/CNPJ do cliente inválido. Informe um documento válido.' }, 400);
      }

      const rawItems = Array.isArray(body.items) ? body.items.filter((item) => item && String(item.description || '').trim()) : [];
      if (!rawItems.length) {
        return sendJson(res, { error: 'Adicione ao menos um produto/serviço' }, 400);
      }
      const items = rawItems.map((item) => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        return {
          code: item.code || '',
          description: String(item.description).trim(),
          quantity,
          unitPrice,
          total: Math.round(quantity * unitPrice * 100) / 100,
          cfop: item.cfop || '',
          ncm: item.ncm || ''
        };
      });
      const amount = items.reduce((sum, item) => sum + item.total, 0);
      if (!(amount > 0)) {
        return sendJson(res, { error: 'O valor total da NF-e deve ser maior que zero' }, 400);
      }

      // A NOTA É GRAVADA PRIMEIRO, e as parcelas depois: financial_entries.nfe_id
      // referencia nfes(id), então parcela de nota inexistente é recusada pelo
      // banco. O id também sai daqui — quem gera é createNfe.
      // Nota gerada a partir de um pedido (fluxo Pedido -> Gerar NF-e). O
      // pedido precisa existir e ainda não ter nota: emitir a segunda para o
      // mesmo pedido duplicaria documento fiscal, que não se apaga depois.
      const pedidoOrigem = body.orderId
        ? (data.orders || []).find((entrada) => entrada.id === body.orderId)
        : null;
      if (body.orderId && !pedidoOrigem) {
        return sendJson(res, { error: 'Pedido de origem não encontrado' }, 404);
      }
      if (pedidoOrigem?.nfeId) {
        const jaEmitida = (data.nfes || []).find((n) => n.id === pedidoOrigem.nfeId);
        if (jaEmitida && normalizeNfeStatus(jaEmitida.status) !== 'cancelada') {
          return sendJson(res, { error: `Este pedido já tem a NF-e ${jaEmitida.number} emitida.` }, 409);
        }
      }

      const nfe = await db.createNfe({
        orderId: body.orderId || '',
        number: body.number || String(Date.now()).slice(-8),
        series: body.series || '1',
        date: body.date || new Date().toISOString().slice(0, 10),
        status: 'autorizada',
        key: body.key || '',
        amount,
        customer: clientName,
        clientSupplierId: body.clientSupplierId || '',
        clientDocument: document,
        clientAddress: body.clientAddress || '',
        clientCity: body.clientCity || '',
        clientState: body.clientState || '',
        clientStateRegistration: body.clientStateRegistration || '',
        taxNotes: body.taxNotes || '',
        paymentType: body.paymentType === 'parcelado' ? 'parcelado' : 'avista',
        installmentsCount: body.paymentType === 'parcelado' ? Math.min(60, Math.max(2, Math.round(Number(body.installmentsCount || 2)))) : 1,
        installmentIntervalDays: Math.max(1, Number(body.installmentIntervalDays || 30)),
        createdBy: user.id,
        createdByName: user.name
      }, items);
      data.nfes.push(nfe);

      const installments = buildNfeInstallments(nfe);
      // for..of, e não forEach: cada parcela é uma gravação no Supabase e
      // forEach não espera promessa — as parcelas seriam respondidas antes de
      // existirem.
      for (const inst of installments) {
        const entry = await db.createFinancialEntry({
          type: 'RECEITA',
          date: nfe.date,
          dueDate: inst.dueDate,
          amount: inst.amount,
          // A QUINTA ORIGEM. A fase AX disse "as quatro origens" e passou por
          // esta: a NF-e MANUAL do Financeiro continuava escrevendo a propria
          // frase. Achada quando um teste da fase BB criou uma nota manual e o
          // lancamento saiu como "NF-e 999001", sem dizer o que a linha e'.
          description: descricaoLancamento.montar({
            qual: 'receita',
            tipo: 'venda',
            nota: nfe.number,
            parcela: inst.number,
            parcelas: installments.length
          }),
          document: nfe.number,
          clientSupplierId: nfe.clientSupplierId || '',
          clientSupplierName: nfe.customer,
          referenceId: '',
          nfeId: nfe.id,
          status: 'pending',
          createdBy: user.id,
          createdByName: user.name
        });
        data.finance.push(entry);
      }

      // Fecha o vínculo do outro lado: o pedido passa a saber qual nota saiu
      // dele. É isso que impede a segunda emissão e o que a tela usa para
      // mostrar a NF-e sem varrer a tabela.
      if (pedidoOrigem) {
        pedidoOrigem.nfeId = nfe.id;
        await db.updateOrder(pedidoOrigem.id, { ...pedidoOrigem, nfeId: nfe.id });
      }

      await addFinanceAuditLog(data, {
        action: 'emitirNfe',
        entry: { id: nfe.id, description: `NF-e ${nfe.number} · ${nfe.customer}` },
        byId: user.id,
        byName: user.name,
        details: { parcelas: installments.length, amount }
      });
      saveData(data);
      return sendJson(res, { success: true, nfe: serializeNfe(nfe, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao emitir NF-e' }, 400);
    }
  }

  if (/^\/api\/finance\/nfe\/[^/]+\/cancelar$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 2x essa latencia por nada.
      await Promise.all([
        syncNfeData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.split('/')[4]);
      const nfe = data.nfes.find((item) => item.id === id);
      if (!nfe) {
        return sendJson(res, { error: 'NF-e não encontrada' }, 404);
      }
      if (normalizeNfeStatus(nfe.status) === 'cancelada') {
        return sendJson(res, { error: 'NF-e já está cancelada' }, 400);
      }

      // Cancelar é mudar o status — a nota NUNCA é apagada. É documento fiscal.
      nfe.status = 'cancelada';
      nfe.updatedAt = new Date().toISOString();
      await db.updateNfe(nfe.id, { status: 'cancelada' });

      const linkedEntries = (data.finance || []).filter((entry) => entry.nfeId === nfe.id);
      let cancelledCount = 0;
      // for..of: cada cancelamento de parcela é uma gravação, e forEach não espera.
      for (const entry of linkedEntries) {
        if (entry.status === 'pending' || entry.status === 'parcial') {
          entry.status = 'cancelado';
          entry.updatedAt = new Date().toISOString();
          await db.updateFinancialEntry(entry.id, { status: 'cancelado' });
          await addFinanceAuditLog(data, {
            action: 'cancelarLancamento',
            entry,
            byId: user.id,
            byName: user.name,
            details: { motivo: `Cancelamento da NF-e ${nfe.number}` }
          });
          cancelledCount += 1;
        }
      }

      await addFinanceAuditLog(data, {
        action: 'cancelarNfe',
        entry: { id: nfe.id, description: `NF-e ${nfe.number} · ${nfe.customer}` },
        byId: user.id,
        byName: user.name,
        details: { lancamentosCancelados: cancelledCount, lancamentosMantidos: linkedEntries.length - cancelledCount }
      });
      saveData(data);
      return sendJson(res, { success: true, nfe: serializeNfe(nfe, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao cancelar NF-e' }, 400);
    }
  }

  if (pathname.startsWith('/api/finance/nfe/') && req.method === 'GET') {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 2 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 2x essa latencia por nada.
    await Promise.all([
      syncNfeData(data),
      syncFinanceData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.replace('/api/finance/nfe/', ''));
    const nfe = data.nfes.find((item) => item.id === id);
    if (!nfe) {
      return sendJson(res, { error: 'NF-e não encontrada' }, 404);
    }
    return sendJson(res, { nfe: serializeNfe(nfe, data) });
  }

  if (pathname === '/api/finance/bank-transactions' && req.method === 'GET') {
    try {
      const data = loadData();
      // serializeBankTransaction resolve, para cada transacao, o lancamento a
      // que ela foi conciliada e a conta bancaria — os dois em `data.finance` e
      // `data.bankAccounts`, que estao em NAO_PERSISTIR. Sem o sync, a coluna
      // Conta sai vazia e a transacao conciliada aparece sem a descricao do
      // lancamento, como se nao estivesse conciliada.
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const filtered = filterBankTransactions(data, url.searchParams)
        .sort((a, b) => (String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))));
      const { page, limit } = parsePageParams(url.searchParams, 20);
      const start = (page - 1) * limit;
      const pageItems = filtered.slice(start, start + limit).map((tx) => serializeBankTransaction(tx, data));
      const summary = {
        naoConciliado: filtered.filter((tx) => tx.status === 'nao_conciliado').length,
        conciliado: filtered.filter((tx) => tx.status === 'conciliado').length,
        ignorado: filtered.filter((tx) => tx.status === 'ignorado').length
      };
      return sendJson(res, { transactions: pageItems, total: filtered.length, page, limit, summary });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar extrato' }, 500);
    }
  }

  if (pathname === '/api/finance/bank-transactions' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      if (!body.bankAccountId) {
        return sendJson(res, { error: 'Selecione a conta bancária' }, 400);
      }
      if (!String(body.description || '').trim()) {
        return sendJson(res, { error: 'Informe a descrição da movimentação' }, 400);
      }
      const amount = Math.abs(Number(body.amount || 0));
      if (!(amount > 0)) {
        return sendJson(res, { error: 'Informe um valor maior que zero' }, 400);
      }
      const tx = buildBankTransaction({ ...body, amount }, user, 'manual');
      data.bankTransactions.push(tx);
      saveData(data);
      return sendJson(res, { success: true, transaction: serializeBankTransaction(tx, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao registrar movimentação' }, 400);
    }
  }

  if (pathname === '/api/finance/bank-transactions/import' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const bankAccountId = body.bankAccountId || '';
      if (!bankAccountId) {
        return sendJson(res, { error: 'Selecione a conta bancária de destino da importação' }, 400);
      }
      const rows = Array.isArray(body.rows) ? body.rows : (body.text ? parseCsv(body.text) : []);
      if (!rows.length) {
        return sendJson(res, { error: 'Nenhuma linha para importar. Verifique o CSV (cabeçalho: data,descricao,valor,tipo).' }, 400);
      }

      const created = [];
      let skipped = 0;
      rows.forEach((row) => {
        const description = String(row.description || row.descricao || row.Descricao || row['Descrição'] || '').trim();
        const rawAmount = row.amount ?? row.valor ?? row.Valor ?? 0;
        const amount = Math.abs(Number(String(rawAmount).replace(',', '.')) || 0);
        if (!description || !(amount > 0)) {
          skipped += 1;
          return;
        }
        const date = row.date || row.data || row.Data || new Date().toISOString().slice(0, 10);
        const typeRaw = String(row.type || row.tipo || row.Tipo || '').toLowerCase();
        const type = (typeRaw.startsWith('sa') || Number(String(rawAmount).replace(',', '.')) < 0) ? 'saida' : 'entrada';
        const tx = buildBankTransaction({ bankAccountId, date, description, amount, type }, user, 'csv');
        data.bankTransactions.push(tx);
        created.push(tx);
      });

      saveData(data);
      return sendJson(res, {
        success: true,
        count: created.length,
        skipped,
        transactions: created.map((tx) => serializeBankTransaction(tx, data))
      });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao importar extrato' }, 400);
    }
  }

  if (/^\/api\/finance\/bank-transactions\/[^/]+\/matches$/.test(pathname) && req.method === 'GET') {
    const data = loadData();
    // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
    // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
    // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
    // Em sequencia, a rota pagava 3x essa latencia por nada.
    await Promise.all([
      syncCadastroData(data),
      syncPurchasesData(data),
      syncFinanceData(data)
    ]);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.split('/')[4]);
    const tx = data.bankTransactions.find((item) => item.id === id);
    if (!tx) {
      return sendJson(res, { error: 'Transação não encontrada' }, 404);
    }
    return sendJson(res, { matches: findBankTransactionMatches(tx, data) });
  }

  if (/^\/api\/finance\/bank-transactions\/[^/]+\/conciliar$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      // Uma ONDA so de ida ao banco, e nao 3 em fila. Cada consulta ao
      // Supabase custa ~300ms de rede (medido), e estes syncs sao independentes:
      // cada um escreve em chaves diferentes de `data` e nenhum le o do outro.
      // Em sequencia, a rota pagava 3x essa latencia por nada.
      await Promise.all([
        syncCadastroData(data),
        syncPurchasesData(data),
        syncFinanceData(data)
      ]);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.split('/')[4]);
      const tx = data.bankTransactions.find((item) => item.id === id);
      if (!tx) {
        return sendJson(res, { error: 'Transação não encontrada' }, 404);
      }
      if (tx.status === 'conciliado') {
        return sendJson(res, { error: 'Transação já está conciliada' }, 400);
      }

      const body = await readBody(req);
      const entry = data.finance.find((item) => item.id === body.entryId);
      if (!entry) {
        return sendJson(res, { error: 'Lançamento não encontrado' }, 404);
      }
      const wantedType = tx.type === 'entrada' ? 'receita' : 'despesa';
      if (classifyFinanceEntry(entry) !== wantedType) {
        return sendJson(res, { error: `Uma transação de ${tx.type === 'entrada' ? 'entrada' : 'saída'} só pode ser conciliada com um lançamento de ${wantedType}.` }, 400);
      }
      if (entry.status === 'cancelado') {
        return sendJson(res, { error: 'Lançamento cancelado não pode receber baixa.' }, 400);
      }

      const existingPayments = getFinanceEntryPayments(data, entry.id);
      const dueBefore = financeEntryEffectiveDue(entry, existingPayments);
      const paidBefore = financeEntryPaidTotal(existingPayments);
      const maxAllowed = dueBefore - paidBefore;
      if (tx.amount > maxAllowed + 0.01) {
        return sendJson(res, { error: `O valor da transação (${tx.amount.toFixed(2)}) é maior que o saldo em aberto do lançamento (${Math.max(0, maxAllowed).toFixed(2)}).` }, 400);
      }

      const payment = await db.createFinancialPayment({
        entryId: entry.id,
        amount: tx.amount,
        date: tx.date,
        bankAccountId: tx.bankAccountId,
        interest: 0,
        fine: 0,
        discount: 0,
        note: `Conciliado via Extrato Open Finance (transação ${String(tx.id).slice(-8)})`,
        createdBy: user.id,
        createdByName: user.name
      });
      data.financialPayments.push(payment);
      entry.status = recomputeFinanceEntryStatus(entry, data);
      entry.updatedAt = new Date().toISOString();
      await db.updateFinancialEntry(entry.id, { status: entry.status });

      tx.status = 'conciliado';
      tx.matchedEntryId = entry.id;
      tx.matchedPaymentId = payment.id;
      tx.updatedAt = new Date().toISOString();

      await addFinanceAuditLog(data, { action: 'baixarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: payment.id, amount: tx.amount, origem: 'conciliacao', transacaoId: tx.id } });
      await addFinanceAuditLog(data, { action: 'conciliarTransacao', entry: { id: tx.id, description: `Transação ${String(tx.id).slice(-8)} · ${tx.description}` }, byId: user.id, byName: user.name, details: { entryId: entry.id } });

      saveData(data);
      return sendJson(res, { success: true, transaction: serializeBankTransaction(tx, data), entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao conciliar transação' }, 400);
    }
  }

  if (/^\/api\/finance\/bank-transactions\/[^/]+\/desconciliar$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.split('/')[4]);
      const tx = data.bankTransactions.find((item) => item.id === id);
      if (!tx) {
        return sendJson(res, { error: 'Transação não encontrada' }, 404);
      }
      if (tx.status !== 'conciliado') {
        return sendJson(res, { error: 'Transação não está conciliada' }, 400);
      }

      const entry = data.finance.find((item) => item.id === tx.matchedEntryId);
      if (entry && tx.matchedPaymentId) {
        await db.deleteFinancialPayment(tx.matchedPaymentId);
        data.financialPayments = data.financialPayments.filter((p) => p.id !== tx.matchedPaymentId);
        entry.status = recomputeFinanceEntryStatus(entry, data);
        entry.updatedAt = new Date().toISOString();
        await db.updateFinancialEntry(entry.id, { status: entry.status });
        await addFinanceAuditLog(data, { action: 'estornarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: tx.matchedPaymentId, motivo: 'Desconciliação de transação bancária' } });
      }

      tx.status = 'nao_conciliado';
      tx.matchedEntryId = '';
      tx.matchedPaymentId = '';
      tx.updatedAt = new Date().toISOString();
      saveData(data);
      return sendJson(res, { success: true, transaction: serializeBankTransaction(tx, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao desconciliar transação' }, 400);
    }
  }

  if (/^\/api\/finance\/bank-transactions\/[^/]+\/ignorar$/.test(pathname) && req.method === 'POST') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.split('/')[4]);
    const tx = data.bankTransactions.find((item) => item.id === id);
    if (!tx) {
      return sendJson(res, { error: 'Transação não encontrada' }, 404);
    }
    if (tx.status === 'conciliado') {
      return sendJson(res, { error: 'Desconcilie a transação antes de ignorá-la.' }, 400);
    }
    tx.status = 'ignorado';
    tx.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJson(res, { success: true, transaction: serializeBankTransaction(tx, data) });
  }

  if (/^\/api\/finance\/bank-transactions\/[^/]+\/reativar$/.test(pathname) && req.method === 'POST') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.split('/')[4]);
    const tx = data.bankTransactions.find((item) => item.id === id);
    if (!tx) {
      return sendJson(res, { error: 'Transação não encontrada' }, 404);
    }
    if (tx.status !== 'ignorado') {
      return sendJson(res, { error: 'Transação não está ignorada' }, 400);
    }
    tx.status = 'nao_conciliado';
    tx.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJson(res, { success: true, transaction: serializeBankTransaction(tx, data) });
  }

  // ---------------------------------------------------------------------
  // Open Finance: conexão bancária real (Pluggy/Polp/Celcoin) via
  // lib/openfinance/service.js. Mesmo gate de permissão do resto do
  // Financeiro (user.allowedModules.includes('finance')) — é uma extensão
  // do Extrato que já existe, não um módulo à parte.
  // ---------------------------------------------------------------------
  if (pathname.startsWith('/api/open-finance/')) {
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }

    try {
      if (pathname === '/api/open-finance/status' && req.method === 'GET') {
        const status = await openFinanceService.healthCheck();
        return sendJson(res, status);
      }

      if (pathname === '/api/open-finance/institutions' && req.method === 'GET') {
        // Tenta atualizar o catálogo com o provider de verdade; sem provider
        // configurado (ou se a chamada falhar), segue com o que já tem em
        // cache — a tela não pode quebrar só por não ter provider ainda.
        if (openFinanceService.isConfigured()) {
          try {
            const fromProvider = await openFinanceService.getInstitutions();
            const providerName = openFinanceService.getActiveProviderName();
            for (const institution of fromProvider) {
              await openFinanceDb.upsertInstitution({ ...institution, provider: providerName });
            }
          } catch {
            // Provider selecionado mas ainda sem credencial válida — cai pro cache abaixo.
          }
        }
        const institutions = await openFinanceDb.getInstitutions();
        return sendJson(res, { institutions, providerConfigured: openFinanceService.isConfigured() });
      }

      if (pathname === '/api/open-finance/connections' && req.method === 'GET') {
        const estabelecimentoId = url.searchParams.get('estabelecimentoId') || undefined;
        const connections = await openFinanceDb.getConnections(estabelecimentoId);
        return sendJson(res, { connections });
      }

      if (pathname === '/api/open-finance/connections' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.estabelecimentoId) {
          return sendJson(res, { error: 'Informe o estabelecimento' }, 400);
        }
        // Sem provider configurado, isso lança o erro claro da Fase 1 em vez
        // de simular uma conexão — é o aviso que a tela deve mostrar.
        const providerConnection = await openFinanceService.createConnection({
          estabelecimentoId: body.estabelecimentoId,
          institutionId: body.institutionId
        });
        const connection = await openFinanceDb.createConnection({
          estabelecimentoId: body.estabelecimentoId,
          provider: openFinanceService.getActiveProviderName(),
          providerConnectionId: providerConnection.id,
          institutionId: body.institutionId || null,
          status: providerConnection.status || 'pending',
          credentials: providerConnection.credentials
        });
        await openFinanceDb.recordAuditLog({
          connectionId: connection.id,
          estabelecimentoId: body.estabelecimentoId,
          action: 'CONNECTION_CREATED',
          byId: user.id,
          byName: user.name
        });
        return sendJson(res, { success: true, connection });
      }

      if (/^\/api\/open-finance\/connections\/[^/]+\/sync$/.test(pathname) && req.method === 'POST') {
        const id = decodeURIComponent(pathname.split('/')[4]);
        const resultado = await syncOpenFinanceConnection(id);
        return sendJson(res, { success: true, resultado });
      }

      if (/^\/api\/open-finance\/connections\/[^/]+\/disconnect$/.test(pathname) && req.method === 'POST') {
        const id = decodeURIComponent(pathname.split('/')[4]);
        const connection = await openFinanceDb.getConnectionById(id);
        if (!connection) {
          return sendJson(res, { error: 'Conexão não encontrada' }, 404);
        }
        // Revogar do lado do provider é best-effort: se o provider não está
        // configurado, a credencial expirou ou a API dele está fora do ar,
        // o usuário não pode ficar PRESO com uma conexão que não consegue
        // marcar como desconectada localmente. O status local sempre muda;
        // uma falha do lado do provider só fica registrada na auditoria.
        let avisoProvider = null;
        try {
          const credentials = await openFinanceDb.getConnectionCredentials(id);
          await openFinanceService.disconnectConnection({ ...connection, credentials });
        } catch (error) {
          avisoProvider = error.message;
        }
        await openFinanceDb.updateConnection(id, { status: 'disconnected' });
        await openFinanceDb.recordAuditLog({
          connectionId: id,
          estabelecimentoId: connection.estabelecimentoId,
          action: 'CONNECTION_DISCONNECTED',
          byId: user.id,
          byName: user.name,
          details: avisoProvider ? { avisoProvider } : null
        });
        return sendJson(res, { success: true, avisoProvider });
      }

      if (/^\/api\/open-finance\/connections\/[^/]+\/accounts$/.test(pathname) && req.method === 'GET') {
        const id = decodeURIComponent(pathname.split('/')[4]);
        const data = loadData();
        await syncFinanceData(data);
        const accounts = data.bankAccounts.filter((acc) => acc.connectionId === id);
        return sendJson(res, { accounts });
      }

      if (/^\/api\/open-finance\/connections\/[^/]+\/audit$/.test(pathname) && req.method === 'GET') {
        const id = decodeURIComponent(pathname.split('/')[4]);
        const logs = await openFinanceDb.getAuditLogs({ connectionId: id });
        return sendJson(res, { logs });
      }
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro no Open Finance' }, error.status || 500);
    }
  }

  // A PORTA DOS FUNDOS DO FINANCEIRO (fase BK).
  //
  // Esta rota nao validava NADA: aceitava `type` fora do conjunto (o padrao
  // era 'sale', vocabulario aposentado ha fases), valor qualquer, e trocava
  // descricao vazia por "Lancamento" em silencio — dado inventado, que e pior
  // do que dado faltando. Tambem nao gravava trilha de auditoria.
  //
  // Ela e o par legado do /api/finance/entries. O unico cliente era a tela
  // "Conciliacao financeira" dentro de loadModule('finance') em public/app.js,
  // que ficou INALCANCAVEL quando o modulo Financeiro passou a ser servido
  // pelo registry (public/modules/finance/index.js): MavisModuleRegistry.finance
  // sempre renderiza algo e nunca devolve false, entao loadModule retorna antes
  // daquele ramo.
  //
  // NAO FOI APAGADA porque apagar rota e decisao de quem opera o sistema — pode
  // haver integracao externa batendo aqui. O que se fez foi tirar dela o poder
  // de gravar coisa que a rota viva recusa: as MESMAS regras, pelo MESMO
  // validador. Duas copias da regra foi o que criou o problema.
  if (pathname === '/api/finance' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      // 'sale'/'purchase' continuam sendo aceitos e traduzidos: e o que os
      // registros antigos e o cliente legado mandam, e recusa-los quebraria
      // quem ainda usa a rota sem ganhar nada.
      const LEGADOS = { sale: 'RECEITA', purchase: 'DESPESA' };
      const bruto = String(body.type || '').toLowerCase();
      const type = (LEGADOS[bruto] || String(body.type || 'DESPESA')).toUpperCase();
      if (!['RECEITA', 'DESPESA', 'TRANSFERENCIA'].includes(type)) {
        return sendJson(res, { error: 'Tipo de lançamento inválido' }, 400);
      }
      const amount = Number(body.amount || 0);
      // Sem o `|| 'Lançamento'`: a rota inventava a descricao em vez de cobrar.
      const invalido = validarLancamentoFinanceiro({ ...body, type, amount });
      if (invalido) return sendJson(res, { error: invalido }, 400);

      const entry = await db.createFinancialEntry({
        type,
        referenceId: body.referenceId || '',
        date: body.date || new Date().toISOString().slice(0, 10),
        description: String(body.description).trim(),
        amount,
        status: body.status || 'pending',
        createdBy: user.id,
        createdByName: user.name
      });
      data.finance.push(entry);
      await addFinanceAuditLog(data, { action: 'criarLancamento', entry, byId: user.id, byName: user.name });
      saveData(data);
      return sendJson(res, { success: true, entry });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar financeiro' }, 400);
    }
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('settings')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const canManageUsers = await ehAdmin(user);
    const canSeeSales = user.allowedModules.includes('sales');
    const canSeePurchases = user.allowedModules.includes('purchases');
    // TUDO NUMA IDA SÓ. Estes syncs eram quatro `await` em fila, cada um atrás
    // do seu `if` — o que escondia o custo: quem tem os quatro módulos pagava
    // quatro viagens ao Supabase (~260ms cada, medido) para buscar coleções que
    // não dependem umas das outras. Esta tela era a mais lenta do sistema por
    // isso, e não por trazer muito dado.
    //
    // Mesmas coleções legadas vazias do /api/dashboard: precisam vir do
    // Supabase. `people` entra junto porque, sem ele, a lista de vendedores do
    // vínculo chega vazia e a tela sugere que ninguém é vendedor.
    const [settings, allUsers, products] = await Promise.all([
      db.getSettings(),
      canManageUsers ? db.getUsers() : Promise.resolve([]),
      user.allowedModules.includes('stock') ? db.getProducts() : Promise.resolve([]),
      canSeeSales ? syncSalesData(data) : null,
      canSeePurchases ? syncPurchasesData(data) : null,
      syncFinanceData(data),
      canManageUsers ? syncCadastroData(data) : null
    ]);
    const totals = {
      totalUsers: canManageUsers ? allUsers.length : 0,
      totalProducts: user.allowedModules.includes('stock') ? products.length : 0,
      totalSales: canSeeSales ? (data.orders || []).length : 0,
      totalPurchases: canSeePurchases ? (data.purchases || []).filter((p) => p.status !== 'cancelada').length : 0,
      totalFinance: user.allowedModules.includes('finance') ? data.finance.length : 0
    };
    const safeUsers = canManageUsers
      ? allUsers.map((entry) => ({
          id: entry.id,
          username: entry.username,
          name: entry.name,
          role: entry.role,
          allowedModules: Array.isArray(entry.allowedModules) ? entry.allowedModules : [],
          // Sanitiza na LEITURA também: usuário gravado antes de as permissões
          // fantasma serem removidas ainda carrega 'manifestar' na coluna, e
          // devolvê-la faria a tela mostrar um controle que não existe.
          fiscalPermissions: fiscalPermissoes.sanitizar(entry.fiscalPermissions),
          // Fase AL: de quem sao as "minhas vendas" deste usuario. Sem isto a
          // tela de Usuarios nao teria como mostrar o vinculo atual, e todo
          // salvamento pareceria estar desvinculando alguem.
          sellerId: entry.sellerId || '',
          // Fase AN: sem isto o formulário abriria com todas as telas marcadas
          // e o primeiro salvamento desfaria os bloqueios sem ninguém pedir.
          blockedSubs: entry.blockedSubs || {}
        }))
      : [];
    return sendJson(res, {
      settings,
      users: safeUsers,
      // As pessoas com papel "Vendedor" no Cadastros. So' quem administra usuario
      // recebe a lista: ela e' um cadastro, e nao um dado publico.
      sellers: canManageUsers ? getSellersDirectory(data) : [],
      totals,
      permissions: {
        company: true,
        users: canManageUsers
      }
    });
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('settings')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      if (body.type === 'company') {
        const settings = await db.updateSettings({ ...(await db.getSettings()), ...body.payload });
        return sendJson(res, { success: true, settings });
      }

      if (body.type === 'user') {
        if (!(await ehAdmin(user))) {
          return sendJson(res, { error: 'Sem permissão para gerenciar usuários' }, 403);
        }
        const newUser = await db.createUser({
          username: body.payload.username,
          password: body.payload.password,
          name: body.payload.name,
          role: body.payload.role || 'user',
          allowedModules: body.payload.allowedModules || ['dashboard'],
          // Gravar só o que o portão sabe exigir. Sem isto, um POST à mão
          // salvaria 'manifestar' na coluna e ela voltaria a aparecer na tela.
          fiscalPermissions: fiscalPermissoes.sanitizar(body.payload.fiscalPermissions),
          // Fase AL: de quem sao as "minhas vendas" deste usuario.
          sellerId: String(body.payload.sellerId || '').trim(),
          // Fase AN: telas que este usuario nao ve dentro dos modulos liberados.
          blockedSubs: sanitizarTelasBloqueadas(body.payload.blockedSubs)
        });
        const data = loadData();
        data.auditLogs = data.auditLogs || [];
        await registrarAuditoria({ action: 'createUser', targetId: newUser.id, targetUsername: newUser.username, byId: user.id, byName: user.name });
        // O USUÁRIO NOVO PRECISA DE UM PAPEL, OU NÃO ENTRA EM LUGAR NENHUM.
        //
        // Com o RBAC instalado, o portão central decide por
        // permissoes.usuarioPode, e quem não tem linha em user_roles chega lá
        // com o conjunto de permissões VAZIO — e leva 403 em toda rota de
        // módulo. As caixas de módulo desta mesma tela não salvam: elas
        // alimentam podePeloModulo, que só é consultado quando o RBAC NÃO
        // existe. O admin criava o usuário, marcava os módulos, e a pessoa
        // entrava para ver "Sem permissão" em tudo.
        //
        // É o mesmo papel que a migração da fase L deu a todo mundo que existia
        // na época (banco/migrations/fase-l-controle-de-acesso.sql): admin para
        // quem é admin, 'usuario' para o resto. Quem quiser afinar depois usa a
        // tela de Controle de Acesso.
        //
        // Falhar aqui NÃO desfaz o usuário: ele existe, e o admin consegue dar
        // o papel pela outra tela. Mas tem de aparecer no log.
        try {
          await db.rbac.definirPapeisDoUsuario(
            newUser.id, [newUser.role === 'admin' ? 'admin' : 'usuario'], user.id
          );
        } catch (erroPapel) {
          console.error('Usuario criado, mas nao consegui dar o papel padrao', newUser.id, erroPapel.message);
        }
        saveData(data);
        return sendJson(res, { success: true, user: newUser });
      }

      return sendJson(res, { error: 'Tipo de configuração inválido' }, 400);
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar configurações' }, 400);
    }
  }

  // ---------------------------------------------------------------------
  // Controle de acesso: papéis, permissões e trilha de auditoria.
  // O portão lá em cima já exigiu 'usuarios.gerenciar' / 'auditoria.ler' para
  // chegar aqui — estas rotas não repetem a checagem de permissão, só a de
  // consistência (não se deve desmontar o próprio acesso, por exemplo).
  // ---------------------------------------------------------------------
  if (pathname === '/api/access-control' && req.method === 'GET') {
    try {
      const [papeis, permissoesCatalogo, papelPermissao, usuarios] = await Promise.all([
        db.rbac.listarPapeis(),
        db.rbac.listarPermissoes(),
        db.rbac.listarPermissoesDePapeis(),
        db.getUsers()
      ]);
      const acessoPorUsuario = {};
      for (const usuario of usuarios) {
        const acesso = await db.rbac.carregarAcessoDoUsuario(usuario.id);
        acessoPorUsuario[usuario.id] = {
          roles: acesso?.roles || [],
          permitidas: acesso ? [...acesso.efetivas] : [],
          negadas: acesso ? [...acesso.negadas] : []
        };
      }
      return sendJson(res, {
        disponivel: db.rbac.rbacEstaDisponivel(),
        roles: papeis,
        permissions: permissoesCatalogo,
        rolePermissions: papelPermissao,
        users: usuarios.map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active !== false, lastLoginAt: u.lastLoginAt })),
        userAccess: acessoPorUsuario
      });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao carregar o controle de acesso' }, 500);
    }
  }

  if (pathname.startsWith('/api/access-control/roles/') && req.method === 'PUT') {
    try {
      const requester = await getCurrentUser(req);
      const slug = decodeURIComponent(pathname.replace('/api/access-control/roles/', ''));
      if (slug === 'admin') {
        return sendJson(res, { error: 'O papel de administrador tem acesso total por definição e não recebe lista de permissões.' }, 400);
      }
      const body = await readBody(req);
      await db.rbac.definirPermissoesDoPapel(slug, Array.isArray(body.permissions) ? body.permissions : []);
      await db.rbac.registrarAcesso({
        userId: requester.id, userName: requester.name, action: 'usuarios.gerenciar',
        resourceType: 'papel', resourceId: slug, result: 'PERMITIDO', ip: ipDaRequisicao(req),
        detail: { permissoes: body.permissions || [] }
      });
      return sendJson(res, { success: true });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar as permissões do papel' }, 400);
    }
  }

  if (pathname.startsWith('/api/access-control/users/') && req.method === 'PUT') {
    try {
      const requester = await getCurrentUser(req);
      const id = decodeURIComponent(pathname.replace('/api/access-control/users/', ''));
      const alvo = await db.getUserById(id);
      if (!alvo) return sendJson(res, { error: 'Usuário não encontrado' }, 404);

      const body = await readBody(req);
      const papeis = Array.isArray(body.roles) ? body.roles : [];

      // Trava de segurança: ninguém tira o próprio acesso de administrador nem
      // se bloqueia sozinho — seria preciso outro admin para desfazer, e se for
      // o único admin do sistema não haveria volta.
      //
      // OS PAPÉIS PRECISAM SER CARREGADOS. `getCurrentUser` devolve a linha de
      // `users`, sem `roles`, então ehAdministrador só enxergava o campo antigo
      // `role`. Quem virou admin POR PAPÉL nesta mesma tela (users.role segue
      // 'user') passava batido pela trava e conseguia tirar o próprio admin —
      // e se fosse o único, trancava todo mundo para fora.
      const acessoDoRequisitante = await db.rbac.carregarAcessoDoUsuario(requester.id);
      const requisitanteComPapeis = { ...requester, roles: (acessoDoRequisitante && acessoDoRequisitante.roles) || [] };
      if (requester.id === id) {
        if (permissoes.ehAdministrador(requisitanteComPapeis) && !papeis.includes('admin')) {
          return sendJson(res, { error: 'Não é permitido remover o próprio papel de administrador.' }, 400);
        }
        if (body.active === false) {
          return sendJson(res, { error: 'Não é permitido bloquear o próprio usuário.' }, 400);
        }
      }

      await db.rbac.definirPapeisDoUsuario(id, papeis, requester.id);
      await db.rbac.definirPermissoesDoUsuario(id, Array.isArray(body.exceptions) ? body.exceptions : []);
      if (body.active !== undefined) await db.definirUsuarioAtivo(id, body.active);

      await db.rbac.registrarAcesso({
        userId: requester.id, userName: requester.name, action: 'usuarios.gerenciar',
        resourceType: 'usuario', resourceId: id, result: 'PERMITIDO', ip: ipDaRequisicao(req),
        detail: { alvo: alvo.username, papeis, excecoes: body.exceptions || [], ativo: body.active }
      });
      return sendJson(res, { success: true });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar o acesso do usuário' }, 400);
    }
  }

  if (pathname === '/api/access-logs' && req.method === 'GET') {
    try {
      const logs = await db.rbac.listarAcessos({
        limite: Number(url.searchParams.get('limit') || 100),
        usuario: url.searchParams.get('user') || '',
        resultado: url.searchParams.get('result') || '',
        acao: url.searchParams.get('action') || ''
      });
      return sendJson(res, { logs, disponivel: db.rbac.rbacEstaDisponivel() });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao ler a trilha de auditoria' }, 500);
    }
  }

  // GET users for debugging (admin only)
  if (pathname === '/api/users' && req.method === 'GET') {
    const requester = await getCurrentUser(req);
    if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
    if (!(await ehAdmin(requester))) return sendJson(res, { error: 'Permissão negada' }, 403);
    const users = await db.getUsers();
    return sendJson(res, { users });
  }

  // GET audit logs (admin-only) with simple pagination: ?limit=50&offset=0
  if (pathname === '/api/audit' && req.method === 'GET') {
    try {
      const data = loadData();
      const requester = await getCurrentUser(req);
      if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
      if (!(await ehAdmin(requester))) return sendJson(res, { error: 'Permissão negada' }, 403);
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

      // Supabase é a fonte. O arquivo local só guarda o que falhou de gravar
      // lá (pendenteDeSincronia) — some da tela se for ignorado, e é
      // justamente o registro que mais interessa não perder.
      let doBanco = { auditLogs: [], total: 0 };
      try {
        doBanco = await db.getAuditLogs({ limit, offset });
      } catch (erroBanco) {
        console.error('Falha ao ler auditoria do Supabase:', erroBanco.message);
      }
      const pendentes = (data.auditLogs || []).filter((log) => log.pendenteDeSincronia).reverse();

      return sendJson(res, {
        auditLogs: pendentes.concat(doBanco.auditLogs || []),
        total: (doBanco.total || 0) + pendentes.length,
        pendentesDeSincronia: pendentes.length
      });
    } catch (err) {
      return sendJson(res, { error: 'Erro ao ler logs' }, 500);
    }
  }

  // user delete endpoint (dedicated)
  if (pathname === '/api/users/delete' && req.method === 'POST') {
    try {
      const requester = await getCurrentUser(req);
      if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
      if (!(await ehAdmin(requester))) return sendJson(res, { error: 'Permissão negada' }, 403);
      const body = await readBody(req);
      const id = body && body.id;
      if (!id) return sendJson(res, { error: 'ID ausente' }, 400);
      if (requester.id === id) return sendJson(res, { error: 'Não é permitido excluir o usuário logado' }, 400);
      const deletedUser = await db.getUserById(id);
      if (!deletedUser) return sendJson(res, { error: 'Usuário não encontrado' }, 404);
      await db.deleteUser(id);
      // audit log
      const data = loadData();
      data.auditLogs = data.auditLogs || [];
      await registrarAuditoria({ action: 'deleteUser', targetId: deletedUser.id, targetUsername: deletedUser.username, byId: requester.id, byName: requester.name });
      saveData(data);
      return sendJson(res, { success: true });
    } catch (err) {
      return sendJson(res, { error: 'Erro ao excluir usuário' }, 500);
    }
  }

  // user edit endpoint (dedicado — tela de edição separada da de cadastro)
  if (pathname.startsWith('/api/users/') && pathname !== '/api/users/delete' && req.method === 'PUT') {
    try {
      const requester = await getCurrentUser(req);
      if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
      if (!(await ehAdmin(requester))) return sendJson(res, { error: 'Permissão negada' }, 403);
      const id = decodeURIComponent(pathname.replace('/api/users/', ''));
      const target = await db.getUserById(id);
      if (!target) return sendJson(res, { error: 'Usuário não encontrado' }, 404);
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, { error: 'Informe o nome do usuário' }, 400);
      const role = body.role || target.role;
      if (requester.id === id && role !== 'admin') {
        return sendJson(res, { error: 'Não é permitido remover o próprio acesso de administrador' }, 400);
      }
      const updated = await db.updateUser(id, {
        name,
        role,
        allowedModules: Array.isArray(body.allowedModules) ? body.allowedModules : target.allowedModules,
        fiscalPermissions: fiscalPermissoes.sanitizar(
          Array.isArray(body.fiscalPermissions) ? body.fiscalPermissions : target.fiscalPermissions
        ),
        password: body.password ? String(body.password) : undefined,
        // Ausente = nao mexe no vinculo; vazio = desvincula. Ver updateUser.
        sellerId: body.sellerId === undefined ? undefined : String(body.sellerId || '').trim(),
        // Mesma regra: ausente nao mexe, {} libera todas as telas de volta.
        blockedSubs: body.blockedSubs === undefined ? undefined : sanitizarTelasBloqueadas(body.blockedSubs)
      });
      // PROMOVER E REBAIXAR TEM DE CHEGAR AO PAPEL, NÃO SÓ À COLUNA.
      //
      // `users.role` e `user_roles` são duas fontes da mesma verdade enquanto a
      // migração do RBAC conviver com o modelo antigo, e ehAdministrador
      // aceita QUALQUER uma das duas. Rebaixar só a coluna deixava a pessoa
      // administradora pelo papel: a tela de Usuários passava a dizer
      // "Usuário" e ela continuava podendo tudo.
      //
      // SÓ QUANDO O CAMPO MUDA, e mexendo SÓ no papel 'admin': esta tela não
      // gerencia papéis: quem faz isso é Controle de Acesso. Reescrever a lista
      // inteira apagaria um 'gerente' concedido lá toda vez que alguém
      // corrigisse o nome do usuário aqui.
      if (role !== target.role) {
        try {
          const acessoAlvo = await db.rbac.carregarAcessoDoUsuario(id);
          const atuais = new Set((acessoAlvo && acessoAlvo.roles) || []);
          if (role === 'admin') atuais.add('admin');
          else atuais.delete('admin');
          // Sem papel nenhum o portão central nega tudo — ver a criação de
          // usuário. Rebaixar não pode virar bloqueio total.
          if (!atuais.size) atuais.add('usuario');
          await db.rbac.definirPapeisDoUsuario(id, [...atuais], requester.id);
        } catch (erroPapel) {
          console.error('Papel do usuario nao acompanhou a mudanca de role', id, erroPapel.message);
        }
      }

      // O alvo pode ser o próprio requisitante (um admin editando a si mesmo).
      // Nada nesta rota lê o usuário depois da gravação hoje, mas quem vier
      // acrescentar um passo aqui embaixo leria a versão de antes do UPDATE,
      // memorizada no começo da requisição — e o bug seria "salvei e a tela
      // mostra o valor velho", que ninguém procura no cache.
      if (id === requester.id) esquecerUsuarioDaRequisicao(req);
      const data = loadData();
      data.auditLogs = data.auditLogs || [];
      await registrarAuditoria({ action: 'updateUser', targetId: id, targetUsername: target.username, byId: requester.id, byName: requester.name });
      saveData(data);
      return sendJson(res, { success: true, user: updated });
    } catch (err) {
      return sendJson(res, { error: 'Erro ao atualizar usuário' }, 400);
    }
  }

  if (pathname === '/health') {
    sendJson(res, { ok: true, uptime: Math.round(process.uptime()) });
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    serveStatic(res, path.join(PUBLIC_DIR, 'index.html'), req);
    return;
  }

  if (pathname === '/app.css') {
    serveStatic(res, path.join(PUBLIC_DIR, 'app.css'), req);
    return;
  }

  if (pathname === '/app.js') {
    serveStatic(res, path.join(PUBLIC_DIR, 'app.js'), req);
    return;
  }

  // JS dos módulos (public/modules/**) e assets (logo, favicon). Eram dois
  // blocos com implementações separadas de leitura e Content-Type; o que muda
  // entre eles é só a pasta-raiz permitida.
  const raizEstatica = pathname.startsWith('/modules/')
    ? path.join(PUBLIC_DIR, 'modules')
    : (pathname.startsWith('/assets/') ? path.join(PUBLIC_DIR, 'assets') : null);
  if (raizEstatica && req.method === 'GET') {
    const relativo = pathname.replace(/^\/(modules|assets)\//, '');
    const filePath = path.join(raizEstatica, relativo);
    // Contenção de path traversal: path.join já normaliza '..', então basta
    // exigir que o resultado continue dentro da raiz permitida.
    if (!filePath.startsWith(raizEstatica)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acesso negado');
      return;
    }
    serveStatic(res, filePath, req);
    return;
  }

  sendJson(res, { error: 'Não encontrado' }, 404);
});

function startServer(port, retriesLeft) {
  server.listen(port, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`Servidor iniciado em http://${displayHost}:${port}`);
  });

  server.once('error', (error) => {
    const isPortInUse = error && error.code === 'EADDRINUSE';
    const canRetry = !process.env.PORT && retriesLeft > 0;

    if (isPortInUse && canRetry) {
      const nextPort = port + 1;
      console.warn(`Porta ${port} em uso, tentando ${nextPort}...`);
      startServer(nextPort, retriesLeft - 1);
      return;
    }

    console.error('Falha ao iniciar servidor:', error.message || error);
    process.exit(1);
  });
}

/**
 * CONFERE O BANCO ANTES DE ABRIR A PORTA.
 *
 * O pool de conexões é preguiçoso de propósito (lib/db/conexao.js): ele nasce na
 * primeira consulta, não no require, para que os testes e scripts que só leem
 * código não exijam banco no ar. O efeito colateral é que, sem esta checagem, um
 * DATABASE_URL errado deixa o servidor SUBIR NORMALMENTE e anunciar "Servidor
 * iniciado" — e o erro só aparece depois, uma tela por vez, como "erro ao
 * carregar" em tudo.
 *
 * Esse é exatamente o modo de falha que já custou semanas neste projeto (ver o
 * cabeçalho de scripts/verificar-migracoes.js): o sistema degrada em silêncio e
 * a degradação esconde a causa. Uma consulta trivial aqui troca isso por uma
 * mensagem que diz o que fazer, antes de qualquer requisição existir.
 */
async function conferirBanco() {
  const { consultar } = require('./lib/db/conexao');
  try {
    await consultar('select 1');
  } catch (erro) {
    console.error('\n[banco] NÃO consegui conectar. O servidor não vai subir.\n');
    console.error(`  motivo: ${erro.message}\n`);
    if (!process.env.DATABASE_URL) {
      console.error('  DATABASE_URL não está definida. Copie .env.example para .env.');
    } else {
      console.error('  O banco está no ar?   docker compose up -d');
      console.error('  Ele terminou de subir? docker compose logs -f banco');
    }
    console.error('');
    process.exit(1);
  }
}

conferirBanco().then(() => startServer(BASE_PORT, MAX_PORT_RETRIES));
