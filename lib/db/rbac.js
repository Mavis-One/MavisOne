const { banco, assertNoError } = require('./client');

// Acesso ao banco do controle de acesso (papéis, permissões e auditoria).
// A REGRA de decisão não está aqui — está em lib/permissoes.js, pura e testada.
// Aqui é só leitura/escrita, cache e a degradação quando a migração da Fase L
// ainda não foi aplicada.

// Toda requisição autenticada precisa saber o que o usuário pode. Sem cache
// seriam duas consultas a mais por requisição; com TTL curto, uma alteração de
// permissão feita fora do sistema demora no máximo isto para valer.
// Alteração feita PELO sistema invalida na hora (ver invalidarCache).
const TTL_CACHE_MS = 60 * 1000;
const cache = new Map();

// Quando as tabelas não existem, para de tentar por um tempo em vez de bater no
// banco a cada requisição — mas volta a testar depois. Marcar "indisponível"
// para sempre obrigaria a reiniciar o servidor após rodar a migração, e o
// sintoma ("rodei o SQL e nada mudou") é dos piores de diagnosticar.
const COOLDOWN_MS = 5 * 60 * 1000;
let indisponivelAte = 0;
let avisouMigracao = false;

function migracaoPendente() {
  return Date.now() < indisponivelAte;
}

function ehTabelaInexistente(error) {
  if (!error) return false;
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || /relation .* does not exist|Could not find the table/i.test(error.message || '');
}

function avisarMigracaoPendente(contexto) {
  indisponivelAte = Date.now() + COOLDOWN_MS;
  if (avisouMigracao) return;
  avisouMigracao = true;
  console.warn(
    `[${contexto}] Tabelas de controle de acesso ausentes no Supabase.\n` +
    '  O sistema segue com o modelo antigo (permissão por módulo inteiro) e SEM trilha de auditoria.\n' +
    '  Rode banco/migrations/fase-l-controle-de-acesso.sql no SQL Editor do Supabase\n' +
    '  (passa a valer sozinho em até 5 minutos, sem reiniciar).'
  );
}

function invalidarCache(userId) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Papéis e permissões efetivas de um usuário.
 * Devolve null quando o RBAC ainda não existe no banco — quem chama trata isso
 * como "usa a regra antiga", nunca como "não pode nada".
 */
async function carregarAcessoDoUsuario(userId) {
  if (migracaoPendente()) return null;

  const emCache = cache.get(userId);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.acesso;

  const [papeis, diretas] = await Promise.all([
    banco.from('user_roles').select('role_slug').eq('user_id', userId),
    banco.from('user_permissions').select('permission_slug, effect').eq('user_id', userId)
  ]);

  if (ehTabelaInexistente(papeis.error) || ehTabelaInexistente(diretas.error)) {
    avisarMigracaoPendente('rbac');
    return null;
  }
  assertNoError(papeis.error, 'carregarAcessoDoUsuario/papeis');
  assertNoError(diretas.error, 'carregarAcessoDoUsuario/diretas');
  indisponivelAte = 0;

  const slugsDePapel = (papeis.data || []).map((linha) => linha.role_slug);
  let doPapel = [];
  if (slugsDePapel.length) {
    const { data, error } = await banco
      .from('role_permissions')
      .select('permission_slug')
      .in('role_slug', slugsDePapel);
    if (ehTabelaInexistente(error)) {
      avisarMigracaoPendente('rbac');
      return null;
    }
    assertNoError(error, 'carregarAcessoDoUsuario/papelPermissao');
    doPapel = (data || []).map((linha) => linha.permission_slug);
  }

  const negadas = new Set((diretas.data || []).filter((l) => l.effect === 'NEGAR').map((l) => l.permission_slug));
  const efetivas = new Set([
    ...doPapel,
    ...(diretas.data || []).filter((l) => l.effect === 'PERMITIR').map((l) => l.permission_slug)
  ]);
  // NEGAR sai do conjunto efetivo aqui também, além de ser checado antes na
  // decisão: quem só olhar `efetivas` (a tela de usuários, por exemplo) já vê
  // a lista certa.
  negadas.forEach((slug) => efetivas.delete(slug));

  const acesso = { roles: slugsDePapel, efetivas, negadas };
  cache.set(userId, { acesso, expiraEm: Date.now() + TTL_CACHE_MS });
  return acesso;
}

async function listarPapeis() {
  const { data, error } = await banco.from('roles').select('*').order('level', { ascending: false });
  if (ehTabelaInexistente(error)) { avisarMigracaoPendente('listarPapeis'); return []; }
  assertNoError(error, 'listarPapeis');
  return data || [];
}

async function listarPermissoes() {
  const { data, error } = await banco.from('permissions').select('*').order('slug', { ascending: true });
  if (ehTabelaInexistente(error)) { avisarMigracaoPendente('listarPermissoes'); return []; }
  assertNoError(error, 'listarPermissoes');
  return data || [];
}

