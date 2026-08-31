#!/usr/bin/env node
// MEU PAINEL — "minhas vendas" tem que ser MINHAS, provado sem subir nada.
//
// O QUE ESTE TESTE ESTÁ REALMENTE GUARDANDO
// -----------------------------------------
// Não é "o filtro funciona". É que não existe caminho — parâmetro forjado,
// papel de administrador, período esquisito, sessão antiga — que faça o painel
// pessoal de alguém mostrar a venda de outra pessoa.
//
// O caso 2 é o que separa este arquivo de uma cópia do teste do Relatório: lá,
// administrador ver TUDO é o comportamento correto. Aqui é um defeito, e um
// defeito silencioso — o painel do dono da empresa simplesmente somaria as
// vendas do time inteiro como se fossem dele, e ninguém abriria um chamado
// dizendo "meu número está alto demais".
//
// Roda sem servidor e sem banco: a regra mora em duas funções puras.
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const escopoLib = require('../lib/relatorios-escopo');
const painel = require('../lib/painel-pessoal-vendas');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK ' : 'XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ---------------------------------------------------------------- o cenário
// Dois vendedores do Cadastros (pessoas) e quatro logins. O admin tem vínculo
// com o Eduardo de propósito: é assim que se prova que o painel dele mostra as
// vendas DELE, e não as do Michael por tabela.
const EDUARDO = 'p-eduardo';
const MICHAEL = 'p-michael';

const uAdminVendedor = { id: 'u-admin', name: 'Admin', role: 'admin', active: true, sellerId: EDUARDO };
const uAdminSemVinculo = { id: 'u-dono', name: 'Dono', role: 'admin', active: true, sellerId: '' };
const uEduardo = { id: 'u-edu', name: 'Eduardo', role: 'user', active: true, sellerId: EDUARDO };
const uMichael = { id: 'u-mic', name: 'Michael', role: 'user', active: true, sellerId: MICHAEL };
const uSemVinculo = { id: 'u-novo', name: 'Recém-chegado', role: 'user', active: true, sellerId: '' };
const uBloqueado = { id: 'u-ex', name: 'Ex-funcionário', role: 'user', active: false, sellerId: EDUARDO };

const pedido = (id, code, sellerId, cliente, valor, extra = {}) => ({
  id, code, type: 'order', customer: cliente, sellerId,
  status: 'pedido-faturado', date: '2026-08-20', amount: valor, ...extra
});

const REGISTROS = [
  pedido('o1', '1025', EDUARDO, 'Cliente A', 500, { nfeId: 'nf-1', nfeNumero: '1042' }),
  pedido('o2', '1027', EDUARDO, 'Cliente C', 300, { date: '2026-07-05' }),
  pedido('o3', '1026', MICHAEL, 'Cliente B', 700, { nfeId: 'nf-2', nfeNumero: '1043' }),
  // Cancelado do Eduardo: continua sendo um fato, aparece na tabela, não soma.
  pedido('o4', '1028', EDUARDO, 'Cliente A', 900, { status: 'pedido-cancelado' }),
  // Orçamento do Eduardo: proposta, não venda realizada.
  { id: 'q1', code: '9', type: 'quote', customer: 'Cliente D', sellerId: EDUARDO, status: 'orcamento', date: '2026-08-21', amount: 400 }
];

const montar = (usuario, filtros = {}) =>
  painel.montarPainel({ registros: REGISTROS, escopo: escopoLib.escopoPessoal(usuario), filtros });

// ---------------------------------------------------------------------------
console.log('\n--- 1. o vendedor vê as próprias vendas, e só elas ---');
const doEduardo = montar(uEduardo);
check('a tabela traz os pedidos do Eduardo',
  doEduardo.vendas.map((v) => v.pedido).sort().join(',') === '1025,1027,1028',
  doEduardo.vendas.map((v) => v.pedido).join(','));
check('o pedido do Michael não está na tabela',
  !doEduardo.vendas.some((v) => v.pedido === '1026'));
check('  nem o cliente dele aparece em lugar nenhum da resposta',
  !JSON.stringify(doEduardo).includes('Cliente B'));
check('os cards somam só os ativos do Eduardo (500 + 300)',
  doEduardo.indicadores.valorTotal === 800, String(doEduardo.indicadores.valorTotal));

