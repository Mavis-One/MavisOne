const app = document.getElementById('app');
const state = { user: null, activeModule: 'dashboard', activeSub: null, hoveredModule: null, cadastroDraft: {} };

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
  return Boolean(getSecondarySidebarConfig(state.hoveredModule) || getSecondarySidebarConfig(state.activeModule));
}

function renderSecondarySidebar() {
  const sidebar = document.querySelector('.secondary-sidebar');
  if (!sidebar) return;

  const hoveredModule = state.hoveredModule;
  const moduleName = getSecondarySidebarConfig(hoveredModule) ? hoveredModule : (getSecondarySidebarConfig(state.activeModule) ? state.activeModule : null);
  const secondaryConfig = getSecondarySidebarConfig(moduleName);
  sidebar.classList.toggle('visible', Boolean(secondaryConfig));

  if (!secondaryConfig) {
    sidebar.innerHTML = '';
    return;
  }

  const activeKey = state.activeSub || (secondaryConfig.module === 'sales' ? 'orders_quotes' : secondaryConfig.module === 'cadastros' ? 'basicos' : secondaryConfig.module === 'purchases' ? 'new_purchase' : null);

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
        <h1 class="brand"><span class="brand-full">InfinityERP</span><span class="brand-short">ERP</span></h1>
        <p class="muted">Acesso administrativo inicial: admin / admin123</p>
        <form id="loginForm" class="form-grid">
          <label>Usuário
            <input name="username" required value="admin" />
          </label>
          <label>Senha
            <input name="password" type="password" required value="admin123" />
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
      renderApp();
      await loadModule('dashboard');
    } catch (error) {
      renderAuth(error.message);
    }
  });
}

