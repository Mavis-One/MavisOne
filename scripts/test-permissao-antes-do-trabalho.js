// A ROTA PERGUNTA QUEM ANTES DE IR AO BANCO — ou, pelo menos, não piora.
//
// `getCurrentUser` custa ~1 ms: é uma linha da tabela `sessoes`. Toda ida ao
// banco feita ANTES dela é trabalho que um pedido SEM TOKEN — ou de alguém sem
// permissão para aquela tela — consegue fazer o servidor gastar.
//
// O QUE ISSO CUSTAVA, MEDIDO
// --------------------------
//   /api/dashboard ........... 202 ms de banco antes do 401 (fase DH)
//   /api/reports/vendas ...... `select *` dos 14.864 pedidos, 321 ms, antes do
//                              403 de quem não vê Relatórios (fase DJ)
//   /api/sales/records ....... o mesmo, antes do 403 de quem não vê Vendas
//
// Não é só lentidão: é um jeito barato de fazer o servidor trabalhar sem
// credencial nenhuma, na rota mais fácil de descobrir — a que a tela inicial
// chama.
//
// POR QUE UMA LINHA DE BASE, E NÃO "CONSERTE TODAS"
// ------------------------------------------------
// A varredura achou 48 rotas assim. Três foram corrigidas (as três acima);
// mexer nas outras 45 de uma vez seria um diff mecânico enorme em rotas que eu
// não exercitei, e cada uma precisa de atenção própria: algumas montam `data`
// antes por razões que só se veem lendo.
//
// Então este guarda faz o que `test-sync-obrigatorio.js` faz com o mesmo tipo
// de dívida: congela o que existe e proíbe crescer. Rota NOVA com o defeito
// reprova. E rota da lista que for consertada TAMBÉM reprova, até ser removida
// daqui — assim a lista só encolhe, e ninguém a usa como permissão.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const { semComentarios } = require('./sem-comentarios');
const limpo = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// O que conta como ir ao banco. Não inclui `loadData()`: ele lê um db.json de
// 9 KB do disco, que não é o custo de que se trata aqui.
const IDA_AO_BANCO = new RegExp([
  'syncCadastroData', 'syncSalesData', 'syncSalesDataParaAgregado',
  'syncSalesDataResumida', 'syncSalesDataDaPagina', 'syncPurchasesData',
  'syncNfeData', 'syncFinanceData', 'sincronizarRazao', 'loadStockContext',
  'db\\.get[A-Z]\\w*', 'fiscalDb\\.get[A-Z]\\w*', 'metasDb\\.\\w+', 'banco\\.from\\('
].join('|'));

