#!/usr/bin/env node
/**
 * TELAS POR USUÁRIO (fase AN) — o recorte fino dentro de um módulo liberado.
 *
 *   node scripts/test-telas-por-usuario.js
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * Três coisas que quebram em silêncio, cada uma do seu jeito:
 *
 * 1. O FILTRO. `telasVisiveis()` é o único lugar que decide quais telas
 *    aparecem, e ele alimenta cinco consumidores (menu, submenu, favoritos do
 *    Dashboard, Área de Trabalho e a validação da rota salva). Se ele parar de
 *    olhar o bloqueio, nada dá erro: as telas simplesmente voltam a aparecer
 *    para quem não deveria vê-las, e ninguém recebe aviso disso.
 *
 * 2. A IDA E VOLTA PELO BANCO. Um campo jsonb que grava e não lê — ou que lê e
 *    devolve string em vez de objeto — faz o formulário abrir com tudo marcado.
 *    O primeiro salvamento então DESFAZ todos os bloqueios, sem ninguém pedir.
 *
 * 3. O SANEAMENTO. A coluna é jsonb e a rota aceita corpo de fora.
 *
 * A ida e volta usa o banco de verdade e cria um usuário `zz-teste-telas-...`,
 * que é apagado no fim inclusive quando o teste falha.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../lib/db/auth');
const { fecharPool } = require('../lib/db/client');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

let falhas = 0;
const check = (nome, ok, detalhe) => {
  console.log(`  ${ok ? 'OK ' : 'XX '} ${nome}${detalhe !== undefined ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas++;
};

/** Extrai uma função do fonte e a executa de verdade, com o mundo que ela espera. */
function extrairFuncao(fonte, assinatura, escopo = {}) {
  const inicio = fonte.indexOf(assinatura);
  if (inicio === -1) throw new Error(`não achei ${assinatura}`);
  // Fecha na primeira linha que começa com "}" na coluna 0 — a indentação
  // destas funções é de nível de módulo nos dois arquivos.
  const fim = fonte.indexOf('\n}', inicio);
  const corpo = fonte.slice(inicio, fim + 2);
  const nomes = Object.keys(escopo);
  return new Function(...nomes, `${corpo}\nreturn ${assinatura.match(/function (\w+)/)[1]};`)(...nomes.map((n) => escopo[n]));
}

