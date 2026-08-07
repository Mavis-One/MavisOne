#!/usr/bin/env node
// Regras de controle de acesso (lib/permissoes.js).
//
// Errar aqui tem dois custos opostos e igualmente graves: liberar o que devia
// ser negado, ou trancar o usuário para fora do próprio ERP. Por isso cada
// regra é verificada nas duas direções — o que passa E o que tem que barrar.
//
// Não precisa de servidor nem de banco: as funções são puras.
const P = require('../lib/permissoes');

let falhas = 0;
const check = (nome, cond, det) => { console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det ? ' -> ' + det : ''}`); if (!cond) falhas++; };

const acesso = (permitidas = [], negadas = []) => ({ efetivas: new Set(permitidas), negadas: new Set(negadas) });
const usuario = (over = {}) => ({ id: 'u1', name: 'Fulano', role: 'user', active: true, allowedModules: [], roles: [], ...over });

console.log('\n--- rota + método viram permissão ---');
check('POST em vendas = criar', P.resolverPermissao('/api/sales/records', 'POST') === 'sales.criar');
check('GET em vendas = ler', P.resolverPermissao('/api/sales/records', 'GET') === 'sales.ler');
check('PUT em vendas = editar', P.resolverPermissao('/api/sales/records/ord-1', 'PUT') === 'sales.editar');
check('DELETE em vendas = excluir', P.resolverPermissao('/api/sales/records/ord-1', 'DELETE') === 'sales.excluir');
check('PATCH conta como editar', P.resolverPermissao('/api/finance/entries', 'PATCH') === 'finance.editar');
check('estoque', P.resolverPermissao('/api/stock/movements', 'POST') === 'stock.criar');
check('cadastros', P.resolverPermissao('/api/cadastros/empresas', 'POST') === 'cadastros.criar');
check('compras', P.resolverPermissao('/api/purchases', 'GET') === 'purchases.ler');
check('configurações', P.resolverPermissao('/api/settings', 'GET') === 'settings.ler');
check('usuários usam ação fixa', P.resolverPermissao('/api/users/u1', 'PUT') === 'usuarios.gerenciar');
check('gestão de acesso exige gerenciar usuários', P.resolverPermissao('/api/access-control/users/u1', 'PUT') === 'usuarios.gerenciar');
check('auditoria tem permissão própria', P.resolverPermissao('/api/access-logs', 'GET') === 'auditoria.ler');

console.log('\n--- rotas que NÃO podem ser barradas pelo portão ---');
check('login é público', P.resolverPermissao('/api/login', 'POST') === null);
check('logout é público', P.resolverPermissao('/api/logout', 'POST') === null);
check('/api/me é do próprio usuário', P.resolverPermissao('/api/me', 'GET') === null);
check('tema do próprio usuário', P.resolverPermissao('/api/me/theme', 'PUT') === null);
check('CEP não é recurso do ERP', P.resolverPermissao('/api/cep/89000000', 'GET') === null);
check('fiscal tem portão próprio', P.resolverPermissao('/api/fiscal/nfe', 'POST') === null);
check('webhook não é do usuário', P.resolverPermissao('/api/webhooks/focusnfe', 'POST') === null);
check('arquivo estático não é API', P.resolverPermissao('/app.js', 'GET') === null);
check('rota de API não mapeada passa (não nasce bloqueada)', P.resolverPermissao('/api/algo-novo', 'POST') === null);
// Prefixo tem que casar o caminho inteiro, senão /api/salesX herdaria o controle de /api/sales.
check('prefixo não vaza para rota parecida', P.resolverPermissao('/api/salesfoo', 'POST') === null);

console.log('\n--- a decisão ---');
const comum = usuario();
check('sem permissão nenhuma, não cria', P.usuarioPode(comum, 'sales.criar', acesso()) === false);
check('com a permissão, cria', P.usuarioPode(comum, 'sales.criar', acesso(['sales.criar'])) === true);
check('permissão de criar NÃO dá excluir', P.usuarioPode(comum, 'sales.excluir', acesso(['sales.criar', 'sales.ler'])) === false);
check('permissão de vendas não vale para financeiro', P.usuarioPode(comum, 'finance.ler', acesso(['sales.ler'])) === false);

console.log('\n--- admin ---');
const admin = usuario({ role: 'admin' });
const adminPorPapel = usuario({ role: 'user', roles: ['admin'] });
check('admin faz tudo sem listar permissão', P.usuarioPode(admin, 'finance.excluir', acesso()) === true);
check('admin pelo papel novo também', P.usuarioPode(adminPorPapel, 'usuarios.gerenciar', acesso()) === true);

console.log('\n--- NEGAR explícito vence tudo, inclusive admin ---');
check('negar vence a permissão do papel', P.usuarioPode(comum, 'sales.excluir', acesso(['sales.excluir'], ['sales.excluir'])) === false);
check('negar vence o próprio admin', P.usuarioPode(admin, 'sales.excluir', acesso([], ['sales.excluir'])) === false);
check('negar de uma ação não afeta as outras', P.usuarioPode(admin, 'sales.criar', acesso([], ['sales.excluir'])) === true);

console.log('\n--- usuário bloqueado ---');
const bloqueado = usuario({ active: false, role: 'admin' });
check('bloqueado não faz nada, nem sendo admin', P.usuarioPode(bloqueado, 'dashboard.ler', acesso(['dashboard.ler'])) === false);
check('usuário inexistente não faz nada', P.usuarioPode(null, 'dashboard.ler', acesso(['dashboard.ler'])) === false);

console.log('\n--- migração pendente: cai no modelo antigo, sem trancar ninguém ---');
const antigo = usuario({ allowedModules: ['sales', 'dashboard'] });
check('módulo liberado permite a ação', P.podePeloModulo(antigo, 'sales.criar') === true);
check('módulo liberado permite até excluir (era assim antes)', P.podePeloModulo(antigo, 'sales.excluir') === true);
check('módulo não liberado barra', P.podePeloModulo(antigo, 'finance.ler') === false);
check('gerenciar usuários continua só do admin', P.podePeloModulo(antigo, 'usuarios.gerenciar') === false);
check('auditoria continua só do admin', P.podePeloModulo(antigo, 'auditoria.ler') === false);
check('admin segue fazendo tudo', P.podePeloModulo(admin, 'usuarios.gerenciar') === true);
check('bloqueado não passa nem no modelo antigo', P.podePeloModulo(usuario({ active: false, allowedModules: ['sales'] }), 'sales.ler') === false);

console.log('\n--- não pode ficar mais restritivo que antes da migração ---');
// Cada módulo que o usuário já tinha precisa continuar respondendo às quatro
// ações no modelo antigo — senão a Fase L tiraria acesso de quem já trabalha.
['sales', 'cadastros', 'stock', 'finance', 'purchases'].forEach((recurso) => {
  const comModulo = usuario({ allowedModules: [recurso] });
  const todas = ['ler', 'criar', 'editar', 'excluir'].every((acao) => P.podePeloModulo(comModulo, `${recurso}.${acao}`));
  check(`${recurso}: mantém as 4 ações`, todas);
});

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
process.exit(falhas === 0 ? 0 : 1);
