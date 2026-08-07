// Regras de controle de acesso — SEM banco e SEM rede, de propósito.
//
// Quem pode o quê é a decisão mais sensível do sistema: errar para o lado
// permissivo entrega dados a quem não devia, errar para o restritivo tranca o
// usuário para fora do próprio ERP. Por isso a decisão mora aqui, em funções
// puras que o teste (scripts/test-permissoes.js) cobre caso a caso, e o acesso
// ao banco fica em lib/db/rbac.js.
//
// O schema de referência resolvia isso numa função SQL (usuario_pode()). Aqui a
// verificação é em Node pelo mesmo motivo de sempre: o app fala com o Supabase
// por HTTP (PostgREST), então chamar uma função SQL a cada ação custaria uma
// viagem de rede por requisição. As permissões efetivas do usuário são lidas
// uma vez e avaliadas em memória — a regra é idêntica.

// Ação HTTP -> verbo da permissão. GET só lê; POST cria; PUT/PATCH editam;
// DELETE exclui. É o que torna possível "pode criar pedido mas não excluir".
const ACOES_POR_METODO = {
  GET: 'ler',
  HEAD: 'ler',
  POST: 'criar',
  PUT: 'editar',
  PATCH: 'editar',
  DELETE: 'excluir'
};

// Rota -> recurso. A ordem importa: o primeiro prefixo que casar vence, então
// os caminhos mais específicos vêm antes dos mais genéricos.
const ROTAS = [
  { prefixo: '/api/users', recurso: 'usuarios', acaoFixa: 'gerenciar' },
  { prefixo: '/api/access-control', recurso: 'usuarios', acaoFixa: 'gerenciar' },
  { prefixo: '/api/access-logs', recurso: 'auditoria', acaoFixa: 'ler' },
  { prefixo: '/api/sales', recurso: 'sales' },
  { prefixo: '/api/cadastros', recurso: 'cadastros' },
  { prefixo: '/api/purchases', recurso: 'purchases' },
  { prefixo: '/api/stock', recurso: 'stock' },
  { prefixo: '/api/finance', recurso: 'finance' },
  { prefixo: '/api/openfinance', recurso: 'finance' },
  { prefixo: '/api/settings', recurso: 'settings' }
];

// Rotas que NÃO passam pela verificação: ou são públicas (login), ou são do
// próprio usuário sobre ele mesmo (tema, atalhos), ou já têm um portão
// granular próprio logo adiante (/api/fiscal, que checa fiscal.<ação>).
const ROTAS_LIVRES = [
  '/api/login', '/api/logout', '/api/me', '/api/cep/', '/api/fiscal/',
  '/api/focusnfe/', '/api/webhooks/'
];

function rotaLivre(pathname) {
  return ROTAS_LIVRES.some((livre) => pathname === livre.replace(/\/$/, '') || pathname.startsWith(livre));
}

/**
 * Descobre qual permissão a requisição exige. Devolve null quando a rota não
 * está mapeada — e aí a requisição segue para a checagem que a própria rota já
 * fazia. Rota nova nasce sem controle novo em vez de nascer bloqueada: o
 * contrário derrubaria uma tela em produção a cada endpoint acrescentado.
 */
function resolverPermissao(pathname, metodo) {
  if (!pathname.startsWith('/api/') || rotaLivre(pathname)) return null;
  const rota = ROTAS.find((entrada) => pathname === entrada.prefixo || pathname.startsWith(`${entrada.prefixo}/`) || pathname.startsWith(`${entrada.prefixo}?`));
  if (!rota) return null;
  const acao = rota.acaoFixa || ACOES_POR_METODO[String(metodo || '').toUpperCase()];
  return acao ? `${rota.recurso}.${acao}` : null;
}

/**
 * A decisão. `efetivas` é o conjunto (Set) de permissões vindas dos papéis e
 * das concessões diretas; `negadas`, o das negações explícitas.
 *
 * Ordem das regras — a mesma do schema, e a ordem importa:
 *   1. usuário inexistente ou bloqueado não faz nada;
 *   2. NEGAR explícito vence QUALQUER coisa, inclusive papel de admin. Sem
 *      isso não existe como suspender uma ação de alguém sem tirar o papel;
 *   3. admin passa direto (não precisa listar permissão nenhuma);
 *   4. resto: tem que estar nas efetivas.
 */
function usuarioPode(usuario, permissao, { efetivas, negadas } = {}) {
  if (!usuario || usuario.active === false) return false;
  if (!permissao) return true;

  if (negadas && negadas.has(permissao)) return false;

  if (ehAdministrador(usuario)) return true;

  return Boolean(efetivas && efetivas.has(permissao));
}

// Admin pelo papel novo (user_roles) ou pelo campo antigo `role` — enquanto os
// dois existirem, quem era admin continua admin.
function ehAdministrador(usuario) {
  if (!usuario) return false;
  if (usuario.role === 'admin') return true;
  return Array.isArray(usuario.roles) && usuario.roles.includes('admin');
}

/**
 * Enquanto a migração da Fase L não roda, não existe papel nem permissão no
 * banco. Neste caso a decisão volta a ser a antiga — acesso por módulo inteiro
 * (allowed_modules) — para o sistema seguir funcionando exatamente como antes.
 * É o mesmo princípio das outras fases: código novo com banco velho degrada,
 * não quebra.
 */
function podePeloModulo(usuario, permissao) {
  if (!usuario || usuario.active === false) return false;
  if (!permissao) return true;
  if (ehAdministrador(usuario)) return true;
  const recurso = String(permissao).split('.')[0];
  const modulos = Array.isArray(usuario.allowedModules) ? usuario.allowedModules : [];
  // 'usuarios' e 'auditoria' não são módulos do menu: no modelo antigo só o
  // admin mexia em usuário, e é assim que continua até a migração rodar.
  if (recurso === 'usuarios' || recurso === 'auditoria') return false;
  return modulos.includes(recurso);
}

module.exports = {
  ACOES_POR_METODO,
  ROTAS,
  resolverPermissao,
  usuarioPode,
  ehAdministrador,
  podePeloModulo,
  rotaLivre
};
