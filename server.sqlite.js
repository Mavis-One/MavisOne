const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  createId,
  authenticateUser,
  getUserById,
  getUsers,
  createUser,
  getProducts,
  upsertProduct,
  getSales,
  createSale,
  getPurchases,
  createPurchase,
  getFinanceEntries,
  createFinanceEntry,
  getFinanceEntriesByReference,
  getSettings,
  updateSettings
} = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
let sessions = {};

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

function getCurrentUser(req) {
  const token = req.headers['x-auth-token'];
  if (!token || !sessions[token]) {
    return null;
  }
  return getUserById(sessions[token]);
}

function buildDashboardSummary() {
  const sales = getSales();
  const purchases = getPurchases();
  const products = getProducts();
  const financeEntries = getFinanceEntries();

  const salesTotal = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const purchaseTotal = purchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
  const stockValue = products.reduce((sum, product) => sum + Number(product.stockQuantity || 0) * Number(product.costPrice || 0), 0);

  const pendingReconciliation = sales.filter((sale) => {
    const entries = financeEntries.filter((entry) => entry.type === 'sale' && entry.referenceId === sale.id);
    if (entries.length === 0) {
      return true;
    }
    return !entries.some((entry) => entry.status === 'paid');
  }).length;

  return {
    salesTotal,
    purchaseTotal,
    stockValue,
    balance: salesTotal - purchaseTotal,
    pendingReconciliation,
    totalProducts: products.length,
    totalSales: sales.length,
    totalPurchases: purchases.length
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const user = authenticateUser(body.username, body.password);
      if (!user) {
        return sendJson(res, { error: 'Credenciais inválidas' }, 401);
      }

      const token = createId('token');
      sessions[token] = user.id;
      return sendJson(res, { token, user });
    } catch (error) {
      return sendJson(res, { error: 'Erro ao autenticar' }, 400);
    }
  }

  if (pathname === '/api/me') {
    const user = getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    return sendJson(res, { user });
  }

  if (pathname === '/api/modules') {
    const user = getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    return sendJson(res, { modules: user.allowedModules });
  }

  if (pathname === '/api/dashboard') {
    const user = getCurrentUser(req);
    if (!user) {
      return sendJson(res, { error: 'Não autenticado' }, 401);
    }
    return sendJson(res, buildDashboardSummary());
  }

  if (pathname === '/api/sales' && req.method === 'GET') {
    const user = getCurrentUser(req);
    if (!user || !user.allowedModules.includes('sales')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { sales: getSales(), products: getProducts() });
  }

  if (pathname === '/api/sales' && req.method === 'POST') {
    try {
      const user = getCurrentUser(req);
      if (!user || !user.allowedModules.includes('sales')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const sale = createSale({
        date: body.date,
        customer: body.customer,
        productId: body.productId,
        quantity: body.quantity,
        unitPrice: body.unitPrice
      });

      const financeEntry = createFinanceEntry({
        type: 'sale',
        referenceId: sale.id,
        date: sale.date,
        description: `Venda ${sale.id}`,
        amount: sale.total,
        status: 'paid',
        method: 'Pix'
      });

      return sendJson(res, { success: true, sale, financeEntry });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao criar venda' }, 400);
    }
  }

  if (pathname === '/api/purchases' && req.method === 'GET') {
    const user = getCurrentUser(req);
    if (!user || !user.allowedModules.includes('purchases')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { purchases: getPurchases(), products: getProducts() });
  }

  if (pathname === '/api/purchases' && req.method === 'POST') {
    try {
      const user = getCurrentUser(req);
      if (!user || !user.allowedModules.includes('purchases')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const purchase = createPurchase({
        date: body.date,
        supplier: body.supplier,
        productId: body.productId,
        quantity: body.quantity,
        costPrice: body.costPrice
      });

      const financeEntry = createFinanceEntry({
        type: 'purchase',
        referenceId: purchase.id,
        date: purchase.date,
        description: `Compra ${purchase.id}`,
        amount: purchase.total,
        status: 'pending',
        method: 'Boleto'
      });

      return sendJson(res, { success: true, purchase, financeEntry });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao criar compra' }, 400);
    }
  }

  if (pathname === '/api/stock' && req.method === 'GET') {
    const user = getCurrentUser(req);
    if (!user || !user.allowedModules.includes('stock')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { products: getProducts() });
  }

  if (pathname === '/api/stock' && req.method === 'POST') {
    try {
      const user = getCurrentUser(req);
      if (!user || !user.allowedModules.includes('stock')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const product = upsertProduct({
        id: body.id,
        name: body.name,
        sku: body.sku,
        stockQuantity: body.stockQuantity,
        costPrice: body.costPrice,
        salePrice: body.salePrice
      });

      return sendJson(res, { success: true, product });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar produto' }, 400);
    }
  }

  if (pathname === '/api/finance' && req.method === 'GET') {
    const user = getCurrentUser(req);
    if (!user || !user.allowedModules.includes('finance')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { finance: getFinanceEntries(), sales: getSales(), purchases: getPurchases() });
  }

  if (pathname === '/api/finance' && req.method === 'POST') {
    try {
      const user = getCurrentUser(req);
      if (!user || !user.allowedModules.includes('finance')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      const entry = createFinanceEntry({
        type: body.type,
        referenceId: body.referenceId,
        date: body.date,
        description: body.description,
        amount: body.amount,
        status: body.status,
        method: body.method
      });
      return sendJson(res, { success: true, entry });
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar financeiro' }, 400);
    }
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    const user = getCurrentUser(req);
    if (!user || !user.allowedModules.includes('settings')) {
      return sendJson(res, { error: 'Sem permissão' }, 403);
    }
    return sendJson(res, { settings: getSettings(), users: getUsers() });
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const user = getCurrentUser(req);
      if (!user || !user.allowedModules.includes('settings')) {
        return sendJson(res, { error: 'Sem permissão' }, 403);
      }

      const body = await readBody(req);
      if (body.type === 'company') {
        const settings = updateSettings({
          companyName: body.payload.companyName,
          currency: body.payload.currency,
          taxRate: body.payload.taxRate,
          reconciliationMode: body.payload.reconciliationMode
        });
        return sendJson(res, { success: true, settings });
      }

      if (body.type === 'user') {
        const newUser = createUser({
          username: body.payload.username,
          password: body.payload.password,
          name: body.payload.name,
          role: body.payload.role,
          allowedModules: body.payload.allowedModules
        });
        return sendJson(res, { success: true, user: newUser });
      }

      return sendJson(res, { error: 'Tipo de configuração inválido' }, 400);
    } catch (error) {
      return sendJson(res, { error: error.message || 'Erro ao salvar configurações' }, 400);
    }
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

server.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