// Cada `if (... pathname ...)` de dois espaços abre uma rota e fecha a anterior.
// O filtro por `pathname` é o que mantém fora um `if` qualquer de dentro de uma
// função — sem ele, o validador de CPF entrava na lista como se fosse rota.
function rotasDoServidor() {
  const marcas = [...limpo.matchAll(/^ {2}if \([^\n]*\n/gm)].filter((m) => /pathname/.test(m[0]));
  return marcas.map((m, i) => {
    const ini = m.index;
    const fim = i + 1 < marcas.length ? marcas[i + 1].index : limpo.length;
    const cabecalho = m[0];
    // Um nome ESTÁVEL. Rota por regex não tem caminho literal, então usa-se a
    // fonte do regex; rota por prefixo, o prefixo.
    const literal = (cabecalho.match(/pathname === '([^']+)'/) || [])[1];
    const porRegex = (cabecalho.match(/(\/\^[^\n]*?\/)\.test\(pathname\)/) || [])[1];
    const porPrefixo = (cabecalho.match(/pathname\.startsWith\('([^']+)'\)/) || [])[1];
    const corpo = limpo.slice(ini, fim);
    const metodo = (cabecalho.match(/req\.method === '(\w+)'/) || [])[1]
      || (corpo.slice(0, 300).match(/req\.method === '(\w+)'/) || [])[1]
      || '*';
    const nome = literal || porRegex || (porPrefixo ? `${porPrefixo}*` : cabecalho.trim().slice(0, 60));
    return { nome: `${nome} ${metodo}`, corpo, linha: limpo.slice(0, ini).split('\n').length };
  });
}

const culpadas = rotasDoServidor()
  .filter((r) => {
    const posUsuario = r.corpo.search(/await getCurrentUser\(req\)/);
    // Rota sem sessão nenhuma é outro assunto (login, health, webhook).
    if (posUsuario < 0) return false;
    return IDA_AO_BANCO.test(r.corpo.slice(0, posUsuario));
  })
  .map((r) => r.nome)
  .sort();

console.log(`--- rotas que vão ao banco antes de saber quem pergunta: ${culpadas.length} ---`);

// A LISTA CONGELADA. Cada linha é dívida conhecida, não permissão.
const BASE = [
  "/^\\/api\\/finance\\/bank-transactions\\/[^/]+\\/conciliar$/ POST",
  "/^\\/api\\/finance\\/bank-transactions\\/[^/]+\\/desconciliar$/ POST",
  "/^\\/api\\/finance\\/bank-transactions\\/[^/]+\\/matches$/ GET",
  "/^\\/api\\/finance\\/entries\\/[^/]+\\/cancelar$/ POST",
  "/^\\/api\\/finance\\/entries\\/[^/]+\\/estorno$/ POST",
  "/^\\/api\\/finance\\/entries\\/[^/]+\\/payments$/ POST",
  "/^\\/api\\/finance\\/nfe\\/[^/]+\\/cancelar$/ POST",
  "/api/cadastros/cnpjs POST",
  "/api/cadastros/cnpjs/* PUT",
  "/api/cadastros/meta GET",
  "/api/cadastros/pessoas POST",
  "/api/cadastros/pessoas/* PUT",
  "/api/dashboard/charts GET",
  "/api/finance POST",
  "/api/finance/bank-accounts POST",
  "/api/finance/bank-transactions GET",
  "/api/finance/bank-transactions POST",
  "/api/finance/categories POST",
  "/api/finance/cost-centers POST",
  "/api/finance/entries GET",
  "/api/finance/entries POST",
  "/api/finance/entries/* GET",
  "/api/finance/entries/* PUT",
  "/api/finance/meta GET",
  "/api/finance/nfe GET",
  "/api/finance/nfe POST",
  "/api/finance/nfe/* GET",
  "/api/finance/summary GET",
  "/api/purchases GET",
  "/api/purchases POST",
  "/api/purchases/* PUT",
  "/api/purchases/documentos GET",
  "/api/purchases/documentos POST",
  "/api/purchases/documentos/* POST",
  "/api/purchases/documentos/* PUT",
  "/api/sales POST",
  "/api/sales/dashboard GET",
  "/api/sales/import POST",
  "/api/sales/meta GET",
  "/api/sales/meu-painel GET",
  "/api/sales/records POST",
  "/api/sales/records/* DELETE",
  "/api/sales/records/* GET",
  "/api/sales/records/* PUT",
  "/api/sales/records/lote POST",
  "/api/sales/tributos POST"
];

const conhecidas = new Set(BASE);
const novas = culpadas.filter((r) => !conhecidas.has(r));
check('nenhuma rota NOVA trabalha antes de conferir a sessão', novas.length === 0,
  novas.length ? novas.join(' | ') : `${culpadas.length} conhecidas`);

// A lista só encolhe. Entrada que não corresponde mais a uma rota culpada saiu
// por conserto (ótimo) ou por renomeação (e aí a base está mentindo).
const atual = new Set(culpadas);
const obsoletas = BASE.filter((r) => !atual.has(r));
check('  e a linha de base não tem entrada obsoleta', obsoletas.length === 0,
  obsoletas.length ? 'CONSERTADA OU RENOMEADA, tire daqui: ' + obsoletas.join(' | ') : `${BASE.length} em uso`);

console.log('\n--- e as três que JÁ foram consertadas não podem regredir ---');
// Estas eram as mais caras da varredura, e agora perguntam primeiro. O check é
// por POSIÇÃO: a sessão antes da primeira ida ao banco.
const CONSERTADAS = [
  ["if (pathname === '/api/dashboard') {", "if (pathname === '/api/dashboard/atencao'", 'Painel'],
  ["if (pathname === '/api/sales/records' && req.method === 'GET') {", "if (pathname === '/api/sales/records' && req.method === 'POST')", 'lista de Vendas']
];
for (const [inicio, fim, rotulo] of CONSERTADAS) {
  const a = limpo.indexOf(inicio);
  const b = limpo.indexOf(fim, a);
  const corpo = a > -1 && b > a ? limpo.slice(a, b) : '';
  const posUsuario = corpo.search(/await getCurrentUser\(req\)/);
  const posIda = corpo.search(IDA_AO_BANCO);
  check(`${rotulo}: sessão antes da primeira ida ao banco`,
    corpo.length > 200 && posUsuario > -1 && (posIda === -1 || posUsuario < posIda),
    `sessão ${posUsuario}, banco ${posIda}`);
}
// O relatório de vendas mora num helper, não numa rota — por isso é conferido
// pelo nome da função.
const relatorio = limpo.slice(
  limpo.indexOf('async function montarRelatorioDeVendas'),
  limpo.indexOf('async function baseDosRelatoriosGerais') > limpo.indexOf('async function montarRelatorioDeVendas')
    ? limpo.indexOf('async function baseDosRelatoriosGerais')
    : limpo.indexOf('async function montarRelatorioDeVendas') + 4000
);
const posU = relatorio.search(/await getCurrentUser\(req\)/);
const posB = relatorio.search(IDA_AO_BANCO);
check('Relatório de Vendas: sessão E permissão antes dos syncs',
  posU > -1 && (posB === -1 || posU < posB), `sessão ${posU}, banco ${posB}`);
check('  e a permissão também vem antes',
  relatorio.indexOf('podeVerRelatorios') < (posB === -1 ? Infinity : posB),
  'quem não vê Relatórios não paga o select * dos 14.864');

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
