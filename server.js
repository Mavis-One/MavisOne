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
      password: 'admin123',
      name: 'Administrador',
      role: 'admin',
      allowedModules: ['dashboard', 'sales', 'purchases', 'stock', 'finance', 'settings', 'cadastros']
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
  orders: [],
  quotes: [],
  nfes: [],
  cadastros: [],
  importLogs: [],
  auditLogs: [],
  settings: {
    companyName: 'InfinityERP',
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

function normalizeData(data) {
  data.orders = Array.isArray(data.orders) ? data.orders : [];
  data.quotes = Array.isArray(data.quotes) ? data.quotes : [];
  data.nfes = Array.isArray(data.nfes) ? data.nfes : [];
  data.cadastros = Array.isArray(data.cadastros) ? data.cadastros : [];
  data.importLogs = Array.isArray(data.importLogs) ? data.importLogs : [];
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.users = Array.isArray(data.users) ? data.users : [];
  data.users = data.users.map((user) => {
    const allowedModules = Array.isArray(user.allowedModules) ? user.allowedModules : [];
    if (user.role === 'admin' && !allowedModules.includes('cadastros')) {
      allowedModules.push('cadastros');
    }
    return { ...user, allowedModules };
  });
  return data;
}

function loadData() {
  ensureDataFile();
  return normalizeData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
}

function saveData(data) {
  const normalized = normalizeData(data);
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalized, null, 2));
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      return sendJson(res, { token, user: { id: user.id, username: user.username, name: user.name, role: user.role, allowedModules: user.allowedModules } });
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
    return sendJson(res, { user: { id: user.id, username: user.username, name: user.name, role: user.role, allowedModules: user.allowedModules } });
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

    const salesTotal = data.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const purchaseTotal = data.purchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
    const stockValue = data.products.reduce((sum, product) => sum + Number(product.stockQuantity || 0) * Number(product.costPrice || 0), 0);

    const salesWithFinance = data.sales.filter((sale) => data.finance.some((entry) => entry.referenceId === sale.id && entry.type === 'sale'));
    const pendingReconciliation = salesWithFinance.filter((sale) => !data.finance.some((entry) => entry.referenceId === sale.id && entry.type === 'sale' && entry.status === 'paid')).length;

    return sendJson(res, {
      salesTotal,
      purchaseTotal,
      stockValue,
      balance: salesTotal - purchaseTotal,
      pendingReconciliation,
      totalProducts: data.products.length,
      totalSales: data.sales.length,
      totalPurchases: data.purchases.length
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
    return sendJson(res, { cadastros: data.cadastros });
  }

  if (pathname === '/api/cadastros' && req.method === 'POST') {
    try {
      const data = loadData();
      const user = getCurrentUser(req, data);
      if (!user || !user.allowedModules.includes('cadastros')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const cadastro = {
        id: body.id || createId('cad'),
        name: body.name || '',
        type: body.type || 'pessoa-fisica',
        document: body.document || '',
        email: body.email || '',
        phone: body.phone || '',
        address: body.address || '',
        city: body.city || '',
        state: body.state || '',
        zipCode: body.zipCode || '',
        notes: body.notes || '',
        status: body.status || 'ativo',
        createdAt: body.createdAt || new Date().toISOString()
      };

      data.cadastros.push(cadastro);
      saveData(data);
      return sendJson(res, { success: true, cadastro });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao salvar cadastro' }, 400);
    }
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
      const totals = {
        totalUsers: data.users.length,
        totalProducts: data.products.length,
        totalSales: data.sales.length,
        totalPurchases: data.purchases.length,
        totalFinance: data.finance.length
      };
      return sendJson(res, { settings: data.settings, users: data.users, totals });
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
          const newUser = {
            id: createId('user'),
            username: body.payload.username,
            password: body.payload.password,
            name: body.payload.name,
            role: body.payload.role || 'user',
            allowedModules: body.payload.allowedModules || ['dashboard']
          };
          data.users.push(newUser);
          saveData(data);
          return sendJson(res, { success: true, user: newUser });
        }

        if (body.type === 'deleteUser') {
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

  sendJson(res, { error: 'Não encontrado' }, 404);
});

function startServer(port, retriesLeft) {
  server.listen(port, HOST, () => {
    console.log(`Servidor iniciado em http://${HOST}:${port}`);
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
