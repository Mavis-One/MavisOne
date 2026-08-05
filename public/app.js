const app = document.getElementById('app');
const state = {
  user: null,
  activeModule: 'dashboard',
  activeSub: null,
  selectedModule: null,
  cadastroDraft: { people: {}, cnpjs: {} },
  salesDraft: {},
  moduleRouteHistory: {},
  isNavigatingBack: false
};
const LAST_ROUTE_KEY = 'mavisone:last-route';
const SESSION_TOKEN_KEY = 'mavisone:session-token';
function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function themeIconSvg(theme) {
  return theme === 'dark'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path></svg>';
}

// Ícone padrão (clipe de papel) usado em todos os botões de favoritar/fixar do sistema.
function favoriteIconSvg(active) {
  return `<svg class="favorite-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${active ? 2.5 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

function getSessionToken() {
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

function setSessionToken(token) {
  if (!token) return;
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  // Remove legacy token persistence to prevent auto-login after closing the tab.
  localStorage.removeItem('token');
}

function clearSessionToken() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem('token');
}

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

function getRouteKey(moduleName, subKey) {
  return `${String(moduleName || 'dashboard')}::${String(subKey || '')}`;
}

function parseRouteKey(key) {
  const [moduleName, subKey] = String(key || 'dashboard::').split('::');
  return {
    module: moduleName || 'dashboard',
    sub: subKey || null
  };
}

function ensureModuleRouteHistory(moduleName) {
  const moduleKey = String(moduleName || 'dashboard');
  if (!state.moduleRouteHistory[moduleKey]) {
    state.moduleRouteHistory[moduleKey] = {
      stack: [],
      currentRouteKey: ''
    };
  }
  return state.moduleRouteHistory[moduleKey];
}

function trackRouteChange(moduleName, subKey) {
  const moduleHistory = ensureModuleRouteHistory(moduleName);
  const nextKey = getRouteKey(moduleName, subKey);

  if (!moduleHistory.currentRouteKey) {
    moduleHistory.currentRouteKey = nextKey;
    state.isNavigatingBack = false;
    return;
  }

  if (moduleHistory.currentRouteKey === nextKey) {
    state.isNavigatingBack = false;
    return;
  }

  if (!state.isNavigatingBack) {
    moduleHistory.stack.push(parseRouteKey(moduleHistory.currentRouteKey));
    if (moduleHistory.stack.length > 60) {
      moduleHistory.stack.shift();
    }
  }

  moduleHistory.currentRouteKey = nextKey;
  state.isNavigatingBack = false;
}

function canGoBack() {
  const moduleHistory = state.moduleRouteHistory[state.activeModule];
  return Boolean(moduleHistory && moduleHistory.stack.length > 0);
}

// renderApp() (chamado antes de loadModule) desenha o botão de voltar usando o
// histórico ainda desatualizado, já que o push da rota só acontece dentro de
// loadModule -> trackRouteChange. Sincroniza o estado do botão logo após esse push,
// sem precisar re-renderizar (e assim apagar) o conteúdo do módulo.
function syncBackButtonState() {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.disabled = !canGoBack();
  }
}

function goBackToPreviousRoute() {
  const moduleHistory = state.moduleRouteHistory[state.activeModule];
  if (!moduleHistory || !moduleHistory.stack.length) return;

  const previousRoute = moduleHistory.stack.pop();
  if (!previousRoute) return;

  state.isNavigatingBack = true;
  state.activeModule = previousRoute.module;
  state.activeSub = previousRoute.sub;
  state.selectedModule = getSecondarySidebarConfig(previousRoute.module) ? previousRoute.module : null;
  renderApp();
  loadModule(previousRoute.module);
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
  if (moduleName === 'finance') {
    return { module: 'finance', title: 'Financeiro', subtitle: 'Fluxos', items: moduleSubItems.finance };
  }
  if (moduleName === 'stock') {
    return { module: 'stock', title: 'Estoque', subtitle: 'Fluxos', items: moduleSubItems.stock };
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

  const activeKey = state.activeSub || (secondaryConfig.module === 'sales' ? 'orders_quotes' : secondaryConfig.module === 'cadastros' ? 'list' : secondaryConfig.module === 'purchases' ? 'new_purchase' : secondaryConfig.module === 'finance' ? 'dashboard' : secondaryConfig.module === 'stock' ? 'products' : null);

  sidebar.innerHTML = `
    <div class="secondary-header">
      <strong>${secondaryConfig.title}</strong>
      <span>${secondaryConfig.subtitle}</span>
    </div>
    <div class="secondary-nav-list">
      ${secondaryConfig.items.map((sub) => `
        <div class="secondary-nav-item-row">
          <button type="button" class="secondary-nav-item secondary-open-item ${(state.activeModule === secondaryConfig.module && activeKey === sub.key) ? 'active' : ''}" data-module="${secondaryConfig.module}" data-sub="${sub.key}">
            <span>${sub.label}</span>
          </button>
          <button type="button" class="sidebar-pin-btn secondary-pin ${getDashboardPinSet().has(`${secondaryConfig.module}::${sub.key}`) ? 'active' : ''}" data-pin-key="${secondaryConfig.module}::${sub.key}" title="${getDashboardPinSet().has(`${secondaryConfig.module}::${sub.key}`) ? 'Desfixar' : 'Fixar'} ${sub.label}" aria-pressed="${getDashboardPinSet().has(`${secondaryConfig.module}::${sub.key}`) ? 'true' : 'false'}">
            ${favoriteIconSvg(getDashboardPinSet().has(`${secondaryConfig.module}::${sub.key}`))}
          </button>
        </div>
      `).join('')}
    </div>
  `;

  sidebar.querySelectorAll('.secondary-open-item').forEach((btn) => {
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

function normalizeDashboardPins(pins) {
  if (!Array.isArray(pins)) return [];
  const result = [];
  const seen = new Set();
  pins.forEach((pin) => {
    const value = String(pin || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

function getDashboardPinsStorageKey(userId) {
  return `mavisone:dashboard-pins:${String(userId || 'anonymous')}`;
}

function readStoredDashboardPins(userId) {
  try {
    const raw = localStorage.getItem(getDashboardPinsStorageKey(userId));
    return normalizeDashboardPins(raw ? JSON.parse(raw) : []);
  } catch (_) {
    return [];
  }
}

function persistStoredDashboardPins(userId, pins) {
  localStorage.setItem(getDashboardPinsStorageKey(userId), JSON.stringify(normalizeDashboardPins(pins)));
}

function getDashboardPinSet() {
  const serverPins = Array.isArray(state.user?.dashboardPins) ? state.user.dashboardPins : [];
  const storedPins = state.user?.id ? readStoredDashboardPins(state.user.id) : [];
  return new Set(normalizeDashboardPins([...serverPins, ...storedPins]));
}

function getDashboardPinLabel(pinKey) {
  const [moduleKey, subKey] = String(pinKey || '').split('::');
  const moduleLabel = moduleLabels[moduleKey] || moduleKey;
  if (!subKey) {
    return moduleLabel;
  }
  const subItem = (moduleSubItems[moduleKey] || []).find((item) => item.key === subKey);
  return `${moduleLabel} > ${subItem ? subItem.label : subKey}`;
}

async function saveDashboardPins(nextPins) {
  const normalized = normalizeDashboardPins(nextPins);
  if (state.user?.id) {
    persistStoredDashboardPins(state.user.id, normalized);
  }

  if (state.user) {
    state.user.dashboardPins = normalized;
  }

  if (state.dashboardPinsSyncEnabled !== false) {
    try {
      await api('/api/me/dashboard-pins', {
        method: 'PUT',
        body: JSON.stringify({ dashboardPins: normalized })
      });
    } catch (_) {
      state.dashboardPinsSyncEnabled = false;
      // Fallback local: o banco ainda não expôs a coluna de favoritos no ambiente atual.
    }
  }
  return normalized;
}

window.saveDashboardPins = saveDashboardPins;

async function api(path, options = {}) {
  const headers = {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getSessionToken();
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
          ${error ? `<p style="color:var(--danger-text)">${error}</p>` : ''}
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
      setSessionToken(response.token);
      state.user = response.user;
      state.user.dashboardPins = normalizeDashboardPins([
        ...(Array.isArray(state.user.dashboardPins) ? state.user.dashboardPins : []),
        ...readStoredDashboardPins(state.user.id)
      ]);
      persistStoredDashboardPins(state.user.id, state.user.dashboardPins);
      applyTheme(state.user.theme);
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
  const activeSubKey = state.activeSub || (state.activeModule === 'sales' ? 'orders_quotes' : state.activeModule === 'cadastros' ? 'list' : state.activeModule === 'purchases' ? 'new_purchase' : state.activeModule === 'finance' ? 'dashboard' : state.activeModule === 'stock' ? 'products' : null);
  const activeSubLabel = (state.activeModule === 'cadastros' && activeSubKey === 'edit')
    ? 'Edição'
    : (state.activeModule === 'cadastros' && activeSubKey === 'register')
      ? 'Cadastro'
    : (state.activeModule === 'cadastros' && activeSubKey === 'deposits')
      ? 'Depósitos'
    : (state.activeModule === 'cadastros' && activeSubKey === 'deposits_register')
      ? 'Depósitos > Cadastro'
    : (state.activeModule === 'cadastros' && activeSubKey === 'deposits_edit')
      ? 'Depósitos > Edição'
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
                <div class="nav-item-row">
                  <button type="button" class="nav-item nav-open-item ${state.activeModule === module ? 'active' : ''}" data-module="${module}">
                    <span class="icon">${moduleIcons[module] || ''}</span>
                    <span class="text">${moduleLabels[module]}</span>
                  </button>
                  <button type="button" class="sidebar-pin-btn ${getDashboardPinSet().has(module) ? 'active' : ''}" data-pin-key="${module}" title="${getDashboardPinSet().has(module) ? 'Desfixar' : 'Fixar'} ${moduleLabels[module]}" aria-pressed="${getDashboardPinSet().has(module) ? 'true' : 'false'}">
                    ${favoriteIconSvg(getDashboardPinSet().has(module))}
                  </button>
                </div>
                <div class="submenu">
                  ${ (moduleSubItems[module] || []).map((sub) => `
                    <div class="sub-item-row">
                      <button type="button" class="sub-item sub-open-item ${state.activeModule === module && state.activeSub === sub.key ? 'active' : ''}" data-module="${module}" data-sub="${sub.key}">${sub.label}</button>
                      <button type="button" class="sidebar-pin-btn ${getDashboardPinSet().has(`${module}::${sub.key}`) ? 'active' : ''}" data-pin-key="${module}::${sub.key}" title="${getDashboardPinSet().has(`${module}::${sub.key}`) ? 'Desfixar' : 'Fixar'} ${sub.label}" aria-pressed="${getDashboardPinSet().has(`${module}::${sub.key}`) ? 'true' : 'false'}">
                        ${favoriteIconSvg(getDashboardPinSet().has(`${module}::${sub.key}`))}
                      </button>
                    </div>
                  `).join('') }
                </div>
              </div>
          `).join('')}
        </div>
      </aside>
      <aside class="secondary-sidebar ${showSecondarySidebar ? 'visible' : ''}"></aside>
      <main class="content">
        <div class="topbar">
          <div class="topbar-title-wrap">
            <button class="icon-btn back-btn" id="backBtn" title="Voltar para a tela anterior" aria-label="Voltar para a tela anterior" ${canGoBack() ? '' : 'disabled'}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 18l-6-6 6-6"></path>
              </svg>
            </button>
            <h1>${moduleLabels[state.activeModule]}${activeSubLabel ? ' > ' + activeSubLabel : ''}</h1>
          </div>
          <div class="topbar-actions">
            <button class="icon-btn" id="themeToggleBtn" title="Alternar tema claro/escuro" aria-label="Alternar tema claro/escuro">
              ${themeIconSvg(getTheme())}
            </button>
            ${hasModuleAccess('settings') ? `
            <button class="icon-btn settings-btn" id="settingsBtn" title="Configurações">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
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

  document.getElementById('backBtn')?.addEventListener('click', () => {
    goBackToPreviousRoute();
  });

  // main nav click handlers
  document.querySelectorAll('.nav-open-item').forEach((button) => {
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
  document.querySelectorAll('.sub-open-item').forEach((btn) => {
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

  document.querySelectorAll('.sidebar-pin-btn[data-pin-key]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pinKey = btn.dataset.pinKey;
      if (!pinKey) return;
      const currentPins = getDashboardPinSet();
      const nextPins = currentPins.has(pinKey)
        ? Array.from(currentPins).filter((item) => item !== pinKey)
        : Array.from(new Set([...currentPins, pinKey]));
      try {
        await saveDashboardPins(nextPins);
        renderApp();
        await loadModule(state.activeModule);
      } catch (error) {
        showToast(error.message || 'Erro ao salvar favoritos.', 'error');
      }
    });
  });

  document.getElementById('themeToggleBtn')?.addEventListener('click', async () => {
    const nextTheme = getTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerHTML = themeIconSvg(nextTheme);
    if (state.user) state.user.theme = nextTheme;
    try {
      await api('/api/me/theme', { method: 'PUT', body: JSON.stringify({ theme: nextTheme }) });
    } catch (error) {
      showToast(error.message || 'Erro ao salvar preferência de tema.', 'error');
    }
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

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (_) {
      // Ignore API logout errors and always clear local session.
    }
    clearSessionToken();
    localStorage.removeItem(LAST_ROUTE_KEY);
    state.user = null;
    state.selectedModule = null;
    state.moduleRouteHistory = {};
    state.isNavigatingBack = false;
    // Evita vazar rascunhos/depósitos não salvos do usuário anterior para o próximo login na mesma aba.
    state.cadastroDraft = { people: {}, cnpjs: {} };
    applyTheme('light');
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

const moduleIcons = {
  dashboard: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="12" width="7" height="9" rx="1.5"></rect><rect x="3" y="16" width="7" height="5" rx="1.5"></rect></svg>',
  sales: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>',
  purchases: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>',
  stock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline><polyline points="7.5 19.79 7.5 14.6 3 12"></polyline><polyline points="21 12 16.5 14.6 16.5 19.79"></polyline><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
  finance: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
  settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6"></path><path d="M4.22 4.22l4.24 4.24m3.08 3.08l4.24 4.24"></path><path d="M1 12h6m6 0h6"></path><path d="M4.22 19.78l4.24-4.24m3.08-3.08l4.24-4.24"></path></svg>',
  cadastros: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
};

// ============================================================================
// CONFIGURAÇÃO DAS ABAS (menu principal + submenus da sidebar)
// Cada chave de nível 1 é uma ABA principal; os arrays são as SUB-ABAS
// exibidas no submenu daquela aba.
// ============================================================================
const moduleSubItems = {
  // ABA: Dashboard Geral — sem sub-abas
  dashboard: [],

  // ABA: Vendas
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

  // ABA: Compras
  purchases: [
    { key: 'new_purchase', label: 'Nova compra' },
    { key: 'purchase_history', label: 'Histórico de compras' },
    { key: 'suppliers', label: 'Fornecedores' }
  ],

  // ABA: Estoque
  stock: [ { key: 'products', label: 'Produtos' }, { key: 'movements', label: 'Movimentos' } ],

  // ABA: Financeiro
  finance: [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'lancamentos', label: 'Lançamentos' },
    { key: 'novo_lancamento', label: 'Novo Lançamento' },
    { key: 'nfe_emitidas', label: 'NF-e Emitidas' },
    { key: 'nova_nfe_avulsa', label: 'Nova NF-e Avulsa' },
    { key: 'emitir_nfe_focus', label: 'Emitir NF-e (Focus)' },
    { key: 'extrato_open_finance', label: 'Extrato Open Finance' },
    { key: 'bancos_conectados', label: 'Bancos Conectados' }
  ],

  // ABA: Configurações
  settings: [ { key: 'users', label: 'Usuários' }, { key: 'company', label: 'Empresa' } ],

  // ABA: Cadastros
  cadastros: [
    { key: 'list', label: 'Cadastros' },
    { key: 'deposits', label: 'Depósitos' }
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

// Campo de busca reutilizável que substitui um <select> comum: digita
// qualquer parte do texto (ex.: "Marcos") e filtra entre TODAS as opções que
// contêm o termo (não só as que começam com ele, como o <select> nativo faz).
// Usa um <input type="hidden"> com o mesmo "name" por baixo, então
// FormData(form) continua funcionando exatamente igual a um <select>.
function renderSearchableSelect({ id, name, options, selectedValue, placeholder, required }) {
  const selected = options.find((o) => String(o.value) === String(selectedValue || ''));
  return `
    <div class="searchable-select" id="${id}Wrapper">
      <input type="text" class="searchable-select-input" id="${id}Input" autocomplete="off"
        placeholder="${escapeHtml(placeholder || 'Buscar...')}" value="${escapeHtml(selected ? selected.label : '')}" ${required ? 'required' : ''} />
      <input type="hidden" name="${name}" id="${id}Value" value="${escapeHtml(selectedValue || '')}" />
      <div class="searchable-select-dropdown" id="${id}Dropdown" hidden></div>
    </div>
  `;
}

// Chamar depois de inserir o HTML no DOM (mesmo padrão de outros handlers
// desta tela, que são reconectados a cada re-render). `onSelect(value, option)`
// dispara quando o usuário escolhe um item — `option` é o objeto original
// passado em `options`, útil pra ler outros campos dele (preço, sku etc.).
function attachSearchableSelect({ id, options, onSelect }) {
  const input = document.getElementById(`${id}Input`);
  const hidden = document.getElementById(`${id}Value`);
  const dropdown = document.getElementById(`${id}Dropdown`);
  if (!input || !hidden || !dropdown) return;

  function renderDropdown(filterText) {
    const term = (filterText || '').trim().toLowerCase();
    const filtered = term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options;
    dropdown.innerHTML = filtered.length
      ? filtered.slice(0, 50).map((o) => `<div class="searchable-select-option" data-value="${escapeHtml(String(o.value))}">${escapeHtml(o.label)}</div>`).join('')
      : '<div class="searchable-select-empty">Nenhum resultado</div>';
    dropdown.hidden = false;
  }

  input.addEventListener('focus', () => renderDropdown(''));
  input.addEventListener('input', () => {
    hidden.value = '';
    renderDropdown(input.value);
  });
  input.addEventListener('blur', () => {
    // atraso pra deixar o "mousedown" do clique na opção disparar antes do dropdown fechar
    setTimeout(() => { dropdown.hidden = true; }, 150);
  });
  dropdown.addEventListener('mousedown', (event) => {
    const optionEl = event.target.closest('.searchable-select-option');
    if (!optionEl) return;
    event.preventDefault();
    const value = optionEl.dataset.value;
    const found = options.find((o) => String(o.value) === String(value));
    hidden.value = value;
    input.value = found ? found.label : '';
    dropdown.hidden = true;
    if (onSelect) onSelect(value, found);
  });
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

function normalizeRegistrationText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getRegistrationAddressLine(record) {
  return record.address || record.street || '';
}

function buildRegistrationAddressKey(record) {
  const line = normalizeRegistrationText(getRegistrationAddressLine(record));
  if (!line) {
    return '';
  }
  return [
    line,
    normalizeRegistrationText(record.streetNumber || record.addressNumber || ''),
    normalizeRegistrationText(record.neighborhood || ''),
    normalizeRegistrationText(record.city || ''),
    normalizeRegistrationText(record.state || ''),
    sanitizeDigits(record.zipCode || '')
  ].join('|');
}

function getMissingRequiredRegistrationFields(record) {
  const missing = [];
  if (!String(record.name || '').trim()) missing.push('name');
  if (!String(record.document || '').trim()) missing.push('document');
  if (!record.foreignAddress) {
    if (!String(getRegistrationAddressLine(record)).trim()) missing.push('addressLine');
    if (!String(record.city || '').trim()) missing.push('city');
    if (!String(record.state || '').trim()) missing.push('state');
    if (!String(record.zipCode || '').trim()) missing.push('zipCode');
  }
  return missing;
}

function findDuplicateRegistrationClient(existingRecords, record, excludeId) {
  const document = sanitizeDigits(record.document || '');
  const name = normalizeRegistrationText(record.name || '');
  const addressKey = buildRegistrationAddressKey(record);

  for (const entry of existingRecords) {
    if (excludeId && entry.id === excludeId) {
      continue;
    }
    if (document && sanitizeDigits(entry.document || '') === document) {
      return `Já existe um cadastro com o CPF/CNPJ informado (${entry.name || 'sem nome'}).`;
    }
    if (name && normalizeRegistrationText(entry.name || '') === name) {
      return `Já existe um cadastro com o nome "${record.name}".`;
    }
    if (addressKey && buildRegistrationAddressKey(entry) === addressKey) {
      return 'Já existe um cadastro com este mesmo endereço.';
    }
  }
  return null;
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

function maskCep(value) {
  const digits = sanitizeDigits(value).slice(0, 8);
  return digits.replace(/^(\d{5})(\d)/, '$1-$2');
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

  trackRouteChange(moduleName, state.activeSub);
  syncBackButtonState();
  state.activeModule = moduleName;
  persistLastRoute();
  const content = document.getElementById('moduleContent');
  if (!content) {
    return;
  }

  try {
    if (window.MavisModuleRouter?.render) {
      const handled = await window.MavisModuleRouter.render(moduleName, {
        state,
        content,
        api,
        showToast,
        escapeHtml,
        moduleLabels,
        confirmModal,
        renderApp,
        loadModule
      });
      if (handled) {
        return;
      }
    }

    // ========================================================================
    // ABA: DASHBOARD GERAL
    // ========================================================================
    if (moduleName === 'dashboard') {
      if (window.MavisModuleRegistry?.dashboard) {
        await window.MavisModuleRegistry.dashboard({
          api,
          content,
          state,
          showToast,
          escapeHtml,
          renderApp,
          loadModule
        });
        return;
      }

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

    // ========================================================================
    // ABA: VENDAS (16 sub-abas — ver comentários abaixo de cada `sub ===`)
    // ========================================================================
    if (moduleName === 'sales') {
      const sub = state.activeSub || 'orders_quotes';

      const SALES_STATUS_BADGE_META = {
        'pendente': { label: 'Pendente', tone: 'warning' },
        'faturado': { label: 'Faturado', tone: 'success' },
        'cancelado': { label: 'Cancelado', tone: 'danger' },
        'em aberto': { label: 'Em aberto', tone: 'info' },
        'aprovado': { label: 'Aprovado', tone: 'success' },
        'reprovado': { label: 'Reprovado', tone: 'danger' },
        'emitida': { label: 'Emitida', tone: 'success' },
        'cancelada': { label: 'Cancelada', tone: 'danger' }
      };
      const salesStatusBadge = (status) => {
        const key = String(status || '').toLowerCase();
        const meta = SALES_STATUS_BADGE_META[key] || { label: status || '-', tone: 'muted' };
        return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
      };
      const salesFormatDate = (value) => {
        if (!value) return '-';
        const [y, m, d] = String(value).split('-');
        if (!y || !m || !d) return value;
        return `${d}/${m}/${y}`;
      };
      const salesFormatBRL = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      // Sub-aba: Pedidos e Orçamentos
      if (sub === 'orders_quotes') {
        const draft = state.salesDraft || (state.salesDraft = {});
        const filters = draft.ordersFilters || (draft.ordersFilters = { search: '', status: '', companyId: '', sellerId: '', clientSupplierId: '', dateFrom: '', dateTo: '' });
        const showFilters = Boolean(draft.showOrdersFilters);
        const page = draft.ordersPage || 1;
        const limit = 15;

        const params = new URLSearchParams({ view: 'orders_quotes', page: String(page), limit: String(limit) });
        Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });

        const data = await api(`/api/sales/records?${params.toString()}`);
        const records = data.records || [];
        const totalPages = Math.max(1, Math.ceil((data.total || 0) / limit));
        const meta = data.meta || { companies: [], sellers: [], deposits: [], directory: [] };

        content.innerHTML = `
          <div class="finance-stat-cards">
            ${financeStatCard({ tone: 'blue', label: 'Pedidos', value: String(data.orders?.length || 0) })}
            ${financeStatCard({ tone: 'purple', label: 'Orçamentos', value: String(data.quotes?.length || 0) })}
            ${financeStatCard({ tone: 'teal', label: 'NF-e', value: String(data.nfes?.length || 0) })}
            ${financeStatCard({ tone: 'cyan', label: 'Importações', value: String(data.importLogs?.length || 0) })}
          </div>
          <div class="cadastro-page-head">
            <div>
              <h3>Pedidos e Orçamentos</h3>
              <p class="muted">${data.total || 0} registro${data.total === 1 ? '' : 's'} encontrado${data.total === 1 ? '' : 's'}</p>
            </div>
            <div class="cadastro-list-actions">
              <button type="button" onclick="state.salesDraft.editRecord=null; state.activeSub='new_order'; renderApp(); loadModule('sales');">+ Novo Pedido</button>
              <button type="button" class="secondary" onclick="state.salesDraft.editRecord=null; state.activeSub='new_quote'; renderApp(); loadModule('sales');">+ Novo Orçamento</button>
              <button type="button" class="secondary" id="salesFilterToggleBtn">${showFilters ? 'Ocultar filtros' : 'Busca avançada'}</button>
            </div>
          </div>

          <form id="salesQuickSearchForm" class="row" style="margin-bottom: 12px;">
            <label class="cadastro-field" style="grid-column: span 3;">
              <span>Busca</span>
              <input id="salesQuickSearch" name="search" value="${escapeHtml(filters.search)}" placeholder="Código ou cliente" />
            </label>
            <div style="align-self: end;"><button type="submit" class="secondary">Buscar</button></div>
          </form>

          ${showFilters ? `
            <form id="salesFilterForm" class="cadastro-filter-panel">
              <div class="cadastro-filter-grid-5">
                <label class="cadastro-field">
                  <span>Status</span>
                  <select name="status">
                    <option value="">Todos</option>
                    ${['pendente', 'faturado', 'cancelado', 'em aberto', 'aprovado', 'reprovado'].map((value) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${value.charAt(0).toUpperCase() + value.slice(1)}</option>`).join('')}
                  </select>
                </label>
                <label class="cadastro-field">
                  <span>Empresa</span>
                  <select name="companyId">
                    <option value="">Todas</option>
                    ${meta.companies.map((c) => `<option value="${escapeHtml(c.id)}" ${filters.companyId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                  </select>
                </label>
                <label class="cadastro-field">
                  <span>Vendedor</span>
                  <select name="sellerId">
                    <option value="">Todos</option>
                    ${meta.sellers.map((s) => `<option value="${escapeHtml(s.id)}" ${filters.sellerId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                  </select>
                </label>
                <label class="cadastro-field">
                  <span>Cliente/Fornecedor</span>
                  <select name="clientSupplierId">
                    <option value="">Todos</option>
                    ${meta.directory.map((c) => `<option value="${escapeHtml(c.id)}" ${filters.clientSupplierId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                  </select>
                </label>
                <label class="cadastro-field">
                  <span>Data inicial</span>
                  <input type="date" name="dateFrom" value="${escapeHtml(filters.dateFrom)}" />
                </label>
                <label class="cadastro-field">
                  <span>Data final</span>
                  <input type="date" name="dateTo" value="${escapeHtml(filters.dateTo)}" />
                </label>
              </div>
              <div class="cadastro-filter-actions">
                <button type="submit">Aplicar filtros</button>
                <button type="button" class="secondary" id="salesFilterClearBtn">Limpar filtros</button>
              </div>
            </form>
          ` : ''}

          <div class="panel">
            <div class="table-scroll">
              <table class="table table-actions">
                <thead><tr><th>Código</th><th>Tipo</th><th>Data</th><th>Cliente</th><th>Empresa</th><th>Vendedor</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead>
                <tbody>
                  ${records.length ? records.map((record) => `
                    <tr>
                      <td>${escapeHtml(String(record.code))}</td>
                      <td>${record.type === 'quote' ? 'Orçamento' : 'Pedido'}</td>
                      <td>${salesFormatDate(record.date)}</td>
                      <td>${escapeHtml(record.customer)}</td>
                      <td>${escapeHtml(record.companyName || '-')}</td>
                      <td>${escapeHtml(record.sellerName || '-')}</td>
                      <td>${salesFormatBRL(record.amount)}</td>
                      <td>${salesStatusBadge(record.status)}</td>
                      <td>
                        <button class="icon-button edit sales-edit-record" data-id="${escapeHtml(record.id)}" title="Editar" aria-label="Editar">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                        </button>
                        <button class="icon-button sales-delete-record" data-id="${escapeHtml(record.id)}" title="Excluir" aria-label="Excluir">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                        </button>
                      </td>
                    </tr>
                  `).join('') : `<tr><td colspan="9" class="muted">Nenhum pedido ou orçamento encontrado${filters.search || showFilters ? ' com os filtros atuais' : ''}.</td></tr>`}
                </tbody>
              </table>
            </div>
            <div class="finance-pagination">
              <button type="button" class="secondary" id="salesPrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
              <span class="muted">Página ${page} de ${totalPages}</span>
              <button type="button" class="secondary" id="salesNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
            </div>
          </div>
        `;

        document.getElementById('salesFilterToggleBtn')?.addEventListener('click', () => {
          state.salesDraft.showOrdersFilters = !showFilters;
          loadModule('sales');
        });
        document.getElementById('salesQuickSearchForm')?.addEventListener('submit', (event) => {
          event.preventDefault();
          filters.search = document.getElementById('salesQuickSearch').value;
          state.salesDraft.ordersPage = 1;
          loadModule('sales');
        });
        document.getElementById('salesFilterForm')?.addEventListener('submit', (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          filters.status = formData.get('status') || '';
          filters.companyId = formData.get('companyId') || '';
          filters.sellerId = formData.get('sellerId') || '';
          filters.clientSupplierId = formData.get('clientSupplierId') || '';
          filters.dateFrom = formData.get('dateFrom') || '';
          filters.dateTo = formData.get('dateTo') || '';
          state.salesDraft.ordersPage = 1;
          loadModule('sales');
        });
        document.getElementById('salesFilterClearBtn')?.addEventListener('click', () => {
          Object.assign(filters, { search: '', status: '', companyId: '', sellerId: '', clientSupplierId: '', dateFrom: '', dateTo: '' });
          state.salesDraft.ordersPage = 1;
          loadModule('sales');
        });
        document.getElementById('salesPrevPage')?.addEventListener('click', () => {
          if (page > 1) { state.salesDraft.ordersPage = page - 1; loadModule('sales'); }
        });
        document.getElementById('salesNextPage')?.addEventListener('click', () => {
          if (page < totalPages) { state.salesDraft.ordersPage = page + 1; loadModule('sales'); }
        });
        document.querySelectorAll('.sales-edit-record').forEach((btn) => {
          btn.addEventListener('click', () => {
            const record = records.find((entry) => entry.id === btn.dataset.id);
            if (!record) return;
            state.salesDraft.editRecord = record;
            state.activeSub = record.type === 'quote' ? 'new_quote' : 'new_order';
            renderApp();
            loadModule('sales');
          });
        });
        document.querySelectorAll('.sales-delete-record').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const confirmed = await confirmModal('Confirma excluir este registro?');
            if (!confirmed) return;
            try {
              await api(`/api/sales/records/${btn.dataset.id}`, { method: 'DELETE' });
              showToast('Registro excluído com sucesso.', 'success');
              loadModule('sales');
            } catch (error) {
              showToast(error.message || 'Erro ao excluir registro.', 'error');
            }
          });
        });
        return;
      }

      // Sub-abas: Novo Pedido / Novo Orçamento — mesmo formulário, só muda o tipo
      // (evita duplicar a lógica de itens/totais entre as duas telas).
      if (sub === 'new_order' || sub === 'new_quote') {
        const recordType = sub === 'new_order' ? 'order' : 'quote';
        const editRecord = state.salesDraft?.editRecord && state.salesDraft.editRecord.type === recordType
          ? state.salesDraft.editRecord
          : null;
        const isEditing = Boolean(editRecord);
        const title = recordType === 'order' ? 'Pedido' : 'Orçamento';
        const statusOptions = recordType === 'order'
          ? [{ value: 'pendente', label: 'Pendente' }, { value: 'faturado', label: 'Faturado' }, { value: 'cancelado', label: 'Cancelado' }]
          : [{ value: 'em aberto', label: 'Em aberto' }, { value: 'aprovado', label: 'Aprovado' }, { value: 'reprovado', label: 'Reprovado' }];

        let meta = { companies: [], sellers: [], deposits: [], directory: [], products: [] };
        try {
          meta = await api('/api/sales/meta');
        } catch (error) {
          showToast('Não foi possível carregar clientes/empresas/produtos para o formulário.', 'warning');
        }

        let items = isEditing ? (editRecord.items || []).map((item) => ({ ...item })) : [];
        let discountAmount = isEditing ? Number(editRecord.discountAmount || 0) : 0;
        let discountPercent = isEditing ? Number(editRecord.discountPercent || 0) : 0;
        let freight = isEditing ? Number(editRecord.freight || 0) : 0;

        // O formulário inteiro é redesenhado a cada produto adicionado/removido (mais simples
        // que atualizar só a tabela). Isso apagaria os campos de cabeçalho já preenchidos, então
        // o valor atual é salvo aqui antes de cada redesenho e usado para repopular o HTML novo.
        const formState = {
          clientSupplierId: editRecord?.clientSupplierId || '',
          companyId: editRecord?.companyId || '',
          sellerId: editRecord?.sellerId || '',
          depositId: editRecord?.depositId || '',
          status: editRecord?.status || statusOptions[0].value,
          date: editRecord?.date || new Date().toISOString().slice(0, 10),
          dueDate: editRecord?.dueDate || '',
          note: editRecord?.note || ''
        };
        const syncFormState = () => {
          const form = document.getElementById('salesRecordForm');
          if (!form) return;
          formState.clientSupplierId = form.querySelector('[name="clientSupplierId"]')?.value || '';
          formState.companyId = form.querySelector('[name="companyId"]')?.value || '';
          formState.sellerId = form.querySelector('[name="sellerId"]')?.value || '';
          formState.depositId = form.querySelector('[name="depositId"]')?.value || '';
          formState.status = form.querySelector('[name="status"]')?.value || formState.status;
          formState.date = form.querySelector('[name="date"]')?.value || formState.date;
          formState.dueDate = form.querySelector('[name="dueDate"]')?.value || formState.dueDate;
          formState.note = form.querySelector('[name="note"]')?.value || '';
        };

        const computeTotals = () => {
          const itemsTotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
          const percentOff = itemsTotal * (Number(discountPercent || 0) / 100);
          const totalAmount = Math.max(0, itemsTotal - Number(discountAmount || 0) - percentOff + Number(freight || 0));
          return { itemsTotal, totalAmount };
        };

        const renderForm = () => {
          const { itemsTotal, totalAmount } = computeTotals();

          content.innerHTML = `
            <div class="cadastro-page-head">
              <div>
                <h3>${isEditing ? `Editar ${title} #${escapeHtml(String(editRecord.code))}` : `Novo ${title}`}</h3>
                <p class="muted">${isEditing ? 'Código gerado automaticamente na criação.' : 'O código é gerado automaticamente ao salvar.'}</p>
              </div>
            </div>

            <div class="panel">
              <form id="salesRecordForm" class="form-grid">
                <div class="row">
                  <label>Cliente/Fornecedor *
                    ${renderSearchableSelect({ id: 'salesClientSupplier', name: 'clientSupplierId', options: meta.directory.map((entry) => ({ value: entry.id, label: entry.name })), selectedValue: formState.clientSupplierId, placeholder: 'Buscar por nome...', required: true })}
                  </label>
                  <label>Empresa
                    ${renderSearchableSelect({ id: 'salesCompany', name: 'companyId', options: meta.companies.map((c) => ({ value: c.id, label: c.name })), selectedValue: formState.companyId, placeholder: 'Buscar empresa...' })}
                  </label>
                  <button type="button" class="icon-button edit" id="salesQuickAddCompany" title="Nova empresa">+</button>
                </div>
                <div id="salesInlineAddCompanyRow" class="row hidden" style="margin-top: -8px;">
                  <label>Nome da empresa<input id="salesNewCompanyName" placeholder="Razão social" /></label>
                  <label>CNPJ<input id="salesNewCompanyDocument" placeholder="Somente números" /></label>
                  <div style="align-self: end;"><button type="button" class="secondary" id="salesSaveNewCompany">Salvar empresa</button></div>
                </div>

                <div class="row">
                  <label>Vendedor
                    ${renderSearchableSelect({ id: 'salesSeller', name: 'sellerId', options: meta.sellers.map((s) => ({ value: s.id, label: s.name })), selectedValue: formState.sellerId, placeholder: 'Buscar vendedor...' })}
                  </label>
                  <label>Depósito
                    ${renderSearchableSelect({ id: 'salesDeposit', name: 'depositId', options: meta.deposits.map((d) => ({ value: d.id, label: d.name })), selectedValue: formState.depositId, placeholder: 'Buscar depósito...' })}
                  </label>
                  <label>Status
                    <select name="status">
                      ${statusOptions.map((opt) => `<option value="${opt.value}" ${formState.status === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>
                  </label>
                </div>

                ${meta.sellers.length === 0 ? '<p class="muted">Nenhum vendedor cadastrado — em Cadastros, marque uma pessoa com o papel "Vendedor" para que ela apareça aqui.</p>' : ''}

                <div class="cadastro-section">
                  <div class="cadastro-section-header">
                    <h4>Produtos</h4>
                    <p>Adicione um ou mais produtos ao ${title.toLowerCase()}.</p>
                  </div>
                  <div class="cadastro-section-body">
                    <div class="row">
                      <label style="flex: 2;">Produto
                        ${renderSearchableSelect({ id: 'salesProduct', name: 'productPick', options: meta.products.map((p) => ({ value: p.id, label: `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${salesFormatBRL(p.salePrice)}` })), selectedValue: '', placeholder: 'Buscar produto...' })}
                      </label>
                      <label>Quantidade<input id="salesProductQty" type="number" min="1" step="1" value="1" /></label>
                      <div style="align-self: end;"><button type="button" class="secondary" id="salesAddItemBtn">+ Adicionar</button></div>
                    </div>

                    <div class="table-scroll" style="margin-top: 12px;">
                      <table class="table table-actions">
                        <thead><tr><th>Produto</th><th>Qtd.</th><th>Preço unit.</th><th>Total</th><th>Ações</th></tr></thead>
                        <tbody>
                          ${items.length ? items.map((item, index) => `
                            <tr>
                              <td>${escapeHtml(item.name)}</td>
                              <td><input type="number" min="1" step="1" class="sales-item-qty" data-index="${index}" value="${item.quantity}" style="width: 80px;" /></td>
                              <td><input type="number" min="0" step="0.01" class="sales-item-price" data-index="${index}" value="${item.unitPrice}" style="width: 110px;" /></td>
                              <td>${salesFormatBRL(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td>
                              <td><button type="button" class="icon-button sales-remove-item" data-index="${index}" title="Remover">×</button></td>
                            </tr>
                          `).join('') : '<tr><td colspan="5" class="muted">Nenhum produto adicionado ainda.</td></tr>'}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div class="row">
                  <label>Desconto (R$)<input name="discountAmount" type="number" min="0" step="0.01" value="${discountAmount}" /></label>
                  <label>Desconto (%)<input name="discountPercent" type="number" min="0" max="100" step="0.01" value="${discountPercent}" /></label>
                  <label>Frete (R$)<input name="freight" type="number" min="0" step="0.01" value="${freight}" /></label>
                </div>
                <div class="row">
                  <label>Subtotal dos produtos<input value="${salesFormatBRL(itemsTotal)}" disabled /></label>
                  <label><strong>Total do ${title.toLowerCase()}</strong><input value="${salesFormatBRL(totalAmount)}" disabled style="font-weight: 700;" /></label>
                </div>

                <div class="row">
                  <label>Data<input name="date" type="date" value="${formState.date}" /></label>
                  ${recordType === 'quote' ? `<label>Validade<input name="dueDate" type="date" value="${formState.dueDate}" /></label>` : ''}
                </div>
                <div class="row">
                  <label style="flex: 1;">Observações<textarea name="note" rows="3">${escapeHtml(formState.note)}</textarea></label>
                </div>

                <button type="submit">${isEditing ? `Salvar alterações` : `Salvar ${title.toLowerCase()}`}</button>
              </form>
            </div>
          `;

          attachSearchableSelect({ id: 'salesClientSupplier', options: meta.directory.map((entry) => ({ value: entry.id, label: entry.name })) });
          attachSearchableSelect({ id: 'salesCompany', options: meta.companies.map((c) => ({ value: c.id, label: c.name })) });
          attachSearchableSelect({ id: 'salesSeller', options: meta.sellers.map((s) => ({ value: s.id, label: s.name })) });
          attachSearchableSelect({ id: 'salesDeposit', options: meta.deposits.map((d) => ({ value: d.id, label: d.name })) });
          attachSearchableSelect({
            id: 'salesProduct',
            options: meta.products.map((p) => ({ value: p.id, label: `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${salesFormatBRL(p.salePrice)}`, product: p }))
          });

          document.getElementById('salesQuickAddCompany')?.addEventListener('click', () => {
            document.getElementById('salesInlineAddCompanyRow')?.classList.toggle('hidden');
          });
          document.getElementById('salesSaveNewCompany')?.addEventListener('click', async () => {
            const name = document.getElementById('salesNewCompanyName')?.value.trim();
            if (!name) {
              showToast('Informe o nome da empresa.', 'warning');
              return;
            }
            try {
              const res = await api('/api/cadastros/empresas', {
                method: 'POST',
                body: JSON.stringify({ name, document: document.getElementById('salesNewCompanyDocument')?.value.trim() || '' })
              });
              meta.companies.push(res.company);
              showToast('Empresa cadastrada com sucesso.', 'success');
              const hidden = document.getElementById('salesCompanyValue');
              const input = document.getElementById('salesCompanyInput');
              if (hidden) hidden.value = res.company.id;
              if (input) input.value = res.company.name;
              document.getElementById('salesInlineAddCompanyRow')?.classList.add('hidden');
            } catch (error) {
              showToast(error.message || 'Erro ao cadastrar empresa.', 'error');
            }
          });

          document.getElementById('salesAddItemBtn')?.addEventListener('click', () => {
            const productId = document.getElementById('salesProductValue')?.value;
            const qtyInput = document.getElementById('salesProductQty');
            const product = meta.products.find((p) => p.id === productId);
            if (!productId || !product) {
              showToast('Selecione um produto.', 'warning');
              return;
            }
            const quantity = Math.max(1, Number(qtyInput?.value || 1));
            items.push({
              productId: product.id,
              name: product.name,
              sku: product.sku || '',
              quantity,
              unitPrice: Number(product.salePrice || 0)
            });
            syncFormState();
            renderForm();
          });

          content.querySelectorAll('.sales-remove-item').forEach((btn) => {
            btn.addEventListener('click', () => {
              items.splice(Number(btn.dataset.index), 1);
              syncFormState();
              renderForm();
            });
          });
          content.querySelectorAll('.sales-item-qty').forEach((input) => {
            input.addEventListener('change', () => {
              items[Number(input.dataset.index)].quantity = Math.max(1, Number(input.value || 1));
              syncFormState();
              renderForm();
            });
          });
          content.querySelectorAll('.sales-item-price').forEach((input) => {
            input.addEventListener('change', () => {
              items[Number(input.dataset.index)].unitPrice = Math.max(0, Number(input.value || 0));
              syncFormState();
              renderForm();
            });
          });

          const form = document.getElementById('salesRecordForm');
          form.querySelector('[name="discountAmount"]').addEventListener('change', (e) => { discountAmount = Number(e.target.value || 0); syncFormState(); renderForm(); });
          form.querySelector('[name="discountPercent"]').addEventListener('change', (e) => { discountPercent = Number(e.target.value || 0); syncFormState(); renderForm(); });
          form.querySelector('[name="freight"]').addEventListener('change', (e) => { freight = Number(e.target.value || 0); syncFormState(); renderForm(); });

          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!items.length) {
              showToast('Adicione ao menos um produto.', 'warning');
              return;
            }
            const formData = new FormData(form);
            const clientEntry = meta.directory.find((entry) => entry.id === formData.get('clientSupplierId'));
            const payload = {
              type: recordType,
              clientSupplierId: formData.get('clientSupplierId') || '',
              clientSupplierName: clientEntry ? clientEntry.name : '',
              companyId: formData.get('companyId') || '',
              sellerId: formData.get('sellerId') || '',
              depositId: formData.get('depositId') || '',
              date: formData.get('date') || '',
              dueDate: formData.get('dueDate') || '',
              items: items.map((item) => ({ productId: item.productId, name: item.name, sku: item.sku, quantity: item.quantity, unitPrice: item.unitPrice })),
              discountAmount,
              discountPercent,
              freight,
              status: formData.get('status') || '',
              note: formData.get('note') || ''
            };
            try {
              if (isEditing) {
                await api(`/api/sales/records/${editRecord.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                showToast(`${title} atualizado com sucesso.`, 'success');
              } else {
                await api('/api/sales/records', { method: 'POST', body: JSON.stringify(payload) });
                showToast(`${title} salvo com sucesso.`, 'success');
              }
              state.salesDraft.editRecord = null;
              state.activeSub = 'orders_quotes';
              renderApp();
              loadModule('sales');
            } catch (error) {
              showToast(error.message || `Erro ao salvar ${title.toLowerCase()}.`, 'error');
            }
          });
        };

        renderForm();
        return;
      }

      // Sub-aba: NF-e Emitidas
      if (sub === 'nfes') {
        const data = await api('/api/sales/records?view=nfes');
        content.innerHTML = `
          <div class="cadastro-page-head">
            <div>
              <h3>NF-e Emitidas</h3>
              <p class="muted">${data.nfes.length} nota${data.nfes.length === 1 ? '' : 's'} encontrada${data.nfes.length === 1 ? '' : 's'}</p>
            </div>
            <div class="cadastro-list-actions">
              <button type="button" onclick="state.activeSub='new_nfe'; renderApp(); loadModule('sales');">+ Nova NF-e Avulsa</button>
            </div>
          </div>
          <div class="panel">
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Número</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead>
                <tbody>
                  ${data.nfes.length ? data.nfes.map((nfe) => `
                    <tr>
                      <td>${escapeHtml(nfe.number || nfe.id)}</td>
                      <td>${escapeHtml(nfe.customer)}</td>
                      <td>${salesFormatDate(nfe.date)}</td>
                      <td>${salesFormatBRL(nfe.amount)}</td>
                      <td>${salesStatusBadge(nfe.status || 'emitida')}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" class="muted">Nenhuma NF-e emitida.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        `;
        return;
      }

      // Sub-aba: Nova NF-e Avulsa
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

      // Sub-aba: Log's Vendas Importadas
      if (sub === 'import_logs') {
        const data = await api('/api/sales/records?view=import_logs');
        content.innerHTML = `
          <div class="cadastro-page-head">
            <div>
              <h3>Log's Vendas Importadas</h3>
              <p class="muted">${data.importLogs.length} importação${data.importLogs.length === 1 ? '' : 'ões'} registrada${data.importLogs.length === 1 ? '' : 's'}</p>
            </div>
            <div class="cadastro-list-actions">
              <button type="button" onclick="state.activeSub='import_sales'; renderApp(); loadModule('sales');">+ Importar Vendas</button>
            </div>
          </div>
          <div class="panel">
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Origem</th><th>Tipo</th><th>Itens</th><th>Data</th></tr></thead>
                <tbody>
                  ${data.importLogs.length ? data.importLogs.map((entry) => `
                    <tr>
                      <td>${escapeHtml(entry.source || 'manual')}</td>
                      <td>${escapeHtml(entry.type || 'order')}</td>
                      <td>${entry.count || 0}</td>
                      <td>${escapeHtml(new Date(entry.createdAt).toLocaleString('pt-BR'))}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="4" class="muted">Nenhuma importação registrada.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        `;
        return;
      }

      // Sub-aba: Agrupamento de Pedidos
      if (sub === 'order_groups') {
        content.innerHTML = `
          <div class="cadastro-page-head">
            <div>
              <h3>Agrupamento de Pedidos</h3>
              <p class="muted">Visualize e gerencie grupos de pedidos.</p>
            </div>
            <div class="cadastro-list-actions">
              <button type="button" onclick="state.activeSub='new_order_group'; renderApp(); loadModule('sales');">+ Novo Agrupamento</button>
            </div>
          </div>
          <div class="panel">
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>ID Grupo</th><th>Qtd. Pedidos</th><th>Valor Total</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td colspan="4" class="muted">Nenhum agrupamento salvo</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
        return;
      }

      // Sub-aba: Novo Agrupamento de Pedidos
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
          showToast('Funcionalidade de agrupamento será implementada em breve.', 'warning');
          state.activeSub = 'order_groups';
          renderApp();
          loadModule('sales');
        });
        return;
      }

      // Sub-aba: Devoluções
      if (sub === 'returns') {
        content.innerHTML = `
          <div class="cadastro-page-head">
            <div>
              <h3>Devoluções</h3>
              <p class="muted">Gerencie devoluções de produtos.</p>
            </div>
            <div class="cadastro-list-actions">
              <button type="button" class="secondary" onclick="window.notifyToast('Registrar devolução será implementado em breve.', 'warning')">+ Registrar Devolução</button>
            </div>
          </div>
          <div class="panel">
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>ID Devolução</th><th>Pedido Original</th><th>Cliente</th><th>Data</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td colspan="5" class="muted">Nenhuma devolução registrada</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
        return;
      }

      // Sub-aba: Painel Vendas
      if (sub === 'sales_dashboard') {
        const { overview } = await api('/api/sales/dashboard');
        content.innerHTML = `
          <div class="finance-stat-cards">
            ${financeStatCard({ tone: 'blue', label: 'Pedidos', value: String(overview.totalPedidos), sub: salesFormatBRL(overview.valorPedidos) })}
            ${financeStatCard({ tone: 'purple', label: 'Orçamentos', value: String(overview.totalOrcamentos), sub: salesFormatBRL(overview.valorOrcamentos) })}
            ${financeStatCard({ tone: 'green', label: 'Pedidos faturados', value: String(overview.pedidosFaturados) })}
            ${financeStatCard({ tone: 'red', label: 'Pedidos pendentes', value: String(overview.pedidosPendentes) })}
            ${financeStatCard({ tone: 'teal', label: 'Ticket médio', value: salesFormatBRL(overview.ticketMedio) })}
          </div>
          <div class="panel">
            <h3>Painel de Vendas</h3>
            <p class="muted">Acompanhamento de performance de vendas e indicadores.</p>
          </div>
        `;
        return;
      }

      // Sub-aba: Painel Vendedor
      if (sub === 'seller_dashboard') {
        const { bySeller } = await api('/api/sales/dashboard');

        if (!bySeller.length) {
          content.innerHTML = `
            <div class="panel">
              <h3>Painel do Vendedor</h3>
              <p class="muted">Nenhum vendedor cadastrado — em Cadastros, marque uma pessoa com o papel "Vendedor" para que ela apareça aqui.</p>
            </div>
          `;
          return;
        }

        const draft = state.salesDraft || {};
        const selectedSellerId = bySeller.some((s) => s.sellerId === draft.sellerDashboardId) ? draft.sellerDashboardId : bySeller[0].sellerId;
        const selected = bySeller.find((s) => s.sellerId === selectedSellerId);

        const renderSellerPanel = () => `
          <div class="finance-stat-cards">
            ${financeStatCard({ tone: 'blue', label: 'Pedidos', value: String(selected.totalPedidos) })}
            ${financeStatCard({ tone: 'green', label: 'Total vendido', value: salesFormatBRL(selected.valorTotal) })}
            ${financeStatCard({ tone: 'teal', label: 'Ticket médio', value: salesFormatBRL(selected.ticketMedio) })}
          </div>
          <div class="panel">
            <h3>Painel do Vendedor</h3>
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Pedido</th><th>Cliente</th><th>Valor</th><th>Data</th><th>Status</th></tr></thead>
                <tbody>
                  ${selected.orders.length ? selected.orders.map((o) => `
                    <tr>
                      <td>${escapeHtml(o.code)}</td>
                      <td>${escapeHtml(o.customer)}</td>
                      <td>${salesFormatBRL(o.amount)}</td>
                      <td>${salesFormatDate(o.date)}</td>
                      <td>${salesStatusBadge(o.status)}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" class="muted">Nenhuma venda realizada</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        `;

        content.innerHTML = `
          <div class="panel">
            <label>Vendedor
              <select id="sellerDashboardSelect">
                ${bySeller.map((s) => `<option value="${s.sellerId}" ${s.sellerId === selectedSellerId ? 'selected' : ''}>${escapeHtml(s.sellerName)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div id="sellerDashboardPanel">${renderSellerPanel()}</div>
        `;

        document.getElementById('sellerDashboardSelect')?.addEventListener('change', (event) => {
          state.salesDraft = { ...state.salesDraft, sellerDashboardId: event.target.value };
          loadModule('sales');
        });
        return;
      }

      // Sub-aba: Vales de Crédito
      if (sub === 'credits') {
        content.innerHTML = `
          <div class="cadastro-page-head">
            <div>
              <h3>Vales de Crédito</h3>
              <p class="muted">Gerencie vales de crédito de clientes.</p>
            </div>
            <div class="cadastro-list-actions">
              <button type="button" class="secondary" onclick="window.notifyToast('Emitir novo vale será implementado em breve.', 'warning')">+ Emitir Vale</button>
            </div>
          </div>
          <div class="panel">
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Cliente</th><th>Saldo Vale</th><th>Data Emissão</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td colspan="4" class="muted">Nenhum vale registrado</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
        return;
      }

      // Sub-aba: Central de Integrações
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

      // Sub-aba: Configurar Promoções
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

      // Sub-aba: Nova Promoção
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
          showToast('Cadastro de promoções será implementado em breve. Nada foi salvo.', 'warning');
          state.activeSub = 'configure_promotions';
          renderApp();
          loadModule('sales');
        });
        return;
      }

      // Sub-aba: Importar Vendas
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
                <label>Origem<input name="source" value="importação-csv" /></label>
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
            showToast('Importação realizada com sucesso.', 'success');
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

    // ========================================================================
    // ABA: CADASTROS (sub-abas: Cadastros/list, Cadastro/register, Edição/edit,
    // Depósitos/deposits, Depósitos>Cadastro/deposits_register,
    // Depósitos>Edição/deposits_edit — ver funções renderXxx mais abaixo)
    // ========================================================================
    if (moduleName === 'cadastros') {
      const [peopleResponse, cnpjsResponse, depositsResponse] = await Promise.all([
        api('/api/cadastros/pessoas'),
        api('/api/cadastros/cnpjs'),
        api('/api/cadastros/deposits')
      ]);
      const rawSub = state.activeSub || 'list';
      const sub = ['edit', 'register', 'list', 'deposits', 'deposits_register', 'deposits_edit'].includes(rawSub)
        ? rawSub
        : 'list';
      const people = Array.isArray(peopleResponse.people) ? peopleResponse.people : [];
      const cnpjs = Array.isArray(cnpjsResponse.cnpjs) ? cnpjsResponse.cnpjs : [];
      const deposits = Array.isArray(depositsResponse.deposits) ? depositsResponse.deposits : [];
      const peopleDraft = state.cadastroDraft.people || {};
      const cnpjDraft = state.cadastroDraft.cnpjs || {};
      const depositDraft = state.cadastroDraft.depositForm || {};
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
      const depositsFilters = {
        show: Boolean(state.cadastroDraft.depositsFilters?.show),
        query: state.cadastroDraft.depositsFilters?.query || '',
        code: state.cadastroDraft.depositsFilters?.code || '',
        city: state.cadastroDraft.depositsFilters?.city || '',
        state: state.cadastroDraft.depositsFilters?.state || '',
        manager: state.cadastroDraft.depositsFilters?.manager || '',
        status: state.cadastroDraft.depositsFilters?.status || 'all'
      };

      const formatDate = (value) => {
        if (!value) return '-';
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString('pt-BR');
      };

      const roles = [
        'Cliente', 'Transportadora', 'Técnico', 'Fornecedor', 'Colaborador', 'Representada', 'Vendedor', 'Líder', 'Gerente', 'Credenciadora', 'Fabricante'
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

      const field = (label, name, value = '', attrs = '', hasError = false) => `
        <label class="cadastro-field${hasError ? ' cadastro-field-invalid' : ''}">
          <span>${label}</span>
          <input name="${name}" value="${escapeHtml(value)}" ${attrs} />
          ${hasError ? '<span class="cadastro-field-error-msg">Campo obrigatório*</span>' : ''}
        </label>
      `;

      const selectField = (label, name, value, options = [], attrs = '', hasError = false) => `
        <label class="cadastro-field${hasError ? ' cadastro-field-invalid' : ''}">
          <span>${label}</span>
          <select name="${name}" ${attrs}>
            ${options.map((option) => `<option value="${option.value}" ${option.value === value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
          ${hasError ? '<span class="cadastro-field-error-msg">Campo obrigatório*</span>' : ''}
        </label>
      `;

      const checkbox = (name, labelText, checked = false, value = '') => `
        <label class="cadastro-check">
          <input type="checkbox" name="${name}" ${value ? `value="${escapeHtml(value)}"` : ''} ${checked ? 'checked' : ''} />
          <span>${labelText}</span>
        </label>
      `;

      // Sub-abas: Cadastro (mode 'register') e Edição (mode 'edit')
      const renderPeopleRegister = (mode = 'register') => {
        const isEditMode = mode === 'edit';
        const documentType = getDocumentType(peopleDraft.document);
        const selectedType = peopleDraft.type || (documentType === 'cnpj' ? 'pessoa-juridica' : 'pessoa-fisica');
        const documentValue = maskDocumentValue(peopleDraft.document || '', selectedType);
        const canLookupCnpj = sanitizeDigits(peopleDraft.document || '').length === 14;
        const fieldErrors = peopleDraft.fieldErrors || {};

        return `
          <div class="panel cadastros-shell">
            <div class="cadastro-page-head">
              <div>
                <h3>${isEditMode ? 'Edição de cadastro' : 'Cadastro de pessoas'}</h3>
                <p class="muted">${isEditMode ? 'Tela exclusiva para atualização de cadastros existentes.' : 'Padronizado para pessoa física e jurídica, com validação de documento.'}</p>
              </div>
              <div class="cadastro-page-chip">${peopleDraft.code ? `Código ${escapeHtml(peopleDraft.code)}` : (isEditMode ? 'Edição' : 'Dados básicos')}</div>
            </div>
            <form id="peopleRegisterForm" class="cadastro-form">
              ${section('Identificação', `
                <div class="cadastro-grid cadastro-grid-3 cadastro-align-bottom">
                  ${field('Nome ou razão social', 'name', peopleDraft.name || '', '', Boolean(fieldErrors.name))}
                  <label class="cadastro-field cadastro-field-inline${fieldErrors.document ? ' cadastro-field-invalid' : ''}">
                    <span>CPF / CNPJ</span>
                    <div class="cadastro-inline-action">
                      <input name="document" value="${escapeHtml(documentValue)}" id="peopleDocumentInput" inputmode="numeric" maxlength="18" />
                      <button type="button" id="peopleLookupBtn" class="icon-button edit" ${canLookupCnpj ? '' : 'disabled'} title="Consultar CNPJ" aria-label="Consultar CNPJ">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                      </button>
                    </div>
                    ${fieldErrors.document ? '<span class="cadastro-field-error-msg">Campo obrigatório*</span>' : ''}
                  </label>
                  ${selectField('Tipo de pessoa', 'type', selectedType, [
                    { value: 'pessoa-fisica', label: 'Pessoa física' },
                    { value: 'pessoa-juridica', label: 'Pessoa jurídica' }
                  ])}
                </div>
                ${peopleDraft.error ? `<p class="form-error">${escapeHtml(peopleDraft.error)}</p>` : ''}
              `, 'Informações essenciais para identificar o cadastro.')}

              <div class="cadastro-tabs" role="tablist">
                <button type="button" class="cadastro-tab active" data-tab="dados" role="tab" aria-selected="true">
                  <span>Dados</span>
                  <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <button type="button" class="cadastro-tab" data-tab="financeiro" role="tab" aria-selected="false">
                  <span>Registros Financeiros</span>
                  <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <button type="button" class="cadastro-tab" data-tab="atributos" role="tab" aria-selected="false">
                  <span>Atributos</span>
                  <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <button type="button" class="cadastro-tab" data-tab="mais-dados" role="tab" aria-selected="false">
                  <span>Mais dados</span>
                  <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <button type="button" class="cadastro-tab" data-tab="billing" role="tab" aria-selected="false" id="billingTabBtn" ${peopleDraft.billingDifferent ? '' : 'hidden'}>
                  <span>Endereço de Cobrança</span>
                  <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <button type="button" class="cadastro-tab" data-tab="delivery" role="tab" aria-selected="false" id="deliveryTabBtn" ${peopleDraft.deliveryDifferent ? '' : 'hidden'}>
                  <span>Endereço de Entrega</span>
                  <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
              </div>

              <div class="cadastro-tab-panel" data-tab-panel="dados">
                ${section('Contato', `
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Nome fantasia', 'tradeName', peopleDraft.tradeName || '')}
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
                `)}

                ${section('Endereço', `
                  <div class="cadastro-grid cadastro-grid-3">
                    ${checkbox('foreignAddress', 'Endereço no exterior', Boolean(peopleDraft.foreignAddress))}
                    ${checkbox('billingDifferent', 'Endereço de cobrança diferente', Boolean(peopleDraft.billingDifferent))}
                    ${checkbox('deliveryDifferent', 'Endereço de entrega diferente', Boolean(peopleDraft.deliveryDifferent))}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('CEP', 'zipCode', maskCep(peopleDraft.zipCode || ''), 'id="peopleZipCodeInput" inputmode="numeric" maxlength="9" placeholder="99999-999"', Boolean(fieldErrors.zipCode))}
                    ${field('Logradouro', 'street', peopleDraft.street || '', '', Boolean(fieldErrors.addressLine))}
                    ${field('Número', 'streetNumber', peopleDraft.streetNumber || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Complemento', 'addressComplement', peopleDraft.addressComplement || '')}
                    ${field('Bairro', 'neighborhood', peopleDraft.neighborhood || '')}
                    ${field('Cidade', 'city', peopleDraft.city || '', '', Boolean(fieldErrors.city))}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('UF', 'state', peopleDraft.state || '', '', Boolean(fieldErrors.state))}
                    ${field('Cód. Cidade (IBGE)', 'ibgeCityCode', peopleDraft.ibgeCityCode || '')}
                    ${field('País', 'country', peopleDraft.country || 'Brasil')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Cód. País', 'countryCode', peopleDraft.countryCode || '1058')}
                    ${field('Link de localização no mapa', 'mapLink', peopleDraft.mapLink || '')}
                  </div>
                `)}
              </div>

              <div class="cadastro-tab-panel" data-tab-panel="financeiro" hidden>
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
                  </div>
                `)}
              </div>

              <div class="cadastro-tab-panel" data-tab-panel="atributos" hidden>
                ${section('Relação com a empresa', `
                  <div class="cadastro-check-grid">
                    ${roles.map((role) => checkbox('roles', role, Array.isArray(peopleDraft.roles) && peopleDraft.roles.includes(role), role)).join('')}
                  </div>
                `)}
              </div>

              <div class="cadastro-tab-panel" data-tab-panel="mais-dados" hidden>
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
              </div>

              <div class="cadastro-tab-panel" data-tab-panel="billing" hidden>
                ${section('Endereço de cobrança', `
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('CEP', 'billingZipCode', maskCep(peopleDraft.billingZipCode || ''), 'id="peopleBillingZipCodeInput" inputmode="numeric" maxlength="9" placeholder="99999-999"')}
                    ${field('Logradouro', 'billingStreet', peopleDraft.billingStreet || '')}
                    ${field('Número', 'billingStreetNumber', peopleDraft.billingStreetNumber || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Complemento', 'billingAddressComplement', peopleDraft.billingAddressComplement || '')}
                    ${field('Bairro', 'billingNeighborhood', peopleDraft.billingNeighborhood || '')}
                    ${field('Cidade', 'billingCity', peopleDraft.billingCity || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('UF', 'billingState', peopleDraft.billingState || '')}
                    ${field('Cód. Cidade (IBGE)', 'billingIbgeCityCode', peopleDraft.billingIbgeCityCode || '')}
                    ${field('País', 'billingCountry', peopleDraft.billingCountry || 'Brasil')}
                  </div>
                `, 'Endereço usado para cobrança, diferente do endereço principal do cliente.')}
              </div>

              <div class="cadastro-tab-panel" data-tab-panel="delivery" hidden>
                ${section('Endereço de entrega', `
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('CEP', 'deliveryZipCode', maskCep(peopleDraft.deliveryZipCode || ''), 'id="peopleDeliveryZipCodeInput" inputmode="numeric" maxlength="9" placeholder="99999-999"')}
                    ${field('Logradouro', 'deliveryStreet', peopleDraft.deliveryStreet || '')}
                    ${field('Número', 'deliveryStreetNumber', peopleDraft.deliveryStreetNumber || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Complemento', 'deliveryAddressComplement', peopleDraft.deliveryAddressComplement || '')}
                    ${field('Bairro', 'deliveryNeighborhood', peopleDraft.deliveryNeighborhood || '')}
                    ${field('Cidade', 'deliveryCity', peopleDraft.deliveryCity || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('UF', 'deliveryState', peopleDraft.deliveryState || '')}
                    ${field('Cód. Cidade (IBGE)', 'deliveryIbgeCityCode', peopleDraft.deliveryIbgeCityCode || '')}
                    ${field('País', 'deliveryCountry', peopleDraft.deliveryCountry || 'Brasil')}
                  </div>
                `, 'Endereço usado para entrega, diferente do endereço principal do cliente.')}
              </div>

              ${section('Observações', `
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

      const renderCnpjRegister = () => {
        const documentValue = maskDocumentValue(cnpjDraft.document || '', 'pessoa-juridica');
        const canLookupCnpj = sanitizeDigits(cnpjDraft.document || '').length === 14;
        const fieldErrors = cnpjDraft.fieldErrors || {};

        return `
          <div class="panel cadastros-shell">
            <div class="cadastro-page-head">
              <div>
                <h3>Cadastro de CNPJs</h3>
                <p class="muted">Consulta o CNPJ na API e preenche os dados da empresa automaticamente.</p>
              </div>
              <div class="cadastro-page-chip">Pessoa jurídica</div>
            </div>
            <form id="cnpjRegisterForm" class="cadastro-form">
              ${section('Nome ou razão social', `
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Nome ou razão social', 'name', cnpjDraft.name || '', '', Boolean(fieldErrors.name))}
                  ${field('Nome fantasia', 'tradeName', cnpjDraft.tradeName || '')}
                  ${selectField('Tipo de pessoa', 'type', 'pessoa-juridica', [{ value: 'pessoa-juridica', label: 'Pessoa jurídica' }], 'disabled')}
                </div>
                <div class="cadastro-grid cadastro-grid-3 cadastro-align-bottom">
                  ${field('CNPJ', 'document', documentValue, 'id="cnpjDocumentInput" inputmode="numeric" maxlength="18"', Boolean(fieldErrors.document))}
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
                  ${field('CEP', 'zipCode', maskCep(cnpjDraft.zipCode || ''), 'id="cnpjZipCodeInput" inputmode="numeric" maxlength="9" placeholder="99999-999"', Boolean(fieldErrors.zipCode))}
                  ${field('Logradouro', 'address', cnpjDraft.address || '', '', Boolean(fieldErrors.addressLine))}
                  ${field('Número', 'addressNumber', cnpjDraft.addressNumber || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Complemento', 'addressComplement', cnpjDraft.addressComplement || '')}
                  ${field('Bairro', 'neighborhood', cnpjDraft.neighborhood || '')}
                  ${field('Cidade', 'city', cnpjDraft.city || '', '', Boolean(fieldErrors.city))}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('UF', 'state', cnpjDraft.state || '', '', Boolean(fieldErrors.state))}
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

      const renderUnifiedRegister = () => renderPeopleRegister('register');

      const renderUnifiedEdit = () => renderPeopleRegister('edit');

      // Sub-abas: Depósitos > Cadastro (mode 'register') e Depósitos > Edição (mode 'edit')
      const renderDepositsRegister = (mode = 'register') => {
        const isEditMode = mode === 'edit';
        return `
        <div class="panel cadastros-shell">
          <div class="cadastro-page-head">
            <div>
              <h3>${isEditMode ? 'Edição de depósito' : 'Cadastro de depósito'}</h3>
              <p class="muted">${isEditMode ? 'Atualize os dados de armazenagem.' : 'Preencha os dados do novo depósito.'}</p>
            </div>
            <div class="cadastro-page-chip">${isEditMode ? 'Edição' : 'Novo'}</div>
          </div>

          <form id="depositRegisterForm" class="cadastro-form">
            ${section('Dados do depósito', `
              <div class="cadastro-grid cadastro-grid-3">
                ${field('Nome do depósito', 'name', depositDraft.name || '', 'required')}
                ${field('Código interno', 'code', depositDraft.code || '')}
                ${selectField('Status', 'status', depositDraft.status || 'ativo', [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }])}
              </div>
              <div class="cadastro-grid cadastro-grid-3">
                ${field('Endereço', 'address', depositDraft.address || '')}
                ${field('Cidade', 'city', depositDraft.city || '')}
                ${field('UF', 'state', depositDraft.state || '')}
              </div>
              <div class="cadastro-grid cadastro-grid-2">
                ${field('Responsável', 'manager', depositDraft.manager || '')}
                ${field('Observações', 'notes', depositDraft.notes || '')}
              </div>
              ${depositDraft.error ? `<p class="form-error">${escapeHtml(depositDraft.error)}</p>` : ''}
            `)}

            <div class="cadastro-actions">
              <button type="button" class="secondary" id="depositCancelBtn">Cancelar</button>
              <button type="submit">${isEditMode ? 'Salvar alterações' : 'Salvar depósito'}</button>
            </div>
          </form>
        </div>
      `;
      };

      // Sub-aba: Depósitos
      const renderDepositsList = () => {
        const normalize = (value) => String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('pt-BR')
          .trim();

        const includesText = (fieldValue, filterValue) => normalize(fieldValue).includes(normalize(filterValue).trim());

        const filteredDeposits = deposits
          .filter((deposit) => {
            if (depositsFilters.status !== 'all' && normalize(deposit.status) !== normalize(depositsFilters.status)) return false;
            if (depositsFilters.code && !includesText(deposit.code, depositsFilters.code)) return false;
            if (depositsFilters.city && !includesText(deposit.city, depositsFilters.city)) return false;
            if (depositsFilters.state && !includesText(deposit.state, depositsFilters.state)) return false;
            if (depositsFilters.manager && !includesText(deposit.manager, depositsFilters.manager)) return false;

            const query = normalize(depositsFilters.query);
            if (!query) return true;
            return [deposit.name, deposit.code, deposit.address, deposit.city, deposit.state, deposit.manager]
              .some((fieldValue) => normalize(fieldValue).includes(query));
          })
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        return `
        <div class="panel cadastros-shell">
          <div class="cadastro-page-head">
            <div>
              <h3>Depósitos</h3>
              <p class="muted">Histórico e gerenciamento de depósitos.</p>
            </div>
            <div class="cadastro-list-actions">
              <button type="button" class="success" id="cadastroDepositNewBtn">+ Novo depósito</button>
              <button type="button" class="secondary" id="cadastroDepositFilterToggleBtn">Filtros</button>
            </div>
          </div>

          ${depositsFilters.show ? `
            <form id="depositFilterForm" class="cadastro-filter-panel">
              <div class="cadastro-filter-grid-5">
                <label class="cadastro-field">
                  <span>Nome do depósito</span>
                  <input name="query" value="${escapeHtml(depositsFilters.query)}" />
                </label>
                <label class="cadastro-field">
                  <span>Código interno</span>
                  <input name="code" value="${escapeHtml(depositsFilters.code)}" />
                </label>
                <label class="cadastro-field">
                  <span>Cidade</span>
                  <input name="city" value="${escapeHtml(depositsFilters.city)}" />
                </label>
                <label class="cadastro-field">
                  <span>UF</span>
                  <input name="state" value="${escapeHtml(depositsFilters.state)}" />
                </label>
                <label class="cadastro-field">
                  <span>Responsável</span>
                  <input name="manager" value="${escapeHtml(depositsFilters.manager)}" />
                </label>
                <label class="cadastro-field">
                  <span>Status</span>
                  <select name="status">
                    <option value="all" ${depositsFilters.status === 'all' ? 'selected' : ''}>Todos</option>
                    <option value="ativo" ${depositsFilters.status === 'ativo' ? 'selected' : ''}>Ativo</option>
                    <option value="inativo" ${depositsFilters.status === 'inativo' ? 'selected' : ''}>Inativo</option>
                  </select>
                </label>
              </div>
              <div class="cadastro-filter-actions">
                <button type="submit">Buscar</button>
                <button type="button" class="secondary" id="depositFilterClearBtn">Limpar filtros</button>
              </div>
            </form>
          ` : ''}

          <section class="cadastro-section">
            <div class="cadastro-section-header">
              <div>
                <h4>Depósitos cadastrados</h4>
                <p>Registros salvos nesta sessão.</p>
              </div>
            </div>
            <div class="cadastro-section-body">
              ${filteredDeposits.length ? `
                <table class="table table-actions">
                  <thead><tr><th>Nome</th><th>Código</th><th>Cidade/UF</th><th>Responsável</th><th>Status</th><th>Ações</th></tr></thead>
                  <tbody>
                    ${filteredDeposits.map((deposit) => `
                      <tr>
                        <td>${escapeHtml(deposit.name || '-')}</td>
                        <td>${escapeHtml(deposit.code || '-')}</td>
                        <td>${escapeHtml([deposit.city, deposit.state].filter(Boolean).join('/') || '-')}</td>
                        <td>${escapeHtml(deposit.manager || '-')}</td>
                        <td>${escapeHtml(deposit.status || 'ativo')}</td>
                        <td>
                          <button class="icon-button edit cadastro-edit-deposit" data-id="${escapeHtml(deposit.id)}" title="Editar depósito" aria-label="Editar depósito">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                          </button>
                          <button class="icon-button cadastro-delete-deposit" data-id="${escapeHtml(deposit.id)}" title="Excluir depósito" aria-label="Excluir depósito">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : '<p class="muted">Nenhum depósito encontrado para os filtros aplicados.</p>'}
            </div>
          </section>
        </div>
      `;
      };

      // Sub-aba: Cadastros (lista unificada — padrão da aba)
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
          { role: 'Técnico', enabled: listFilters.showTechnicians },
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
            code: person.code || '',
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
            code: company.code || '',
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
            if (listFilters.uniqueCode && !includesText(row.code, listFilters.uniqueCode)) return false;
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
              row.code,
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
                <p class="muted">Consulta unificada de Pessoas e CNPJs.</p>
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
                    <span>Código do cliente</span>
                    <input name="uniqueCode" value="${escapeHtml(listFilters.uniqueCode)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>E-mail</span>
                    <input name="email" value="${escapeHtml(listFilters.email)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Categoria razão social</span>
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
                    <span>Transportadora padrão</span>
                    <input name="defaultCarrier" value="${escapeHtml(listFilters.defaultCarrier)}" />
                  </label>
                  <label class="cadastro-field">
                    <span>Tipo</span>
                    <select name="type">
                      <option value="all" ${listFilters.type === 'all' ? 'selected' : ''}>Todos</option>
                      <option value="people" ${listFilters.type === 'people' ? 'selected' : ''}>Pessoas</option>
                      <option value="cnpj" ${listFilters.type === 'cnpj' ? 'selected' : ''}>CNPJs</option>
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
              <div class="table-scroll">
                <table class="table table-actions">
                  <thead><tr><th>Código</th><th>Tipo</th><th>Nome / Razão social</th><th>Fantasia</th><th>Documento</th><th>E-mail</th><th>Telefone</th><th>Status</th><th>Cadastrado em</th><th>Ações</th></tr></thead>
                  <tbody>
                    ${merged.map((row) => `
                      <tr class="cadastro-row-clickable" data-kind="${row.kind}" data-id="${escapeHtml(row.id || '')}" title="Duplo clique para editar">
                        <td>${escapeHtml(row.code || '-')}</td>
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
              </div>
            ` : '<p class="muted">Nenhum registro encontrado para os filtros aplicados.</p>'}
          </div>
        `;
      };

      // Roteamento das sub-abas de Cadastros para suas funções de renderização
      const pages = {
        register: renderUnifiedRegister, // Sub-aba: Cadastro
        edit: renderUnifiedEdit, // Sub-aba: Edição
        deposits: renderDepositsList, // Sub-aba: Depósitos
        deposits_register: () => renderDepositsRegister('register'), // Sub-aba: Depósitos > Cadastro
        deposits_edit: () => renderDepositsRegister('edit'), // Sub-aba: Depósitos > Edição
        list: renderUnifiedList // Sub-aba: Cadastros
      };

      content.innerHTML = (pages[sub] || renderUnifiedList)();

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

      document.getElementById('cadastroDepositNewBtn')?.addEventListener('click', () => {
        state.cadastroDraft = {
          ...state.cadastroDraft,
          depositForm: {}
        };
        state.activeSub = 'deposits_register';
        renderApp();
        loadModule('cadastros');
      });

      document.getElementById('cadastroDepositFilterToggleBtn')?.addEventListener('click', () => {
        state.cadastroDraft = {
          ...state.cadastroDraft,
          depositsFilters: {
            ...depositsFilters,
            show: !depositsFilters.show
          }
        };
        state.activeSub = 'deposits';
        renderApp();
        loadModule('cadastros');
      });

      const depositFilterForm = document.getElementById('depositFilterForm');
      const applyDepositFilters = () => {
        if (!depositFilterForm) return;
        const data = new FormData(depositFilterForm);
        state.cadastroDraft = {
          ...state.cadastroDraft,
          depositsFilters: {
            show: true,
            query: String(data.get('query') || '').trim(),
            code: String(data.get('code') || '').trim(),
            city: String(data.get('city') || '').trim(),
            state: String(data.get('state') || '').trim(),
            manager: String(data.get('manager') || '').trim(),
            status: String(data.get('status') || 'all')
          }
        };
        state.activeSub = 'deposits';
        renderApp();
        loadModule('cadastros');
      };

      depositFilterForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        applyDepositFilters();
      });

      document.getElementById('depositFilterClearBtn')?.addEventListener('click', () => {
        state.cadastroDraft = {
          ...state.cadastroDraft,
          depositsFilters: {
            show: true,
            query: '',
            code: '',
            city: '',
            state: '',
            manager: '',
            status: 'all'
          }
        };
        state.activeSub = 'deposits';
        renderApp();
        loadModule('cadastros');
      });

      const openCadastroRowForEdit = (kind, id) => {
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
      };

      document.querySelectorAll('.cadastro-edit-row').forEach((button) => {
        button.addEventListener('click', () => {
          openCadastroRowForEdit(button.dataset.kind, button.dataset.id);
        });
      });

      document.querySelectorAll('.cadastro-row-clickable').forEach((row) => {
        row.addEventListener('dblclick', (event) => {
          if (event.target.closest('button')) return;
          openCadastroRowForEdit(row.dataset.kind, row.dataset.id);
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
            showToast(isCnpj ? 'CNPJ excluído com sucesso.' : 'Pessoa excluída com sucesso.', 'success');
            loadModule('cadastros');
          } catch (error) {
            showToast(error.message || 'Erro ao excluir cadastro.', 'error');
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
            fieldErrors: draftTarget.fieldErrors || {},
            document,
            documentMessage: message,
            error: message
          }
        };
        renderApp();
        loadModule('cadastros');
      };

      const markFormError = (draftTarget, key, message) => {
        showToast(message, 'error');
        state.cadastroDraft = {
          ...state.cadastroDraft,
          [key]: {
            ...(state.cadastroDraft[key] || {}),
            ...draftTarget,
            fieldErrors: draftTarget.fieldErrors || {},
            error: message
          }
        };
        renderApp();
        loadModule('cadastros');
      };

      const markMissingFields = (draftTarget, key, fieldErrors, message) => {
        showToast(message, 'error');
        state.cadastroDraft = {
          ...state.cadastroDraft,
          [key]: {
            ...(state.cadastroDraft[key] || {}),
            ...draftTarget,
            fieldErrors,
            error: ''
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

      // Preenche automaticamente Logradouro/Bairro/Cidade/UF ao sair do campo CEP (blur/Tab).
      // fieldMap define os nomes reais dos campos no formulário (endereço principal, de cobrança ou de entrega).
      const bindCepAutoFill = (form, draftKey, fieldMap) => {
        const cepInput = form?.querySelector(`input[name="${fieldMap.zipCode}"]`);
        if (!cepInput) return;

        cepInput.addEventListener('input', () => {
          cepInput.value = maskCep(cepInput.value);
        });

        const clearFieldError = (input) => {
          const wrapper = input?.closest('.cadastro-field, .cadastro-field-inline');
          wrapper?.classList.remove('cadastro-field-invalid');
          wrapper?.querySelector('.cadastro-field-error-msg')?.remove();
        };

        cepInput.addEventListener('blur', async () => {
          const cep = sanitizeDigits(cepInput.value);
          if (cep.length !== 8) return;

          try {
            const response = await api(`/api/cep/${cep}`);
            const address = response.address || {};

            const fieldValues = {
              [fieldMap.street]: address.street || '',
              [fieldMap.neighborhood]: address.neighborhood || '',
              [fieldMap.city]: address.city || '',
              [fieldMap.state]: address.state || '',
              [fieldMap.ibgeCityCode]: address.ibgeCityCode || ''
            };
            if (fieldMap.complement && address.complement) {
              fieldValues[fieldMap.complement] = address.complement;
            }

            clearFieldError(cepInput);
            Object.entries(fieldValues).forEach(([fieldName, value]) => {
              if (!value) return;
              const input = form.querySelector(`[name="${fieldName}"]`);
              if (!input) return;
              input.value = value;
              clearFieldError(input);
            });

            state.cadastroDraft = {
              ...state.cadastroDraft,
              [draftKey]: {
                ...(state.cadastroDraft[draftKey] || {}),
                [fieldMap.zipCode]: address.zipCode || cep,
                ...fieldValues
              }
            };
          } catch (error) {
            showToast(error.message || 'CEP não encontrado.', 'warning');
          }
        });
      };

      const peopleRegisterFormEl = document.getElementById('peopleRegisterForm');
      bindCepAutoFill(peopleRegisterFormEl, 'people', { zipCode: 'zipCode', street: 'street', neighborhood: 'neighborhood', city: 'city', state: 'state', ibgeCityCode: 'ibgeCityCode', complement: 'addressComplement' });
      bindCepAutoFill(peopleRegisterFormEl, 'people', { zipCode: 'billingZipCode', street: 'billingStreet', neighborhood: 'billingNeighborhood', city: 'billingCity', state: 'billingState', ibgeCityCode: 'billingIbgeCityCode', complement: 'billingAddressComplement' });
      bindCepAutoFill(peopleRegisterFormEl, 'people', { zipCode: 'deliveryZipCode', street: 'deliveryStreet', neighborhood: 'deliveryNeighborhood', city: 'deliveryCity', state: 'deliveryState', ibgeCityCode: 'deliveryIbgeCityCode', complement: 'deliveryAddressComplement' });

      document.getElementById('peopleLookupBtn')?.addEventListener('click', async () => {
        const form = document.getElementById('peopleRegisterForm');
        if (!form) return;
        const formData = new FormData(form);
        const selectedType = String(formData.get('type') || 'pessoa-fisica');
        const documentValue = sanitizeDigits(formData.get('document'));
        const type = selectedType;

        if (documentValue.length !== 14) {
          showToast('Informe um CNPJ com 14 dígitos para consultar.', 'warning');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            people: {
              ...(state.cadastroDraft.people || {}),
              document: maskDocumentValue(documentValue, type),
              documentMessage: 'Informe um CNPJ válido para consultar dados oficiais.'
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
            showToast('A API retornou CNPJ válido, mas sem email e/ou telefone para este cadastro.', 'warning');
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
          billingZipCode: String(formData.get('billingZipCode') || '').trim(),
          billingStreet: String(formData.get('billingStreet') || '').trim(),
          billingStreetNumber: String(formData.get('billingStreetNumber') || '').trim(),
          billingAddressComplement: String(formData.get('billingAddressComplement') || '').trim(),
          billingNeighborhood: String(formData.get('billingNeighborhood') || '').trim(),
          billingCity: String(formData.get('billingCity') || '').trim(),
          billingState: String(formData.get('billingState') || '').trim(),
          billingIbgeCityCode: String(formData.get('billingIbgeCityCode') || '').trim(),
          billingCountry: String(formData.get('billingCountry') || '').trim(),
          deliveryZipCode: String(formData.get('deliveryZipCode') || '').trim(),
          deliveryStreet: String(formData.get('deliveryStreet') || '').trim(),
          deliveryStreetNumber: String(formData.get('deliveryStreetNumber') || '').trim(),
          deliveryAddressComplement: String(formData.get('deliveryAddressComplement') || '').trim(),
          deliveryNeighborhood: String(formData.get('deliveryNeighborhood') || '').trim(),
          deliveryCity: String(formData.get('deliveryCity') || '').trim(),
          deliveryState: String(formData.get('deliveryState') || '').trim(),
          deliveryIbgeCityCode: String(formData.get('deliveryIbgeCityCode') || '').trim(),
          deliveryCountry: String(formData.get('deliveryCountry') || '').trim(),
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

        const missingFields = getMissingRequiredRegistrationFields(payload);
        if (missingFields.length) {
          const fieldErrors = {};
          missingFields.forEach((key) => { fieldErrors[key] = true; });
          markMissingFields({ ...payload }, 'people', fieldErrors, 'Preencha os campos obrigatórios destacados em vermelho.');
          return;
        }

        if (type === 'pessoa-juridica' && !isValidCnpj(documentValue)) {
          markInvalidDocument({ ...payload }, 'people', 'CNPJ inválido. Não é possível salvar.', documentValue);
          return;
        }

        if (type === 'pessoa-fisica' && !isValidCpf(documentValue)) {
          markInvalidDocument({ ...payload }, 'people', 'CPF inválido. Não é possível salvar.', documentValue);
          return;
        }

        const duplicateMessage = findDuplicateRegistrationClient([...people, ...cnpjs], payload, payload.id);
        if (duplicateMessage) {
          markFormError({ ...payload }, 'people', duplicateMessage);
          return;
        }

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

      // Troca de mini-abas do formulário de Cadastro/Edição (Dados / Registros Financeiros / Atributos)
      document.querySelectorAll('#peopleRegisterForm .cadastro-tab').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
          const target = tabBtn.dataset.tab;
          document.querySelectorAll('#peopleRegisterForm .cadastro-tab').forEach((btn) => {
            const isActive = btn === tabBtn;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
          });
          document.querySelectorAll('#peopleRegisterForm .cadastro-tab-panel').forEach((panel) => {
            panel.hidden = panel.dataset.tabPanel !== target;
          });
        });
      });

      // Endereço de cobrança/entrega diferente: abre (ou fecha) a aba correspondente ao ligar/desligar a chave.
      const bindDifferentAddressToggle = (checkboxName, tabBtnId) => {
        const toggle = document.querySelector(`#peopleRegisterForm input[name="${checkboxName}"]`);
        const tabBtn = document.getElementById(tabBtnId);
        if (!toggle || !tabBtn) return;

        toggle.addEventListener('change', () => {
          tabBtn.hidden = !toggle.checked;
          if (toggle.checked) {
            tabBtn.click();
          } else if (tabBtn.classList.contains('active')) {
            document.querySelector('#peopleRegisterForm .cadastro-tab[data-tab="dados"]')?.click();
          }
        });
      };

      bindDifferentAddressToggle('billingDifferent', 'billingTabBtn');
      bindDifferentAddressToggle('deliveryDifferent', 'deliveryTabBtn');

      const cnpjDocumentInput = document.getElementById('cnpjDocumentInput');
      bindDocumentMask(cnpjDocumentInput, () => 'pessoa-juridica');
      bindCepAutoFill(document.getElementById('cnpjRegisterForm'), 'cnpjs', { zipCode: 'zipCode', street: 'address', neighborhood: 'neighborhood', city: 'city', state: 'state', ibgeCityCode: 'ibgeCityCode', complement: 'addressComplement' });

      document.getElementById('consultCnpjBtn')?.addEventListener('click', async () => {
        const form = document.getElementById('cnpjRegisterForm');
        if (!form) return;
        const formData = new FormData(form);
        const documentValue = sanitizeDigits(formData.get('document'));

        if (!isValidCnpj(documentValue)) {
          showToast('CNPJ inválido. Informe 14 dígitos numéricos válidos.', 'error');
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
            showToast('A API retornou CNPJ válido, mas sem email e/ou telefone para este cadastro.', 'warning');
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

        const missingFields = getMissingRequiredRegistrationFields(payload);
        if (missingFields.length) {
          const fieldErrors = {};
          missingFields.forEach((key) => { fieldErrors[key] = true; });
          markMissingFields({ ...payload }, 'cnpjs', fieldErrors, 'Preencha os campos obrigatórios destacados em vermelho.');
          return;
        }

        if (!isValidCnpj(documentValue)) {
          markFormError({ ...payload }, 'cnpjs', 'CNPJ inválido. Não foi possível salvar.');
          return;
        }

        const duplicateMessage = findDuplicateRegistrationClient([...people, ...cnpjs], payload, payload.id);
        if (duplicateMessage) {
          markFormError({ ...payload }, 'cnpjs', duplicateMessage);
          return;
        }

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

      document.getElementById('depositCancelBtn')?.addEventListener('click', () => {
        state.cadastroDraft = {
          ...state.cadastroDraft,
          depositForm: {}
        };
        state.activeSub = 'deposits';
        renderApp();
        loadModule('cadastros');
      });

      document.getElementById('depositRegisterForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitBtn = event.target.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;
        const formData = new FormData(event.target);
        const isEditing = Boolean(depositDraft.id);
        const payload = {
          name: String(formData.get('name') || '').trim(),
          code: String(formData.get('code') || '').trim(),
          status: String(formData.get('status') || 'ativo').trim() || 'ativo',
          address: String(formData.get('address') || '').trim(),
          city: String(formData.get('city') || '').trim(),
          state: String(formData.get('state') || '').trim(),
          manager: String(formData.get('manager') || '').trim(),
          notes: String(formData.get('notes') || '').trim()
        };

        if (!payload.name) {
          showToast('Informe o nome do depósito.', 'warning');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            depositForm: {
              ...depositDraft,
              ...payload,
              error: 'Informe o nome do depósito.'
            }
          };
          renderApp();
          loadModule('cadastros');
          return;
        }

        if (submitBtn) submitBtn.disabled = true;
        try {
          if (isEditing) {
            await api(`/api/cadastros/deposits/${depositDraft.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          } else {
            await api('/api/cadastros/deposits', { method: 'POST', body: JSON.stringify(payload) });
          }
          state.cadastroDraft = { ...state.cadastroDraft, depositForm: {} };
          showToast(isEditing ? 'Depósito atualizado com sucesso.' : 'Depósito salvo com sucesso.', 'success');
          state.activeSub = 'deposits';
          renderApp();
          loadModule('cadastros');
        } catch (error) {
          showToast(error.message || 'Erro ao salvar depósito.', 'error');
          state.cadastroDraft = {
            ...state.cadastroDraft,
            depositForm: { ...depositDraft, ...payload, id: isEditing ? depositDraft.id : undefined, error: error.message || 'Erro ao salvar depósito.' }
          };
          renderApp();
          loadModule('cadastros');
        }
      });

      document.querySelectorAll('.cadastro-edit-deposit').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.id;
          if (!id) return;
          const item = deposits.find((entry) => entry.id === id);
          if (!item) return;

          state.cadastroDraft = {
            ...state.cadastroDraft,
            depositForm: { ...item, error: '' }
          };
          state.activeSub = 'deposits_edit';
          renderApp();
          loadModule('cadastros');
        });
      });

      document.querySelectorAll('.cadastro-delete-deposit').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.dataset.id;
          if (!id) return;
          const item = deposits.find((entry) => entry.id === id);
          const label = item?.name || 'depósito';
          const confirmed = await confirmModal(`Excluir depósito "${label}"?`);
          if (!confirmed) return;

          try {
            await api(`/api/cadastros/deposits/${id}`, { method: 'DELETE' });
            showToast('Depósito excluído com sucesso.', 'success');
            loadModule('cadastros');
          } catch (error) {
            showToast(error.message || 'Erro ao excluir depósito.', 'error');
          }
        });
      });

      return;
    }

    // ========================================================================
    // ABA: COMPRAS (sub-abas: Nova compra, Histórico de compras, Fornecedores)
    // ========================================================================
    if (moduleName === 'purchases') {
      const data = await api('/api/purchases');
      const sub = state.activeSub || 'new_purchase';

      const renderPage = () => {
        // Sub-aba: Histórico de compras
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

        // Sub-aba: Fornecedores
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

        // Sub-aba: Nova compra (padrão)
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

    // ========================================================================
    // ABA: ESTOQUE
    // ========================================================================
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

    // ========================================================================
    // ABA: FINANCEIRO
    // ========================================================================
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
          showToast('Lançamento financeiro salvo com sucesso.', 'success');
          loadModule('finance');
        } catch (error) {
          showToast(error.message || 'Erro ao salvar lançamento financeiro.', 'error');
        }
      });
      return;
    }

    // ========================================================================
    // ABA: CONFIGURAÇÕES
    // ========================================================================
    if (moduleName === 'settings') {
      const data = await api('/api/settings');
          const totals = data.totals || {};
          const settingsPermissions = data.permissions || {};
          const canManageCompany = Boolean(settingsPermissions.company);
          const canManageUsers = Boolean(settingsPermissions.users);
          content.innerHTML = `
            <div class="cards">
              ${canManageUsers ? `<div class="card"><h3>Usuários</h3><p>${totals.totalUsers ?? (data.users || []).length}</p></div>` : ''}
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
              showToast('Configurações da empresa salvas com sucesso.', 'success');
              loadModule('settings');
            } catch (error) {
              showToast(error.message || 'Erro ao salvar configurações da empresa.', 'error');
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
              showToast('Usuário criado com sucesso.', 'success');
              loadModule('settings');
            } catch (error) {
              showToast(error.message || 'Erro ao criar usuário.', 'error');
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
                          showToast('Usuário excluído com sucesso.', 'success');
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
    showToast(error.message || 'Erro ao carregar módulo.', 'error');
    content.innerHTML = `<div class="panel"><p>${error.message}</p></div>`;
  }
}

(async function bootstrap() {
  // Clear legacy token from older versions that used localStorage.
  localStorage.removeItem('token');

  const token = getSessionToken();
  if (!token) {
    renderAuth();
    return;
  }

  try {
    const response = await api('/api/me');
    state.user = response.user;
    state.user.dashboardPins = normalizeDashboardPins([
      ...(Array.isArray(state.user.dashboardPins) ? state.user.dashboardPins : []),
      ...readStoredDashboardPins(state.user.id)
    ]);
    persistStoredDashboardPins(state.user.id, state.user.dashboardPins);
    applyTheme(state.user.theme);
    restoreLastRoute();
    const moduleHistory = ensureModuleRouteHistory(state.activeModule);
    moduleHistory.currentRouteKey = getRouteKey(state.activeModule, state.activeSub);
    renderApp();
    await loadModule(state.activeModule);
  } catch (error) {
    clearSessionToken();
    showToast(error.message || 'Sua sessão expirou. Faça login novamente.', 'error');
    renderAuth(error.message);
  }
})();
