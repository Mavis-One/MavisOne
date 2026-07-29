const app = document.getElementById('app');
const state = { user: null, activeModule: 'dashboard', activeSub: null, selectedModule: null, cadastroDraft: { people: {}, cnpjs: {} } };
const LAST_ROUTE_KEY = 'mavisone:last-route';

function persistLastRoute() {
  const payload = {
    module: state.activeModule || 'dashboard',
    sub: state.activeSub || null
  };
  localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(payload));
}

function restoreLastRoute() {
  try {
    const raw = localStorage.getItem(LAST_ROUTE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const requestedModule = String(parsed?.module || 'dashboard');
    state.activeModule = hasModuleAccess(requestedModule) ? requestedModule : 'dashboard';
    state.activeSub = parsed?.sub ? String(parsed.sub) : null;
  } catch (_) {
    state.activeModule = 'dashboard';
    state.activeSub = null;
  }
}

function hasModuleAccess(moduleName) {
  if (!state.user) return false;
  if (moduleName === 'dashboard') return true;
  return Array.isArray(state.user.allowedModules) && state.user.allowedModules.includes(moduleName);
}

function getSecondarySidebarConfig(moduleName) {
  if (moduleName === 'sales') {
    return { module: 'sales', title: 'Vendas', subtitle: 'Fluxos', items: moduleSubItems.sales };
  }
  if (moduleName === 'cadastros') {
    return { module: 'cadastros', title: 'Cadastros', subtitle: 'Fluxos', items: moduleSubItems.cadastros };
  }
  if (moduleName === 'purchases') {
    return { module: 'purchases', title: 'Compras', subtitle: 'Fluxos', items: moduleSubItems.purchases };
  }
  return null;
}

function shouldShowSecondarySidebar() {
  if (state.activeModule === 'cadastros') {
    return !state.activeSub;
  }
  return Boolean(getSecondarySidebarConfig(state.activeModule) && !state.activeSub);
}

function getActiveSecondaryModule() {
  return getSecondarySidebarConfig(state.activeModule) ? state.activeModule : null;
}

function renderSecondarySidebar() {
  const sidebar = document.querySelector('.secondary-sidebar');
  if (!sidebar) return;

  const moduleName = shouldShowSecondarySidebar() ? getActiveSecondaryModule() : null;
  const secondaryConfig = getSecondarySidebarConfig(moduleName);
  sidebar.classList.toggle('visible', Boolean(secondaryConfig));

  if (!secondaryConfig) {
    sidebar.innerHTML = '';
    return;
  }

  const activeKey = state.activeSub || (secondaryConfig.module === 'sales' ? 'orders_quotes' : secondaryConfig.module === 'cadastros' ? 'list' : secondaryConfig.module === 'purchases' ? 'new_purchase' : null);

  sidebar.innerHTML = `
    <div class="secondary-header">
      <strong>${secondaryConfig.title}</strong>
      <span>${secondaryConfig.subtitle}</span>
    </div>
    <div class="secondary-nav-list">
      ${secondaryConfig.items.map((sub) => `
        <button class="secondary-nav-item ${(state.activeModule === secondaryConfig.module && activeKey === sub.key) ? 'active' : ''}" data-module="${secondaryConfig.module}" data-sub="${sub.key}">
          <span>${sub.label}</span>
        </button>
      `).join('')}
    </div>
  `;

  sidebar.querySelectorAll('.secondary-nav-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.activeModule = btn.dataset.module;
      state.activeSub = btn.dataset.sub;
      state.hoveredModule = null;
      renderApp();
      loadModule(state.activeModule);
    });
  });
}

function syncSecondarySidebar() {
  renderSecondarySidebar();
}

async function api(path, options = {}) {
  const headers = {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const token = localStorage.getItem('token');
  if (token) {
    headers['x-auth-token'] = token;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Erro inesperado');
  }
  return data;
}

function showToast(message, type = 'info', timeout = 4200) {
  const text = String(message || '').trim();
  if (!text) return;

  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <div class="toast-content">
      <strong>${type === 'error' ? 'Erro' : type === 'success' ? 'Sucesso' : type === 'warning' ? 'Atenção' : 'Aviso'}</strong>
      <span>${escapeHtml(text)}</span>
    </div>
    <button type="button" class="toast-close" aria-label="Fechar notificação">&times;</button>
  `;

  const closeToast = () => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 220);
  };

  toast.querySelector('.toast-close')?.addEventListener('click', closeToast);
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(closeToast, timeout);
}

window.notifyToast = (message, type = 'info', timeout) => showToast(message, type, timeout);

// Confirmation modal utility that returns a Promise<boolean>
function confirmModal(message) {
  return new Promise((resolve) => {
    const existing = document.getElementById('confirmModal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'confirmModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-body">
          <p class="modal-message"></p>
        </div>
        <div class="modal-actions">
          <button class="btn btn-muted" data-action="cancel">Cancelar</button>
          <button class="btn btn-danger" data-action="confirm">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-message').textContent = message;
    // close when clicking outside modal
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
    overlay.querySelector('[data-action=cancel]').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('[data-action=confirm]').addEventListener('click', () => { overlay.remove(); resolve(true); });
  });
}

function renderAuth(error = '') {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <img src="/assets/logo.png" alt="SAL Logo" class="logo-auth" />
        <h1 class="brand"><span class="brand-full">MavisONE</span><span class="brand-short">MO</span></h1>
        <p class="muted">Faça login com suas credenciais</p>
        <form id="loginForm" class="form-grid">
          <label>Usuário
            <input name="username" required placeholder="Digite seu usuário" />
          </label>
          <label>Senha
            <input name="password" type="password" required placeholder="Digite sua senha" />
          </label>
          <button type="submit">Entrar</button>
          ${error ? `<p style="color:#b91c1c">${error}</p>` : ''}
        </form>
      </div>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      const response = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: formData.get('username'), password: formData.get('password') })
      });
      localStorage.setItem('token', response.token);
      state.user = response.user;
      showToast('Login realizado com sucesso.', 'success');
      renderApp();
      await loadModule('dashboard');
    } catch (error) {
      showToast(error.message || 'Falha ao autenticar.', 'error');
      renderAuth(error.message);
    }
  });
}

function renderApp() {
  const activeSubKey = state.activeSub || (state.activeModule === 'sales' ? 'orders_quotes' : state.activeModule === 'cadastros' ? 'list' : state.activeModule === 'purchases' ? 'new_purchase' : null);
  const activeSubLabel = (state.activeModule === 'cadastros' && activeSubKey === 'edit')
    ? 'Edição'
    : (state.activeModule === 'cadastros' && activeSubKey === 'register')
      ? 'Cadastro'
    : (state.activeModule === 'cadastros' && activeSubKey === 'list')
      ? ''
    : ((moduleSubItems[state.activeModule] || []).find((item) => item.key === activeSubKey)?.label || '');
  const showSecondarySidebar = shouldShowSecondarySidebar();

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-header">
          <img src="/assets/logo.png" alt="SAL Logo" class="logo-sidebar" />
          <h2 class="brand"><span class="brand-full">MavisONE</span><span class="brand-short">MO</span></h2>
        </div>
        <p class="muted">${state.user?.name || 'Usuário'}</p>
        <div class="nav-list">
          ${['dashboard', 'sales', 'purchases', 'stock', 'finance', 'cadastros']
            .filter((module) => state.user?.allowedModules?.includes(module))
            .map((module) => `
              <div class="nav-block">
                <button class="nav-item ${state.activeModule === module ? 'active' : ''}" data-module="${module}">
                  <span class="icon">${moduleLabels[module].split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase()}</span>
                  <span class="text">${moduleLabels[module]}</span>
                </button>
                <div class="submenu">
                  ${ (moduleSubItems[module] || []).map((sub) => `
                    <button class="sub-item ${state.activeModule === module && state.activeSub === sub.key ? 'active' : ''}" data-module="${module}" data-sub="${sub.key}">${sub.label}</button>
                  `).join('') }
                </div>
              </div>
          `).join('')}
        </div>
      </aside>
      <aside class="secondary-sidebar ${showSecondarySidebar ? 'visible' : ''}"></aside>
      <main class="content">
        <div class="topbar">
          <h1>${moduleLabels[state.activeModule]}${activeSubLabel ? ' > ' + activeSubLabel : ''}</h1>
          <div class="topbar-actions">
            ${hasModuleAccess('settings') ? `
            <button class="icon-btn settings-btn" id="settingsBtn" title="Configurações">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v6m0 6v6"></path>
                <path d="M4.22 4.22l4.24 4.24m3.08 3.08l4.24 4.24"></path>
                <path d="M1 12h6m6 0h6"></path>
                <path d="M4.22 19.78l4.24-4.24m3.08-3.08l4.24-4.24"></path>
              </svg>
            </button>
            ` : ''}
            <button class="secondary" id="logoutBtn">Sair</button>
          </div>
        </div>
        <div id="moduleContent"></div>
      </main>
    </div>
  `;

  renderSecondarySidebar();

  // main nav click handlers
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.onclick = () => {
      const module = button.dataset.module;
      state.activeModule = module;
      state.activeSub = null;
      state.selectedModule = getSecondarySidebarConfig(module) ? module : null;
      renderApp();
      loadModule(state.activeModule);
    };
  });

  // submenu handlers
  document.querySelectorAll('.sub-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const module = btn.dataset.module;
      const sub = btn.dataset.sub;
      state.activeModule = module;
      state.activeSub = sub;
      state.selectedModule = getSecondarySidebarConfig(module) ? module : null;
      renderApp();
      loadModule(state.activeModule);
    });
  });

  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    if (!hasModuleAccess('settings')) {
      showToast('Sem permissão para acessar Configurações.', 'warning');
      return;
    }
    state.activeModule = 'settings';
    state.activeSub = null;
    state.selectedModule = null;
    renderApp();
    loadModule('settings');
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem(LAST_ROUTE_KEY);
    state.user = null;
    state.selectedModule = null;
    renderAuth();
  });
}

const moduleLabels = {
  dashboard: 'Dashboard Geral',
  sales: 'Vendas',
  purchases: 'Compras',
  stock: 'Estoque',
  finance: 'Financeiro',
  settings: 'Configurações',
  cadastros: 'Cadastros'
};