const doMichael = montar(uMichael);
check('e o Michael vê os dele, sem tocar nos do Eduardo',
  doMichael.vendas.map((v) => v.pedido).join(',') === '1026', doMichael.vendas.map((v) => v.pedido).join(','));
check('  os dois conjuntos não têm um pedido em comum',
  !doEduardo.vendas.some((v) => doMichael.vendas.some((m) => m.id === v.id)));

// ---------------------------------------------------------------------------
console.log('\n--- 2. ADMINISTRADOR NÃO VIRA "TODAS AS VENDAS" AQUI ---');
// Este é o caso que motivou escopoPessoal existir separado de escopoDeVendas.
const escopoRelatorio = escopoLib.escopoDeVendas(uAdminVendedor, { ehAdmin: true });
check('no Relatório, o admin é irrestrito (sellerIds null) — e está certo',
  escopoRelatorio.sellerIds === null, JSON.stringify(escopoRelatorio.sellerIds));

const escopoDoPainel = escopoLib.escopoPessoal(uAdminVendedor);
check('no Meu Painel, o mesmo admin fica restrito ao vínculo dele',
  Array.isArray(escopoDoPainel.sellerIds) && escopoDoPainel.sellerIds.join(',') === EDUARDO,
  JSON.stringify(escopoDoPainel.sellerIds));

const doAdmin = montar(uAdminVendedor);
check('o painel do admin mostra as vendas DELE, não as do time',
  doAdmin.vendas.map((v) => v.pedido).sort().join(',') === '1025,1027,1028',
  doAdmin.vendas.map((v) => v.pedido).join(','));
check('  e o total dele não engorda com os R$ 700 do Michael',
  doAdmin.indicadores.valorTotal === 800, String(doAdmin.indicadores.valorTotal));

// A garantia estrutural, e não caso a caso: NENHUM perfil consegue arrancar
// desta função o valor que significa "sem restrição".
console.log('\n--- 3. escopoPessoal NUNCA devolve "sem restrição" ---');
const PERFIS = [uAdminVendedor, uAdminSemVinculo, uEduardo, uMichael, uSemVinculo, uBloqueado,
  { id: 'x', active: true, role: 'admin', sellerId: null },
  { id: 'y', active: true, role: 'admin', sellerId: '   ' },
  { id: 'z', active: true, role: 'superadmin', roles: ['admin'], sellerId: undefined },
  null, undefined, {}];
const vazou = PERFIS.filter((p) => escopoLib.escopoPessoal(p).sellerIds === null);
check('nenhum dos 12 perfis testados devolve sellerIds null', vazou.length === 0, `${vazou.length} vazaram`);
check('  e todos devolvem uma lista de verdade',
  PERFIS.every((p) => Array.isArray(escopoLib.escopoPessoal(p).sellerIds)));

// ---------------------------------------------------------------------------
console.log('\n--- 4. sem vínculo é ZERO, e com o motivo na tela ---');
const semVinculo = montar(uSemVinculo);
check('nenhuma venda', semVinculo.vendas.length === 0);
check('nenhum valor', semVinculo.indicadores.valorTotal === 0);
check('temAcesso é falso', semVinculo.escopo.temAcesso === false);
check('e o motivo explica o que fazer', /vincul/i.test(semVinculo.escopo.motivo), semVinculo.escopo.motivo);

const donoSemVinculo = montar(uAdminSemVinculo);
check('ADMIN sem vínculo cai no mesmo lugar (não no ramo "sem filtro")',
  donoSemVinculo.vendas.length === 0 && donoSemVinculo.escopo.temAcesso === false);

const bloqueado = montar(uBloqueado);
check('usuário bloqueado não vê nada, mesmo com vínculo válido',
  bloqueado.vendas.length === 0 && bloqueado.escopo.temAcesso === false);

// ---------------------------------------------------------------------------
console.log('\n--- 5. parâmetro forjado não muda nada ---');
// O painel só recebe período. Estes filtros são exatamente o que alguém tentaria
// enfiar na query string — se um dia forem lidos por descuido, o teste cai.
const FORJADOS = [
  { vendedorId: MICHAEL },
  { sellerId: MICHAEL },
  { sellerIds: [MICHAEL, EDUARDO] },
  { vendedorId: 'todos' },
  { vendedorId: '' },
  { escopo: { sellerIds: null } },
  { dataDe: '', dataAte: '', vendedorId: MICHAEL }
];
FORJADOS.forEach((f, i) => {
  const r = montar(uEduardo, f);
  check(`  forjado ${i + 1} devolve os mesmos 3 pedidos do Eduardo`,
    r.vendas.map((v) => v.pedido).sort().join(',') === '1025,1027,1028',
    r.vendas.map((v) => v.pedido).join(','));
});