function renderApp() {
  const activeSubKey = state.activeSub || (state.activeModule === 'sales' ? 'orders_quotes' : state.activeModule === 'cadastros' ? 'basicos' : state.activeModule === 'purchases' ? 'new_purchase' : null);
  const activeSubLabel = (moduleSubItems[state.activeModule] || []).find((item) => item.key === activeSubKey)?.label || '';

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <h2 class="brand"><span class="brand-full">InfinityERP</span><span class="brand-short">ERP</span></h2>
        <p class="muted">${state.user?.name || 'Usuário'}</p>
        <div class="nav-list">
          ${['dashboard', 'sales', 'purchases', 'stock', 'finance', 'settings', 'cadastros']
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
      <aside class="secondary-sidebar"></aside>
      <main class="content">
        <div class="topbar">
          <h1>${moduleLabels[state.activeModule]}${activeSubLabel ? ' > ' + activeSubLabel : ''}</h1>
          <button class="secondary" id="logoutBtn">Sair</button>
        </div>
        <div id="moduleContent"></div>
      </main>
    </div>
  `;

  renderSecondarySidebar();

  // main nav click handlers
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.onmouseover = () => {
      state.hoveredModule = button.dataset.module;
      syncSecondarySidebar();
    };
    button.onmouseout = () => {
      if (state.hoveredModule === button.dataset.module) {
        state.hoveredModule = null;
      }
      syncSecondarySidebar();
    };
    button.onclick = () => {
      const module = button.dataset.module;
      state.activeModule = module;
      state.activeSub = null;
      state.hoveredModule = null;
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
      renderApp();
      loadModule(state.activeModule);
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    state.user = null;
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
  cadastros: [
    { key: 'basicos', label: 'Dados básicos' },
    { key: 'contato', label: 'Contato' },
    { key: 'endereco', label: 'Endereço' },
    { key: 'resumo', label: 'Resumo' }
  ],
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
  settings: [ { key: 'users', label: 'Usuários' }, { key: 'company', label: 'Empresa' } ]
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadModule(moduleName) {
  state.activeModule = moduleName;
  const content = document.getElementById('moduleContent');
  if (!content) {
    return;
  }

  try {
    if (moduleName === 'dashboard') {
      const data = await api('/api/dashboard');
      content.innerHTML = `
        <div class="cards">
          <div class="card"><h3>Vendas</h3><p>R$ ${data.salesTotal.toFixed(2)}</p></div>
          <div class="card"><h3>Compras</h3><p>R$ ${data.purchaseTotal.toFixed(2)}</p></div>
          <div class="card"><h3>Saldo</h3><p>R$ ${data.balance.toFixed(2)}</p></div>
          <div class="card"><h3>Conc. pendente</h3><p>${data.pendingReconciliation}</p></div>
        </div>
        <div class="panel">
          <h3>Resumo rápido</h3>
          <p>Produtos cadastrados: ${data.totalProducts}</p>
          <p>Vendas registradas: ${data.totalSales}</p>
          <p>Compras registradas: ${data.totalPurchases}</p>
          <p>Valor em estoque: R$ ${data.stockValue.toFixed(2)}</p>
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
          <div class="panel">
            <h3>Importação CSV</h3>
            <p class="muted">Cole um CSV simples com colunas: customer,date,amount,status</p>
            <form id="salesImportForm" class="form-grid">
              <textarea name="csvText" rows="6" placeholder="customer,date,amount,status\nCliente A,2026-01-10,1200.00,pendente"></textarea>
              <div class="row">
                <label>Tipo<select name="importType"><option value="order">Pedido</option><option value="quote">Orçamento</option><option value="nfe">NF-e</option></select></label>
                <label>Origem<input name="source" value="importacao-csv" /></label>
              </div>
              <button type="submit">Importar</button>
            </form>
          </div>
        `;
        document.getElementById('salesImportForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          await api('/api/sales/import', {
            method: 'POST',
            body: JSON.stringify({
              type: formData.get('importType'),
              source: formData.get('source'),
              text: formData.get('csvText')
            })
          });
          loadModule('sales');
        });
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
          state.activeSub = 'orders_quotes';
          renderApp();
          loadModule('sales');
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
          state.activeSub = 'orders_quotes';
          renderApp();
          loadModule('sales');
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
          state.activeSub = 'nfes';
          renderApp();
          loadModule('sales');
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

      content.innerHTML = `
        <div class="panel">
          <h3>Em breve</h3>
          <p class="muted">Esta área ainda será detalhada com o tempo.</p>
        </div>
      `;
      return;
    }

    if (moduleName === 'cadastros') {
      const data = await api('/api/cadastros');
      const sub = state.activeSub || 'basicos';
      const draft = state.cadastroDraft || {};

      const renderPage = () => {
        if (sub === 'basicos') {
          return `
            <div class="panel">
              <h3>Dados básicos</h3>
              <p class="muted">Preencha as informações principais do cadastro.</p>
              <form id="cadastroBasicosForm" class="form-grid">
                <div class="row">
                  <label>Nome / Razão social<input name="name" required value="${escapeHtml(draft.name || '')}" /></label>
                  <label>Tipo<select name="type"><option value="pessoa-fisica" ${draft.type === 'pessoa-fisica' ? 'selected' : ''}>Pessoa física</option><option value="pessoa-juridica" ${draft.type === 'pessoa-juridica' ? 'selected' : ''}>Pessoa jurídica</option></select></label>
                  <label>CPF / CNPJ<input name="document" value="${escapeHtml(draft.document || '')}" /></label>
                </div>
                <div class="row">
                  <label>Status<select name="status"><option value="ativo" ${draft.status === 'ativo' ? 'selected' : ''}>Ativo</option><option value="inativo" ${draft.status === 'inativo' ? 'selected' : ''}>Inativo</option></select></label>
                </div>
                <button type="submit">Salvar e ir para contato</button>
              </form>
            </div>
          `;
        }

        if (sub === 'contato') {
          return `
            <div class="panel">
              <h3>Contato</h3>
              <p class="muted">Adicione os dados de comunicação.</p>
              <form id="cadastroContatoForm" class="form-grid">
                <div class="row">
                  <label>E-mail<input name="email" type="email" value="${escapeHtml(draft.email || '')}" /></label>
                  <label>Telefone<input name="phone" value="${escapeHtml(draft.phone || '')}" /></label>
                </div>
                <button type="submit">Salvar e ir para endereço</button>
              </form>
            </div>
          `;
        }

        if (sub === 'endereco') {
          return `
            <div class="panel">
              <h3>Endereço</h3>
              <p class="muted">Defina o endereço principal.</p>
              <form id="cadastroEnderecoForm" class="form-grid">
                <div class="row">
                  <label>Endereço<input name="address" value="${escapeHtml(draft.address || '')}" /></label>
                  <label>Cidade<input name="city" value="${escapeHtml(draft.city || '')}" /></label>
                  <label>Estado<input name="state" value="${escapeHtml(draft.state || '')}" /></label>
                </div>
                <div class="row">
                  <label>CEP<input name="zipCode" value="${escapeHtml(draft.zipCode || '')}" /></label>
                </div>
                <button type="submit">Salvar e ir para resumo</button>
              </form>
            </div>
          `;
        }

        return `
          <div class="panel">
            <h3>Resumo</h3>
            <p class="muted">Revise e finalize o cadastro.</p>
            <form id="cadastroResumoForm" class="form-grid">
              <div class="row">
                <label>Observações<input name="notes" value="${escapeHtml(draft.notes || '')}" /></label>
              </div>
              <div class="panel" style="margin-top: 0; background: #f8fafc;">
                <p><strong>Nome:</strong> ${escapeHtml(draft.name || '')}</p>
                <p><strong>Tipo:</strong> ${escapeHtml(draft.type === 'pessoa-juridica' ? 'Pessoa jurídica' : 'Pessoa física')}</p>
                <p><strong>Documento:</strong> ${escapeHtml(draft.document || '')}</p>
                <p><strong>E-mail:</strong> ${escapeHtml(draft.email || '')}</p>
                <p><strong>Telefone:</strong> ${escapeHtml(draft.phone || '')}</p>
                <p><strong>Endereço:</strong> ${escapeHtml(draft.address || '')}</p>
              </div>
              <button type="submit">Salvar cadastro</button>
            </form>
          </div>
        `;
      };

      content.innerHTML = `
        <div class="panel">
          ${renderPage()}
        </div>
        <div class="panel">
          <h3>Cadastros salvos</h3>
          <table class="table">
            <thead><tr><th>Nome</th><th>Tipo</th><th>Documento</th><th>E-mail</th><th>Telefone</th><th>Status</th></tr></thead>
            <tbody>
              ${data.cadastros.map((cadastro) => `
                <tr>
                  <td>${escapeHtml(cadastro.name || '')}</td>
                  <td>${escapeHtml(cadastro.type === 'pessoa-juridica' ? 'Pessoa jurídica' : 'Pessoa física')}</td>
                  <td>${escapeHtml(cadastro.document || '')}</td>
                  <td>${escapeHtml(cadastro.email || '')}</td>
                  <td>${escapeHtml(cadastro.phone || '')}</td>
                  <td>${escapeHtml(cadastro.status || 'ativo')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      if (sub === 'basicos') {
        document.getElementById('cadastroBasicosForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          state.cadastroDraft = { ...state.cadastroDraft, name: formData.get('name'), type: formData.get('type'), document: formData.get('document'), status: formData.get('status') };
          state.activeSub = 'contato';
          renderApp();
          loadModule('cadastros');
        });
        return;
      }

      if (sub === 'contato') {
        document.getElementById('cadastroContatoForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          state.cadastroDraft = { ...state.cadastroDraft, email: formData.get('email'), phone: formData.get('phone') };
          state.activeSub = 'endereco';
          renderApp();
          loadModule('cadastros');
        });
        return;
      }

      if (sub === 'endereco') {
        document.getElementById('cadastroEnderecoForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          state.cadastroDraft = { ...state.cadastroDraft, address: formData.get('address'), city: formData.get('city'), state: formData.get('state'), zipCode: formData.get('zipCode') };
          state.activeSub = 'resumo';
          renderApp();
          loadModule('cadastros');
        });
        return;
      }

      document.getElementById('cadastroResumoForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        const payload = { ...state.cadastroDraft, notes: formData.get('notes') };
        await api('/api/cadastros', { method: 'POST', body: JSON.stringify(payload) });
        state.cadastroDraft = {};
        state.activeSub = 'basicos';
        renderApp();
        loadModule('cadastros');
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
          state.activeSub = 'purchase_history';
          renderApp();
          loadModule('purchases');
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
        loadModule('stock');
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
        loadModule('finance');
      });
      return;
    }

    if (moduleName === 'settings') {
      const data = await api('/api/settings');
          const totals = data.totals || {};
          content.innerHTML = `
            <div class="cards">
              <div class="card"><h3>Usuarios</h3><p>${totals.totalUsers ?? (data.users || []).length}</p></div>
              <div class="card"><h3>Produtos</h3><p>${totals.totalProducts ?? 0}</p></div>
              <div class="card"><h3>Vendas</h3><p>${totals.totalSales ?? 0}</p></div>
              <div class="card"><h3>Compras</h3><p>${totals.totalPurchases ?? 0}</p></div>
            </div>

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
          `;

          document.getElementById('companyForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(event.target);
            await api('/api/settings', {
              method: 'POST',
              body: JSON.stringify({ type: 'company', payload: { companyName: formData.get('companyName'), currency: formData.get('currency'), taxRate: Number(formData.get('taxRate')) } })
            });
            loadModule('settings');
          });

          document.getElementById('userForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(event.target);
            const selectedModules = formData.getAll('module');
            await api('/api/settings', {
              method: 'POST',
              body: JSON.stringify({ type: 'user', payload: { name: formData.get('name'), username: formData.get('username'), password: formData.get('password'), role: formData.get('role'), allowedModules: selectedModules } })
            });
            loadModule('settings');
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
                          loadModule('settings');
                        } catch (err) {
                          alert('Erro ao excluir: ' + err.message);
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
                alert('Erro ao carregar logs: ' + (err.message || err));
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
    renderApp();
    await loadModule(state.activeModule);
  } catch (error) {
    localStorage.removeItem('token');
    renderAuth(error.message);
  }
})();
