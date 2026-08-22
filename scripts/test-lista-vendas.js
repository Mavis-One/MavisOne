// Lista de Pedidos e Orçamentos: colunas, ordenação, paginação e URL.
//
// Passo 3 do módulo Vendas. O que este teste guarda:
//
//   1. o catálogo de colunas é UM só. Cabeçalho, célula e seletor leem da mesma
//      lista — solto no template, alguém acrescenta um <th> e esquece o <td>, e
//      a tabela inteira desanda uma coluna para o lado;
//   2. a lista branca de ordenação do cliente e a do servidor não divergem:
//      oferecer ordenação por coluna que o servidor ignora é clicar e não
//      acontecer nada;
//   3. o servidor serializa ANTES de ordenar e fatia DEPOIS.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const appSrc = ler('public/app.js');
const serverSrc = ler('server.js');

console.log('--- o catálogo de colunas é um só ---');
const catalogo = appSrc.slice(appSrc.indexOf('const SALES_COLUNAS = ['), appSrc.indexOf('const SALES_COLUNAS_PADRAO'));
const chavesCliente = [...catalogo.matchAll(/chave: '([a-zA-Z]+)'/g)].map((m) => m[1]);
check('o catálogo existe', chavesCliente.length > 0, `${chavesCliente.length} colunas`);
// As doze do briefing, mais o Tipo que a tela já tinha.
['code', 'date', 'updatedAt', 'status', 'companyName', 'customer', 'nfeNumero',
  'sellerName', 'clientContact', 'amount', 'dataEnvio', 'saleOrigin'].forEach((c) => {
  check(`  coluna ${c}`, chavesCliente.includes(c));
});
// Cabeçalho e células desenhados pelo catálogo, não escritos à mão.
check('o cabeçalho vem do catálogo', /colunas\.map\(\(col\) => \{[\s\S]{0,400}col\.rotulo/.test(appSrc));
check('e as células também', /colunas\.map\(\(col\) => `<td>\$\{col\.valor\(record,/.test(appSrc));
// Código some da tela = linha sem identificação.
check('a coluna Código é fixa', /chave: 'code'[^}]*fixa: true/.test(catalogo));
check('e o seletor não deixa desmarcá-la', /col\.fixa \? 'checked disabled/.test(appSrc));

console.log('\n--- cliente e servidor concordam sobre o que dá para ordenar ---');
const brancaServidor = new Set([...serverSrc.slice(
  serverSrc.indexOf('const CAMPOS_ORDENAVEIS = {'),
  serverSrc.indexOf('function ordenarSalesRecords')
).matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]));
const ordenaveisCliente = [...catalogo.matchAll(/chave: '([a-zA-Z]+)', rotulo: '[^']*', ordenavel: true/g)].map((m) => m[1]);
console.log(`    servidor aceita: ${[...brancaServidor].sort().join(', ')}`);
const semServidor = ordenaveisCliente.filter((c) => !brancaServidor.has(c));
check('nenhuma coluna oferece ordenação que o servidor ignora', semServidor.length === 0,
  semServidor.length ? 'SEM SUPORTE: ' + semServidor.join(', ') : 'ok');

console.log('\n--- o servidor ordena a lista INTEIRA, não a página ---');
const rota = serverSrc.slice(serverSrc.indexOf("if (view === 'orders_quotes')"), serverSrc.indexOf("if (view === 'nfes')"));
const posSerializa = rota.indexOf('filtered.map((record) => serializeSalesRecord');
const posOrdena = rota.indexOf('ordenarSalesRecords(');
const posFatia = rota.indexOf('.slice(start, start + limit)');
check('serializa antes de ordenar', posOrdena > -1 && posSerializa > posOrdena, `ordena ${posOrdena}, serializa ${posSerializa}`);
// Fatiar antes de ordenar ordena só a página — o clássico "ordenei e mudou só
// um pedaço da lista".
check('e fatia DEPOIS de ordenar', posFatia > posOrdena, `fatia ${posFatia}`);
// Campo vindo da query string sem lista branca é entregar a leitura do objeto
// inteiro a quem chama.
check('o campo de ordenação passa por lista branca', /const ler = CAMPOS_ORDENAVEIS\[campo\];/.test(serverSrc));
check('campo inválido cai na ordem padrão', /if \(!ler\) \{[\s\S]{0,200}Number\(b\.code\)/.test(serverSrc));
// Sem desempate, duas linhas de mesma data trocam de lugar a cada recarga e
// parecem bug de paginação.
check('empate é desempatado pelo código', /Desempate estável pelo código/.test(serverSrc));

console.log('\n--- paginação ---');
check('as opções são 15/30/50/100', /const SALES_POR_PAGINA = \[15, 30, 50, 100\]/.test(appSrc));
check('trocar o tamanho volta para a página 1', /ordersLimit = Number\(evento\.target\.value\)[\s\S]{0,300}ordersPage = 1/.test(appSrc));
check('existe o "ir para página"', /salesIrParaPagina/.test(appSrc));
check('e ele recusa página fora do intervalo', /alvo < 1 \|\| alvo > totalPages/.test(appSrc));
check('o servidor aceita limite até 100', /parsePageParams\(searchParams, defaultLimit = 20, maxLimit = 100\)/.test(serverSrc));

console.log('\n--- URL compartilhável ---');
check('a tela escreve os filtros na URL', /function salesEscreverUrl/.test(appSrc));
check('e lê de volta ao entrar', /function salesLerUrl/.test(appSrc));
// pushState encheria o histórico e o botão Voltar desfaria filtro por filtro.
check('usa replaceState, não pushState', /window\.history\.replaceState/.test(appSrc) && !/window\.history\.pushState/.test(appSrc));
// Ler a URL a cada redesenho desfaria o que a pessoa acabou de mudar.
check('a URL só é lida na primeira entrada', /if \(!draft\.ordersUrlLida\)/.test(appSrc));
check('valor padrão não polui o link', /k === 'page' && Number\(v\) === 1/.test(appSrc));
check('e direção sem coluna também não', /k === 'dir' && !tudo\.sort/.test(appSrc));

console.log('\n--- preferências seguem a PESSOA, não o navegador ---');
check('existe a rota de preferências', /pathname === '\/api\/preferencias'/.test(serverSrc));
check('a gravação preserva as outras telas', /async function updateUserPreference/.test(ler('lib/db/auth.js')));
// Coluna ausente (fase-ag nao rodada) nao pode derrubar login nem tela.
check('coluna ausente degrada em vez de quebrar', /does not exist\|Could not find\|schema cache/.test(ler('lib/db/auth.js')));
check('as preferências chegam junto do usuário', /preferences: user\.preferences && typeof user\.preferences === 'object'/.test(serverSrc));
// Preferencia invalida (coluna renomeada) nao pode desenhar tabela sem colunas.
check('preferência inválida cai no padrão', /const escolhidas = validas\.length \? validas : SALES_COLUNAS_PADRAO/.test(appSrc));

// Login e F5 sao dois caminhos para a mesma coisa, e o bloco estava copiado
// nos dois. So o login preenchia state.preferences: a pessoa escolhia coluna,
// recarregava, e a lista voltava ao padrao. Uma funcao so, chamada pelos dois.
const chamadas = (appSrc.match(/adotarUsuarioDaSessao\(response\.user\)/g) || []).length;
check('login e F5 adotam o usuario pela mesma funcao', chamadas === 2, chamadas + ' chamada(s)');
check('e e ela que preenche as preferencias', /function adotarUsuarioDaSessao[\s\S]{0,400}state\.preferences = \(user && user\.preferences\)/.test(appSrc));

console.log('\n--- a migração da preferência existe ---');
const fase = ler('supabase/migrations/fase-ag-preferencias-do-usuario.sql');
check('fase-ag cria users.preferences', /add column if not exists preferences jsonb/.test(fase));
check('com padrão vazio', /default '\{\}'::jsonb/.test(fase));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
