#!/usr/bin/env node
// LIBERA O ADMINISTRADOR EM TUDO.
//
//   node scripts/liberar-admin.js
//   node scripts/liberar-admin.js --usuario outro-login
//
// POR QUE ISTO PRECISA EXISTIR
// ----------------------------
// O `admin` que nasce do banco/schema.sql vem com sete modulos em
// `allowed_modules`: dashboard, sales, purchases, stock, finance, settings,
// cadastros. O sistema tem QUATORZE -- fiscal, reports, fleet, crm, hr, pcp e
// contracts entraram depois, e a semente do schema nunca foi atualizada.
//
// Na maior parte das rotas isso nao aparece, porque o portao central decide por
// RBAC e `ehAdministrador()` passa por cima de tudo. Mas varias rotas conferem
// `user.allowedModules.includes('...')` DIRETO, sem passar pelo RBAC -- fiscal,
// finance, cadastros, purchases, sales, settings e stock fazem isso. Nessas, o
// papel de administrador nao vale nada: o que vale e' a lista.
//
// O resultado e' a pior especie de defeito de permissao: o administrador do
// sistema leva "Sem permissao" numa tela que ele mesmo criou, e a mensagem nao
// diz que o problema e' uma lista desatualizada gravada na linha dele.
//
// O que este script faz, e' so' isso:
//   1. `users.role = 'admin'` e `active = true`;
//   2. `allowed_modules` com os 14 modulos;
//   3. `fiscal_permissions` com as 10 permissoes fiscais;
//   4. o papel `admin` em `user_roles` (o caminho novo, RBAC).
//
// Os quatro juntos porque os quatro sao consultados em lugares diferentes, e
// deixar um para tras reproduz exatamente o defeito acima.
require('dotenv').config();

const db = require('../db');
const { banco } = require('../lib/db/client');
const fiscalPermissoes = require('../public/modules/shared/fiscal_permissoes');

// A lista vem do moduleSubItems de public/app.js, que e' a fonte unica das
// telas. Ler dali em vez de repetir a mao evita o proximo modulo novo nascer
// fora desta lista -- que e' como os sete de hoje ficaram de fora.
function modulosDoSistema() {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const inicio = src.indexOf('const moduleSubItems = {');
  const bloco = src.slice(inicio, src.indexOf('\n};', inicio));
  return [...bloco.matchAll(/^ {2}([a-z_]+): \[/gm)].map((m) => m[1]);
}

const argumentos = process.argv.slice(2);
const posicao = argumentos.indexOf('--usuario');
const LOGIN = posicao >= 0 ? argumentos[posicao + 1] : 'admin';

let falhas = 0;
const check = (ok, titulo, detalhe) => {
  console.log(`  ${ok ? 'OK ' : 'XX '} ${titulo}${detalhe !== undefined ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas++;
};

(async () => {
  const MODULOS = modulosDoSistema();
  const FISCAIS = fiscalPermissoes.VALORES;
  console.log(`\n--- liberando "${LOGIN}" ---`);
  console.log(`    ${MODULOS.length} modulos: ${MODULOS.join(', ')}`);
  console.log(`    ${FISCAIS.length} permissoes fiscais: ${FISCAIS.join(', ')}\n`);

  const { data: antes, error: erroLeitura } = await banco
    .from('users').select('id, username, role, allowed_modules, fiscal_permissions, active')
    .eq('username', LOGIN).maybeSingle();
  if (erroLeitura) throw erroLeitura;
  if (!antes) {
    console.error(`\nXX  nao existe usuario "${LOGIN}". Confira com: select username from users;\n`);
    process.exit(1);
  }
  const faltavam = MODULOS.filter((m) => !(antes.allowed_modules || []).includes(m));
  console.log(`  -- antes: ${(antes.allowed_modules || []).length} modulos` +
    (faltavam.length ? `, faltando ${faltavam.join(', ')}` : ', nenhum faltando'));

  const { error } = await banco.from('users').update({
    role: 'admin',
    active: true,
    allowed_modules: MODULOS,
    fiscal_permissions: FISCAIS
  }).eq('id', antes.id);
  if (error) throw error;

  // O papel do RBAC e' outro caminho, consultado por outras rotas. Preserva os
  // papeis que ja existirem: definirPapeisDoUsuario substitui a lista inteira,
  // entao apagar o resto aqui tiraria acesso em vez de dar.
  const { data: papeisAtuais } = await banco.from('user_roles').select('role_slug').eq('user_id', antes.id);
  const slugs = [...new Set([...(papeisAtuais || []).map((l) => l.role_slug), 'admin'])];
  await db.rbac.definirPapeisDoUsuario(antes.id, slugs, null);

  const depois = await db.getUserById(antes.id);
  check(depois.role === 'admin', 'role = admin', depois.role);
  check(depois.active !== false, 'usuario ativo');
  check(MODULOS.every((m) => depois.allowedModules.includes(m)),
    `os ${MODULOS.length} modulos entraram`, `${depois.allowedModules.length} gravados`);
  check(FISCAIS.every((p) => (depois.fiscalPermissions || []).includes(p)),
    `as ${FISCAIS.length} permissoes fiscais entraram`, `${(depois.fiscalPermissions || []).length} gravadas`);

  const acesso = await db.rbac.carregarAcessoDoUsuario(antes.id);
  check(Boolean(acesso && acesso.roles.includes('admin')), 'papel admin no RBAC',
    acesso ? acesso.roles.join(', ') : 'RBAC indisponivel (migracao pendente)');

  console.log(`\n===== ${falhas === 0 ? `"${LOGIN}" LIBERADO EM TUDO` : falhas + ' FALHA(S)'} =====`);
  console.log('    Saia e entre de novo no sistema: a sessao aberta carrega a lista antiga.\n');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('\nXX  parou no meio:', erro.message, '\n');
  process.exit(1);
});
