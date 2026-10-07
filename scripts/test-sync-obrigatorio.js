#!/usr/bin/env node
/**
 * NENHUMA ROTA CONSOME COLEÇÃO DO POSTGRES SEM SINCRONIZAR (fase BC).
 *
 * A CLASSE DE BUG QUE ISTO PEGA
 * ------------------------------
 * O sistema está migrando coleções do data/db.json para o Postgres. O Set
 * NAO_PERSISTIR (server.js) lista as que já foram: `saveData` as remove antes
 * de gravar, e `loadData` as devolve VAZIAS. Quem quiser lê-las precisa chamar
 * antes o `sync*Data` correspondente.
 *
 * Quem esquece não recebe erro. Recebe uma lista vazia — e responde HTTP 200
 * com o total zerado, o select sem opção, o filtro sem resultado, a validação
 * que sempre aprova. Foi assim que, ao mesmo tempo:
 *
 *   - o dashboard do Financeiro mostrava R$ 0,00 enquanto a lista de
 *     lançamentos, na mesma sessão, mostrava os títulos;
 *   - `/api/cadastros/meta` devolvia directory: 0, deposits: 0, users: 0, e
 *     cadastrar um contato para um cliente REAL dava 404;
 *   - um depósito com movimentação no razão foi EXCLUÍDO com success: true.
 *
 * COMO ELE MEDE
 * -------------
 * Fecho transitivo: para cada rota, segue as funções que ela chama e junta o
 * que essas funções consomem. É preciso ir além do corpo da rota porque os bugs
 * reais estavam nos helpers — buildFinanceDashboardSummary, directory,
 * serializeSalesRecord — e não no `if` da rota.
 *
 * TRÊS REGRAS PARA NÃO ACUSAR INOCENTE:
 *
 * 1. INFRAESTRUTURA NÃO CONTA. loadData/saveData/normalizeData tocam TODAS as
 *    coleções para normalizar, não para responder pergunta de negócio. Segui-las
 *    faz 83 rotas parecerem culpadas, e aí ninguém olha o relatório.
 *
 * 2. SÓ CONTA LEITURA QUE CONSOME. `data.X` sozinho pode ser atribuição;
 *    filter/find/some/map/reduce/length é o código perguntando algo a uma lista
 *    que chegou vazia.
 *
 * 3. NOME REPETIDO NÃO É SEGUIDO. `build`, `serialize` e `inUse` existem uma vez
 *    por coleção em cadastros-core e stock-core. Atribuir as leituras da
 *    primeira a todas as outras produz falso positivo. Ambíguo não conta: perde
 *    alcance, ganha confiança.
 *
 * A LINHA DE BASE
 * ---------------
 * PENDENTES lista o que ficou aberto, com o motivo de cada um. Não é
 * tolerância: é o registro do que se sabe e ainda não se corrigiu. Rota NOVA
 * fora da lista quebra o teste — que é o ponto.
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

// ---------------------------------------------------------------------------
// O que fica aberto, e por quê.
// ---------------------------------------------------------------------------
// Chave: "rota|coleção". Valor: por que ainda não foi corrigido.
const PENDENTES = {
  // VAZIA desde a fase BD. Era aqui que morava a família do saldo por
  // cor/depósito: catorze leituras do razão em rotas que nunca o carregavam.
  //
  // O que aquilo causava, reproduzido num banco de prova antes de mexer: com 10
  // unidades Brancas no razão, um pedido de 1 Branca era recusado com
  // "Estoque insuficiente (disponível: 0)", o mesmo pedido SEM cor passava, e a
  // mesma baixa passava pela tela de Estoque > Movimentações. Item sem cor
  // escapava porque projeta contra products.stock_quantity, que vem do banco.
  //
  // Deixar vazia é deliberado: uma entrada nova aqui precisa vir com o motivo
  // escrito e com a decisão de quem podia decidir, nunca como atalho para o
  // teste passar.
};

// ---------------------------------------------------------------------------
const src = ler('server.js');
const linhas = src.split('\n');

const POPULA = {
  syncCadastroData: ['people', 'cnpjs', 'deposits'],
  syncSalesData: ['orders', 'quotes', 'importLogs'],
  // Fase CM: a versão enxuta popula as MESMAS coleções, com menos colunas em
  // cada registro (agregado não lê as outras ~50). Para este guarda o que
  // importa é que `data.orders` e `data.quotes` deixem de chegar vazios — e
  // deixam. `importLogs` fica de fora porque ela não carrega, e é isso que a
  // ausência dele aqui declara: quem precisar do histórico de importação
  // continua tendo que chamar o sync inteiro.
  syncSalesDataParaAgregado: ['orders', 'quotes'],
  // Mesma coisa, com três colunas a mais (quem é o cliente). Ver
  // getOrdersResumidos: é para quem soma, conta E lista pedido de forma
  // compacta. Popula as mesmas duas coleções.
  syncSalesDataResumida: ['orders', 'quotes'],
  // O pré-check fiscal: só os pedidos de um período. Popula `orders` e mais
  // nada — orçamento e histórico de importação ficam de fora, e é isso que a
  // ausência deles aqui declara.
  syncSalesDataDoPeriodo: ['orders'],
  // Fase DS: os recortes das rotas de Vendas. Populam as MESMAS coleções, com
  // menos linhas (os ids pedidos) ou menos colunas (as que a busca lê) — o
  // cabeçalho de cada um em server.js diz o que fica de fora e quem não pode
  // usá-los. Para este guarda o que importa é que a coleção deixe de chegar
  // vazia, e deixa.
  syncSalesDataDosIds: ['orders', 'quotes'],
  syncSalesDataParaBusca: ['orders', 'quotes'],
  syncFinanceDataDosPedidos: ['finance', 'financialPayments', 'financialCategories', 'costCenters', 'bankAccounts'],
  // As notas só com o número: popula as duas chaves, com `{ id, numero }` e
  // `{ id, number }` — os campos que o serializer lê delas.
  syncNfeDataParaVendas: ['nfes', 'nfe'],
  // dashboard-e-sino: os recortes do Início. Cada um é de UMA rota e traz só as
  // linhas que ela pode somar (ver o cabeçalho deles em server.js e em
  // lib/db/painel-inicio.js); para este guarda o que importa é que a coleção
  // deixe de chegar vazia — e deixa.
  syncSalesDataParaPainel: ['orders', 'quotes'],
  syncLancamentosDoPainel: ['finance'],
  syncLancamentosDoGrafico: ['finance'],
  syncPendenciasDoSino: ['finance', 'orders'],
  syncPurchasesData: ['purchases'],
  syncNfeData: ['nfes', 'nfe'],
  syncFinanceData: ['finance', 'financialPayments', 'financialCategories', 'costCenters', 'bankAccounts'],
  // Fase DS: os recortes do Financeiro (server.js, "O FINANCEIRO CARREGA O QUE
  // A ROTA USA"). Cada um popula as MESMAS chaves que syncFinanceData, com menos
  // registros. Este guarda vê que a chave deixou de chegar vazia — não vê se o
  // recorte basta para a rota; isso está escrito ao lado de cada troca.
  syncFinanceCadastroData: ['financialCategories', 'costCenters', 'bankAccounts'],
  syncLancamentosPorId: ['finance', 'financialPayments'],
  syncLancamentosEmAberto: ['finance', 'financialPayments'],
  syncLancamentosDasNotas: ['finance', 'financialPayments'],
  // Só `finance`, e incompleto (dez campos): é o resumo do dashboard, que não
  // lê baixa nenhuma.
  syncLancamentosParaResumo: ['finance'],
  // Só as manuais. A lista de NF-e lê a fiscal por conta própria.
  syncNfesManuais: ['nfes'],
  // loadStockContext chamava syncCadastroData por dentro, e quem o chamava
  // ganhava pessoas e CNPJs de brinde. Desde a fase de desempenho ele carrega
  // SÓ os depósitos (nenhuma rota de Estoque lia pessoa ou CNPJ, e elas
  // custavam 165 ms a cada 30 s). Tirar 'people' e 'cnpjs' daqui é o que faz
  // este guarda acusar a primeira rota de Estoque que passar a lê-los sem
  // sincronizar — em vez de acreditar que o contexto ainda os traz.
  loadStockContext: ['stockMovements', 'stockTransfers', 'deposits'],
  // O contexto de POUCOS produtos (Status do Produto, quebra por cor, escritas
  // de Estoque): depósitos e o razão SÓ desses produtos. Popula as mesmas
  // chaves que o loadStockContext — com o recorte, e é por isso que quem o usa
  // não pode somar o razão inteiro (ver o bloco da função em server.js).
  loadStockContextDosProdutos: ['stockMovements', 'stockTransfers', 'deposits'],
  // As listas de movimentações e transferências: razão inteiro + depósitos; o
  // produto vem só como rótulo, fora do `data`.
  loadStockContextDeRotulos: ['stockMovements', 'stockTransfers', 'deposits'],
  // Fase BD: o razão sozinho, para quem já tem o próprio `data` na mão e não
  // pode trocar por outro (Vendas, Compras, Fiscal, os painéis).
  sincronizarRazao: ['stockMovements', 'stockTransfers']
  // `baseDosRelatoriosGerais` (fase DB) saiu daqui em 06/10/2026 junto com a
  // função: a Síntese Financeira e o Valor em Estoque passaram a ler só as
  // colunas que usam (lib/relatorios-cargas.js), sem `data` nenhum — não há
  // coleção do db.json para este guarda vigiar nelas. Deixar a entrada seria
  // declarar que um nome inexistente "popula" treze coleções, e o primeiro a
  // reaproveitar o nome ganharia um passe livre.
};
const SYNC_DE = {};
Object.entries(POPULA).forEach(([fn, cols]) => cols.forEach((c) => { (SYNC_DE[c] = SYNC_DE[c] || []).push(fn); }));

// Helpers auto-suficientes: sincronizam por dentro, ou vão ao banco quando a
// memória falha. Quem os chama não precisa ter sincronizado antes.
const RESOLVE_SOZINHO = {
  numeroDaNotaDoPedido: ['nfes', 'nfe'],
  // Fase BD: passou a carregar o razão também, porque quem chama grava a
  // entrada com o MESMO `data` e confere saldo por cor em cima dele.
  conferirEntradaDeNfe: ['people', 'cnpjs', 'deposits', 'stockMovements', 'stockTransfers']
};

const INFRA = new Set([
  'loadData', 'saveData', 'normalizeData', 'ensureCadastroCollections',
  'syncCadastroData', 'syncSalesData', 'syncSalesDataParaAgregado',
  'syncSalesDataResumida', 'syncSalesDataDoPeriodo',
  // Fase DS — ver os comentários em POPULA.
  'syncSalesDataDosIds', 'syncSalesDataParaBusca', 'syncFinanceDataDosPedidos', 'syncNfeDataParaVendas',
  'syncPurchasesData', 'syncNfeData',
  'syncFinanceData', 'loadStockContext', 'ensureStockCollections', 'sincronizarRazao',
  // Fase DS: os recortes do Financeiro, mesmos motivos de syncFinanceData.
  'syncFinanceCadastroData', 'syncLancamentosPorId', 'syncLancamentosEmAberto',
  'syncLancamentosDasNotas', 'syncLancamentosParaResumo', 'syncNfesManuais',
  // Carregadores irmãos do loadStockContext, pelo mesmo motivo.
  'loadStockContextDosProdutos', 'loadStockContextDeRotulos'
]);

const ARQUIVOS = [
  'server.js', 'lib/cadastros-core.js', 'lib/stock-core.js', 'lib/atencao.js',
  'lib/kpis.js', 'lib/relatorios-vendas.js', 'lib/painel-pessoal-vendas.js'
];

const blocoSet = /const NAO_PERSISTIR = new Set\(\[([\s\S]*?)\]\)/.exec(src);
check('achei o Set NAO_PERSISTIR', Boolean(blocoSet));
const VIGIADAS = [...blocoSet[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)]
  .map((m) => m[1])
  // products/settings nunca são lidos de `data`; equipments tem camada própria.
  .filter((c) => !['products', 'settings', '__movimentosPendentes', 'equipments'].includes(c));
check('  com coleções para vigiar', VIGIADAS.length > 8, `${VIGIADAS.length}`);

const CONSOME = (c) => new RegExp(
  `(?:data|dados)\\.${c}\\s*(?:\\|\\|\\s*\\[\\]\\s*\\))?\\s*\\.(?:filter|find|findIndex|some|every|map|reduce|forEach|slice|sort|length|includes)`
  + `|\\((?:data|dados)\\.${c}\\s*\\|\\|\\s*\\[\\]\\)\\s*\\.`
  + `|of\\s+\\((?:data|dados)\\.${c}`
  + `|of\\s+(?:data|dados)\\.${c}\\b`
);

const FUNCOES = new Map();
const AMBIGUOS = new Set();
for (const rel of ARQUIVOS) {
  const ls = ler(rel).split('\n');
  const aberturas = [];
  ls.forEach((l, i) => {
    let m = /^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/.exec(l);
    if (m) { aberturas.push({ nome: m[1], i }); return; }
    m = /^ {2,4}(?:async )?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/.exec(l);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) {
      aberturas.push({ nome: m[1], i });
    }
  });
  aberturas.forEach((a, k) => {
    if (FUNCOES.has(a.nome)) { AMBIGUOS.add(a.nome); return; }
    const fim = k + 1 < aberturas.length ? aberturas[k + 1].i : ls.length;
    const corpo = ls.slice(a.i, fim).join('\n');
    const proprios = new Set();
    Object.entries(POPULA).forEach(([fn, cols]) => {
      if (corpo.includes(`${fn}(`)) cols.forEach((c) => proprios.add(c));
    });
    (RESOLVE_SOZINHO[a.nome] || []).forEach((c) => proprios.add(c));
    FUNCOES.set(a.nome, {
      corpo,
      proprios,
      leituras: VIGIADAS.filter((c) => CONSOME(c).test(corpo) && !proprios.has(c)),
      chamadas: [...new Set([
        ...[...corpo.matchAll(/(?:^|[^.\w])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
        ...[...corpo.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
      ])].filter((c) => !INFRA.has(c) && c !== a.nome)
    });
  });
}
check('mapeei as funções', FUNCOES.size > 100, `${FUNCOES.size} (${AMBIGUOS.size} nome(s) ambíguo(s) ignorado(s))`);

const cache = new Map();
function leiturasDe(nome, vistos = new Set()) {
  if (cache.has(nome)) return cache.get(nome);
  if (vistos.has(nome) || INFRA.has(nome) || AMBIGUOS.has(nome)) return [];
  vistos.add(nome);
  const f = FUNCOES.get(nome);
  if (!f) return [];
  const total = new Set(f.leituras);
  const via = new Map(f.leituras.map((c) => [c, nome]));
  for (const c of f.chamadas) {
    if (!FUNCOES.has(c) || AMBIGUOS.has(c)) continue;
    for (const x of leiturasDe(c, vistos)) {
      if (f.proprios.has(x.col)) continue;
      if (!total.has(x.col)) { total.add(x.col); via.set(x.col, x.via); }
    }
  }
  const saida = [...total].map((c) => ({ col: c, via: via.get(c) }));
  if (vistos.size === 1) cache.set(nome, saida);
  return saida;
}

const inicios = [];
linhas.forEach((l, i) => {
  if (/^ {2}(?:const \w+Match = pathname\.match|if \(pathname)/.test(l)) inicios.push(i);
});
function rotulo(i) {
  for (let k = i; k < Math.min(i + 4, linhas.length); k += 1) {
    const m = /'(\/api\/[^']*)'|\\\/api\\\/([a-z-]+)/.exec(linhas[k]);
    if (m) {
      const met = /'(GET|POST|PUT|DELETE|PATCH)'/.exec(linhas[k]);
      return ((m[1] || `/api/${m[2]}`) + ' ' + (met ? met[1] : '')).trim();
    }
  }
  return linhas[i].trim().slice(0, 60);
}

const achados = [];
for (let n = 0; n < inicios.length; n += 1) {
  const de = inicios[n];
  const ate = n + 1 < inicios.length ? inicios[n + 1] : linhas.length;
  const corpo = linhas.slice(de, ate).join('\n');
  if (!/req\.method|pathname/.test(corpo)) continue;

  const achadas = new Map();
  VIGIADAS.filter((c) => CONSOME(c).test(corpo)).forEach((c) => achadas.set(c, '(na própria rota)'));
  const chamadas = [...new Set([
    ...[...corpo.matchAll(/(?:^|[^.\w])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
    ...[...corpo.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
  ])].filter((c) => !INFRA.has(c));
  for (const c of chamadas) {
    if (!FUNCOES.has(c) || AMBIGUOS.has(c)) continue;
    for (const { col, via } of leiturasDe(c)) if (!achadas.has(col)) achadas.set(col, via);
  }

  const resolvidas = new Set();
  Object.entries(RESOLVE_SOZINHO).forEach(([fn, cols]) => {
    if (corpo.includes(`${fn}(`)) cols.forEach((c) => resolvidas.add(c));
  });

  [...achadas.entries()].forEach(([c, via]) => {
    if (resolvidas.has(c)) return;
    const syncs = SYNC_DE[c] || [];
    if (syncs.some((fn) => new RegExp(`${fn}\\(`).test(corpo))) return;
    achados.push({ linha: de + 1, rota: rotulo(de), col: c, via });
  });
}

console.log(`\n--- ${achados.length} leitura(s) sem sync ---`);
const novos = achados.filter((a) => !PENDENTES[`${a.rota}|${a.col}`]);
const conhecidos = achados.filter((a) => PENDENTES[`${a.rota}|${a.col}`]);

conhecidos.forEach((a) => console.log(`  (conhecido) ${a.rota} · ${a.col} — ${PENDENTES[`${a.rota}|${a.col}`]}`));
novos.forEach((a) => console.log(`  NOVO server.js:${a.linha}  ${a.rota} lê ${a.col} via ${a.via}`));

check('nenhuma leitura sem sync FORA da linha de base', novos.length === 0,
  novos.length ? `${novos.length} nova(s)` : `${conhecidos.length} conhecida(s), 0 nova(s)`);

// A linha de base não pode envelhecer em silêncio: entrada que já foi corrigida
// e continua listada faz o próximo leitor achar que o problema existe.
const usadas = new Set(conhecidos.map((a) => `${a.rota}|${a.col}`));
const obsoletas = Object.keys(PENDENTES).filter((k) => !usadas.has(k));
check('a linha de base não tem entrada obsoleta', obsoletas.length === 0,
  obsoletas.length ? `já corrigido(s), remova de PENDENTES: ${obsoletas.join(' ; ')}` : `${usadas.size} em uso`);

// ---------------------------------------------------------------------------
// OS CARREGADORES PARCIAIS SÓ ONDE ALGUÉM CONFERIU QUE BASTAM (fase DS).
// ---------------------------------------------------------------------------
// Para o guarda acima, os recortes do Financeiro "populam" `finance` e
// `financialPayments` — e populam, mas com MENOS: só alguns lançamentos, ou
// todos com dez campos. Uma rota nova que chamasse syncLancamentosParaResumo e
// depois serializasse `data.finance` como lista inteira passaria acima com 0
// leituras sem sync, e responderia conta, categoria e baixas vazias.
//
// Então cada carregador parcial tem a sua lista fechada de rotas, cada uma
// revisada contra o que a rota lê (o porquê está escrito ao lado da chamada, em
// server.js). Rota nova que use um deles quebra aqui até alguém conferir e
// acrescentá-la — e entrada que ficou sem uso também quebra, como em PENDENTES.
const PARCIAIS = {
  // Um lançamento (ou os da página) e as baixas DELE: abrir, editar, baixar,
  // estornar, cancelar, conciliar; a página da lista e a do extrato.
  syncLancamentosPorId: [
    '/api/finance/entries GET',
    '/api/finance/entries POST',
    '/api/finance/entries/* GET',
    '/api/finance/entries/* PUT',
    '/api/finance/entries/:id/payments POST',
    '/api/finance/entries/:id/estorno POST',
    '/api/finance/entries/:id/cancelar POST',
    '/api/finance/bank-transactions GET',
    '/api/finance/bank-transactions POST',
    '/api/finance/bank-transactions/:id/conciliar POST',
    '/api/finance/bank-transactions/:id/desconciliar POST'
  ],
  // Só pendentes e parciais: o universo de findBankTransactionMatches.
  syncLancamentosEmAberto: ['/api/finance/bank-transactions/:id/matches GET'],
  // As parcelas de algumas NF-e manuais, sem baixa nenhuma.
  syncLancamentosDasNotas: [
    '/api/finance/nfe GET',
    '/api/finance/nfe POST',
    '/api/finance/nfe/* GET',
    '/api/finance/nfe/:id/cancelar POST'
  ],
  // Todos os lançamentos com DEZ campos: só buildFinanceDashboardSummary.
  syncLancamentosParaResumo: ['/api/finance/summary GET']
};

// As rotas aqui são cortadas de novo, com um começo a mais que o guarda de
// cima não reconhece: `if (/^\/api\/...$/.test(pathname)` — é como estão
// escritas baixa, estorno, cancelamento e conciliação. Com o corte de cima elas
// se fundiriam à rota anterior e a lista ficaria com o nome errado.
const inicioDeRota = (l) => /^ {2}(?:const \w+Match = pathname\.match|if \(.*\bpathname\b)/.test(l);
const ehComentario = (l) => /^\s*\/\//.test(l);
function rotaNormalizada(linha) {
  const metodo = /req\.method === '(GET|POST|PUT|DELETE|PATCH)'/.exec(linha);
  let caminho = (/pathname === '(\/api\/[^']*)'/.exec(linha) || [])[1];
  if (!caminho) {
    const prefixo = /pathname\.startsWith\('(\/api\/[^']*)'\)/.exec(linha);
    if (prefixo) caminho = `${prefixo[1]}*`;
  }
  if (!caminho) {
    const rx = /\/\^(\\\/api.*?)\$\//.exec(linha);
    if (rx) caminho = rx[1].split('[^/]+').join(':id').split('\\/').join('/');
  }
  return `${caminho || linha.trim().slice(0, 60)} ${metodo ? metodo[1] : ''}`.trim();
}

const usosParciais = new Map(Object.keys(PARCIAIS).map((fn) => [fn, new Set()]));
const iniciosDeRota = [];
linhas.forEach((l, i) => { if (inicioDeRota(l)) iniciosDeRota.push(i); });
iniciosDeRota.forEach((de, n) => {
  const ate = n + 1 < iniciosDeRota.length ? iniciosDeRota[n + 1] : linhas.length;
  // Sem as linhas de comentário: citar o carregador na explicação não é usá-lo.
  const corpo = linhas.slice(de, ate).filter((l) => !ehComentario(l)).join('\n');
  Object.keys(PARCIAIS).forEach((fn) => {
    if (corpo.includes(`${fn}(`)) usosParciais.get(fn).add(rotaNormalizada(linhas[de]));
  });
});
// Fora das rotas: um helper que chame um carregador parcial esconderia a rota
// de cima. Hoje nenhum chama; o dia em que um chamar, ele entra aqui revisado.
// (O despachante, que contém as rotas, não conta: as rotas já foram vistas.)
const helpersComParcial = [...FUNCOES.keys()]
  .filter((nome) => !Object.prototype.hasOwnProperty.call(PARCIAIS, nome))
  .filter((nome) => {
    const ini = linhas.findIndex((l) => l.startsWith(`function ${nome}(`) || l.startsWith(`async function ${nome}(`));
    if (ini < 0) return false;
    const fim = linhas.findIndex((l, i) => i > ini && l.startsWith('}'));
    const corpo = linhas.slice(ini, fim < 0 ? linhas.length : fim);
    if (corpo.some(inicioDeRota)) return false;
    const texto = corpo.filter((l) => !ehComentario(l)).join('\n');
    return Object.keys(PARCIAIS).some((fn) => texto.includes(`${fn}(`));
  });
check('nenhuma função fora das rotas chama carregador parcial', helpersComParcial.length === 0,
  helpersComParcial.length ? helpersComParcial.join(', ') : '0');

Object.entries(PARCIAIS).forEach(([fn, permitidas]) => {
  const usadas = usosParciais.get(fn);
  const novas = [...usadas].filter((r) => !permitidas.includes(r));
  const semUso = permitidas.filter((r) => !usadas.has(r));
  check(`${fn}: só nas rotas conferidas`, novas.length === 0,
    novas.length ? `rota(s) nova(s), confira se o recorte basta e acrescente: ${novas.join(' ; ')}` : `${usadas.size} rota(s)`);
  check(`${fn}: a lista não tem rota obsoleta`, semUso.length === 0,
    semUso.length ? `remova: ${semUso.join(' ; ')}` : 'ok');
});
// RECORTE DE LINHAS NÃO SE CONTA NEM SE SOMA (fase DS).
// ---------------------------------------------------------------------------
// POPULA trata syncSalesDataDosIds e syncFinanceDataDosPedidos como quem
// preenche orders/quotes/finance — e preenchem, mas só com os registros
// PEDIDOS (o pedido aberto, os 200 do lote, os lançamentos do pedido). Para a
// regra de cima isso basta: a coleção deixou de chegar vazia. Para quem CONTA
// ou SOMA, não: `data.orders.length` depois de syncSalesDataDosIds(data, [id])
// é 1, e um painel montado em cima disso mostra um pedido só, com HTTP 200.
//
// Por isso esta segunda regra: rota que carrega um recorte de LINHAS (e não o
// sync inteiro da mesma coleção) não pode, nem no corpo nem nas funções que
// alcança, ler `.length`/`.reduce` dessas coleções, nem chamar um agregador.
//
// syncSalesDataParaBusca e syncNfeDataParaVendas ficam FORA de propósito: são
// recortes de COLUNAS — trazem TODAS as linhas —, e a lista conta e filtra em
// cima deles legitimamente (total, contagem de pedidos e de notas).
const RECORTE_DE_LINHAS = {
  syncSalesDataDosIds: ['orders', 'quotes'],
  syncFinanceDataDosPedidos: ['finance', 'financialPayments']
};
const AGREGADORES = [
  'buildSalesDashboardSummary', 'resumoDoPainelDeVendas', 'pedidosDoVendedorNoPainel',
  'filterSalesRecords', 'ordenarSalesRecords', 'buildFinanceDashboardSummary'
];
const semComentario = (txt) => txt.split('\n')
  .filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const CONTA = (c) => new RegExp(
  `(?:data|dados)\\.${c}\\s*\\.(?:length|reduce)\\b`
  + `|\\((?:data|dados)\\.${c}\\s*\\|\\|\\s*\\[\\]\\)\\s*\\.(?:length|reduce)\\b`
);
// As chamadas aqui saem do corpo SEM comentário. O corpo de cada função vai até
// a abertura da próxima, e por isso carrega o cabeçalho dela — que costuma
// citar outra função pelo nome (o de buildSalesDashboardSummary cita a si
// mesma, e caía dentro de duplicarSalesRecord). Para a regra de cima isso só
// alarga a busca; aqui acusaria uma rota inocente.
const chamadasSemComentario = new Map();
function chamadasDe(nome) {
  if (!chamadasSemComentario.has(nome)) {
    const corpo = semComentario(FUNCOES.get(nome).corpo);
    chamadasSemComentario.set(nome, [...new Set([...corpo.matchAll(/(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))]);
  }
  return chamadasSemComentario.get(nome);
}
function alcancaveis(chamadasIniciais) {
  const vistos = new Set();
  const fila = [...chamadasIniciais];
  while (fila.length) {
    const nome = fila.pop();
    if (vistos.has(nome) || INFRA.has(nome) || AMBIGUOS.has(nome) || !FUNCOES.has(nome)) continue;
    vistos.add(nome);
    fila.push(...chamadasDe(nome));
  }
  return vistos;
}
function violacoesDeRecorte(corpoDaRota) {
  const corpo = semComentario(corpoDaRota);
  const recortadas = new Set();
  Object.entries(RECORTE_DE_LINHAS).forEach(([fn, cols]) => {
    if (corpo.includes(`${fn}(`)) cols.forEach((c) => recortadas.add(c));
  });
  // Quem TAMBÉM chama o sync inteiro da coleção tem as linhas todas.
  for (const c of [...recortadas]) {
    const inteiros = (SYNC_DE[c] || []).filter((fn) => !RECORTE_DE_LINHAS[fn]);
    if (inteiros.some((fn) => corpo.includes(`${fn}(`))) recortadas.delete(c);
  }
  if (!recortadas.size) return [];
  const chamadas = [...new Set([...corpo.matchAll(/(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))];
  const alcance = alcancaveis(chamadas);
  const saida = [];
  for (const c of recortadas) {
    if (CONTA(c).test(corpo)) saida.push(`conta ${c} na própria rota`);
    for (const fn of alcance) {
      if (CONTA(c).test(semComentario(FUNCOES.get(fn).corpo))) saida.push(`conta ${c} via ${fn}`);
    }
  }
  AGREGADORES.filter((fn) => chamadas.includes(fn) || alcance.has(fn))
    .forEach((fn) => saida.push(`agrega via ${fn}`));
  return saida;
}

console.log('\n--- recorte de linhas não é contado nem somado ---');
// O detector precisa acusar o caso que existe para pegar — senão um regex
// quebrado passaria em silêncio.
check('acusa contagem depois do recorte',
  violacoesDeRecorte('  await syncSalesDataDosIds(data, [id]);\n  return sendJson(res, { n: data.orders.length });').length > 0);
check('acusa contagem com `|| []` depois do recorte do financeiro',
  violacoesDeRecorte('  await syncFinanceDataDosPedidos(data, [id]);\n  const n = (data.finance || []).length;').length > 0);
check('acusa painel montado sobre o recorte',
  violacoesDeRecorte('  await syncSalesDataDosIds(data, ids);\n  return sendJson(res, buildSalesDashboardSummary(data, escopo));').length > 0);
check('acusa lista filtrada sobre o recorte',
  violacoesDeRecorte('  await syncSalesDataDosIds(data, ids);\n  const f = filterSalesRecords(data.orders, q);').length > 0);
check('não acusa quem também carrega a coleção inteira',
  violacoesDeRecorte('  await syncSalesDataDosIds(data, [id]);\n  await syncSalesData(data);\n  const n = data.orders.length;').length === 0);
check('não acusa quem só acha o registro pelo id',
  violacoesDeRecorte('  await syncSalesDataDosIds(data, [id]);\n  const r = [...data.orders, ...data.quotes].find((x) => x.id === id);').length === 0);

let rotasComRecorte = 0;
const violacoes = [];
for (let n = 0; n < inicios.length; n += 1) {
  const de = inicios[n];
  const ate = n + 1 < inicios.length ? inicios[n + 1] : linhas.length;
  const corpo = linhas.slice(de, ate).join('\n');
  if (!Object.keys(RECORTE_DE_LINHAS).some((fn) => semComentario(corpo).includes(`${fn}(`))) continue;
  rotasComRecorte += 1;
  violacoesDeRecorte(corpo).forEach((v) => violacoes.push(`server.js:${de + 1} ${rotulo(de)}: ${v}`));
}
violacoes.forEach((v) => console.log(`  RECORTE ${v}`));
check('achei as rotas que usam recorte de linhas', rotasComRecorte >= 4, `${rotasComRecorte}`);
check('nenhuma delas conta ou soma o recorte', violacoes.length === 0,
  violacoes.length ? `${violacoes.length} violação(ões)` : `${rotasComRecorte} rota(s) conferida(s)`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
