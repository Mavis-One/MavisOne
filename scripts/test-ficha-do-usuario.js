#!/usr/bin/env node
/**
 * A FICHA DO USUÁRIO NO LAYOUT DO VIPER (fase DR).
 *
 * Editar uma pessoa era abrir duas telas: Usuários (nome, senha, módulos,
 * vínculos) e Papéis e Permissões (papel, exceções, ativo). A ficha agora tem
 * as abas do Viper — Dados Básicos, Restrições de Acesso, Permissões — e a
 * grade "Empresas do Usuário", que pediu uma coluna nova: até aqui só dava para
 * dizer "lança só pelo seu" ou "lança por todos".
 *
 * O que este teste segura:
 *   1. a regra de por qual estabelecimento a pessoa lança, com a lista nova;
 *   2. o que a rota aceita da ficha (papéis, exceções, ativo, empresas) e o que
 *      ela recusa ou ignora;
 *   3. a ida e volta da coluna pelo banco, com "ausente não mexe";
 *   4. a tela: as abas, a confirmação de senha e o que ela manda.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) console.log(`  OK  ${nome}`);
  else { falhas += 1; console.log(`  XX  ${nome}${detalhe !== undefined ? ` -> ${detalhe}` : ''}`); }
};

const serverSrc = ler('server.js');
const funcao = (nome) => {
  const m = serverSrc.match(new RegExp(`(async )?function ${nome}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`função ${nome} não encontrada no server.js`);
  return m[0];
};

(async () => {
  console.log('--- 1. por qual estabelecimento a pessoa lança ---');
  const regra = {};
  vm.runInNewContext(
    `${funcao('podeTrocarDeEstabelecimento')}\n${funcao('estabelecimentosQuePodeUsar')}\n${funcao('estabelecimentoDaOperacao')}\n`
    + 'saida.usar = estabelecimentosQuePodeUsar; saida.operacao = estabelecimentoDaOperacao;',
    { saida: regra }
  );
  const ana = { estabelecimentoId: 'centro', estabelecimentosLiberados: ['marcolla', 'araquari'], podeTrocarEstabelecimento: false };
  check('sem nada no corpo, vale o principal', regra.operacao(ana, false, '').id === 'centro');
  check('o principal, pedido de propósito', regra.operacao(ana, false, 'centro').id === 'centro' && !regra.operacao(ana, false, 'centro').erro);
  check('uma empresa liberada na grade passa', regra.operacao(ana, false, 'marcolla').id === 'marcolla' && !regra.operacao(ana, false, 'marcolla').erro);
  const barrada = regra.operacao(ana, false, 'timbo');
  check('uma que NÃO está na grade é recusada com 403', barrada.erro && barrada.erro.status === 403, barrada.erro && barrada.erro.message);
  check('  e a recusa diz onde liberar', /Empresas do Usuário/.test(barrada.erro ? barrada.erro.message : ''));
  check('"Todas" continua liberando qualquer uma', !regra.operacao({ ...ana, podeTrocarEstabelecimento: true }, false, 'timbo').erro);
  check('administrador lança por qualquer uma', !regra.operacao({ ...ana, estabelecimentosLiberados: [] }, true, 'timbo').erro);
  check('sem a coluna (migração pendente), ninguém quebra',
    regra.operacao({ estabelecimentoId: 'centro' }, false, 'timbo').erro && regra.operacao({ estabelecimentoId: 'centro' }, false, '').id === 'centro');
  check('a lista para a tela: principal + liberadas', JSON.stringify(regra.usar(ana, false)) === '["centro","marcolla","araquari"]', JSON.stringify(regra.usar(ana, false)));
  check('  e null quando são todas (filial nova entra sozinha)', regra.usar({ ...ana, podeTrocarEstabelecimento: true }, false) === null && regra.usar(ana, true) === null);
  check('  sem principal, só as liberadas', JSON.stringify(regra.usar({ estabelecimentosLiberados: ['x'] }, false)) === '["x"]');

  console.log('\n--- 2. o que a rota aceita da ficha ---');
  const fichas = {};
  const dbFalso = {
    rbac: {
      listarPapeis: async () => [{ slug: 'admin' }, { slug: 'gerente' }, { slug: 'usuario' }],
      listarPermissoes: async () => [{ slug: 'sales.ler' }, { slug: 'sales.excluir' }]
    }
  };
  const fiscalFalso = { getEstabelecimentos: async () => [{ id: 'centro' }, { id: 'marcolla' }, { id: 'araquari' }] };
  vm.runInNewContext(
    `${funcao('acessoPedidoNaFicha')}\n${funcao('sanitizarEstabelecimentosLiberados')}\n`
    + 'saida.acesso = acessoPedidoNaFicha; saida.empresas = sanitizarEstabelecimentosLiberados;',
    { saida: fichas, db: dbFalso, fiscalDb: fiscalFalso, Set, Array, String }
  );
  let pedido = await fichas.acesso({ name: 'x', sellerId: '1' });
  check('sem papéis, exceções e ativo no corpo, não toca em nenhum', JSON.stringify(pedido) === '{}', JSON.stringify(pedido));
  pedido = await fichas.acesso({ roles: ['gerente', 'gerente', 'dono-do-mundo'] });
  check('papel inexistente é ignorado, repetido entra uma vez', JSON.stringify(pedido.roles) === '["gerente"]', JSON.stringify(pedido.roles));
  pedido = await fichas.acesso({ roles: ['dono-do-mundo'] });
  check('lista que fica vazia vira "usuario" (sem papel, o portão nega tudo)', JSON.stringify(pedido.roles) === '["usuario"]');
  pedido = await fichas.acesso({
    exceptions: [
      { permission_slug: 'sales.excluir', effect: 'NEGAR' },
      { permission_slug: 'sales.excluir', effect: 'PERMITIR' },
      { permission_slug: 'nao.existe', effect: 'PERMITIR' },
      { permission_slug: 'sales.ler', effect: 'TALVEZ' }
    ]
  });
  check('exceção: só permissão do catálogo, efeito válido, uma por permissão',
    JSON.stringify(pedido.exceptions) === '[{"permission_slug":"sales.excluir","effect":"NEGAR"}]', JSON.stringify(pedido.exceptions));
  check('ativo false chega como false', (await fichas.acesso({ active: false })).active === false);
  check('ativo ausente não chega', !('active' in (await fichas.acesso({}))));
  const semRbac = {};
  vm.runInNewContext(`${funcao('acessoPedidoNaFicha')}\nsaida.acesso = acessoPedidoNaFicha;`,
    { saida: semRbac, db: { rbac: { listarPapeis: async () => [], listarPermissoes: async () => [] } }, Set, Array });
  check('sem as tabelas do RBAC os papéis são ignorados (e vale a coluna role)',
    (await semRbac.acesso({ roles: ['admin'] })).roles === undefined);
  check('empresas: só as que existem, sem repetir, sem o principal',
    JSON.stringify(await fichas.empresas(['marcolla', 'marcolla', 'centro', "'; drop table users; --", 'araquari'], 'centro')) === '["marcolla","araquari"]');
  check('  e qualquer coisa que não seja lista vira vazia', JSON.stringify(await fichas.empresas('marcolla', '')) === '[]');

  const rotaPut = serverSrc.slice(serverSrc.indexOf("pathname.startsWith('/api/users/') && pathname !== '/api/users/delete' && req.method === 'PUT'"));
  const corpoPut = rotaPut.slice(0, rotaPut.indexOf("if (pathname === '/health')"));
  check('a edição lê o acesso da ficha', /const acessoDaFicha = await acessoPedidoNaFicha\(body\)/.test(corpoPut));
  check('  a coluna role segue os papéis', /acessoDaFicha\.roles\.includes\('admin'\) \? 'admin' : 'user'/.test(corpoPut));
  check('  ninguém se bloqueia sozinho', /requester\.id === id && acessoDaFicha\.active === false/.test(corpoPut));
  check('  grava papéis, exceções e ativo só quando vieram',
    /if \(acessoDaFicha\.roles\) \{/.test(corpoPut) && /if \(acessoDaFicha\.exceptions\) await db\.rbac\.definirPermissoesDoUsuario/.test(corpoPut)
    && /if \(acessoDaFicha\.active !== undefined\) await db\.definirUsuarioAtivo/.test(corpoPut));
  check('  e a mudança vai para a trilha de auditoria', /resourceType: 'usuario', resourceId: id, result: 'PERMITIDO'/.test(corpoPut));
  check('  empresas ausentes não mexem', /estabelecimentosLiberados: body\.estabelecimentosLiberados === undefined\s*\? undefined/.test(corpoPut));
  check('a criação também aceita papel e exceções', /acessoDaFicha\.roles \|\| \[newUser\.role === 'admin' \? 'admin' : 'usuario'\]/.test(serverSrc));
  check('a lista de usuários manda empresas e ativo para a ficha',
    /estabelecimentosLiberados: entry\.estabelecimentosLiberados \|\| \[\]/.test(serverSrc) && /active: entry\.active !== false/.test(serverSrc));
  check('o lançamento financeiro recebe a lista', /estabelecimentosLiberados: estabelecimentosQuePodeUsar\(user, ehAdministrador\)/.test(serverSrc));
  const lancamento = ler('public/modules/finance/subs/novo_lancamento.js');
  check('  e só oferece as liberadas (mais a que o lançamento já tem)',
    /\.filter\(\(e\) => !liberados \|\| liberados\.includes\(e\.id\) \|\| e\.id === estabelecimentoAtual\)/.test(lancamento));

  console.log('\n--- 3. a ida e volta pelo banco ---');
  const db = require(path.join(RAIZ, 'lib/db/auth'));
  const fiscalDb = require(path.join(RAIZ, 'lib/db/fiscal'));
  const { fecharPool } = require(path.join(RAIZ, 'lib/db/conexao'));
  const estabs = (await fiscalDb.getEstabelecimentos().catch(() => [])).map((e) => e.id);
  let criado = null;
  try {
    if (estabs.length < 2) {
      check('o banco local tem ao menos 2 estabelecimentos para o teste', false, estabs.length);
    } else {
      criado = await db.createUser({
        username: `zz-teste-ficha-${Date.now()}`, password: 'senha-de-teste-123', name: 'Teste Ficha',
        role: 'user', allowedModules: ['finance'], estabelecimentoId: estabs[0], estabelecimentosLiberados: [estabs[1]]
      });
      check('grava as empresas na criação', JSON.stringify(criado.estabelecimentosLiberados) === JSON.stringify([estabs[1]]),
        JSON.stringify(criado.estabelecimentosLiberados));
      check('  e volta como lista de texto', Array.isArray(criado.estabelecimentosLiberados) && typeof criado.estabelecimentosLiberados[0] === 'string');
      await db.updateUser(criado.id, { name: 'Teste Ficha', role: 'user', allowedModules: ['finance'] });
      check('salvar sem o campo NÃO mexe nas empresas',
        JSON.stringify((await db.getUserById(criado.id)).estabelecimentosLiberados) === JSON.stringify([estabs[1]]));
      await db.updateUser(criado.id, { name: 'Teste Ficha', role: 'user', allowedModules: ['finance'], estabelecimentosLiberados: [] });
      check('lista vazia volta a "só o principal"', JSON.stringify((await db.getUserById(criado.id)).estabelecimentosLiberados) === '[]');
    }
  } finally {
    if (criado) await db.deleteUser(criado.id);
    if (criado) check('o usuário de teste foi apagado', !(await db.getUserById(criado.id)));
    await fecharPool();
  }

  console.log('\n--- 4. a tela ---');
  const form = ler('public/modules/settings/subs/users_form.js');
  check('as três abas do Viper que este sistema tem',
    /\{ key: 'dados', label: 'Dados Básicos' \}/.test(form) && /\{ key: 'restricoes', label: 'Restrições de Acesso' \}/.test(form)
    && /\{ key: 'permissoes', label: 'Permissões' \}/.test(form));
  check('  no padrão de abas de Cadastros', /class="cadastro-tabs"/.test(form) && /cadastro-tab-chevron/.test(form));
  check('Tipo de Usuário é o papel', /<select name="tipo">/.test(form) && /papeisDisponiveis\.map/.test(form));
  check('  e trocar o tipo é o único jeito de trocar a lista de papéis',
    /tipoAtual\(\) === tipoInicial \? papeisIniciais : \[tipoAtual\(\)\]/.test(form));
  check('Repita a Senha, conferida antes de mandar', /name="passwordConfirm"/.test(form) && /'As senhas não conferem\.'/.test(form));
  check('  o formulário não depende do required do navegador (ele não abre a aba)', /id="userFormPage" class="cadastro-form" novalidate/.test(form));
  check('  e a recusa leva até a aba do campo', /function recusar\(nome, mensagem\) \{\s*abrirAba\('dados'\)/.test(form));
  check('chave Ativo, travada para o próprio usuário', /name="active"/.test(form) && /\$\{ehOProprio \? 'disabled' : ''\}/.test(form));
  check('  e o próprio não manda o campo', /\.\.\.\(ehOProprio \? \{\} : \{ active: formData\.get\('active'\) === 'on' \}\)/.test(form));
  check('grade Empresas do Usuário com a chave Todas',
    /secao\('Empresas do Usuário'/.test(form) && /name="podeTrocarEstabelecimento"/.test(form) && /class="usuario-empresa"/.test(form));
  check('  o principal sai da lista que vai para o servidor', /estabelecimentosLiberados: \[\.\.\.liberados\]\.filter\(\(id\) => id !== principal\)/.test(form));
  check('exceções: só o que difere do papel', /\.filter\(\(\[slug, efeito\]\) => \(efeito === 'PERMITIR'\) !== doPapel\.has\(slug\)\)/.test(form));
  check('  e só com o RBAC de pé', /if \(comRbac\) \{\s*const doPapel/.test(form));
  check('a ficha espera a tela montar antes de devolver', /await renderSettingsUserForm\(ctx, 'edit'\)/.test(form));
  const css = ler('public/app.css');
  check('as chaves em três colunas, como no Viper', /\.usuario-chaves \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/.test(css));
  check('  que viram uma no celular', /@media \(max-width: 640px\) \{ \.usuario-chaves \{ grid-template-columns: 1fr; \} \}/.test(css));
  check('  e o rótulo fica ao lado da chave, não embaixo', /\.usuario-chave \{[^}]*flex-direction: row/.test(css));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== FICHA DO USUÁRIO OK =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
