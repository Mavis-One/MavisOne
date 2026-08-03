window.MavisModuleRegistry = window.MavisModuleRegistry || {};

// Ordem das abas exibidas nos favoritos do dashboard (mesma ordem do menu lateral).
// Rótulos e sub-abas vêm de moduleLabels/moduleSubItems (definidos em app.js) para
// que sidebar e dashboard nunca fiquem dessincronizados.
const DASHBOARD_MODULE_ORDER = ['dashboard', 'sales', 'purchases', 'stock', 'finance', 'cadastros'];

// Sub-aba padrão ao abrir cada módulo pelo balão do dashboard.
const DASHBOARD_DEFAULT_SUB = {
  sales: 'orders_quotes',
  cadastros: 'list',
  purchases: 'new_purchase',
  finance: 'dashboard',
  stock: 'products'
};

function buildPinKey(moduleKey, subKey) {
  return subKey ? `${moduleKey}::${subKey}` : moduleKey;
}

function getModuleIcon(label) {
  const letters = String(label || '')
    .replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return letters || 'MO';
}

function getVisibleModules(state) {
  const allowed = new Set(Array.isArray(state.user?.allowedModules) ? state.user.allowedModules : []);
  return DASHBOARD_MODULE_ORDER
    .filter((moduleKey) => moduleKey === 'dashboard' || allowed.has(moduleKey))
    .map((moduleKey) => ({
      key: moduleKey,
      label: moduleLabels[moduleKey] || moduleKey,
      items: moduleSubItems[moduleKey] || []
    }));
}

function getDefaultSubKey(moduleKey) {
  return DASHBOARD_DEFAULT_SUB[moduleKey] || null;
}

function navigateToModule(ctx, moduleKey, subKey) {
  const { state, renderApp, loadModule } = ctx;
  state.activeModule = moduleKey;
  state.activeSub = subKey || null;
  state.selectedModule = null;
  renderApp();
  loadModule(moduleKey);
}

async function saveDashboardPins(ctx, nextPins) {
  if (typeof window.saveDashboardPins === 'function') {
    const saved = await window.saveDashboardPins(nextPins);
    ctx.state.user.dashboardPins = saved;
    return saved;
  }

  ctx.state.user.dashboardPins = nextPins;
  return nextPins;
}

function renderPinButton(ctx, pinKey, label, pinnedSet) {
  const pinned = pinnedSet.has(pinKey);
  return `
    <button
      type="button"
      class="dashboard-pin-btn favorite-btn ${pinned ? 'active' : ''}"
      aria-pressed="${pinned ? 'true' : 'false'}"
      title="${pinned ? 'Desfixar' : 'Fixar'} ${ctx.escapeHtml(label)}"
      data-pin-key="${ctx.escapeHtml(pinKey)}"
    >
      ${favoriteIconSvg(pinned)}
    </button>
  `;
}

