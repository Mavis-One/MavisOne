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
  // Administrador vê tudo — é o que o servidor já decide (usuarioPode passa
  // direto para admin). Sem esta linha os dois discordavam: a API liberava e o
  // menu escondia, então cada módulo novo nascia invisível até alguém marcá-lo
  // à mão em Configurações > Usuários, para cada admin, um por um.
  if (state.user.role === 'admin' || (Array.isArray(state.user.roles) && state.user.roles.includes('admin'))) return true;
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

// Todo módulo com sub-telas ganha o submenu lateral. Antes havia um `if` por
// módulo repetindo a mesma linha, e cada módulo novo exigia mais um bloco —
// esquecer dele deixava o módulo sem submenu, sem erro nenhum aparecer.
// Dashboard fica de fora porque não tem sub-telas.
function getSecondarySidebarConfig(moduleName) {
  const itens = moduleSubItems[moduleName];
  if (!moduleName || moduleName === 'dashboard' || !itens || !itens.length) return null;
  return { module: moduleName, title: moduleLabels[moduleName] || moduleName, subtitle: 'Fluxos', items: itens };
}

// A barra secundária ("Fluxos") foi desligada: ela listava exatamente as mesmas
// telas que a Área de Trabalho já mostra em blocos — em Estoque eram 18 itens
// repetidos lado a lado, e o fixar ficava escondido num alfinete miúdo da lista.
// Fixar passou para o próprio bloco, e os fixados viram uma faixa no topo do
// módulo (ver modules/shared/module_workspace.js).
//
// A função continua existindo, e devolvendo false, porque renderApp e o
// histórico de navegação ainda a consultam; tirar as chamadas seria mexer em
// pontos que não têm nada a ver com esta mudança.
function shouldShowSecondarySidebar() {
  return false;
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

  // Mesma regra do título (ver renderApp): na Área de Trabalho nenhum item do
  // submenu fica destacado, porque nenhuma das telas está aberta.
  const activeKey = state.activeSub;

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

// COLUNAS DA LISTA DE PEDIDOS E ORÇAMENTOS.
//
// O catálogo mora aqui, e não espalhado no HTML, porque três coisas precisam
// da MESMA lista e não podem discordar: o cabeçalho, a célula de cada linha e
// o seletor de colunas visíveis. Solto no template, alguém acrescenta um <th>
// e esquece o <td>, e a tabela inteira desanda uma coluna para o lado.
//
// O campo "ordenavel" espelha a lista branca do servidor (CAMPOS_ORDENAVEIS,
// em server.js): oferecer ordenação por coluna que o servidor ignora seria
// clicar e não acontecer nada.
// `f` traz os formatadores: data, brl e badge. Eles sao const LOCAIS dentro do
// loadModule, e uma lambda global nao os alcanca — a primeira versao deste
// catalogo morria com "salesFormatDate is not defined" e a tabela nao
// desenhava. Recebendo por parametro, a dependencia fica declarada e o
// catalogo continua num lugar so.
const SALES_COLUNAS = [
  { chave: 'code', rotulo: 'Código', ordenavel: true, fixa: true, valor: (r) => escapeHtml(String(r.code)) },
  { chave: 'type', rotulo: 'Tipo', ordenavel: false, valor: (r) => (r.type === 'quote' ? 'Orçamento' : 'Pedido') },
  { chave: 'date', rotulo: 'Data', ordenavel: true, valor: (r, f) => f.data(r.date) },
  { chave: 'updatedAt', rotulo: 'Data de Alteração', ordenavel: true, valor: (r, f) => (r.updatedAt ? f.data(String(r.updatedAt).slice(0, 10)) : '-') },
  { chave: 'status', rotulo: 'Status do Sistema', ordenavel: true, valor: (r, f) => f.badge(r.status) },
  { chave: 'companyName', rotulo: 'Empresa', ordenavel: true, valor: (r) => escapeHtml(r.companyName || '-') },
  { chave: 'customer', rotulo: 'Cliente', ordenavel: true, valor: (r) => escapeHtml(r.customer || '-') },
  { chave: 'nfeNumero', rotulo: 'NF-e', ordenavel: true, valor: (r) => escapeHtml(r.nfeNumero || '-') },
  { chave: 'sellerName', rotulo: 'Vendedor', ordenavel: true, valor: (r) => escapeHtml(r.sellerName || '-') },
  { chave: 'clientContact', rotulo: 'Contato do cliente', ordenavel: true, valor: (r) => escapeHtml(r.clientContact || '-') },
  { chave: 'amount', rotulo: 'Valor', ordenavel: true, valor: (r, f) => f.brl(r.totalAmount ?? r.amount) },
  { chave: 'dataEnvio', rotulo: 'Data Envio', ordenavel: true, valor: (r, f) => (r.dataEnvio ? f.data(r.dataEnvio) : '-') },
  { chave: 'saleOrigin', rotulo: 'Origem da Venda', ordenavel: true, valor: (r) => escapeHtml(r.saleOrigin || '-') }
];

// O que aparece para quem nunca escolheu nada: exatamente a tabela que existia
// antes do seletor, para quem já usava a tela não estranhar.
const SALES_COLUNAS_PADRAO = ['code', 'type', 'date', 'customer', 'companyName', 'sellerName', 'amount', 'status'];
const SALES_POR_PAGINA = [15, 30, 50, 100];

// BUSCA AVANÇADA — um catálogo só de filtros, pelo mesmo motivo do catálogo de
// colunas: o estado inicial, a leitura da URL e a escrita na URL liam três
// listas separadas, e bastava esquecer uma para o filtro funcionar na tela e
// sumir no F5.
// A mesma lista serve ao cadastro (o campo Origem da Venda) e ao filtro. Em
// duas cópias, filtrar por "Balcão" deixaria de achar as vendas de balcão no
// dia em que uma das listas mudasse.
const ORIGENS_VENDA = ['Venda Direta', 'Televendas', 'E-commerce', 'Marketplace', 'Representante', 'Balcão'];

const SALES_FILTROS = [
  'search', 'type', 'status', 'companyId', 'sellerId', 'clientSupplierId',
  'nfeNumero', 'customerPoCode', 'carrierId', 'clientStatus', 'category',
  'saleOrigin', 'clientContact', 'valorDe', 'valorAte',
  'periodo', 'dateField', 'dateFrom', 'dateTo'
];
const salesFiltrosVazios = () => {
  const vazio = {};
  SALES_FILTROS.forEach((k) => { vazio[k] = ''; });
  return vazio;
};

// "Filtrar Por": qual data o período compara. Os nomes têm de bater com o
// CAMPOS_DE_DATA do servidor — é ele quem filtra de verdade.
const SALES_CAMPOS_DE_DATA = [
  { chave: 'cadastro', rotulo: 'Data Cadastro' },
  { chave: 'alteracao', rotulo: 'Data de Alteração' },
  { chave: 'faturamento', rotulo: 'Data de Faturamento' },
  { chave: 'envio', rotulo: 'Data de Envio' }
];

const SALES_PERIODOS = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: '7dias', rotulo: 'Últimos 7 dias' },
  { chave: '30dias', rotulo: 'Últimos 30 dias' },
  { chave: 'mes', rotulo: 'Este Mês' },
  { chave: 'mespassado', rotulo: 'Mês Passado' },
  { chave: 'personalizado', rotulo: 'Personalizado' }
];

// Os atalhos de período vão para a URL pelo NOME ("hoje", "7dias"), não pelas
// datas que eles significam agora. Um link com "hoje" mandado hoje e aberto
// amanhã deve mostrar o dia de quem abre — é o que "hoje" quer dizer. Só
// "Personalizado" fixa datas, porque aí as datas SÃO a escolha.
//
// As datas são montadas com getFullYear/getMonth/getDate, e não com
// toISOString(): no Brasil (UTC-3) toISOString() depois das 21h já devolve o
// dia seguinte, e "Hoje" passaria a mostrar amanhã ao anoitecer.
function salesPeriodoEmDatas(periodo) {
  if (!periodo || periodo === 'personalizado') return null;
  const hoje = new Date();
  const iso = (d) => d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
  // "Últimos 7 dias" conta o dia de hoje: 6 dias para trás + hoje = 7.
  const diasAtras = (n) => { const d = new Date(hoje); d.setDate(d.getDate() - n); return d; };
  if (periodo === 'hoje') return { dateFrom: iso(hoje), dateTo: iso(hoje) };
  if (periodo === '7dias') return { dateFrom: iso(diasAtras(6)), dateTo: iso(hoje) };
  if (periodo === '30dias') return { dateFrom: iso(diasAtras(29)), dateTo: iso(hoje) };
  if (periodo === 'mes') {
    return { dateFrom: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), dateTo: iso(hoje) };
  }
  if (periodo === 'mespassado') {
    // Dia 0 do mês atual = último dia do mês passado. O próprio Date resolve
    // fevereiro e ano bissexto sem tabela de dias.
    return {
      dateFrom: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)),
      dateTo: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0))
    };
  }
  return null;
}

function salesColunasVisiveis() {
  const salvas = state.preferences && state.preferences.sales_lista
    ? state.preferences.sales_lista.colunas
    : null;
  const validas = Array.isArray(salvas)
    ? salvas.filter((c) => SALES_COLUNAS.some((col) => col.chave === c))
    : [];
  // Nenhuma válida (preferência antiga, coluna renomeada) cai no padrão, em vez
  // de desenhar uma tabela sem coluna nenhuma.
  const escolhidas = validas.length ? validas : SALES_COLUNAS_PADRAO;
  // Código nunca some: sem ele não há como identificar a linha.
  return SALES_COLUNAS.filter((col) => col.fixa || escolhidas.includes(col.chave));
}

// Tudo o que a sessão precisa aplicar quando um usuário entra — seja pelo
// login, seja pelo F5 que restaura por /api/me. Existe como função porque os
// dois caminhos tinham o bloco copiado, e o F5 ficou sem `state.preferences`:
// a pessoa escolhia as colunas, recarregava, e a lista voltava ao padrão.
// Divergência de cópia não avisa; some um campo de cada vez.
function adotarUsuarioDaSessao(user) {
  state.user = user;
  state.preferences = (user && user.preferences) || {};
  state.user.dashboardPins = normalizeDashboardPins([
    ...(Array.isArray(state.user.dashboardPins) ? state.user.dashboardPins : []),
    ...readStoredDashboardPins(state.user.id)
  ]);
  persistStoredDashboardPins(state.user.id, state.user.dashboardPins);
  applyTheme(state.user.theme);
}

// Guarda em memória na hora e manda para o servidor depois: preferência é
// conforto, e esperar a rede para redesenhar a tabela seria pagar caro por ela.
async function salvarPreferencia(tela, valor) {
  state.preferences = Object.assign({}, state.preferences || {}, { [tela]: valor });
  try {
    await api('/api/preferencias', { method: 'PUT', body: JSON.stringify({ tela, valor }) });
  } catch (_) {
    // Falhou o salvamento: vale nesta sessão e pronto. Um toast de erro aqui
    // interromperia o trabalho por causa de uma escolha de coluna.
  }
}

// FILTROS NA URL — é o que faz o link ser compartilhável e o F5 não perder a
// busca. Só o que está preenchido entra, senão a barra vira um paredão de
// parâmetros vazios.
function salesEscreverUrl(filtros, extras) {
  const params = new URLSearchParams();
  const tudo = Object.assign({}, filtros, extras);
  Object.keys(tudo).forEach((k) => {
    const v = tudo[k];
    if (v === '' || v === null || v === undefined) return;
    // Página 1 e ordem padrão não vão para a URL: são o estado de sempre, e
    // poluiriam todo link copiado.
    if ((k === 'page' && Number(v) === 1) || (k === 'limit' && Number(v) === 15)) return;
    // Direção sem coluna escolhida é ruído: "?dir=desc" aparecia em todo link
    // mesmo sem ninguém ter ordenado nada.
    if (k === 'dir' && !tudo.sort) return;
    params.set(k, String(v));
  });
  const busca = params.toString();
  // replaceState, não pushState: filtrar não é navegar. Empilhar histórico
  // faria o botão Voltar do navegador desfazer filtro por filtro.
  window.history.replaceState(null, '', busca ? '?' + busca : window.location.pathname);
}

function salesLerUrl() {
  const p = new URLSearchParams(window.location.search);
  const pegar = (k) => p.get(k) || '';
  const limite = Number(pegar('limit'));
  return {
    // Do catálogo, não de uma lista escrita à mão aqui: filtro novo que
    // aparecesse só na tela funcionaria até o primeiro F5.
    filtros: SALES_FILTROS.reduce((acc, k) => { acc[k] = pegar(k); return acc; }, {}),
    page: Number(pegar('page')) || 1,
    limit: SALES_POR_PAGINA.includes(limite) ? limite : 15,
    sort: pegar('sort'),
    dir: pegar('dir') === 'asc' ? 'asc' : 'desc'
  };
}

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

  // Sessão encerrada pelo servidor — login em outra máquina ('outro-dispositivo')
  // ou virada do dia ('fim-do-dia'). O token está morto, então deixar a tela
  // aberta só produziria erro a cada clique. Volta para o login já explicando.
  //
  // Qualquer motivo serve: a lista de motivos é do servidor, e travar esta
  // checagem num valor específico faria o próximo motivo criado lá cair aqui
  // como "Erro inesperado" até alguém lembrar de vir mexer neste `if`.
  //
  // Tratado aqui, e não em cada chamada, porque `api` é o único caminho até o
  // servidor — qualquer outro lugar seria um a mais para alguém esquecer.
  if (response.status === 401 && data.motivo) {
    encerrarSessaoLocal(data.error || 'Sua sessão foi encerrada.');
    // Interrompe quem chamou: sem isto a tela seguiria montando com dados que
    // nunca vieram.
    throw new Error(data.error || 'Sessão encerrada.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Erro inesperado');
  }
  return data;
}

// ---------------------------------------------------------------------------
// SAÍDA NA VIRADA DO DIA
//
// O servidor derruba a sessão à meia-noite (ver lib/sessao.js), mas ele só
// consegue avisar quando a tela fala com ele. Uma tela parada a noite toda
// continuaria mostrando o sistema como se estivesse logada, e o usuário só
// descobriria no primeiro clique da manhã seguinte. Este timer fecha a tela na
// hora certa, sozinho.
//
// O instante vem do servidor (`sessaoExpiraEm`), não do relógio local: máquina
// com hora errada sairia cedo demais ou passaria direto pelo corte. Se o timer
// falhar (máquina suspensa, aba congelada), o servidor ainda barra a próxima
// requisição — este agendamento antecipa o aviso, não substitui a regra.
// ---------------------------------------------------------------------------
let timerViradaDoDia = null;

function cancelarSaidaDaVirada() {
  if (timerViradaDoDia) clearTimeout(timerViradaDoDia);
  timerViradaDoDia = null;
}

function agendarSaidaDaVirada(expiraEm) {
  cancelarSaidaDaVirada();
  if (!expiraEm) return;
  // +2s de folga: disparar no milissegundo exato deixaria a tela e o servidor
  // discordando por um instante sobre a sessão ainda valer.
  const falta = Number(expiraEm) - Date.now() + 2000;
  // Sessão que já venceu (aba restaurada depois da meia-noite) cai na hora.
  if (falta <= 0) {
    encerrarSessaoLocal('O dia virou — as sessões são encerradas à meia-noite. Faça login novamente para continuar.');
    return;
  }
  timerViradaDoDia = setTimeout(() => {
    encerrarSessaoLocal('O dia virou — as sessões são encerradas à meia-noite. Faça login novamente para continuar.');
  }, falta);
}

// Derrubado do outro lado: limpa o que é local e volta ao login. Não chama o
// servidor — a sessão já não existe lá, e um logout daria 401 de novo.
let sessaoEncerradaAvisada = false;
function encerrarSessaoLocal(mensagem) {
  // Várias chamadas podem falhar juntas (a tela dispara mais de uma). Sem esta
  // trava, o usuário levaria um aviso para cada uma.
  if (sessaoEncerradaAvisada) return;
  sessaoEncerradaAvisada = true;

  cancelarSaidaDaVirada();
  clearSessionToken();
  state.user = null;
  state.activeModule = 'dashboard';
  state.activeSub = null;
  renderAuth(mensagem);
  showToast(mensagem, 'warning', 9000);
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

/**
 * Pergunta um TEXTO, no componente do sistema, no lugar do window.prompt().
 *
 * Resolve com a string digitada, ou null se a pessoa desistir.
 *
 * O prompt do navegador não era só feio: ele não sabe validar. A SEFAZ exige
 * 15 caracteres na justificativa de cancelamento e na Carta de Correção, e o
 * jeito antigo só descobria isso DEPOIS — a pessoa escrevia, clicava OK, a
 * caixa fechava levando o texto embora e um aviso vermelho dizia que era curto
 * demais. Para tentar de novo, digitar tudo outra vez.
 *
 * Aqui o contador anda enquanto se escreve e o botão só liga quando o texto
 * serve. E o navegador também não deixa explicar nada: o aviso de cancelamento
 * extemporâneo virava mais uma linha solta no meio do texto da pergunta.
 *
 * Reusa .modal-overlay/.modal/.modal-actions do confirmModal — o que existe
 * aqui de novo é só o corpo, com prefixo `prompt-` para não pisar em nada.
 */
function promptModal({
  titulo,
  descricao = '',
  aviso = '',
  rotulo = '',
  placeholder = '',
  minimo = 0,
  maximo = 0,
  confirmar = 'Confirmar',
  tom = 'danger'
} = {}) {
  return new Promise((resolve) => {
    document.getElementById('promptModal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'promptModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="promptModalTitulo">
        <div class="modal-body">
          <h3 class="prompt-titulo" id="promptModalTitulo"></h3>
          <p class="prompt-aviso" hidden></p>
          <p class="prompt-descricao muted" hidden></p>
          <label class="prompt-campo">
            <span class="prompt-rotulo"></span>
            <textarea rows="4" class="prompt-texto"></textarea>
          </label>
          <p class="prompt-contador muted"></p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-muted" data-action="cancel">Cancelar</button>
          <button type="button" class="btn" data-action="confirm" disabled></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // textContent, nunca innerHTML: o que chega aqui é mensagem do sistema
    // hoje, mas basta um dia passar nome de cliente para virar injeção.
    const q = (sel) => overlay.querySelector(sel);
    q('.prompt-titulo').textContent = titulo || 'Confirmação';
    if (aviso) { q('.prompt-aviso').textContent = aviso; q('.prompt-aviso').hidden = false; }
    if (descricao) { q('.prompt-descricao').textContent = descricao; q('.prompt-descricao').hidden = false; }
    q('.prompt-rotulo').textContent = rotulo;
    if (!rotulo) q('.prompt-rotulo').hidden = true;

    const campo = q('.prompt-texto');
    campo.placeholder = placeholder;
    if (maximo) campo.maxLength = maximo;

    const botao = q('[data-action=confirm]');
    botao.textContent = confirmar;
    botao.classList.add(tom === 'danger' ? 'btn-danger' : 'btn-primary');

    const contador = q('.prompt-contador');
    const valor = () => campo.value.trim();
    function revisar() {
      const n = valor().length;
      const curto = n < minimo;
      botao.disabled = curto;
      if (minimo && curto) {
        const faltam = minimo - n;
        contador.textContent = `Faltam ${faltam} caractere${faltam === 1 ? '' : 's'} para o mínimo de ${minimo}.`;
      } else if (maximo) {
        contador.textContent = `${n} de ${maximo} caracteres.`;
      } else {
        contador.textContent = `${n} caractere${n === 1 ? '' : 's'}.`;
      }
      contador.classList.toggle('prompt-contador-curto', Boolean(minimo) && curto);
    }
    campo.addEventListener('input', revisar);
    revisar();

    let encerrado = false;
    const encerrar = (resultado) => {
      if (encerrado) return;
      encerrado = true;
      document.removeEventListener('keydown', aoTeclar, true);
      overlay.remove();
      resolve(resultado);
    };
    function aoTeclar(evento) {
      if (evento.key === 'Escape') { evento.preventDefault(); encerrar(null); return; }
      // Enter sozinho quebra linha (o campo é multilinha, e justificativa longa
      // costuma ter parágrafo); confirmar é Ctrl+Enter.
      if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey) && !botao.disabled) {
        evento.preventDefault();
        encerrar(valor());
      }
    }
    document.addEventListener('keydown', aoTeclar, true);

    // Clicar fora desiste — mas só no fundo, nunca num arrasto que começou
    // dentro do campo e terminou fora, que jogaria o texto digitado no lixo.
    let comecouNoFundo = false;
    overlay.addEventListener('mousedown', (e) => { comecouNoFundo = e.target === overlay; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay && comecouNoFundo) encerrar(null); });

    q('[data-action=cancel]').addEventListener('click', () => encerrar(null));
    botao.addEventListener('click', () => { if (!botao.disabled) encerrar(valor()); });

    campo.focus();
  });
}

// Abertura que toca DEPOIS do login e ANTES do sistema aparecer: o logo vem de
// longe e passa pela câmera. Resolve quando a animação termina — ou antes, se
// o usuário pular.
//
// Só roda no login de verdade. Recarregar a página restaura a sessão por outro
// caminho (ver o bootstrap no fim do arquivo) e ali a abertura NÃO toca: quem
// dá F5 dez vezes por dia não quer ver a animação dez vezes.
function animarEntrada() {
  return new Promise((resolve) => {
    const movimentoReduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    const overlay = document.createElement('div');
    overlay.className = `intro-abertura${movimentoReduzido ? ' is-reduzida' : ''}`;
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = `
      <div class="intro-brilho"></div>
      <span class="logo-marca intro-logo" role="presentation"></span>
    `;
    document.body.appendChild(overlay);

    let encerrada = false;
    const encerrar = () => {
      if (encerrada) return;
      encerrada = true;
      window.removeEventListener('keydown', encerrar);
      overlay.remove();
      resolve();
    };

    // Pular com clique ou qualquer tecla — a abertura é enfeite, não pedágio.
    overlay.addEventListener('click', encerrar);
    window.addEventListener('keydown', encerrar);
    // O fim da cortina é o fim da abertura (o logo termina antes dela).
    overlay.addEventListener('animationend', (evento) => {
      if (evento.target === overlay) encerrar();
    });
    // Rede de segurança: em aba de segundo plano o navegador não dispara
    // animação, e o sistema não pode ficar preso atrás de uma tela escura.
    setTimeout(encerrar, movimentoReduzido ? 900 : 2400);
  });
}

// A abertura só toca no login de verdade, então conferir uma alteração nela
// exigiria sair e entrar a cada tentativa. Com isto basta digitar verIntro()
// no console do navegador (F12) para assistir de novo, de qualquer tela.
window.verIntro = animarEntrada;

function renderAuth(error = '') {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <span class="logo-marca logo-auth" role="img" aria-label="MavisONE"></span>
        <h1 class="brand">
          <span class="brand-full"><span class="brand-mavis">Mavis</span><span class="brand-one">ONE</span></span>
          <span class="brand-short"><span class="brand-mavis">M</span><span class="brand-one">O</span></span>
        </h1>
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
      // Libera o aviso de "derrubado" para a sessão nova: sem isto, quem já foi
      // derrubado uma vez e entrou de novo cairia em silêncio na segunda.
      sessaoEncerradaAvisada = false;
      agendarSaidaDaVirada(response.sessaoExpiraEm);
      adotarUsuarioDaSessao(response.user);
      // A abertura começa ANTES de montar a tela e roda por cima: o dashboard
      // carrega atrás dela, então a animação ocupa um tempo que já existia.
      const abertura = animarEntrada();
      renderApp();
      await loadModule('dashboard');
      await abertura;
      // O aviso vem depois — atrás da cortina ninguém o veria.
      showToast('Login realizado com sucesso.', 'success');
    } catch (error) {
      showToast(error.message || 'Falha ao autenticar.', 'error');
      renderAuth(error.message);
    }
  });
}

