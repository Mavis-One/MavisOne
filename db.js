const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'db.json');

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      allowed_modules TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT,
      stock_quantity REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      customer TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'faturado'
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      supplier TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pendente'
    );
    CREATE TABLE IF NOT EXISTS finance (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      method TEXT NOT NULL DEFAULT 'Dinheiro'
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_name TEXT NOT NULL DEFAULT 'ERP Base',
      currency TEXT NOT NULL DEFAULT 'BRL',
      tax_rate REAL NOT NULL DEFAULT 0,
      reconciliation_mode TEXT NOT NULL DEFAULT 'auto-paid'
    );
  `);
  return db;
}

function withDb(callback) {
  const db = openDb();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function parseAllowedModules(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return [];
  }
}

function serializeAllowedModules(modules) {
  return JSON.stringify(modules || []);
}

function getDefaultAdminPasswordHash() {
  return bcrypt.hashSync('admin123', 10);
}

function ensureSeedData() {
  withDb((db) => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0) {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, name, role, allowed_modules)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'user-admin',
        'admin',
        getDefaultAdminPasswordHash(),
        'Administrador',
        'admin',
        serializeAllowedModules(['dashboard', 'sales', 'purchases', 'stock', 'finance', 'settings'])
      );
    }

    const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    if (productCount === 0) {
      db.prepare(`
        INSERT INTO products (id, name, sku, stock_quantity, cost_price, sale_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('prod-1', 'Produto Exemplo', 'SKU-001', 20, 50, 75);
    }

    const settingsRow = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
    if (settingsRow === 0) {
      db.prepare(`
        INSERT INTO settings (id, company_name, currency, tax_rate, reconciliation_mode)
        VALUES (?, ?, ?, ?, ?)
      `).run(1, 'ERP Base', 'BRL', 0, 'auto-paid');
    }
  });
}

function migrateLegacyData() {
  if (!fs.existsSync(LEGACY_DB_PATH)) {
    return;
  }

  const legacyData = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8'));
  withDb((db) => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0 && Array.isArray(legacyData.users)) {
      for (const user of legacyData.users) {
        db.prepare(`
          INSERT INTO users (id, username, password_hash, name, role, allowed_modules)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          user.id,
          user.username,
          user.password ? bcrypt.hashSync(user.password, 10) : getDefaultAdminPasswordHash(),
          user.name,
          user.role || 'user',
          serializeAllowedModules(user.allowedModules || [])
        );
      }
    }

    const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    if (productCount === 0 && Array.isArray(legacyData.products)) {
      for (const product of legacyData.products) {
        db.prepare(`
          INSERT INTO products (id, name, sku, stock_quantity, cost_price, sale_price)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          product.id,
          product.name,
          product.sku,
          Number(product.stockQuantity || 0),
          Number(product.costPrice || 0),
          Number(product.salePrice || 0)
        );
      }
    }

    const salesCount = db.prepare('SELECT COUNT(*) as count FROM sales').get().count;
    if (salesCount === 0 && Array.isArray(legacyData.sales)) {
      for (const sale of legacyData.sales) {
        db.prepare(`
          INSERT INTO sales (id, date, customer, product_id, quantity, unit_price, total, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sale.id,
          sale.date,
          sale.customer,
          sale.productId,
          Number(sale.quantity || 0),
          Number(sale.unitPrice || 0),
          Number(sale.total || 0),
          sale.status || 'faturado'
        );
      }
    }

    const purchasesCount = db.prepare('SELECT COUNT(*) as count FROM purchases').get().count;
    if (purchasesCount === 0 && Array.isArray(legacyData.purchases)) {
      for (const purchase of legacyData.purchases) {
        db.prepare(`
          INSERT INTO purchases (id, date, supplier, product_id, quantity, cost_price, total, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          purchase.id,
          purchase.date,
          purchase.supplier,
          purchase.productId,
          Number(purchase.quantity || 0),
          Number(purchase.costPrice || 0),
          Number(purchase.total || 0),
          purchase.status || 'pendente'
        );
      }
    }

    const financeCount = db.prepare('SELECT COUNT(*) as count FROM finance').get().count;
    if (financeCount === 0 && Array.isArray(legacyData.finance)) {
      for (const entry of legacyData.finance) {
        db.prepare(`
          INSERT INTO finance (id, type, reference_id, date, description, amount, status, method)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          entry.id,
          entry.type,
          entry.referenceId,
          entry.date,
          entry.description,
          Number(entry.amount || 0),
          entry.status || 'pending',
          entry.method || 'Dinheiro'
        );
      }
    }

    const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
    if (settingsCount === 0 && legacyData.settings) {
      db.prepare(`
        INSERT INTO settings (id, company_name, currency, tax_rate, reconciliation_mode)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        1,
        legacyData.settings.companyName || 'ERP Base',
        legacyData.settings.currency || 'BRL',
        Number(legacyData.settings.taxRate || 0),
        legacyData.settings.reconciliationMode || 'auto-paid'
      );
    }
  });
}