// Cada módulo favoritado gera DOIS balões independentes: um para o módulo em si
// (título + fixar/desfixar) e outro, ao lado/abaixo, com a coluna das abas
// daquele módulo marcadas como favoritas.
function renderModuleGroup(ctx, module, pinnedSet) {
  const { state, escapeHtml } = ctx;
  const mainPinKey = buildPinKey(module.key);
  const isMainPinned = pinnedSet.has(mainPinKey);
  const pinnedItems = module.items.filter((item) => pinnedSet.has(buildPinKey(module.key, item.key)));
  const showModule = isMainPinned || pinnedItems.length > 0;

  if (!showModule) {
    return '';
  }

  return `
    <div class="dashboard-favorite-group">
      <section class="dashboard-module-balloon ${state.activeModule === module.key ? 'active' : ''}">
        <button type="button" class="dashboard-module-title" data-open-module="${escapeHtml(module.key)}">
          <span class="dashboard-module-avatar">${escapeHtml(getModuleIcon(module.label))}</span>
          <span class="dashboard-module-heading">
            <strong>${escapeHtml(module.label)}</strong>
            <span>${isMainPinned ? 'Módulo fixado' : 'Abas fixadas'}</span>
          </span>
        </button>
        ${renderPinButton(ctx, mainPinKey, module.label, pinnedSet)}
      </section>

      <section class="dashboard-tabs-balloon">
        <header class="dashboard-tabs-balloon-header">Abas favoritas</header>
        <div class="dashboard-tabs-column">
          ${pinnedItems.length ? pinnedItems.map((item) => {
            const pinKey = buildPinKey(module.key, item.key);
            const isActive = state.activeModule === module.key && state.activeSub === item.key;
            return `
              <div class="dashboard-tab-row ${isActive ? 'active' : ''}">
                <button type="button" class="dashboard-tab-open" data-open-sub="${escapeHtml(module.key)}::${escapeHtml(item.key)}">
                  ${escapeHtml(item.label)}
                </button>
                ${renderPinButton(ctx, pinKey, item.label, pinnedSet)}
              </div>
            `;
          }).join('') : '<p class="muted dashboard-empty-module">Nenhuma aba fixada neste módulo.</p>'}
        </div>
      </section>
    </div>
  `;
}

window.MavisModuleRegistry.dashboard = async function renderDashboard(ctx) {
  const { content, state, showToast } = ctx;
  const visibleModules = getVisibleModules(state);
  const pinnedSet = getDashboardPinSet();
  const favoriteModules = visibleModules.filter((module) => {
    const mainPinned = pinnedSet.has(buildPinKey(module.key));
    const hasPinnedItems = module.items.some((item) => pinnedSet.has(buildPinKey(module.key, item.key)));
    return mainPinned || hasPinnedItems;
  });

  async function togglePin(pinKey, label) {
    const wasPinned = pinnedSet.has(pinKey);
    const nextPins = wasPinned
      ? Array.from(pinnedSet).filter((item) => item !== pinKey)
      : Array.from(new Set([...pinnedSet, pinKey]));

    try {
      await saveDashboardPins(ctx, nextPins);
      showToast(wasPinned ? `Removido dos fixados: ${label}` : `Fixado: ${label}`, 'success');
      await window.MavisModuleRegistry.dashboard(ctx);
    } catch (error) {
      showToast(error.message || 'Erro ao salvar favoritos do dashboard.', 'error');
    }
  }

  content.innerHTML = `
    <div class="dashboard-shell">
      <section class="panel dashboard-favorites-hero">
        <div>
          <h3>FAVORITOS:</h3>
          <p class="muted">Somente os módulos e abas fixados aparecem aqui.</p>
        </div>
      </section>

      <section class="panel">
        ${favoriteModules.length ? `
          <div class="dashboard-favorites-grid">
            ${favoriteModules.map((module) => renderModuleGroup(ctx, module, pinnedSet)).join('')}
          </div>
        ` : `
          <div class="dashboard-empty-state">
            <strong>Sem favoritos</strong>
            <p class="muted">Fixe módulos ou abas para que eles apareçam aqui.</p>
          </div>
        `}
      </section>
    </div>
  `;

  content.querySelectorAll('[data-open-module]').forEach((button) => {
    button.addEventListener('click', () => {
      const moduleKey = button.dataset.openModule;
      if (!moduleKey) return;
      navigateToModule(ctx, moduleKey, getDefaultSubKey(moduleKey));
    });
  });

  content.querySelectorAll('[data-open-sub]').forEach((button) => {
    button.addEventListener('click', () => {
      const [moduleKey, subKey] = String(button.dataset.openSub || '').split('::');
      if (!moduleKey || !subKey) return;
      navigateToModule(ctx, moduleKey, subKey);
    });
  });

  content.querySelectorAll('[data-pin-key]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const pinKey = button.dataset.pinKey;
      if (!pinKey) return;
      togglePin(pinKey, getDashboardPinLabel(pinKey));
    });
  });
};