// Iniciais para o avatar: primeira e ÚLTIMA palavra. "Eduardo Haas" vira EH,
// não ED — sobrenome distingue mais do que a segunda letra do nome, e é o que
// diferencia dois "Eduardo" na mesma empresa.
function iniciaisDoUsuario(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Marca do sino. Só o PONTO, sem número.
 *
 * O painel Atenção agrupa por tipo ("2 contas vencidas"), então um número aqui
 * seria a soma de registros, e não de coisas a fazer — 23 produtos abaixo do
 * mínimo viraria "23" ao lado de duas notas rejeitadas, dando a elas o mesmo
 * peso. O ponto diz "tem algo"; a lista diz o quê.
 *
 * Falha em silêncio de propósito: sino sem marca é o estado normal, e um erro
 * de rede não pode encher a tela de toast a cada navegação.
 */
// Último painel carregado. O sino já busca no render; reaproveitar evita uma
// segunda ida ao servidor só para abrir a lista — mas ela é atualizada ao
// abrir, porque pendência resolvida há um minuto não pode continuar listada.
let ultimoPainelAtencao = null;

const SEVERIDADE_ROTULO = { alta: 'Crítico', media: 'Atenção', baixa: 'Observar' };

function fecharPainelAtencao() {
  document.getElementById('notifPainel')?.remove();
  document.getElementById('notifBtn')?.setAttribute('aria-expanded', 'false');
}

/**
 * Lista de pendências ancorada no sino.
 *
 * Painel flutuante e não uma tela: conferir o que está pendente não deveria
 * custar sair do que se está fazendo — mesma razão das janelas de atalho.
 * Cada linha leva à tela onde o problema se resolve.
 */
function desenharPainelAtencao(painel) {
  fecharPainelAtencao();
  const botao = document.getElementById('notifBtn');
  if (!botao) return;

  const itens = painel?.itens || [];
  const caixa = document.createElement('div');
  caixa.id = 'notifPainel';
  caixa.className = 'notif-painel';
  caixa.setAttribute('role', 'menu');
  caixa.innerHTML = `
    <div class="notif-painel-topo">
      <strong>Pendências</strong>
      <span class="muted">${itens.length ? `${painel.total} registro(s)` : ''}</span>
    </div>
    ${itens.length ? itens.map((item, i) => `
      <button type="button" class="notif-item" data-idx="${i}" role="menuitem">
        <span class="notif-sev notif-sev-${escapeHtml(item.severidade)}" title="${escapeHtml(SEVERIDADE_ROTULO[item.severidade] || '')}"></span>
        <span class="notif-item-texto">
          <strong>${escapeHtml(item.titulo)}</strong>
          <span>${escapeHtml(item.detalhe || '')}</span>
        </span>
        <span class="notif-item-conta">${escapeHtml(String(item.contagem))}</span>
      </button>
    `).join('')
    // Painel vazio é boa notícia, e precisa dizer isso — sem texto, parece
    // que a busca falhou.
    : '<p class="notif-vazio">Nada pendente. Contas em dia, notas autorizadas e estoque acima do mínimo.</p>'}
  `;
  document.body.appendChild(caixa);

  // Ancorado por getBoundingClientRect e não por position:absolute no botão:
  // a topbar é sticky e tem overflow próprio, que cortaria o painel.
  const r = botao.getBoundingClientRect();
  caixa.style.top = `${r.bottom + 8}px`;
  // Alinha pela direita do sino, mas nunca deixa passar da janela.
  const largura = caixa.offsetWidth;
  caixa.style.left = `${Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8))}px`;

  botao.setAttribute('aria-expanded', 'true');

  caixa.querySelectorAll('[data-idx]').forEach((linha) => {
    linha.addEventListener('click', () => {
      const item = itens[Number(linha.dataset.idx)];
      fecharPainelAtencao();
      if (!item) return;
      state.activeModule = item.modulo;
      state.activeSub = item.sub;
      renderApp();
      loadModule(item.modulo);
    });
  });
}

async function alternarPainelAtencao() {
  if (document.getElementById('notifPainel')) {
    fecharPainelAtencao();
    return;
  }
  // Desenha com o que já se tem para a lista abrir na hora, e atualiza em
  // seguida: esperar a rede para mostrar a lista faria o clique parecer morto.
  const tinhaCache = Boolean(ultimoPainelAtencao);
  if (tinhaCache) desenharPainelAtencao(ultimoPainelAtencao);

  try {
    const painel = await api('/api/dashboard/atencao');
    ultimoPainelAtencao = painel;
    // Redesenha se ainda estiver aberto, ou se nem chegou a abrir por falta de
    // cache. Se a pessoa fechou enquanto carregava, NÃO reabre sozinho.
    if (document.getElementById('notifPainel') || !tinhaCache) desenharPainelAtencao(painel);
  } catch (erro) {
    // Com cache na tela, o erro não vale um toast: a lista já está visível,
    // só não é a mais recente.
    if (!tinhaCache) showToast('Não foi possível carregar as pendências: ' + (erro.message || erro), 'error');
  }
}

async function atualizarSinoDeAtencao() {
  const marca = document.getElementById('notifDot');
  const botao = document.getElementById('notifBtn');
  if (!marca || !botao) return;
  try {
    const painel = await api('/api/dashboard/atencao');
    ultimoPainelAtencao = painel;
    const criticos = Number(painel.criticos || 0);
    const total = Number(painel.total || 0);
    marca.hidden = total === 0;
    // Vermelho só para o que já causou dano; o resto fica âmbar. Pintar tudo
    // de vermelho faria a cor parar de significar alguma coisa.
    marca.classList.toggle('is-critico', criticos > 0);
    botao.title = total === 0
      ? 'Nada pendente'
      : `${total} pendência(s)${criticos ? ` · ${criticos} crítica(s)` : ''}`;
  } catch (erro) {
    marca.hidden = true;
  }
}

// ---------------------------------------------------------------- sidebar
// Um balão só, no <body>. Dentro da .sidebar ele seria cortado: ela tem
// overflow-x: hidden, e o balão precisa aparecer justamente fora dos 72px.
function dicaDaSidebar() {
  let dica = document.getElementById('navDica');
  if (!dica) {
    dica = document.createElement('div');
    dica.id = 'navDica';
    dica.setAttribute('role', 'tooltip');
    document.body.appendChild(dica);
  }
  return dica;
}

function esconderDicaDaSidebar() {
  document.getElementById('navDica')?.classList.remove('visivel');
}

function mostrarDicaDaSidebar(botao) {
  const dica = dicaDaSidebar();
  dica.textContent = botao.querySelector('.text')?.textContent?.trim() || '';
  if (!dica.textContent) return;

  // ANCORA NA BARRA, NÃO NO BOTÃO.
  //
  // O botão é mais largo do que a barra: o rótulo tem white-space: nowrap e
  // estica o elemento até ~200px, e a .sidebar apenas o CORTA com
  // overflow-x: hidden. Medir a borda direita do botão colocava o balão
  // duzentos pixels adentro do conteúdo, longe do ícone que ele descreve.
  const barra = botao.closest('.sidebar');
  const r = botao.getBoundingClientRect();
  const borda = barra ? barra.getBoundingClientRect().right : r.right;
  dica.style.left = `${borda + 8}px`;
  // Centraliza no ícone só depois de tornar visível — antes de estar na tela
  // o balão não tem altura, e a conta daria sempre o mesmo deslocamento.
  dica.classList.add('visivel');
  dica.style.top = `${r.top + (r.height - dica.offsetHeight) / 2}px`;
}

// Registrado UMA vez: ligar() roda a cada renderApp(), e são dezenas de
// chamadas — sem a trava, cada navegação somaria mais um listener no documento.
let sidebarDocumentoLigado = false;

function ligarSidebar() {
  const barra = document.querySelector('.sidebar');
  if (!barra) return;

  barra.querySelectorAll('.nav-open-item').forEach((botao) => {
    botao.addEventListener('mouseenter', () => mostrarDicaDaSidebar(botao));
    botao.addEventListener('mouseleave', esconderDicaDaSidebar);
    // Teclado também precisa saber onde está: navegar por Tab numa barra de
    // ícones sem rótulo é adivinhação.
    botao.addEventListener('focus', () => mostrarDicaDaSidebar(botao));
    botao.addEventListener('blur', esconderDicaDaSidebar);
  });
  // Rolar a barra move o ícone e deixaria o balão parado no lugar antigo.
  barra.addEventListener('scroll', esconderDicaDaSidebar);

  if (sidebarDocumentoLigado) return;
  sidebarDocumentoLigado = true;

  // A barra NÃO abre — é sempre a faixa de ícones. Não há o que fechar; o
  // Escape só some com o balão, que pode ficar preso se o mouse sair da
  // janela sem passar pelo mouseleave.
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') return;
    esconderDicaDaSidebar();
    fecharPainelAtencao();
  });

  // Clique fora fecha a lista de pendências. Sem isto ela ficaria por cima do
  // conteúdo até alguém clicar no sino de novo.
  document.addEventListener('click', (evento) => {
    if (evento.target.closest('#notifPainel')) return;
    fecharPainelAtencao();
  });
}