function initializeDatabase() {
  ensureSeedData();
  migrateLegacyData();
}

initializeDatabase();

function authenticateUser(username, password) {
  const userRow = withDb((db) => {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  });

  if (!userRow) {
    return null;
  }

  if (!bcrypt.compareSync(password, userRow.password_hash)) {
    return null;
  }

  return {
    id: userRow.id,
    username: userRow.username,
    name: userRow.name,
    role: userRow.role,
    allowedModules: parseAllowedModules(userRow.allowed_modules)
  };
}

function getUserById(userId) {
  const row = withDb((db) => db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    allowedModules: parseAllowedModules(row.allowed_modules)
  };
}

function getUsers() {
  return withDb((db) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY name ASC').all();
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      name: row.name,
      role: row.role,
      allowedModules: parseAllowedModules(row.allowed_modules)
    }));
  });
}

function createUser(payload) {
  const userId = payload.id || createId('user');
  const passwordHash = bcrypt.hashSync(payload.password, 10);
  withDb((db) => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, name, role, allowed_modules)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, payload.username, passwordHash, payload.name, payload.role || 'user', serializeAllowedModules(payload.allowedModules || []));
  });
  return getUserById(userId);
}

function getProducts() {
  return withDb((db) => {
    const rows = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      stockQuantity: Number(row.stock_quantity || 0),
      costPrice: Number(row.cost_price || 0),
      salePrice: Number(row.sale_price || 0)
    }));
  });
}

function upsertProduct(payload) {
  const productId = payload.id || createId('prod');
  const product = {
    id: productId,
    name: payload.name,
    sku: payload.sku,
    stockQuantity: Number(payload.stockQuantity || 0),
    costPrice: Number(payload.costPrice || 0),
    salePrice: Number(payload.salePrice || 0)
  };

  withDb((db) => {
    const existing = db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId);
    if (existing) {
      db.prepare(`
        UPDATE products
        SET name = ?, sku = ?, stock_quantity = ?, cost_price = ?, sale_price = ?
        WHERE id = ?
      `).run(product.name, product.sku, product.stockQuantity, product.costPrice, product.salePrice, product.id);
    } else {
      db.prepare(`
        INSERT INTO products (id, name, sku, stock_quantity, cost_price, sale_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(product.id, product.name, product.sku, product.stockQuantity, product.costPrice, product.salePrice);
    }
  });

  return product;
}

function getSales() {
  return withDb((db) => {
    const rows = db.prepare('SELECT * FROM sales ORDER BY date DESC, id DESC').all();
    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      customer: row.customer,
      productId: row.product_id,
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unit_price || 0),
      total: Number(row.total || 0),
      status: row.status
    }));
  });
}

function createSale(payload) {
  const saleId = createId('sale');
  const sale = {
    id: saleId,
    date: payload.date || new Date().toISOString().slice(0, 10),
    customer: payload.customer || 'Cliente sem nome',
    productId: payload.productId,
    quantity: Number(payload.quantity || 0),
    unitPrice: Number(payload.unitPrice || 0),
    total: Number(payload.quantity || 0) * Number(payload.unitPrice || 0),
    status: 'faturado'
  };

  withDb((db) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(sale.productId);
    if (!product) {
      throw new Error('Produto não encontrado');
    }
    if (Number(product.stock_quantity || 0) < sale.quantity) {
      throw new Error('Estoque insuficiente');
    }

    db.prepare(`
      INSERT INTO sales (id, date, customer, product_id, quantity, unit_price, total, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sale.id, sale.date, sale.customer, sale.productId, sale.quantity, sale.unitPrice, sale.total, sale.status);

    db.prepare(`
      UPDATE products
      SET stock_quantity = ?, sale_price = ?
      WHERE id = ?
    `).run(Number(product.stock_quantity || 0) - sale.quantity, sale.unitPrice, sale.productId);
  });

  return sale;
}

function getPurchases() {
  return withDb((db) => {
    const rows = db.prepare('SELECT * FROM purchases ORDER BY date DESC, id DESC').all();
    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      supplier: row.supplier,
      productId: row.product_id,
      quantity: Number(row.quantity || 0),
      costPrice: Number(row.cost_price || 0),
      total: Number(row.total || 0),
      status: row.status
    }));
  });
}