// E a prova de que a ROTA também não os lê: o corpo dela só passa período.
const servidor = ler('server.js').replace(/\r\n/g, '\n');
const rota = servidor.slice(servidor.indexOf("pathname === '/api/sales/meu-painel'"));
const corpoDaRota = rota.slice(0, rota.indexOf('\n  if (pathname'));
check('a rota existe', corpoDaRota.length > 0);
check('a rota monta o escopo a partir do USUÁRIO, não da query',
  /escopoLib\.escopoPessoal\(user\)/.test(corpoDaRota));
check('a rota não lê vendedor nenhum da query string',
  !/searchParams\.get\('(vendedorId|sellerId|vendedor)'\)/.test(corpoDaRota));
check('a rota só lê dataDe e dataAte',
  [...corpoDaRota.matchAll(/searchParams\.get\('([^']+)'\)/g)].map((m) => m[1]).sort().join(',') === 'dataAte,dataDe',
  [...corpoDaRota.matchAll(/searchParams\.get\('([^']+)'\)/g)].map((m) => m[1]).join(','));
check('e exige acesso ao módulo Vendas', /allowedModules\.includes\('sales'\)/.test(corpoDaRota));

// A tela, do outro lado, também não manda vendedor — não porque seja a defesa,
// mas porque mandar e ser ignorado confundiria quem for ler o código depois.
const tela = ler('public/app.js').replace(/\r\n/g, '\n');
const blocoTela = tela.slice(tela.indexOf("if (sub === 'my_panel')"), tela.indexOf("// Sub-aba: Painel Vendas"));
check('a tela existe', blocoTela.length > 0);
check('a tela não manda vendedorId', !/vendedorId|sellerId/.test(blocoTela));

// ---------------------------------------------------------------------------
console.log('\n--- 6. a tabela é PEDIDO / CLIENTE / NF-e, e a NF-e vem do pedido ---');
const linha = doEduardo.vendas.find((v) => v.pedido === '1025');
check('pedido', linha.pedido === '1025');
check('cliente', linha.cliente === 'Cliente A', linha.cliente);
check('número da NF-e do pedido', linha.nfeNumero === '1042', linha.nfeNumero);
check('  e o id da nota vai junto, para a tela abrir a nota', linha.nfeId === 'nf-1');
check('temNota', linha.temNota === true);

const semNota = doEduardo.vendas.find((v) => v.pedido === '1027');
check('pedido sem nota vem com número VAZIO, não "0" nem "-"',
  semNota.nfeNumero === '' && semNota.temNota === false, JSON.stringify(semNota.nfeNumero));
check('os cards contam certo quem tem nota',
  doEduardo.indicadores.comNota === 1 && doEduardo.indicadores.semNota === 1,
  `com ${doEduardo.indicadores.comNota}, sem ${doEduardo.indicadores.semNota}`);

// Sem syncNfeData a coluna NF-e sai em branco em toda linha, e sem erro nenhum.
// Sem `await` colado no nome: os syncs da rota passaram a ir juntos num
// Promise.all (uma ida ao banco em vez de três em fila, ver o comentário lá).
// O que importa aqui é que a rota CARREGUE as notas antes de montar o painel,
// não a forma como ela espera por elas — cobrar a forma faria este teste cair a
// cada ajuste de desempenho que não muda comportamento nenhum.
check('a rota sincroniza as notas antes de montar (senão a coluna sai vazia)',
  /syncNfeData\(data\)/.test(corpoDaRota));

// ---------------------------------------------------------------------------
console.log('\n--- 7. orçamento não é venda realizada ---');
check('o orçamento do Eduardo não entra na tabela',
  !doEduardo.vendas.some((v) => v.id === 'q1'));
check('  nem nos R$ 400 dele no total', doEduardo.indicadores.valorTotal === 800);

// ---------------------------------------------------------------------------
console.log('\n--- 8. cancelado aparece e não soma, e os dois lados fecham ---');
const cancelado = doEduardo.vendas.find((v) => v.pedido === '1028');
check('o cancelado está NA TABELA', Boolean(cancelado));
check('  marcado como cancelado', cancelado.cancelado === true);
check('não entra em "meus pedidos"', doEduardo.indicadores.pedidos === 2, String(doEduardo.indicadores.pedidos));
check('não entra no total', doEduardo.indicadores.valorTotal === 800);
check('tem card próprio, com o valor', doEduardo.indicadores.cancelados === 1 && doEduardo.indicadores.valorCancelado === 900);

// A reconciliação prometida no cabeçalho da lib: card + card = coluna.
const somaDaTabela = doEduardo.vendas.reduce((s, v) => s + v.valor, 0);
check('ativos + cancelados = soma da coluna Valor',
  doEduardo.indicadores.valorTotal + doEduardo.indicadores.valorCancelado === somaDaTabela,
  `${doEduardo.indicadores.valorTotal} + ${doEduardo.indicadores.valorCancelado} = ${somaDaTabela}`);
check('ticket médio usa só os ativos (800 / 2)', doEduardo.indicadores.ticketMedio === 400,
  String(doEduardo.indicadores.ticketMedio));

// ---------------------------------------------------------------------------
console.log('\n--- 9. o período filtra, e continua sem vazar ---');
const agosto = montar(uEduardo, { dataDe: '2026-08-01', dataAte: '2026-08-31' });
check('julho fica de fora', !agosto.vendas.some((v) => v.pedido === '1027'));
check('agosto entra', agosto.vendas.map((v) => v.pedido).sort().join(',') === '1025,1028');
check('o total acompanha o recorte', agosto.indicadores.valorTotal === 500, String(agosto.indicadores.valorTotal));

const soAte = montar(uEduardo, { dataAte: '2026-07-31' });
check('só "até" funciona como limite aberto à esquerda',
  soAte.vendas.map((v) => v.pedido).join(',') === '1027', soAte.vendas.map((v) => v.pedido).join(','));

// Um período largo NÃO é uma porta: continua sem o pedido do Michael.
const tudo = montar(uEduardo, { dataDe: '1900-01-01', dataAte: '2999-12-31' });
check('período de cem anos não traz a venda do colega',
  !tudo.vendas.some((v) => v.pedido === '1026'), tudo.vendas.map((v) => v.pedido).join(','));

// ---------------------------------------------------------------------------
console.log('\n--- 10. ordem e formato ---');
check('mais recente primeiro', doEduardo.vendas[0].pedido === '1028', doEduardo.vendas[0].pedido);
check('a data sai como AAAA-MM-DD, sem hora', /^\d{4}-\d{2}-\d{2}$/.test(doEduardo.vendas[0].data));
check('a última venda ignora os cancelados',
  doEduardo.indicadores.ultimaVenda === '2026-08-20', doEduardo.indicadores.ultimaVenda);
check('sem vendas, ultimaVenda é vazio e não uma data de mentira',
  montar(uSemVinculo).indicadores.ultimaVenda === '');

// ---------------------------------------------------------------------------
console.log('\n--- 11. a tela está registrada nos quatro lugares ---');
// moduleSubItems é a fonte única (menu, submenu, favoritos, Área de Trabalho):
// tela que não está lá simplesmente não existe para o usuário.
check('my_panel está no moduleSubItems de Vendas',
  /\{ key: 'my_panel', label: '[^']+'/.test(tela));
check('  com um rótulo que o ícone de painel reconhece',
  /\{ key: 'my_panel', label: '(?=[^']*[Pp]ainel)[^']+'/.test(tela));

// ---------------------------------------------------------------------------
console.log('\n--- 12. o Painel Vendedor também é privado por vendedor ---');
// O Meu Painel nasceu com rota própria justamente porque /api/sales/dashboard
// entregava `bySeller` com o time inteiro. Isso deixou de valer em 26/08/2026:
// aquela rota passou a recortar pelo escopo antes de responder, senão o
// vendedor comum abria o Painel Vendedor, escolhia o colega no seletor e lia a
// lista de pedidos dele — cliente, valor e data. A tela mostrava um; a resposta
// trazia todos, e tela não é controle de acesso.
//
// Estes checks leem o FONTE porque a função mora no server.js e não dá para
// chamá-la sem subir o servidor. A prova de comportamento, com dois logins de
// verdade, está em scripts/prova-meu-painel.js.
const assinatura = servidor.match(/function buildSalesDashboardSummary\(([^)]*)\)/);
check('buildSalesDashboardSummary recebe o escopo',
  Boolean(assinatura) && /escopo/.test(assinatura[1]),
  assinatura ? assinatura[1] : 'função não encontrada');

// A ausência do escopo tem que ser ERRO, e não "mostra tudo": deixar o
// parâmetro opcional com queda para "sem filtro" reproduz o vazamento na
// primeira rota nova que esquecer de passá-lo.
const doResumo = servidor.slice(servidor.indexOf('function buildSalesDashboardSummary('));
const corpoResumo = doResumo.slice(0, doResumo.indexOf('\nfunction '));
check('  e QUEBRA se ele não vier (falha fechado)',
  /if \(!escopo\)[\s\S]{0,240}throw new Error/.test(corpoResumo));
check('  os pedidos são filtrados por vendaVisivel',
  /escopoLib\.vendaVisivel\(escopo, record\.sellerId\)/.test(corpoResumo));
check('  e a LISTA DE VENDEDORES também (senão o seletor vaza os nomes do time)',
  /getSellersDirectory\(data\)[\s\S]{0,120}vendaVisivel\(escopo, seller\.id\)/.test(corpoResumo));

// Nenhum chamador pode ter ficado para trás: um só já reabre o vazamento.
//
// Sem tirar os comentários antes, o próprio cabeçalho da função entrava na
// conta: ele cita a forma ANTIGA — buildSalesDashboardSummary(data), sem
// escopo — justamente para explicar o que mudou, e o teste acusava um chamador
// desprotegido que não existe. Comentário não chama função nenhuma.
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const codigoServidor = semComentarios(servidor);
const chamadas = [...codigoServidor.matchAll(/buildSalesDashboardSummary\(data([^)]*)\)/g)].map((m) => m[1].trim());
check(`os ${chamadas.length} chamadores passam um escopo`,
  chamadas.length > 0 && chamadas.every((arg) => arg.startsWith(',') && /escopo/i.test(arg)),
  chamadas.map((a) => a.slice(0, 36) || '(SEM ARGUMENTO)').join(' | '));

// Aqui é escopoDeVendas, e NÃO escopoPessoal: o gestor precisa continuar vendo
// o time inteiro nesta tela. Trocar um pelo outro fecharia o Painel Vendedor
// para o administrador também — o oposto do que se quer, e que passaria
// despercebido por parecer "mais seguro".
const rotaDash = servidor.slice(servidor.indexOf("pathname === '/api/sales/dashboard'"));
const corpoDash = rotaDash.slice(0, rotaDash.indexOf('\n  if (pathname'));
// Sem comentários pelo mesmo motivo de cima: a fatia da rota alcança o
// cabeçalho da rota SEGUINTE (/api/sales/meu-painel), que cita escopoPessoal
// para explicar a diferença entre as duas — e o teste lia isso como se a rota
// errada estivesse sendo usada aqui.
const codigoDash = semComentarios(corpoDash);
check('a rota usa escopoDeVendas (o gestor vê todos), não escopoPessoal',
  /escopoLib\.escopoDeVendas\(user/.test(codigoDash) && !/escopoPessoal/.test(codigoDash));
check('  e manda o escopo para a tela saber se desenha o seletor',
  /podeEscolherVendedor: escopo\.podeEscolherVendedor/.test(corpoDash));
check('a tela só desenha o seletor para quem pode escolher vendedor',
  /!escopo\.podeEscolherVendedor \?[\s\S]{0,500}<select id="sellerDashboardSelect">/.test(tela));

// O Dashboard Geral e o Relatório leem o mesmo resumo. Se um deles ficasse sem
// escopo, o vendedor veria o faturamento da empresa num card e o dele em outro
// — e o número maior seria justamente o que ele não deveria ver.
check('o Dashboard Geral passa escopo no cartão de vendas',
  /salesSummary = canSales[\s\S]{0,400}escopoDeVendas\(user/.test(servidor));
check('o Relatório passa escopo no bloco de vendedores',
  /const vendas = buildSalesDashboardSummary\(data, escopoVendas\)/.test(servidor));


// ---------------------------------------------------------------------------
console.log('\n--- 13. o Painel Vendedor é tela de gestor, e some do menu ---');
// Recortar a resposta não bastou: o vendedor comum continuava com a tela no
// menu, abria, via um seletor com um nome só e ficava com cara de defeito. A
// tela saiu de vista para quem não é administrador — e a saída tem que valer
// nos CINCO lugares que leem o catálogo, porque o que sobrar vira o caminho.
check('seller_dashboard está marcado como somenteAdmin',
  /\{ key: 'seller_dashboard'[^}]*somenteAdmin: true/.test(tela));
check('  e o Meu Painel NÃO está (é a tela do vendedor comum)',
  /\{ key: 'my_panel'[^}]*\}/.test(tela) && !/\{ key: 'my_panel'[^}]*somenteAdmin/.test(tela));
check('existe UMA função que filtra o catálogo por usuário',
  /function telasVisiveis\(moduleName\)/.test(tela));
check('  e ela devolve tudo para o administrador',
  /function telasVisiveis[\s\S]{0,300}if \(usuarioEhAdmin\(\)\) return todas;/.test(tela));
check('  e tira as somenteAdmin dos demais',
  /function telasVisiveis[\s\S]{0,400}filter\(\(item\) => !item\.somenteAdmin\)/.test(tela));

// A ARMADILHA QUE JÁ ESTOUROU A PILHA UMA VEZ.
//
// A função nasceu chamada `telasDoModulo` — nome que module_workspace.js já
// usava para a helper dele. As duas são declarações globais: o workspace carrega
// antes, o app.js declara depois e sobrescreve, e a helper do workspace passou
// a chamar a si mesma. "Maximum call stack size exceeded" ao abrir a Área de
// Trabalho, e nada no código de nenhum dos dois arquivos parecendo errado.
const fonteWorkspace = ler('public/modules/shared/module_workspace.js');
check('e ela NÃO tem o nome de nenhuma função global de outro arquivo',
  !/function telasVisiveis/.test(fonteWorkspace),
  'module_workspace.js declara telasDoModulo, que é outro nome');

// usuarioEhAdmin tem que aceitar as DUAS formas de ser admin. Quem foi
// promovido só em Papéis e Permissões chega com role='user' e um papel 'admin'
// em `roles` — checar apenas `role` esconderia o Painel Vendedor do gestor.
check('usuarioEhAdmin reconhece admin pelo papel novo também',
  /function usuarioEhAdmin[\s\S]{0,300}roles\)\s*&&\s*state\.user\.roles\.includes\('admin'\)/.test(tela));

// Os consumidores. Cada um destes é um caminho até a tela; o que ficar lendo o
// catálogo cru continua exibindo o item para quem não pode abri-lo.
const consumidores = [
  ['submenu lateral', /telasVisiveis\(module\)\.map/],
  ['barra secundária', /const itens = telasVisiveis\(moduleName\)/],
  ['validação da rota salva', /telasVisiveis\('sales'\)\.some/]
];
consumidores.forEach(([nome, regex]) => check(`  ${nome} usa a lista filtrada`, regex.test(tela)));
check('  favoritos do Dashboard usam a lista filtrada',
  /telasVisiveis\(moduleKey\)/.test(ler('public/modules/dashboard/index.js')));
// Aqui o check tem que ser pela DELEGAÇÃO, e não pelo nome: a helper do
// workspace se chama telasDoModulo há muito tempo, então procurar esse nome
// passaria verde mesmo se ela tivesse voltado a ler o catálogo cru.
check('  Área de Trabalho delega para a lista filtrada',
  /function telasDoModulo\(moduleName\)[\s\S]{0,200}return telasVisiveis\(moduleName\)/.test(fonteWorkspace));

// A rota salva no navegador é a porta que sobra: a sessão que já esteve nesta
// tela como administrador volta apontando para cá depois de trocar de usuário.
// Esconder link nunca fechou porta nenhuma.
check('o render recusa a tela para quem não é admin',
  /sub === 'seller_dashboard'\)[\s\S]{0,900}if \(!usuarioEhAdmin\(\)\)[\s\S]{0,900}return;/.test(tela));
check('  e oferece o Meu Painel no lugar, em vez de só barrar',
  /sub === 'seller_dashboard'\)[\s\S]{0,900}activeSub='my_panel'/.test(tela));


console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
