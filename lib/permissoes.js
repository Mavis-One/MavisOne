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
  // ATENÇÃO ao hífen: a rota real é /api/open-finance/. Este prefixo já esteve
  // escrito '/api/openfinance' e por isso não casava com rota nenhuma — a
  // regra existia no papel e o Open Finance passava direto pelo portão
  // central, sem checagem de ação (ler/criar/excluir), sem respeitar NEGAR e
  // sem entrar na trilha de auditoria. Uma regra que não casa é pior do que
  // regra nenhuma: ela faz o leitor acreditar que a rota está protegida.
  // scripts/test-permissoes.js confere que todo prefixo daqui casa com uma
  // rota que existe de verdade no server.js.
  { prefixo: '/api/open-finance', recurso: 'finance' },
  // POST aqui EDITA, não cria. A tela Empresa salva por POST /api/settings, e o
  // handler faz updateSettings({...getSettings(), ...payload}) — atualização
  // pura, nunca insere. Pelo mapa geral (POST -> criar), quem recebia
  // settings.editar levava 403 ao salvar: a permissão de editar não permitia
  // editar nada. A criação de usuário passa por este mesmo POST, mas tem porta
  // própria logo adiante (ehAdmin), então rebaixar a exigência aqui não abre
  // caminho para não-admin criar conta.
  { prefixo: '/api/settings', recurso: 'settings', acoesPorMetodo: { POST: 'editar' } },
  // Fase CF — chave mestra das integrações. Recurso 'settings' porque é
  // configuração do sistema: ler pede settings.ler, gravar pede settings.editar.
  // A rota ainda exige ADMIN para gravar, por cima disto: o portão diz que é
  // uma edição de configuração, e a rota diz que esta configuração em
  // particular vale pela conta Focus inteira.
  { prefixo: '/api/integracoes', recurso: 'settings' },
  // Módulos novos. Relatórios tem rota própria justamente para não depender do
  // acesso a Vendas/Estoque (ver /api/reports/overview no server.js).
  { prefixo: '/api/reports', recurso: 'reports' },
  { prefixo: '/api/fleet', recurso: 'fleet' },
  { prefixo: '/api/crm', recurso: 'crm' },
  { prefixo: '/api/hr', recurso: 'hr' },
  { prefixo: '/api/pcp', recurso: 'pcp' },
  { prefixo: '/api/contracts', recurso: 'contracts' }
];

// Rotas que NÃO passam pela verificação: ou são públicas (login), ou são do
// próprio usuário sobre ele mesmo (tema, atalhos), ou já têm um portão
// granular próprio logo adiante (/api/fiscal, que checa fiscal.<ação>).
// AS DUAS LISTAS QUE ANTES ERAM UMA SO'
// ------------------------------------
// Havia uma lista chamada ROTAS_LIVRES, e "livre" queria dizer duas coisas
// diferentes ao mesmo tempo: "nao precisa de sessao" e "o portao nao decide,
// quem decide e' a propria rota". Misturar as duas custou caro dos dois lados:
//
//   /api/fiscal/  estava na lista por ser do segundo tipo (o Fiscal tem tabela
//                 de permissao propria) e acabava tratado como publico.
//   /api/open-finance/webhooks/  nao estava, entao o portao exigia sessao de um
//                 PROVEDOR EXTERNO — o webhook respondia 401 antes de chegar a
//                 conferencia do segredo compartilhado. Medido: o webhook fiscal
//                 respondia 200 e o do Open Finance, 401, com o segredo certo
//                 nos dois. Estava inalcancavel desde que foi escrito.
//
// Agora sao duas listas com nomes que dizem o que elas sao.

// NAO EXIGE SESSAO. Quem entra aqui precisa ter OUTRA prova de identidade: o
// login tem a senha, os webhooks tem o segredo compartilhado no cabecalho (e os
// dois falham fechados quando a variavel de ambiente esta vazia).
const ROTAS_PUBLICAS = [
  '/api/login',
  '/api/fiscal/webhooks/',
  '/api/open-finance/webhooks/'
];

// EXIGE SESSAO, mas o portao central nao sabe qual permissao cobrar — quem
// decide e' a propria rota. `/api/me` e' o proprio usuario; o Fiscal tem
// `permissaoFiscalDaRota`, com granularidade que este mapa nao expressa.
const PORTAO_NA_PROPRIA_ROTA = [
  '/api/logout', '/api/me', '/api/cep/', '/api/fiscal/', '/api/focusnfe/'
];

const casa = (lista, pathname) => lista.some(
  (entrada) => pathname === entrada.replace(/\/$/, '') || pathname.startsWith(entrada)
);

const rotaPublica = (pathname) => casa(ROTAS_PUBLICAS, pathname);

/**
 * A rota exige uma sessao valida?
 *
 * TUDO sob /api/ exige, MENOS o que esta declarado como publico. E' o contrario
 * do que valia antes: rota sem permissao mapeada era liberada, e a unica coisa
 * que a segurava era cada rota lembrar de conferir sozinha. Todas lembravam
 * (as 112 foram sondadas sem token e nenhuma respondeu), mas a proxima nasceria
 * aberta — que e' exatamente o furo que o portao existe para nao ter.
 */
function exigeSessao(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  return !rotaPublica(pathname);
}

// Mantido: e' o que diz "o portao central nao resolve permissao para esta
// rota". Deixou de significar "entra sem sessao" — para isso ha' rotaPublica.
function rotaLivre(pathname) {
  return rotaPublica(pathname) || casa(PORTAO_NA_PROPRIA_ROTA, pathname);
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
  const metodoNormalizado = String(metodo || '').toUpperCase();
  // Precedência: ação fixa da rota (vale para qualquer método) > exceção por
  // método > mapa geral. A do meio existe para a rota cujo POST não cria nada;
  // sem ela, a alternativa seria acaoFixa, que também prenderia o GET em
  // 'editar' e tiraria a leitura de quem só tem permissão de ler.
  const acao = rota.acaoFixa
    || (rota.acoesPorMetodo && rota.acoesPorMetodo[metodoNormalizado])
    || ACOES_POR_METODO[metodoNormalizado];
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
  rotaLivre,
  rotaPublica,
  exigeSessao,
  ROTAS_PUBLICAS
};