function createPurchase(payload) {
  const purchaseId = createId('purchase');
  const purchase = {
    id: purchaseId,
    date: payload.date || new Date().toISOString().slice(0, 10),
    supplier: payload.supplier || 'Fornecedor',
    productId: payload.productId,
    quantity: Number(payload.quantity || 0),
    costPrice: Number(payload.costPrice || 0),
    total: Number(payload.quantity || 0) * Number(payload.costPrice || 0),
    status: 'pendente'
  };

  withDb((db) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(purchase.productId);
    if (!product) {
      throw new Error('Produto não encontrado');
    }

    db.prepare(`
      INSERT INTO purchases (id, date, supplier, product_id, quantity, cost_price, total, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(purchase.id, purchase.date, purchase.supplier, purchase.productId, purchase.quantity, purchase.costPrice, purchase.total, purchase.status);

    db.prepare(`
      UPDATE products
      SET stock_quantity = ?, cost_price = ?
      WHERE id = ?
    `).run(Number(product.stock_quantity || 0) + purchase.quantity, purchase.costPrice, purchase.productId);
  });

  return purchase;
}

function getFinanceEntries() {
  return withDb((db) => {
    const rows = db.prepare('SELECT * FROM finance ORDER BY date DESC, id DESC').all();
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      referenceId: row.reference_id,
      date: row.date,
      description: row.description,
      amount: Number(row.amount || 0),
      status: row.status,
      method: row.method
    }));
  });
}

function createFinanceEntry(payload) {
  const financeId = createId('fin');
  const entry = {
    id: financeId,
    type: payload.type || 'sale',
    referenceId: payload.referenceId || '',
    date: payload.date || new Date().toISOString().slice(0, 10),
    description: payload.description || 'Lançamento',
    amount: Number(payload.amount || 0),
    status: payload.status || 'pending',
    method: payload.method || 'Dinheiro'
  };

  withDb((db) => {
    db.prepare(`
      INSERT INTO finance (id, type, reference_id, date, description, amount, status, method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.type, entry.referenceId, entry.date, entry.description, entry.amount, entry.status, entry.method);
  });

  return entry;
}

function getFinanceEntriesByReference(type, referenceId) {
  return withDb((db) => {
    const rows = db.prepare('SELECT * FROM finance WHERE type = ? AND reference_id = ? ORDER BY date DESC').all(type, referenceId);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      referenceId: row.reference_id,
      date: row.date,
      description: row.description,
      amount: Number(row.amount || 0),
      status: row.status,
      method: row.method
    }));
  });
}

function getSettings() {
  const row = withDb((db) => db.prepare('SELECT * FROM settings WHERE id = 1').get());
  if (!row) {
    return {
      companyName: 'ERP Base',
      currency: 'BRL',
      taxRate: 0,
      reconciliationMode: 'auto-paid'
    };
  }
  return {
    companyName: row.company_name,
    currency: row.currency,
    taxRate: Number(row.tax_rate || 0),
    reconciliationMode: row.reconciliation_mode
  };
}

function updateSettings(payload) {
  withDb((db) => {
    const existing = db.prepare('SELECT 1 FROM settings WHERE id = 1').get();
    if (existing) {
      db.prepare(`
        UPDATE settings
        SET company_name = ?, currency = ?, tax_rate = ?, reconciliation_mode = ?
        WHERE id = 1
      `).run(payload.companyName, payload.currency, Number(payload.taxRate || 0), payload.reconciliationMode || 'auto-paid');
    } else {
      db.prepare(`
        INSERT INTO settings (id, company_name, currency, tax_rate, reconciliation_mode)
        VALUES (?, ?, ?, ?, ?)
      `).run(1, payload.companyName, payload.currency, Number(payload.taxRate || 0), payload.reconciliationMode || 'auto-paid');
    }
  });
  return getSettings();
}

module.exports = {
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
};