// Sub-itens por módulo (usados para exibir submenu na sidebar)
const moduleSubItems = {
  dashboard: [],
  sales: [
    { key: 'orders_quotes', label: 'Pedidos e Orçamentos' },
    { key: 'new_quote', label: 'Novo Orçamento' },
    { key: 'new_order', label: 'Novo Pedido' },
    { key: 'order_groups', label: 'Agrupamento de Pedidos' },
    { key: 'new_order_group', label: 'Novo Agrupamento de Pedidos' },
    { key: 'nfes', label: 'NF-e Emitidas' },
    { key: 'new_nfe', label: 'Nova NF-e Avulsa' },
    { key: 'returns', label: 'Devoluções' },
    { key: 'sales_dashboard', label: 'Painel Vendas' },
    { key: 'seller_dashboard', label: 'Painel Vendedor' },
    { key: 'credits', label: 'Vales de Crédito' },
    { key: 'integrations', label: 'Central de Integrações' },
    { key: 'import_logs', label: "Log's Vendas Importadas" },
    { key: 'import_sales', label: 'Importar Vendas' },
    { key: 'configure_promotions', label: 'Configurar Promoções' },
    { key: 'new_promotion', label: 'Nova Promoção' }
  ],
  purchases: [
    { key: 'new_purchase', label: 'Nova compra' },
    { key: 'purchase_history', label: 'Histórico de compras' },
    { key: 'suppliers', label: 'Fornecedores' }
  ],
  stock: [ { key: 'products', label: 'Produtos' }, { key: 'movements', label: 'Movimentos' } ],
  finance: [ { key: 'payables', label: 'Contas a pagar' }, { key: 'receivables', label: 'Contas a receber' } ],
  settings: [ { key: 'users', label: 'Usuários' }, { key: 'company', label: 'Empresa' } ],
  cadastros: [
    { key: 'list', label: 'Cadastros' }
  ]
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatCpfCnpj(value) {
  const digits = sanitizeDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function isValidCpf(cpf) {
  const cleaned = sanitizeDigits(cpf);
  if (cleaned.length !== 11 || /^(\d)\1{10}$/.test(cleaned)) {
    return false;
  }

  const calcDigit = (base, factor) => {
    const total = base.split('').reduce((sum, digit) => sum + Number(digit) * factor--, 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const digit1 = calcDigit(cleaned.slice(0, 9), 10);
  const digit2 = calcDigit(cleaned.slice(0, 10), 11);
  return cleaned === `${cleaned.slice(0, 9)}${digit1}${digit2}`;
}

function isValidCnpj(cnpj) {
  const cleaned = sanitizeDigits(cnpj);
  if (cleaned.length !== 14 || /^(\d)\1{13}$/.test(cleaned)) {
    return false;
  }

  const calcDigit = (base, weights) => {
    const total = base.split('').reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const digit1 = calcDigit(cleaned.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digit2 = calcDigit(cleaned.slice(0, 12) + digit1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cleaned === `${cleaned.slice(0, 12)}${digit1}${digit2}`;
}

function isValidDocument(documentValue) {
  const digits = sanitizeDigits(documentValue);
  return digits.length === 11 ? isValidCpf(digits) : digits.length === 14 ? isValidCnpj(digits) : false;
}

function getDocumentType(documentValue) {
  const digits = sanitizeDigits(documentValue);
  if (digits.length === 11) return 'cpf';
  if (digits.length === 14) return 'cnpj';
  return '';
}

function maskDocumentValue(value, type = '') {
  const digits = sanitizeDigits(value);
  if (type === 'pessoa-juridica' || digits.length > 11) {
    return formatCpfCnpj(digits.slice(0, 14));
  }
  return formatCpfCnpj(digits.slice(0, 11));
}

function getOfficialEmail(official) {
  const contacts = Array.isArray(official?.contatos) ? official.contatos : [];
  const fromContacts = contacts.find((contact) => String(contact?.type || '').toLowerCase() === 'email')?.value;
  const fromRaw = official?.raw?.email;
  return String(fromContacts || fromRaw || '').trim();
}

function getOfficialPhone(official) {
  const contacts = Array.isArray(official?.contatos) ? official.contatos : [];
  const fromContacts = contacts.find((contact) => {
    const type = String(contact?.type || '').toLowerCase();
    return type === 'phone' || type === 'telefone' || type === 'celular';
  })?.value;
  const fromRaw = official?.raw?.ddd_telefone_1 || official?.raw?.ddd_telefone_2 || official?.raw?.ddd_fax;
  return String(fromContacts || fromRaw || '').trim();
}

async function loadModule(moduleName) {
  if (!hasModuleAccess(moduleName)) {
    state.activeModule = 'dashboard';
    state.activeSub = null;
    state.selectedModule = null;
    persistLastRoute();
    renderApp();
    const currentContent = document.getElementById('moduleContent');
    if (currentContent) {
      currentContent.innerHTML = '<div class="panel"><p>Sem permissão para acessar este módulo.</p></div>';
    }
    showToast('Sem permissão para acessar este módulo.', 'warning');
    return;
  }

  state.activeModule = moduleName;
  persistLastRoute();
  const content = document.getElementById('moduleContent');
  if (!content) {
    return;
  }

  try {
    if (moduleName === 'dashboard') {
      const data = await api('/api/dashboard');
      const dashboardPermissions = data.permissions || {};
      content.innerHTML = `
        <div class="cards">
          ${dashboardPermissions.sales ? `<div class="card"><h3>Vendas</h3><p>R$ ${data.salesTotal.toFixed(2)}</p></div>` : ''}
          ${dashboardPermissions.purchases ? `<div class="card"><h3>Compras</h3><p>R$ ${data.purchaseTotal.toFixed(2)}</p></div>` : ''}
          ${(dashboardPermissions.sales || dashboardPermissions.purchases) ? `<div class="card"><h3>Saldo</h3><p>R$ ${data.balance.toFixed(2)}</p></div>` : ''}
          ${(dashboardPermissions.sales && dashboardPermissions.finance) ? `<div class="card"><h3>Conc. pendente</h3><p>${data.pendingReconciliation}</p></div>` : ''}
        </div>
        <div class="panel">
          <h3>Resumo rápido</h3>
          ${dashboardPermissions.stock ? `<p>Produtos cadastrados: ${data.totalProducts}</p>` : ''}
          ${dashboardPermissions.sales ? `<p>Vendas registradas: ${data.totalSales}</p>` : ''}
          ${dashboardPermissions.purchases ? `<p>Compras registradas: ${data.totalPurchases}</p>` : ''}
          ${dashboardPermissions.stock ? `<p>Valor em estoque: R$ ${data.stockValue.toFixed(2)}</p>` : ''}
          ${(!dashboardPermissions.stock && !dashboardPermissions.sales && !dashboardPermissions.purchases) ? '<p>Sem informações disponíveis para os módulos liberados.</p>' : ''}
        </div>
      `;
      return;
    }

    if (moduleName === 'sales') {
      const sub = state.activeSub || 'orders_quotes';

      if (sub === 'orders_quotes') {
        const data = await api('/api/sales/records?view=orders_quotes');
        const records = [...(data.orders || []), ...(data.quotes || [])];
        content.innerHTML = `
          <div class="cards">
            <div class="card"><h3>Pedidos</h3><p>${data.orders?.length || 0}</p></div>
            <div class="card"><h3>Orçamentos</h3><p>${data.quotes?.length || 0}</p></div>
            <div class="card"><h3>NF-e</h3><p>${data.nfes?.length || 0}</p></div>
            <div class="card"><h3>Importações</h3><p>${data.importLogs?.length || 0}</p></div>
          </div>
          <div class="panel">
            <h3>Pedidos e Orçamentos</h3>
            <table class="table">
              <thead><tr><th>Tipo</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead>
              <tbody>
                ${records.map((record) => `<tr><td>${record.type === 'quote' ? 'Orçamento' : 'Pedido'}</td><td>${escapeHtml(record.customer)}</td><td>${escapeHtml(record.date)}</td><td>R$ ${Number(record.amount || 0).toFixed(2)}</td><td>${escapeHtml(record.status || 'pendente')}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
        return;
      }

      if (sub === 'new_order') {
        content.innerHTML = `
          <div class="panel">
            <h3>Novo Pedido</h3>
            <form id="salesOrderForm" class="form-grid">
              <div class="row">
                <label>Cliente<input name="customer" required /></label>
                <label>Data<input name="date" type="date" /></label>
                <label>Valor<input name="amount" type="number" step="0.01" required value="0" /></label>
              </div>
              <div class="row">
                <label>Status<select name="status"><option value="pendente">Pendente</option><option value="faturado">Faturado</option><option value="cancelado">Cancelado</option></select></label>
                <label>Observação<input name="note" /></label>
              </div>
              <button type="submit">Salvar pedido</button>
            </form>
          </div>
        `;
        document.getElementById('salesOrderForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          try {
            await api('/api/sales/records', {
              method: 'POST',
              body: JSON.stringify({
                type: 'order',
                customer: formData.get('customer'),
                date: formData.get('date'),
                amount: Number(formData.get('amount')),
                status: formData.get('status'),
                note: formData.get('note')
              })
            });
            showToast('Pedido salvo com sucesso.', 'success');
            state.activeSub = 'orders_quotes';
            renderApp();
            loadModule('sales');
          } catch (error) {
            showToast(error.message || 'Erro ao salvar pedido.', 'error');
          }
        });
        return;
      }

      if (sub === 'new_quote') {
        content.innerHTML = `
          <div class="panel">
            <h3>Novo Orçamento</h3>
            <form id="salesQuoteForm" class="form-grid">
              <div class="row">
                <label>Cliente<input name="customer" required /></label>
                <label>Data<input name="date" type="date" /></label>
                <label>Valor<input name="amount" type="number" step="0.01" required value="0" /></label>
              </div>
              <div class="row">
                <label>Status<select name="status"><option value="em aberto">Em aberto</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option></select></label>
                <label>Observação<input name="note" /></label>
              </div>
              <button type="submit">Salvar orçamento</button>
            </form>
          </div>
        `;
        document.getElementById('salesQuoteForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          try {
            await api('/api/sales/records', {
              method: 'POST',
              body: JSON.stringify({
                type: 'quote',
                customer: formData.get('customer'),
                date: formData.get('date'),
                amount: Number(formData.get('amount')),
                status: formData.get('status'),
                note: formData.get('note')
              })
            });
            showToast('Orcamento salvo com sucesso.', 'success');
            state.activeSub = 'orders_quotes';
            renderApp();
            loadModule('sales');
          } catch (error) {
            showToast(error.message || 'Erro ao salvar orcamento.', 'error');
          }
        });
        return;
      }

      if (sub === 'nfes') {
        const data = await api('/api/sales/records?view=nfes');
        content.innerHTML = `
          <div class="panel">
            <h3>NF-e Emitidas</h3>
            <table class="table">
              <thead><tr><th>Número</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead>
              <tbody>
                ${data.nfes.map((nfe) => `<tr><td>${escapeHtml(nfe.number || nfe.id)}</td><td>${escapeHtml(nfe.customer)}</td><td>${escapeHtml(nfe.date)}</td><td>R$ ${Number(nfe.amount || 0).toFixed(2)}</td><td>${escapeHtml(nfe.status || 'emitida')}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
        return;
      }

      if (sub === 'new_nfe') {
        content.innerHTML = `
          <div class="panel">
            <h3>Nova NF-e Avulsa</h3>
            <form id="salesNfeForm" class="form-grid">
              <div class="row">
                <label>Número<input name="number" required /></label>
                <label>Cliente<input name="customer" required /></label>
                <label>Data<input name="date" type="date" /></label>
              </div>
              <div class="row">
                <label>Valor<input name="amount" type="number" step="0.01" required value="0" /></label>
                <label>Status<select name="status"><option value="emitida">Emitida</option><option value="cancelada">Cancelada</option></select></label>
                <label>Chave<input name="key" /></label>
              </div>
              <button type="submit">Salvar NF-e</button>
            </form>
          </div>
        `;
        document.getElementById('salesNfeForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          try {
            await api('/api/sales/records', {
              method: 'POST',
              body: JSON.stringify({
                type: 'nfe',
                number: formData.get('number'),
                customer: formData.get('customer'),
                date: formData.get('date'),
                amount: Number(formData.get('amount')),
                status: formData.get('status'),
                key: formData.get('key')
              })
            });
            showToast('NF-e salva com sucesso.', 'success');
            state.activeSub = 'nfes';
            renderApp();
            loadModule('sales');
          } catch (error) {
            showToast(error.message || 'Erro ao salvar NF-e.', 'error');
          }
        });
        return;
      }

      if (sub === 'import_logs') {
        const data = await api('/api/sales/records?view=import_logs');
        content.innerHTML = `
          <div class="panel">
            <h3>Logs de Vendas Importadas</h3>
            <table class="table">
              <thead><tr><th>Origem</th><th>Tipo</th><th>Itens</th><th>Data</th></tr></thead>
              <tbody>
                ${data.importLogs.map((entry) => `<tr><td>${escapeHtml(entry.source || 'manual')}</td><td>${escapeHtml(entry.type || 'order')}</td><td>${entry.count || 0}</td><td>${escapeHtml(entry.createdAt)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
        return;
      }

      if (sub === 'order_groups') {
        content.innerHTML = `
          <div class="panel">
            <h3>Agrupamento de Pedidos</h3>
            <p class="muted">Visualize e gerencie grupos de pedidos.</p>
            <table class="table">
              <thead><tr><th>ID Grupo</th><th>Qtd. Pedidos</th><th>Valor Total</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td colspan="4" class="muted">Nenhum agrupamento salvo</td></tr>
              </tbody>
            </table>
          </div>
        `;
        return;
      }

      if (sub === 'new_order_group') {
        content.innerHTML = `
          <div class="panel">
            <h3>Novo Agrupamento de Pedidos</h3>
            <form id="orderGroupForm" class="form-grid">
              <div class="row">
                <label>Nome do agrupamento<input name="groupName" required /></label>
                <label>Descrição<input name="description" /></label>
              </div>
              <div class="row">
                <label>Pedidos (IDs separados por vírgula)<textarea name="orderIds" rows="4" placeholder="ord-1, ord-2, ord-3"></textarea></label>
              </div>
              <button type="submit">Salvar agrupamento</button>
            </form>
          </div>
        `;
        document.getElementById('orderGroupForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          showToast('Funcionalidade de agrupamento sera implementada em breve.', 'warning');
          state.activeSub = 'order_groups';
          renderApp();
          loadModule('sales');
        });
        return;
      }

      if (sub === 'returns') {
        content.innerHTML = `
          <div class="panel">
            <h3>Devoluções</h3>
            <p class="muted">Gerencie devoluções de produtos.</p>
            <table class="table">
              <thead><tr><th>ID Devolução</th><th>Pedido Original</th><th>Cliente</th><th>Data</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td colspan="5" class="muted">Nenhuma devolução registrada</td></tr>
              </tbody>
            </table>
            <div style="margin-top: 16px;">
              <button class="secondary" onclick="window.notifyToast('Registrar devolucao sera implementado em breve.', 'warning')">+ Registrar Devolução</button>
            </div>
          </div>
        `;
        return;
      }

      if (sub === 'sales_dashboard') {
        const data = await api('/api/dashboard');
        content.innerHTML = `
          <div class="cards">
            <div class="card"><h3>Vendas mês</h3><p>R$ ${(data.salesTotal || 0).toFixed(2)}</p></div>
            <div class="card"><h3>Tickets médios</h3><p>R$ ${((data.salesTotal || 0) / Math.max((data.totalSales || 1), 1)).toFixed(2)}</p></div>
            <div class="card"><h3>Pedidos pendentes</h3><p>${data.pendingReconciliation || 0}</p></div>
            <div class="card"><h3>Total de vendas</h3><p>${data.totalSales || 0}</p></div>
          </div>
          <div class="panel">
            <h3>Painel de Vendas</h3>
            <p class="muted">Acompanhamento de performance de vendas e indicadores.</p>
          </div>
        `;
        return;
      }

      if (sub === 'seller_dashboard') {
        content.innerHTML = `
          <div class="cards">
            <div class="card"><h3>Meus pedidos</h3><p>0</p></div>
            <div class="card"><h3>Total vendido</h3><p>R$ 0.00</p></div>
            <div class="card"><h3>Comissão</h3><p>R$ 0.00</p></div>
          </div>
          <div class="panel">
            <h3>Painel do Vendedor</h3>
            <p class="muted">Acompanhamento pessoal de vendas e comissões.</p>
            <table class="table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Valor</th><th>Data</th></tr></thead>
              <tbody>
                <tr><td colspan="4" class="muted">Nenhuma venda realizada</td></tr>
              </tbody>
            </table>
          </div>
        `;
        return;
      }

      if (sub === 'credits') {
        content.innerHTML = `
          <div class="panel">
            <h3>Vales de Crédito</h3>
            <p class="muted">Gerencie vales de crédito de clientes.</p>
            <table class="table">
              <thead><tr><th>Cliente</th><th>Saldo Vale</th><th>Data Emissão</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td colspan="4" class="muted">Nenhum vale registrado</td></tr>
              </tbody>
            </table>
            <div style="margin-top: 16px;">
              <button class="secondary" onclick="window.notifyToast('Emitir novo vale sera implementado em breve.', 'warning')">+ Emitir Vale</button>
            </div>
          </div>
        `;
        return;
      }

      if (sub === 'integrations') {
        content.innerHTML = `
          <div class="panel">
            <h3>Central de Integrações</h3>
            <p class="muted">Configure integrações com marketplaces e plataformas de vendas.</p>
            <div class="checkbox-grid" style="margin-top: 12px;">
              <label><input type="checkbox" disabled /> Shopify</label>
              <label><input type="checkbox" disabled /> WooCommerce</label>
              <label><input type="checkbox" disabled /> Mercado Livre</label>
              <label><input type="checkbox" disabled /> OLX</label>
              <label><input type="checkbox" disabled /> Amazon</label>
            </div>
            <p class="muted" style="margin-top: 12px;">Integrações em desenvolvimento.</p>
          </div>
        `;
        return;
      }

      if (sub === 'configure_promotions') {
        content.innerHTML = `
          <div class="panel">
            <h3>Configurar Promoções</h3>
            <p class="muted">Gerenciador de promoções e descontos.</p>
            <table class="table">
              <thead><tr><th>ID Promoção</th><th>Descrição</th><th>Desconto</th><th>Validade</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td colspan="5" class="muted">Nenhuma promoção configurada</td></tr>
              </tbody>
            </table>
            <div style="margin-top: 16px;">
              <button class="secondary" onclick="state.activeSub='new_promotion'; renderApp(); loadModule('sales');">+ Nova Promoção</button>
            </div>
          </div>
        `;
        return;
      }

      if (sub === 'new_promotion') {
        content.innerHTML = `
          <div class="panel">
            <h3>Nova Promoção</h3>
            <form id="promotionForm" class="form-grid">
              <div class="row">
                <label>Nome da promoção<input name="promoName" required /></label>
                <label>Código<input name="promoCode" required /></label>
              </div>
              <div class="row">
                <label>Tipo<select name="promoType"><option value="desconto-percentual">Desconto percentual</option><option value="desconto-fixo">Desconto fixo</option><option value="frete-gratis">Frete grátis</option></select></label>
                <label>Valor<input name="promoValue" type="number" step="0.01" required /></label>
              </div>
              <div class="row">
                <label>Data inicial<input name="startDate" type="date" required /></label>
                <label>Data final<input name="endDate" type="date" required /></label>
              </div>
              <div class="row">
                <label>Descrição<textarea name="description" rows="3" placeholder="Descrição da promoção..."></textarea></label>
              </div>
              <button type="submit">Salvar promoção</button>
            </form>
          </div>
        `;
        document.getElementById('promotionForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          showToast('Promocao salva com sucesso!', 'success');
          state.activeSub = 'configure_promotions';
          renderApp();
          loadModule('sales');
        });
        return;
      }

      if (sub === 'import_sales') {
        const data = await api('/api/sales/records?view=import_logs');
        content.innerHTML = `
          <div class="panel">
            <h3>Importar Vendas</h3>
            <p class="muted">Cole um CSV simples com colunas: customer,date,amount,status</p>
            <form id="salesImportForm" class="form-grid">
              <textarea name="csvText" rows="6" placeholder="customer,date,amount,status\nCliente A,2026-01-10,1200.00,pendente\nCliente B,2026-01-11,2500.00,faturado"></textarea>
              <div class="row">
                <label>Tipo<select name="importType"><option value="order">Pedido</option><option value="quote">Orçamento</option><option value="nfe">NF-e</option></select></label>
                <label>Origem<input name="source" value="importacao-csv" /></label>
              </div>
              <button type="submit">Importar</button>
            </form>
          </div>
          <div class="panel">
            <h3>Histórico de Importações</h3>
            <table class="table">
              <thead><tr><th>Origem</th><th>Tipo</th><th>Itens</th><th>Data</th></tr></thead>
              <tbody>
                ${data.importLogs.map((entry) => `<tr><td>${escapeHtml(entry.source || 'manual')}</td><td>${escapeHtml(entry.type || 'order')}</td><td>${entry.count || 0}</td><td>${escapeHtml(entry.createdAt)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
        document.getElementById('salesImportForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          try {
            await api('/api/sales/import', {
              method: 'POST',
              body: JSON.stringify({
                type: formData.get('importType'),
                source: formData.get('source'),
                text: formData.get('csvText')
              })
            });
            showToast('Importacao realizada com sucesso.', 'success');
            loadModule('sales');
          } catch (error) {
            showToast(error.message || 'Erro ao importar vendas.', 'error');
          }
        });
        return;
      }

      content.innerHTML = `
        <div class="panel">
          <h3>Em breve</h3>
          <p class="muted">Esta área ainda será detalhada com o tempo.</p>
        </div>
      `;
      return;
    }

    if (moduleName === 'cadastros') {
      const [peopleResponse, cnpjsResponse] = await Promise.all([
        api('/api/cadastros/pessoas'),
        api('/api/cadastros/cnpjs')
      ]);
      const rawSub = state.activeSub || 'list';
      const sub = rawSub === 'edit' ? 'edit' : (rawSub === 'register' ? 'register' : 'list');
      const people = Array.isArray(peopleResponse.people) ? peopleResponse.people : [];
      const cnpjs = Array.isArray(cnpjsResponse.cnpjs) ? cnpjsResponse.cnpjs : [];
      const peopleDraft = state.cadastroDraft.people || {};
      const cnpjDraft = state.cadastroDraft.cnpjs || {};
      const listFilters = {
        show: Boolean(state.cadastroDraft.listFilters?.show),
        type: state.cadastroDraft.listFilters?.type || 'all',
        status: state.cadastroDraft.listFilters?.status || 'all',
        query: state.cadastroDraft.listFilters?.query || '',
        nameFantasy: state.cadastroDraft.listFilters?.nameFantasy || '',
        corporateName: state.cadastroDraft.listFilters?.corporateName || '',
        uniqueCode: state.cadastroDraft.listFilters?.uniqueCode || '',
        email: state.cadastroDraft.listFilters?.email || '',
        categoryRole: state.cadastroDraft.listFilters?.categoryRole || 'all',
        document: state.cadastroDraft.listFilters?.document || '',
        city: state.cadastroDraft.listFilters?.city || '',
        zipCode: state.cadastroDraft.listFilters?.zipCode || '',
        uf: state.cadastroDraft.listFilters?.uf || '',
        group: state.cadastroDraft.listFilters?.group || '',
        defaultCarrier: state.cadastroDraft.listFilters?.defaultCarrier || '',
        showClients: state.cadastroDraft.listFilters?.showClients ?? true,
        showSuppliers: state.cadastroDraft.listFilters?.showSuppliers ?? true,
        showTechnicians: state.cadastroDraft.listFilters?.showTechnicians ?? true,
        showCollaborators: state.cadastroDraft.listFilters?.showCollaborators ?? true,
        showTransporters: state.cadastroDraft.listFilters?.showTransporters ?? true,
        showSellers: state.cadastroDraft.listFilters?.showSellers ?? true,
        showLeaders: state.cadastroDraft.listFilters?.showLeaders ?? true,
        showManagers: state.cadastroDraft.listFilters?.showManagers ?? true,
        showRepresented: state.cadastroDraft.listFilters?.showRepresented ?? true,
        showCredenciadoras: state.cadastroDraft.listFilters?.showCredenciadoras ?? true,
        showManufacturers: state.cadastroDraft.listFilters?.showManufacturers ?? true,
        onlyInactive: state.cadastroDraft.listFilters?.onlyInactive ?? false,
        dateStart: state.cadastroDraft.listFilters?.dateStart || '',
        dateEnd: state.cadastroDraft.listFilters?.dateEnd || ''
      };

      const formatDate = (value) => {
        if (!value) return '-';
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString('pt-BR');
      };

      const roles = [
        'Cliente', 'Transportadora', 'Tecnico', 'Fornecedor', 'Colaborador', 'Representada', 'Vendedor', 'Líder', 'Gerente', 'Credenciadora', 'Fabricante'
      ];

      const section = (title, body, description = '') => `
        <section class="cadastro-section">
          <div class="cadastro-section-header">
            <div>
              <h4>${title}</h4>
              ${description ? `<p>${description}</p>` : ''}
            </div>
          </div>
          <div class="cadastro-section-body">${body}</div>
        </section>
      `;

      const field = (label, name, value = '', attrs = '') => `
        <label class="cadastro-field">
          <span>${label}</span>
          <input name="${name}" value="${escapeHtml(value)}" ${attrs} />
        </label>
      `;

      const selectField = (label, name, value, options = [], attrs = '') => `
        <label class="cadastro-field">
          <span>${label}</span>
          <select name="${name}" ${attrs}>
            ${options.map((option) => `<option value="${option.value}" ${option.value === value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
        </label>
      `;

      const checkbox = (name, labelText, checked = false, value = '') => `
        <label class="cadastro-check">
          <input type="checkbox" name="${name}" ${value ? `value="${escapeHtml(value)}"` : ''} ${checked ? 'checked' : ''} />
          <span>${labelText}</span>
        </label>
      `;

      const renderPeopleRegister = (mode = 'register') => {
        const isEditMode = mode === 'edit';
        const documentType = getDocumentType(peopleDraft.document);
        const selectedType = peopleDraft.type || (documentType === 'cnpj' ? 'pessoa-juridica' : 'pessoa-fisica');
        const documentValue = maskDocumentValue(peopleDraft.document || '', selectedType);
        const canLookupCnpj = sanitizeDigits(peopleDraft.document || '').length === 14;

        return `
          <div class="panel cadastros-shell">
            <div class="cadastro-page-head">
              <div>
                <h3>${isEditMode ? 'Edição de cadastro' : 'Cadastro de pessoas'}</h3>
                <p class="muted">${isEditMode ? 'Tela exclusiva para atualização de cadastros existentes.' : 'Padronizado para pessoa física e jurídica, com validação de documento.'}</p>
              </div>
              <div class="cadastro-page-chip">${isEditMode ? 'Edição' : 'Dados básicos'}</div>
            </div>
            <form id="peopleRegisterForm" class="cadastro-form">
              ${section('Nome ou razão social', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Nome ou razão social', 'name', peopleDraft.name || '', 'required')}
                  ${field('Nome fantasia', 'tradeName', peopleDraft.tradeName || '')}
                  <label class="cadastro-field cadastro-field-inline">
                    <span>CPF / CNPJ</span>
                    <div class="cadastro-inline-action">
                      <input name="document" value="${escapeHtml(documentValue)}" id="peopleDocumentInput" inputmode="numeric" maxlength="18" required />
                      <button type="button" id="peopleLookupBtn" class="icon-button edit" ${canLookupCnpj ? '' : 'disabled'} title="Consultar CNPJ" aria-label="Consultar CNPJ">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                      </button>
                    </div>
                  </label>
                </div>
                <div class="cadastro-grid cadastro-grid-3 cadastro-align-bottom">
                  ${selectField('Tipo de pessoa', 'type', selectedType, [
                    { value: 'pessoa-fisica', label: 'Pessoa física' },
                    { value: 'pessoa-juridica', label: 'Pessoa jurídica' }
                  ])}
                  ${field('E-mail geral', 'email', peopleDraft.email || '', 'type="email"')}
                  ${field('Telefone', 'phone', peopleDraft.phone || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('E-mail secundários', 'secondaryEmails', peopleDraft.secondaryEmails || '')}
                  ${field('Whatsapp', 'whatsapp', peopleDraft.whatsapp || '')}
                  ${field('Telefone celular', 'mobilePhone', peopleDraft.mobilePhone || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-2">
                  ${field('Transportadora padrão', 'defaultCarrier', peopleDraft.defaultCarrier || '')}
                  ${selectField('Status', 'status', peopleDraft.status || 'ativo', [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }])}
                </div>
                ${peopleDraft.error ? `<p class="form-error">${escapeHtml(peopleDraft.error)}</p>` : ''}
              `, 'Dados principais do cliente ou parceiro.')}

              ${section('Relação com a empresa', `
                <div class="cadastro-check-grid">
                  ${roles.map((role) => checkbox('roles', role, Array.isArray(peopleDraft.roles) && peopleDraft.roles.includes(role), role)).join('')}
                </div>
              `)}

              ${section('Mais dados', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Grupo', 'group', peopleDraft.group || '')}
                  ${field('RG', 'rg', peopleDraft.rg || '')}
                  ${field('Órgão expedidor', 'issuerBody', peopleDraft.issuerBody || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Data de expedição', 'issueDate', peopleDraft.issueDate || '', 'type="date"')}
                  ${field('UF emissor', 'issuerState', peopleDraft.issuerState || '')}
                  ${checkbox('ruralProducer', 'Produtor rural', Boolean(peopleDraft.ruralProducer))}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Inscrição estadual', 'stateRegistration', peopleDraft.stateRegistration || '')}
                  ${field('Inscrição municipal', 'municipalRegistration', peopleDraft.municipalRegistration || '')}
                  ${field('Inscrição na SUFRAMA', 'suframaRegistration', peopleDraft.suframaRegistration || '')}
                </div>
              `)}

              ${section('Endereço', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${checkbox('foreignAddress', 'Endereço no exterior', Boolean(peopleDraft.foreignAddress))}
                  ${checkbox('billingDifferent', 'Endereço de cobrança diferente', Boolean(peopleDraft.billingDifferent))}
                  ${checkbox('deliveryDifferent', 'Endereço de entrega diferente', Boolean(peopleDraft.deliveryDifferent))}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('CEP', 'zipCode', peopleDraft.zipCode || '')}
                  ${field('Logradouro', 'street', peopleDraft.street || '')}
                  ${field('Número', 'streetNumber', peopleDraft.streetNumber || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Complemento', 'addressComplement', peopleDraft.addressComplement || '')}
                  ${field('Bairro', 'neighborhood', peopleDraft.neighborhood || '')}
                  ${field('Cidade', 'city', peopleDraft.city || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('UF', 'state', peopleDraft.state || '')}
                  ${field('Cód. Cidade (IBGE)', 'ibgeCityCode', peopleDraft.ibgeCityCode || '')}
                  ${field('País', 'country', peopleDraft.country || 'Brasil')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Cód. País', 'countryCode', peopleDraft.countryCode || '1058')}
                  ${field('Link de localização no mapa', 'mapLink', peopleDraft.mapLink || '')}
                </div>
              `)}

              ${section('Dados financeiros / Contas bancárias', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Limite de crédito', 'creditLimit', peopleDraft.creditLimit || '')}
                  ${field('Crédito utilizado', 'creditUsed', peopleDraft.creditUsed || '')}
                  ${field('Periodicidade venda/compra (dias)', 'paymentPeriodDays', peopleDraft.paymentPeriodDays || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Valor mínimo de compra', 'minPurchaseValue', peopleDraft.minPurchaseValue || '')}
                  ${field('Tabela de preço padrão', 'defaultPriceTable', peopleDraft.defaultPriceTable || '')}
                  ${field('Forma de pagamento', 'paymentMethod', peopleDraft.paymentMethod || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('CPF/CNPJ da conta', 'bankDocument', peopleDraft.bankDocument || '')}
                  ${field('Banco', 'bankName', peopleDraft.bankName || '')}
                  ${field('Agência', 'bankAgency', peopleDraft.bankAgency || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Dígito da agência', 'bankAgencyDigit', peopleDraft.bankAgencyDigit || '')}
                  ${field('Número da conta', 'bankNumber', peopleDraft.bankNumber || '')}
                  ${field('Dígito da conta', 'bankNumberDigit', peopleDraft.bankNumberDigit || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Período', 'bankPeriod', peopleDraft.bankPeriod || '')}
                  <div class="cadastro-add-account">
                    <button type="button">Adicionar conta</button>
                  </div>
                </div>
              `)}

              ${section('Informações adicionais', `
                <label class="cadastro-field cadastro-field-full">
                  <span>Observações</span>
                  <textarea name="notes">${escapeHtml(peopleDraft.notes || '')}</textarea>
                </label>
              `)}

              <div class="cadastro-actions">
                <button type="submit">Salvar pessoa</button>
              </div>
            </form>
          </div>
        `;
      };

      const renderPeopleList = () => `
        <div class="panel cadastros-shell">
          <div class="cadastro-page-head">
            <div>
              <h3>Pessoas</h3>
              <p class="muted">Histórico dos cadastros de pessoas.</p>
            </div>
            <div class="cadastro-page-chip">Histórico</div>
          </div>
          ${people.length ? `
            <table class="table table-actions">
              <thead><tr><th>Nome / Razão social</th><th>Documento</th><th>Tipo</th><th>E-mail</th><th>Telefone</th><th>Status</th><th>Cadastrado em</th><th>Ações</th></tr></thead>
              <tbody>
                ${people.map((person) => `
                  <tr>
                    <td>${escapeHtml(person.name || '')}</td>
                    <td>${escapeHtml(formatCpfCnpj(person.document || ''))}</td>
                    <td>${escapeHtml(person.type === 'pessoa-juridica' ? 'Pessoa jurídica' : 'Pessoa física')}</td>
                    <td>${escapeHtml(person.email || '')}</td>
                    <td>${escapeHtml(person.phone || '')}</td>
                    <td>${escapeHtml(person.status || 'ativo')}</td>
                    <td>${escapeHtml(formatDate(person.createdAt))}</td>
                    <td>
                      <button class="icon-button edit cadastro-edit-person" data-id="${escapeHtml(person.id || '')}" title="Editar" aria-label="Editar pessoa">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                      </button>
                      <button class="icon-button cadastro-delete-person" data-id="${escapeHtml(person.id || '')}" title="Excluir" aria-label="Excluir pessoa">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p class="muted">Nenhuma pessoa cadastrada ainda.</p>'}
        </div>
      `;

      const renderCnpjRegister = () => {
        const documentValue = maskDocumentValue(cnpjDraft.document || '', 'pessoa-juridica');
        const canLookupCnpj = sanitizeDigits(cnpjDraft.document || '').length === 14;

        return `
          <div class="panel cadastros-shell">
            <div class="cadastro-page-head">
              <div>
                <h3>Cadastro de CNPJ's</h3>
                <p class="muted">Consulta o CNPJ na API e preenche os dados da empresa automaticamente.</p>
              </div>
              <div class="cadastro-page-chip">Pessoa jurídica</div>
            </div>
            <form id="cnpjRegisterForm" class="cadastro-form">
              ${section('Nome ou razão social', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Nome ou razão social', 'name', cnpjDraft.name || '', 'required')}
                  ${field('Nome fantasia', 'tradeName', cnpjDraft.tradeName || '')}
                  ${selectField('Tipo de pessoa', 'type', 'pessoa-juridica', [{ value: 'pessoa-juridica', label: 'Pessoa jurídica' }], 'disabled')}
                </div>
                <div class="cadastro-grid cadastro-grid-3 cadastro-align-bottom">
                  ${field('CNPJ', 'document', documentValue, 'id="cnpjDocumentInput" inputmode="numeric" maxlength="18" required')}
                  ${field('E-mail geral', 'email', cnpjDraft.email || '', 'type="email"')}
                  ${field('Telefone', 'phone', cnpjDraft.phone || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('E-mail secundários', 'secondaryEmails', cnpjDraft.secondaryEmails || '')}
                  ${field('Whatsapp', 'whatsapp', cnpjDraft.whatsapp || '')}
                  ${field('Telefone celular', 'mobilePhone', cnpjDraft.mobilePhone || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-2">
                  ${field('Transportadora padrão', 'defaultCarrier', cnpjDraft.defaultCarrier || '')}
                  ${selectField('Status', 'status', cnpjDraft.status || 'ativo', [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }])}
                </div>
                <div class="cadastro-grid cadastro-grid-1">
                  <div class="cadastro-help-row">
                    <span>${cnpjDraft.validationMessage ? escapeHtml(cnpjDraft.validationMessage) : 'Consulte o CNPJ para validar e preencher os dados oficiais.'}</span>
                    <button type="button" id="consultCnpjBtn" ${canLookupCnpj ? '' : 'disabled'}>Consultar CNPJ</button>
                  </div>
                </div>
                ${cnpjDraft.error ? `<p class="form-error">${escapeHtml(cnpjDraft.error)}</p>` : ''}
              `, 'Dados principais da empresa.')}

              ${section('Mais dados', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Grupo', 'group', cnpjDraft.group || '')}
                  ${field('CNAE principal', 'mainCnae', cnpjDraft.mainCnae || '')}
                  ${field('Situação cadastral', 'registrationStatus', cnpjDraft.registrationStatus || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Data de abertura', 'openingDate', cnpjDraft.openingDate || '', 'type="date"')}
                  ${field('Inscrição estadual', 'stateRegistration', cnpjDraft.stateRegistration || '')}
                  ${field('Inscrição municipal', 'municipalRegistration', cnpjDraft.municipalRegistration || '')}
                </div>
              `)}

              ${section('Endereço', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('CEP', 'zipCode', cnpjDraft.zipCode || '')}
                  ${field('Logradouro', 'address', cnpjDraft.address || '')}
                  ${field('Número', 'addressNumber', cnpjDraft.addressNumber || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Complemento', 'addressComplement', cnpjDraft.addressComplement || '')}
                  ${field('Bairro', 'neighborhood', cnpjDraft.neighborhood || '')}
                  ${field('Cidade', 'city', cnpjDraft.city || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('UF', 'state', cnpjDraft.state || '')}
                  ${field('Cód. Cidade (IBGE)', 'ibgeCityCode', cnpjDraft.ibgeCityCode || '')}
                  ${field('País', 'country', cnpjDraft.country || 'Brasil')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Cód. País', 'countryCode', cnpjDraft.countryCode || '1058')}
                  ${field('Link de localização no mapa', 'mapLink', cnpjDraft.mapLink || '')}
                  ${checkbox('deliveryDifferent', 'Endereço de entrega diferente', Boolean(cnpjDraft.deliveryDifferent))}
                </div>
              `)}

              ${section('Dados financeiros / Contas bancárias', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Limite de crédito', 'creditLimit', cnpjDraft.creditLimit || '')}
                  ${field('Crédito utilizado', 'creditUsed', cnpjDraft.creditUsed || '')}
                  ${field('Periodicidade venda/compra (dias)', 'paymentPeriodDays', cnpjDraft.paymentPeriodDays || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Valor mínimo de compra', 'minPurchaseValue', cnpjDraft.minPurchaseValue || '')}
                  ${field('Tabela de preço padrão', 'defaultPriceTable', cnpjDraft.defaultPriceTable || '')}
                  ${field('Forma de pagamento', 'paymentMethod', cnpjDraft.paymentMethod || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('CPF/CNPJ da conta', 'bankDocument', cnpjDraft.bankDocument || '')}
                  ${field('Banco', 'bankName', cnpjDraft.bankName || '')}
                  ${field('Agência', 'bankAgency', cnpjDraft.bankAgency || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Dígito da agência', 'bankAgencyDigit', cnpjDraft.bankAgencyDigit || '')}
                  ${field('Número da conta', 'bankNumber', cnpjDraft.bankNumber || '')}
                  ${field('Dígito da conta', 'bankNumberDigit', cnpjDraft.bankNumberDigit || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Período', 'bankPeriod', cnpjDraft.bankPeriod || '')}
                  <div class="cadastro-add-account">
                    <button type="button">Adicionar conta</button>
                  </div>
                </div>
              `)}

              ${section('Informações adicionais', `
                <label class="cadastro-field cadastro-field-full">
                  <span>Observações</span>
                  <textarea name="notes">${escapeHtml(cnpjDraft.notes || '')}</textarea>
                </label>
              `)}

              <div class="cadastro-actions">
                <button type="submit">Salvar CNPJ</button>
              </div>
            </form>
          </div>
        `;
      };

      const renderCnpjList = () => `
        <div class="panel cadastros-shell">
          <div class="cadastro-page-head">
            <div>
              <h3>CNPJ's</h3>
              <p class="muted">Histórico dos cadastros de empresas.</p>
            </div>
            <div class="cadastro-page-chip">Histórico</div>
          </div>
          ${cnpjs.length ? `
            <table class="table table-actions">
              <thead><tr><th>Razão social</th><th>Fantasia</th><th>CNPJ</th><th>E-mail</th><th>Telefone</th><th>Status</th><th>Cadastrado em</th><th>Ações</th></tr></thead>
              <tbody>
                ${cnpjs.map((company) => `
                  <tr>
                    <td>${escapeHtml(company.name || '')}</td>
                    <td>${escapeHtml(company.tradeName || '')}</td>
                    <td>${escapeHtml(formatCpfCnpj(company.document || ''))}</td>
                    <td>${escapeHtml(company.email || '')}</td>
                    <td>${escapeHtml(company.phone || '')}</td>
                    <td>${escapeHtml(company.status || 'ativo')}</td>
                    <td>${escapeHtml(formatDate(company.createdAt))}</td>
                    <td>
                      <button class="icon-button edit cadastro-edit-cnpj" data-id="${escapeHtml(company.id || '')}" title="Editar" aria-label="Editar CNPJ">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                      </button>
                      <button class="icon-button cadastro-delete-cnpj" data-id="${escapeHtml(company.id || '')}" title="Excluir" aria-label="Excluir CNPJ">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p class="muted">Nenhum CNPJ cadastrado ainda.</p>'}
        </div>
      `;

      const renderUnifiedRegister = () => renderPeopleRegister('register');

      const renderUnifiedEdit = () => renderPeopleRegister('edit');

      const renderUnifiedList = () => {
        const normalize = (value) => String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('pt-BR')
          .trim();
        const query = normalize(listFilters.query).trim();
        const includesText = (fieldValue, filterValue) => normalize(fieldValue).includes(normalize(filterValue).trim());
        const roleVisibleMap = [
          { role: 'Cliente', enabled: listFilters.showClients },
          { role: 'Fornecedor', enabled: listFilters.showSuppliers },
          { role: 'Tecnico', enabled: listFilters.showTechnicians },
          { role: 'Colaborador', enabled: listFilters.showCollaborators },
          { role: 'Transportadora', enabled: listFilters.showTransporters },
          { role: 'Vendedor', enabled: listFilters.showSellers },
          { role: 'Líder', enabled: listFilters.showLeaders },
          { role: 'Gerente', enabled: listFilters.showManagers },
          { role: 'Representada', enabled: listFilters.showRepresented },
          { role: 'Credenciadora', enabled: listFilters.showCredenciadoras },
          { role: 'Fabricante', enabled: listFilters.showManufacturers }
        ];

        const merged = [
          ...people.map((person) => ({
            kind: 'people',
            id: person.id,
            cadastroTipo: person.type === 'pessoa-juridica' ? 'Pessoa juridica' : 'Pessoa fisica',
            name: person.name || '',
            tradeName: person.tradeName || '',
            document: person.document || '',
            registrationStatus: person.registrationStatus || '',
            email: person.email || '',
            phone: person.phone || '',
            status: person.status || 'ativo',
            city: person.city || '',
            zipCode: person.zipCode || '',
            state: person.state || '',
            group: person.group || '',
            defaultCarrier: person.defaultCarrier || '',
            roles: Array.isArray(person.roles) ? person.roles : [],
            createdAt: person.createdAt || ''
          })),
          ...cnpjs.map((company) => ({
            kind: 'cnpj',
            id: company.id,
            cadastroTipo: 'CNPJ',
            name: company.name || '',
            tradeName: company.tradeName || '',
            document: company.document || '',
            registrationStatus: company.registrationStatus || '',
            email: company.email || '',
            phone: company.phone || '',
            status: company.status || 'ativo',
            city: company.city || '',
            zipCode: company.zipCode || '',
            state: company.state || '',
            group: company.group || '',
            defaultCarrier: company.defaultCarrier || '',
            roles: Array.isArray(company.roles) ? company.roles : [],
            createdAt: company.createdAt || ''
          }))
        ]
          .filter((row) => {
            const normalizedRoles = (Array.isArray(row.roles) ? row.roles : []).map(normalize).filter(Boolean);
            const hasLegacyWildcardRole = normalizedRoles.includes('on');
            const hasRole = (roleName) => hasLegacyWildcardRole || normalizedRoles.includes(normalize(roleName));

            if (listFilters.type === 'people' && row.kind !== 'people') return false;
            if (listFilters.type === 'cnpj' && row.kind !== 'cnpj') return false;
            if (listFilters.status !== 'all' && normalize(row.status) !== normalize(listFilters.status)) return false;
            if (listFilters.onlyInactive && normalize(row.status) !== 'inativo') return false;

            if (listFilters.nameFantasy && !includesText(`${row.name} ${row.tradeName}`, listFilters.nameFantasy)) return false;
            if (listFilters.corporateName && !includesText(row.name, listFilters.corporateName)) return false;
            if (listFilters.uniqueCode && !includesText(row.id, listFilters.uniqueCode)) return false;
            if (listFilters.email && !includesText(row.email, listFilters.email)) return false;
            if (listFilters.document && !includesText(sanitizeDigits(row.document), sanitizeDigits(listFilters.document))) return false;
            if (listFilters.city && !includesText(row.city, listFilters.city)) return false;
            if (listFilters.zipCode && !includesText(sanitizeDigits(row.zipCode), sanitizeDigits(listFilters.zipCode))) return false;
            if (listFilters.uf && !includesText(row.state, listFilters.uf)) return false;
            if (listFilters.group && !includesText(row.group, listFilters.group)) return false;
            if (listFilters.defaultCarrier && !includesText(row.defaultCarrier, listFilters.defaultCarrier)) return false;

            if (listFilters.categoryRole !== 'all') {
              if (!hasRole(listFilters.categoryRole)) return false;
            }

            if (listFilters.dateStart) {
              const created = new Date(row.createdAt || '');
              const start = new Date(`${listFilters.dateStart}T00:00:00`);
              if (!Number.isNaN(created.getTime()) && created < start) return false;
            }
            if (listFilters.dateEnd) {
              const created = new Date(row.createdAt || '');
              const end = new Date(`${listFilters.dateEnd}T23:59:59`);
              if (!Number.isNaN(created.getTime()) && created > end) return false;
            }

            const hiddenRoles = roleVisibleMap.filter((entry) => !entry.enabled).map((entry) => entry.role);
            if (hiddenRoles.length && !hasLegacyWildcardRole && hiddenRoles.some((hidden) => hasRole(hidden))) {
              return false;
            }

            if (!query) return true;
            return [
              row.name,
              row.tradeName,
              row.document,
              row.email,
              row.phone,
              row.cadastroTipo,
              row.registrationStatus,
              row.city,
              row.state,
              row.group,
              row.id
            ].some((field) => normalize(field).includes(query));
          })
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        return `
          <div class="panel cadastros-shell">
            <div class="cadastro-page-head">
              <div>
                <h3>Cadastros</h3>
                <p class="muted">Consulta unificada de Pessoas e CNPJ's.</p>
              </div>
              <div class="cadastro-list-actions">
                <button type="button" class="success" id="cadastroNewBtn">+ Novo cadastro</button>
                <button type="button" class="secondary" id="cadastroFilterToggleBtn">Filtros</button>
              </div>
            </div>

            ${listFilters.show ? `
              <form id="cadastroFilterForm" class="cadastro-filter-panel">
                <div class="cadastro-filter-grid-5">
                  <label class="cadastro-field">
                    <span>Nome / Nome fantasia</span>
                    <input name="nameFantasy" value="${escapeHtml(listFilters.nameFantasy)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Razao social</span>
                    <input name="corporateName" value="${escapeHtml(listFilters.corporateName)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Codigo identificador unico</span>
                    <input name="uniqueCode" value="${escapeHtml(listFilters.uniqueCode)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>E-mail</span>
                    <input name="email" value="${escapeHtml(listFilters.email)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Categoria razao social</span>
                    <select name="categoryRole">
                      <option value="all" ${listFilters.categoryRole === 'all' ? 'selected' : ''}>Selecione</option>
                      ${roles.map((role) => `<option value="${escapeHtml(role)}" ${listFilters.categoryRole === role ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('')}
                    </select>
                  </label>

                  <label class="cadastro-field">
                    <span>CNPJ/CPF</span>
                    <input name="document" value="${escapeHtml(listFilters.document)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Cidade</span>
                    <input name="city" value="${escapeHtml(listFilters.city)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>CEP</span>
                    <input name="zipCode" value="${escapeHtml(listFilters.zipCode)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>UF</span>
                    <input name="uf" value="${escapeHtml(listFilters.uf)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Grupo</span>
                    <input name="group" value="${escapeHtml(listFilters.group)}" />
                  </label>

                  <label class="cadastro-field">
                    <span>Vendedor padrao</span>
                    <input name="defaultCarrier" value="${escapeHtml(listFilters.defaultCarrier)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Tipo</span>
                    <select name="type">
                      <option value="all" ${listFilters.type === 'all' ? 'selected' : ''}>Todos</option>
                      <option value="people" ${listFilters.type === 'people' ? 'selected' : ''}>Pessoas</option>
                      <option value="cnpj" ${listFilters.type === 'cnpj' ? 'selected' : ''}>CNPJ's</option>
                    </select>
                  </label>
                  <label class="cadastro-field">
                    <span>Status</span>
                    <select name="status">
                      <option value="all" ${listFilters.status === 'all' ? 'selected' : ''}>Todos</option>
                      <option value="ativo" ${listFilters.status === 'ativo' ? 'selected' : ''}>Ativo</option>
                      <option value="inativo" ${listFilters.status === 'inativo' ? 'selected' : ''}>Inativo</option>
                    </select>
                  </label>
                  <label class="cadastro-field">
                    <span>Data inicial</span>
                    <input type="date" name="dateStart" value="${escapeHtml(listFilters.dateStart)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Data final</span>
                    <input type="date" name="dateEnd" value="${escapeHtml(listFilters.dateEnd)}" />
                  </label>
                </div>

                <div class="cadastro-filter-toggle-list">
                  <label><input type="checkbox" name="showClients" ${listFilters.showClients ? 'checked' : ''} /> Exibir Clientes</label>
                  <label><input type="checkbox" name="showSuppliers" ${listFilters.showSuppliers ? 'checked' : ''} /> Exibir Fornecedores</label>
                  <label><input type="checkbox" name="showTechnicians" ${listFilters.showTechnicians ? 'checked' : ''} /> Exibir Tecnicos</label>
                  <label><input type="checkbox" name="showCollaborators" ${listFilters.showCollaborators ? 'checked' : ''} /> Exibir Colaboradores</label>
                  <label><input type="checkbox" name="showTransporters" ${listFilters.showTransporters ? 'checked' : ''} /> Exibir Transportadoras</label>
                  <label><input type="checkbox" name="showSellers" ${listFilters.showSellers ? 'checked' : ''} /> Exibir Vendedores</label>
                  <label><input type="checkbox" name="showLeaders" ${listFilters.showLeaders ? 'checked' : ''} /> Exibir Lideres</label>
                  <label><input type="checkbox" name="showManagers" ${listFilters.showManagers ? 'checked' : ''} /> Exibir Gerentes</label>
                  <label><input type="checkbox" name="showRepresented" ${listFilters.showRepresented ? 'checked' : ''} /> Exibir Representadas</label>
                  <label><input type="checkbox" name="showCredenciadoras" ${listFilters.showCredenciadoras ? 'checked' : ''} /> Exibir Credenciadoras</label>
                  <label><input type="checkbox" name="showManufacturers" ${listFilters.showManufacturers ? 'checked' : ''} /> Exibir Fabricantes</label>
                  <label><input type="checkbox" name="onlyInactive" ${listFilters.onlyInactive ? 'checked' : ''} /> Somente inativos</label>
                </div>

                <label class="cadastro-field cadastro-field-full">
                  <span>Busca</span>
                  <input name="query" value="${escapeHtml(listFilters.query)}" placeholder="Nome, documento, email ou telefone" />
                </label>
                <div class="cadastro-filter-actions">
                  <button type="submit" id="cadastroFilterApplyBtn">Buscar</button>
                  <button type="button" class="secondary" id="cadastroFilterClearBtn">Limpar filtros</button>
                </div>
              </form>
            ` : ''}

            ${merged.length ? `
              <table class="table table-actions">
                <thead><tr><th>Tipo</th><th>Nome / Razão social</th><th>Fantasia</th><th>Documento</th><th>E-mail</th><th>Telefone</th><th>Status</th><th>Cadastrado em</th><th>Ações</th></tr></thead>
                <tbody>
                  ${merged.map((row) => `
                    <tr>
                      <td>${escapeHtml(row.cadastroTipo)}</td>
                      <td>${escapeHtml(row.name)}</td>
                      <td>${escapeHtml(row.tradeName || '-')}</td>
                      <td>${escapeHtml(formatCpfCnpj(row.document || ''))}</td>
                      <td>${escapeHtml(row.email || '-')}</td>
                      <td>${escapeHtml(row.phone || '-')}</td>
                      <td>${escapeHtml(row.status || 'ativo')}</td>
                      <td>${escapeHtml(formatDate(row.createdAt))}</td>
                      <td>
                        <button class="icon-button edit cadastro-edit-row" data-kind="${row.kind}" data-id="${escapeHtml(row.id || '')}" title="Editar" aria-label="Editar cadastro">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                        </button>
                        <button class="icon-button cadastro-delete-row" data-kind="${row.kind}" data-id="${escapeHtml(row.id || '')}" title="Excluir" aria-label="Excluir cadastro">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<p class="muted">Nenhum registro encontrado para os filtros aplicados.</p>'}
          </div>
        `;
      };

      const pages = {
        register: renderUnifiedRegister,
        edit: renderUnifiedEdit,
        list: renderUnifiedList
      };

      content.innerHTML = (pages[sub] || renderUnifiedRegister)();

      document.getElementById('cadastroNewBtn')?.addEventListener('click', () => {
        state.cadastroDraft = {
          ...state.cadastroDraft,
          activeType: 'people',
          people: {}
        };
        state.activeSub = 'register';
        renderApp();
        loadModule('cadastros');
      });

      document.getElementById('cadastroFilterToggleBtn')?.addEventListener('click', () => {
        state.cadastroDraft = {
          ...state.cadastroDraft,
          listFilters: {
            ...listFilters,
            show: !listFilters.show
          }
        };
        state.activeSub = 'list';
        renderApp();
        loadModule('cadastros');
      });

      const cadastroFilterForm = document.getElementById('cadastroFilterForm');
      const applyUnifiedFilters = () => {
        if (!cadastroFilterForm) return;
        const data = new FormData(cadastroFilterForm);
        state.cadastroDraft = {
          ...state.cadastroDraft,
          listFilters: {
            show: true,
            type: String(data.get('type') || 'all'),
            status: String(data.get('status') || 'all'),
            query: String(data.get('query') || '').trim(),
            nameFantasy: String(data.get('nameFantasy') || '').trim(),
            corporateName: String(data.get('corporateName') || '').trim(),
            uniqueCode: String(data.get('uniqueCode') || '').trim(),
            email: String(data.get('email') || '').trim(),
            categoryRole: String(data.get('categoryRole') || 'all'),
            document: String(data.get('document') || '').trim(),
            city: String(data.get('city') || '').trim(),
            zipCode: String(data.get('zipCode') || '').trim(),
            uf: String(data.get('uf') || '').trim(),
            group: String(data.get('group') || '').trim(),
            defaultCarrier: String(data.get('defaultCarrier') || '').trim(),
            showClients: Boolean(data.get('showClients')),
            showSuppliers: Boolean(data.get('showSuppliers')),
            showTechnicians: Boolean(data.get('showTechnicians')),
            showCollaborators: Boolean(data.get('showCollaborators')),
            showTransporters: Boolean(data.get('showTransporters')),
            showSellers: Boolean(data.get('showSellers')),
            showLeaders: Boolean(data.get('showLeaders')),
            showManagers: Boolean(data.get('showManagers')),
            showRepresented: Boolean(data.get('showRepresented')),
            showCredenciadoras: Boolean(data.get('showCredenciadoras')),
            showManufacturers: Boolean(data.get('showManufacturers')),
            onlyInactive: Boolean(data.get('onlyInactive')),
            dateStart: String(data.get('dateStart') || ''),
            dateEnd: String(data.get('dateEnd') || '')
          }
        };
        state.activeSub = 'list';
        renderApp();
        loadModule('cadastros');
      };

      cadastroFilterForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        applyUnifiedFilters();
      });

      document.getElementById('cadastroFilterClearBtn')?.addEventListener('click', () => {
        state.cadastroDraft = {
          ...state.cadastroDraft,
          listFilters: {
            show: true,
            type: 'all',
            status: 'all',
            query: '',
            nameFantasy: '',
            corporateName: '',
            uniqueCode: '',
            email: '',
            categoryRole: 'all',
            document: '',
            city: '',
            zipCode: '',
            uf: '',
            group: '',
            defaultCarrier: '',
            showClients: true,
            showSuppliers: true,
            showTechnicians: true,
            showCollaborators: true,
            showTransporters: true,
            showSellers: true,
            showLeaders: true,
            showManagers: true,
            showRepresented: true,
            showCredenciadoras: true,
            showManufacturers: true,
            onlyInactive: false,
            dateStart: '',
            dateEnd: ''
          }
        };
        state.activeSub = 'list';
        renderApp();
        loadModule('cadastros');
      });

      document.querySelectorAll('.cadastro-edit-row').forEach((button) => {
        button.addEventListener('click', () => {
          const kind = button.dataset.kind;
          const id = button.dataset.id;
          if (!id) return;

          if (kind === 'cnpj') {
            const company = cnpjs.find((entry) => entry.id === id);
            if (!company) return;
            state.cadastroDraft = {
              ...state.cadastroDraft,
              activeType: 'people',
              people: { ...company, kind: 'cnpj', type: 'pessoa-juridica', error: '', documentMessage: '' }
            };
          } else {
            const person = people.find((entry) => entry.id === id);
            if (!person) return;
            state.cadastroDraft = { ...state.cadastroDraft, activeType: 'people', people: { ...person, kind: 'people', error: '', documentMessage: '' } };
          }

          state.activeSub = 'edit';
          renderApp();
          loadModule('cadastros');
        });
      });

      document.querySelectorAll('.cadastro-delete-row').forEach((button) => {
        button.addEventListener('click', async () => {
          const kind = button.dataset.kind;
          const id = button.dataset.id;
          if (!id) return;

          const isCnpj = kind === 'cnpj';
          const collection = isCnpj ? cnpjs : people;
          const item = collection.find((entry) => entry.id === id);
          const label = item?.name || 'registro';
          const confirmed = await confirmModal(`Excluir ${isCnpj ? 'CNPJ' : 'pessoa'} "${label}"?`);
          if (!confirmed) return;

          try {
            await api(isCnpj ? `/api/cadastros/cnpjs/${id}` : `/api/cadastros/pessoas/${id}`, { method: 'DELETE' });
            showToast(isCnpj ? 'CNPJ excluido com sucesso.' : 'Pessoa excluida com sucesso.', 'success');
            loadModule('cadastros');
          } catch (error) {
            showToast(error.message || 'Erro ao excluir cadastro.', 'error');
          }
        });
      });

      document.querySelectorAll('.cadastro-edit-person').forEach((button) => {
        button.addEventListener('click', () => {
          const person = people.find((entry) => entry.id === button.dataset.id);
          if (!person) return;
          state.cadastroDraft = { ...state.cadastroDraft, activeType: 'people', people: { ...person, kind: 'people', error: '', documentMessage: '' } };
          state.activeSub = 'edit';
          renderApp();
          loadModule('cadastros');
        });
      });

      document.querySelectorAll('.cadastro-delete-person').forEach((button) => {
        button.addEventListener('click', async () => {
          const person = people.find((entry) => entry.id === button.dataset.id);
          const name = person?.name || 'registro';
          const confirmed = await confirmModal(`Excluir pessoa "${name}"?`);
          if (!confirmed) return;
          try {
            await api(`/api/cadastros/pessoas/${button.dataset.id}`, { method: 'DELETE' });
            showToast('Pessoa excluida com sucesso.', 'success');
            loadModule('cadastros');
          } catch (error) {
            showToast(error.message || 'Erro ao excluir pessoa.', 'error');
          }
        });
      });

      document.querySelectorAll('.cadastro-edit-cnpj').forEach((button) => {
        button.addEventListener('click', () => {
          const company = cnpjs.find((entry) => entry.id === button.dataset.id);
          if (!company) return;
          state.cadastroDraft = {
            ...state.cadastroDraft,
            activeType: 'people',
            people: { ...company, kind: 'cnpj', type: 'pessoa-juridica', error: '', documentMessage: '' }
          };
          state.activeSub = 'edit';
          renderApp();
          loadModule('cadastros');
        });
      });

      document.querySelectorAll('.cadastro-delete-cnpj').forEach((button) => {
        button.addEventListener('click', async () => {
          const company = cnpjs.find((entry) => entry.id === button.dataset.id);
          const name = company?.name || 'registro';
          const confirmed = await confirmModal(`Excluir CNPJ "${name}"?`);
          if (!confirmed) return;
          try {
            await api(`/api/cadastros/cnpjs/${button.dataset.id}`, { method: 'DELETE' });
            showToast('CNPJ excluido com sucesso.', 'success');
            loadModule('cadastros');
          } catch (error) {
            showToast(error.message || 'Erro ao excluir CNPJ.', 'error');
          }
        });
      });

      const bindDocumentMask = (input, typeGetter) => {
        input?.addEventListener('input', () => {
          input.value = maskDocumentValue(input.value, typeGetter());
        });
      };

      const markInvalidDocument = (draftTarget, key, message, document) => {
        showToast(message, 'error');
        state.cadastroDraft = {
          ...state.cadastroDraft,
          [key]: {
            ...(state.cadastroDraft[key] || {}),
            ...draftTarget,
            document,
            documentMessage: message,
            error: message
          }
        };
        renderApp();
        loadModule('cadastros');
      };

      const peopleDocumentInput = document.getElementById('peopleDocumentInput');
      const peopleTypeSelect = document.querySelector('#peopleRegisterForm select[name="type"]');
      const peopleLookupBtn = document.getElementById('peopleLookupBtn');
      bindDocumentMask(peopleDocumentInput, () => peopleTypeSelect?.value || 'pessoa-fisica');

      const refreshPeopleLookupButton = () => {
        if (!peopleLookupBtn || !peopleDocumentInput) return;
        peopleLookupBtn.disabled = sanitizeDigits(peopleDocumentInput.value).length !== 14;
      };

      peopleDocumentInput?.addEventListener('input', refreshPeopleLookupButton);
      refreshPeopleLookupButton();

      peopleTypeSelect?.addEventListener('change', () => {
        peopleDocumentInput.value = maskDocumentValue(peopleDocumentInput.value, peopleTypeSelect.value);
        refreshPeopleLookupButton();
      });

      document.getElementById('peopleLookupBtn')?.addEventListener('click', async () => {
        const form = document.getElementById('peopleRegisterForm');
        if (!form) return;
        const formData = new FormData(form);
        const selectedType = String(formData.get('type') || 'pessoa-fisica');
        const documentValue = sanitizeDigits(formData.get('document'));
        const type = selectedType;

        if (documentValue.length !== 14) {
          showToast('Informe um CNPJ com 14 digitos para consultar.', 'warning');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            people: {
              ...(state.cadastroDraft.people || {}),
              document: maskDocumentValue(documentValue, type),
              documentMessage: 'Informe um CNPJ valido para consultar dados oficiais.'
            }
          };
          renderApp();
          loadModule('cadastros');
          return;
        }

        if (!isValidCnpj(documentValue)) {
          markInvalidDocument({ name: String(formData.get('name') || '').trim() }, 'people', 'CNPJ inválido. Informe 14 dígitos numéricos válidos.', documentValue);
          return;
        }

        try {
          const response = await api(`/api/cnpj/${documentValue}`);
          const official = response.officialData || {};
          const officialEmail = getOfficialEmail(official);
          const officialPhone = getOfficialPhone(official);
          state.cadastroDraft = {
            ...state.cadastroDraft,
            people: {
              ...(state.cadastroDraft.people || {}),
              type: 'pessoa-juridica',
              document: documentValue,
              name: official.razaoSocial || formData.get('name') || '',
              tradeName: official.nomeFantasia || formData.get('tradeName') || '',
              email: officialEmail || formData.get('email') || '',
              phone: officialPhone || formData.get('phone') || '',
              zipCode: official.endereco?.cep || formData.get('zipCode') || '',
              address: official.enderecoCompleto || formData.get('address') || '',
              city: official.endereco?.cidade || formData.get('city') || '',
              state: official.endereco?.estado || formData.get('state') || '',
              neighborhood: official.endereco?.bairro || formData.get('neighborhood') || '',
              addressNumber: official.endereco?.numero || formData.get('addressNumber') || '',
              addressComplement: official.endereco?.complemento || formData.get('addressComplement') || '',
              mainCnae: official.cnaePrincipal || formData.get('mainCnae') || '',
              openingDate: official.dataAbertura || formData.get('openingDate') || '',
              documentMessage: 'CNPJ consultado com sucesso e dados oficiais preenchidos.'
            }
          };
          if (!officialEmail || !officialPhone) {
            showToast('A API retornou CNPJ valido, mas sem email e/ou telefone para este cadastro.', 'warning');
          }
          showToast('CNPJ consultado com sucesso!', 'success');
          renderApp();
          loadModule('cadastros');
        } catch (error) {
          showToast(error.message || 'Falha ao consultar CNPJ.', 'error');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            people: {
              ...(state.cadastroDraft.people || {}),
              error: error.message || 'Falha ao consultar CNPJ.'
            }
          };
          renderApp();
          loadModule('cadastros');
        }
      });

      document.getElementById('peopleRegisterForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        const selectedType = String(formData.get('type') || 'pessoa-fisica');
        const documentValue = sanitizeDigits(formData.get('document'));
        const type = selectedType;

        if (type === 'pessoa-juridica' && !isValidCnpj(documentValue)) {
          markInvalidDocument({ name: String(formData.get('name') || '').trim() }, 'people', 'CNPJ inválido. Não é possível salvar.', documentValue);
          return;
        }

        if (type === 'pessoa-fisica' && !isValidCpf(documentValue)) {
          markInvalidDocument({ name: String(formData.get('name') || '').trim() }, 'people', 'CPF inválido. Não é possível salvar.', documentValue);
          return;
        }

        const payload = {
          id: peopleDraft.id || undefined,
          name: String(formData.get('name') || '').trim(),
          tradeName: String(formData.get('tradeName') || '').trim(),
          type,
          document: documentValue,
          email: String(formData.get('email') || '').trim(),
          secondaryEmails: String(formData.get('secondaryEmails') || '').trim(),
          phone: String(formData.get('phone') || '').trim(),
          whatsapp: String(formData.get('whatsapp') || '').trim(),
          mobilePhone: String(formData.get('mobilePhone') || '').trim(),
          defaultCarrier: String(formData.get('defaultCarrier') || '').trim(),
          status: String(formData.get('status') || 'ativo').trim() || 'ativo',
          inactive: (String(formData.get('status') || 'ativo').trim() || 'ativo') === 'inativo',
          blockWhatsappBilling: Boolean(peopleDraft.blockWhatsappBilling),
          commissionHierarchy: Boolean(peopleDraft.commissionHierarchy),
          roles: formData.getAll('roles'),
          group: String(formData.get('group') || '').trim(),
          rg: String(formData.get('rg') || '').trim(),
          issuerBody: String(formData.get('issuerBody') || '').trim(),
          issueDate: String(formData.get('issueDate') || '').trim(),
          issuerState: String(formData.get('issuerState') || '').trim(),
          ruralProducer: Boolean(formData.get('ruralProducer')),
          stateRegistration: String(formData.get('stateRegistration') || '').trim(),
          municipalRegistration: String(formData.get('municipalRegistration') || '').trim(),
          suframaRegistration: String(formData.get('suframaRegistration') || '').trim(),
          foreignAddress: Boolean(formData.get('foreignAddress')),
          billingDifferent: Boolean(formData.get('billingDifferent')),
          deliveryDifferent: Boolean(formData.get('deliveryDifferent')),
          zipCode: String(formData.get('zipCode') || '').trim(),
          street: String(formData.get('street') || '').trim(),
          streetNumber: String(formData.get('streetNumber') || '').trim(),
          addressComplement: String(formData.get('addressComplement') || '').trim(),
          neighborhood: String(formData.get('neighborhood') || '').trim(),
          city: String(formData.get('city') || '').trim(),
          state: String(formData.get('state') || '').trim(),
          ibgeCityCode: String(formData.get('ibgeCityCode') || '').trim(),
          country: String(formData.get('country') || '').trim(),
          countryCode: String(formData.get('countryCode') || '').trim(),
          mapLink: String(formData.get('mapLink') || '').trim(),
          creditLimit: String(formData.get('creditLimit') || '').trim(),
          creditUsed: String(formData.get('creditUsed') || '').trim(),
          paymentPeriodDays: String(formData.get('paymentPeriodDays') || '').trim(),
          minPurchaseValue: String(formData.get('minPurchaseValue') || '').trim(),
          defaultPriceTable: String(formData.get('defaultPriceTable') || '').trim(),
          paymentMethod: String(formData.get('paymentMethod') || '').trim(),
          bankDocument: String(formData.get('bankDocument') || '').trim(),
          bankName: String(formData.get('bankName') || '').trim(),
          bankAgency: String(formData.get('bankAgency') || '').trim(),
          bankAgencyDigit: String(formData.get('bankAgencyDigit') || '').trim(),
          bankNumber: String(formData.get('bankNumber') || '').trim(),
          bankNumberDigit: String(formData.get('bankNumberDigit') || '').trim(),
          bankPeriod: String(formData.get('bankPeriod') || '').trim(),
          notes: String(formData.get('notes') || '').trim()
        };

        state.cadastroDraft = { ...state.cadastroDraft, people: payload };

        try {
          const kind = (peopleDraft.kind === 'cnpj' || type === 'pessoa-juridica') ? 'cnpj' : 'people';
          const isEditing = Boolean(payload.id);
          const endpointBase = kind === 'cnpj' ? '/api/cadastros/cnpjs' : '/api/cadastros/pessoas';
          const endpoint = isEditing ? `${endpointBase}/${payload.id}` : endpointBase;
          const method = isEditing ? 'PUT' : 'POST';
          await api(endpoint, { method, body: JSON.stringify(payload) });
          showToast(isEditing ? 'Cadastro atualizado com sucesso.' : 'Cadastro salvo com sucesso.', 'success');
          state.cadastroDraft = { ...state.cadastroDraft, people: {} };
          state.activeSub = 'list';
          renderApp();
          loadModule('cadastros');
        } catch (error) {
          showToast(error.message || 'Erro ao salvar pessoa.', 'error');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            people: { ...payload, error: error.message || 'Erro ao salvar pessoa.' }
          };
          renderApp();
          loadModule('cadastros');
        }
      });

      const cnpjDocumentInput = document.getElementById('cnpjDocumentInput');
      bindDocumentMask(cnpjDocumentInput, () => 'pessoa-juridica');

      document.getElementById('consultCnpjBtn')?.addEventListener('click', async () => {
        const form = document.getElementById('cnpjRegisterForm');
        if (!form) return;
        const formData = new FormData(form);
        const documentValue = sanitizeDigits(formData.get('document'));

        if (!isValidCnpj(documentValue)) {
          showToast('CNPJ invalido. Informe 14 digitos numericos validos.', 'error');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            cnpjs: {
              ...(state.cadastroDraft.cnpjs || {}),
              document: documentValue,
              documentMessage: 'CNPJ inválido. Informe 14 dígitos numéricos válidos.',
              error: 'CNPJ inválido. Informe 14 dígitos numéricos válidos.'
            }
          };
          renderApp();
          loadModule('cadastros');
          return;
        }

        try {
          const response = await api(`/api/cnpj/${documentValue}`);
          const official = response.officialData || {};
          const officialEmail = getOfficialEmail(official);
          const officialPhone = getOfficialPhone(official);
          state.cadastroDraft = {
            ...state.cadastroDraft,
            cnpjs: {
              ...(state.cadastroDraft.cnpjs || {}),
              document: documentValue,
              name: official.razaoSocial || formData.get('name') || '',
              tradeName: official.nomeFantasia || formData.get('tradeName') || '',
              email: officialEmail || formData.get('email') || '',
              phone: officialPhone || formData.get('phone') || '',
              address: official.enderecoCompleto || formData.get('address') || '',
              zipCode: official.endereco?.cep || formData.get('zipCode') || '',
              city: official.endereco?.cidade || formData.get('city') || '',
              state: official.endereco?.estado || formData.get('state') || '',
              neighborhood: official.endereco?.bairro || formData.get('neighborhood') || '',
              addressNumber: official.endereco?.numero || formData.get('addressNumber') || '',
              addressComplement: official.endereco?.complemento || formData.get('addressComplement') || '',
              mainCnae: official.cnaePrincipal || formData.get('mainCnae') || '',
              openingDate: official.dataAbertura || formData.get('openingDate') || '',
              registrationStatus: official.situacaoCadastral || formData.get('registrationStatus') || '',
              documentMessage: 'CNPJ consultado com sucesso e dados oficiais preenchidos.'
            }
          };
          if (!officialEmail || !officialPhone) {
            showToast('A API retornou CNPJ valido, mas sem email e/ou telefone para este cadastro.', 'warning');
          }
          showToast('CNPJ consultado com sucesso!', 'success');
          renderApp();
          loadModule('cadastros');
        } catch (error) {
          showToast(error.message || 'Falha ao consultar CNPJ.', 'error');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            cnpjs: {
              ...(state.cadastroDraft.cnpjs || {}),
              document: documentValue,
              documentMessage: error.message || 'Falha ao consultar CNPJ.'
            }
          };
          renderApp();
          loadModule('cadastros');
        }
      });

      document.getElementById('cnpjRegisterForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        const documentValue = sanitizeDigits(formData.get('document'));

        if (!isValidCnpj(documentValue)) {
          showToast('CNPJ invalido. Nao foi possivel salvar.', 'error');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            cnpjs: {
              ...(state.cadastroDraft.cnpjs || {}),
              document: documentValue,
              error: 'CNPJ inválido. Não foi possível salvar.'
            }
          };
          renderApp();
          loadModule('cadastros');
          return;
        }

        const payload = {
          id: cnpjDraft.id || undefined,
          name: String(formData.get('name') || '').trim(),
          tradeName: String(formData.get('tradeName') || '').trim(),
          type: 'pessoa-juridica',
          document: documentValue,
          email: String(formData.get('email') || '').trim(),
          secondaryEmails: String(formData.get('secondaryEmails') || '').trim(),
          phone: String(formData.get('phone') || '').trim(),
          whatsapp: String(formData.get('whatsapp') || '').trim(),
          mobilePhone: String(formData.get('mobilePhone') || '').trim(),
          defaultCarrier: String(formData.get('defaultCarrier') || '').trim(),
          status: String(formData.get('status') || 'ativo').trim() || 'ativo',
          inactive: (String(formData.get('status') || 'ativo').trim() || 'ativo') === 'inativo',
          blockWhatsappBilling: Boolean(cnpjDraft.blockWhatsappBilling),
          commissionHierarchy: Boolean(cnpjDraft.commissionHierarchy),
          roles: formData.getAll('roles'),
          group: String(formData.get('group') || '').trim(),
          mainCnae: String(formData.get('mainCnae') || '').trim(),
          registrationStatus: String(formData.get('registrationStatus') || '').trim(),
          openingDate: String(formData.get('openingDate') || '').trim(),
          zipCode: String(formData.get('zipCode') || '').trim(),
          address: String(formData.get('address') || '').trim(),
          addressNumber: String(formData.get('addressNumber') || '').trim(),
          addressComplement: String(formData.get('addressComplement') || '').trim(),
          neighborhood: String(formData.get('neighborhood') || '').trim(),
          city: String(formData.get('city') || '').trim(),
          state: String(formData.get('state') || '').trim(),
          ibgeCityCode: String(formData.get('ibgeCityCode') || '').trim(),
          country: String(formData.get('country') || '').trim(),
          countryCode: String(formData.get('countryCode') || '').trim(),
          mapLink: String(formData.get('mapLink') || '').trim(),
          creditLimit: String(formData.get('creditLimit') || '').trim(),
          creditUsed: String(formData.get('creditUsed') || '').trim(),
          paymentPeriodDays: String(formData.get('paymentPeriodDays') || '').trim(),
          minPurchaseValue: String(formData.get('minPurchaseValue') || '').trim(),
          defaultPriceTable: String(formData.get('defaultPriceTable') || '').trim(),
          paymentMethod: String(formData.get('paymentMethod') || '').trim(),
          bankDocument: String(formData.get('bankDocument') || '').trim(),
          bankName: String(formData.get('bankName') || '').trim(),
          bankAgency: String(formData.get('bankAgency') || '').trim(),
          bankAgencyDigit: String(formData.get('bankAgencyDigit') || '').trim(),
          bankNumber: String(formData.get('bankNumber') || '').trim(),
          bankNumberDigit: String(formData.get('bankNumberDigit') || '').trim(),
          bankPeriod: String(formData.get('bankPeriod') || '').trim(),
          notes: String(formData.get('notes') || '').trim()
        };

        state.cadastroDraft = { ...state.cadastroDraft, cnpjs: payload };

        try {
          const isEditing = Boolean(payload.id);
          const endpoint = isEditing ? `/api/cadastros/cnpjs/${payload.id}` : '/api/cadastros/cnpjs';
          const method = isEditing ? 'PUT' : 'POST';
          await api(endpoint, { method, body: JSON.stringify(payload) });
          showToast(isEditing ? 'CNPJ atualizado com sucesso.' : 'CNPJ cadastrado com sucesso.', 'success');
          state.cadastroDraft = { ...state.cadastroDraft, cnpjs: {} };
          state.activeSub = 'list';
          renderApp();
          loadModule('cadastros');
        } catch (error) {
          showToast(error.message || 'Erro ao salvar CNPJ.', 'error');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            cnpjs: { ...payload, error: error.message || 'Erro ao salvar CNPJ.' }
          };
          renderApp();
          loadModule('cadastros');
        }
      });

      return;
    }

    if (moduleName === 'purchases') {
      const data = await api('/api/purchases');
      const sub = state.activeSub || 'new_purchase';

      const renderPage = () => {
        if (sub === 'purchase_history') {
          return `
            <div class="panel">
              <h3>Histórico de compras</h3>
              <table class="table">
                <thead><tr><th>ID</th><th>Fornecedor</th><th>Data</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  ${data.purchases.map((purchase) => `<tr><td>${escapeHtml(purchase.id)}</td><td>${escapeHtml(purchase.supplier)}</td><td>${escapeHtml(purchase.date)}</td><td>R$ ${Number(purchase.total || 0).toFixed(2)}</td><td>${escapeHtml(purchase.status)}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
          `;
        }

        if (sub === 'suppliers') {
          const suppliers = [...new Map(data.purchases.map((purchase) => [purchase.supplier, { name: purchase.supplier, purchases: 0, total: 0 }])).values()];
          data.purchases.forEach((purchase) => {
            const supplier = suppliers.find((entry) => entry.name === purchase.supplier);
            if (supplier) {
              supplier.purchases += 1;
              supplier.total += Number(purchase.total || 0);
            }
          });

          return `
            <div class="panel">
              <h3>Fornecedores</h3>
              <table class="table">
                <thead><tr><th>Fornecedor</th><th>Compras</th><th>Total</th></tr></thead>
                <tbody>
                  ${suppliers.map((supplier) => `<tr><td>${escapeHtml(supplier.name)}</td><td>${supplier.purchases}</td><td>R$ ${supplier.total.toFixed(2)}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
          `;
        }

        return `
          <div class="panel">
            <h3>Nova compra</h3>
            <form id="purchaseForm" class="form-grid">
              <div class="row">
                <label>Fornecedor<input name="supplier" required /></label>
                <label>Data<input name="date" type="date" /></label>
              </div>
              <div class="row">
                <label>Produto<select name="productId">${data.products.map((product) => `<option value="${product.id}">${escapeHtml(product.name)}</option>`).join('')}</select></label>
                <label>Quantidade<input name="quantity" type="number" min="1" required value="1" /></label>
                <label>Custo unitário<input name="costPrice" type="number" step="0.01" required value="${Number(data.products[0]?.costPrice || 0).toFixed(2)}" /></label>
              </div>
              <button type="submit">Registrar compra</button>
            </form>
          </div>
        `;
      };

      content.innerHTML = renderPage();

      if (sub === 'new_purchase') {
        document.getElementById('purchaseForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          try {
            await api('/api/purchases', {
              method: 'POST',
              body: JSON.stringify({
                supplier: formData.get('supplier'),
                date: formData.get('date'),
                productId: formData.get('productId'),
                quantity: Number(formData.get('quantity')),
                costPrice: Number(formData.get('costPrice'))
              })
            });
            showToast('Compra registrada com sucesso.', 'success');
            state.activeSub = 'purchase_history';
            renderApp();
            loadModule('purchases');
          } catch (error) {
            showToast(error.message || 'Erro ao registrar compra.', 'error');
          }
        });
      }
      return;
    }

    if (moduleName === 'stock') {
      const data = await api('/api/stock');
      content.innerHTML = `
        <div class="panel">
          <h3>Novo produto</h3>
          <form id="stockForm" class="form-grid">
            <div class="row">
              <label>Nome<input name="name" required /></label>
              <label>SKU<input name="sku" required /></label>
            </div>
            <div class="row">
              <label>Estoque inicial<input name="stockQuantity" type="number" required value="0" /></label>
              <label>Custo<input name="costPrice" type="number" step="0.01" required value="0" /></label>
              <label>Preço de venda<input name="salePrice" type="number" step="0.01" required value="0" /></label>
            </div>
            <button type="submit">Salvar produto</button>
          </form>
        </div>
        <div class="panel">
          <h3>Estoque atual</h3>
          <table class="table">
            <thead><tr><th>Produto</th><th>SKU</th><th>Estoque</th><th>Custo</th><th>Venda</th></tr></thead>
            <tbody>
              ${data.products.map((product) => `<tr><td>${product.name}</td><td>${product.sku}</td><td>${product.stockQuantity}</td><td>R$ ${product.costPrice}</td><td>R$ ${product.salePrice}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('stockForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        try {
          await api('/api/stock', {
            method: 'POST',
            body: JSON.stringify({
              name: formData.get('name'),
              sku: formData.get('sku'),
              stockQuantity: Number(formData.get('stockQuantity')),
              costPrice: Number(formData.get('costPrice')),
              salePrice: Number(formData.get('salePrice'))
            })
          });
          showToast('Produto salvo com sucesso.', 'success');
          loadModule('stock');
        } catch (error) {
          showToast(error.message || 'Erro ao salvar produto.', 'error');
        }
      });
      return;
    }

    if (moduleName === 'finance') {
      const data = await api('/api/finance');
      content.innerHTML = `
        <div class="panel">
          <h3>Conciliação financeira</h3>
          <p class="muted">Cada venda gera um lançamento financeiro ligado ao mesmo registro.</p>
          <table class="table">
            <thead><tr><th>Tipo</th><th>Referência</th><th>Descrição</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody>
              ${data.finance.map((entry) => `<tr><td>${entry.type}</td><td>${entry.referenceId}</td><td>${entry.description}</td><td>R$ ${entry.amount.toFixed(2)}</td><td>${entry.status}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h3>Adicionar lançamento</h3>
          <form id="financeForm" class="form-grid">
            <div class="row">
              <label>Tipo<select name="type"><option value="sale">Venda</option><option value="purchase">Compra</option></select></label>
              <label>Referência<input name="referenceId" /></label>
              <label>Valor<input name="amount" type="number" step="0.01" required value="0" /></label>
            </div>
            <div class="row">
              <label>Descrição<input name="description" /></label>
              <label>Status<select name="status"><option value="paid">Pago</option><option value="pending">Pendente</option></select></label>
              <label>Método<input name="method" value="Dinheiro" /></label>
            </div>
            <button type="submit">Salvar lançamento</button>
          </form>
        </div>
      `;
      document.getElementById('financeForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        try {
          await api('/api/finance', {
            method: 'POST',
            body: JSON.stringify({
              type: formData.get('type'),
              referenceId: formData.get('referenceId'),
              description: formData.get('description'),
              amount: Number(formData.get('amount')),
              status: formData.get('status'),
              method: formData.get('method')
            })
          });
          showToast('Lancamento financeiro salvo com sucesso.', 'success');
          loadModule('finance');
        } catch (error) {
          showToast(error.message || 'Erro ao salvar lancamento financeiro.', 'error');
        }
      });
      return;
    }

    if (moduleName === 'settings') {
      const data = await api('/api/settings');
          const totals = data.totals || {};
          const settingsPermissions = data.permissions || {};
          const canManageCompany = Boolean(settingsPermissions.company);
          const canManageUsers = Boolean(settingsPermissions.users);
          content.innerHTML = `
            <div class="cards">
              ${canManageUsers ? `<div class="card"><h3>Usuarios</h3><p>${totals.totalUsers ?? (data.users || []).length}</p></div>` : ''}
              <div class="card"><h3>Produtos</h3><p>${totals.totalProducts ?? 0}</p></div>
              <div class="card"><h3>Vendas</h3><p>${totals.totalSales ?? 0}</p></div>
              <div class="card"><h3>Compras</h3><p>${totals.totalPurchases ?? 0}</p></div>
            </div>

            ${canManageCompany ? `
            <div class="panel">
              <h3>Configurações da empresa</h3>
              <form id="companyForm" class="form-grid">
                <div class="row">
                  <label>Nome da empresa<input name="companyName" value="${data.settings.companyName}" /></label>
                  <label>Moeda<input name="currency" value="${data.settings.currency}" /></label>
                  <label>Imposto (%)<input name="taxRate" type="number" value="${data.settings.taxRate}" /></label>
                </div>
                <button type="submit">Salvar</button>
              </form>
            </div>
            ` : '<div class="panel"><p>Sem permissão para visualizar configurações da empresa.</p></div>'}

            ${canManageUsers ? `
            <div class="panel">
              <h3>Criar usuário</h3>
              <form id="userForm" class="form-grid">
                <div class="row">
                  <label>Nome<input name="name" required /></label>
                  <label>Usuário<input name="username" required /></label>
                  <label>Senha<input name="password" required /></label>
                </div>
                <div class="row">
                  <label>Função<select name="role"><option value="user">Usuário</option><option value="admin">Admin</option></select></label>
                </div>
                <div class="checkbox-grid">
                  ${['dashboard', 'sales', 'purchases', 'stock', 'finance', 'settings', 'cadastros'].map((module) => `<label><input type="checkbox" name="module" value="${module}" /> ${moduleLabels[module]}</label>`).join('')}
                </div>
                <button type="submit">Criar usuário</button>
              </form>
        </div>

            <div class="panel">
              <h3>Usuários cadastrados</h3>
              <table class="table table-actions">
                <thead><tr><th>Usuário</th><th>Nome</th><th>Função</th><th>Módulos</th><th>Ações</th></tr></thead>
                <tbody>
                  ${data.users.map((user) => `\n                    <tr data-user-id="${user.id}">\n                      <td>${user.username}</td>\n                      <td>${user.name}</td>\n                      <td>${user.role}</td>\n                      <td>${user.allowedModules.join(', ')}</td>\n                      <td>\n                        <button class="delete-user icon-button" data-id="${user.id}" title="Excluir usuário" ${state.user?.role !== 'admin' || state.user?.id === user.id ? 'disabled' : ''}>\n                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>\n                        </button>\n                      </td>\n                    </tr>\n                  `).join('') }
                </tbody>
              </table>
            </div>
            ` : '<div class="panel"><p>Sem permissão para visualizar dados de usuários.</p></div>'}
          `;

          document.getElementById('companyForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(event.target);
            try {
              await api('/api/settings', {
                method: 'POST',
                body: JSON.stringify({ type: 'company', payload: { companyName: formData.get('companyName'), currency: formData.get('currency'), taxRate: Number(formData.get('taxRate')) } })
              });
              showToast('Configuracoes da empresa salvas com sucesso.', 'success');
              loadModule('settings');
            } catch (error) {
              showToast(error.message || 'Erro ao salvar configuracoes da empresa.', 'error');
            }
          });

          document.getElementById('userForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(event.target);
            const selectedModules = formData.getAll('module');
            try {
              await api('/api/settings', {
                method: 'POST',
                body: JSON.stringify({ type: 'user', payload: { name: formData.get('name'), username: formData.get('username'), password: formData.get('password'), role: formData.get('role'), allowedModules: selectedModules } })
              });
              showToast('Usuario criado com sucesso.', 'success');
              loadModule('settings');
            } catch (error) {
              showToast(error.message || 'Erro ao criar usuario.', 'error');
            }
          });

          // delete handlers
          document.querySelectorAll('.delete-user').forEach((btn) => {
                      btn.addEventListener('click', async (e) => {
                        if (btn.disabled) return;
                        const id = btn.dataset.id;
                        if (!id) return;
                        const row = btn.closest('tr');
                        const username = row?.querySelector('td')?.textContent || id;
                        const confirmed = await confirmModal(`Confirma exclusão do usuário "${username}"?`);
                        if (!confirmed) return;
                        try {
                          await api('/api/users/delete', { method: 'POST', body: JSON.stringify({ id }) });
                          showToast('Usuario excluido com sucesso.', 'success');
                          loadModule('settings');
                        } catch (err) {
                          showToast('Erro ao excluir: ' + err.message, 'error');
                        }
                      });
                    });

          // audit logs (admin)
          if (state.user?.role === 'admin') {
            let auditOffset = 0;
            const auditLimit = 20;
            async function loadAudit() {
              try {
                const res = await api(`/api/audit?limit=${auditLimit}&offset=${auditOffset}`);
                const logs = res.auditLogs || [];
                const auditBody = document.getElementById('auditBody');
                const auditEmpty = document.getElementById('auditEmpty');
                if (!auditBody || !auditEmpty) return;
                auditBody.innerHTML = logs.map((log) => `
                  <tr>
                    <td>${log.action}</td>
                    <td>${log.targetUsername || log.targetId}</td>
                    <td>${log.byName || log.byId}</td>
                    <td>${new Date(log.at).toLocaleString()}</td>
                  </tr>
                `).join('');
                auditEmpty.style.display = logs.length ? 'none' : 'block';
              } catch (err) {
                showToast('Erro ao carregar logs: ' + (err.message || err), 'error');
              }
            }

            document.getElementById('auditRefresh')?.addEventListener('click', () => { auditOffset = 0; loadAudit(); });
            document.getElementById('auditPrev')?.addEventListener('click', () => { auditOffset = Math.max(0, auditOffset - auditLimit); loadAudit(); });
            document.getElementById('auditNext')?.addEventListener('click', () => { auditOffset = auditOffset + auditLimit; loadAudit(); });

            // initial load
            setTimeout(loadAudit, 50);
          }

          return;
        }
  } catch (error) {
    showToast(error.message || 'Erro ao carregar modulo.', 'error');
    content.innerHTML = `<div class="panel"><p>${error.message}</p></div>`;
  }
}

(async function bootstrap() {
  const token = localStorage.getItem('token');
  if (!token) {
    renderAuth();
    return;
  }

  try {
    const response = await api('/api/me');
    state.user = response.user;
    restoreLastRoute();
    renderApp();
    await loadModule(state.activeModule);
  } catch (error) {
    localStorage.removeItem('token');
    showToast(error.message || 'Sua sessao expirou. Faca login novamente.', 'error');
    renderAuth(error.message);
  }
})();
