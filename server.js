const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const BASE_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_RETRIES = 10;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const initialData = {
  users: [
    {
      id: 'user-admin',
      username: 'admin',
      password: 'SENHA-REMOVIDA-DO-HISTORICO',
      name: 'Administrador',
      role: 'admin',
      allowedModules: ['dashboard', 'sales', 'purchases', 'stock', 'finance', 'settings', 'cadastros'],
      theme: 'light'
    }
  ],
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
  orders: [],
  quotes: [],
  nfes: [],
  people: [],
  cnpjs: [],
  deposits: [],
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
  data.finance = Array.isArray(data.finance) ? data.finance : [];
  data.financialPayments = Array.isArray(data.financialPayments) ? data.financialPayments : [];
  data.financialCategories = Array.isArray(data.financialCategories) ? data.financialCategories : [];
  data.costCenters = Array.isArray(data.costCenters) ? data.costCenters : [];
  data.bankAccounts = Array.isArray(data.bankAccounts) ? data.bankAccounts : [];
  delete data.cadastros;
  data.importLogs = Array.isArray(data.importLogs) ? data.importLogs : [];
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.users = Array.isArray(data.users) ? data.users : [];
  data.users = data.users.map((user) => {
    const allowedModules = Array.isArray(user.allowedModules) ? user.allowedModules : [];
    const theme = user.theme === 'dark' ? 'dark' : 'light';
    return { ...user, allowedModules, theme };
  });
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

function getCurrentUser(req, data) {
  const token = req.headers['x-auth-token'];
  if (!token || !sessions[token]) {
    return null;
  }
  const userId = sessions[token];
  return data.users.find((user) => user.id === userId) || null;
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

function sumBy(list, key) {
  return (list || []).reduce((sum, item) => sum + Number(item[key] || 0), 0);
}

function resolveById(list, id) {
  if (!id) return '';
  const found = (list || []).find((item) => item.id === id);
  return found ? found.name : '';
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

function buildFinanceChartSeries(entries, granularity) {
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

  return buckets.map((bucket) => {
    const inRange = entries.filter((entry) => entry.date >= bucket.from && entry.date <= bucket.to);
    const receitas = sumFinanceAmount(inRange.filter((entry) => classifyFinanceEntry(entry) === 'receita' && isFinanceEntryRealized(entry)));
    const despesas = sumFinanceAmount(inRange.filter((entry) => classifyFinanceEntry(entry) === 'despesa' && isFinanceEntryRealized(entry)));
    return { label: bucket.label, from: bucket.from, to: bucket.to, receitas, despesas, saldo: receitas - despesas };
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
    previsaoFinanceira,
    chartSeries: buildFinanceChartSeries(entries, granularity),
    proximosVencimentos: dueBuckets,
    ultimosLancamentos,
    totalNfesEmitidas: nfes.length,
    nfeStats,
    movimentacoesBancarias: { available: false, reason: 'Disponível na Fase 4 (Extrato Open Finance).' }
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
    res.writeHead(200, { 'Content-Type': contentTypeMap[ext] || 'text/plain; charset=utf-8' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const data = loadData();
      const body = await readBody(req);
      const user = data.users.find((entry) => entry.username === body.username && entry.password === body.password);

      if (!user) {
        return sendJson(res, { error: 'Credenciais inválidas' }, 401);
      }

      const token = createId('token');
      sessions[token] = user.id;
      return sendJson(res, { token, user: { id: user.id, username: user.username, name: user.name, role: user.role, allowedModules: user.allowedModules, theme: user.theme } });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao autenticar' }, 400);
    }
  }

  if (pathname === '/api/me') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    return sendJson(res, { user: { id: user.id, username: user.username, name: user.name, role: user.role, allowedModules: user.allowedModules, theme: user.theme } });
  }

  if (pathname === '/api/me/theme' && req.method === 'PUT') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user) {
        return sendJson(res, { error: 'Não autenticado' }, 401);
      }
      const body = await readBody(req);
      const theme = body.theme === 'dark' ? 'dark' : 'light';
      user.theme = theme;
      saveData(data);
      return sendJson(res, { success: true, theme });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar preferência de tema' }, 400);
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
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    return sendJson(res, { modules: user.allowedModules });
  }

  if (pathname === '/api/dashboard') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }

    const canSales = user.allowedModules.includes('sales');
    const canPurchases = user.allowedModules.includes('purchases');
    const canStock = user.allowedModules.includes('stock');
    const canFinance = user.allowedModules.includes('finance');

    const salesTotal = canSales ? data.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0) : 0;
    const purchaseTotal = canPurchases ? data.purchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0) : 0;
    const stockValue = canStock ? data.products.reduce((sum, product) => sum + Number(product.stockQuantity || 0) * Number(product.costPrice || 0), 0) : 0;

    const salesWithFinance = (canSales && canFinance)
      ? data.sales.filter((sale) => data.finance.some((entry) => entry.referenceId === sale.id && entry.type === 'sale'))
      : [];
    const pendingReconciliation = (canSales && canFinance)
      ? salesWithFinance.filter((sale) => !data.finance.some((entry) => entry.referenceId === sale.id && entry.type === 'sale' && entry.status === 'paid')).length
      : 0;

    return sendJson(res, {
      salesTotal,
      purchaseTotal,
      stockValue,
      balance: salesTotal - purchaseTotal,
      pendingReconciliation,
      totalProducts: canStock ? data.products.length : 0,
      totalSales: canSales ? data.sales.length : 0,
      totalPurchases: canPurchases ? data.purchases.length : 0,
      permissions: {
        sales: canSales,
        purchases: canPurchases,
        stock: canStock,
        finance: canFinance
      }
    });
  }

  if (pathname === '/api/sales/records' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const view = url.searchParams.get('view') || 'orders_quotes';
    if (view === 'orders_quotes') {
      return sendJson(res, { orders: data.orders, quotes: data.quotes, nfes: data.nfes, importLogs: data.importLogs });
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
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const type = body.type || 'order';
      let record;
      if (type === 'order') {
        record = { id: createId('ord'), type: 'order', customer: body.customer || 'Cliente', date: body.date || new Date().toISOString().slice(0, 10), amount: Number(body.amount || 0), status: body.status || 'pendente', note: body.note || '' };
        data.orders.push(record);
      } else if (type === 'quote') {
        record = { id: createId('qte'), type: 'quote', customer: body.customer || 'Cliente', date: body.date || new Date().toISOString().slice(0, 10), amount: Number(body.amount || 0), status: body.status || 'em aberto', note: body.note || '' };
        data.quotes.push(record);
      } else if (type === 'nfe') {
        record = { id: createId('nfe'), type: 'nfe', number: body.number || createId('nfe-num'), customer: body.customer || 'Cliente', date: body.date || new Date().toISOString().slice(0, 10), amount: Number(body.amount || 0), status: body.status || 'emitida', key: body.key || '' };
        data.nfes.push(record);
      } else {
        return sendJson(res, { error: 'Tipo inválido' }, 400);
      }
      saveData(data);
      return sendJson(res, { success: true, record });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar venda' }, 400);
    }
  }

  if (pathname === '/api/sales/import' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const rows = body.rows || (body.text ? parseCsv(body.text) : []);
      const type = body.type || 'order';
      const created = [];
      rows.forEach((row) => {
        const customer = row.customer || row.cliente || row.Cliente || '';
        const amount = Number(row.amount || row.valor || row.total || 0);
        const date = row.date || row.data || new Date().toISOString().slice(0, 10);
        const status = row.status || row.statusPedido || 'pendente';
        if (type === 'order') {
          const record = { id: createId('ord'), type: 'order', customer, date, amount, status, note: row.note || '' };
          data.orders.push(record);
          created.push(record);
        } else if (type === 'quote') {
          const record = { id: createId('qte'), type: 'quote', customer, date, amount, status, note: row.note || '' };
          data.quotes.push(record);
          created.push(record);
        } else if (type === 'nfe') {
          const record = { id: createId('nfe'), type: 'nfe', number: row.number || row.numero || createId('nfe-num'), customer, date, amount, status, key: row.key || '' };
          data.nfes.push(record);
          created.push(record);
        }
      });
      data.importLogs.push({ id: createId('import'), type, source: body.source || 'manual', count: created.length, createdAt: new Date().toISOString() });
      saveData(data);
      return sendJson(res, { success: true, created, count: created.length });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao importar vendas' }, 400);
    }
  }

  if (pathname === '/api/sales' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { sales: data.sales, products: data.products });
  }

  if (pathname === '/api/sales' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const product = data.products.find((entry) => entry.id === body.productId);
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
      product.stockQuantity = Number(product.stockQuantity || 0) - Number(body.quantity || 0);

      const financeEntry = {
        id: createId('fin'),
        type: 'sale',
        referenceId: sale.id,
        date: sale.date,
        description: `Venda ${sale.id}`,
        amount: sale.total,
        status: 'paid',
        method: 'Pix'
      };
      data.finance.push(financeEntry);

      saveData(data);
      return sendJson(res, { success: true, sale, financeEntry });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar venda' }, 400);
    }
  }

  if (pathname === '/api/cadastros' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { people: data.people, cnpjs: data.cnpjs });
  }

  if (pathname === '/api/cadastros/pessoas' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { people: data.people });
  }

  if (pathname === '/api/cadastros/cnpjs' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { cnpjs: data.cnpjs });
  }

  if (pathname.startsWith('/api/cnpj/') && req.method === 'GET') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('cadastros')) {
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
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('cadastros')) {
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

  if (pathname === '/api/cadastros/pessoas' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
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
        code: formatCadastroCode(data.nextCadastroCode || 1),
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
      data.nextCadastroCode = (data.nextCadastroCode || 1) + 1;

      const missingFields = validateRequiredRegistrationFields(person);
      if (missingFields.length) {
        return sendJson(res, { error: `Preencha os campos obrigatórios: ${missingFields.join(', ')}.` }, 400);
      }

      const duplicateMessage = findDuplicateRegistration(data, person);
      if (duplicateMessage) {
        return sendJson(res, { error: duplicateMessage }, 409);
      }

      data.people.push(person);
      saveData(data);
      return sendJson(res, { success: true, person });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar pessoa' }, 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/pessoas/') && req.method === 'PUT') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
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

      data.people[index] = person;
      saveData(data);
      return sendJson(res, { success: true, person });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao atualizar pessoa' }, 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/pessoas/') && req.method === 'DELETE') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }

    const id = decodeURIComponent(pathname.replace('/api/cadastros/pessoas/', ''));
    const index = data.people.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return sendJson(res, { error: 'Pessoa não encontrada' }, 404);
    }

    data.people.splice(index, 1);
    saveData(data);
    return sendJson(res, { success: true });
  }

  if (pathname === '/api/cadastros/cnpjs' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
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
        code: formatCadastroCode(data.nextCadastroCode || 1),
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
      data.nextCadastroCode = (data.nextCadastroCode || 1) + 1;

      const missingFields = validateRequiredRegistrationFields(company);
      if (missingFields.length) {
        return sendJson(res, { error: `Preencha os campos obrigatórios: ${missingFields.join(', ')}.` }, 400);
      }

      const duplicateMessage = findDuplicateRegistration(data, company);
      if (duplicateMessage) {
        return sendJson(res, { error: duplicateMessage }, 409);
      }

      data.cnpjs.push(company);
      saveData(data);
      return sendJson(res, { success: true, company });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar CNPJ' }, 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/cnpjs/') && req.method === 'PUT') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
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

      data.cnpjs[index] = company;
      saveData(data);
      return sendJson(res, { success: true, company });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao atualizar CNPJ' }, 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/cnpjs/') && req.method === 'DELETE') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }

    const id = decodeURIComponent(pathname.replace('/api/cadastros/cnpjs/', ''));
    const index = data.cnpjs.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return sendJson(res, { error: 'CNPJ não encontrado' }, 404);
    }

    data.cnpjs.splice(index, 1);
    saveData(data);
    return sendJson(res, { success: true });
  }

  if (pathname === '/api/cadastros/deposits' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { deposits: data.deposits });
  }

  if (pathname === '/api/cadastros/deposits' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome do depósito.' }, 400);
      }
      const code = String(body.code || '').trim();
      if (code && data.deposits.some((entry) => entry.code && entry.code.toLowerCase() === code.toLowerCase())) {
        return sendJson(res, { error: 'Já existe um depósito com este código interno.' }, 409);
      }
      const deposit = {
        id: createId('dep'),
        name,
        code,
        status: String(body.status || 'ativo').trim() || 'ativo',
        address: body.address || '',
        city: body.city || '',
        state: body.state || '',
        manager: body.manager || '',
        notes: body.notes || '',
        createdAt: new Date().toISOString()
      };
      data.deposits.push(deposit);
      saveData(data);
      return sendJson(res, { success: true, deposit });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar depósito' }, 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/deposits/') && req.method === 'PUT') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/cadastros/deposits/', ''));
      const index = data.deposits.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return sendJson(res, { error: 'Depósito não encontrado' }, 404);
      }
      const current = data.deposits[index];
      const body = await readBody(req);
      const name = String(body.name ?? current.name ?? '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome do depósito.' }, 400);
      }
      const code = String(body.code ?? current.code ?? '').trim();
      if (code && data.deposits.some((entry) => entry.id !== id && entry.code && entry.code.toLowerCase() === code.toLowerCase())) {
        return sendJson(res, { error: 'Já existe um depósito com este código interno.' }, 409);
      }
      const deposit = {
        ...current,
        name,
        code,
        status: String(body.status ?? current.status ?? 'ativo').trim() || 'ativo',
        address: body.address ?? current.address ?? '',
        city: body.city ?? current.city ?? '',
        state: body.state ?? current.state ?? '',
        manager: body.manager ?? current.manager ?? '',
        notes: body.notes ?? current.notes ?? ''
      };
      data.deposits[index] = deposit;
      saveData(data);
      return sendJson(res, { success: true, deposit });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao atualizar depósito' }, 400);
    }
  }

  if (pathname.startsWith('/api/cadastros/deposits/') && req.method === 'DELETE') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('cadastros')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    const id = decodeURIComponent(pathname.replace('/api/cadastros/deposits/', ''));
    const index = data.deposits.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return sendJson(res, { error: 'Depósito não encontrado' }, 404);
    }
    data.deposits.splice(index, 1);
    saveData(data);
    return sendJson(res, { success: true });
  }

  if (pathname === '/api/purchases' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('purchases')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { purchases: data.purchases, products: data.products });
  }

  if (pathname === '/api/purchases' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const product = data.products.find((entry) => entry.id === body.productId);
      if (!product) {
        return sendJson(res, { error: 'Produto não encontrado' }, 400);
      }

      const purchase = {
        id: createId('purchase'),
        date: body.date || new Date().toISOString().slice(0, 10),
        supplier: body.supplier || 'Fornecedor',
        productId: product.id,
        quantity: Number(body.quantity || 0),
        costPrice: Number(body.costPrice || product.costPrice || 0),
        total: Number(body.quantity || 0) * Number(body.costPrice || product.costPrice || 0),
        status: 'pendente'
      };

      data.purchases.push(purchase);
      product.stockQuantity = Number(product.stockQuantity || 0) + Number(body.quantity || 0);
      product.costPrice = Number(body.costPrice || product.costPrice || 0);

      const financeEntry = {
        id: createId('fin'),
        type: 'purchase',
        referenceId: purchase.id,
        date: purchase.date,
        description: `Compra ${purchase.id}`,
        amount: purchase.total,
        status: 'pending',
        method: 'Boleto'
      };
      data.finance.push(financeEntry);

      saveData(data);
      return sendJson(res, { success: true, purchase, financeEntry });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar compra' }, 400);
    }
  }

  if (pathname === '/api/stock' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('stock')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { products: data.products });
  }

  if (pathname === '/api/stock' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('stock')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const product = {
        id: body.id || createId('prod'),
        name: body.name,
        sku: body.sku,
        stockQuantity: Number(body.stockQuantity || 0),
        costPrice: Number(body.costPrice || 0),
        salePrice: Number(body.salePrice || 0)
      };

      const existingIndex = data.products.findIndex((entry) => entry.id === product.id);
      if (existingIndex >= 0) {
        data.products[existingIndex] = product;
      } else {
        data.products.push(product);
      }

      saveData(data);
      return sendJson(res, { success: true, product });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar produto' }, 400);
    }
  }

  if (pathname === '/api/finance' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { finance: data.finance, sales: data.sales, purchases: data.purchases });
  }

  if (pathname === '/api/finance/summary' && req.method === 'GET') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
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
    const user = getCurrentUser(req, data);
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
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome da categoria' }, 400);
      }
      const category = { id: createId('cat'), name, type: body.type || 'ambos', createdAt: new Date().toISOString() };
      data.financialCategories.push(category);
      saveData(data);
      return sendJson(res, { success: true, category });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar categoria' }, 400);
    }
  }

  if (pathname === '/api/finance/cost-centers' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome do centro de custo' }, 400);
      }
      const costCenter = { id: createId('cc'), name, createdAt: new Date().toISOString() };
      data.costCenters.push(costCenter);
      saveData(data);
      return sendJson(res, { success: true, costCenter });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar centro de custo' }, 400);
    }
  }

  if (pathname === '/api/finance/bank-accounts' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return sendJson(res, { error: 'Informe o nome da conta bancária' }, 400);
      }
      const bankAccount = {
        id: createId('bank'),
        name,
        bank: body.bank || '',
        agency: body.agency || '',
        number: body.number || '',
        createdAt: new Date().toISOString()
      };
      data.bankAccounts.push(bankAccount);
      saveData(data);
      return sendJson(res, { success: true, bankAccount });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao criar conta bancária' }, 400);
    }
  }

  if (pathname === '/api/finance/entries' && req.method === 'GET') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const filtered = filterFinanceEntries(data, url.searchParams)
        .sort((a, b) => (b.date === a.date ? String(b.id).localeCompare(String(a.id)) : String(b.date).localeCompare(String(a.date))));
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
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
      const user = getCurrentUser(req, data);
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
      const entry = {
        id: createId('fin'),
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
        createdByName: user.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
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
      const user = getCurrentUser(req, data);
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

      const payment = {
        id: createId('pay'),
        entryId: entry.id,
        amount,
        date: body.date || new Date().toISOString().slice(0, 10),
        bankAccountId: body.bankAccountId || entry.bankAccountId || '',
        interest,
        fine,
        discount,
        note: body.note || '',
        createdBy: user.id,
        createdByName: user.name,
        createdAt: new Date().toISOString()
      };
      data.financialPayments.push(payment);
      entry.status = recomputeFinanceEntryStatus(entry, data);
      entry.updatedAt = new Date().toISOString();
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
      const user = getCurrentUser(req, data);
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

      data.financialPayments = data.financialPayments.filter((p) => p.id !== last.id);
      entry.status = recomputeFinanceEntryStatus(entry, data);
      entry.updatedAt = new Date().toISOString();
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
      const user = getCurrentUser(req, data);
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
      const user = getCurrentUser(req, data);
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
      addFinanceAuditLog(data, { action: 'editarLancamento', entry, byId: user.id, byName: user.name });
      saveData(data);
      return sendJson(res, { success: true, entry: serializeFinanceEntry(entry, data) });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao editar lançamento' }, 400);
    }
  }

  if (pathname.startsWith('/api/finance/entries/') && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
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
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const filtered = filterNfes(data, url.searchParams)
        .sort((a, b) => (String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))));
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 15)));
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
      const user = getCurrentUser(req, data);
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

      const nfe = {
        id: createId('nfe'),
        type: 'nfe',
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
        items,
        taxNotes: body.taxNotes || '',
        paymentType: body.paymentType === 'parcelado' ? 'parcelado' : 'avista',
        installmentsCount: body.paymentType === 'parcelado' ? Math.min(60, Math.max(2, Math.round(Number(body.installmentsCount || 2)))) : 1,
        installmentIntervalDays: Math.max(1, Number(body.installmentIntervalDays || 30)),
        createdBy: user.id,
        createdByName: user.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const installments = buildNfeInstallments(nfe);
      installments.forEach((inst) => {
        const entry = {
          id: createId('fin'),
          type: 'RECEITA',
          date: nfe.date,
          dueDate: inst.dueDate,
          amount: inst.amount,
          description: installments.length > 1 ? `NF-e ${nfe.number} · Parcela ${inst.number}/${installments.length}` : `NF-e ${nfe.number}`,
          document: nfe.number,
          note: '',
          category: '',
          costCenter: '',
          bankAccountId: '',
          targetBankAccountId: '',
          clientSupplierId: nfe.clientSupplierId || '',
          clientSupplierName: nfe.customer,
          referenceId: '',
          nfeId: nfe.id,
          status: 'pending',
          createdBy: user.id,
          createdByName: user.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        data.finance.push(entry);
      });

      data.nfes.push(nfe);
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
      const user = getCurrentUser(req, data);
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

      nfe.status = 'cancelada';
      nfe.updatedAt = new Date().toISOString();

      const linkedEntries = (data.finance || []).filter((entry) => entry.nfeId === nfe.id);
      let cancelledCount = 0;
      linkedEntries.forEach((entry) => {
        if (entry.status === 'pending' || entry.status === 'parcial') {
          entry.status = 'cancelado';
          entry.updatedAt = new Date().toISOString();
          addFinanceAuditLog(data, {
            action: 'cancelarLancamento',
            entry,
            byId: user.id,
            byName: user.name,
            details: { motivo: `Cancelamento da NF-e ${nfe.number}` }
          });
          cancelledCount += 1;
        }
      });

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
    const user = getCurrentUser(req, data);
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

  if (pathname === '/api/finance' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const entry = {
        id: createId('fin'),
        type: body.type || 'sale',
        referenceId: body.referenceId || '',
        date: body.date || new Date().toISOString().slice(0, 10),
        description: body.description || 'Lançamento',
        amount: Number(body.amount || 0),
        status: body.status || 'pending',
        method: body.method || 'Dinheiro'
      };
      data.finance.push(entry);
      saveData(data);
      return sendJson(res, { success: true, entry });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar financeiro' }, 400);
    }
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    const data = loadData();
    const user = getCurrentUser(req, data);
    if (!user || !user.allowedModules.includes('settings')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
      const canManageUsers = user.role === 'admin';
      const totals = {
        totalUsers: canManageUsers ? data.users.length : 0,
        totalProducts: user.allowedModules.includes('stock') ? data.products.length : 0,
        totalSales: user.allowedModules.includes('sales') ? data.sales.length : 0,
        totalPurchases: user.allowedModules.includes('purchases') ? data.purchases.length : 0,
        totalFinance: user.allowedModules.includes('finance') ? data.finance.length : 0
      };
      const safeUsers = canManageUsers
        ? data.users.map((entry) => ({
            id: entry.id,
            username: entry.username,
            name: entry.name,
            role: entry.role,
            allowedModules: Array.isArray(entry.allowedModules) ? entry.allowedModules : []
          }))
        : [];
      return sendJson(res, {
        settings: data.settings,
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
        const data = loadData();
        const user = getCurrentUser(req, data);
        if (!user || !user.allowedModules.includes('settings')) {
          return sendJson(res, { error: 'Sem permissão' }, 403);
      }

        const body = await readBody(req);
        if (body.type === 'company') {
          data.settings = { ...data.settings, ...body.payload };
          saveData(data);
          return sendJson(res, { success: true, settings: data.settings });
        }

        if (body.type === 'user') {
          if (user.role !== 'admin') {
            return sendJson(res, { error: 'Sem permissão para gerenciar usuários' }, 403);
          }
          const newUser = {
            id: createId('user'),
            username: body.payload.username,
            password: body.payload.password,
            name: body.payload.name,
            role: body.payload.role || 'user',
            allowedModules: body.payload.allowedModules || ['dashboard'],
            theme: 'light'
          };
          data.users.push(newUser);
          data.auditLogs = data.auditLogs || [];
          data.auditLogs.push({ id: createId('audit'), action: 'createUser', targetId: newUser.id, targetUsername: newUser.username, byId: user.id, byName: user.name, at: new Date().toISOString() });
          saveData(data);
          return sendJson(res, { success: true, user: newUser });
        }

        if (body.type === 'deleteUser') {
          if (user.role !== 'admin') {
            return sendJson(res, { error: 'Sem permissão para gerenciar usuários' }, 403);
          }
          const id = body.payload && body.payload.id;
          if (!id) return sendJson(res, { error: 'ID ausente' }, 400);
                  const requestingUser = getCurrentUser(req, data);
                  if (!requestingUser) return sendJson(res, { error: 'Não autenticado' }, 401);
                  if (requestingUser.role !== 'admin') return sendJson(res, { error: 'Permissão negada' }, 403);
                  if (requestingUser.id === id) return sendJson(res, { error: 'Não é permitido excluir o usuário logado' }, 400);
                  const idx = data.users.findIndex((u) => u.id === id);
                  if (idx < 0) return sendJson(res, { error: 'Usuário não encontrado' }, 404);
                  const deletedUser = data.users[idx];
                  data.users.splice(idx, 1);
                  // audit log
                  data.auditLogs = data.auditLogs || [];
                  data.auditLogs.push({ id: createId('audit'), action: 'deleteUser', targetId: deletedUser.id, targetUsername: deletedUser.username, byId: requestingUser.id, byName: requestingUser.name, at: new Date().toISOString() });
                  saveData(data);
                  return sendJson(res, { success: true });
                }

                return sendJson(res, { error: 'Tipo de configuração inválido' }, 400);
              } catch (error) {
                return sendJson(res, { error: 'Erro ao salvar configurações' }, 400);
              }
            }

  // GET users for debugging (admin only)
  if (pathname === '/api/users' && req.method === 'GET') {
    const data = loadData();
    const requester = getCurrentUser(req, data);
    if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
    if (requester.role !== 'admin') return sendJson(res, { error: 'Permissão negada' }, 403);
    return sendJson(res, { users: data.users });
  }

  // GET audit logs (admin-only) with simple pagination: ?limit=50&offset=0
  if (pathname === '/api/audit' && req.method === 'GET') {
    try {
      const data = loadData();
      const requester = getCurrentUser(req, data);
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
      const data = loadData();
      const requester = getCurrentUser(req, data);
      if (!requester) return sendJson(res, { error: 'Não autenticado' }, 401);
      if (requester.role !== 'admin') return sendJson(res, { error: 'Permissão negada' }, 403);
      const body = await readBody(req);
      const id = body && body.id;
      if (!id) return sendJson(res, { error: 'ID ausente' }, 400);
      if (requester.id === id) return sendJson(res, { error: 'Não é permitido excluir o usuário logado' }, 400);
      const idx = data.users.findIndex((u) => u.id === id);
      if (idx < 0) return sendJson(res, { error: 'Usuário não encontrado' }, 404);
      const deletedUser = data.users[idx];
      data.users.splice(idx, 1);
      // audit log
      data.auditLogs = data.auditLogs || [];
      data.auditLogs.push({ id: createId('audit'), action: 'deleteUser', targetId: deletedUser.id, targetUsername: deletedUser.username, byId: requester.id, byName: requester.name, at: new Date().toISOString() });
      saveData(data);
      return sendJson(res, { success: true });
    } catch (err) {
      return sendJson(res, { error: 'Erro ao excluir usuário' }, 500);
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
