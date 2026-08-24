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
const { buildNfePayload } = require('./lib/nfePayloadBuilder');
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
// Grupos de Produtos (fase AH). Mesmo arquivo que o navegador carrega: se a
// tela agrupasse de um jeito e o servidor de outro, o usuário veria três grupos
// e o sistema gravaria dois.
const salesGrupos = require('./public/modules/shared/sales_grupos');
// Aba Impostos do pedido. Roda a MESMA montagem tributária da emissão — ver o
// cabeçalho de lib/calcularTributos.js.
const { calcularTributos } = require('./lib/calcularTributos');
// Anexos do pedido: binário no Supabase Storage (bucket privado), ficha no
// próprio pedido. Ver o cabeçalho de lib/db/anexos.js.
const anexosDb = require('./lib/db/anexos');
// Ações em lote da lista. Mesmo arquivo que o navegador carrega: é ele que diz
// quem é elegível, e a tela e o servidor precisam responder igual.
const salesBulk = require('./public/modules/shared/sales_bulk_actions');
const fiscalPermissoes = require('./public/modules/shared/fiscal_permissoes');
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
  // Confere a virada aqui também, e não só no portão da requisição: qualquer
  // caminho que chegue a um usuário autenticado passa por esta função, então é
  // o último ponto em que uma sessão vencida ainda poderia passar.
  if (!token || derrubarSeExpirou(token) || !sessions[token]) {
    return null;
  }
  const { userId } = sessions[token];
  const user = await db.getUserById(userId);
  // Bloqueado é como se não estivesse logado — inclusive para quem já tinha
  // sessão aberta quando o acesso foi suspenso.
  if (!user || user.active === false) return null;
  return user;
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