async function listarPermissoesDePapeis() {
  const { data, error } = await banco.from('role_permissions').select('*');
  if (ehTabelaInexistente(error)) { avisarMigracaoPendente('listarPermissoesDePapeis'); return []; }
  assertNoError(error, 'listarPermissoesDePapeis');
  return data || [];
}

// Papéis do usuário são substituídos em bloco (apaga e insere): é o que a tela
// manda — a lista final marcada nas caixas — e evita ficar comparando diferença.
async function definirPapeisDoUsuario(userId, slugs, concedidoPor) {
  const { error: erroApagar } = await banco.from('user_roles').delete().eq('user_id', userId);
  if (ehTabelaInexistente(erroApagar)) { avisarMigracaoPendente('definirPapeisDoUsuario'); return; }
  assertNoError(erroApagar, 'definirPapeisDoUsuario/apagar');

  const linhas = (slugs || []).map((slug) => ({ user_id: userId, role_slug: slug, granted_by: concedidoPor || null }));
  if (linhas.length) {
    const { error } = await banco.from('user_roles').insert(linhas);
    assertNoError(error, 'definirPapeisDoUsuario/inserir');
  }
  invalidarCache(userId);
}

// Idem para as permissões pontuais: a tela manda a lista completa de exceções.
async function definirPermissoesDoUsuario(userId, excecoes) {
  const { error: erroApagar } = await banco.from('user_permissions').delete().eq('user_id', userId);
  if (ehTabelaInexistente(erroApagar)) { avisarMigracaoPendente('definirPermissoesDoUsuario'); return; }
  assertNoError(erroApagar, 'definirPermissoesDoUsuario/apagar');

  const linhas = (excecoes || [])
    .filter((item) => item && item.permission_slug && (item.effect === 'PERMITIR' || item.effect === 'NEGAR'))
    .map((item) => ({ user_id: userId, permission_slug: item.permission_slug, effect: item.effect }));
  if (linhas.length) {
    const { error } = await banco.from('user_permissions').insert(linhas);
    assertNoError(error, 'definirPermissoesDoUsuario/inserir');
  }
  invalidarCache(userId);
}

async function definirPermissoesDoPapel(roleSlug, slugs) {
  const { error: erroApagar } = await banco.from('role_permissions').delete().eq('role_slug', roleSlug);
  if (ehTabelaInexistente(erroApagar)) { avisarMigracaoPendente('definirPermissoesDoPapel'); return; }
  assertNoError(erroApagar, 'definirPermissoesDoPapel/apagar');

  const linhas = (slugs || []).map((slug) => ({ role_slug: roleSlug, permission_slug: slug }));
  if (linhas.length) {
    const { error } = await banco.from('role_permissions').insert(linhas);
    assertNoError(error, 'definirPermissoesDoPapel/inserir');
  }
  // Mudou o papel, mudou o acesso de todo mundo que o tem.
  invalidarCache();
}

/**
 * Grava na trilha de auditoria. NUNCA lança: uma falha ao registrar o log não
 * pode derrubar a ação que o usuário pediu (nem, pior, virar um jeito de
 * bloquear o sistema enchendo o banco). Falhou, avisa no console e segue.
 */
async function registrarAcesso({ userId, userName, action, resourceType, resourceId, result, ip, detail }) {
  if (migracaoPendente()) return;
  try {
    const { error } = await banco.from('access_logs').insert({
      user_id: userId || null,
      user_name: userName || '',
      action: String(action || '').slice(0, 100),
      resource_type: String(resourceType || '').slice(0, 60),
      resource_id: String(resourceId || '').slice(0, 64),
      result: result === 'NEGADO' ? 'NEGADO' : 'PERMITIDO',
      ip: ip || null,
      detail: detail || {}
    });
    if (ehTabelaInexistente(error)) { avisarMigracaoPendente('registrarAcesso'); return; }
    assertNoError(error, 'registrarAcesso');
  } catch (erro) {
    console.warn('[auditoria] não foi possível registrar o acesso:', erro.message);
  }
}

async function listarAcessos({ limite = 100, usuario = '', resultado = '', acao = '' } = {}) {
  let consulta = banco.from('access_logs').select('*').order('created_at', { ascending: false }).limit(Math.min(500, Math.max(1, limite)));
  if (usuario) consulta = consulta.eq('user_id', usuario);
  if (resultado) consulta = consulta.eq('result', resultado);
  if (acao) consulta = consulta.ilike('action', `%${acao}%`);
  const { data, error } = await consulta;
  if (ehTabelaInexistente(error)) { avisarMigracaoPendente('listarAcessos'); return []; }
  assertNoError(error, 'listarAcessos');
  return data || [];
}

function rbacEstaDisponivel() {
  return !migracaoPendente();
}

module.exports = {
  carregarAcessoDoUsuario,
  listarPapeis,
  listarPermissoes,
  listarPermissoesDePapeis,
  definirPapeisDoUsuario,
  definirPermissoesDoUsuario,
  definirPermissoesDoPapel,
  registrarAcesso,
  listarAcessos,
  invalidarCache,
  rbacEstaDisponivel
};
