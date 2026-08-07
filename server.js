require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const focusNfe = require('./lib/focusnfe');
const fiscalDb = require('./lib/db/fiscal');
const { buildNfePayload } = require('./lib/nfePayloadBuilder');
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

const HOST = process.env.HOST || '0.0.0.0';
const BASE_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = 10;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Usuários NÃO moram mais aqui: a autenticação é 100% Supabase (users.password_hash,
// bcrypt) via lib/db/auth.js. O antigo array `users` guardava senha em texto puro e
// não era lido por nenhuma rota — foi removido, e normalizeData() apaga o resíduo de
// arquivos db.json antigos.
const initialData = {
  products: [
    {
      id: 'prod-1',
      name: 'Produto Exemplo',
      sku: 'SKU-001',
      stockQuantity: 20,
      costPrice: 50,
      salePrice: 75
    }
  ],
  sales: [],
  purchases: [],
  finance: [],
  financialPayments: [],
  financialCategories: [],
  costCenters: [],
  bankAccounts: [],
  bankTransactions: [],
  orders: [],
  quotes: [],
  nfes: [],
  people: [],
  cnpjs: [],
  deposits: [],
  productCategories: [],
  movementCategories: [],
  stockMovements: [],
  stockTransfers: [],
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
  importLogs: [],
  auditLogs: [],
  settings: {
    companyName: 'MavisONE',
    currency: 'BRL',
    taxRate: 0
  }
};

let sessions = {};

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
  const data = normalizeData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  if (data.__needsCodeSave) {
    delete data.__needsCodeSave;
    saveData(data);
  }
  return data;
}

function saveData(data) {
  delete data.__needsCodeSave;
  const normalized = normalizeData(data);
  delete normalized.__needsCodeSave;
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalized, null, 2));
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

async function getCurrentUser(req) {
  const token = req.headers['x-auth-token'];
  if (!token || !sessions[token]) {
    return null;
  }
  const userId = sessions[token];
  const user = await db.getUserById(userId);
  // Bloqueado é como se não estivesse logado — inclusive para quem já tinha
  // sessão aberta quando o acesso foi suspenso.
  if (!user || user.active === false) return null;
  return user;
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
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

function serializeUserForClient(user, acesso = null) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    allowedModules: user.allowedModules,
    theme: user.theme,
    dashboardPins: normalizeDashboardPins(user.dashboardPins),
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
  data.nfes = await db.getNfes();
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
        quantity,
        unitPrice,
        total: Math.round(quantity * unitPrice * 100) / 100
      };
    })
    .filter((item) => item.name && item.quantity > 0);
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
    generateServiceOrder: Boolean(body.generateServiceOrder)
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
function registrarMovimentoEstoque(data, { productId, productName, type, quantityDelta, referenceType, referenceId, note, user }) {
  const delta = Number(quantityDelta || 0);
  // Sem depósito informado, usa o padrão do produto; se não houver, fica em
  // branco e productBalances() contabiliza como saldo não alocado.
  const defaultDepositId = stockCore.productMeta(data, productId).defaultDepositId || '';

  data.stockMovements.push({
    id: createId('mov'),
    code: stockCore.nextSequentialCode(data.stockMovements, 'MOV'),
    type: delta < 0 ? 'saida' : 'entrada',
    date: stockCore.todayStr(),
    productId,
    productName: productName || '',
    depositId: defaultDepositId,
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
  });
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

  const idsEnvolvidos = new Set([
    ...(wasApplied ? oldItems : []).map((item) => item.productId),
    ...(willApply ? newItems : []).map((item) => item.productId)
  ].filter(Boolean));

  const produtos = new Map();
  for (const id of idsEnvolvidos) {
    produtos.set(id, await db.getProductById(id));
  }

  const projetado = new Map();
  for (const [id, produto] of produtos) {
    projetado.set(id, Number(produto?.stockQuantity || 0));
  }
  if (wasApplied) {
    for (const item of oldItems) {
      if (!item.productId || !projetado.has(item.productId)) continue;
      projetado.set(item.productId, projetado.get(item.productId) + Number(item.quantity || 0));
    }
  }
  if (willApply) {
    for (const item of newItems) {
      if (!item.productId || !projetado.has(item.productId)) continue;
      const restante = projetado.get(item.productId) - Number(item.quantity || 0);
      if (restante < 0) {
        const produto = produtos.get(item.productId);
        const err = new Error(`Estoque insuficiente para "${item.name}" (disponível: ${produto?.stockQuantity ?? 0}, necessário: ${item.quantity}).`);
        err.status = 400;
        throw err;
      }
      projetado.set(item.productId, restante);
    }
  }

  // Validado — agora aplica de verdade, um produto por vez.
  if (wasApplied) {
    for (const item of oldItems) {
      if (!item.productId) continue;
      const produto = produtos.get(item.productId);
      if (!produto) continue;
      await db.upsertProduct({ ...produto, stockQuantity: Number(produto.stockQuantity || 0) + Number(item.quantity || 0) });
      registrarMovimentoEstoque(data, {
        productId: item.productId, productName: item.name, type: 'estorno',
        quantityDelta: Number(item.quantity || 0), referenceType: 'order', referenceId: record.id,
        note: `Estorno do pedido ${record.code || record.id}`, user
      });
    }
  }
  if (willApply) {
    for (const item of newItems) {
      if (!item.productId) continue;
      const produtoAtual = await db.getProductById(item.productId); // relê: pode ter mudado no passo do estorno acima
      if (!produtoAtual) continue;
      await db.upsertProduct({ ...produtoAtual, stockQuantity: Number(produtoAtual.stockQuantity || 0) - Number(item.quantity || 0) });
      registrarMovimentoEstoque(data, {
        productId: item.productId, productName: item.name, type: 'venda',
        quantityDelta: -Number(item.quantity || 0), referenceType: 'order', referenceId: record.id,
        note: `Pedido ${record.code || record.id}`, user
      });
    }
  }
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
async function transitionOrderFinanceEffect(data, { record, wasApplied, willApply, user }) {
  if (wasApplied === willApply) return { criadas: 0, canceladas: 0, mantidas: 0 };

  if (!willApply) {
    const vinculadas = (data.finance || []).filter((entry) => entry.referenceId === record.id && entry.type === 'RECEITA');
    let canceladas = 0;
    for (const entry of vinculadas) {
      // Parcela já recebida (ou parcialmente) não é cancelada em silêncio: o
      // dinheiro entrou de verdade. Fica para alguém decidir o que fazer.
      if (entry.status === 'pending') {
        entry.status = 'cancelado';
        entry.updatedAt = new Date().toISOString();
        await db.updateFinancialEntry(entry.id, { status: 'cancelado' });
        canceladas += 1;
      }
    }
    return { criadas: 0, canceladas, mantidas: vinculadas.length - canceladas };
  }

  const parcelas = parcelasDoPedido(record);
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
      status: 'pending',
      createdBy: user?.id,
      createdByName: user?.name
    });
    data.finance.push(entry);
  }
  return { criadas: parcelas.length, canceladas: 0, mantidas: 0 };
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
    status: record.status || (record.type === 'quote' ? 'em aberto' : 'pendente'),
    // A tela precisa saber que o pedido já gerou as contas a receber — é o que
    // explica por que refaturar não cobra de novo.
    financeApplied: Boolean(record.financeApplied),
    createdByName: record.createdByName || '',
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || ''
  };
}