function serializeUserForClient(user, acesso = null) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    allowedModules: user.allowedModules,
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
        // A que grupo de produtos esta linha pertence (fase AH). Este objeto é
        // uma lista branca: sem o campo aqui, o groupId que a tela mandou era
        // descartado calado, e todos os itens voltavam para o primeiro grupo no
        // próximo salvamento. Vazio é aceito — quem resolve é normalizarGrupos.
        groupId: String(item.groupId || '').trim().slice(0, 40),
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
function registrarMovimentoEstoque(data, { productId, productName, type, quantityDelta, referenceType, referenceId, note, user, classId, classValueId }) {
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
      await db.upsertProduct({ ...produto, stockQuantity: Number(produto.stockQuantity || 0) + Number(item.quantity || 0) });
      registrarMovimentoEstoque(data, {
        productId: item.productId, productName: item.name, type: 'estorno',
        quantityDelta: Number(item.quantity || 0), referenceType: 'order', referenceId: record.id,
        // O estorno devolve para a MESMA cor que a venda tirou. Devolver ao
        // saldo sem cor deixaria a cor eternamente devendo.
        classId: item.classId, classValueId: item.classValueId,
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
        classId: item.classId, classValueId: item.classValueId,
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
  // Normaliza na LEITURA também, e não só na gravação: pedido gravado antes da
  // fase AH não tem grupo nenhum, e a tela precisa de um para desenhar os
  // itens. Sem isto o pedido antigo abriria vazio, com os produtos existindo
  // no total e em lugar nenhum na tela.
  const normalizado = salesGrupos.normalizarGrupos(
    record.productGroups,
    Array.isArray(record.items) ? record.items : []
  );
  const productGroups = normalizado.groups;
  const items = normalizado.items;
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
    productGroups,
    // Fichas dos anexos (fase AI). Só metadado — o binário fica no Storage e
    // sai por uma rota própria, que confere a sessão antes de entregar.
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
  // Os anexos vão junto: sem isto os arquivos ficam no Storage sem nada
  // apontando para eles. Antes de excluir o registro, porque depois as fichas
  // já não existem para dizer QUAIS arquivos apagar.
  for (const ficha of (Array.isArray(record.attachments) ? record.attachments : [])) {
    try {
      await anexosDb.removerAnexo(ficha);
    } catch (erro) {
      console.error('[anexos] arquivo orfao no Storage:', ficha.caminho, erro.message);
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
    // Anexos não são copiados: o arquivo está no Storage sob o id do original,
    // e duas fichas apontando para o mesmo arquivo fariam excluir uma quebrar
    // a outra.
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

function buildSalesDashboardSummary(data) {
  const orders = (data.orders || []).map((record) => serializeSalesRecord(record, data));
  const quotes = (data.quotes || []).map((record) => serializeSalesRecord(record, data));

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

  for (const [produtoId, variacao] of efeitos) {
    const produto = produtos.get(produtoId);
    if (!produto) continue;
    const projetado = Number(produto.stockQuantity || 0) + variacao;
    if (projetado < 0) {
      const err = new Error(
        `Estoque insuficiente de "${produto.name}" para apontar esta produção: ` +
        `disponível ${Number(produto.stockQuantity || 0)}, necessário ${Math.abs(Math.round(variacao * 10000) / 10000)}. ` +
        'Dê entrada no componente antes de apontar.'
      );
      err.status = 400;
      throw err;
    }
  }

  const consumidos = [];
  for (const [produtoId, variacao] of efeitos) {
    const produto = produtos.get(produtoId);
    if (!produto || !variacao) continue;
    const arredondado = Math.round(variacao * 10000) / 10000;
    await db.upsertProduct({ ...produto, stockQuantity: Number(produto.stockQuantity || 0) + arredondado });
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

  return { consumidos, produzido: quantidade };
}

// Casca de gravação do efeito acima: carrega a ordem, aplica e persiste o
// ledger local (data.stockMovements). Sai calada quando não há o que fazer —
// delta zero, ordem inexistente — para o chamador não precisar se defender.
async function mexerNoEstoqueDaProducao(ordemId, delta, user) {
  if (!ordemId || !Number(delta)) return null;
  const ordem = await modulosDb.obter('pcp/orders', ordemId);
  if (!ordem) return null;
  const data = loadData();
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

  const rotulo = nfe.numero ? `NF-e ${nfe.numero}` : `NF-e ${nfe.referencia}`;
  for (const parcela of parcelas) {
    await db.createFinancialEntry({
      type: 'RECEITA',
      date: emissao,
      dueDate: parcela.dueDate,
      amount: parcela.amount,
      description: parcelas.length > 1 ? `${rotulo} · Parcela ${parcela.number}/${parcelas.length}` : rotulo,
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
async function loadStockContext({ comReservas = false } = {}) {
  const data = loadData();
  await syncCadastroData(data);
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

function buildMovementRecord(data, { type, productId, depositId, quantity, unitCost, categoryId, date, document, note, transferId, origin, classId, classValueId }, user) {
  return {
    id: stockCore.createId('mov'),
    code: stockCore.nextSequentialCode(data.stockMovements, 'MOV'),
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
      await syncCadastroData(data);
      if (permissoes.finance) await syncFinanceData(data);
      if (permissoes.sales) await syncSalesData(data);

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
        pedidos: data.sales || [],
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
          if (novaOrdem === anterior.orderId) {
            // Mesma ordem: aplica só a diferença.
            await mexerNoEstoqueDaProducao(novaOrdem, novaQtd - Number(anterior.quantity || 0), usuarioDaRequisicao);
          } else {
            // Trocou de ordem: desfaz inteiro na antiga e aplica inteiro na nova.
            await mexerNoEstoqueDaProducao(anterior.orderId, -Number(anterior.quantity || 0), usuarioDaRequisicao);
            await mexerNoEstoqueDaProducao(novaOrdem, novaQtd, usuarioDaRequisicao);
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
  if (pathname === '/api/reports/overview' && req.method === 'GET') {
    const data = loadData();
    // Sem checagem de permissão aqui: o portão central já traduziu esta rota
    // para reports.ler e decidiu. Repetir com allowedModules seria MAIS
    // restrito que o portão — administrador passa por lá e era barrado aqui.
    const user = await getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }

    const granularity = url.searchParams.get('granularity') || 'month';
    await syncCadastroData(data);
    await syncSalesData(data);
    await syncFinanceData(data);
    const products = await db.getProducts();

    const vendas = buildSalesDashboardSummary(data);
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
      // Categoria e Tabela de Preços eram texto livre na tela de venda, mesmo
      // existindo cadastro dos dois no Estoque. Digitar à mão gera "Revenda",
      // "revenda" e "Revensa" como se fossem coisas diferentes, e aí nenhum
      // relatório por categoria fecha.
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
      await syncCadastroData(data);
      await syncNfeData(data);
      await syncFinanceData(data);
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
        // Grupos e itens saem juntos da mesma função: é ela que garante um
        // grupo mínimo e que nenhum item fique apontando para grupo que não
        // existe. Normalizar só um dos dois deixaria itens órfãos, que somem da
        // tela sem sumir do total.
        const { groups: productGroups, items } = salesGrupos.normalizarGrupos(body.productGroups, itensBrutos);
        // Aceita id OU nome: a tela sempre manda o id, mas registros importados
        // (CSV) só têm o nome. Sem nenhum dos dois o pedido nascia sem cliente.
        if (!body.clientSupplierId && !String(body.clientSupplierName || '').trim()) {
          return sendJson(res, { error: 'Selecione o cliente/fornecedor do pedido/orçamento' }, 400);
        }
        const totais = computeSalesTotals(items, body);
        record = {
          id: createId(type === 'order' ? 'ord' : 'qte'),
          type,
          productGroups,
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
      await syncCadastroData(data);
      await syncSalesData(data);
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
        // O bucket é privado e os bytes saem por aqui, não por URL do Storage:
        // URL de arquivo vaza fácil (e-mail, print, log de proxy), e um anexo
        // de pedido tem contrato e dado de cliente dentro.
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

  if (pathname.startsWith('/api/sales/records/') && req.method === 'GET') {
    try {
      const data = loadData();
      await syncCadastroData(data);
      await syncSalesData(data);
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
      const itensBrutos = normalizeSalesItems(await completarNomesDosItens(body.items));
      if (!itensBrutos.length) {
        return sendJson(res, { error: mensagemItensInvalidos(body.items) }, 400);
      }
      // Ver o comentário na criação: grupos e itens saem juntos da mesma
      // função, para não sobrar item apontando para grupo que já não existe.
      const { groups: productGroups, items } = salesGrupos.normalizarGrupos(body.productGroups, itensBrutos);
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
        productGroups,
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
      const user = await getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }
      const id = decodeURIComponent(pathname.replace('/api/sales/records/', ''));
      // A exclusão inteira — devolução de estoque, remoção dos anexos do
      // Storage e a saída da lista em memória — mora em excluirSalesRecord,
      // porque as ações em lote fazem exatamente isto. Duas cópias divergem, e
      // aqui a divergência custaria reserva de estoque presa para sempre ou
      // arquivo órfão no Storage.
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

  // As rotas /api/cadastros/empresas (GET/POST/DELETE) viviam aqui. Foram
  // substituídas pelo handler genérico de coleções de cadastro mais acima
  // (cadastroCollectionMatch), que atende /api/cadastros/companies a partir do
  // descritor em lib/cadastros-core.js — que é o endpoint que a tela de
  // Empresas realmente chama. Ninguém chamava a versão em português.

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
        const quebra = stockCore.classBalances(loadData(), productId, depositId);
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
      let classesDoProduto = [];
      try {
        classesDoProduto = await classesDb.classesDoProduto(body.productId);
      } catch (erroClasses) {
        classesDoProduto = [];
      }
      const { quantity } = assertMovementIsPossible(data, productsById, {
        productId: body.productId,
        depositId: originDepositId,
        type: 'saida',
        quantity: body.quantity,
        classValueId: body.classValueId,
        classesDoProduto
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
        origin: 'transferencia',
        // §18: a cor atravessa a transferência. Sem isto, transferir 4 pretos
        // tiraria 4 pretos da origem e daria 4 SEM COR ao destino — o total do
        // produto continuaria certo, e o preto teria sumido de um depósito
        // sem aparecer no outro.
        classId: body.classId || '',
        classValueId: body.classValueId || ''
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
        // Repetido no registro da transferência, além dos dois movimentos: a
        // tela de transferências lista daqui e teria de abrir os movimentos
        // para descobrir qual cor foi transferida.
        classId: body.classId || '',
        classValueId: body.classValueId || '',
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
      await addFinanceAuditLog(data, { action: 'cancelarLancamento', entry, byId: user.id, byName: user.name });
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
      if (entry.status !== 'pending') {
        return sendJson(res, { error: 'Só é possível editar lançamentos ainda pendentes (sem baixa registrada).' }, 400);
      }

      const body = await readBody(req);

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
        if (body.document !== undefined) entry.document = body.document;
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
      await addFinanceAuditLog(data, { action: 'editarLancamento', entry, byId: user.id, byName: user.name });
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
    const canManageUsers = await ehAdmin(user);
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
          // Sanitiza na LEITURA também: usuário gravado antes de as permissões
          // fantasma serem removidas ainda carrega 'manifestar' na coluna, e
          // devolvê-la faria a tela mostrar um controle que não existe.
          fiscalPermissions: fiscalPermissoes.sanitizar(entry.fiscalPermissions)
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
          fiscalPermissions: fiscalPermissoes.sanitizar(body.payload.fiscalPermissions)
        });
        const data = loadData();
        data.auditLogs = data.auditLogs || [];
        await registrarAuditoria({ action: 'createUser', targetId: newUser.id, targetUsername: newUser.username, byId: user.id, byName: user.name });
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
        password: body.password ? String(body.password) : undefined
      });
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

startServer(BASE_PORT, MAX_PORT_RETRIES);