(async () => {
  const appSrc = ler('public/app.js');
  const serverSrc = ler('server.js');

  console.log('--- 1. o filtro que decide o que aparece ---');
  const moduleSubItems = {
    sales: [
      { key: 'orders_quotes', label: 'Pedidos' },
      { key: 'sales_dashboard', label: 'Painel de Vendas' },
      { key: 'seller_dashboard', label: 'Painel do Vendedor', somenteAdmin: true }
    ]
  };
  let usuarioAtual = null;
  const telasVisiveis = extrairFuncao(appSrc, 'function telasVisiveis(moduleName)', {
    moduleSubItems,
    usuarioEhAdmin: () => usuarioAtual?.role === 'admin',
    state: { get user() { return usuarioAtual; } }
  });

  usuarioAtual = { role: 'user', blockedSubs: {} };
  check('sem bloqueio, o usuário comum vê as telas do módulo',
    telasVisiveis('sales').map((t) => t.key).join(',') === 'orders_quotes,sales_dashboard');

  usuarioAtual = { role: 'user', blockedSubs: { sales: ['sales_dashboard'] } };
  check('a tela bloqueada some da lista',
    telasVisiveis('sales').map((t) => t.key).join(',') === 'orders_quotes');

  usuarioAtual = { role: 'user', blockedSubs: { finance: ['conciliacao'] } };
  check('bloqueio de OUTRO módulo não afeta este',
    telasVisiveis('sales').length === 2);

  // Regra da fase AN: módulo sem chave no objeto significa "vê todas". É o que
  // faz tela nova nascer visível em vez de nascer escondida para quem já existe.
  usuarioAtual = { role: 'user' };
  check('usuário anterior à fase AN (sem o campo) vê todas',
    telasVisiveis('sales').length === 2);

  usuarioAtual = { role: 'admin', blockedSubs: { sales: ['orders_quotes'] } };
  check('admin ignora o bloqueio e vê inclusive as telas somenteAdmin',
    telasVisiveis('sales').length === 3);

  // Bloquear TODAS as telas é uma forma legítima de negar o módulo. Sem esta
  // regra o módulo ficaria no menu abrindo uma Área de Trabalho sem um cartão
  // sequer — e tela vazia comunica "quebrou", não "sem acesso".
  const moduloTemTelaVisivel = extrairFuncao(appSrc, 'function moduloTemTelaVisivel(moduleName)', {
    moduleSubItems, telasVisiveis
  });
  usuarioAtual = { role: 'user', blockedSubs: { sales: ['orders_quotes', 'sales_dashboard'] } };
  check('com TODAS as telas bloqueadas, o módulo some do menu', !moduloTemTelaVisivel('sales'));
  usuarioAtual = { role: 'user', blockedSubs: { sales: ['orders_quotes'] } };
  check('com uma tela sobrando, o módulo continua', moduloTemTelaVisivel('sales'));
  check('módulo sem catálogo de telas (Dashboard) não some', moduloTemTelaVisivel('dashboard'));

  console.log('\n--- 2. o saneamento do que chega de fora ---');
  const sanitizar = extrairFuncao(serverSrc, 'function sanitizarTelasBloqueadas(valor)');
  check('objeto normal passa inteiro',
    JSON.stringify(sanitizar({ sales: ['a', 'b'] })) === '{"sales":["a","b"]}');
  check('lista vazia vira módulo ausente ("vê todas")',
    JSON.stringify(sanitizar({ sales: [] })) === '{}');
  check('duplicata não é gravada duas vezes',
    JSON.stringify(sanitizar({ sales: ['a', 'a'] })) === '{"sales":["a"]}');
  check('chave com caractere estranho é descartada',
    JSON.stringify(sanitizar({ 'sales; drop': ['a'] })) === '{}');
  check('valor que não é lista é descartado',
    JSON.stringify(sanitizar({ sales: 'tudo' })) === '{}');
  check('array no lugar do objeto não vira nada',
    JSON.stringify(sanitizar(['sales'])) === '{}');
  check('null e string não derrubam',
    JSON.stringify(sanitizar(null)) === '{}' && JSON.stringify(sanitizar('x')) === '{}');
  const gigante = {};
  for (let i = 0; i < 200; i++) gigante[`m${i}`] = ['a'];
  check('objeto gigante é cortado no teto', Object.keys(sanitizar(gigante)).length <= 40);
  const listaGigante = { sales: Array.from({ length: 500 }, (_, i) => `t${i}`) };
  check('lista gigante é cortada no teto', sanitizar(listaGigante).sales.length <= 100);

  console.log('\n--- 3. a tela pede e a tela mostra ---');
  const formSrc = ler('public/modules/settings/subs/users_form.js');
  const listaSrc = ler('public/modules/settings/subs/users.js');
  check('o formulário grava as telas bloqueadas', /blockedSubs: telasBloqueadas/.test(formSrc));
  check('  e monta a lista a partir do catálogo real de telas', /moduleSubItems\[modulo\]/.test(formSrc));
  check('  ignorando as telas somenteAdmin', /!tela\.somenteAdmin/.test(formSrc));
  check('a lista de usuários mostra quantas telas estão ocultas', /tela\$\{total === 1/.test(listaSrc));
  check('e dá para duplicar os acessos de alguém', /class="copy-user /.test(listaSrc) && /copiarDe: modelo/.test(listaSrc));
  // O vínculo com vendedor diz QUEM a pessoa é, não o que ela pode: duas
  // pessoas apontando para o mesmo vendedor veriam as vendas uma da outra como
  // suas no Meu Painel. A cópia leva acesso, não identidade.
  check('  mas a cópia NÃO leva o vínculo com vendedor', /v\.id === editUser\?\.sellerId/.test(formSrc));
  check('o servidor devolve o campo para a tela de Usuários', /blockedSubs: entry\.blockedSubs/.test(serverSrc));
  check('  e para o usuário logado, que é quem filtra o menu', /blockedSubs: user\.blockedSubs/.test(serverSrc));

  console.log('\n--- 4. a ida e volta pelo banco ---');
  const marca = `zz-teste-telas-${Date.now()}`;
  let criado = null;
  try {
    criado = await db.createUser({
      username: marca, password: 'senha-de-teste-123', name: 'Teste Telas',
      role: 'user', allowedModules: ['sales'],
      blockedSubs: { sales: ['sales_dashboard', 'seller_dashboard'] }
    });
    check('grava na criação', JSON.stringify(criado.blockedSubs) === '{"sales":["sales_dashboard","seller_dashboard"]}',
      JSON.stringify(criado.blockedSubs));

    const lido = await db.getUserById(criado.id);
    check('e volta como OBJETO, não como string',
      lido.blockedSubs && typeof lido.blockedSubs === 'object' && !Array.isArray(lido.blockedSubs));

    await db.updateUser(criado.id, { name: 'Teste Telas', role: 'user', allowedModules: ['sales'], blockedSubs: { sales: ['orders_quotes'] } });
    check('a edição troca o recorte',
      JSON.stringify((await db.getUserById(criado.id)).blockedSubs) === '{"sales":["orders_quotes"]}');

    // Campo AUSENTE não é o mesmo que objeto vazio: uma tela que salve sem
    // mandá-lo (a edição de tema, por exemplo) não pode desfazer bloqueios.
    await db.updateUser(criado.id, { name: 'Outro nome', role: 'user', allowedModules: ['sales'] });
    check('salvar sem o campo NÃO desfaz o recorte',
      JSON.stringify((await db.getUserById(criado.id)).blockedSubs) === '{"sales":["orders_quotes"]}');

    await db.updateUser(criado.id, { name: 'Outro nome', role: 'user', allowedModules: ['sales'], blockedSubs: {} });
    check('e mandar objeto vazio libera todas de volta',
      JSON.stringify((await db.getUserById(criado.id)).blockedSubs) === '{}');
  } finally {
    if (criado) await db.deleteUser(criado.id);
    check('o usuário de teste foi apagado', criado ? !(await db.getUserById(criado.id)) : false);
  }

  console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  await fecharPool();
  process.exit(falhas ? 1 : 0);
})().catch(async (erro) => {
  console.error(erro);
  try { await fecharPool(); } catch { /* já fechado */ }
  process.exit(1);
});