function filterSalesRecords(records, data, query) {
  let result = records.slice();

  const search = String(query.get('search') || '').trim().toLowerCase();
  if (search) {
    result = result.filter((record) => {
      const serialized = serializeSalesRecord(record, data);
      return String(serialized.code).toLowerCase().includes(search)
        || serialized.customer.toLowerCase().includes(search)
        || String(record.id).toLowerCase().includes(search);
    });
  }

  const status = query.get('status');
  if (status) result = result.filter((record) => (record.status || '') === status);

  const companyId = query.get('companyId');
  if (companyId) result = result.filter((record) => record.companyId === companyId);

  const sellerId = query.get('sellerId');
  if (sellerId) result = result.filter((record) => record.sellerId === sellerId);

  const clientSupplierId = query.get('clientSupplierId');
  if (clientSupplierId) result = result.filter((record) => record.clientSupplierId === clientSupplierId);

  const dateFrom = query.get('dateFrom');
  const dateTo = query.get('dateTo');
  if (dateFrom) result = result.filter((record) => record.date >= dateFrom);
  if (dateTo) result = result.filter((record) => record.date <= dateTo);

  return result;
}

function buildSalesDashboardSummary(data) {
  const orders = (data.orders || []).map((record) => serializeSalesRecord(record, data));
  const quotes = (data.quotes || []).map((record) => serializeSalesRecord(record, data));

  const valorPedidos = Math.round(orders.reduce((sum, o) => sum + Number(o.amount || 0), 0) * 100) / 100;
  const valorOrcamentos = Math.round(quotes.reduce((sum, q) => sum + Number(q.amount || 0), 0) * 100) / 100;
  const pedidosFaturados = orders.filter((o) => o.status === 'faturado').length;
  const pedidosPendentes = orders.filter((o) => o.status === 'pendente').length;

  const overview = {
    totalPedidos: orders.length,
    valorPedidos,
    totalOrcamentos: quotes.length,
    valorOrcamentos,
    pedidosFaturados,
    pedidosPendentes,
    ticketMedio: orders.length ? Math.round((valorPedidos / orders.length) * 100) / 100 : 0
  };

  const bySeller = getSellersDirectory(data).map((seller) => {
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

function recomputeFinanceEntryStatus(entry, data) {
  if (entry.status === 'cancelado') return 'cancelado';
  const payments = getFinanceEntryPayments(data, entry.id);
  if (!payments.length) return 'pending';
  const due = financeEntryEffectiveDue(entry, payments);
  const paid = financeEntryPaidTotal(payments);
  if (paid + 0.005 >= due) return 'paid';
  return 'parcial';
}

function addFinanceAuditLog(data, { action, entry, byId, byName, details }) {
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.push({
    id: createId('audit'),
    action,
    targetId: entry.id,
    targetUsername: `Lançamento ${String(entry.id).slice(-8)} · ${entry.description || ''}`.trim(),
    byId,
    byName,
    at: new Date().toISOString(),
    details: details || null
  });
}

function serializeFinanceEntry(entry, data) {
  const payments = getFinanceEntryPayments(data, entry.id);
  return {
    id: entry.id,
    type: classifyFinanceEntry(entry),
    date: entry.date,
    dueDate: financeEntryDueDate(entry),
    description: entry.description,
    document: entry.document || '',
    note: entry.note || '',
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

function normalizeNfeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'emitida' || s === 'autorizada') return 'autorizada';
  if (['cancelada', 'denegada', 'rejeitada', 'pendente'].includes(s)) return s;
  return 'autorizada';
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

function filterNfes(data, query) {
  let list = (data.nfes || []).slice();

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

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }
    // Sem cache: HTML/CSS/JS mudam com frequência durante o desenvolvimento e o
    // navegador não tinha nenhum header para saber que precisa revalidar.
    res.writeHead(200, { 'Content-Type': contentTypeMap[ext] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  });
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
function resolveFiscalPermission(pathname, method) {
  if (pathname === '/api/fiscal/empresas') return method === 'GET' ? 'visualizar' : 'configurar';
  if (pathname.startsWith('/api/fiscal/empresas/')) return 'configurar';

  if (pathname === '/api/fiscal/estabelecimentos') return method === 'GET' ? 'visualizar' : 'configurar';
  if (pathname.endsWith('/focus-status')) return 'visualizar';
  if (pathname.endsWith('/webhook')) return 'configurar';
  if (pathname.startsWith('/api/fiscal/estabelecimentos/')) return 'configurar';

  if (pathname === '/api/fiscal/certificados') return method === 'GET' ? 'visualizar' : 'certificado';
  if (pathname.startsWith('/api/fiscal/certificados/')) return 'certificado';

  if (pathname === '/api/fiscal/regras') return method === 'GET' ? 'visualizar' : 'regras';
  if (pathname.startsWith('/api/fiscal/regras/')) return 'regras';

  if (pathname === '/api/fiscal/nfe') return 'visualizar';
  if (pathname === '/api/fiscal/nfe/emitir') return 'emitir';
  if (pathname.endsWith('/cancelar')) return 'cancelar';
  if (pathname.endsWith('/cce')) return 'cce';
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

  const itens = [];
  for (let index = 0; index < itensBody.length; index += 1) {
    const item = itensBody[index];
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
    itens.push({ ...item, regraFiscal: regra });
  }

  const valorTotal = itens.reduce((sum, item) => sum + Math.round(Number(item.quantidade || 0) * Number(item.valorUnitario || 0) * 100) / 100, 0);
  const referencia = createId('nfe');
  const tipoDocumento = body.tipoDocumento !== undefined ? Number(body.tipoDocumento) : 1;
  const finalidadeEmissao = body.finalidadeEmissao !== undefined ? Number(body.finalidadeEmissao) : 1;
  const naturezaOperacao = body.naturezaOperacao || 'Venda de mercadoria';

  const payload = buildNfePayload({
    estabelecimento,
    empresa,
    destinatario,
    itens,
    naturezaOperacao,
    tipoDocumento,
    finalidadeEmissao,
    dataEmissao
  });

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
    payloadEnviado: payload
  });

  try {
    const client = await focusNfe.forEstabelecimento(estabelecimento.id);
    const resposta = await client.emitirNfe(referencia, payload);
    nfe = await aplicarRespostaFocusNaNfe(nfe, resposta);
    const data = loadData();
    data.auditLogs = data.auditLogs || [];
    data.auditLogs.push({ id: createId('audit'), action: 'emitirNfeFiscal', targetId: nfe.id, targetUsername: referencia, byId: user.id, byName: user.name, at: new Date().toISOString() });
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
async function aplicarRespostaFocusNaNfe(nfe, resposta) {
  const novoStatus = mapFocusStatusToNfeStatus(resposta.status);
  if (novoStatus === nfe.status) {
    return nfe;
  }
  const atualizada = await fiscalDb.updateNfeAposResposta(nfe.id, {
    status: novoStatus,
    serie: resposta.serie,
    numero: resposta.numero,
    chaveAcesso: resposta.chave_nfe,
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
  return client.criarWebhook({
    event: 'nfe',
    cnpj: estabelecimento.cnpj,
    url: webhookUrl,
    secret: webhookSecret,
    secretHeader: 'X-Fiscal-Webhook-Secret'
  });
}

async function cancelarNfeFiscal(id, justificativa, user) {
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
  data.auditLogs.push({ id: createId('audit'), action: 'cancelarNfeFiscal', targetId: nfe.id, targetUsername: nfe.referencia, byId: user.id, byName: user.name, at: new Date().toISOString() });
  saveData(data);
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
  data.auditLogs.push({ id: createId('audit'), action: 'emitirCartaCorrecaoFiscal', targetId: nfe.id, targetUsername: nfe.referencia, byId: user.id, byName: user.name, at: new Date().toISOString() });
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
  const data = loadData();
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.push({ id: createId('audit'), action: 'inutilizarNumeracaoFiscal', targetId: estabelecimento.id, targetUsername: `${body.serie}: ${numeroInicial}-${numeroFinal}`, byId: user.id, byName: user.name, at: new Date().toISOString() });
  saveData(data);
  return evento;
}

// ============================================================================
// ESTOQUE — helpers das rotas
// ============================================================================

// Paginação: um valor não numérico na query (?page=abc) virava NaN e devolvia
// lista vazia em vez de cair na primeira página.
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
async function loadStockContext() {
  const data = loadData();
  await syncCadastroData(data);
  const products = await db.getProducts();
  return { data, products, productsById: new Map(products.map((p) => [p.id, p])) };
}

function sendStockError(res, error, fallback) {
  return sendJson(res, { error: error && error.status ? error.message : fallback }, (error && error.status) || 400);
}

// Registra a movimentação no db.json e reflete o novo saldo total no Supabase.
// As duas escritas não são atômicas: se o Supabase falhar, nada é gravado
// localmente (por isso o saldo remoto é atualizado ANTES do saveData).
async function commitStockMovements(data, movements, productsById) {
  const deltaByProduct = new Map();
  movements.forEach((movement) => {
    const delta = stockCore.movementSignedQuantity(movement);
    deltaByProduct.set(movement.productId, (deltaByProduct.get(movement.productId) || 0) + delta);
  });

  for (const [productId, delta] of deltaByProduct.entries()) {
    if (delta === 0) continue;
    const product = productsById.get(productId);
    const newTotal = stockCore.toNumber(product.stockQuantity) + delta;
    await db.updateProductStock(productId, newTotal);
  }

  movements.forEach((movement) => data.stockMovements.push(movement));
  saveData(data);
}

function buildMovementRecord(data, { type, productId, depositId, quantity, unitCost, categoryId, date, document, note, transferId, origin }, user) {
  return {
    id: stockCore.createId('mov'),
    code: stockCore.nextSequentialCode(data.stockMovements, 'MOV'),
    type,
    date: date || stockCore.todayStr(),
    productId,
    depositId,
    quantity: stockCore.toNumber(quantity),
    unitCost: stockCore.toNumber(unitCost),
    categoryId: categoryId || '',
    document: document || '',
    note: note || '',
    transferId: transferId || '',
    origin: origin || 'manual',
    createdBy: user.id,
    createdByName: user.name,
    createdAt: new Date().toISOString()
  };
}

// Valida produto/depósito/quantidade e, na saída, o saldo do depósito.
function assertMovementIsPossible(data, productsById, { productId, depositId, type, quantity }) {
  const product = productsById.get(productId);
  if (!product) throw stockCore.stockError('Produto não encontrado.', 404);
  const deposit = (data.deposits || []).find((d) => d.id === depositId);
  if (!deposit) throw stockCore.stockError('Depósito não encontrado.', 404);
  const qty = stockCore.toNumber(quantity);
  if (!(qty > 0)) throw stockCore.stockError('Informe uma quantidade maior que zero.');
  if (type === 'saida') {
    const available = stockCore.depositBalance(data, productId, depositId);
    if (qty > available) {
      throw stockCore.stockError(`Saldo insuficiente em ${deposit.name}: disponível ${available}, solicitado ${qty}.`);
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
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';

  return (data.stockMovements || []).filter((movement) => {
    if (type && movement.type !== type) return false;
    if (productId && movement.productId !== productId) return false;
    if (depositId && movement.depositId !== depositId) return false;
    if (categoryId && movement.categoryId !== categoryId) return false;
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

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
      sessions[token] = user.id;
      await db.registrarLogin(user.id);
      await db.rbac.registrarAcesso({
        userId: user.id, userName: user.name, action: 'login', resourceType: 'sessao',
        result: 'PERMITIDO', ip: ipDaRequisicao(req)
      });
      const acesso = await db.rbac.carregarAcessoDoUsuario(user.id);
      return sendJson(res, { token, user: serializeUserForClient(user, acesso) });
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
    return sendJson(res, { user: serializeUserForClient(user, await db.rbac.carregarAcessoDoUsuario(user.id)) });
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

  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = req.headers['x-auth-token'];
    if (token && sessions[token]) {
      delete sessions[token];
    }
    return sendJson(res, { success: true });
  }

  if (pathname === '/api/modules') {
    const user = await getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    return sendJson(res, { modules: user.allowedModules });
  }

  if (pathname === '/api/dashboard') {
    const data = loadData();
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
    if (canSales) await syncSalesData(data);
    if (canPurchases) await syncPurchasesData(data);
 await syncFinanceData(data);

    const products = canStock ? await db.getProducts() : [];

    // Reaproveita o mesmo cálculo do Painel de Vendas para que os dois batam.
    const salesSummary = canSales ? buildSalesDashboardSummary(data).overview : null;
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

    return sendJson(res, {
      salesTotal,
      purchaseTotal,
      stockValue,
      balance: salesTotal - purchaseTotal,
      pendingReconciliation,
      totalProducts: canStock ? products.length : 0,
      totalSales: salesSummary ? salesSummary.totalPedidos : 0,
      totalPurchases: activePurchases.length,
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

  if (pathname === '/api/sales/meta' && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const products = await db.getProducts();
    return sendJson(res, {
      companies: data.companies,
      sellers: getSellersDirectory(data),
      deposits: data.deposits,
      directory: getCadastroDirectory(data),
      products,
      // Abas Pagamentos e Entrega: formas de pagamento e transportadoras vêm do
      // Cadastro, não de lista fixa no formulário.
      paymentMethods: (data.paymentMethods || []).filter((forma) => forma.status !== 'inativo'),
      carriers: getCarriersDirectory(data)
    });
  }

  if (pathname === '/api/sales/dashboard' && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    await syncSalesData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, buildSalesDashboardSummary(data));
  }

  if (pathname === '/api/sales/records' && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    await syncSalesData(data);
    await syncNfeData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const view = url.searchParams.get('view') || 'orders_quotes';
    if (view === 'orders_quotes') {
      const combined = [...data.orders, ...data.quotes];
      const filtered = filterSalesRecords(combined, data, url.searchParams)
        .sort((a, b) => Number(b.code || 0) - Number(a.code || 0) || String(b.date || '').localeCompare(String(a.date || '')));
      const { page, limit } = parsePageParams(url.searchParams, 15);
      const start = (page - 1) * limit;
      const records = filtered.slice(start, start + limit).map((record) => serializeSalesRecord(record, data));
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
          directory: getCadastroDirectory(data)
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
      await syncCadastroData(data);
      await syncNfeData(data);
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const type = body.type || 'order';
      let record;
      if (type === 'order' || type === 'quote') {
        const items = normalizeSalesItems(body.items);
        if (!items.length) {
          return sendJson(res, { error: 'Adicione ao menos um produto ao pedido/orçamento' }, 400);
        }
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
          status: body.status || (type === 'order' ? 'pendente' : 'em aberto'),
          stockApplied: false,
          createdBy: user.id,
          createdByName: user.name,
          updatedByName: user.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        // Orçamento nunca mexe em estoque (é só proposta). Pedido só desconta
        // se já nasce "faturado" — o caminho normal é criar "pendente" e
        // faturar depois via PUT (ver rota de atualização, mais abaixo). Roda
        // ANTES de gravar no Supabase: se faltar estoque, nada é criado.
        if (type === 'order' && record.status === 'faturado') {
          await transitionOrderStockEffect(data, { oldItems: [], newItems: items, wasApplied: false, willApply: true, record, user });
          record.stockApplied = true;
          record.financeApplied = true;
        }
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

  if (pathname.startsWith('/api/sales/records/') && req.method === 'PUT') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncSalesData(data);
      await syncFinanceData(data);
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
      const items = normalizeSalesItems(body.items);
      if (!items.length) {
        return sendJson(res, { error: 'Adicione ao menos um produto ao pedido/orçamento' }, 400);
      }
      if (!body.clientSupplierId && !String(body.clientSupplierName || '').trim()) {
        return sendJson(res, { error: 'Selecione o cliente/fornecedor do pedido/orçamento' }, 400);
      }
      const totais = computeSalesTotals(items, body);
      let updated = {
        ...current,
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
        status: body.status || current.status,
        // "Alterado por" na tela — quem salvou por último, não quem criou.
        updatedByName: user.name,
        updatedAt: new Date().toISOString()
      };

      const eraFaturado = Boolean(current.financeApplied);
      const seraFaturado = updated.status === 'faturado';
      if (current.type === 'order') {
        const wasApplied = Boolean(current.stockApplied);
        await transitionOrderStockEffect(data, { oldItems: current.items || [], newItems: items, wasApplied, willApply: seraFaturado, record: updated, user });
        updated.stockApplied = seraFaturado;
        updated.financeApplied = seraFaturado;
      }

      updated = isOrder ? await db.updateOrder(id, updated) : await db.updateQuote(id, updated);
      if (current.type === 'order') {
        // Depois de gravar, pelo mesmo motivo da criação. O registro atualizado
        // é que carrega o total e as parcelas atuais.
        await transitionOrderFinanceEffect(data, { record: updated, wasApplied: eraFaturado, willApply: seraFaturado, user });
      }
      // updateOrder/updateQuote não tocam data.orders/data.quotes (já
      // gravaram no Supabase direto) — saveData aqui é só pra persistir
      // data.stockMovements, que transitionOrderStockEffect pode ter alterado.
      saveData(data);
      return sendJson(res, { success: true, record: serializeSalesRecord(updated, data) });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao atualizar pedido/orçamento' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/sales/records/') && req.method === 'DELETE') {
    try {
      const data = loadData();
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/records/', ''));
      const order = await db.getOrderById(id);
      const recordKey = order ? 'orders' : 'quotes';
      const record = order || await db.getQuoteById(id);
      if (!record) {
        return sendJson(res, { error: 'Pedido/orçamento não encontrado' }, 404);
      }
      if (recordKey === 'orders' && record.stockApplied) {
        // Excluir um pedido já faturado devolve o estoque reservado — não faz
        // sentido "sumir" com uma reserva de estoque junto com o registro.
        await transitionOrderStockEffect(data, { oldItems: record.items || [], newItems: [], wasApplied: true, willApply: false, record, user });
      }
      await (recordKey === 'orders' ? db.deleteOrder(id) : db.deleteQuote(id));
      // saveData aqui é só pra persistir data.stockMovements (ver comentário
      // equivalente na rota PUT acima) — o registro em si já foi excluído
      // do Supabase pela linha anterior.
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
        const status = row.status || row.statusPedido || 'pendente';
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
    const temAcessoAoModulo = user.allowedModules.includes('finance') || user.allowedModules.includes('settings');
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
        return sendJson(res, { estabelecimentos });
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

      if (pathname === '/api/fiscal/regras' && req.method === 'GET') {
        const empresaId = url.searchParams.get('empresaId') || undefined;
        const regras = await fiscalDb.getRegrasFiscais(empresaId);
        return sendJson(res, { regras });
      }

      if (pathname === '/api/fiscal/regras' && req.method === 'POST') {
        const body = await readBody(req);
        const regra = await fiscalDb.createRegraFiscal(body);
        return sendJson(res, { success: true, regra });
      }

      if (pathname.startsWith('/api/fiscal/regras/') && req.method === 'PUT') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/regras/', ''));
        const body = await readBody(req);
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

      if (pathname === '/api/fiscal/nfe/emitir' && req.method === 'POST') {
        const body = await readBody(req);
        const nfe = await emitirNfeFiscal(body, user);
        return sendJson(res, { success: true, nfe });
      }

      if (pathname.startsWith('/api/fiscal/nfe/') && pathname.endsWith('/cancelar') && req.method === 'POST') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/nfe/', '').replace('/cancelar', ''));
        const body = await readBody(req);
        const nfe = await cancelarNfeFiscal(id, body.justificativa || '', user);
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

      if (pathname.startsWith('/api/fiscal/nfe/') && req.method === 'GET') {
        const id = decodeURIComponent(pathname.replace('/api/fiscal/nfe/', ''));
        const nfe = await fiscalDb.getNfeById(id);
        if (!nfe) return sendJson(res, { error: 'NF-e não encontrada' }, 404);
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

    // Vínculos (lançamentos, contatos, equipamentos, tarefas, agendamentos,
    // movimentações) ainda moram no db.json, então a checagem lê de lá; a
    // exclusão em si é no Supabase, que é onde a pessoa mora.
    const pessoaEmUso = cadastrosCore.counterpartyInUse(loadData(), id);
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

    const cnpjEmUso = cadastrosCore.counterpartyInUse(loadData(), id);
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
      await syncFinanceData(data);
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
        users: (data.users || []).map((u) => ({ id: u.id, name: u.name }))
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
        productsById = new Map((await db.getProducts()).map((p) => [p.id, p]));
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
  const cadastroCollectionMatch = pathname.match(/^\/api\/cadastros\/(contacts|equipments|payment-methods|sale-statuses|product-cashbacks|tasks|appointments|bank-accounts|companies)(?:\/([^/]+))?$/);
  if (cadastroCollectionMatch) {
    try {
      const data = loadData();
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
      const created = await db.createDeposit({
        name,
        code,
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
      const updated = await db.updateDeposit(id, {
        name,
        code,
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
    const depositoEmUso = cadastrosCore.depositInUse(loadData(), id);
    if (depositoEmUso) {
      return sendJson(res, { error: depositoEmUso }, 409);
    }
    await db.deleteDeposit(id);
    return sendJson(res, { success: true });
  }

  // Empresas/filiais: cadastro leve (nome + CNPJ) usado só como seletor/etiqueta
  // nos documentos de Vendas — não isola dados entre empresas.
  if (pathname === '/api/cadastros/empresas' && req.method === 'GET') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { companies: data.companies });
  }

  if (pathname === '/api/cadastros/empresas' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome da empresa' }, 400);
      }
      const company = {
        id: createId('company'),
        name,
        tradeName: body.tradeName || '',
        document: body.document || '',
        address: body.address || '',
        city: body.city || '',
        state: body.state || '',
        createdAt: new Date().toISOString()
      };
      data.companies.push(company);
      saveData(data);
      return sendJson(res, { success: true, company });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar empresa' }, 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/empresas/') && req.method === 'DELETE') {
    const data = loadData();
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.replace('/api/cadastros/empresas/', ''));
    const index = data.companies.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return sendJson(res, { error: 'Empresa não encontrada' }, 404);
    }
    data.companies.splice(index, 1);
    saveData(data);
    return sendJson(res, { success: true });
  }

  if (pathname === '/api/purchases' && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('purchases')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const [products, purchases] = await Promise.all([db.getProducts(), db.getPurchases()]);
    return sendJson(res, { purchases, products, directory: getCadastroDirectory(data) });
  }

  if (pathname === '/api/purchases' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncFinanceData(data);
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

      await db.upsertProduct({
        ...product,
        stockQuantity: Number(product.stockQuantity || 0) + quantity,
        costPrice
      });
      registrarMovimentoEstoque(data, {
        productId: product.id, productName: product.name, type: 'compra',
        quantityDelta: quantity, referenceType: 'purchase', referenceId: purchase.id,
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

      saveData(data);
      return sendJson(res, { success: true, purchase, financeEntry });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao criar compra' }, error.status || 400);
    }
  }

  if (pathname.startsWith('/api/purchases/') && req.method === 'PUT') {
    try {
      const data = loadData();
      await syncFinanceData(data);
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
          await db.upsertProduct({ ...product, stockQuantity: Number(product.stockQuantity || 0) - Number(purchase.quantity || 0) });
          registrarMovimentoEstoque(data, {
            productId: purchase.productId, productName: product.name, type: 'estorno',
            quantityDelta: -Number(purchase.quantity || 0), referenceType: 'purchase', referenceId: purchase.id,
            note: `Cancelamento da compra de ${purchase.supplier}`, user
          });
        }
        const financeEntry = data.finance.find((entry) => entry.referenceId === purchase.id && entry.type === 'purchase');
        if (financeEntry && financeEntry.status === 'pending') {
          financeEntry.status = 'cancelado';
        }
      }

      const updated = await db.updatePurchase(id, { status: novoStatus });
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
      return sendJson(res, {
        deposits: data.deposits,
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

  if (pathname === '/api/stock/products' && req.method === 'GET') {
    try {
      const user = await getCurrentUser(req);
      if (!userCanStock(user)) return sendJson(res, { error: 'Sem permissão' }, 403);
      const { data, products } = await loadStockContext();
      const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
      const categoryId = url.searchParams.get('categoryId') || '';
      const status = url.searchParams.get('status') || '';
      const situation = url.searchParams.get('situation') || '';
      const depositId = url.searchParams.get('depositId') || '';

      let list = products.map((product) => stockCore.serializeProduct(product, data));
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
      const { data, products, productsById } = await loadStockContext();
      const product = productsById.get(id);
      if (!product) return sendJson(res, { error: 'Produto não encontrado' }, 404);
      const movements = (data.stockMovements || [])
        .filter((m) => m.productId === id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 50)
        .map((m) => stockCore.serializeMovement(m, data, productsById));
      return sendJson(res, { product: stockCore.serializeProduct(product, data), movements });
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
        salePrice: stockCore.toNumber(body.salePrice)
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
      assertMovementIsPossible(data, productsById, {
        productId: body.productId,
        depositId: body.depositId,
        type,
        quantity: body.quantity
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
      // Estornar uma entrada não pode deixar o depósito negativo.
      if (movement.type === 'entrada') {
        const available = stockCore.depositBalance(data, movement.productId, movement.depositId);
        if (stockCore.toNumber(movement.quantity) > available) {
          return sendJson(res, { error: `Não é possível estornar: o depósito ficaria negativo (disponível ${available}).` }, 409);
        }
      }
      const reversal = { ...movement, type: movement.type === 'entrada' ? 'saida' : 'entrada' };
      const product = productsById.get(movement.productId);
      if (product) {
        await db.updateProductStock(movement.productId, stockCore.toNumber(product.stockQuantity) + stockCore.movementSignedQuantity(reversal));
      }
      data.stockMovements = data.stockMovements.filter((m) => m.id !== id);
      saveData(data);
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
      const { quantity } = assertMovementIsPossible(data, productsById, {
        productId: body.productId,
        depositId: originDepositId,
        type: 'saida',
        quantity: body.quantity
      });
      if (!(data.deposits || []).some((d) => d.id === destinationDepositId)) {
        return sendJson(res, { error: 'Depósito de destino não encontrado.' }, 404);
      }

      const transferId = stockCore.createId('tra');
      const date = body.date || stockCore.todayStr();
      const shared = {
        productId: body.productId,
        quantity,
        unitCost: body.unitCost,
        categoryId: body.categoryId || '',
        document: body.document || '',
        date,
        transferId,
        origin: 'transferencia'
      };
      const out = buildMovementRecord(data, {
        ...shared, type: 'saida', depositId: originDepositId,
        note: body.note || 'Transferência entre depósitos (saída)'
      }, user);
      // O código do segundo lançamento precisa considerar o primeiro, que ainda
      // não está na lista — por isso o cálculo manual aqui.
      const into = buildMovementRecord(data, {
        ...shared, type: 'entrada', depositId: destinationDepositId,
        note: body.note || 'Transferência entre depósitos (entrada)'
      }, user);
      into.code = stockCore.nextSequentialCode([...data.stockMovements, out], 'MOV');

      const transfer = {
        id: transferId,
        code: stockCore.nextSequentialCode(data.stockTransfers, 'TRA'),
        date,
        productId: body.productId,
        originDepositId,
        destinationDepositId,
        quantity,
        note: body.note || '',
        movementOutId: out.id,
        movementInId: into.id,
        createdBy: user.id,
        createdByName: user.name,
        createdAt: new Date().toISOString()
      };
      data.stockTransfers.push(transfer);
      // Saída + entrada de mesma quantidade: o saldo total não muda, só a
      // distribuição entre depósitos.
      await commitStockMovements(data, [out, into], productsById);
      return sendJson(res, { success: true, transfer: stockCore.serializeTransfer(transfer, data, productsById) });
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
      const available = stockCore.depositBalance(data, transfer.productId, transfer.destinationDepositId);
      if (stockCore.toNumber(transfer.quantity) > available) {
        return sendJson(res, { error: `Não é possível estornar: o depósito de destino ficaria negativo (disponível ${available}).` }, 409);
      }
      data.stockMovements = data.stockMovements.filter((m) => m.transferId !== id);
      data.stockTransfers = data.stockTransfers.filter((t) => t.id !== id);
      saveData(data);
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

  // CRUD genérico dos cadastros auxiliares do estoque.
  const stockCollectionMatch = pathname.match(/^\/api\/stock\/(product-categories|movement-categories|deposits|price-tables|catalogs)(?:\/([^/]+))?$/);
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
      await syncSalesData(data);
      await syncPurchasesData(data);
      await syncFinanceData(data);
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
    await syncPurchasesData(data);
    await syncFinanceData(data);
    return sendJson(res, { finance: data.finance, sales: data.sales, purchases: data.purchases });
  }

  if (pathname === '/api/finance/summary' && req.method === 'GET') {
    try {
      const data = loadData();
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
    await syncCadastroData(data);
    await syncFinanceData(data);
    const user = await getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, {
      categories: data.financialCategories,
      costCenters: data.costCenters,
      bankAccounts: data.bankAccounts,
      directory: getCadastroDirectory(data)
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
      await syncCadastroData(data);
      await syncPurchasesData(data);
      await syncFinanceData(data);
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
      await syncCadastroData(data);
      await syncPurchasesData(data);
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const type = String(body.type || 'DESPESA').toUpperCase();
      if (!['RECEITA', 'DESPESA', 'TRANSFERENCIA'].includes(type)) {
        return sendJson(res, { error: 'Tipo de lançamento inválido' }, 400);
      }
      if (!body.description || !String(body.description).trim()) {
        return sendJson(res, { error: 'Informe a descrição do lançamento' }, 400);
      }
      const amount = Number(body.amount || 0);
      if (!(amount > 0)) {
        return sendJson(res, { error: 'Informe um valor maior que zero' }, 400);
      }
      if (type === 'TRANSFERENCIA' && body.bankAccountId && body.targetBankAccountId && body.bankAccountId === body.targetBankAccountId) {
        return sendJson(res, { error: 'A conta de origem e a conta de destino da transferência não podem ser a mesma.' }, 400);
      }
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
      addFinanceAuditLog(data, { action: 'criarLancamento', entry, byId: user.id, byName: user.name });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar lançamento' }, 400);
    }
  }

  if (/^\/api\/finance\/entries\/[^/]+\/payments$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncPurchasesData(data);
      await syncFinanceData(data);
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
      addFinanceAuditLog(data, { action: 'baixarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: payment.id, amount } });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao registrar pagamento' }, 400);
    }
  }

  if (/^\/api\/finance\/entries\/[^/]+\/estorno$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncPurchasesData(data);
      await syncFinanceData(data);
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
      addFinanceAuditLog(data, { action: 'estornarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: last.id, amount: last.amount } });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao estornar lançamento' }, 400);
    }
  }

  if (/^\/api\/finance\/entries\/[^/]+\/cancelar$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncPurchasesData(data);
      await syncFinanceData(data);
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

      entry.status = 'cancelado';
      entry.updatedAt = new Date().toISOString();
      await db.updateFinancialEntry(entry.id, { status: 'cancelado' });
      addFinanceAuditLog(data, { action: 'cancelarLancamento', entry, byId: user.id, byName: user.name });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao cancelar lançamento' }, 400);
    }
  }

  if (pathname.startsWith('/api/finance/entries/') && req.method === 'PUT') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncPurchasesData(data);
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/finance/entries/', ''));
      const entry = data.finance.find((item) => item.id === id);
      if (!entry) {
        return sendJson(res, { error: 'Lançamento não encontrado' }, 404);
      }
      if (entry.referenceId) {
        return sendJson(res, { error: 'Lançamentos gerados automaticamente por vendas/compras não podem ser editados aqui.' }, 400);
      }
      if (entry.nfeId) {
        return sendJson(res, { error: 'Lançamentos gerados por uma NF-e não podem ser editados diretamente. Cancele a NF-e se precisar corrigir os valores.' }, 400);
      }
      if (entry.status !== 'pending') {
        return sendJson(res, { error: 'Só é possível editar lançamentos ainda pendentes (sem baixa registrada).' }, 400);
      }

      const body = await readBody(req);
      if (body.description !== undefined) entry.description = String(body.description).trim();
      if (body.amount !== undefined) entry.amount = Number(body.amount || 0);
      if (body.date !== undefined) entry.date = body.date;
      if (body.dueDate !== undefined) entry.dueDate = body.dueDate;
      if (body.document !== undefined) entry.document = body.document;
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
      addFinanceAuditLog(data, { action: 'editarLancamento', entry, byId: user.id, byName: user.name });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao editar lançamento' }, 400);
    }
  }

  if (pathname.startsWith('/api/finance/entries/') && req.method === 'GET') {
    const data = loadData();
    await syncCadastroData(data);
    await syncPurchasesData(data);
    await syncFinanceData(data);
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
      await syncNfeData(data);
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const filtered = filterNfes(data, url.searchParams)
        .sort((a, b) => (String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))));
      const { page, limit } = parsePageParams(url.searchParams, 15);
      const start = (page - 1) * limit;
      const pageItems = filtered.slice(start, start + limit).map((nfe) => serializeNfe(nfe, data));
      return sendJson(res, { nfes: pageItems, total: filtered.length, page, limit });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao listar NF-e' }, 500);
    }
  }

  if (pathname === '/api/finance/nfe' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      await syncNfeData(data);
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
      const nfe = await db.createNfe({
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
          description: installments.length > 1 ? `NF-e ${nfe.number} · Parcela ${inst.number}/${installments.length}` : `NF-e ${nfe.number}`,
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

      addFinanceAuditLog(data, {
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
      await syncNfeData(data);
      await syncFinanceData(data);
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
          addFinanceAuditLog(data, {
            action: 'cancelarLancamento',
            entry,
            byId: user.id,
            byName: user.name,
            details: { motivo: `Cancelamento da NF-e ${nfe.number}` }
          });
          cancelledCount += 1;
        }
      }

      addFinanceAuditLog(data, {
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
    await syncNfeData(data);
    await syncFinanceData(data);
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
    await syncCadastroData(data);
    await syncPurchasesData(data);
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
    return sendJson(res, { matches: findBankTransactionMatches(tx, data) });
  }

  if (/^\/api\/finance\/bank-transactions\/[^/]+\/conciliar$/.test(pathname) && req.method === 'POST') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncPurchasesData(data);
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

      addFinanceAuditLog(data, { action: 'baixarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: payment.id, amount: tx.amount, origem: 'conciliacao', transacaoId: tx.id } });
      addFinanceAuditLog(data, { action: 'conciliarTransacao', entry: { id: tx.id, description: `Transação ${String(tx.id).slice(-8)} · ${tx.description}` }, byId: user.id, byName: user.name, details: { entryId: entry.id } });

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
        addFinanceAuditLog(data, { action: 'estornarLancamento', entry, byId: user.id, byName: user.name, details: { paymentId: tx.matchedPaymentId, motivo: 'Desconciliação de transação bancária' } });
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

  if (pathname === '/api/finance' && req.method === 'POST') {
    try {
      const data = loadData();
      await syncFinanceData(data);
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const entry = await db.createFinancialEntry({
        type: body.type || 'sale',
        referenceId: body.referenceId || '',
        date: body.date || new Date().toISOString().slice(0, 10),
        description: body.description || 'Lançamento',
        amount: Number(body.amount || 0),
        status: body.status || 'pending',
        createdBy: user.id,
        createdByName: user.name
      });
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
    const canManageUsers = user.role === 'admin';
    const canSeeSales = user.allowedModules.includes('sales');
    const canSeePurchases = user.allowedModules.includes('purchases');
    // Mesmas coleções legadas vazias do /api/dashboard: precisam vir do Supabase.
    if (canSeeSales) await syncSalesData(data);
    if (canSeePurchases) await syncPurchasesData(data);
 await syncFinanceData(data);
    const [settings, allUsers, products] = await Promise.all([
      db.getSettings(),
      canManageUsers ? db.getUsers() : Promise.resolve([]),
      user.allowedModules.includes('stock') ? db.getProducts() : Promise.resolve([])
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
          fiscalPermissions: Array.isArray(entry.fiscalPermissions) ? entry.fiscalPermissions : []
        }))
      : [];
    return sendJson(res, {
      settings,
      users: safeUsers,
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
        if (user.role !== 'admin') {
          return sendJson(res, { error: 'Sem permissão para gerenciar usuários' }, 403);
        }
        const newUser = await db.createUser({
          username: body.payload.username,
          password: body.payload.password,
          name: body.payload.name,
          role: body.payload.role || 'user',
          allowedModules: body.payload.allowedModules || ['dashboard'],
          fiscalPermissions: body.payload.fiscalPermissions || []
        });
        const data = loadData();
        data.auditLogs = data.auditLogs || [];
        data.auditLogs.push({ id: createId('audit'), action: 'createUser', targetId: newUser.id, targetUsername: newUser.username, byId: user.id, byName: user.name, at: new Date().toISOString() });
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
      if (requester.id === id) {
        if (permissoes.ehAdministrador(requester) && !papeis.includes('admin')) {
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
    if (requester.role !== 'admin') return sendJson(res, { error: 'Permissão negada' }, 403);
    const users = await db.getUsers();
    return sendJson(res, { users });
  }

  // GET audit logs (admin-only) with simple pagination: ?limit=50&offset=0
  if (pathname === '/api/audit' && req.method === 'GET') {
    try {
      const data = loadData();
      const requester = await getCurrentUser(req);
      if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
      if (requester.role !== 'admin') return sendJson(res, { error: 'Permissão negada' }, 403);
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      const logs = (data.auditLogs || []).slice().reverse(); // newest first
      const page = logs.slice(offset, offset + limit);
      return sendJson(res, { auditLogs: page, total: logs.length });
    } catch (err) {
      return sendJson(res, { error: 'Erro ao ler logs' }, 500);
    }
  }

  // user delete endpoint (dedicated)
  if (pathname === '/api/users/delete' && req.method === 'POST') {
    try {
      const requester = await getCurrentUser(req);
      if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
      if (requester.role !== 'admin') return sendJson(res, { error: 'Permissão negada' }, 403);
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
      data.auditLogs.push({ id: createId('audit'), action: 'deleteUser', targetId: deletedUser.id, targetUsername: deletedUser.username, byId: requester.id, byName: requester.name, at: new Date().toISOString() });
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
      if (requester.role !== 'admin') return sendJson(res, { error: 'Permissão negada' }, 403);
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
        fiscalPermissions: Array.isArray(body.fiscalPermissions) ? body.fiscalPermissions : target.fiscalPermissions,
        password: body.password ? String(body.password) : undefined
      });
      const data = loadData();
      data.auditLogs = data.auditLogs || [];
      data.auditLogs.push({ id: createId('audit'), action: 'updateUser', targetId: id, targetUsername: target.username, byId: requester.id, byName: requester.name, at: new Date().toISOString() });
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
    serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  if (pathname === '/app.css') {
    serveStatic(res, path.join(PUBLIC_DIR, 'app.css'));
    return;
  }

  if (pathname === '/app.js') {
    serveStatic(res, path.join(PUBLIC_DIR, 'app.js'));
    return;
  }

  // Servir os arquivos JS dos módulos (public/modules/**)
  if (pathname.startsWith('/modules/') && req.method === 'GET') {
    const relative = pathname.replace(/^\/modules\//, '');
    const modulesDir = path.join(PUBLIC_DIR, 'modules');
    const filePath = path.join(modulesDir, relative);
    if (!filePath.startsWith(modulesDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acesso negado');
      return;
    }
    serveStatic(res, filePath);
    return;
  }

  // Servir arquivos de assets (logo, favicon, etc)
  if (pathname.startsWith('/assets/')) {
    const filePath = path.join(PUBLIC_DIR, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const contentTypeMap = {
      '.svg': 'image/svg+xml; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon'
    };
    
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Arquivo não encontrado');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypeMap[ext] || 'application/octet-stream' });
      res.end(content);
    });
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

startServer(BASE_PORT, MAX_PORT_RETRIES);
