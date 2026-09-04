#!/usr/bin/env node
/**
 * O PAPEL DO USUÁRIO ACOMPANHA QUEM ELE É (fase BN).
 *
 * Desde a fase L convivem duas fontes da mesma verdade: a coluna antiga
 * `users.role` e a tabela `user_roles` do RBAC. `permissoes.ehAdministrador`
 * aceita qualquer uma das duas, e o portão central decide por
 * `permissoes.usuarioPode`, que só olha as permissões vindas dos PAPÉIS. Três
 * buracos nasceram dessa convivência, e os três foram reproduzidos contra a API
 * antes de mexer.
 *
 * 1. USUÁRIO NOVO NASCIA SEM PAPEL — e sem entrar em lugar nenhum.
 *
 *    `createUser` grava em `users` e mais nada. Sem linha em `user_roles`, o
 *    conjunto de permissões efetivas chega VAZIO ao portão e toda rota de módulo
 *    responde 403. As caixas de módulo da própria tela de Usuários não salvam
 *    ninguém: elas alimentam `podePeloModulo`, que só é consultado quando o RBAC
 *    NÃO existe no banco.
 *
 *      antes  usuário com allowed_modules {dashboard,sales,stock}, papéis (NENHUM)
 *             GET /api/sales/records  -> 403 Sem permissão para "sales.ler"
 *             GET /api/stock/products -> 403 Sem permissão para "stock.ler"
 *      depois papéis: usuario — as duas rotas em 200, e /api/finance/entries
 *             continua 403, que é o certo: o módulo não foi marcado.
 *
 * 2. REBAIXAR PELA TELA DE USUÁRIOS NÃO REBAIXAVA.
 *
 *    Trocar `role` para 'user' mexia só na coluna. O papel 'admin' ficava em
 *    `user_roles`, e ehAdministrador continuava dizendo sim — a tela mostrava
 *    "Usuário" e a pessoa seguia podendo tudo.
 *
 *    A sincronia é cirúrgica: só quando o campo MUDA, e mexendo só no papel
 *    'admin'. Esta tela não gerencia papéis — quem faz isso é Controle de
 *    Acesso —, e reescrever a lista inteira apagaria um 'gerente' concedido lá
 *    toda vez que alguém corrigisse o nome do usuário aqui.
 *
 * 3. QUEM ERA ADMIN SÓ PELO PAPEL CONSEGUIA SE TRANCAR PARA FORA.
 *
 *    A trava de auto-rebaixamento chamava ehAdministrador com o objeto de
 *    `getCurrentUser`, que é a linha de `users` — sem `roles`. Para quem virou
 *    admin pela tela de Controle de Acesso (users.role segue 'user') a trava
 *    simplesmente não disparava.
 *
 *      antes  PUT /api/access-control/users/<eu> {"roles":["usuario"]}
 *             -> {"success":true}, papéis: usuario
 *             -> GET /api/access-control -> 403. Sem volta sem outro admin.
 *      depois -> "Não é permitido remover o próprio papel de administrador."
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const permissoes = require('../lib/permissoes');

console.log('--- 1. usuário novo nasce com papel ---');

const rotaCriar = src.slice(
  src.indexOf("if (body.type === 'user')"),
  src.indexOf("return sendJson(res, { error: 'Tipo de configuração inválido' }, 400);")
);
check('achei a criação de usuário', rotaCriar.length > 200, `${rotaCriar.length} caracteres`);
check('ela dá um papel ao usuário novo',
  /await db\.rbac\.definirPapeisDoUsuario\(\s*\n?\s*newUser\.id, \[newUser\.role === 'admin' \? 'admin' : 'usuario'\], user\.id/.test(rotaCriar));
// Falhar ao dar o papel não pode desfazer o usuário: ele existe, e o admin
// consegue conceder o papel pela outra tela. Mas tem de aparecer no log.
check('  e falhar nisso não derruba a criação',
  /catch \(erroPapel\)[\s\S]{0,200}?console\.error\('Usuario criado, mas nao consegui dar o papel padrao'/.test(rotaCriar));

console.log('--- 2. promover e rebaixar chegam ao papel ---');

const rotaEditar = src.slice(src.indexOf("if (pathname.startsWith('/api/users/') && pathname !== '/api/users/delete' && req.method === 'PUT')"));
const trecho = rotaEditar.slice(0, rotaEditar.indexOf('return sendJson(res, { success: true, user: updated });'));
check('achei a edição de usuário', trecho.length > 200);
// SÓ quando muda: um PUT que só corrige o nome não deve tocar em papel nenhum.
check('só mexe no papel quando o campo MUDA', /if \(role !== target\.role\) \{/.test(trecho));
check('  promover acrescenta admin', /if \(role === 'admin'\) atuais\.add\('admin'\);/.test(trecho));
check('  rebaixar tira admin', /else atuais\.delete\('admin'\);/.test(trecho));
// Reescrever a lista inteira apagaria um 'gerente' concedido em Controle de
// Acesso toda vez que alguém corrigisse o nome do usuário aqui.
check('  e preserva os outros papéis',
  /const atuais = new Set\(\(acessoAlvo && acessoAlvo\.roles\) \|\| \[\]\);/.test(trecho));
// Rebaixar não pode virar bloqueio total — é o buraco nº 1 pela porta dos fundos.
check('  rebaixar nunca deixa o usuário sem papel nenhum',
  /if \(!atuais\.size\) atuais\.add\('usuario'\);/.test(trecho));

console.log('--- 3. a trava de auto-rebaixamento enxerga admin por papel ---');

const rotaAcesso = src.slice(src.indexOf("if (pathname.startsWith('/api/access-control/users/') && req.method === 'PUT')"));
const trechoAcesso = rotaAcesso.slice(0, rotaAcesso.indexOf('await db.rbac.definirPapeisDoUsuario(id, papeis, requester.id);'));
check('achei a rota de Controle de Acesso', trechoAcesso.length > 200);
check('ela carrega os papéis do requisitante',
  /const acessoDoRequisitante = await db\.rbac\.carregarAcessoDoUsuario\(requester\.id\);/.test(trechoAcesso));
check('  e é ESSE objeto que a trava usa',
  /permissoes\.ehAdministrador\(requisitanteComPapeis\) && !papeis\.includes\('admin'\)/.test(trechoAcesso));
// getCurrentUser devolve a linha de `users`, sem `roles`: passar o objeto cru
// era exatamente o defeito.
check('  e não mais o objeto cru de getCurrentUser',
  !/ehAdministrador\(requester\) && !papeis/.test(trechoAcesso));

console.log('--- a regra que sustenta tudo isso ---');

// ehAdministrador aceita as DUAS fontes — é por isso que rebaixar só a coluna
// não rebaixava, e é por isso que a trava precisa dos papéis carregados.
check('admin pela coluna antiga conta', permissoes.ehAdministrador({ role: 'admin' }));
check('admin pelo papel novo também', permissoes.ehAdministrador({ role: 'user', roles: ['admin'] }));
check('  e sem nenhum dos dois, não', !permissoes.ehAdministrador({ role: 'user', roles: ['gerente'] }));
// O objeto sem `roles` é o que getCurrentUser devolve: ele NÃO basta para
// decidir se alguém é admin.
check('objeto sem roles não reconhece admin por papel', !permissoes.ehAdministrador({ role: 'user' }));
// Sem papel, o conjunto efetivo é vazio e o portão nega tudo — a raiz do nº 1.
check('sem papel, o portão nega mesmo com módulo liberado',
  !permissoes.usuarioPode(
    { role: 'user', roles: [], allowedModules: ['sales'], active: true },
    'sales.ler',
    { efetivas: new Set(), negadas: new Set() }
  ));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