function renderApp() {
  // Sem sub-tela escolhida NÃO existe sub-tela ativa: o módulo está na sua Área
  // de Trabalho, e o título mostra só o nome do módulo. Aqui havia um "ou a tela
  // padrão do módulo", de quando abrir Vendas caía direto em Pedidos — o título
  // anunciava "Vendas > Pedidos e Orçamentos" com essa tela fechada.
  const activeSubKey = state.activeSub;
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
          <span class="logo-marca logo-sidebar" role="img" aria-label="MavisONE"></span>
          <h2 class="brand">
            <span class="brand-full"><span class="brand-mavis">Mavis</span><span class="brand-one">ONE</span></span>
            <span class="brand-short"><span class="brand-mavis">M</span><span class="brand-one">O</span></span>
          </h2>
        </div>
        <div class="nav-list">
          ${MENU_MODULOS
            .filter((module) => state.user?.allowedModules?.includes(module))
            .map((module) => `
              <div class="nav-block">
                <div class="nav-item-row">
                  <button type="button" class="nav-item nav-open-item ${state.activeModule === module ? 'active' : ''}" data-module="${module}">
                    <span class="icon">${moduleIcons[module] || ''}</span>
                    <span class="text">${moduleLabels[module]}</span>
                  </button>
                  <!-- Sem botão de fixar aqui: a barra é só de ícones e nunca
                       abre, então o botão nunca teria onde caber. Fixar módulo
                       mudou para o cabeçalho da Área de Trabalho, que é onde
                       se está ao olhar para o módulo. -->
                </div>
                <div class="submenu">
                  ${ (moduleSubItems[module] || []).map((sub) => `
                    <div class="sub-item-row">
                      <button type="button" class="sub-item sub-open-item ${state.activeModule === module && state.activeSub === sub.key ? 'active' : ''}" data-module="${module}" data-sub="${sub.key}">${sub.label}</button>
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
            <div class="topbar-heading">
              <!-- Caminho acima, título embaixo. Antes tudo cabia numa linha só
                   ("Vendas > Novo Pedido") e o nome da tela competia com o do
                   módulo pelo mesmo peso visual. O caminho é referência; o
                   título é onde a pessoa está. -->
              <p class="topbar-crumb">${escapeHtml(moduleLabels[state.activeModule] || '')}${activeSubLabel ? ' / ' + escapeHtml(activeSubLabel) : ''}</p>
              <h1>${escapeHtml(activeSubLabel || moduleLabels[state.activeModule] || '')}</h1>
            </div>
          </div>
          <div class="topbar-actions">
            ${window.MavisAtalhos ? window.MavisAtalhos.barraHtml(escapeHtml, hasModuleAccess) : ''}
            <!-- Sino ligado ao painel Atenção: é a mesma contagem, então o
                 número aqui e a lista de lá nunca discordam. -->
            <button class="icon-btn topbar-sino" id="notifBtn" title="Pendências que precisam de ação" aria-label="Pendências que precisam de ação">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"></path>
                <path d="M10.3 21a2 2 0 0 0 3.4 0"></path>
              </svg>
              <span class="topbar-sino-marca" id="notifDot" hidden></span>
            </button>
            <!-- MENU DA CONTA
                 =============
                 Tema, Configurações e Sair eram três controles soltos na barra,
                 disputando espaço com o sino e os atalhos — e "Sair" ficava a um
                 clique de distância do resto, do lado de fora, sem confirmação.
                 Agora são um item só, atrás do nome de quem está logado, que é
                 onde se procura por eles.
                 O chip continua mostrando a conta ativa mesmo fechado: num ERP
                 cuja auditoria registra quem emitiu e quem cancelou nota, não dá
                 para o usuário não saber com qual conta está. -->
            <div class="topbar-conta">
              <button type="button" class="topbar-usuario" id="contaBtn"
                      aria-haspopup="menu" aria-expanded="false" aria-controls="contaMenu"
                      title="${escapeHtml(state.user?.name || '')}">
                <span class="topbar-avatar">${escapeHtml(iniciaisDoUsuario(state.user?.name))}</span>
                <span class="topbar-usuario-nome">${escapeHtml(state.user?.name || 'Usuário')}</span>
                <svg class="topbar-conta-seta" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6"></path>
                </svg>
              </button>
              <div class="topbar-conta-menu" id="contaMenu" hidden role="menu">
                <div class="topbar-conta-cabecalho">
                  <span class="topbar-avatar topbar-avatar-grande">${escapeHtml(iniciaisDoUsuario(state.user?.name))}</span>
                  <div>
                    <strong>${escapeHtml(state.user?.name || 'Usuário')}</strong>
                    <span class="muted">${escapeHtml(state.user?.username || '')}${state.user?.role === 'admin' ? ' · administrador' : ''}</span>
                  </div>
                </div>

                <!-- O tema é um INTERRUPTOR, não uma ação: o ícone sozinho na
                     barra nunca dizia em qual estado estava, só o que aconteceria
                     ao clicar. Aqui o estado atual fica escrito. -->
                <button type="button" class="topbar-conta-item" id="contaTema" role="menuitem">
                  <span class="topbar-conta-icone">${themeIconSvg(getTheme())}</span>
                  <span class="topbar-conta-texto">
                    Tema
                    <em>${getTheme() === 'dark' ? 'Escuro' : 'Claro'}</em>
                  </span>
                  <span class="topbar-conta-switch ${getTheme() === 'dark' ? 'ligado' : ''}" aria-hidden="true"><i></i></span>
                </button>

                ${hasModuleAccess('settings') ? `
                <button type="button" class="topbar-conta-item" id="contaConfig" role="menuitem">
                  <span class="topbar-conta-icone">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                  </span>
                  <span class="topbar-conta-texto">Configurações<em>Usuários, permissões e empresa</em></span>
                </button>
                ` : ''}

                <div class="topbar-conta-divisor"></div>

                <button type="button" class="topbar-conta-item topbar-conta-sair" id="logoutBtn" role="menuitem">
                  <span class="topbar-conta-icone">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                      <path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path>
                    </svg>
                  </span>
                  <span class="topbar-conta-texto">Sair</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div id="moduleContent"></div>
      </main>
    </div>
  `;

  renderSecondarySidebar();

  // Atalhos da barra superior. `api` e `showToast` são os mesmos que as telas
  // usam, então a janela flutuante trata erro e sessão encerrada igual ao resto.
  window.MavisAtalhos?.ligar({
    api,
    showToast,
    escapeHtml,
    temAcesso: hasModuleAccess,
    irPara: (modulo, sub) => {
      state.activeModule = modulo;
      state.activeSub = sub;
      renderApp();
      loadModule(modulo);
    }
  });

  document.getElementById('backBtn')?.addEventListener('click', () => {
    goBackToPreviousRoute();
  });

  // main nav click handlers
  document.querySelectorAll('.nav-open-item').forEach((button) => {
    button.onclick = () => {
      const module = button.dataset.module;
      // O balão some junto: o ícone sai de baixo do cursor quando a tela
      // troca, e sem isto ele ficaria pendurado sobre o conteúdo novo.
      esconderDicaDaSidebar();
      state.activeModule = module;
      state.activeSub = null;
      state.selectedModule = getSecondarySidebarConfig(module) ? module : null;
      renderApp();
      loadModule(state.activeModule);
    };
  });

  ligarSidebar();

  // O sino ABRE a lista ali mesmo. Levar a uma tela obrigaria a abandonar o
  // que se estava fazendo só para descobrir se havia algo a fazer.
  document.getElementById('notifBtn')?.addEventListener('click', (evento) => {
    evento.stopPropagation();
    // Fecha o menu da conta: os dois flutuam no mesmo canto, e sobrepostos o
    // usuário não sabe qual está lendo.
    fecharMenuDaConta();
    alternarPainelAtencao();
  });
  atualizarSinoDeAtencao();

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

  // Menu da conta. Mesmo comportamento do menu de Atalhos, de propósito: abre
  // no clique, fecha ao clicar fora, no Esc e ao escolher um item.
  function fecharMenuDaConta() {
    const menu = document.getElementById('contaMenu');
    if (menu) menu.hidden = true;
    document.getElementById('contaBtn')?.setAttribute('aria-expanded', 'false');
  }

  document.getElementById('contaBtn')?.addEventListener('click', (evento) => {
    evento.stopPropagation();
    const menu = document.getElementById('contaMenu');
    if (!menu) return;
    const abrindo = menu.hidden;
    // Sino e conta não convivem abertos: dois painéis flutuantes sobrepostos no
    // mesmo canto deixam o usuário sem saber qual está lendo.
    fecharPainelAtencao();
    menu.hidden = !abrindo;
    document.getElementById('contaBtn')?.setAttribute('aria-expanded', String(abrindo));
  });

  // Uma vez só, e não a cada renderApp(): renderApp roda dezenas de vezes por
  // sessão, e registrar aqui empilharia um listener por chamada — foi o defeito
  // que o menu de Atalhos já teve.
  if (!window.__mavisContaLigada) {
    window.__mavisContaLigada = true;
    document.addEventListener('click', (evento) => {
      if (!evento.target.closest('.topbar-conta')) fecharMenuDaConta();
    });
    document.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape') fecharMenuDaConta();
    });
  }

  document.getElementById('contaTema')?.addEventListener('click', async () => {
    const nextTheme = getTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    if (state.user) state.user.theme = nextTheme;
    // renderApp() redesenha o chip com o ícone, o rótulo e o interruptor no
    // estado novo — sem isso o menu continuaria dizendo "Claro" no escuro.
    renderApp();
    try {
      await api('/api/me/theme', { method: 'PUT', body: JSON.stringify({ theme: nextTheme }) });
    } catch (error) {
      showToast(error.message || 'Erro ao salvar preferência de tema.', 'error');
    }
  });

  document.getElementById('contaConfig')?.addEventListener('click', () => {
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
    // Saiu por vontade própria: o timer da virada não tem mais o que derrubar,
    // e deixá-lo vivo jogaria um aviso de "o dia virou" na tela de login.
    cancelarSaidaDaVirada();
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
  fiscal: 'Fiscal',
  reports: 'Relatórios',
  fleet: 'Frota de Veículos',
  crm: 'CRM',
  hr: 'RH',
  pcp: 'PCP',
  contracts: 'Contratos',
  settings: 'Configurações',
  cadastros: 'Cadastros'
};

// Ordem do menu lateral. Sai de moduleLabels, então módulo novo cadastrado lá
// aparece no menu sozinho — antes esta lista era fixa com 6 nomes, e os módulos
// criados depois ficavam sem entrada no menu, sem erro nenhum aparecer.
// Configurações fica de fora: ela é aberta pela engrenagem do topo.
const MENU_MODULOS = Object.keys(moduleLabels).filter((chave) => chave !== 'settings');

const moduleIcons = {
  dashboard: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="12" width="7" height="9" rx="1.5"></rect><rect x="3" y="16" width="7" height="5" rx="1.5"></rect></svg>',
  sales: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>',
  purchases: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>',
  stock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline><polyline points="7.5 19.79 7.5 14.6 3 12"></polyline><polyline points="21 12 16.5 14.6 16.5 19.79"></polyline><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
  finance: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
  settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6"></path><path d="M4.22 4.22l4.24 4.24m3.08 3.08l4.24 4.24"></path><path d="M1 12h6m6 0h6"></path><path d="M4.22 19.78l4.24-4.24m3.08-3.08l4.24-4.24"></path></svg>',
  cadastros: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
  fiscal: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2Z"></path><line x1="9" y1="8" x2="15" y2="8"></line><line x1="9" y1="12" x2="15" y2="12"></line></svg>',
  reports: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10Z"></path></svg>',
  fleet: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="13" height="10" rx="1.5"></rect><path d="M14 9h4l3 3.5V16h-7Z"></path><circle cx="5.5" cy="18" r="2"></circle><circle cx="17.5" cy="18" r="2"></circle></svg>',
  crm: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="17 11 19 13 23 9"></polyline></svg>',
  hr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><circle cx="8.5" cy="11" r="2.5"></circle><path d="M4.5 17a4 4 0 0 1 8 0"></path><line x1="16" y1="10" x2="19" y2="10"></line><line x1="16" y1="14" x2="19" y2="14"></line></svg>',
  pcp: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20V9l6 4V9l6 4V9l6 4v7Z"></path><line x1="2" y1="20" x2="22" y2="20"></line><line x1="18" y1="9" x2="18" y2="4"></line></svg>',
  contracts: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 17c1.5-2 2.5 1 4-1s2.5 1 4-1"></path></svg>'
};

// ============================================================================
// CONFIGURAÇÃO DAS ABAS (menu principal + submenus da sidebar)
// Cada chave de nível 1 é uma ABA principal; os arrays são as SUB-ABAS
// exibidas no submenu daquela aba.
//
// O campo `desc` é a frase que aparece no bloco de cada tela na Área de
// Trabalho do módulo (modules/shared/module_workspace.js). Esta lista é a
// ÚNICA fonte da verdade: menu lateral, submenu, favoritos do Dashboard Geral
// e Área de Trabalho leem todos daqui, então tela nova cadastrada aqui aparece
// nos quatro lugares sozinha.
// ============================================================================
const moduleSubItems = {
  // ABA: Dashboard Geral — sem sub-abas
  dashboard: [],

  // ABA: Vendas
  sales: [
    { key: 'orders_quotes', label: 'Pedidos e Orçamentos', desc: 'Lista de pedidos e orçamentos, com filtros, aprovação e faturamento.' },
    // Tela única: eram duas ("Novo Pedido" e "Novo Orçamento") com o mesmo
    // formulário e só o tipo mudando. Agora quem decide é o campo Status.
    { key: 'new_sale', label: 'Nova Venda', desc: 'Pedido e orçamento na mesma tela — o campo Status define qual dos dois é.' },
    { key: 'nfes', label: 'NF-e Emitidas', desc: 'Notas já emitidas, com DANFE, XML e cancelamento.' },
    { key: 'new_nfe', label: 'Nova NF-e Avulsa', desc: 'Emite uma NF-e sem partir de um pedido.' },
    { key: 'sales_dashboard', label: 'Painel Vendas', desc: 'Totais, faturados, pendentes e ticket médio.' },
    { key: 'seller_dashboard', label: 'Painel Vendedor', desc: 'Desempenho de cada vendedor.' },
    { key: 'import_logs', label: 'Logs de Vendas Importadas', desc: 'Histórico das importações já processadas.' },
    { key: 'import_sales', label: 'Importar Vendas', desc: 'Carrega vendas em lote a partir de um CSV.' }
  ],

  // ABA: Compras
  purchases: [
    { key: 'painel', label: 'Painel de Compras', desc: 'Quanto entrou, de quem e a que preço.' },
    { key: 'new_purchase', label: 'Nova Compra', desc: 'Lança uma compra e dá entrada no estoque.' },
    { key: 'purchase_history', label: 'Histórico de Compras', desc: 'Compras registradas, por período e fornecedor.' },
    { key: 'suppliers', label: 'Fornecedores', desc: 'Fornecedores cadastrados e seus dados.' }
  ],

  // ABA: Estoque
  stock: [
    { key: 'painel', label: 'Painel de Estoque', desc: 'Valor parado, giro do período e o que está para faltar.' },
    { key: 'price_manager', label: 'Gestor de Preços', desc: 'Ajusta preços de venda em lote, por margem ou valor.' },
    { key: 'movements', label: 'Movimentações', desc: 'Entradas, saídas e ajustes já lançados.' },
    { key: 'new_movement', label: 'Nova Movimentação', desc: 'Lança entrada, saída ou ajuste de estoque.' },
    { key: 'transfers', label: 'Entre Depósitos', desc: 'Transferências de produtos entre depósitos.' },
    { key: 'new_transfer', label: 'Nova Entre Depósitos', desc: 'Move produtos de um depósito para outro.' },
    { key: 'products', label: 'Produtos', desc: 'Produtos com saldo, custo e preço de venda.' },
    { key: 'new_product', label: 'Novo Produto', desc: 'Cadastra um produto novo.' },
    { key: 'product_status', label: 'Status do Produto', desc: 'Situações que um produto pode assumir.' },
    { key: 'deposits', label: 'Depósitos', desc: 'Depósitos e locais de armazenagem.' },
    { key: 'new_deposit', label: 'Novo Depósito', desc: 'Cadastra um depósito novo.' },
    { key: 'price_tables', label: 'Tabelas de Preços', desc: 'Preços por cliente ou canal de venda.' },
    { key: 'new_price_table', label: 'Nova Tabela de Preços', desc: 'Cria uma tabela de preços.' },
    { key: 'catalogs', label: 'Catálogos de Produtos', desc: 'Agrupa produtos por finalidade.' },
    { key: 'new_catalog', label: 'Novo Catálogo de Produtos', desc: 'Cria um catálogo de produtos.' },
    { key: 'classes', label: 'Classes de Produto', desc: 'Cor, voltagem e afins — cada valor com saldo de estoque próprio.' },
    { key: 'product_categories', label: 'Categorias de Produtos', desc: 'Classificação usada nos produtos.' },
    { key: 'new_product_category', label: 'Nova Categoria de Produtos', desc: 'Cria uma categoria de produtos.' },
    { key: 'movement_categories', label: 'Categorias de Movimentações', desc: 'Classificação usada nas movimentações.' },
    { key: 'new_movement_category', label: 'Nova Categoria de Movimentações', desc: 'Cria uma categoria de movimentação.' }
  ],

  // ABA: Financeiro
  finance: [
    { key: 'dashboard', label: 'Dashboard', desc: 'Receitas, despesas e saldo do período.' },
    { key: 'lancamentos', label: 'Lançamentos', desc: 'Contas a pagar e a receber, com baixa.' },
    { key: 'novo_lancamento', label: 'Novo Lançamento', desc: 'Registra uma receita ou uma despesa.' },
    { key: 'nfe_emitidas', label: 'NF-e Emitidas', desc: 'Notas emitidas, com DANFE e XML.' },
    { key: 'nova_nfe_avulsa', label: 'Nova NF-e Avulsa', desc: 'Emite uma NF-e, com pré-visualização antes de enviar.' },
    { key: 'emitir_nfe_focus', label: 'Emitir NF-e (Focus)', desc: 'Emissão pela integração Focus NFe.' },
    { key: 'extrato_open_finance', label: 'Extrato Open Finance', desc: 'Extrato bancário puxado via Open Finance.' },
    { key: 'bancos_conectados', label: 'Bancos Conectados', desc: 'Bancos ligados e situação de cada conexão.' }
  ],

  // ABA: Fiscal
  // "Tabelas Fiscais" é a consulta dos códigos oficiais (Fase Q); "Regras
  // Fiscais" é quem decide QUAL desses códigos se aplica a cada operação, e é
  // de onde a emissão de NF-e tira CFOP e tributação de cada item.
  fiscal: [
    { key: 'painel', label: 'Painel Fiscal', desc: 'Notas transmitidas, autorizadas e o que a SEFAZ recusou.' },
    // NF-e Emitidas e Nova NF-e Avulsa são as MESMAS telas do Financeiro,
    // espelhadas aqui (modules/fiscal/subs/nfe_espelho.js) — não uma segunda
    // versão para manter.
    { key: 'nfe_emitidas', label: 'NF-e Emitidas', desc: 'Notas emitidas, com DANFE, XML e cancelamento.' },
    { key: 'emitir_nfe_focus', label: 'Emitir NF-e (SEFAZ)', desc: 'Transmite a nota à SEFAZ usando a regra fiscal e o cadastro do produto.' },
    { key: 'nova_nfe_avulsa', label: 'Nova NF-e Avulsa', desc: 'Emite uma NF-e sem partir de um pedido.' },
    { key: 'inutilizadas', label: 'NF-e Inutilizadas', desc: 'Faixas de numeração queimadas na SEFAZ.' },
    { key: 'inutilizar', label: 'Inutilizar NF-e', desc: 'Declara que uma faixa de números não virará nota.' },
    { key: 'eventos', label: 'Eventos NF-e', desc: 'Cartas de correção, cancelamentos e inutilizações.' },
    { key: 'logs', label: 'Logs NF-e', desc: 'O que foi enviado à SEFAZ e o que ela respondeu.' },
    { key: 'tabelas', label: 'Tabelas Fiscais', desc: 'Consulta os códigos oficiais: CFOP, CST, CSOSN e origem.' },
    { key: 'regras', label: 'Regras Fiscais', desc: 'Define qual CFOP e qual tributação se aplicam a cada operação.' }
  ],

  // ABA: Relatórios
  // Montados sobre dados que já existem — nenhum depende de tabela nova.
  reports: [
    { key: 'vendas', label: 'Relatório de Vendas', desc: 'Pedidos, orçamentos, faturamento e ticket médio.' },
    { key: 'financeiro', label: 'Relatório Financeiro', desc: 'Receitas, despesas e saldo ao longo do período.' },
    { key: 'estoque', label: 'Relatório de Estoque', desc: 'Saldo, custo e valor parado por produto.' },
    { key: 'vendedores', label: 'Relatório por Vendedor', desc: 'Quanto cada vendedor fechou no período.' }
  ],

  // ABA: Frota de Veículos
  fleet: [
    { key: 'painel', label: 'Painel de Frota', desc: 'Custo por veículo, combustível e manutenção.' },
    { key: 'veiculos', label: 'Veículos', desc: 'Frota cadastrada, com placa, situação e quilometragem.' },
    { key: 'novo_veiculo', label: 'Novo Veículo', desc: 'Cadastra um veículo na frota.' },
    { key: 'manutencoes', label: 'Manutenções', desc: 'Preventivas e corretivas, com custo e oficina.' },
    { key: 'nova_manutencao', label: 'Nova Manutenção', desc: 'Registra uma manutenção de veículo.' },
    { key: 'abastecimentos', label: 'Abastecimentos', desc: 'Litros, valor e gasto por veículo.' },
    { key: 'novo_abastecimento', label: 'Novo Abastecimento', desc: 'Lança um abastecimento.' }
  ],

  // ABA: CRM
  // Por decisão de projeto este módulo NÃO guarda cadastro próprio: ele lê do
  // CRM externo. Evita duas fontes da verdade divergindo — em troca, depende
  // da API do outro sistema estar no ar.
  crm: [
    { key: 'conexao', label: 'Conexão', desc: 'Endereço e credencial do CRM externo, com teste de conexão.' },
    { key: 'oportunidades', label: 'Oportunidades', desc: 'Funil de vendas, lido do CRM externo.' },
    { key: 'contas', label: 'Contas', desc: 'Clientes e prospects, lidos do CRM externo.' }
  ],

  // ABA: RH
  // Departamentos, Tipo, Categoria e Profissões são cadastros de APOIO: lista e
  // formulário na mesma tela (makeInlineRegisterScreen), por isso não têm o par
  // "Novo X" no menu. Colaborador e Expediente têm campo demais para caber
  // embaixo da lista, e ficam com tela de formulário própria.
  hr: [
    { key: 'painel', label: 'Painel de RH', desc: 'Quadro atual, admissões, desligamentos e afastados.' },
    { key: 'colaboradores', label: 'Colaboradores', desc: 'Quadro de pessoal, com profissão, departamento e admissão.' },
    { key: 'novo_colaborador', label: 'Novo Colaborador', desc: 'Cadastra um colaborador com vínculo, expediente e contrato.' },
    { key: 'departamentos', label: 'Departamentos', desc: 'Setores da empresa, com responsável e centro de custo.' },
    { key: 'expedientes', label: 'Expedientes', desc: 'Jornadas contratadas: horário, carga semanal e tolerância.' },
    { key: 'novo_expediente', label: 'Novo Expediente', desc: 'Cadastra uma jornada de trabalho.' },
    { key: 'tipos_colaborador', label: 'Tipo Colaboradores', desc: 'Vínculo: CLT, PJ, estágio, aprendiz, temporário.' },
    { key: 'categorias_colaborador', label: 'Categoria Colaboradores', desc: 'Forma de remuneração: mensalista, horista, comissionado.' },
    { key: 'profissoes', label: 'Profissões', desc: 'Profissões e faixas salariais, com o código CBO.' },
    { key: 'ferias', label: 'Férias e Afastamentos', desc: 'Férias, licenças e faltas registradas.' },
    { key: 'nova_ausencia', label: 'Nova Ausência', desc: 'Registra férias, licença ou afastamento.' },
    { key: 'ponto', label: 'Registro de Ponto', desc: 'Marcações de entrada, almoço e saída.' },
    { key: 'novo_ponto', label: 'Novo Registro de Ponto', desc: 'Lança as marcações de um dia.' }
  ],

  // ABA: PCP
  // Status PCP e Controle de Qualidade têm o formulário embutido na lista
  // (makeInlineRegisterScreen), por isso não têm o par "Novo X" no menu.
  pcp: [
    { key: 'painel', label: 'Painel de Produção', desc: 'Fila, atrasos, produção apontada e qualidade.' },
    { key: 'ordens', label: 'Ordens de Produção', desc: 'Ordens abertas, em curso e concluídas, com setor e status.' },
    { key: 'nova_ordem', label: 'Nova Ordem Produção', desc: 'Abre uma ordem a partir de um produto.' },
    { key: 'setores', label: 'Setores PCP', desc: 'Centros de trabalho, na ordem em que a peça caminha.' },
    { key: 'novo_setor', label: 'Novo Setor PCP', desc: 'Cadastra um setor com responsável e capacidade.' },
    { key: 'status_pcp', label: 'Status PCP', desc: 'Os status que a empresa usa dentro de cada etapa da produção.' },
    { key: 'qualidade', label: 'Controle Qualidade', desc: 'Inspeção por ordem: quanto foi aprovado e o que reprovou.' },
    { key: 'estrutura', label: 'Estrutura de Produto', desc: 'Ficha técnica: o que cada produto consome.' },
    { key: 'nova_estrutura', label: 'Novo Item de Estrutura', desc: 'Vincula um componente a um produto.' },
    { key: 'apontamentos', label: 'Apontamentos', desc: 'Produção realizada por ordem.' },
    { key: 'novo_apontamento', label: 'Novo Apontamento', desc: 'Registra o que foi produzido.' }
  ],

  // ABA: Contratos
  // TIPO é a classificação do contrato; MODELO é o texto que se reaproveita ao
  // emitir. São coisas diferentes e por isso são duas telas.
  contracts: [
    { key: 'painel', label: 'Painel de Contratos', desc: 'Receita recorrente e o que vence à frente.' },
    { key: 'contratos', label: 'Contratos', desc: 'Contratos ativos, encerrados e seus valores, com aviso de prazo.' },
    { key: 'novo_contrato', label: 'Novo Contrato', desc: 'Registra um contrato com cliente ou fornecedor.' },
    { key: 'tipos', label: 'Tipos de Contratos', desc: 'Classificação do contrato e o prazo de aviso prévio de cada uma.' },
    { key: 'novo_tipo', label: 'Novo Tipo de Contrato', desc: 'Cadastra um tipo com natureza e prazo de aviso.' },
    { key: 'vencimentos', label: 'Vencimentos e Renovações', desc: 'O que vence ou renova nos próximos meses.' },
    { key: 'modelos', label: 'Modelos de Contrato', desc: 'Textos-padrão reutilizados na emissão.' },
    { key: 'novo_modelo', label: 'Novo Modelo', desc: 'Cria um modelo de contrato.' }
  ],

  // ABA: Configurações
  settings: [
    { key: 'users', label: 'Usuários', desc: 'Usuários do sistema e seus acessos.' },
    { key: 'access_control', label: 'Papéis e Permissões', desc: 'O que cada papel pode ver e fazer.' },
    { key: 'access_logs', label: 'Auditoria de Acesso', desc: 'Quem acessou o quê, e quando.' },
    { key: 'company', label: 'Empresa', desc: 'Dados da empresa, certificado e configuração fiscal.' },
    // Estava fora desta lista e só era alcançável pelo botão dentro de
    // "Empresa". Sem a entrada aqui, o título e o caminho no topo saíam em
    // branco (o label vem justamente daqui), como se a tela não tivesse nome.
    { key: 'fiscal', label: 'Empresas e Estabelecimentos', desc: 'Cadastro fiscal, token da Focus NFe e regras por estabelecimento.' }
  ],

  // ABA: Cadastros
  cadastros: [
    { key: 'consulta_cnpj', label: 'Consulta CNPJ SEFAZ', desc: 'Busca um CNPJ e traz os dados oficiais.' },
    { key: 'list', label: 'Pessoas', desc: 'Clientes, fornecedores e demais pessoas.' },
    { key: 'contatos', label: 'Contatos', desc: 'Contatos vinculados às pessoas cadastradas.' },
    { key: 'register', label: 'Nova Pessoa', desc: 'Cadastra pessoa física ou jurídica.' },
    { key: 'produtos', label: 'Produtos', desc: 'Produtos com dados comerciais e fiscais.' },
    { key: 'novo_produto', label: 'Novo Produto', desc: 'Cadastra um produto novo.' },
    { key: 'classes_produto', label: 'Classes de Produto', desc: 'Cor, voltagem e afins — as mesmas do Estoque.' },
    { key: 'cashback', label: 'CashBack por Produto', desc: 'Percentual de cashback de cada produto.' },
    { key: 'agenda', label: 'Agenda de Tarefas', desc: 'Tarefas abertas e concluídas.' },
    { key: 'agendamentos', label: 'Agendamentos', desc: 'Compromissos marcados na agenda.' },
    { key: 'empresas', label: 'Empresas', desc: 'Empresas do grupo, cada uma com seu CNPJ.' },
    { key: 'nova_empresa', label: 'Nova Empresa', desc: 'Cadastra uma empresa nova.' },
    { key: 'equipamentos', label: 'Equipamentos', desc: 'Equipamentos e seus vínculos com clientes.' },
    { key: 'contas_bancarias', label: 'Contas Bancárias', desc: 'Contas usadas em recebimentos e pagamentos.' },
    { key: 'nova_conta_bancaria', label: 'Nova Conta Bancária', desc: 'Cadastra uma conta bancária.' },
    { key: 'formas_pagamento', label: 'Formas de Pagamento', desc: 'Formas aceitas e suas condições.' },
    { key: 'nova_forma_pagamento', label: 'Nova Forma de Pagamento', desc: 'Cadastra uma forma de pagamento.' },
    { key: 'status_venda', label: 'Status de Venda', desc: 'Situações que um pedido pode assumir.' },
    { key: 'deposits', label: 'Depósitos', desc: 'Depósitos cadastrados, os mesmos do Estoque.' }
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
const LUPA_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';

/**
 * Campo de busca com sugestão.
 *
 * NÃO abre a lista inteira ao receber o foco. Abrir despejava todos os
 * cadastros em cima do formulário só por clicar no campo — com centenas de
 * clientes, a lista não ajuda a achar ninguém e ainda tapa os campos de baixo.
 * A sugestão aparece conforme se digita: "gal" traz "Galpão".
 *
 * A lupa é a saída para quem não sabe o nome: clicar nela abre a lista toda,
 * de propósito. É o mesmo comportamento de antes, agora sob demanda — e é ela
 * que diz, olhando, que o campo é de busca e não um texto qualquer.
 */
function renderSearchableSelect({ id, name, options, selectedValue, placeholder, required }) {
  const selected = options.find((o) => String(o.value) === String(selectedValue || ''));
  return `
    <div class="searchable-select" id="${id}Wrapper">
      <input type="text" class="searchable-select-input" id="${id}Input" autocomplete="off"
        placeholder="${escapeHtml(placeholder || 'Buscar...')}" value="${escapeHtml(selected ? selected.label : '')}" ${required ? 'required' : ''} />
      <button type="button" class="searchable-select-lupa" id="${id}Lupa"
        title="Ver todas as opções" aria-label="Ver todas as opções">${LUPA_SVG}</button>
      <input type="hidden" name="${name}" id="${id}Value" value="${escapeHtml(selectedValue || '')}" />
      <div class="searchable-select-dropdown" id="${id}Dropdown" hidden></div>
    </div>
  `;
}

// Chamar depois de inserir o HTML no DOM (mesmo padrão de outros handlers
// desta tela, que são reconectados a cada re-render). `onSelect(value, option)`
// dispara quando o usuário escolhe um item — `option` é o objeto original
// passado em `options`, útil pra ler outros campos dele (preço, sku etc.).
// Busca sem acento: quem digita "galpao" tem que achar "Galpão", e quem digita
// "sao paulo" tem que achar "São Paulo". Sem isto o campo só serve para quem
// acerta a acentuação de cabeça.
function textoDeBusca(valor) {
  return String(valor || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function attachSearchableSelect({ id, options, onSelect }) {
  const input = document.getElementById(`${id}Input`);
  const hidden = document.getElementById(`${id}Value`);
  const dropdown = document.getElementById(`${id}Dropdown`);
  const lupa = document.getElementById(`${id}Lupa`);
  if (!input || !hidden || !dropdown) return;

  // Índice de busca calculado uma vez, não a cada tecla: normalizar centenas
  // de rótulos a cada letra digitada trava o campo em cadastros grandes.
  const indice = options.map((o) => ({ opcao: o, busca: textoDeBusca(o.label) }));

  function renderDropdown(filterText, { mostrarTudo = false } = {}) {
    const term = textoDeBusca(filterText).trim();
    // Sem termo e sem pedido explícito pela lupa, não abre nada. É a diferença
    // entre um campo de busca e um select disfarçado.
    if (!term && !mostrarTudo) {
      dropdown.hidden = true;
      return;
    }
    const filtrados = term ? indice.filter((i) => i.busca.includes(term)) : indice;
    // O corte em 50 é o que mantém a lista utilizável; sem avisar, o usuário
    // procuraria um item que existe e não aparece.
    const mostrados = filtrados.slice(0, 50);
    const aviso = filtrados.length > mostrados.length
      ? `<div class="searchable-select-empty">Mostrando ${mostrados.length} de ${filtrados.length} — digite mais para refinar.</div>`
      : '';
    dropdown.innerHTML = mostrados.length
      ? mostrados.map(({ opcao }) => `<div class="searchable-select-option" data-value="${escapeHtml(String(opcao.value))}">${escapeHtml(opcao.label)}</div>`).join('') + aviso
      : '<div class="searchable-select-empty">Nenhum resultado</div>';
    dropdown.hidden = false;
  }

  input.addEventListener('input', () => {
    hidden.value = '';
    renderDropdown(input.value);
  });
  // Digitar e reabrir o que já estava filtrado: se o campo tem texto, o foco
  // mostra o que combina com ele — não a lista inteira.
  input.addEventListener('focus', () => {
    if (input.value.trim()) renderDropdown(input.value);
  });
  input.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !dropdown.hidden) {
      evento.stopPropagation();
      dropdown.hidden = true;
    }
  });
  // A saída para quem não sabe o nome: abre tudo, sob demanda.
  //
  // mousedown com preventDefault, e não click: clicar tira o foco do input, e
  // o blur agenda o fechamento do dropdown para 150ms depois — a lista abriria
  // e sumiria sozinha. É o mesmo motivo pelo qual o dropdown usa mousedown.
  lupa?.addEventListener('mousedown', (evento) => {
    evento.preventDefault();
    if (!dropdown.hidden) { dropdown.hidden = true; return; }
    renderDropdown('', { mostrarTudo: true });
    input.focus();
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
  return window.MavisDocumento.formatar(value);
}

// CPF/CNPJ mora em modules/shared/documento.js, carregado antes deste arquivo.
// Estes são apelidos: os nomes antigos continuam valendo nas dezenas de
// chamadas espalhadas por esta tela, mas a REGRA é uma só — duas cópias
// divergiriam na primeira correção feita de um lado.
const isValidCpf = (cpf) => window.MavisDocumento.validoCpf(cpf);
const isValidCnpj = (cnpj) => window.MavisDocumento.validoCnpj(cnpj);
const isValidDocument = (documentValue) => window.MavisDocumento.valido(documentValue);

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

const getDocumentType = (documentValue) => window.MavisDocumento.tipoDe(documentValue);
const maskDocumentValue = (value, type = '') => window.MavisDocumento.mascarar(value, type);

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
    // ABA: VENDAS (9 sub-abas — ver comentários abaixo de cada `sub ===`)
    // ========================================================================
    if (moduleName === 'sales') {
      const rawSub = state.activeSub || 'orders_quotes';
      // A última rota fica salva no navegador, então ela pode apontar para uma
      // tela que não existe mais (saíram daqui agrupamento de pedidos,
      // devoluções, vales de crédito, integrações e promoções). Sem esta
      // checagem nenhum `if` abaixo casaria e o módulo terminaria sem escrever
      // nada — tela branca que voltaria a cada recarregamento, porque a rota
      // inválida continuaria sendo salva. A lista válida é o próprio menu,
      // para não existir uma segunda lista para manter em dia.
      // "Novo Pedido" e "Novo Orçamento" viraram uma tela só. Rota antiga salva
      // no navegador (ou link antigo em favorito) aterrissa na tela nova em vez
      // de cair na lista — a segunda entrada leva o status já escolhido.
      const ROTAS_ANTIGAS = { new_order: 'new_sale', new_quote: 'new_sale' };
      if (ROTAS_ANTIGAS[rawSub] && !state.salesDraft?.novoStatus && !state.salesDraft?.editRecord) {
        state.salesDraft = state.salesDraft || {};
        state.salesDraft.novoStatus = rawSub === 'new_quote' ? 'orcamento' : 'pedido';
      }
      const subAlvo = ROTAS_ANTIGAS[rawSub] || rawSub;
      const sub = moduleSubItems.sales.some((item) => item.key === subAlvo) ? subAlvo : 'orders_quotes';
      // Corrige o estado, não só a variável: senão o menu lateral segue sem
      // destacar nada e a rota morta continua sendo gravada.
      if (sub !== rawSub) state.activeSub = sub;

      const SalesStatus = window.MavisSalesStatus;
      // NF-e tem status próprio (documento fiscal, não venda) e usa o mesmo
      // helper de badge — por isso as duas chaves ficam fora do catálogo.
      const STATUS_NFE = {
        'emitida': { label: 'Emitida', tone: 'success' },
        'cancelada': { label: 'Cancelada', tone: 'danger' }
      };
      const salesStatusBadge = (status) => {
        const key = String(status || '').toLowerCase();
        const nfe = STATUS_NFE[key];
        if (nfe) return `<span class="finance-badge finance-badge-${nfe.tone}">${nfe.label}</span>`;
        const meta = SalesStatus.meta(status);
        return `<span class="finance-badge finance-badge-${meta.tom}">${escapeHtml(meta.label)}</span>`;
      };
      const salesFormatDate = (value) => {
        if (!value) return '-';
        const [y, m, d] = String(value).split('-');
        if (!y || !m || !d) return value;
        return `${d}/${m}/${y}`;
      };
      const salesFormatBRL = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      // Tamanho de arquivo em unidade legivel. "1048576 bytes" nao diz nada a
      // quem esta conferindo se cabe no limite de 10 MB.
      const salesFormatTamanho = (bytes) => {
        const n = Number(bytes || 0);
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(".", ",") + " KB";
        return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
      };
      // Saldo de estoque aceita fracionário (produto vendido por kg/metro), mas
      // a esmagadora maioria é inteira — mostrar "38" e não "38,000".
      const salesFormatQty = (value) => {
        const n = Number(value || 0);
        return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
      };

      // Sub-aba: Pedidos e Orçamentos
      if (sub === 'orders_quotes') {
        const draft = state.salesDraft || (state.salesDraft = {});
        // A URL manda na PRIMEIRA entrada; depois quem manda é o estado da
        // tela. Sem esse "só uma vez", qualquer redesenho (salvar, excluir,
        // paginar) puxaria os filtros do link de volta e desfaria o que a
        // pessoa acabou de mudar.
        if (!draft.ordersUrlLida) {
          const daUrl = salesLerUrl();
          draft.ordersUrlLida = true;
          draft.ordersFilters = daUrl.filtros;
          draft.ordersPage = daUrl.page;
          draft.ordersLimit = daUrl.limit;
          draft.ordersSort = daUrl.sort;
          draft.ordersDir = daUrl.dir;
          // Link com filtro abre o painel: senão a lista aparece filtrada e
          // nada na tela explica por quê.
          const temFiltroAlemDaBusca = Object.keys(daUrl.filtros)
            .some((k) => k !== 'search' && daUrl.filtros[k]);
          if (temFiltroAlemDaBusca) draft.showOrdersFilters = true;
        }
        const filters = draft.ordersFilters || (draft.ordersFilters = salesFiltrosVazios());
        // Ids selecionados. No draft para sobreviver ao redesenho da lista
        // (paginar, ordenar); fora da URL de propósito — seleção é intenção do
        // momento, não filtro que se compartilha por link.
        if (!Array.isArray(draft.selecionados)) draft.selecionados = [];
        const showFilters = Boolean(draft.showOrdersFilters);
        const page = draft.ordersPage || 1;
        const limit = SALES_POR_PAGINA.includes(draft.ordersLimit) ? draft.ordersLimit : 15;
        const sort = draft.ordersSort || '';
        const dir = draft.ordersDir === 'asc' ? 'asc' : 'desc';
        const colunas = salesColunasVisiveis();
        const mostrandoSeletor = Boolean(draft.showOrdersColunas);

        // O atalho de período vira datas AQUI, na hora de perguntar ao
        // servidor — e não na URL, que guarda o nome do atalho. Assim um link
        // com "Hoje" aberto amanhã mostra o dia de quem abre.
        const periodoEmDatas = salesPeriodoEmDatas(filters.periodo);
        const filtrosDaConsulta = Object.assign({}, filters, periodoEmDatas || {});

        const params = new URLSearchParams({ view: 'orders_quotes', page: String(page), limit: String(limit) });
        Object.entries(filtrosDaConsulta).forEach(([key, value]) => {
          // `periodo` é vocabulário da tela: o servidor só entende datas, e
          // mandar o nome do atalho seria pedir para ele adivinhar o fuso de
          // quem está olhando.
          if (key === 'periodo') return;
          if (value) params.set(key, value);
        });
        if (sort) { params.set('sort', sort); params.set('dir', dir); }
        salesEscreverUrl(filters, { page, limit, sort, dir });

        const data = await api(`/api/sales/records?${params.toString()}`);
        const records = data.records || [];
        const totalPages = Math.max(1, Math.ceil((data.total || 0) / limit));
        const meta = data.meta || { companies: [], sellers: [], deposits: [], directory: [], carriers: [], productCategories: [] };

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
              <!-- Um botão só, como a tela: pedido ou orçamento é escolha do
                   campo Status lá dentro, não de qual botão foi clicado. -->
              <button type="button" onclick="state.salesDraft.editRecord=null; state.salesDraft.novoStatus=''; state.activeSub='new_sale'; renderApp(); loadModule('sales');">+ Nova Venda</button>
              <button type="button" class="secondary" id="salesFilterToggleBtn">${showFilters ? 'Ocultar filtros' : 'Busca avançada'}</button>
              <button type="button" class="secondary" id="salesColunasBtn" title="Escolher colunas visíveis" aria-expanded="${mostrandoSeletor}">Colunas</button>
            </div>
          </div>

          ${mostrandoSeletor ? `
            <div class="panel" id="salesColunasPainel" style="margin-bottom:12px;">
              <p class="muted" style="margin-top:0;">Colunas visíveis — a escolha fica guardada na sua conta.</p>
              <div class="cadastro-filter-grid-5">
                ${SALES_COLUNAS.map((col) => `
                  <label class="muted" style="display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" data-coluna-visivel="${col.chave}"
                      ${colunas.some((c) => c.chave === col.chave) ? 'checked' : ''}
                      ${col.fixa ? 'checked disabled title="O código identifica a linha e não pode ser escondido."' : ''} />
                    ${col.rotulo}
                  </label>`).join('')}
              </div>
            </div>` : ''}

          <form id="salesQuickSearchForm" class="row" style="margin-bottom: 12px;">
            <label class="cadastro-field" style="grid-column: span 3;">
              <span>Busca</span>
              <input id="salesQuickSearch" name="search" value="${escapeHtml(filters.search)}" placeholder="Código ou cliente" />
            </label>
            <div style="align-self: end;"><button type="submit" class="secondary">Buscar</button></div>
          </form>

          ${showFilters ? `
            <form id="salesFilterForm" class="cadastro-filter-panel">
              <div class="sales-busca-avancada">
                <div>
                  <div class="cadastro-filter-grid-5">
                    <!-- Tipo e Status são filtros distintos de propósito: o
                         status já implica o tipo, mas "todos os pedidos, em
                         qualquer etapa" é a pergunta mais comum da lista. -->
                    <label class="cadastro-field">
                      <span>Tipo</span>
                      <select name="type">
                        <option value="">Todos</option>
                        <option value="order" ${filters.type === 'order' ? 'selected' : ''}>Pedido</option>
                        <option value="quote" ${filters.type === 'quote' ? 'selected' : ''}>Orçamento</option>
                      </select>
                    </label>
                    <label class="cadastro-field">
                      <span>Status do Sistema</span>
                      <select name="status">
                        <option value="">Todos</option>
                        <!-- Aqui o catálogo inteiro é selecionável: filtrar por
                             um status que o sistema atribui é justamente o uso
                             deles. -->
                        ${SalesStatus.CATALOGO.map((item) => `<option value="${item.value}" ${filters.status === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
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
                    <!-- Uma caixa só para as três notas: quem procura por um
                         número não quer antes descobrir se ele é de NF-e,
                         NFC-e ou NFS-e. -->
                    <label class="cadastro-field">
                      <span>Nº da NF-e / NFC-e / NFS-e</span>
                      <input name="nfeNumero" value="${escapeHtml(filters.nfeNumero)}" placeholder="Número da nota" />
                    </label>
                    <label class="cadastro-field">
                      <span>Ordem de Compra do Cliente</span>
                      <input name="customerPoCode" value="${escapeHtml(filters.customerPoCode)}" placeholder="OC do cliente" />
                    </label>
                    <label class="cadastro-field" ${(meta.carriers || []).length ? '' : 'title="Nenhum cadastro está marcado como Transportadora."'}>
                      <span>Transportadora${(meta.carriers || []).length ? '' : ' <span class="muted">(nenhuma cadastrada)</span>'}</span>
                      <select name="carrierId" ${(meta.carriers || []).length ? '' : 'disabled'}>
                        <option value="">Todas</option>
                        ${(meta.carriers || []).map((t) => `<option value="${escapeHtml(t.id)}" ${filters.carrierId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="cadastro-field" ${(meta.productCategories || []).length ? '' : 'title="Nenhuma categoria de produto cadastrada no Estoque."'}>
                      <span>Categoria${(meta.productCategories || []).length ? '' : ' <span class="muted">(nenhuma cadastrada)</span>'}</span>
                      <select name="category" ${(meta.productCategories || []).length ? '' : 'disabled'}>
                        <option value="">Todas</option>
                        ${(meta.productCategories || []).map((c) => `<option value="${escapeHtml(c.name)}" ${filters.category === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="cadastro-field">
                      <span>Origem da Venda</span>
                      <select name="saleOrigin">
                        <option value="">Todas</option>
                        ${ORIGENS_VENDA.map((o) => `<option value="${escapeHtml(o)}" ${filters.saleOrigin === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
                      </select>
                    </label>
                    <!-- "Status" (do cliente) é texto livre no cadastro, então
                         aqui também é: um select inventaria uma lista que o
                         cadastro não usa. -->
                    <label class="cadastro-field">
                      <span>Status do Cliente</span>
                      <input name="clientStatus" value="${escapeHtml(filters.clientStatus)}" placeholder="Parte do texto" />
                    </label>
                    <label class="cadastro-field">
                      <span>Contato do cliente</span>
                      <input name="clientContact" value="${escapeHtml(filters.clientContact)}" placeholder="Nome do contato" />
                    </label>
                    <label class="cadastro-field">
                      <span>Valor De (R$)</span>
                      <input name="valorDe" type="number" step="0.01" min="0" value="${escapeHtml(filters.valorDe)}" placeholder="0,00" />
                    </label>
                    <label class="cadastro-field">
                      <span>Valor Até (R$)</span>
                      <input name="valorAte" type="number" step="0.01" min="0" value="${escapeHtml(filters.valorAte)}" placeholder="0,00" />
                    </label>
                    <!-- Atributos ainda não existem no cadastro do pedido.
                         Campo habilitado sobre dado que ninguém consegue
                         preencher devolveria "nenhum resultado" para toda
                         busca, e a lista pareceria vazia por outro motivo. -->
                    <label class="cadastro-field" title="Os atributos do pedido entram no cadastro; até lá não há o que filtrar.">
                      <span>Atributo <span class="muted">(em breve)</span></span>
                      <input disabled placeholder="Depende dos atributos no cadastro" />
                    </label>
                    <label class="cadastro-field" title="Os atributos do pedido entram no cadastro; até lá não há o que filtrar.">
                      <span>Valor do Atributo <span class="muted">(em breve)</span></span>
                      <input disabled placeholder="Depende dos atributos no cadastro" />
                    </label>
                  </div>

                  <!-- Os quatro marcadores dependem de registro que o sistema
                       ainda não faz: ninguém anota quando um pedido foi
                       impresso, nem se veio por API, e ordem de produção ainda
                       não se liga ao pedido. Ficam à vista e desligados, com o
                       motivo, em vez de filtrar sempre por "não". -->
                  <div class="cadastro-filter-toggle-list" style="margin-top:12px;">
                    ${[
                      ['Impresso', 'Ninguém registra ainda quando o pedido é impresso.'],
                      ['Impresso Danfe', 'A impressão da DANFE não fica registrada no pedido.'],
                      ['Via API', 'Não há marcação de origem por API nos pedidos.'],
                      ['Ordem de Produção', 'As ordens de produção ainda não se ligam ao pedido.']
                    ].map(([rotulo, motivo]) => `
                      <label class="muted" title="${escapeHtml(motivo)}">
                        <input type="checkbox" disabled /> ${escapeHtml(rotulo)} <span class="muted">(em breve)</span>
                      </label>`).join('')}
                  </div>
                </div>

                <!-- Bloco de datas à direita, como no sistema de referência: a
                     pergunta "quando" é uma só, e separá-la dos campos de
                     "quem/o quê" deixa claro que Período, Data Inicial/Final e
                     Filtrar Por trabalham juntos. -->
                <aside class="sales-busca-datas">
                  <h4>Filtros por Datas</h4>
                  <label class="cadastro-field">
                    <span>Por Período</span>
                    <select name="periodo" id="salesPeriodo">
                      <option value="">Qualquer data</option>
                      ${SALES_PERIODOS.map((p) => `<option value="${p.chave}" ${filters.periodo === p.chave ? 'selected' : ''}>${escapeHtml(p.rotulo)}</option>`).join('')}
                    </select>
                  </label>
                  <!-- Com um atalho escolhido, as datas viram resultado, não
                       entrada: aparecem preenchidas e travadas para mostrar
                       QUE intervalo o atalho quer dizer hoje. -->
                  <label class="cadastro-field">
                    <span>Data Inicial</span>
                    <input type="date" name="dateFrom"
                      value="${escapeHtml(periodoEmDatas ? periodoEmDatas.dateFrom : filters.dateFrom)}"
                      ${periodoEmDatas ? 'disabled' : ''} />
                  </label>
                  <label class="cadastro-field">
                    <span>Data Final</span>
                    <input type="date" name="dateTo"
                      value="${escapeHtml(periodoEmDatas ? periodoEmDatas.dateTo : filters.dateTo)}"
                      ${periodoEmDatas ? 'disabled' : ''} />
                  </label>
                  <!-- Sem isto, procurar o que foi ENVIADO na semana passada
                       devolvia o que foi CADASTRADO na semana passada —
                       parecido o bastante para ninguém desconfiar. -->
                  <label class="cadastro-field">
                    <span>Filtrar Por</span>
                    <select name="dateField">
                      ${SALES_CAMPOS_DE_DATA.map((c) => `<option value="${c.chave}" ${(filters.dateField || 'cadastro') === c.chave ? 'selected' : ''}>${escapeHtml(c.rotulo)}</option>`).join('')}
                    </select>
                  </label>
                </aside>
              </div>

              <div class="cadastro-filter-actions">
                <button type="submit">Buscar</button>
                <button type="button" class="secondary" id="salesFilterClearBtn">Limpar filtros</button>
              </div>
            </form>
          ` : ''}

          ${draft.selecionados.length ? (() => {
            // Só os registros DESTA página entram no menu: o catálogo decide
            // elegibilidade a partir do registro, e um id selecionado numa
            // página anterior não está mais em mãos para ser avaliado.
            const selecionados = records.filter((r) => draft.selecionados.includes(r.id));
            const grupos = {};
            window.MavisSalesBulkActions.CATALOGO.forEach((acao) => {
              const { elegiveis, ignorados } = window.MavisSalesBulkActions.avaliar(acao.id, selecionados);
              (grupos[acao.grupo] = grupos[acao.grupo] || []).push({ acao, elegiveis, ignorados });
            });
            return `
            <div class="sales-lote-barra">
              <strong>${selecionados.length} selecionado${selecionados.length === 1 ? '' : 's'}</strong>
              <button type="button" class="secondary" id="salesLoteMenuBtn" aria-expanded="${Boolean(draft.showLoteMenu)}">Mais Ações ▾</button>
              <button type="button" class="secondary" id="salesLoteLimparBtn">Cancelar Seleção</button>
            </div>
            ${draft.showLoteMenu ? `
              <!-- Menu em GRADE, agrupado, como pede o briefing. Ação sem
                   backend fica à vista e desabilitada com o motivo: escondida,
                   a pessoa procura para sempre. -->
              <div class="panel sales-lote-menu" id="salesLoteMenu">
                ${Object.entries(grupos).map(([nomeGrupo, itens]) => `
                  <section>
                    <h5>${escapeHtml(nomeGrupo)}</h5>
                    <div class="sales-lote-grade">
                      ${itens.map(({ acao, elegiveis, ignorados }) => {
                        // Zero elegíveis = botão que só produziria "0
                        // processados, N ignorados". Desabilita e mostra o
                        // primeiro motivo, que é o que a pessoa precisa saber.
                        const motivo = elegiveis.length ? '' : ((ignorados[0] && ignorados[0].motivo) || 'Nenhum selecionado é elegível.');
                        return `<button type="button" class="secondary sales-lote-acao ${acao.tone ? 'is-' + acao.tone : ''}"
                          data-acao="${acao.id}" ${motivo ? 'disabled' : ''} title="${escapeHtml(motivo || (elegiveis.length + ' de ' + selecionados.length + ' elegíveis'))}">
                          ${escapeHtml(acao.label)}${elegiveis.length && elegiveis.length < selecionados.length ? ` <span class="muted">(${elegiveis.length})</span>` : ''}
                        </button>`;
                      }).join('')}
                    </div>
                  </section>`).join('')}
              </div>` : ''}`;
          })() : ''}

          <div class="panel">
            <div class="table-scroll">
              <table class="table table-actions">
                <thead><tr>
                  <!-- Seleção múltipla. O "selecionar todos" marca o que está
                       NA PÁGINA, não os 500 do filtro: marcar o que não se vê e
                       depois excluir é como se perde dado sem perceber. -->
                  <th class="sales-col-selecao">
                    <input type="checkbox" id="salesSelecionarTodos"
                      ${records.length && records.every((r) => draft.selecionados.includes(r.id)) ? 'checked' : ''}
                      title="Selecionar os desta página" />
                  </th>
                  ${colunas.map((col) => {
                  if (!col.ordenavel) return `<th>${col.rotulo}</th>`;
                  const ativa = sort === col.chave;
                  // A seta mostra a ordem ATUAL, não a que o clique vai
                  // aplicar. Cabeçalho sem indicador deixa a pessoa sem saber
                  // se ordenou ou se a lista já estava assim.
                  const seta = ativa ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
                  return `<th><button type="button" class="sales-ordenar${ativa ? ' is-ativa' : ''}" data-coluna="${col.chave}" title="Ordenar por ${col.rotulo}">${col.rotulo}${seta}</button></th>`;
                }).join('')}<th>Ações</th></tr></thead>
                <tbody>
                  ${records.length ? records.map((record) => `
                    <tr class="${draft.selecionados.includes(record.id) ? 'is-selecionada' : ''}">
                      <td class="sales-col-selecao">
                        <input type="checkbox" class="sales-selecionar" data-id="${escapeHtml(record.id)}"
                          ${draft.selecionados.includes(record.id) ? 'checked' : ''} />
                      </td>
                      ${colunas.map((col) => `<td>${col.valor(record, { data: salesFormatDate, brl: salesFormatBRL, badge: salesStatusBadge })}</td>`).join('')}
                      <td>
                        <button class="icon-button edit sales-edit-record" data-id="${escapeHtml(record.id)}" title="Editar" aria-label="Editar">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                        </button>
                        <button class="icon-button sales-delete-record" data-id="${escapeHtml(record.id)}" title="Excluir" aria-label="Excluir">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                        </button>
                      </td>
                    </tr>
                  `).join('') : `<tr><td colspan="${colunas.length + 2}" class="muted">Nenhum pedido ou orçamento encontrado${filters.search || showFilters ? ' com os filtros atuais' : ''}.</td></tr>`}
                </tbody>
              </table>
            </div>
            <div class="finance-pagination">
              <button type="button" class="secondary" id="salesPrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
              <span class="muted">Página ${page} de ${totalPages}</span>
              <button type="button" class="secondary" id="salesNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
              <label class="muted" style="display:flex;align-items:center;gap:6px;margin-left:12px;">
                Por página
                <select id="salesPorPagina">
                  ${SALES_POR_PAGINA.map((n) => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
              </label>
              ${totalPages > 1 ? `
                <form id="salesIrParaPagina" class="muted" style="display:flex;align-items:center;gap:6px;margin-left:12px;">
                  Ir para
                  <input type="number" min="1" max="${totalPages}" value="${page}" style="width:70px;" aria-label="Ir para a página" />
                  <button type="submit" class="secondary">Ir</button>
                </form>` : ''}
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
          // Pelo catálogo, e não campo a campo: era assim que um filtro novo
          // aparecia na tela, era preenchido e nunca chegava à busca.
          // `formData.has` respeita quem não está no formulário (a busca
          // rápida) e quem está desabilitado (as datas sob um atalho de
          // período — desabilitado não entra no FormData, e é o que queremos:
          // manda o atalho, não as datas que ele calculou).
          SALES_FILTROS.forEach((chave) => {
            if (chave === 'search') return;
            if (formData.has(chave)) filters[chave] = formData.get(chave) || '';
          });
          // Trocar de atalho não pode deixar para trás as datas digitadas do
          // "Personalizado" anterior: elas viajariam junto no link sem
          // aparecer em campo nenhum.
          if (filters.periodo && filters.periodo !== 'personalizado') {
            filters.dateFrom = '';
            filters.dateTo = '';
          }
          state.salesDraft.ordersPage = 1;
          loadModule('sales');
        });
        document.getElementById('salesFilterClearBtn')?.addEventListener('click', () => {
          Object.assign(filters, salesFiltrosVazios());
          state.salesDraft.ordersPage = 1;
          loadModule('sales');
        });
        // --- Seleção múltipla e ações em lote --------------------------------
        document.getElementById('salesSelecionarTodos')?.addEventListener('change', (evento) => {
          const idsDaPagina = records.map((r) => r.id);
          if (evento.target.checked) {
            // União, não substituição: quem marcou linhas na página 1 e passou
            // para a 2 não pode perder as primeiras ao marcar todas aqui.
            draft.selecionados = [...new Set([...draft.selecionados, ...idsDaPagina])];
          } else {
            draft.selecionados = draft.selecionados.filter((id) => !idsDaPagina.includes(id));
          }
          loadModule('sales');
        });
        content.querySelectorAll('.sales-selecionar').forEach((caixa) => {
          caixa.addEventListener('change', () => {
            const id = caixa.dataset.id;
            draft.selecionados = caixa.checked
              ? [...new Set([...draft.selecionados, id])]
              : draft.selecionados.filter((x) => x !== id);
            loadModule('sales');
          });
        });
        document.getElementById('salesLoteLimparBtn')?.addEventListener('click', () => {
          draft.selecionados = [];
          draft.showLoteMenu = false;
          loadModule('sales');
        });
        document.getElementById('salesLoteMenuBtn')?.addEventListener('click', () => {
          draft.showLoteMenu = !draft.showLoteMenu;
          loadModule('sales');
        });
        content.querySelectorAll('.sales-lote-acao').forEach((botao) => {
          botao.addEventListener('click', async () => {
            const acaoId = botao.dataset.acao;
            const acao = window.MavisSalesBulkActions.PORID.get(acaoId);
            const selecionados = records.filter((r) => draft.selecionados.includes(r.id));
            const { elegiveis, ignorados } = window.MavisSalesBulkActions.avaliar(acaoId, selecionados);
            if (!elegiveis.length) return;

            // Imprimir/Baixar rodam na tela: o documento é montado aqui, não no
            // servidor. Mandar ao servidor seria pedir para ele redesenhar o
            // que a tela já tem.
            if (acao.confirma) {
              const ok = await confirmModal(
                `${acao.confirma}\n\n${elegiveis.length} de ${selecionados.length} selecionado(s) serão processados.`
              );
              if (!ok) return;
            }
            try {
              const resposta = await api('/api/sales/records/lote', {
                method: 'POST',
                body: JSON.stringify({ acao: acaoId, ids: elegiveis.map((r) => r.id) })
              });
              // O resumo vem do SERVIDOR, não do que a tela previu: entre
              // desenhar a lista e clicar, outra pessoa pode ter faturado um
              // dos selecionados.
              const naoFeitos = resposta.ignorados || [];
              showToast(resposta.resumo || '', naoFeitos.length ? 'warning' : 'success');
              if (naoFeitos.length) {
                // O briefing pede o motivo de CADA ignorado, e um toast não
                // cabe cinco linhas. O detalhe vai para um modal.
                await confirmModal(
                  `${resposta.resumo}\n\n` + naoFeitos.map((i) => `#${i.code}: ${i.motivo}`).join('\n')
                );
              }
              draft.selecionados = [];
              draft.showLoteMenu = false;
              loadModule('sales');
            } catch (erro) {
              showToast(erro.message || 'Não foi possível executar a ação.', 'error');
            }
          });
        });

        document.getElementById('salesColunasBtn')?.addEventListener('click', () => {
          state.salesDraft.showOrdersColunas = !mostrandoSeletor;
          loadModule('sales');
        });
        document.querySelectorAll('[data-coluna-visivel]').forEach((caixa) => {
          caixa.addEventListener('change', () => {
            const escolhidas = [...document.querySelectorAll('[data-coluna-visivel]')]
              .filter((c) => c.checked)
              .map((c) => c.dataset.colunaVisivel);
            // Desmarcar tudo deixaria a tabela só com o código. Mantém ao menos
            // uma coluna de conteúdo e devolve a marcação, para a caixa não
            // ficar desmarcada mostrando o contrário do que vale.
            if (escolhidas.filter((c) => c !== 'code').length === 0) {
              showToast('Deixe ao menos uma coluna além do código.', 'warning');
              caixa.checked = true;
              return;
            }
            // Grava na ORDEM do catálogo, não na ordem de clique: a tabela é
            // desenhada por SALES_COLUNAS, e guardar outra ordem faria a
            // preferência parecer embaralhada ao reabrir.
            const emOrdem = SALES_COLUNAS.map((c) => c.chave).filter((c) => escolhidas.includes(c));
            salvarPreferencia('sales_lista', { colunas: emOrdem });
            loadModule('sales');
          });
        });
        document.querySelectorAll('.sales-ordenar').forEach((botao) => {
          botao.addEventListener('click', () => {
            const coluna = botao.dataset.coluna;
            // Clicar na coluna já ordenada inverte; em outra, começa
            // decrescente — que é o que se quer em data e valor, as mais
            // usadas.
            state.salesDraft.ordersDir = (sort === coluna && dir === 'desc') ? 'asc' : 'desc';
            state.salesDraft.ordersSort = coluna;
            state.salesDraft.ordersPage = 1;
            loadModule('sales');
          });
        });
        document.getElementById('salesPorPagina')?.addEventListener('change', (evento) => {
          state.salesDraft.ordersLimit = Number(evento.target.value) || 15;
          // Volta para a página 1: com 100 por página, a página 7 de antes
          // pode nem existir mais.
          state.salesDraft.ordersPage = 1;
          loadModule('sales');
        });
        document.getElementById('salesIrParaPagina')?.addEventListener('submit', (evento) => {
          evento.preventDefault();
          const alvo = Number(evento.target.querySelector('input').value);
          if (!Number.isFinite(alvo) || alvo < 1 || alvo > totalPages) {
            showToast(`Informe uma página entre 1 e ${totalPages}.`, 'warning');
            return;
          }
          state.salesDraft.ordersPage = Math.floor(alvo);
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
            state.salesDraft.novoStatus = '';
            state.activeSub = 'new_sale';
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

      // Sub-aba: Nova Venda — tela ÚNICA de pedido e orçamento.
      //
      // Eram duas rotas ('new_order' e 'new_quote') rodando este mesmo bloco, e
      // o tipo do documento vinha de qual botão você tinha clicado. Agora vem do
      // campo Status: quem está em "Orçamento" é orçamento, todo o resto é
      // pedido. Trocar o status na tela troca o tipo — inclusive de um registro
      // já salvo, que o servidor move de tabela (ver PUT /api/sales/records).
      if (sub === 'new_sale') {
        const editRecord = state.salesDraft?.editRecord || null;
        const isEditing = Boolean(editRecord);

        // Se /api/sales/meta falhar, o formulário ainda abre — mas cada lista
        // precisa existir vazia aqui, senão o .map() do select derruba a tela.
        let meta = { companies: [], sellers: [], deposits: [], directory: [], products: [], paymentMethods: [], carriers: [], productCategories: [], priceTables: [] };
        try {
          meta = { ...meta, ...(await api('/api/sales/meta')) };
        } catch (error) {
          showToast('Não foi possível carregar clientes/empresas/produtos para o formulário.', 'warning');
        }

        // "Duplicar Venda" deixa a cópia aqui. É consumida uma única vez: sem o
        // delete, voltar para a tela depois de salvar reabriria a duplicata.
        const duplicado = state.salesDraft?.duplicateFrom || null;
        if (duplicado) delete state.salesDraft.duplicateFrom;

        // Status com que um registro NOVO nasce. Hoje só as rotas antigas
        // (`new_quote`, de link ou favorito salvo) deixam uma escolha aqui —
        // pelo botão da lista o registro nasce pedido e o usuário troca no
        // campo Status. Consumido uma vez, como a duplicata.
        const statusInicial = SalesStatus.normalizar(state.salesDraft?.novoStatus || 'pedido');
        if (state.salesDraft?.novoStatus) delete state.salesDraft.novoStatus;

        const origem = editRecord || duplicado;
        // Grupos e itens saem juntos da MESMA função que o servidor usa. Ela
        // garante um grupo mínimo e que nenhum item aponte para grupo que não
        // existe — pedido gravado antes da fase AH chega sem grupo nenhum, e
        // sem isto abriria com os produtos somando no total e aparecendo em
        // lugar nenhum na tela.
        const inicial = window.MavisSalesGrupos.normalizarGrupos(
          origem ? origem.productGroups : null,
          origem ? (origem.items || []).map((item) => ({ ...item })) : []
        );
        let grupos = inicial.groups;
        let items = inicial.items;

        // Saldo e preço de cadastro NÃO são copiados para dentro do item: o
        // item guarda o que foi vendido (quantidade e preço praticados), e o
        // saldo é do produto, muda a toda hora e é sempre lido do cadastro
        // atual. Congelá-los no item faria a tela mostrar estoque de ontem.
        const produtoDoItem = (item) => meta.products.find((p) => p.id === item.productId);
        // O rótulo da busca já traz preço e saldo — escolher o produto sem ver
        // que ele está zerado é o erro que a coluna Saldo Estoque só pega
        // depois de adicionado. Renderização e attach usam o MESMO rótulo,
        // senão a lista aberta mostra um texto e o campo preenche outro.
        const rotuloProduto = (p) => {
          const reservado = Number((meta.reservas || {})[`${p.id}|`] || 0)
            + Object.entries(meta.reservas || {})
              .filter(([chave]) => chave.startsWith(`${p.id}|`) && chave !== `${p.id}|`)
              .reduce((soma, [, qtd]) => soma + Number(qtd || 0), 0);
          const livre = Number(p.stockQuantity || 0) - reservado;
          // Quando há reserva o rótulo mostra os dois números: só o disponível
          // faria parecer que o estoque acabou, e só o saldo esconderia que ele
          // já está comprometido.
          return `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${salesFormatBRL(p.salePrice)} · `
            + (reservado > 0
              ? `disponível ${salesFormatQty(livre)} de ${salesFormatQty(p.stockQuantity)}`
              : `saldo ${salesFormatQty(p.stockQuantity)}`);
        };
        // O servidor recusa faturar sem saldo (transitionOrderStockEffect) —
        // avisar aqui evita descobrir isso só na hora de aprovar. Vale só para
        // pedido: orçamento não reserva nada.
        // Cores (classes) por produto, buscadas sob demanda e guardadas aqui.
        // A lista de produtos da venda não traz classe nenhuma — carregar o
        // catálogo inteiro de cores para usar as de dois ou três produtos seria
        // um payload jogado fora, e o saldo por cor muda a cada movimentação.
        const classesPorProduto = new Map();
        async function carregarClasses(productId) {
          if (!productId || classesPorProduto.has(productId)) return classesPorProduto.get(productId) || null;
          try {
            const res = await api(`/api/stock/products/${productId}/classes`);
            const lista = res.classes || [];
            // Uma classe por item: o razão de estoque guarda um classValueId
            // por movimento. Um produto com COR e VOLTAGEM usaria a primeira, e
            // a tela avisa em vez de gravar metade da escolha.
            const registro = {
              classe: lista.find((c) => c.required) || lista[0] || null,
              ignoradas: lista.filter((c) => c !== (lista.find((x) => x.required) || lista[0])),
              saldos: res.saldos || {}
            };
            classesPorProduto.set(productId, registro);
            return registro;
          } catch (error) {
            classesPorProduto.set(productId, null);
            return null;
          }
        }
        const classeDe = (productId) => classesPorProduto.get(productId)?.classe || null;

        // Saldo que vale para ESTE item: o da cor quando há cor, o do produto
        // quando não há. Devolve null enquanto as cores não chegaram — melhor
        // não mostrar número nenhum do que mostrar o saldo geral no lugar do
        // saldo da cor, que é sempre maior e sempre tranquilizador demais.
        const saldoDoItem = (item) => {
          const produto = produtoDoItem(item);
          if (!produto) return null;
          if (!item.classValueId) return Number(produto.stockQuantity || 0);
          const registro = classesPorProduto.get(item.productId);
          if (!registro) return null;
          return Number(registro.saldos[item.classValueId] || 0);
        };

        /**
         * RESERVA — quanto deste produto/cor já foi prometido em OUTROS pedidos
         * abertos.
         *
         * O que este pedido mesmo reserva não conta contra ele: senão aumentar
         * de 3 para 4 unidades compararia o novo total com um saldo do qual as
         * 3 antigas já saíram, e o pedido bloquearia a própria edição.
         *
         * A subtração só vale se o status SALVO reservava. Um pedido já
         * faturado não está na conta de reservas — descontá-lo daria crédito
         * duas vezes pela mesma mercadoria.
         */
        const reservasMeta = meta.reservas || {};
        const itensSalvos = (editRecord && SalesStatus.reservaEstoque(editRecord.status))
          ? (editRecord.items || [])
          : [];
        const reservadoPorOutros = (item) => {
          const chave = `${item.productId}|${item.classValueId || ''}`;
          const total = Number(reservasMeta[chave] || 0);
          const meu = itensSalvos
            .filter((i) => `${i.productId}|${i.classValueId || ''}` === chave)
            .reduce((soma, i) => soma + Number(i.quantity || 0), 0);
          return Math.max(0, total - meu);
        };

        // O número que decide a venda. Pode ficar negativo, e fica de propósito:
        // promessa acima do saldo é um fato que alguém precisa ver para
        // resolver, e cortar em zero o esconderia.
        const disponivelDoItem = (item) => {
          const saldo = saldoDoItem(item);
          return saldo === null ? null : saldo - reservadoPorOutros(item);
        };

        // O alerta mede o DISPONÍVEL, não o saldo físico: era exatamente aí que
        // duas vendas prometiam as mesmas unidades sem nada reclamar.
        const itensSemSaldo = () => (recordType !== 'order' ? [] : items.filter((item) => {
          const livre = disponivelDoItem(item);
          return livre !== null && Number(item.quantity || 0) > livre;
        }));

        let discountAmount = Number(origem?.discountAmount || 0);
        let discountPercent = Number(origem?.discountPercent || 0);
        let freight = Number(origem?.freight || 0);
        let generalExpenses = Number(origem?.generalExpenses || 0);
        let assemblyFee = Number(origem?.assemblyFee || 0);
        let freightFixed = Boolean(origem?.freightFixed);
        // Padrão é cobrar o frete do comprador; só fica desligado se o registro
        // salvo disser explicitamente que não.
        let chargeFreightToBuyer = origem ? origem.chargeFreightToBuyer !== false : true;
        let generateServiceOrder = Boolean(origem?.generateServiceOrder);

        // Opções de "Origem da Venda". Lista fixa: não existe cadastro de origens
        // no sistema ainda. Quando existir, vira meta como empresas/vendedores.
        // Campos do cabeçalho (Dados) e da seção "Informações Gerais". Nenhum
        // deles entra no cálculo de totais nem mexe em estoque — são
        // classificação e acompanhamento.
        const CAMPOS_DADOS = ['saleOrigin', 'category', 'priceTable'];
        const CAMPOS_INFO = [
          'registrationTime', 'clientStatus', 'clientContact', 'customerPoCode',
          'recipientEmail', 'billingRecipientEmail', 'commercialRecipientEmail',
          'approvalDate', 'relatedOrderCode', 'revisionNumber'
        ];
        const CAMPOS_EXTRA = [...CAMPOS_DADOS, ...CAMPOS_INFO];

        // --- Abas Pagamentos / Entrega / Termos ---------------------------------
        // Estes dois viram objetos únicos no registro (paymentInfo e delivery),
        // mas na tela são campos soltos: o nome do input é a chave abaixo.
        const infoPagamento = origem?.paymentInfo || {};
        const infoEntrega = origem?.delivery || {};
        const CAMPOS_PAGAMENTO = [
          'accountPlan', 'paymentMethodId', 'entryGroup', 'printDocument',
          'nfeNumber', 'nfseNumber', 'nfeBillingDate', 'billingDetails', 'cardTransaction'
        ];
        // Campo na tela -> chave gravada. Os de endereço levam o prefixo
        // "delivery" para não colidirem com nome genérico ("number", "city").
        const MAPA_ENTREGA = {
          addressType: 'addressType', shippingMethod: 'shippingMethod', carrierId: 'carrierId',
          trackingCode: 'trackingCode', shippingDate: 'shippingDate', deliveryForecast: 'deliveryForecast',
          deliveryZip: 'zipCode', deliveryCity: 'city', deliveryState: 'state', deliveryDistrict: 'district',
          deliveryStreet: 'street', deliveryNumber: 'number', deliveryComplement: 'complement',
          deliveryCountry: 'country', deliveryCityCode: 'cityCode', deliveryStateCode: 'stateCode'
        };
        const CAMPOS_ENTREGA = Object.keys(MAPA_ENTREGA);
        const CAMPOS_FORM = [...CAMPOS_EXTRA, ...CAMPOS_PAGAMENTO, ...CAMPOS_ENTREGA, 'salesTerms'];

        const TIPOS_ENDERECO = ['Endereço Pessoa', 'Outro Endereço'];
        const MEIOS_ENVIO = ['Outro', 'Correios', 'Transportadora', 'Retirada no Balcão', 'Entrega Própria'];
        const DOCUMENTOS_IMPRESSAO = ['Nenhum', 'Boleto', 'Carnê', 'Recibo', 'Duplicata'];

        let payments = (origem?.payments || []).map((linha) => ({ ...linha }));
        let ignoreCreditLimit = Boolean(infoPagamento.ignoreCreditLimit);
        let showCteOptions = Boolean(infoEntrega.showCteOptions);
        // À vista e à prazo são exclusivos: um único valor, dois interruptores.
        let paymentTerm = infoPagamento.paymentTerm === 'aprazo' ? 'aprazo' : 'avista';
        // Aba aberta. Não é campo do registro — é só onde o usuário estava
        // quando a tela foi redesenhada (ao adicionar um produto, por exemplo).
        let abaAtiva = 'dados';
        // Apuração da aba Impostos. Vive aqui e não no `draft` porque é
        // derivada do que está na tela AGORA: guardá-la entre visitas faria a
        // aba mostrar o imposto de uma versão anterior do pedido.
        let tributos = null;
        let tributosCarregando = false;
        // Anexos: as fichas vêm com o registro e são atualizadas por cada
        // resposta das rotas de anexo. Ficam aqui, e não no formState, porque
        // não são campo de formulário — não vão no payload do salvar.
        let anexos = (origem && Array.isArray(origem.attachments)) ? origem.attachments.slice() : [];
        let anexosOcupado = false;
        // Hora de agora só para registro novo — editar não pode carimbar a hora
        // por cima da que o pedido já tinha.
        const horaAgora = new Date().toTimeString().slice(0, 5);

        // O formulário inteiro é redesenhado a cada produto adicionado/removido (mais simples
        // que atualizar só a tabela). Isso apagaria os campos de cabeçalho já preenchidos, então
        // o valor atual é salvo aqui antes de cada redesenho e usado para repopular o HTML novo.
        const formState = {
          clientSupplierId: origem?.clientSupplierId || '',
          companyId: origem?.companyId || '',
          sellerId: origem?.sellerId || '',
          depositId: origem?.depositId || '',
          // Registro antigo chega com o status legado ('pendente', 'em aberto',
          // …); normalizar aqui evita que ele apareça como opção órfã no select
          // e faz o próximo salvamento já gravar no formato novo.
          status: origem ? SalesStatus.normalizar(origem.status, origem.type) : statusInicial,
          // A duplicata nasce com a data de hoje, não a do original.
          date: editRecord?.date || new Date().toISOString().slice(0, 10),
          dueDate: editRecord?.dueDate || '',
          // Registro NOVO já nasce com o texto padrão da nota fiscal — ficha do
          // equipamento, garantia e cuidados. O vendedor confere e ajusta na
          // hora da venda, com o cliente à frente, em vez de o fiscal descobrir
          // um chassi errado na hora de emitir.
          //
          // Só no novo: um registro salvo traz o texto que ALGUÉM escreveu, e
          // sobrepor o padrão apagaria o ajuste. Duplicata idem — ela copia o
          // original, inclusive as observações.
          note: origem ? (origem.note || '') : (window.MavisNfeTextoPadrao?.PADRAO || ''),
          // Os campos de Dados e de Informações Gerais entram aqui pelo mesmo
          // motivo dos de cabeçalho: o redesenho abaixo os apagaria da tela.
          ...Object.fromEntries(CAMPOS_EXTRA.map((campo) => [campo, origem?.[campo] ?? ''])),
          ...Object.fromEntries(CAMPOS_PAGAMENTO.map((campo) => [campo, infoPagamento[campo] ?? ''])),
          ...Object.fromEntries(CAMPOS_ENTREGA.map((campo) => [campo, infoEntrega[MAPA_ENTREGA[campo]] ?? ''])),
          salesTerms: origem?.salesTerms || '',
          saleOrigin: origem?.saleOrigin || ORIGENS_VENDA[0],
          printDocument: infoPagamento.printDocument || DOCUMENTOS_IMPRESSAO[0],
          addressType: infoEntrega.addressType || TIPOS_ENDERECO[0],
          shippingMethod: infoEntrega.shippingMethod || MEIOS_ENVIO[0],
          deliveryCountry: infoEntrega.country || 'Brasil',
          // Datas não seguem na duplicata — ela é documento novo, mesma regra da
          // Data de Cadastro logo acima.
          registrationTime: editRecord?.registrationTime || horaAgora,
          approvalDate: editRecord?.approvalDate || ''
        };
        // Tipo e título são DERIVADOS do status, nunca guardados. Ficam em
        // `let` porque a tela inteira (cabeçalho, rótulos, campo Validade,
        // payload) muda quando o usuário troca Pedido <-> Orçamento no select.
        let recordType = SalesStatus.tipoDoStatus(formState.status);
        let title = recordType === 'order' ? 'Pedido' : 'Orçamento';
        const derivarTipo = () => {
          recordType = SalesStatus.tipoDoStatus(formState.status);
          title = recordType === 'order' ? 'Pedido' : 'Orçamento';
        };

        const syncFormState = () => {
          const form = document.getElementById('salesRecordForm');
          if (!form) return;
          formState.clientSupplierId = form.querySelector('[name="clientSupplierId"]')?.value || '';
          formState.companyId = form.querySelector('[name="companyId"]')?.value || '';
          formState.sellerId = form.querySelector('[name="sellerId"]')?.value || '';
          formState.depositId = form.querySelector('[name="depositId"]')?.value || '';
          formState.status = SalesStatus.normalizar(form.querySelector('[name="status"]')?.value || formState.status);
          derivarTipo();
          formState.date = form.querySelector('[name="date"]')?.value || formState.date;
          formState.dueDate = form.querySelector('[name="dueDate"]')?.value || formState.dueDate;
          formState.note = form.querySelector('[name="note"]')?.value || '';
          CAMPOS_FORM.forEach((campo) => {
            formState[campo] = form.querySelector(`[name="${campo}"]`)?.value ?? formState[campo];
          });
        };

        // Mesmo módulo que o servidor usa — a tela não pode mostrar um total e o
        // servidor gravar outro.
        const computeTotals = () => window.MavisSalesTotals.computeSalesTotals({
          items,
          discountAmount,
          discountPercent,
          freight,
          chargeFreightToBuyer,
          generalExpenses,
          assemblyFee,
          servicesAmount: 0,
          sellerCommissionPercent: Number(origem?.sellerCommissionPercent || 0),
          agentCommissionPercent: Number(origem?.agentCommissionPercent || 0)
        });

        // Apura os tributos do que está na tela AGORA — antes de salvar,
        // inclusive. Uma prévia que só funcionasse depois de salvar não
        // serviria para conferir antes de faturar, que é para o que ela existe.
        //
        // Quem calcula é o servidor, com as regras fiscais cadastradas e a
        // MESMA montagem da emissão. Repetir a conta aqui daria dois números
        // para a mesma pergunta.
        const carregarTributos = async () => {
          if (tributosCarregando) return;
          tributosCarregando = true;
          renderForm();
          try {
            syncFormState();
            const resposta = await api('/api/sales/tributos', {
              method: 'POST',
              body: JSON.stringify({
                companyId: formState.companyId,
                clientSupplierId: formState.clientSupplierId,
                date: formState.date,
                nfeId: (editRecord && editRecord.nfeId) || '',
                items: items.map((item) => ({
                  productId: item.productId,
                  name: item.name,
                  sku: item.sku,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice
                }))
              })
            });
            tributos = { ...(resposta.tributos || {}), contexto: resposta.contexto || null };
          } catch (erro) {
            // A falha vira pendência dentro da própria aba, e não um toast que
            // some: quem abriu a aba quer ver o motivo ali, junto dos números.
            tributos = {
              falhou: true,
              pendencias: [{ escopo: 'apuração', motivo: erro.message || 'Não foi possível calcular os tributos.' }],
              naoCalculados: [],
              porItem: [],
              calculado: false
            };
          } finally {
            tributosCarregando = false;
            renderForm();
          }
        };

        // Monta o payload a partir do que está na tela agora. Usado tanto pelo
        // submit quanto pelas ações do menu — o PUT exige o registro inteiro,
        // não aceita atualização só do status.
        const buildPayload = (overrides = {}) => {
          const form = document.getElementById('salesRecordForm');
          const formData = new FormData(form);
          const clientEntry = meta.directory.find((entry) => entry.id === formData.get('clientSupplierId'));
          // `overrides.status` (as ações do menu) tem precedência sobre o select.
          const status = SalesStatus.normalizar(overrides.status || formData.get('status') || formState.status);
          return {
            // O tipo acompanha o status — mandar os dois evita que o servidor
            // tenha que adivinhar, e o servidor confere de novo do lado de lá.
            type: SalesStatus.tipoDoStatus(status),
            clientSupplierId: formData.get('clientSupplierId') || '',
            clientSupplierName: clientEntry ? clientEntry.name : '',
            companyId: formData.get('companyId') || '',
            sellerId: formData.get('sellerId') || '',
            depositId: formData.get('depositId') || '',
            date: formData.get('date') || '',
            dueDate: formData.get('dueDate') || '',
            // A lista de grupos vai junto dos itens: o servidor normaliza os
            // dois de uma vez, e mandar só um dos lados deixaria item apontando
            // para grupo que não existe.
            productGroups: grupos.map((grupo, i) => ({ id: grupo.id, name: grupo.name, ordem: i })),
            items: items.map((item) => ({
              productId: item.productId,
              name: item.name,
              sku: item.sku,
              // Sem o grupo aqui, o pedido salvaria os itens certos e todos
              // voltariam para o primeiro grupo na próxima abertura.
              groupId: item.groupId || '',
              // Sem a cor aqui, o pedido salvaria a linha certa e o faturamento
              // baixaria do saldo geral — a quebra por cor nunca fecharia.
              classId: item.classId || '',
              classValueId: item.classValueId || '',
              classValueName: item.classValueName || '',
              chassi: item.chassi || '',
              quantity: item.quantity,
              unitPrice: item.unitPrice
            })),
            discountAmount,
            discountPercent,
            freight,
            freightFixed,
            chargeFreightToBuyer,
            generalExpenses,
            assemblyFee,
            ...Object.fromEntries(CAMPOS_EXTRA.map((campo) => [campo, formData.get(campo) || ''])),
            generateServiceOrder,
            // Abas Pagamentos e Entrega: os campos soltos da tela viram um objeto
            // só, no formato que o servidor grava.
            paymentInfo: {
              ...Object.fromEntries(CAMPOS_PAGAMENTO.map((campo) => [campo, formData.get(campo) || ''])),
              ignoreCreditLimit,
              paymentTerm,
              cashbackAmount: 0
            },
            payments: payments.map((linha) => ({ ...linha })),
            delivery: {
              ...Object.fromEntries(CAMPOS_ENTREGA.map((campo) => [MAPA_ENTREGA[campo], formData.get(campo) || ''])),
              showCteOptions
            },
            salesTerms: formData.get('salesTerms') || '',
            note: formData.get('note') || '',
            ...overrides,
            // Depois do spread: `status` já foi normalizado acima levando o
            // override em conta, e não pode voltar ao valor cru.
            status
          };
        };

        const salesRecordPrint = ({ direta }) => {
          // formState só é atualizado nos redesenhos. Sem isto, imprimir logo
          // depois de digitar (sem tocar em item/total) sairia com cliente, data
          // e status antigos — o que o usuário vê na tela não é o que imprime.
          syncFormState();
          const totais = computeTotals();
          const cliente = meta.directory.find((e) => e.id === formState.clientSupplierId);
          const empresa = meta.companies.find((c) => c.id === formState.companyId);
          const vendedor = meta.sellers.find((s) => s.id === formState.sellerId);
          // SEM 'noopener': por especificação ele faz window.open devolver
          // NULL, e a aba é criada assim mesmo. Aqui o efeito era pior do que
          // uma tela em branco — o aviso dizia "o navegador bloqueou", que é
          // falso, e mandava a pessoa mexer em configuração de pop-up para
          // resolver um bug nosso. Isso disparava em TODO clique, nunca só
          // quando havia bloqueio de verdade. Ver a nota em nfe_emitidas.js.
          // A isolação continua: win.opener = null, logo abaixo.
          const win = window.open('', '_blank');
          if (!win) { showToast('O navegador bloqueou a janela de impressão. Libere os pop-ups deste site e tente de novo.', 'warning'); return; }
          win.opener = null;
          win.document.write(`
            <html><head><meta charset="utf-8" /><title>${title} ${escapeHtml(String(editRecord?.code || ''))}</title><style>
              body { font-family: Arial, sans-serif; padding: 24px; color: #10213a; }
              h1 { font-size: 18px; margin: 0 0 2px; }
              .muted { color: #666; font-size: 12px; }
              .info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; margin: 14px 0; font-size: 13px; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 12px; }
              .num { text-align: right; }
              /* Linha de cabecalho de grupo: fundo leve para nao se confundir
                 com um produto. So aparece quando ha mais de um grupo. */
              tr.grp td { background: #f1f5f9; border-top: 2px solid #cbd5e1; }
              .tot { text-align: right; margin-top: 10px; font-size: 13px; }
              .tot strong { font-size: 15px; }
            </style></head><body>
              <h1>${title} ${editRecord?.code ? '#' + escapeHtml(String(editRecord.code)) : ''}</h1>
              <p class="muted">Documento interno, sem valor fiscal.</p>
              <div class="info">
                <div><strong>Cliente:</strong> ${escapeHtml(cliente?.name || '-')}</div>
                <div><strong>Data:</strong> ${escapeHtml(formState.date || '-')}</div>
                <div><strong>Empresa:</strong> ${escapeHtml(empresa?.name || '-')}</div>
                <div><strong>Vendedor:</strong> ${escapeHtml(vendedor?.name || '-')}</div>
                <div><strong>Status:</strong> ${escapeHtml(SalesStatus.rotulo(formState.status))}</div>
                <div><strong>Origem da venda:</strong> ${escapeHtml(formState.saleOrigin || '-')}</div>
                ${formState.dueDate ? `<div><strong>Validade:</strong> ${escapeHtml(formState.dueDate)}</div>` : ''}
                ${formState.customerPoCode ? `<div><strong>Ordem de compra do cliente:</strong> ${escapeHtml(formState.customerPoCode)}</div>` : ''}
              </div>
              <table>
                <thead><tr><th>Produto</th><th>SKU</th><th class="num">Qtd.</th><th class="num">Valor unit.</th><th class="num">Total</th></tr></thead>
                <!-- Com mais de um grupo, o documento mostra a divisão e o
                     total de cada um. Imprimir tudo corrido faria o
                     agrupamento existir só na tela e sumir justamente no papel
                     que vai para o cliente. Com um grupo só, o cabeçalho seria
                     ruído: a tabela sai lisa, como sempre saiu. -->
                <tbody>${grupos.map((grupo) => {
                  const doGrupo = window.MavisSalesGrupos.itensDoGrupo(items, grupo.id);
                  if (!doGrupo.length) return '';
                  const cabecalho = grupos.length > 1
                    ? `<tr class="grp"><td colspan="4"><strong>${escapeHtml(grupo.name)}</strong></td><td class="num"><strong>${salesFormatBRL(window.MavisSalesGrupos.totalDoGrupo(items, grupo.id))}</strong></td></tr>`
                    : '';
                  return cabecalho + doGrupo.map((i) => `<tr>
                    <td>${escapeHtml(i.name || '')}</td><td>${escapeHtml(i.sku || '-')}</td>
                    <td class="num">${i.quantity}</td>
                    <td class="num">${salesFormatBRL(i.unitPrice)}</td>
                    <td class="num">${salesFormatBRL(Number(i.quantity) * Number(i.unitPrice))}</td>
                  </tr>`).join('');
                }).join('')}</tbody>
              </table>
              <!-- Mesmas linhas do resumo da tela, e pela mesma fonte de cálculo:
                   antes o documento listava desconto em % e R$ separados e omitia
                   despesas gerais e taxa de montagem, então as parcelas impressas
                   não fechavam com o total. -->
              <div class="tot">
                <div>Produtos + Serviços: ${salesFormatBRL(totais.base)}</div>
                ${totais.descontoTotal ? `<div>Descontos${totais.percentualAplicado ? ` (${totais.percentualAplicado}% + ${salesFormatBRL(totais.descontoValor)})` : ''}: -${salesFormatBRL(totais.descontoTotal)}</div>` : ''}
                ${totais.freteCobrado ? `<div>Frete: ${salesFormatBRL(totais.freteCobrado)}</div>` : ''}
                ${totais.despesasGerais ? `<div>Desp. gerais: ${salesFormatBRL(totais.despesasGerais)}</div>` : ''}
                ${totais.taxaMontagem ? `<div>Taxa de montagem: ${salesFormatBRL(totais.taxaMontagem)}</div>` : ''}
                <div><strong>Total: ${salesFormatBRL(totais.totalAmount)}</strong></div>
              </div>
              ${formState.note ? `<p class="muted" style="margin-top:14px;"><strong>Observações:</strong> ${escapeHtml(formState.note)}</p>` : ''}
            </body></html>`);
          win.document.close();
          win.focus();
          // "Impressão direta" manda para a impressora sem passar pela
          // pré-visualização; o diálogo do navegador ainda aparece, não há como
          // um site imprimir sem confirmação do usuário.
          if (direta) win.print();
        };

        // Troca de aba mexe só nas classes/`hidden`: sem redesenhar, o que já
        // foi digitado nas outras abas continua no lugar (e no FormData).
        const abrirAba = (id) => {
          abaAtiva = id;
          content.querySelectorAll('.sales-tab').forEach((botao) => {
            const ativa = botao.dataset.aba === id;
            botao.classList.toggle('is-active', ativa);
            botao.setAttribute('aria-selected', String(ativa));
          });
          content.querySelectorAll('.sales-tab-panel').forEach((painel) => {
            painel.hidden = painel.dataset.aba !== id;
          });
        };

        // Contexto entregue ao menu de ações. Lê formState/status atuais, então
        // é recriado a cada render — o menu nunca decide com estado velho.
        const salesRecordActionsContext = () => ({
          recordType,
          isEditing,
          status: formState.status,
          escapeHtml,
          showToast,
          imprimir: salesRecordPrint,
          focarObservacoes: () => {
            // O campo mora na última aba: focar sem abri-la não mostraria nada.
            abrirAba('observacoes');
            const campo = document.querySelector('#salesRecordForm [name="note"]');
            campo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            campo?.focus();
          },
          duplicar: () => {
            // Cópia vira rascunho novo: sem id e sem código, para nascer como
            // registro independente em vez de sobrescrever o original.
            syncFormState();
            state.salesDraft.editRecord = null;
            state.salesDraft.duplicateFrom = {
              ...buildPayload(),
              id: undefined,
              code: undefined,
              // A cópia volta ao começo do fluxo: duplicar um pedido faturado
              // não pode nascer faturado (baixaria estoque de novo).
              status: SalesStatus.padraoDoTipo(recordType)
            };
            showToast('Venda duplicada — revise e salve o novo registro.', 'success');
            renderApp();
            loadModule('sales');
          },
          baixar: () => {
            syncFormState();
            const payload = { ...buildPayload(), code: editRecord?.code, totals: computeTotals() };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${recordType === 'order' ? 'pedido' : 'orcamento'}-${editRecord?.code || 'rascunho'}.json`;
            a.click();
            URL.revokeObjectURL(url);
          },
          mudarStatus: async (novoStatus, pergunta) => {
            const ok = await confirmModal(pergunta);
            if (!ok) return;
            try {
              const resposta = await api(`/api/sales/records/${editRecord.id}`, { method: 'PUT', body: JSON.stringify(buildPayload({ status: novoStatus })) });
              showToast(`Registro atualizado para "${SalesStatus.rotulo(novoStatus)}".`, 'success');

              // Faturou: o lançamento já nasceu junto (ver transitionOrderFinanceEffect
              // no servidor). Em vez de largar o usuário na lista, leva direto ao
              // financeiro gerado para ele ajustar forma de pagamento e vencimento —
              // que é o passo seguinte do fluxo, e o que mais se esquece de fazer.
              const gerados = resposta?.financeiro?.entryIds || [];
              // Só desvia quando o status realmente gerou financeiro. "Aprovado
              // Sem Faturamento" baixa estoque e não cria nada a receber — levar
              // o usuário ao Financeiro ali seria mandá-lo para uma tela vazia.
              if (SalesStatus.geraFinanceiro(novoStatus) && gerados.length) {
                state.salesDraft.editRecord = null;
                // De onde vim: o Financeiro usa isto para devolver ao pedido.
                state.financeReturnTo = { module: 'sales', sub: 'new_sale', recordId: editRecord.id };
                if (gerados.length === 1) {
                  state.financeEditEntryId = gerados[0];
                  state.activeSub = 'novo_lancamento';
                } else {
                  // Várias parcelas: mostra a lista filtrada pelo pedido em vez
                  // de escolher uma por conta própria.
                  state.financeFilters = { ...(state.financeFilters || {}), search: String(editRecord.code || '') };
                  state.activeSub = 'lancamentos';
                }
                state.activeModule = 'finance';
                renderApp();
                loadModule('finance');
                return;
              }

              state.salesDraft.editRecord = null;
              state.activeSub = 'orders_quotes';
              renderApp();
              loadModule('sales');
            } catch (error) {
              showToast(error.message || 'Erro ao atualizar o status.', 'error');
            }
          },

          gerarOrdemProducao: async () => {
            const ok = await confirmModal(
              'Gerar ordens de produção para este pedido?\n\n' +
              'Sai uma ordem por item que tenha ficha técnica cadastrada. Item sem ficha é revenda e não gera ordem.'
            );
            if (!ok) return;
            try {
              const res = await api('/api/pcp/orders/from-sale', {
                method: 'POST',
                body: JSON.stringify({ recordId: editRecord.id })
              });
              const quantas = (res.criadas || []).length;
              if (!quantas) {
                // Diferenciar "já existiam" de "nenhum item tem ficha" evita o
                // usuário clicar de novo achando que não funcionou.
                showToast(res.jaExistiam
                  ? 'Este pedido já tem ordem de produção — nada foi duplicado.'
                  : 'Nenhum item deste pedido tem ficha técnica cadastrada (Estrutura de Produto, no PCP).', 'warning', 7000);
                return;
              }
              showToast(`${quantas} ordem${quantas === 1 ? '' : 'ns'} de produção criada${quantas === 1 ? '' : 's'}.`, 'success');
              if ((res.ignorados || []).length) {
                showToast(`Sem ficha técnica, não geraram ordem: ${res.ignorados.join(', ')}.`, 'info', 7000);
              }
              state.activeModule = 'pcp';
              state.activeSub = 'ordens';
              renderApp();
              loadModule('pcp');
            } catch (error) {
              showToast(error.message || 'Erro ao gerar ordens de produção.', 'error');
            }
          },

          nfeId: editRecord?.nfeId || '',
          gerarNfe: async () => {
            syncFormState();
            // A pergunta do fluxo: as observações do pedido acompanham a nota?
            // Nem toda observação interna deve ir para um documento fiscal.
            const copiarObservacoes = formState.note
              ? await confirmModal(`Copiar as observações do ${title.toLowerCase()} para a NF-e?\n\n"${formState.note.slice(0, 180)}${formState.note.length > 180 ? '…' : ''}"`)
              : false;

            // A tela de emissão lê isto e nasce preenchida com o pedido.
            state.nfeFromOrder = {
              orderId: editRecord.id,
              code: editRecord.code,
              clientSupplierId: formState.clientSupplierId,
              clientName: meta.directory.find((e) => e.id === formState.clientSupplierId)?.name || '',
              items: items.map((item) => ({
                productId: item.productId || '',
                code: item.sku || '',
                description: item.name,
                quantity: Number(item.quantity || 0),
                unitPrice: Number(item.unitPrice || 0)
              })),
              taxNotes: copiarObservacoes ? formState.note : '',
              payments: payments.map((linha) => ({ ...linha })),
              totalAmount: computeTotals().totalAmount
            };
            state.activeModule = 'finance';
            state.activeSub = 'nova_nfe_avulsa';
            renderApp();
            loadModule('finance');
          }
        });

        // "06/08/2026 - 14:40" — formato da linha "Data Alteração".
        const formatarDataHora = (iso) => {
          if (!iso) return '';
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return '';
          return `${d.toLocaleDateString('pt-BR')} - ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        };

        const ABAS = [
          { id: 'dados', label: 'Dados' },
          { id: 'pagamentos', label: 'Pagamentos' },
          { id: 'entrega', label: 'Entrega' },
          { id: 'impostos', label: 'Impostos' },
          { id: 'arquivos', label: 'Arquivos Anexados' },
          { id: 'observacoes', label: 'Observações / Termos e Condições' }
        ];

        const renderForm = () => {
          // O status pode ter mudado desde o último desenho (troca no select,
          // ação do menu): tipo e título são recalculados antes de montar o HTML.
          derivarTipo();
          const totais = computeTotals();
          const somaPagamentos = payments.reduce((soma, linha) => soma + Number(linha.amount || 0), 0);

          // Aba Impostos: painel só de leitura. Os tributos são apurados na
          // emissão da NF-e (módulo Fiscal) e o pedido não guarda cálculo
          // fiscal nenhum — por isso zerados aqui, com a nota explicando.
          const faturado = SalesStatus.geraFinanceiro(formState.status);
          const zeros = (...rotulos) => rotulos.map((rotulo) => [rotulo, 0]);
          // ABA IMPOSTOS — cada linha é [rótulo, valor, chave].
          //
          // A `chave` é o caminho do campo no retorno de calcularTributos, e
          // serve para uma coisa só: saber se aquele zero significa "não há
          // esse imposto" ou "este sistema ainda não apura". A tela mostra
          // R$ 0,00 no primeiro caso e "—" no segundo. Mostrar os dois igual é
          // o defeito clássico desta tela: alguém confere o pedido, vê ISS
          // zerado e conclui que não há ISS a pagar.
          //
          // Antes daqui vinham zeros chumbados no código — todos do segundo
          // tipo, e todos com cara do primeiro.
          const t = tributos || null;
          const ler = (caminho) => {
            if (!t) return null;
            return caminho.split('.').reduce((obj, parte) => (obj == null ? null : obj[parte]), t);
          };
          const naoApurado = (chave) => {
            if (!chave) return false;
            // Apuração que FALHOU não tem número nenhum para mostrar: exibir
            // R$ 0,00 num campo que ninguém conseguiu calcular é justamente o
            // erro que esta tela existe para não cometer.
            if (t && t.falhou) return true;
            // NENHUM item apurado: não existe número para mostrar em campo
            // nenhum. O aviso vermelho explica, mas um R$ 0,00 ao lado dele
            // continua sendo lido como "não há esse imposto" — e some da
            // memória assim que a pessoa rola a tela.
            if (t && (t.porItem || []).length === 0 && (t.pendencias || []).length) return true;
            return Boolean(t && (t.naoCalculados || []).includes(chave));
          };
          const linha = (rotulo, chave) => [rotulo, ler(chave), chave];

          const GRUPOS_IMPOSTOS = [
            { titulo: 'Valores da Nota', tom: 'azul', linhas: [
              // O valor total sai do cálculo dos itens quando ele roda; sem
              // apuração, cai no total comercial da tela, que é o que a pessoa
              // está vendo no rodapé.
              // Sem chave quando cai no total da TELA: esse número é o total
              // comercial que a pessoa está vendo no rodapé, não uma
              // afirmação fiscal, e existe mesmo sem apuração.
              ['Valor Total da Nota',
                t && t.calculado ? t.valoresDaNota.valorTotal : totais.totalAmount,
                t && t.calculado ? 'valoresDaNota.valorTotal' : null],
              // Faturado é o que já virou nota AUTORIZADA. Zero aqui é "ainda
              // não faturou", e não "faturou zero".
              linha('Valor Faturado na Nota', 'valoresDaNota.valorFaturado')
            ] },
            { titulo: 'ICMS', tom: 'vermelho', linhas: [
              linha('Base Calc. ICMS Destacado', 'icms.baseCalculoDestacado'),
              linha('Valor ICMS Destacado', 'icms.valorDestacado'),
              linha('Desconto Zona Franca', 'icms.descontoZonaFranca'),
              linha('Valor do Diferencial da Alíquota', 'icms.valorDiferencialAliquota'),
              linha('Base de Cálc. Subst. Tributária', 'icms.baseSt'),
              linha('Valor Subst. Tributária', 'icms.valorSt'),
              linha('Valor ICMS Desonerado', 'icms.icmsDesonerado')
            ] },
            { titulo: 'FCP', tom: 'marrom', linhas: [
              linha('Base Calc. FCP', 'fcp.base'),
              linha('Valor FCP', 'fcp.valor'),
              linha('Base de Cálc. FCP Subst. Tributária', 'fcp.baseSt'),
              linha('Valor FCP Subst. Tributária', 'fcp.valorSt'),
              linha('Base de Cálc. FCP ST Retido Anteriormente', 'fcp.baseStRetidoAnteriormente'),
              linha('Valor FCP ST Retido Anteriormente', 'fcp.valorStRetidoAnteriormente'),
              // O FCP do estado de DESTINO é outro campo da nota (vFCPUFDest) e
              // é o único que este sistema apura. Somá-lo em "Valor FCP" faria
              // dois impostos diferentes virarem um número só.
              linha('Valor FCP do estado de destino', 'fcp.ufDestino.valor')
            ] },
            { titulo: 'PIS', tom: 'verde', linhas: [
              linha('Base Calc.', 'pis.base'),
              linha('Valor', 'pis.valor'),
              linha('Desconto Zona Franca', 'pis.descontoZonaFranca'),
              linha('Base de Cálc. Subst. Tributária', 'pis.baseSt'),
              linha('Valor Subst. Tributária', 'pis.valorSt')
            ] },
            { titulo: 'COFINS', tom: 'amarelo', linhas: [
              linha('Base Calc.', 'cofins.base'),
              linha('Valor', 'cofins.valor'),
              linha('Base de Cálc. Subst. Tributária', 'cofins.baseSt'),
              linha('Valor Subst. Tributária', 'cofins.valorSt')
            ] },
            { titulo: 'ISSQN', tom: 'ciano', linhas: [
              linha('Base', 'issqn.base'),
              linha('Valor', 'issqn.valor'),
              linha('ISS Por Subst. Tributária', 'issqn.issPorSt')
            ] },
            { titulo: 'Outros', tom: 'roxo', linhas: [
              linha('Valor IRRF', 'outros.irrf'),
              linha('Valor CSLL Retido', 'outros.csllRetido'),
              linha('Valor INSS Retido', 'outros.inssRetido'),
              linha('Base de Cálc IPI', 'outros.baseIpi'),
              linha('Valor IPI', 'outros.valorIpi')
            ] },
            { titulo: 'IBS/CBS', tom: 'azul', linhas: [
              linha('Base de Cálculo IBS/CBS', 'ibsCbs.baseCalculo'),
              linha('Valor IBS', 'ibsCbs.valorIbs'),
              linha('Valor CBS', 'ibsCbs.valorCbs')
            ] },
            // Imposto Seletivo: existe no modelo desde já, como pede a reforma,
            // mesmo sem regulamentação aplicável — por isso todas as linhas
            // aparecem como não apuradas, e não como zero.
            { titulo: 'IS (Imposto Seletivo)', tom: 'roxo', linhas: [
              linha('Base', 'is.base'),
              linha('Valor', 'is.valor')
            ] }
          ];

          // Em registro novo mostra quem está preenchendo — é quem vai constar
          // como autor assim que salvar.
          const alteradoPor = editRecord?.updatedByName || editRecord?.createdByName || state.user?.name || '';
          const dataAlteracao = formatarDataHora(editRecord?.updatedAt || editRecord?.createdAt);

          content.innerHTML = `
            <div class="cadastro-page-head">
              <div>
                <h3>${isEditing ? `Editar ${title} #${escapeHtml(String(editRecord.code))}` : `Novo ${title}`}</h3>
                <p class="muted">${isEditing ? 'Código gerado automaticamente na criação.' : 'O código é gerado automaticamente ao salvar.'}</p>
              </div>
              ${window.MavisActionsMenu.barHtml(
                { id: 'salesRecordActions', actions: window.MavisSalesRecordActions.CATALOG, saveLabel: isEditing ? 'Salvar' : `Salvar ${title.toLowerCase()}` },
                salesRecordActionsContext()
              )}
            </div>

            <div class="sales-tabs" role="tablist">
              ${ABAS.map((aba) => `
                <button type="button" class="sales-tab ${abaAtiva === aba.id ? 'is-active' : ''}" role="tab"
                        aria-selected="${abaAtiva === aba.id}" data-aba="${aba.id}">${aba.label}</button>
              `).join('')}
            </div>

            <div class="panel">
              <form id="salesRecordForm" class="form-grid">
                <!-- As abas inativas ficam ocultas, não fora do DOM: assim
                     continuam entrando no FormData na hora de salvar (campo com
                     display:none é enviado; só o desabilitado fica de fora) e
                     trocar de aba não precisa redesenhar o formulário. -->
                <div class="sales-tab-panel" data-aba="dados" ${abaAtiva === 'dados' ? '' : 'hidden'}>
                <div class="row sales-row-cliente">
                  <label>Cliente/Fornecedor *
                    ${renderSearchableSelect({ id: 'salesClientSupplier', name: 'clientSupplierId', options: meta.directory.map((entry) => ({ value: entry.id, label: entry.name })), selectedValue: formState.clientSupplierId, placeholder: 'Buscar por nome...', required: true })}
                  </label>
                  <label>Empresa
                    ${renderSearchableSelect({ id: 'salesCompany', name: 'companyId', options: meta.companies.map((c) => ({ value: c.id, label: c.name })), selectedValue: formState.companyId, placeholder: 'Buscar empresa...' })}
                  </label>
                  <label>Origem da Venda *
                    <select name="saleOrigin">
                      ${ORIGENS_VENDA.map((origemVenda) => `<option value="${escapeHtml(origemVenda)}" ${formState.saleOrigin === origemVenda ? 'selected' : ''}>${escapeHtml(origemVenda)}</option>`).join('')}
                    </select>
                  </label>
                  <label>Categoria
                    ${renderSearchableSelect({ id: 'salesCategory', name: 'category', options: (meta.productCategories || []).map((c) => ({ value: c.name, label: c.name })), selectedValue: formState.category, placeholder: 'Buscar categoria...' })}
                  </label>
                </div>

                <div class="row">
                  <label>Tabela de Preços
                    ${renderSearchableSelect({ id: 'salesPriceTable', name: 'priceTable', options: (meta.priceTables || []).map((t) => ({ value: t.name, label: t.name })), selectedValue: formState.priceTable, placeholder: 'Buscar tabela...' })}
                  </label>
                  <label>Depósito
                    ${renderSearchableSelect({ id: 'salesDeposit', name: 'depositId', options: meta.deposits.map((d) => ({ value: d.id, label: d.name })), selectedValue: formState.depositId, placeholder: 'Buscar depósito...' })}
                  </label>
                  <label>Vendedor
                    ${renderSearchableSelect({ id: 'salesSeller', name: 'sellerId', options: meta.sellers.map((s) => ({ value: s.id, label: s.name })), selectedValue: formState.sellerId, placeholder: 'Buscar vendedor...' })}
                  </label>
                  <label class="campo-somente-leitura" title="Sequencial gerado pelo sistema — não é editável.">Código
                    <input value="${isEditing ? escapeHtml(String(editRecord.code)) : 'Gerado ao salvar'}" disabled />
                  </label>
                  <!-- É este campo que decide se o documento é pedido ou
                       orçamento. Só os dois primeiros são escolhidos à mão; os
                       demais aparecem desabilitados porque quem os atribui é o
                       sistema (Aprovar, Faturar, Cancelar) ou a conciliação —
                       mas ficam à vista para o usuário saber que existem e para
                       onde o documento pode caminhar. -->
                  <label class="sales-status-field">Status
                    <select name="status" id="salesStatusSelect" class="sales-status-select">
                      ${SalesStatus.opcoesSelect(formState.status).map((opt) => `<option value="${opt.value}" ${opt.selected ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
                    </select>
                  </label>
                </div>

                <div class="cadastro-section">
                  <div class="cadastro-section-header">
                    <h4>Produtos</h4>
                    <p>Um ou mais grupos de produtos. O grupo separa o que é vendido junto mas precisa aparecer separado — obra e manutenção, por exemplo.</p>
                  </div>
                  <div class="cadastro-section-body">
                    ${grupos.map((grupo, iGrupo) => {
                      // Os itens deste grupo, com o índice que eles ocupam na
                      // lista PLANA: os handlers de quantidade, preço e chassi
                      // trabalham por índice absoluto, e passar o índice de
                      // dentro do grupo faria o segundo grupo editar as linhas
                      // do primeiro.
                      const doGrupo = items
                        .map((item, index) => ({ item, index }))
                        .filter((x) => x.item.groupId === grupo.id);
                      const totalGrupo = window.MavisSalesGrupos.totalDoGrupo(items, grupo.id);
                      return `
                      <div class="sales-grupo" data-grupo="${escapeHtml(grupo.id)}">
                        <div class="sales-grupo-head">
                          <input class="sales-grupo-nome" data-grupo="${escapeHtml(grupo.id)}"
                                 value="${escapeHtml(grupo.name)}" maxlength="60"
                                 aria-label="Nome do grupo de produtos" />
                          <span class="sales-grupo-total">${doGrupo.length} ${doGrupo.length === 1 ? 'item' : 'itens'} · <strong>${salesFormatBRL(totalGrupo)}</strong></span>
                          <button type="button" class="secondary" data-duplicar-grupo="${escapeHtml(grupo.id)}"
                                  title="Cria um grupo novo com uma cópia destes itens.">Duplicar</button>
                          <!-- Excluir o único grupo deixaria o pedido sem onde
                               pôr item nenhum. O botão fica à vista e desligado,
                               dizendo por quê. -->
                          <button type="button" class="secondary" data-excluir-grupo="${escapeHtml(grupo.id)}"
                                  ${grupos.length === 1 ? 'disabled title="O pedido precisa de ao menos um grupo."' : (doGrupo.length ? `title="Exclui o grupo e os ${doGrupo.length} itens dele."` : 'title="Exclui o grupo vazio."')}>Excluir</button>
                        </div>

                        <div class="row sales-grupo-add">
                          <label style="flex: 2;">Adiciona novos Produtos
                            ${renderSearchableSelect({ id: 'salesProduct__' + grupo.id, name: 'productPick__' + grupo.id, options: meta.products.map((p) => ({ value: p.id, label: rotuloProduto(p) })), selectedValue: '', placeholder: 'Buscar produto...' })}
                          </label>
                          <!-- A cor só aparece depois de escolher o produto, e só
                               para produto que tem cor. Um campo vazio permanente
                               na tela é ruído para quem vende parafuso. -->
                          <label id="salesClassField__${grupo.id}" hidden><span id="salesClassLabel__${grupo.id}">Cor</span>
                            <select id="salesClassValue__${grupo.id}"><option value="">Selecione</option></select>
                          </label>
                          <label>Quantidade<input id="salesProductQty__${grupo.id}" type="number" min="1" step="1" value="1" /></label>
                          <div style="align-self: end;"><button type="button" class="secondary sales-add-item" data-grupo="${escapeHtml(grupo.id)}">+ Adicionar</button></div>
                        </div>
                        <p class="muted" id="salesClassAviso__${grupo.id}" hidden></p>

                        <!-- Cada linha mostra, lado a lado, os quatro números que
                             decidem a venda: o que existe em estoque, quanto o
                             cadastro diz que o produto vale, quanto está saindo e
                             por quanto está saindo. Os dois primeiros são só
                             leitura (quem os muda é o módulo Estoque); os dois
                             últimos são os editáveis, e o Total é a conta deles. -->
                        <div class="table-scroll" style="margin-top: 12px;">
                          <table class="table table-actions sales-items-table">
                            <thead><tr>
                              <th>Produto</th>
                              <!-- "Disponível", não "Saldo": o número que decide a
                                   venda é o que sobra depois do que já foi
                                   prometido em outros pedidos. Mostrar o saldo
                                   físico aqui é o que deixava a mesma unidade ser
                                   vendida duas vezes. -->
                              <!-- Chassi ao lado do produto: ele IDENTIFICA a
                                   unidade vendida, não é um atributo comercial como
                                   preço ou quantidade. É o número que vai para a
                                   nota fiscal e para o registro do equipamento. -->
                              <th>Chassi</th>
                              <th>Disponível</th>
                              <th>Preço cadastrado</th>
                              <th>Qtd.</th>
                              <th>Valor unit.</th>
                              <th>Total</th>
                              <th>Ações</th>
                            </tr></thead>
                            <tbody>
                              ${doGrupo.length ? doGrupo.map(({ item, index }, posicao) => {
                                const produto = produtoDoItem(item);
                                // Produto excluído do cadastro depois da venda: o
                                // item continua válido no pedido, só não há mais
                                // saldo nem preço de referência para mostrar.
                                const semCadastro = !produto;
                                // Item com cor mede o saldo DA COR: dizer que há 10
                                // quando só 2 são pretos é a informação errada, e o
                                // faturamento recusaria assim mesmo.
                                const saldo = saldoDoItem(item);
                                const saldoDesconhecido = saldo === null;
                                // O que está prometido em outros pedidos e ainda
                                // não saiu do depósito.
                                const reservado = saldoDesconhecido ? 0 : reservadoPorOutros(item);
                                const livre = saldoDesconhecido ? null : saldo - reservado;
                                // Só pedido reserva estoque — em orçamento o alerta
                                // seria barulho, nada vai ser baixado.
                                const faltaSaldo = !semCadastro && !saldoDesconhecido && recordType === 'order' && Number(item.quantity || 0) > livre;
                                return `
                                <tr>
                                  <td>
                                    ${escapeHtml(item.name)}${item.sku ? ` <span class="muted">(${escapeHtml(item.sku)})</span>` : ''}
                                    ${item.classValueId ? `<span class="sales-item-cor">${escapeHtml(item.classValueName || item.classValueId)}</span>` : ''}
                                  </td>
                                  <td>
                                    <input type="text" class="sales-item-chassi" data-index="${index}"
                                           value="${escapeHtml(item.chassi || '')}" maxlength="25"
                                           placeholder="—" autocomplete="off" spellcheck="false"
                                           title="Chassi do equipamento. Vai para as observações da NF-e." />
                                    <!-- Um chassi identifica UMA unidade. Com dois
                                         ou mais na mesma linha, o número serviria
                                         para um e mentiria sobre os outros — o
                                         caminho é uma linha por equipamento. -->
                                    ${item.chassi && Number(item.quantity || 0) > 1
                                      ? '<span class="sales-item-chassi-aviso">1 chassi para ' + salesFormatQty(item.quantity) + ' unidades — separe em linhas.</span>'
                                      : ''}
                                  </td>
                                  <td class="sales-item-readonly ${faltaSaldo ? 'is-alerta' : ''}"
                                      title="${semCadastro ? 'Produto não está mais no cadastro de Estoque.' : (saldoDesconhecido ? 'Saldo desta cor ainda não carregado.' : `Em estoque: ${salesFormatQty(saldo)}. Reservado em outros pedidos: ${salesFormatQty(reservado)}. Livre para este ${title.toLowerCase()}: ${salesFormatQty(livre)}.${faltaSaldo ? ` Faltam ${salesFormatQty(Number(item.quantity || 0) - livre)} — o faturamento será recusado.` : ''}`)}">
                                    ${semCadastro || saldoDesconhecido ? '-' : salesFormatQty(livre)}
                                    ${!semCadastro && reservado > 0 ? `<span class="sales-item-reservado">de ${salesFormatQty(saldo)}</span>` : ''}
                                  </td>
                                  <td class="sales-item-readonly" title="${semCadastro ? 'Produto não está mais no cadastro de Estoque.' : 'Preço de venda cadastrado no Estoque — referência, não é o que será cobrado.'}">
                                    ${semCadastro ? '-' : salesFormatBRL(produto.salePrice)}
                                  </td>
                                  <td><input type="number" min="1" step="1" class="sales-item-qty" data-index="${index}" value="${item.quantity}" style="width: 80px;" /></td>
                                  <td><input type="number" min="0" step="0.01" class="sales-item-price" data-index="${index}" value="${item.unitPrice}" style="width: 110px;" /></td>
                                  <td class="sales-item-readonly"><strong>${salesFormatBRL(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</strong></td>
                                  <td class="sales-item-acoes">
                                    <!-- A ordem das linhas é a ordem em que o
                                         produto aparece no documento impresso e
                                         na nota; mover é decisão de quem monta o
                                         pedido, não do acaso da digitação. -->
                                    <button type="button" class="icon-button sales-mover-item" data-index="${index}" data-direcao="-1"
                                            ${posicao === 0 ? 'disabled' : ''} title="Mover para cima">▲</button>
                                    <button type="button" class="icon-button sales-mover-item" data-index="${index}" data-direcao="1"
                                            ${posicao === doGrupo.length - 1 ? 'disabled' : ''} title="Mover para baixo">▼</button>
                                    <button type="button" class="icon-button sales-remove-item" data-index="${index}" title="Remover">×</button>
                                  </td>
                                </tr>
                              `; }).join('') : '<tr><td colspan="8" class="muted">Nenhum produto neste grupo ainda.</td></tr>'}
                            </tbody>
                          </table>
                        </div>
                      </div>`;
                    }).join('')}

                    <div class="sales-grupo-acoes">
                      <button type="button" class="secondary" id="salesNovoGrupoBtn">+ Novo Grupo de Produtos</button>
                    </div>

                    ${itensSemSaldo().length ? `
                      <p class="sales-itens-alerta">
                        Estoque disponível não cobre ${itensSemSaldo().length === 1 ? '1 produto' : `${itensSemSaldo().length} produtos`}:
                        ${escapeHtml(itensSemSaldo().map((item) => item.name + (item.classValueName ? ` (${item.classValueName})` : '')).join(', '))}.
                        Dá para salvar o pedido, mas faturar será recusado enquanto não houver saldo livre — parte do estoque já está reservada em outros pedidos.
                      </p>` : ''}
                  </div>
                </div>

                <div class="sales-totals-panel">
                  <div class="sales-totals-grid">
                <label class="sales-total-field">Descontos (R$)
                  <input name="discountAmount" type="number" min="0" step="0.01" value="${discountAmount}" />
                </label>
                <label class="sales-total-field">Descontos (%)
                  <input name="discountPercent" type="number" min="0" max="100" step="0.01" value="${discountPercent}" />
                </label>
                <label class="sales-total-field">Frete (R$)
                  <input name="freight" type="number" min="0" step="0.01" value="${freight}" ${freightFixed ? 'readonly' : ''} />
                </label>
                <div class="sales-total-toggle">
                  <button type="button" role="switch" aria-checked="${freightFixed}" class="switch ${freightFixed ? 'is-on' : ''}" data-toggle="freightFixed"
                          title="Trava o valor do frete para não ser alterado sem querer."><span></span></button>
                  <span>Fixar Frete</span>
                </div>
                <div class="sales-total-toggle">
                  <button type="button" role="switch" aria-checked="${chargeFreightToBuyer}" class="switch ${chargeFreightToBuyer ? 'is-on' : ''}" data-toggle="chargeFreightToBuyer"
                          title="Desligado, o frete é custo do vendedor e não soma no total da venda."><span></span></button>
                  <span>Cobrar Frete do Comprador</span>
                </div>
                <label class="sales-total-field">Desp. Gerais (R$)
                  <input name="generalExpenses" type="number" min="0" step="0.01" value="${generalExpenses}" />
                </label>

                <label class="sales-total-field is-readonly" title="Percentual de comissão de representação ainda não configurável no cadastro.">Comissão por Representação (R$)
                  <input value="${salesFormatBRL(totais.comissaoRepresentacao)}" disabled />
                </label>
                <label class="sales-total-field is-readonly" title="Percentual de comissão do vendedor ainda não configurável no cadastro.">Comissão do Vendedor (R$)
                  <input value="${salesFormatBRL(totais.comissaoVendedor)}" disabled />
                </label>
                <label class="sales-total-field is-readonly">Valor dos Produtos (R$)
                  <input value="${salesFormatBRL(totais.valorProdutos)}" disabled />
                </label>
                <label class="sales-total-field is-readonly" title="Itens de serviço ainda não existem no cadastro de produtos.">Valor dos Serviços (R$)
                  <input value="${salesFormatBRL(totais.valorServicos)}" disabled />
                </label>
                <label class="sales-total-field">Taxa de Montagem (R$)
                  <input name="assemblyFee" type="number" min="0" step="0.01" value="${assemblyFee}" />
                </label>
                <label class="sales-total-field is-readonly" title="O cadastro de produtos ainda não tem campo de peso.">Peso Total dos Produtos (KG)
                  <input value="${totais.pesoTotal}" disabled />
                </label>
              </div>

              ${totais.descontoAparado ? `
                <p class="sales-totals-alerta">
                  O desconto pedido (${salesFormatBRL(totais.descontoPercentual + totais.descontoValor)}) passa do valor da venda
                  (${salesFormatBRL(totais.base)}). Foi aplicado ${salesFormatBRL(totais.descontoTotal)} — o total não fica negativo.
                </p>` : ''}
              ${!totais.cobrarFreteDoComprador && totais.frete > 0 ? `
                <p class="sales-totals-nota">
                  Frete de ${salesFormatBRL(totais.frete)} não está sendo cobrado do comprador — é custo do vendedor e não soma no total.
                </p>` : ''}

              <div class="sales-totals-resumo">
                <div class="sales-totals-linhas">
                  <div><span>Produtos + Serviços</span><span>${salesFormatBRL(totais.base)}</span></div>
                  ${totais.descontoTotal ? `<div class="negativo"><span>Descontos${totais.percentualAplicado ? ` (${totais.percentualAplicado}% + ${salesFormatBRL(totais.descontoValor)})` : ''}</span><span>-${salesFormatBRL(totais.descontoTotal)}</span></div>` : ''}
                  ${totais.freteCobrado ? `<div><span>Frete</span><span>${salesFormatBRL(totais.freteCobrado)}</span></div>` : ''}
                  ${totais.despesasGerais ? `<div><span>Desp. gerais</span><span>${salesFormatBRL(totais.despesasGerais)}</span></div>` : ''}
                  ${totais.taxaMontagem ? `<div><span>Taxa de montagem</span><span>${salesFormatBRL(totais.taxaMontagem)}</span></div>` : ''}
                </div>
                    <label class="sales-total-field sales-total-final">Total da Venda (R$)
                      <input value="${salesFormatBRL(totais.totalAmount)}" disabled />
                    </label>
                  </div>
                </div>

                <div class="cadastro-section">
                  <div class="cadastro-section-header">
                    <h4>Informações Gerais</h4>
                    <p>Acompanhamento do ${title.toLowerCase()}: datas, contato do cliente e e-mails de envio.</p>
                  </div>
                  <div class="cadastro-section-body">
                    <!-- Ordem dos campos = leitura em linha (data | cliente | e-mails | aprovação).
                         Data de Cadastro e Validade são os mesmos campos que ficavam soltos no
                         rodapé do formulário — foram movidos para cá, não duplicados: dois inputs
                         com o mesmo name gravariam um por cima do outro. -->
                    <div class="sales-info-grid">
                      <label class="sales-total-field">Data de Cadastro
                        <div class="sales-info-datahora">
                          <input name="date" type="date" value="${formState.date}" />
                          <input name="registrationTime" type="time" value="${escapeHtml(formState.registrationTime)}" />
                        </div>
                      </label>
                      <label class="sales-total-field">Status Cliente
                        <input name="clientStatus" value="${escapeHtml(formState.clientStatus)}" />
                      </label>
                      <label class="sales-total-field">E-mail Destinatário
                        <input name="recipientEmail" type="email" value="${escapeHtml(formState.recipientEmail)}" />
                      </label>
                      <label class="sales-total-field">Aprovação do ${title}
                        <input name="approvalDate" type="date" value="${escapeHtml(formState.approvalDate)}" />
                      </label>

                      ${recordType === 'quote' ? `
                      <label class="sales-total-field">Validade
                        <input name="dueDate" type="date" value="${formState.dueDate}" />
                      </label>`
                      // Pedido não tem validade; a célula vazia mantém as colunas
                      // alinhadas (datas | cliente | e-mails | números). O campo
                      // aparece e some quando o Status troca entre os dois tipos,
                      // porque o formulário é redesenhado a cada troca.
                      : '<div aria-hidden="true"></div>'}
                      <label class="sales-total-field">Contato do Cliente
                        <input name="clientContact" value="${escapeHtml(formState.clientContact)}" placeholder="Telefone ou responsável" />
                      </label>
                      <label class="sales-total-field">E-mail Faturamento Destinatário
                        <input name="billingRecipientEmail" type="email" value="${escapeHtml(formState.billingRecipientEmail)}" />
                      </label>
                      <label class="sales-total-field">Relacionado com Pedido
                        <input name="relatedOrderCode" type="number" min="0" step="1" value="${Number(formState.relatedOrderCode || 0)}" />
                      </label>

                      <label class="sales-total-field is-readonly">Alterado por
                        <input value="${escapeHtml(alteradoPor)}" disabled />
                      </label>
                      <label class="sales-total-field is-readonly" title="Preenchido pelo módulo de Oportunidades, que ainda não existe no sistema.">Código da Oportunidade
                        <input value="0" disabled />
                      </label>
                      <label class="sales-total-field">E-mail Comercial Destinatário
                        <input name="commercialRecipientEmail" type="email" value="${escapeHtml(formState.commercialRecipientEmail)}" />
                      </label>
                      <label class="sales-total-field">Número da Revisão
                        <input name="revisionNumber" type="number" min="0" step="1" value="${Number(formState.revisionNumber || 0)}" />
                      </label>

                      <label class="sales-total-field is-readonly">Data Alteração
                        <input value="${escapeHtml(dataAlteracao)}" disabled />
                      </label>
                      <label class="sales-total-field">Código Pedido/Ordem Compra do Cliente
                        <input name="customerPoCode" value="${escapeHtml(formState.customerPoCode)}" />
                      </label>
                      <label class="sales-total-field is-readonly" title="Preenchido pelo envio de e-mail ao cliente, que ainda não existe no sistema.">Data Recebimento E-mail
                        <input value="" disabled />
                      </label>
                    </div>

                    <div class="sales-total-toggle sales-info-toggle">
                      <button type="button" role="switch" aria-checked="${generateServiceOrder}" class="switch ${generateServiceOrder ? 'is-on' : ''}" data-toggle="generateServiceOrder"
                              title="Marca este ${title.toLowerCase()} para gerar uma Ordem de Serviço."><span></span></button>
                      <span>Gerar Ordem de Serviço</span>
                    </div>
                  </div>
                </div>

                </div><!-- /aba Dados -->

                <div class="sales-tab-panel" data-aba="pagamentos" ${abaAtiva === 'pagamentos' ? '' : 'hidden'}>
                  <div class="sales-info-grid">
                    <label class="sales-total-field">Plano de Conta - Receita
                      <input name="accountPlan" value="${escapeHtml(formState.accountPlan)}" placeholder="Ex.: Revenda de mercadorias" />
                    </label>
                    <label class="sales-total-field">Forma de Pagamento
                      <select name="paymentMethodId">
                        <option value="">Nenhuma</option>
                        ${meta.paymentMethods.map((forma) => `<option value="${escapeHtml(forma.id)}" ${formState.paymentMethodId === forma.id ? 'selected' : ''}>${escapeHtml(forma.name)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="sales-total-field">Grupo de Lançamentos
                      <input name="entryGroup" value="${escapeHtml(formState.entryGroup)}" />
                    </label>
                    <label class="sales-total-field">Documento de Impressão
                      <select name="printDocument">
                        ${DOCUMENTOS_IMPRESSAO.map((doc) => `<option value="${escapeHtml(doc)}" ${formState.printDocument === doc ? 'selected' : ''}>${escapeHtml(doc)}</option>`).join('')}
                      </select>
                    </label>

                    <label class="sales-total-field">Número NF-e
                      <input name="nfeNumber" value="${escapeHtml(formState.nfeNumber)}" />
                    </label>
                    <label class="sales-total-field">Número NFS-e
                      <input name="nfseNumber" value="${escapeHtml(formState.nfseNumber)}" />
                    </label>
                    <label class="sales-total-field">Data Faturamento NF-e
                      <input name="nfeBillingDate" type="date" value="${escapeHtml(formState.nfeBillingDate)}" />
                    </label>
                    <label class="sales-total-field">Detalhes do Faturamento
                      <input name="billingDetails" value="${escapeHtml(formState.billingDetails)}" />
                    </label>

                    <label class="sales-total-field">Transação Cartão
                      <input name="cardTransaction" value="${escapeHtml(formState.cardTransaction)}" />
                    </label>
                    <label class="sales-total-field is-readonly" title="O cashback do cliente ainda não é abatido automaticamente no pedido.">Pagamento com Cashback (R$)
                      <input value="${salesFormatBRL(0)}" disabled />
                    </label>
                  </div>

                  <div class="sales-toggle-linha">
                    <div class="sales-total-toggle">
                      <button type="button" role="switch" aria-checked="${ignoreCreditLimit}" class="switch ${ignoreCreditLimit ? 'is-on' : ''}" data-toggle="ignoreCreditLimit"
                              title="Deixa o pedido seguir mesmo que o cliente esteja acima do limite de crédito."><span></span></button>
                      <span>Ignorar Limite de Crédito</span>
                    </div>
                    <div class="sales-total-toggle">
                      <button type="button" role="switch" aria-checked="${paymentTerm === 'avista'}" class="switch ${paymentTerm === 'avista' ? 'is-on' : ''}" data-toggle="termAvista"
                              title="Pagamento à vista."><span></span></button>
                      <span>À Vista</span>
                    </div>
                    <div class="sales-total-toggle">
                      <button type="button" role="switch" aria-checked="${paymentTerm === 'aprazo'}" class="switch ${paymentTerm === 'aprazo' ? 'is-on' : ''}" data-toggle="termAprazo"
                              title="Pagamento a prazo, em uma ou mais parcelas."><span></span></button>
                      <span>À Prazo</span>
                    </div>
                  </div>

                  <div class="cadastro-section">
                    <div class="cadastro-section-header">
                      <h4>Pagamentos (Informação para NF-e/NFC-e)</h4>
                      <p>Formas e vencimentos que acompanham a nota. A soma precisa fechar com o total da venda.</p>
                    </div>
                    <div class="cadastro-section-body">
                      <div class="table-scroll">
                        <table class="table table-actions">
                          <thead><tr><th>Forma de pagamento</th><th>Vencimento</th><th>Valor</th><th>Observação</th><th>Ações</th></tr></thead>
                          <tbody>
                            ${payments.length ? payments.map((linha, index) => `
                              <tr>
                                <td>
                                  <select class="sales-payment-method" data-index="${index}">
                                    <option value="">Nenhuma</option>
                                    ${meta.paymentMethods.map((forma) => `<option value="${escapeHtml(forma.id)}" ${linha.methodId === forma.id ? 'selected' : ''}>${escapeHtml(forma.name)}</option>`).join('')}
                                  </select>
                                </td>
                                <td><input type="date" class="sales-payment-due" data-index="${index}" value="${escapeHtml(linha.dueDate || '')}" /></td>
                                <td><input type="number" min="0" step="0.01" class="sales-payment-amount" data-index="${index}" value="${Number(linha.amount || 0)}" style="width: 120px;" /></td>
                                <td><input class="sales-payment-note" data-index="${index}" value="${escapeHtml(linha.note || '')}" /></td>
                                <td><button type="button" class="icon-button sales-remove-payment" data-index="${index}" title="Remover">×</button></td>
                              </tr>
                            `).join('') : '<tr><td colspan="5" class="muted">Nenhum pagamento adicionado</td></tr>'}
                          </tbody>
                        </table>
                      </div>

                      ${payments.length && Math.abs(somaPagamentos - totais.totalAmount) >= 0.01 ? `
                        <p class="sales-totals-alerta">
                          A soma dos pagamentos (${salesFormatBRL(somaPagamentos)}) não fecha com o total da venda
                          (${salesFormatBRL(totais.totalAmount)}). Diferença de ${salesFormatBRL(Math.abs(somaPagamentos - totais.totalAmount))}.
                        </p>` : ''}

                      <div class="cadastro-list-actions" style="margin-top: 12px;">
                        <button type="button" class="secondary" id="salesAddPaymentBtn">+ Adicionar Pagamento</button>
                      </div>
                    </div>
                  </div>
                </div><!-- /aba Pagamentos -->

                <div class="sales-tab-panel" data-aba="entrega" ${abaAtiva === 'entrega' ? '' : 'hidden'}>
                  <div class="sales-info-grid">
                    <label class="sales-total-field">Tipo de Endereço
                      <select name="addressType">
                        ${TIPOS_ENDERECO.map((tipo) => `<option value="${escapeHtml(tipo)}" ${formState.addressType === tipo ? 'selected' : ''}>${escapeHtml(tipo)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="sales-total-field">Meio de Envio
                      <select name="shippingMethod">
                        ${MEIOS_ENVIO.map((meio) => `<option value="${escapeHtml(meio)}" ${formState.shippingMethod === meio ? 'selected' : ''}>${escapeHtml(meio)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="sales-total-field">Transportadora
                      <select name="carrierId">
                        <option value="">Nenhuma</option>
                        ${meta.carriers.map((t) => `<option value="${escapeHtml(t.id)}" ${formState.carrierId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="sales-total-field is-readonly" title="Vem do campo Frete, no painel de descontos e despesas da aba Dados.">Total Frete (R$)
                      <input value="${salesFormatBRL(totais.frete)}" disabled />
                    </label>

                    <label class="sales-total-field">Código Rastreio
                      <input name="trackingCode" value="${escapeHtml(formState.trackingCode)}" />
                    </label>
                    <label class="sales-total-field">Data Envio
                      <input name="shippingDate" type="date" value="${escapeHtml(formState.shippingDate)}" />
                    </label>
                    <label class="sales-total-field">Previsão de Entrega
                      <input name="deliveryForecast" type="date" value="${escapeHtml(formState.deliveryForecast)}" />
                    </label>
                    <label class="sales-total-field is-readonly" title="Preenchido pela integração com loja online, que ainda não existe no sistema.">Tipo de Entrega Loja Online
                      <input value="" disabled />
                    </label>
                  </div>

                  <div class="cadastro-section">
                    <div class="cadastro-section-header">
                      <h4>Endereço de Entrega</h4>
                      <p>Buscar pelo CEP preenche município, bairro, logradouro e o código do IBGE.</p>
                    </div>
                    <div class="cadastro-section-body">
                      <div class="sales-info-grid">
                        <!-- Div e não label: clicar num botão dentro de label
                             dispara também o foco do campo associado. -->
                        <div class="sales-total-field">
                          <span>CEP</span>
                          <div class="sales-info-datahora">
                            <input name="deliveryZip" value="${escapeHtml(formState.deliveryZip)}" placeholder="Somente números" />
                            <button type="button" class="secondary" id="salesDeliveryCepBtn">Buscar</button>
                          </div>
                        </div>
                        <label class="sales-total-field">Município
                          <input name="deliveryCity" value="${escapeHtml(formState.deliveryCity)}" />
                        </label>
                        <label class="sales-total-field">UF
                          <input name="deliveryState" value="${escapeHtml(formState.deliveryState)}" data-campo="uf" />
                        </label>
                        <label class="sales-total-field">Bairro
                          <input name="deliveryDistrict" value="${escapeHtml(formState.deliveryDistrict)}" />
                        </label>

                        <label class="sales-total-field">Logradouro
                          <input name="deliveryStreet" value="${escapeHtml(formState.deliveryStreet)}" />
                        </label>
                        <label class="sales-total-field">Número
                          <input name="deliveryNumber" value="${escapeHtml(formState.deliveryNumber)}" />
                        </label>
                        <label class="sales-total-field">Complemento
                          <input name="deliveryComplement" value="${escapeHtml(formState.deliveryComplement)}" />
                        </label>
                        <label class="sales-total-field">País
                          <input name="deliveryCountry" value="${escapeHtml(formState.deliveryCountry)}" />
                        </label>

                        <label class="sales-total-field">Cód. Munic. (IBGE)
                          <input name="deliveryCityCode" value="${escapeHtml(formState.deliveryCityCode)}" />
                        </label>
                        <label class="sales-total-field">Código UF
                          <input name="deliveryStateCode" value="${escapeHtml(formState.deliveryStateCode)}" />
                        </label>
                      </div>

                      <div class="sales-total-toggle sales-info-toggle">
                        <button type="button" role="switch" aria-checked="${showCteOptions}" class="switch ${showCteOptions ? 'is-on' : ''}" data-toggle="showCteOptions"
                                title="Marca o pedido para emissão de CT-e pela transportadora."><span></span></button>
                        <span>Exibir Opções CTe</span>
                      </div>
                    </div>
                  </div>
                </div><!-- /aba Entrega -->

                <div class="sales-tab-panel" data-aba="impostos" ${abaAtiva === 'impostos' ? '' : 'hidden'}>
                  ${tributosCarregando ? '<p class="sales-totals-nota">Apurando os tributos…</p>' : ''}

                  ${!tributosCarregando && !tributos ? `
                    <p class="sales-totals-nota">
                      Os tributos são apurados pelas regras fiscais cadastradas, com a mesma
                      montagem usada na emissão da NF-e. Abra esta aba para calcular.
                    </p>` : ''}

                  ${tributos && tributos.contexto ? `
                    <!-- Emitente e destino ficam à vista porque MUDAM a conta:
                         a UF decide interna x interestadual, e ser contribuinte
                         decide se há DIFAL. Sem isso a pessoa vê um número sem
                         saber sobre qual operação ele foi feito. -->
                    <p class="sales-totals-nota">
                      <strong>${escapeHtml(tributos.contexto.estabelecimento || '—')}</strong>
                      (${escapeHtml(tributos.contexto.ufEmitente || '?')}) →
                      ${escapeHtml(tributos.contexto.ufDestino || '?')},
                      cliente ${tributos.contexto.contribuinte ? 'contribuinte' : 'não contribuinte'}.
                      ${tributos.contexto.motivo ? `<br /><span class="muted">${escapeHtml(tributos.contexto.motivo)}</span>` : ''}
                    </p>` : ''}

                  ${tributos && tributos.pendencias && tributos.pendencias.length ? `
                    <!-- Item que não pôde ser apurado NÃO entra nas somas:
                         somar zero por ele faria o total parecer completo. Por
                         isso o aviso é vermelho e diz quantos ficaram de fora. -->
                    <div class="sales-itens-alerta">
                      <strong>Apuração incompleta — ${tributos.pendencias.length} ${tributos.pendencias.length === 1 ? 'pendência' : 'pendências'}.</strong>
                      Os totais abaixo somam só o que deu para apurar.
                      <ul>
                        ${tributos.pendencias.map((p) => `<li>${escapeHtml(p.escopo)}: ${escapeHtml(p.motivo)}</li>`).join('')}
                      </ul>
                    </div>` : ''}

                  <div class="sales-impostos-grid">
                    ${GRUPOS_IMPOSTOS.map((grupo) => `
                      <section class="sales-imposto-card">
                        <h4 class="sales-imposto-titulo sales-imposto-${grupo.tom}">${grupo.titulo}</h4>
                        <dl>
                          ${grupo.linhas.map(([rotulo, valor, chave]) => {
                            // "—" quando o sistema não apura aquele campo;
                            // R$ 0,00 quando apura e deu zero. São respostas
                            // diferentes e não podem ter a mesma aparência.
                            const vazio = naoApurado(chave);
                            return `<div><dt>${rotulo}</dt><dd ${vazio ? 'class="muted" title="Este sistema ainda não apura este campo — não é o mesmo que zero."' : ''}>${vazio ? '—' : salesFormatBRL(valor || 0)}</dd></div>`;
                          }).join('')}
                        </dl>
                      </section>
                    `).join('')}
                  </div>

                  ${tributos && tributos.porItem && tributos.porItem.length ? `
                    <!-- Por item porque o total não explica nada sozinho:
                         CFOP e situação tributária são o que se confere antes
                         de faturar. -->
                    <div class="table-scroll" style="margin-top: 14px;">
                      <table class="table">
                        <thead><tr>
                          <th>#</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>CST/CSOSN</th>
                          <th>Valor</th><th>Base ICMS</th><th>Alíq.</th><th>ICMS</th>
                          <th>PIS</th><th>COFINS</th><th>IPI</th><th>IBS</th><th>CBS</th>
                        </tr></thead>
                        <tbody>
                          ${tributos.porItem.map((i) => `<tr>
                            <td>${i.numero}</td>
                            <td>${escapeHtml(i.descricao)}</td>
                            <td>${escapeHtml(i.ncm)}</td>
                            <td>${escapeHtml(i.cfop)}</td>
                            <td>${escapeHtml(i.situacaoIcms)}</td>
                            <td>${salesFormatBRL(i.valorBruto)}</td>
                            <td>${salesFormatBRL(i.icmsBase)}</td>
                            <td>${i.icmsAliquota}%</td>
                            <td>${salesFormatBRL(i.icmsValor)}</td>
                            <td>${salesFormatBRL(i.pisValor)}</td>
                            <td>${salesFormatBRL(i.cofinsValor)}</td>
                            <td>${salesFormatBRL(i.ipiValor)}</td>
                            <td>${salesFormatBRL(i.ibsValor)}</td>
                            <td>${salesFormatBRL(i.cbsValor)}</td>
                          </tr>`).join('')}
                        </tbody>
                      </table>
                    </div>` : ''}

                  <div class="cadastro-filter-actions" style="margin-top:12px;">
                    <button type="button" class="secondary" id="salesRecalcularTributosBtn" ${tributosCarregando ? 'disabled' : ''}>Recalcular</button>
                  </div>
                </div><!-- /aba Impostos -->

                <div class="sales-tab-panel" data-aba="arquivos" ${abaAtiva === 'arquivos' ? '' : 'hidden'}>
                  ${!isEditing ? `
                    <!-- O arquivo é guardado numa pasta com o id do registro, e
                         registro novo ainda não tem id. Aceitar o arquivo antes
                         de salvar exigiria segurá-lo na memória do navegador
                         até o salvamento — e perdê-lo em silêncio se algo
                         desse errado no meio. -->
                    <p class="sales-totals-nota">
                      Salve o ${title.toLowerCase()} primeiro. Os anexos ficam guardados junto do
                      registro, e ele precisa existir para receber arquivo.
                    </p>` : `
                    <div class="sales-anexos">
                      <label class="sales-anexo-envio">
                        <input type="file" id="salesAnexoInput" multiple ${anexosOcupado ? 'disabled' : ''} />
                        <span class="muted">Vários de uma vez. Até 10 MB por arquivo.</span>
                      </label>
                      ${anexosOcupado ? '<p class="sales-totals-nota">Enviando…</p>' : ''}

                      ${anexos.length ? `
                        <div class="table-scroll" style="margin-top:12px;">
                          <table class="table table-actions">
                            <thead><tr><th>Arquivo</th><th>Tamanho</th><th>Enviado em</th><th>Por</th><th>Ações</th></tr></thead>
                            <tbody>
                              ${anexos.map((a) => `<tr>
                                <td>${escapeHtml(a.nome)}</td>
                                <td>${salesFormatTamanho(a.tamanho)}</td>
                                <td>${formatarDataHora(a.enviadoEm) || '-'}</td>
                                <td>${escapeHtml(a.enviadoPor || '-')}</td>
                                <td class="sales-item-acoes">
                                  <button type="button" class="secondary sales-anexo-baixar" data-anexo="${escapeHtml(a.id)}">Abrir</button>
                                  <button type="button" class="icon-button sales-anexo-excluir" data-anexo="${escapeHtml(a.id)}" title="Excluir">×</button>
                                </td>
                              </tr>`).join('')}
                            </tbody>
                          </table>
                        </div>` : '<p class="muted" style="margin-top:12px;">Nenhum arquivo anexado.</p>'}
                    </div>`}
                </div><!-- /aba Arquivos Anexados -->

                <div class="sales-tab-panel" data-aba="observacoes" ${abaAtiva === 'observacoes' ? '' : 'hidden'}>
                  <label class="sales-campo-longo">Observações
                    <textarea name="note" rows="6" placeholder="Observações sobre o ${title.toLowerCase()}">${escapeHtml(formState.note)}</textarea>
                  </label>
                  <label class="sales-campo-longo">Termos e Condições de Venda
                    <textarea name="salesTerms" rows="8" placeholder="Termos e condições do ${title.toLowerCase()}">${escapeHtml(formState.salesTerms)}</textarea>
                  </label>
                </div><!-- /aba Observações -->

                <!-- Salvar/Voltar vivem na barra do topo (MavisActionsMenu).
                     Este submit fica escondido só para o Enter no formulário
                     continuar salvando, como o usuário espera. -->
                <button type="submit" class="visually-hidden" tabindex="-1" aria-hidden="true">Salvar</button>
              </form>
            </div>
          `;

          window.MavisActionsMenu.attach({
            id: 'salesRecordActions',
            actions: window.MavisSalesRecordActions.CATALOG,
            onSave: () => document.getElementById('salesRecordForm')?.requestSubmit(),
            onBack: () => {
              state.salesDraft.editRecord = null;
              state.activeSub = 'orders_quotes';
              renderApp();
              loadModule('sales');
            }
          }, salesRecordActionsContext());

          attachSearchableSelect({ id: 'salesClientSupplier', options: meta.directory.map((entry) => ({ value: entry.id, label: entry.name })) });
          attachSearchableSelect({ id: 'salesCompany', options: meta.companies.map((c) => ({ value: c.id, label: c.name })) });
          attachSearchableSelect({ id: 'salesSeller', options: meta.sellers.map((s) => ({ value: s.id, label: s.name })) });
          attachSearchableSelect({ id: 'salesDeposit', options: meta.deposits.map((d) => ({ value: d.id, label: d.name })) });
          // Categoria e Tabela de Preços guardam o NOME, não um id: é o que o
          // registro da venda sempre gravou, e trocar para id exigiria migrar
          // as vendas antigas.
          attachSearchableSelect({ id: 'salesCategory', options: (meta.productCategories || []).map((c) => ({ value: c.name, label: c.name })) });
          attachSearchableSelect({ id: 'salesPriceTable', options: (meta.priceTables || []).map((t) => ({ value: t.name, label: t.name })) });
          // Preenche o campo Cor a partir do produto escolhido. O saldo entra
          // no rótulo pelo mesmo motivo do rótulo do produto: escolher a cor
          // sem ver que ela está zerada só seria descoberto no faturamento.
          // `sufixo` é o id do grupo: cada grupo tem a sua linha de adicionar
          // produto, e com ids fixos a cor escolhida no segundo grupo iria parar
          // no campo do primeiro.
          async function montarCampoCor(productId, sufixo) {
            const campo = document.getElementById('salesClassField__' + sufixo);
            const select = document.getElementById('salesClassValue__' + sufixo);
            const aviso = document.getElementById('salesClassAviso__' + sufixo);
            if (!campo || !select) return;
            const registro = productId ? await carregarClasses(productId) : null;
            const classe = registro?.classe || null;
            if (!classe) {
              campo.hidden = true;
              select.innerHTML = '<option value="">Selecione</option>';
              if (aviso) aviso.hidden = true;
              return;
            }
            campo.hidden = false;
            const rotulo = document.getElementById('salesClassLabel__' + sufixo);
            if (rotulo) rotulo.textContent = classe.name;
            const obrigatoria = classe.required !== false;
            select.innerHTML = `<option value="">${obrigatoria ? 'Selecione' : `Sem ${escapeHtml(classe.name.toLowerCase())}`}</option>`
              + classe.valores.map((valor) => {
                const saldo = Number(registro.saldos[valor.id] || 0);
                return `<option value="${escapeHtml(valor.id)}" data-nome="${escapeHtml(valor.name)}">${escapeHtml(`${valor.name} — ${salesFormatQty(saldo)} em estoque`)}</option>`;
              }).join('');
            if (aviso) {
              aviso.hidden = !registro.ignoradas.length;
              aviso.textContent = registro.ignoradas.length
                ? `Este produto também usa ${registro.ignoradas.map((c) => c.name).join(', ')}, mas o item da venda registra apenas ${classe.name}.`
                : '';
            }
          }

          grupos.forEach((grupo) => {
            attachSearchableSelect({
              id: 'salesProduct__' + grupo.id,
              options: meta.products.map((p) => ({ value: p.id, label: rotuloProduto(p), product: p })),
              onSelect: (value) => { montarCampoCor(value, grupo.id); }
            });
          });

          // Trocar Pedido <-> Orçamento muda o título, os rótulos e o campo
          // Validade — redesenha a tela inteira, como já acontece ao mexer nos
          // itens. syncFormState() antes para não perder o que foi digitado.
          document.getElementById('salesStatusSelect')?.addEventListener('change', () => {
            syncFormState();
            renderForm();
          });

          content.querySelectorAll('.sales-add-item').forEach((botao) => botao.addEventListener('click', () => {
            const grupoId = botao.dataset.grupo;
            // O id é 'salesProduct__<grupo>' + 'Value': quem monta o sufixo
            // 'Value' é o renderSearchableSelect, no fim do id inteiro. Montar
            // 'salesProductValue__<grupo>' encontrava null, e a tela dizia
            // "Selecione um produto" com o produto já selecionado na frente.
            const productId = document.getElementById('salesProduct__' + grupoId + 'Value')?.value;
            const qtyInput = document.getElementById('salesProductQty__' + grupoId);
            const product = meta.products.find((p) => p.id === productId);
            if (!productId || !product) {
              showToast('Selecione um produto.', 'warning');
              return;
            }
            const quantity = Math.max(1, Number(qtyInput?.value || 1));
            // A cor entra no item, não no produto: é isto que permite o mesmo
            // produto duas vezes na mesma venda, uma linha por cor, cada uma
            // baixando do seu próprio saldo.
            const classe = classeDe(product.id);
            const corSelect = document.getElementById('salesClassValue__' + grupoId);
            const classValueId = classe ? (corSelect?.value || '') : '';
            if (classe && classe.required !== false && !classValueId) {
              showToast(`Selecione ${classe.name.toLowerCase()} para este produto.`, 'warning');
              return;
            }
            items.push({
              productId: product.id,
              name: product.name,
              sku: product.sku || '',
              // O item nasce dentro do grupo cujo botão foi clicado. Sem isto
              // todo produto cairia no primeiro grupo, e a tela mostraria o
              // item longe de onde a pessoa acabou de clicar.
              groupId: grupoId,
              classId: classValueId ? classe.classId : '',
              classValueId,
              // O nome fica gravado no item para a lista não depender do
              // catálogo — e para o pedido antigo continuar dizendo "Preto"
              // mesmo se a cor for desativada depois.
              classValueName: classValueId
                ? (corSelect.selectedOptions[0]?.dataset.nome || '')
                : '',
              // Preenchido na linha, depois de adicionar: o chassi é de cada
              // equipamento, e digitá-lo antes de escolher o produto seria
              // preencher na ordem errada.
              chassi: '',
              quantity,
              unitPrice: Number(product.salePrice || 0)
            });
            syncFormState();
            renderForm();
          }));

          // MOVER ITEM dentro do grupo. Troca as posições na lista PLANA entre
          // o item e o vizinho DO MESMO GRUPO — trocar com o vizinho de índice
          // embaralharia a ordem dos outros grupos junto.
          const moverItem = (index, direcao) => {
            const item = items[index];
            if (!item) return;
            const irmaos = items
              .map((it, i) => ({ it, i }))
              .filter((x) => x.it.groupId === item.groupId);
            const posicao = irmaos.findIndex((x) => x.i === index);
            const alvo = posicao + direcao;
            if (alvo < 0 || alvo >= irmaos.length) return;
            const outro = irmaos[alvo].i;
            const guardado = items[index];
            items[index] = items[outro];
            items[outro] = guardado;
            syncFormState();
            renderForm();
          };
          content.querySelectorAll('.sales-mover-item').forEach((btn) => {
            btn.addEventListener('click', () => moverItem(Number(btn.dataset.index), Number(btn.dataset.direcao)));
          });

          // NOME DO GRUPO: guarda a cada tecla e só redesenha ao sair do campo.
          // Um renderForm() por tecla reconstruiria o input e tiraria o foco no
          // meio da digitação — mesmo motivo do campo de chassi.
          content.querySelectorAll('.sales-grupo-nome').forEach((input) => {
            input.addEventListener('input', () => {
              const grupo = grupos.find((g) => g.id === input.dataset.grupo);
              if (grupo) grupo.name = input.value;
            });
            input.addEventListener('change', () => {
              const grupo = grupos.find((g) => g.id === input.dataset.grupo);
              // Nome em branco deixaria o grupo sem identificação nenhuma na
              // tela e no documento impresso: volta para o padrão da posição.
              if (grupo && !String(input.value).trim()) {
                grupo.name = window.MavisSalesGrupos.nomePadrao(grupos.indexOf(grupo));
              }
              syncFormState();
              renderForm();
            });
          });

          document.getElementById('salesNovoGrupoBtn')?.addEventListener('click', () => {
            const novo = {
              id: window.MavisSalesGrupos.novoId(grupos.length),
              name: window.MavisSalesGrupos.nomePadrao(grupos.length),
              ordem: grupos.length
            };
            grupos.push(novo);
            syncFormState();
            renderForm();
          });

          content.querySelectorAll('[data-duplicar-grupo]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const origemId = btn.dataset.duplicarGrupo;
              const origemGrupo = grupos.find((g) => g.id === origemId);
              if (!origemGrupo) return;
              const novo = {
                id: window.MavisSalesGrupos.novoId(grupos.length),
                name: origemGrupo.name + ' (cópia)',
                ordem: grupos.length
              };
              grupos.push(novo);
              // Cópia dos itens, não referência: editar a quantidade na cópia
              // não pode mexer no original. O chassi NÃO é copiado — ele
              // identifica UMA unidade física, e duas linhas com o mesmo chassi
              // seriam duas vendas do mesmo equipamento.
              window.MavisSalesGrupos.itensDoGrupo(items, origemId).forEach((item) => {
                items.push({ ...item, groupId: novo.id, chassi: '' });
              });
              syncFormState();
              renderForm();
              showToast('Grupo duplicado. O chassi não é copiado — ele identifica uma unidade.', 'info');
            });
          });

          content.querySelectorAll('[data-excluir-grupo]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const grupoId = btn.dataset.excluirGrupo;
              if (grupos.length === 1) return;
              const doGrupo = window.MavisSalesGrupos.itensDoGrupo(items, grupoId);
              const grupo = grupos.find((g) => g.id === grupoId);
              // Grupo com item leva os itens junto: perguntar antes, porque o
              // desfazer aqui é digitar tudo de novo.
              if (doGrupo.length) {
                const ok = await confirmModal(
                  `Excluir "${grupo ? grupo.name : 'o grupo'}" e os ${doGrupo.length} ${doGrupo.length === 1 ? 'item' : 'itens'} dele?`
                );
                if (!ok) return;
              }
              grupos = grupos.filter((g) => g.id !== grupoId);
              items = items.filter((item) => item.groupId !== grupoId);
              syncFormState();
              renderForm();
            });
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
          // Chassi: guarda a cada tecla, redesenha só ao sair do campo. Um
          // renderForm() por tecla reconstruiria a linha e tiraria o foco do
          // campo no meio da digitação — é por isso que qtd e valor também usam
          // 'change'. O redesenho no blur é o que faz o aviso de quantidade
          // aparecer.
          content.querySelectorAll('.sales-item-chassi').forEach((input) => {
            input.addEventListener('input', () => {
              items[Number(input.dataset.index)].chassi = input.value;
            });
            input.addEventListener('change', () => {
              // Maiúsculas no blur, não a cada tecla: trocar o valor durante a
              // digitação joga o cursor para o fim a cada letra.
              const limpo = input.value.trim().toUpperCase();
              items[Number(input.dataset.index)].chassi = limpo;
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
          // Um handler para todos os campos numéricos do painel de totais. O
          // clamp acontece no módulo de cálculo; aqui só barra o negativo, que
          // o usuário digitaria sem querer.
          const camposNumericos = {
            discountAmount: (v) => { discountAmount = v; },
            discountPercent: (v) => { discountPercent = Math.min(100, v); },
            freight: (v) => { freight = v; },
            generalExpenses: (v) => { generalExpenses = v; },
            assemblyFee: (v) => { assemblyFee = v; }
          };
          Object.entries(camposNumericos).forEach(([nome, aplicar]) => {
            form.querySelector(`[name="${nome}"]`)?.addEventListener('change', (e) => {
              aplicar(Math.max(0, Number(e.target.value || 0)));
              syncFormState();
              renderForm();
            });
          });

          const chaves = {
            freightFixed: () => { freightFixed = !freightFixed; },
            chargeFreightToBuyer: () => { chargeFreightToBuyer = !chargeFreightToBuyer; },
            generateServiceOrder: () => { generateServiceOrder = !generateServiceOrder; },
            ignoreCreditLimit: () => { ignoreCreditLimit = !ignoreCreditLimit; },
            showCteOptions: () => { showCteOptions = !showCteOptions; },
            // À vista e à prazo são o mesmo dado: ligar um desliga o outro.
            termAvista: () => { paymentTerm = 'avista'; },
            termAprazo: () => { paymentTerm = 'aprazo'; }
          };
          form.querySelectorAll('[data-toggle]').forEach((btn) => {
            btn.addEventListener('click', () => {
              chaves[btn.dataset.toggle]?.();
              syncFormState();
              renderForm();
            });
          });

          content.querySelectorAll('.sales-tab').forEach((botao) => {
            botao.addEventListener('click', () => {
              abrirAba(botao.dataset.aba);
              // Só apura ao ENTRAR na aba, e não a cada redesenho: a conta é
              // uma ida ao servidor, e refazê-la a cada tecla digitada em
              // outra aba seria uma chamada por caractere. Sem item não há o
              // que apurar.
              if (botao.dataset.aba === 'impostos' && !tributos && items.length) carregarTributos();
            });
          });

          // --- Aba Arquivos Anexados -------------------------------------------
          document.getElementById('salesAnexoInput')?.addEventListener('change', async (evento) => {
            const escolhidos = [...(evento.target.files || [])];
            if (!escolhidos.length || anexosOcupado) return;
            anexosOcupado = true;
            renderForm();
            try {
              // base64 porque o servidor não tem parser de multipart e o
              // briefing pede para não introduzir dependência nova. Custa ~33%
              // a mais de tráfego, e é o preço de não escrever um parser de
              // multipart à mão só para isto.
              const lerArquivo = (arquivo) => new Promise((resolve, reject) => {
                const leitor = new FileReader();
                leitor.onload = () => resolve({ nome: arquivo.name, tipo: arquivo.type, conteudoBase64: String(leitor.result) });
                leitor.onerror = () => reject(new Error(`Não consegui ler "${arquivo.name}".`));
                leitor.readAsDataURL(arquivo);
              });
              const arquivos = await Promise.all(escolhidos.map(lerArquivo));
              const resposta = await api(`/api/sales/records/${editRecord.id}/anexos`, {
                method: 'POST',
                body: JSON.stringify({ arquivos })
              });
              anexos = resposta.attachments || anexos;
              // Um arquivo recusado no meio da seleção não derruba os outros:
              // o servidor sobe o que dá e devolve a lista do que não deu.
              if (resposta.erros && resposta.erros.length) {
                showToast(resposta.erros.join(' | '), 'warning');
              } else {
                showToast(`${resposta.enviados} arquivo(s) anexado(s).`, 'success');
              }
            } catch (erro) {
              showToast(erro.message || 'Não foi possível anexar.', 'error');
            } finally {
              anexosOcupado = false;
              renderForm();
            }
          });

          content.querySelectorAll('.sales-anexo-baixar').forEach((botao) => {
            botao.addEventListener('click', async () => {
              // A aba é aberta ANTES do fetch, ainda dentro do clique: depois
              // do await o navegador já não considera a abertura como gesto do
              // usuário e bloqueia a janela. Mesmo caminho da DANFE.
              const aba = window.open('', '_blank');
              try {
                // O bucket é privado e a rota exige sessão, então não dá para
                // apontar a aba direto para a URL: sem o cabeçalho de token
                // viria 403. Busca aqui e entrega o blob.
                const resposta = await fetch(`/api/sales/records/${editRecord.id}/anexos/${botao.dataset.anexo}`, {
                  headers: { 'x-auth-token': getSessionToken() }
                });
                if (!resposta.ok) throw new Error('Não consegui abrir o arquivo.');
                const blob = await resposta.blob();
                const url = URL.createObjectURL(blob);
                if (aba) aba.location.replace(url);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              } catch (erro) {
                if (aba) aba.close();
                showToast(erro.message || 'Não consegui abrir o arquivo.', 'error');
              }
            });
          });

          content.querySelectorAll('.sales-anexo-excluir').forEach((botao) => {
            botao.addEventListener('click', async () => {
              const ficha = anexos.find((a) => a.id === botao.dataset.anexo);
              // Excluir apaga o arquivo do Storage — não há lixeira de onde
              // tirar de volta.
              const ok = await confirmModal(`Excluir "${ficha ? ficha.nome : 'o anexo'}"? O arquivo é apagado e não dá para recuperar.`);
              if (!ok) return;
              try {
                const resposta = await api(`/api/sales/records/${editRecord.id}/anexos/${botao.dataset.anexo}`, { method: 'DELETE' });
                anexos = resposta.attachments || [];
                renderForm();
                showToast('Anexo excluído.', 'success');
              } catch (erro) {
                showToast(erro.message || 'Não foi possível excluir.', 'error');
              }
            });
          });

          document.getElementById('salesRecalcularTributosBtn')?.addEventListener('click', () => {
            // Recalcular joga fora o resultado anterior de propósito: quem
            // clica está dizendo que o pedido mudou.
            tributos = null;
            carregarTributos();
          });

          // --- Aba Pagamentos: linhas de pagamento ------------------------------
          document.getElementById('salesAddPaymentBtn')?.addEventListener('click', () => {
            syncFormState();
            const forma = meta.paymentMethods.find((f) => f.id === formState.paymentMethodId);
            const jaLancado = payments.reduce((soma, linha) => soma + Number(linha.amount || 0), 0);
            const restante = Math.max(0, Math.round((computeTotals().totalAmount - jaLancado) * 100) / 100);
            // Vencimento sugerido = data do pedido + prazo de recebimento da
            // forma escolhida (0 dias na forma "à vista" dá a própria data).
            const vencimento = new Date(`${formState.date || new Date().toISOString().slice(0, 10)}T00:00:00`);
            vencimento.setDate(vencimento.getDate() + Number(forma?.daysToReceive || 0));
            payments.push({
              methodId: forma?.id || '',
              methodName: forma?.name || '',
              dueDate: vencimento.toISOString().slice(0, 10),
              amount: restante,
              note: ''
            });
            renderForm();
          });

          content.querySelectorAll('.sales-remove-payment').forEach((btn) => {
            btn.addEventListener('click', () => {
              payments.splice(Number(btn.dataset.index), 1);
              syncFormState();
              renderForm();
            });
          });
          content.querySelectorAll('.sales-payment-method').forEach((campo) => {
            campo.addEventListener('change', () => {
              const linha = payments[Number(campo.dataset.index)];
              const forma = meta.paymentMethods.find((f) => f.id === campo.value);
              linha.methodId = campo.value;
              // O nome vai junto: se a forma for renomeada ou excluída do
              // cadastro depois, o pedido antigo ainda mostra o que foi usado.
              linha.methodName = forma?.name || '';
              syncFormState();
              renderForm();
            });
          });
          const camposLinhaPagamento = [
            ['.sales-payment-due', (linha, valor) => { linha.dueDate = valor; }],
            ['.sales-payment-amount', (linha, valor) => { linha.amount = Math.max(0, Number(valor || 0)); }],
            ['.sales-payment-note', (linha, valor) => { linha.note = valor; }]
          ];
          camposLinhaPagamento.forEach(([seletor, aplicar]) => {
            content.querySelectorAll(seletor).forEach((campo) => {
              campo.addEventListener('change', () => {
                aplicar(payments[Number(campo.dataset.index)], campo.value);
                syncFormState();
                renderForm();
              });
            });
          });

          // --- Aba Entrega: CEP preenche o endereço -----------------------------
          document.getElementById('salesDeliveryCepBtn')?.addEventListener('click', async () => {
            const cep = (form.querySelector('[name="deliveryZip"]')?.value || '').replace(/\D/g, '');
            if (cep.length !== 8) {
              showToast('Informe um CEP com 8 dígitos.', 'warning');
              return;
            }
            try {
              const resposta = await api(`/api/cep/${cep}`);
              const endereco = resposta.address || {};
              // Só sobrescreve o que veio preenchido da consulta: complemento e
              // número digitados à mão não são apagados.
              const preencher = (nome, valor) => {
                const campo = form.querySelector(`[name="${nome}"]`);
                if (campo && valor) campo.value = valor;
              };
              preencher('deliveryZip', endereco.zipCode);
              preencher('deliveryStreet', endereco.street);
              preencher('deliveryDistrict', endereco.neighborhood);
              preencher('deliveryCity', endereco.city);
              preencher('deliveryState', endereco.state);
              preencher('deliveryCityCode', endereco.ibgeCityCode);
              syncFormState();
              showToast('Endereço preenchido pelo CEP.', 'success');
            } catch (error) {
              showToast(error.message || 'Erro ao consultar o CEP.', 'error');
            }
          });

          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            // O `required` do campo de busca só garante que existe TEXTO digitado.
            // Digitar sem escolher na lista deixa o id vazio e o registro nascia
            // sem cliente ("-" na listagem) — por isso a checagem é no id.
            if (!form.querySelector('[name="clientSupplierId"]')?.value) {
              showToast('Selecione o cliente/fornecedor na lista de busca.', 'warning');
              document.getElementById('salesClientSupplierInput')?.focus();
              return;
            }
            if (!items.length) {
              showToast('Adicione ao menos um produto.', 'warning');
              return;
            }
            // Mesmo construtor usado pelas ações do menu — evita que um campo
            // novo entre num caminho e falte no outro.
            const payload = buildPayload();
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
        // Pedido aberto para edição já vem com itens coloridos, e o saldo de
        // cada cor só existe no servidor. Busca depois do primeiro render para
        // a tela não ficar em branco esperando a rede, e redesenha quando
        // chegar — até lá a coluna mostra "-", não um número errado.
        const produtosDosItens = [...new Set(items.map((item) => item.productId).filter(Boolean))];
        if (produtosDosItens.length) {
          Promise.all(produtosDosItens.map((id) => carregarClasses(id)))
            .then(() => {
              if (!document.getElementById('salesRecordForm')) return;
              syncFormState();  // o redesenho é assíncrono: o que já foi digitado não pode se perder
              renderForm();
            });
        }
        return;
      }

      // Sub-aba: NF-e Emitidas — a MESMA tela do Financeiro e do Fiscal.
      //
      // Antes daqui saía uma lista própria, alimentada por
      // /api/sales/records?view=nfes, que lê `data.nfes` — o registro MANUAL
      // antigo. Nota transmitida à SEFAZ vive na tabela `nfe` e NÃO entrava
      // nessa consulta. Medido em 17/08/2026: Vendas mostrava 1 nota e a lista
      // unificada mostrava 9 — as duas NF-e autorizadas, com DANFE e protocolo,
      // eram invisíveis aqui.
      //
      // Nada avisava. A tela parecia certa: cabeçalho, tabela, contagem. Quem
      // conferisse o faturamento por Vendas concluiria que as notas não foram
      // emitidas. O menu ainda prometia "com DANFE, XML e cancelamento", que
      // esta lista nunca teve — nem seleção, nem filtro, nem ação nenhuma.
      //
      // Agora delega, como o Fiscal já fazia (modules/fiscal/subs/nfe_espelho.js):
      // uma tela só, um lugar para corrigir. A resolução é na hora da chamada,
      // não na carga, para a falta virar mensagem em vez de tela em branco.
      if (sub === 'nfes') {
        const tela = window.MavisSubscreenRegistry?.finance?.nfe_emitidas;
        if (typeof tela !== 'function') {
          content.innerHTML = `
            <div class="panel">
              <h3>NF-e Emitidas</h3>
              <p class="muted">Esta tela é a mesma do Financeiro e não está carregada agora.</p>
              <p class="muted">Verifique se <code>modules/finance/subs/nfe_emitidas.js</code>
              continua listado no <code>index.html</code>.</p>
            </div>`;
          return;
        }
        await tela({ content, api, showToast, state, loadModule, escapeHtml, confirmModal });
        return;
      }

      // Sub-aba: Nova NF-e Avulsa — a MESMA tela da Focus do Financeiro/Fiscal.
      //
      // Aqui havia um formulário de SEIS campos digitados à mão (número,
      // cliente, data, valor, status, chave) que gravava em `data.nfes` com
      // type:'nfe'. Ele não emitia nada: nenhuma linha saía para a SEFAZ. O
      // resultado era um registro que a tela de NF-e Emitidas exibia ao lado
      // das notas de verdade, com um "número" e uma "chave" escolhidos por
      // quem digitou.
      //
      // Nota fiscal não se digita: ela é transmitida, a SEFAZ devolve número,
      // série, chave e protocolo, e é isso que vale. Manter o formulário era
      // manter um caminho para inventar documento fiscal por engano — e a
      // decisão de ficar com a tela da Focus já tinha sido tomada quando o
      // Financeiro tinha essa mesma duplicidade.
      //
      // Delega igual ao Fiscal (modules/fiscal/subs/nfe_espelho.js) e igual à
      // lista: uma tela só, um lugar para corrigir. `nova_nfe_avulsa` é apelido
      // de `emitir_nfe_focus` (registrado no fim daquele arquivo) — usar o
      // apelido casa com o rótulo do menu daqui.
      if (sub === 'new_nfe') {
        const tela = window.MavisSubscreenRegistry?.finance?.nova_nfe_avulsa;
        if (typeof tela !== 'function') {
          content.innerHTML = `
            <div class="panel">
              <h3>Nova NF-e Avulsa</h3>
              <p class="muted">Esta tela é a mesma do Financeiro e não está carregada agora.</p>
              <p class="muted">Verifique se <code>modules/finance/subs/emitir_nfe_focus.js</code>
              continua listado no <code>index.html</code>.</p>
            </div>`;
          return;
        }
        await tela({ content, api, showToast, state, loadModule, escapeHtml, confirmModal });
        return;
      }

      // Sub-aba: Logs de Vendas Importadas
      if (sub === 'import_logs') {
        const data = await api('/api/sales/records?view=import_logs');
        content.innerHTML = `
          <div class="cadastro-page-head">
            <div>
              <h3>Logs de Vendas Importadas</h3>
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
                    ${field('Telefone', 'phone', peopleDraft.phone || '', 'data-campo="telefone"')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('E-mail secundários', 'secondaryEmails', peopleDraft.secondaryEmails || '')}
                    ${field('WhatsApp', 'whatsapp', peopleDraft.whatsapp || '', 'data-campo="telefone"')}
                    ${field('Telefone celular', 'mobilePhone', peopleDraft.mobilePhone || '', 'data-campo="telefone"')}
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
                    ${field('CEP', 'zipCode', maskCep(peopleDraft.zipCode || ''), 'id="peopleZipCodeInput" data-campo="cep"', Boolean(fieldErrors.zipCode))}
                    ${field('Logradouro', 'street', peopleDraft.street || '', '', Boolean(fieldErrors.addressLine))}
                    ${field('Número', 'streetNumber', peopleDraft.streetNumber || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Complemento', 'addressComplement', peopleDraft.addressComplement || '')}
                    ${field('Bairro', 'neighborhood', peopleDraft.neighborhood || '')}
                    ${field('Cidade', 'city', peopleDraft.city || '', '', Boolean(fieldErrors.city))}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('UF', 'state', peopleDraft.state || '', 'data-campo="uf"', Boolean(fieldErrors.state))}
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
                    ${field('CEP', 'billingZipCode', maskCep(peopleDraft.billingZipCode || ''), 'id="peopleBillingZipCodeInput" data-campo="cep"')}
                    ${field('Logradouro', 'billingStreet', peopleDraft.billingStreet || '')}
                    ${field('Número', 'billingStreetNumber', peopleDraft.billingStreetNumber || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Complemento', 'billingAddressComplement', peopleDraft.billingAddressComplement || '')}
                    ${field('Bairro', 'billingNeighborhood', peopleDraft.billingNeighborhood || '')}
                    ${field('Cidade', 'billingCity', peopleDraft.billingCity || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('UF', 'billingState', peopleDraft.billingState || '', 'data-campo="uf"')}
                    ${field('Cód. Cidade (IBGE)', 'billingIbgeCityCode', peopleDraft.billingIbgeCityCode || '')}
                    ${field('País', 'billingCountry', peopleDraft.billingCountry || 'Brasil')}
                  </div>
                `, 'Endereço usado para cobrança, diferente do endereço principal do cliente.')}
              </div>

              <div class="cadastro-tab-panel" data-tab-panel="delivery" hidden>
                ${section('Endereço de entrega', `
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('CEP', 'deliveryZipCode', maskCep(peopleDraft.deliveryZipCode || ''), 'id="peopleDeliveryZipCodeInput" data-campo="cep"')}
                    ${field('Logradouro', 'deliveryStreet', peopleDraft.deliveryStreet || '')}
                    ${field('Número', 'deliveryStreetNumber', peopleDraft.deliveryStreetNumber || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('Complemento', 'deliveryAddressComplement', peopleDraft.deliveryAddressComplement || '')}
                    ${field('Bairro', 'deliveryNeighborhood', peopleDraft.deliveryNeighborhood || '')}
                    ${field('Cidade', 'deliveryCity', peopleDraft.deliveryCity || '')}
                  </div>
                  <div class="cadastro-grid cadastro-grid-3">
                    ${field('UF', 'deliveryState', peopleDraft.deliveryState || '', 'data-campo="uf"')}
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
                  ${field('Telefone', 'phone', cnpjDraft.phone || '', 'data-campo="telefone"')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('E-mail secundários', 'secondaryEmails', cnpjDraft.secondaryEmails || '')}
                  ${field('WhatsApp', 'whatsapp', cnpjDraft.whatsapp || '', 'data-campo="telefone"')}
                  ${field('Telefone celular', 'mobilePhone', cnpjDraft.mobilePhone || '', 'data-campo="telefone"')}
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
                  ${field('CEP', 'zipCode', maskCep(cnpjDraft.zipCode || ''), 'id="cnpjZipCodeInput" data-campo="cep"', Boolean(fieldErrors.zipCode))}
                  ${field('Logradouro', 'address', cnpjDraft.address || '', '', Boolean(fieldErrors.addressLine))}
                  ${field('Número', 'addressNumber', cnpjDraft.addressNumber || '')}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('Complemento', 'addressComplement', cnpjDraft.addressComplement || '')}
                  ${field('Bairro', 'neighborhood', cnpjDraft.neighborhood || '')}
                  ${field('Cidade', 'city', cnpjDraft.city || '', '', Boolean(fieldErrors.city))}
                </div>
                <div class="cadastro-grid cadastro-grid-3">
                  ${field('UF', 'state', cnpjDraft.state || '', 'data-campo="uf"', Boolean(fieldErrors.state))}
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
                ${field('UF', 'state', depositDraft.state || '', 'data-campo="uf"')}
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
            cadastroTipo: person.type === 'pessoa-juridica' ? 'Pessoa jurídica' : 'Pessoa física',
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
                  <input name="query" value="${escapeHtml(listFilters.query)}" placeholder="Nome, documento, e-mail ou telefone" />
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

      // Delega para o módulo compartilhado: a máscara é a mesma de todas as
      // outras telas, e o campo ganha de brinde a validação no blur.
      const bindDocumentMask = (input, typeGetter) => {
        window.MavisDocumento.ligar(input, { tipoGetter: typeGetter });
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
            showToast('A API retornou CNPJ válido, mas sem e-mail e/ou telefone para este cadastro.', 'warning');
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
            showToast('A API retornou CNPJ válido, mas sem e-mail e/ou telefone para este cadastro.', 'warning');
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
    // ABA: COMPRAS (sub-abas: Nova Compra, Histórico de Compras, Fornecedores)
    // ========================================================================
    if (moduleName === 'purchases') {
      const data = await api('/api/purchases');
      const sub = state.activeSub || 'new_purchase';

      const renderPage = () => {
        // Sub-aba: Histórico de Compras
        if (sub === 'purchase_history') {
          return `
            <div class="panel">
              <h3>Histórico de Compras</h3>
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
    // Recarregar a página recria o timer da virada: ele vive na memória da
    // aba, então some a cada F5.
    agendarSaidaDaVirada(response.sessaoExpiraEm);
    adotarUsuarioDaSessao(response.user);
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
