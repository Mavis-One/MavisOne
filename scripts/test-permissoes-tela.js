// A tela de Papéis e Permissões contra as permissões REAIS do banco.
//
// O risco que este teste cobre: módulo novo entra no sistema, ganha permissões,
// e a tela de acesso passa a exibir um slug técnico ("fleet", "pcp") como
// título de seção. Quem administra acesso conhece o módulo pelo nome do menu —
// e um título que ninguém reconhece faz a permissão certa não ser encontrada.
//
// Roda contra o Supabase (lê permissions), então fica fora do "npm test":
//     npm run permissoes-tela
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabase } = require('../lib/db/client');

const RAIZ = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8');
const telaSrc = fs.readFileSync(path.join(RAIZ, 'public/modules/settings/subs/access_control.js'), 'utf8');

function extrairConst(nome) {
  const inicio = appSrc.indexOf(`const ${nome} = {`);
  const abre = appSrc.indexOf('{', inicio);
  const fecha = appSrc.indexOf('\n};', abre);
  return (0, eval)('(' + appSrc.slice(abre, fecha + 2) + ')');
}
const moduleLabels = extrairConst('moduleLabels');
const MENU_MODULOS = Object.keys(moduleLabels).filter((k) => k !== 'settings');

// Espelha o que a tela faz, lido do próprio arquivo dela para não divergir.
const NOME_FORA_DO_MENU = (0, eval)('(' + telaSrc.match(/const NOME_FORA_DO_MENU = (\{[^}]*\})/)[1] + ')');
const ORDEM_ACOES = (0, eval)(telaSrc.match(/const ORDEM_ACOES = (\[[^\]]*\])/)[1]);
const nomeDoRecurso = (r) => moduleLabels[r] || NOME_FORA_DO_MENU[r] || r;

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

(async () => {
  const { data, error } = await supabase.from('permissions').select('slug,resource,action');
  if (error) { console.log('  XX  não foi possível ler as permissões:', error.message); process.exit(1); }

  const recursos = [...new Set(data.map((p) => p.resource))];
  console.log(`\n--- ${data.length} permissões em ${recursos.length} recursos ---`);

  console.log('\n--- todo recurso tem nome de gente ---');
  const semNome = recursos.filter((r) => nomeDoRecurso(r) === r);
  check('nenhum recurso cai no slug técnico', semNome.length === 0, semNome.join(', ') || 'todos nomeados');

  console.log('\n--- os módulos novos estão lá ---');
  ['reports', 'fleet', 'crm', 'hr', 'pcp', 'contracts'].forEach((r) => {
    const acoes = data.filter((p) => p.resource === r).map((p) => p.action);
    check(`${r} (${nomeDoRecurso(r)})`, acoes.length > 0, acoes.join(', '));
  });

  console.log('\n--- ordem faz sentido ---');
  const posR = (r) => { const i = MENU_MODULOS.indexOf(r); return i === -1 ? MENU_MODULOS.length : i; };
  const ordenados = [...recursos].sort((a, b) => posR(a) - posR(b) || a.localeCompare(b));
  check('Vendas vem antes de Contratos (ordem do menu, não alfabética)',
    ordenados.indexOf('sales') < ordenados.indexOf('contracts'),
    ordenados.slice(0, 6).join(' > '));
  check('o que não é módulo fica no fim',
    ['usuarios', 'auditoria'].every((r) => ordenados.indexOf(r) >= ordenados.length - 3),
    ordenados.slice(-3).join(' > '));

  const posA = (a) => { const i = ORDEM_ACOES.indexOf(a); return i === -1 ? ORDEM_ACOES.length : i; };
  const acoesFleet = data.filter((p) => p.resource === 'fleet').map((p) => p.action)
    .sort((x, y) => posA(x) - posA(y) || x.localeCompare(y));
  check('ações vão do menos ao mais poderoso', acoesFleet.join(',') === 'ler,criar,editar,excluir', acoesFleet.join(', '));

  console.log('\n--- o papel usuário não recebe exclusão nos módulos novos ---');
  // Apagar contrato ou colaborador some com histórico que a tela não recupera.
  const { data: rp } = await supabase.from('role_permissions').select('role_slug,permission_slug');
  const doUsuario = (rp || []).filter((r) => r.role_slug === 'usuario').map((r) => r.permission_slug);
  const excluirIndevido = doUsuario.filter((s) => /^(fleet|hr|pcp|contracts|crm)\.excluir$/.test(s));
  check('nenhum excluir para o papel usuário', excluirIndevido.length === 0, excluirIndevido.join(', ') || 'ok');
  const gerente = (rp || []).filter((r) => r.role_slug === 'gerente').map((r) => r.permission_slug);
  check('gerente recebe exclusão dos 4 módulos com CRUD',
    ['fleet', 'hr', 'pcp', 'contracts'].every((m) => gerente.includes(`${m}.excluir`)));

  console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
