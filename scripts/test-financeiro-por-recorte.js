#!/usr/bin/env node
/**
 * O FINANCEIRO CARREGA O QUE A ROTA USA (fase DS) — sem banco e sem servidor.
 *
 * O desempenho do Financeiro morria numa função só: `syncFinanceData`, que lê
 * os 27.362 lançamentos e as 25.709 baixas inteiros, chamada em toda rota
 * /api/finance/* — 400 a 700 ms por requisição, no único processo do servidor,
 * inclusive para abrir UM lançamento, para listar NF-e e para criar uma
 * categoria. A fase trocou cada uma pelo recorte que a rota usa. O que este
 * teste segura, porque nenhuma destas regressões daria erro na tela — só
 * lentidão, que ninguém liga a um commit:
 *
 *   1. nenhuma rota /api/finance/* volta a chamar syncFinanceData;
 *   2. toda rota /api/finance/* pergunta QUEM é antes de carregar dado;
 *   3. a lista de NF-e monta as parcelas só da página e dá o MESMO resultado
 *      da montagem antiga (roda de verdade, com dados sintéticos);
 *   4. a NF-e fiscal não volta para o db.json (NAO_PERSISTIR);
 *   5. /api/finance/meta continua inteiro sem parâmetro, e as telas pedem o
 *      recorte que leem;
 *   6. as telas: o dashboard tem UMA cadeia de atualização (roda o arquivo de
 *      verdade com relógio falso), a emissão de NF-e não desenha os <select>
 *      gigantes, Lançamentos não refaz a lista para abrir a busca avançada.
 *   7. o byte NUL de uma URL ou corpo mal formado não chega ao Postgres (que o
 *      recusaria com 500): ids com NUL saem da leitura, filtros são reescritos.
 *
 * A equivalência com o banco de verdade (lista de lançamentos, conciliação,
 * resumo) está em scripts/test-lista-de-lancamentos.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');

// As rotas: cada `if (pathname ...` de dois espaços até a próxima.
const linhas = src.split('\n');
const inicios = [];
linhas.forEach((l, i) => { if (/^ {2}if \((?:pathname|\/\^\\\/api)/.test(l)) inicios.push(i); });
const rotas = inicios.map((de, k) => ({
  cabeca: linhas[de].trim(),
  corpo: linhas.slice(de, k + 1 < inicios.length ? inicios[k + 1] : linhas.length).join('\n')
}));
const doFinanceiro = rotas.filter((r) => /\/api\/finance\b|\\\/api\\\/finance\\\//.test(r.cabeca));

console.log('--- 1. nenhuma rota /api/finance/* lê o financeiro inteiro ---');
check('achei as rotas do Financeiro', doFinanceiro.length >= 20, `${doFinanceiro.length}`);
// A única exceção é a GET /api/finance legada, que devolve os lançamentos
// inteiros por contrato (sem chamador no front; ver o comentário dela).
const comSyncInteiro = doFinanceiro.filter((r) => /syncFinanceData\(/.test(semComentarios(r.corpo))
  && !/pathname === '\/api\/finance' && req\.method === 'GET'/.test(r.cabeca));
check('nenhuma chama syncFinanceData (fora a GET legada, que devolve tudo)', comSyncInteiro.length === 0,
  comSyncInteiro.map((r) => r.cabeca.slice(0, 90)).join(' | ') || 'nenhuma');

console.log('\n--- 2. quem pergunta vem antes da carga ---');
const carregaAntes = doFinanceiro.filter((r) => {
  const c = semComentarios(r.corpo);
  const user = c.indexOf('getCurrentUser(req)');
  const carga = c.search(/loadData\(\)|await sync[A-Z]\w*\(|await Promise\.all\(/);
  return carga >= 0 && (user < 0 || carga < user);
});
check('toda rota /api/finance/* confere o usuário antes de loadData/sync', carregaAntes.length === 0,
  carregaAntes.map((r) => r.cabeca.slice(0, 90)).join(' | ') || `${doFinanceiro.length} rotas`);

console.log('\n--- 3. a lista de NF-e monta as parcelas só da página (roda de verdade) ---');
function corpoDe(nome) {
  const marca = [`\nfunction ${nome}(`, `\nasync function ${nome}(`].find((m) => src.includes(m));
  if (!marca) throw new Error(`server.js não tem mais a função ${nome}`);
  const ini = src.indexOf(marca);
  return src.slice(ini, src.indexOf('\n}', ini + 1) + 2);
}
const blocoStatus = src.slice(src.indexOf('const NFE_STATUS_FISCAL = {'), src.indexOf('};', src.indexOf('const NFE_STATUS_FISCAL = {')) + 2);
const NOMES = ['pad2', 'toDateStr', 'getTodayLocal', 'classifyFinanceEntry', 'financeEntryDueDate', 'financeEntryStatusLabel',
  'normalizeNfeStatus', 'serializeNfe', 'nfeParaTela', 'fiscalNfeParaLista', 'filterNfes'];
const S = new Function(`${blocoStatus}\n${NOMES.map(corpoDe).join('\n')}\nreturn { ${NOMES.join(', ')} };`)();

// A rota, como ela é agora: os mesmos passos, na mesma ordem.
const rotaNfe = semComentarios(rotas.find((r) => /pathname === '\/api\/finance\/nfe' && req\.method === 'GET'/.test(r.cabeca)).corpo);
check('a rota monta as manuais sem parcelas antes de filtrar', /\(data\.nfes \|\| \[\]\)\.map\(\(nfe\) => \(\{ \.\.\.nfeParaTela\(nfe, \[\]\), origem: 'financeiro' \}\)\)/.test(rotaNfe));
check('e carrega as parcelas só das notas manuais da página', /syncLancamentosDasNotas\(data, daPagina\.filter\(\(nfe\) => nfe\.origem === 'financeiro'\)\.map\(\(nfe\) => nfe\.id\)\)/.test(rotaNfe));
check('e remonta a manual pela mesma serializeNfe', /\{ \.\.\.serializeNfe\(brutas\.get\(nfe\.id\), data\), origem: 'financeiro' \}/.test(rotaNfe));
check('e não lê mais o financeiro inteiro nem a tabela fiscal duas vezes', !/syncFinanceData\(|syncNfeData\(/.test(rotaNfe));

// Dados sintéticos: notas manuais com e sem parcelas, notas fiscais, datas
// repetidas, status variados, parcelas pagas/pendentes/vencidas.
let semente = 7;
const sorte = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const pegar = (l) => l[Math.floor(sorte() * l.length)];
const DATAS = ['2026-01-05', '2026-03-10', '2026-03-10', '2026-07-22', '2026-10-01', '2026-10-01', '2025-12-31'];
const manuais = Array.from({ length: 37 }, (_, i) => ({
  id: `man-${String(i).padStart(3, '0')}`, number: String(1000 + i), series: '1', date: pegar(DATAS),
  status: pegar(['autorizada', 'emitida', 'cancelada', 'AUTORIZADO', 'rascunho']), key: i % 3 ? '' : `4${i}`.padEnd(44, '1'),
  amount: 100 + i, customer: pegar(['Maria Silva', 'JOÃO LTDA', 'Ana', 'Posto Sul ltda']), items: [{ description: 'x' }]
}));
const fiscais = Array.from({ length: 29 }, (_, i) => ({
  id: `fis-${String(i).padStart(3, '0')}`, modelo: i % 4 ? 55 : 65, numero: 500 + i, serie: 1,
  dataEmissao: `${pegar(DATAS)}T10:00:00-03:00`, status: pegar(['AUTORIZADO', 'ERRO', 'CANCELADO', 'PROCESSANDO']),
  chaveAcesso: `5${i}`.padEnd(44, '2'), valorTotal: 50 + i, destinatarioNome: pegar(['Maria Silva', 'Carlos', 'JOÃO LTDA'])
}));
// Parcelas: a ordem de getFinancialEntriesByNfe e da leitura inteira é a
// mesma (data desc, id desc); o filtro por nota preserva a ordem.
const parcelas = [];
manuais.forEach((n, i) => {
  for (let k = 0; k < i % 4; k += 1) {
    parcelas.push({ id: `fin-${n.id}-${k}`, nfeId: n.id, description: `Parcela ${k + 1}`, date: n.date,
      dueDate: pegar(['2025-01-01', '2026-12-31', '2026-10-07']), amount: 10 + k, type: 'RECEITA', status: pegar(['pending', 'paid', 'cancelado']) });
  }
});
const outrosLancamentos = Array.from({ length: 50 }, (_, i) => ({ id: `fin-x-${i}`, nfeId: '', date: '2026-01-01', amount: 1, type: 'DESPESA', status: 'paid' }));
const financeInteiro = [...parcelas, ...outrosLancamentos]
  .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : (a.date < b.date ? 1 : -1)));

const ordenar = (l) => l.sort((a, b) => (String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))));
function listaAntiga(query, page, limit) {
  const data = { nfes: manuais, finance: financeInteiro };
  const todas = fiscais.map(S.fiscalNfeParaLista).concat(manuais.map((nfe) => ({ ...S.serializeNfe(nfe, data), origem: 'financeiro' })));
  const filtered = ordenar(S.filterNfes(data, query, todas));
  return { nfes: filtered.slice((page - 1) * limit, page * limit), total: filtered.length };
}
function listaNova(query, page, limit) {
  const data = { nfes: manuais };
  const todas = fiscais.map(S.fiscalNfeParaLista).concat(manuais.map((nfe) => ({ ...S.nfeParaTela(nfe, []), origem: 'financeiro' })));
  const filtered = ordenar(S.filterNfes(data, query, todas));
  const daPagina = filtered.slice((page - 1) * limit, page * limit);
  const ids = new Set(daPagina.filter((n) => n.origem === 'financeiro').map((n) => n.id));
  data.finance = financeInteiro.filter((e) => ids.has(e.nfeId)); // = getFinancialEntriesByNfe
  const brutas = new Map(manuais.map((n) => [n.id, n]));
  return {
    nfes: daPagina.map((n) => (n.origem === 'financeiro' ? { ...S.serializeNfe(brutas.get(n.id), data), origem: 'financeiro' } : n)),
    total: filtered.length
  };
}
let casos = 0; let iguais = 0;
for (const search of ['', 'maria', '100', 'ltda', '4', 'zzz']) {
  for (const status of ['', 'autorizada', 'cancelada', 'pendente', 'erro']) {
    for (const datas of [{}, { dateFrom: '2026-03-10' }, { dateTo: '2026-03-10' }]) {
      for (const [page, limit] of [[1, 15], [2, 15], [3, 15], [1, 100], [9, 15]]) {
        const q = new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}), ...datas });
        casos += 1;
        if (JSON.stringify(listaAntiga(q, page, limit)) === JSON.stringify(listaNova(q, page, limit))) iguais += 1;
      }
    }
  }
}
check('a montagem nova dá a mesma lista que a antiga', iguais === casos, `${iguais}/${casos} combinações`);
check('  e há parcelas nas páginas comparadas (o teste não é vazio)', parcelas.length > 20, `${parcelas.length} parcelas`);

console.log('\n--- 4. a NF-e fiscal não volta para o db.json ---');
const blocoSet = /const NAO_PERSISTIR = new Set\(\[([\s\S]*?)\]\)/.exec(src)[1].replace(/\/\/[^\n]*/g, '');
check("'nfe' está em NAO_PERSISTIR", /'nfe'/.test(blocoSet));
check("e 'nfes' continua", /'nfes'/.test(blocoSet));

console.log('\n--- 5. /api/finance/meta: inteiro sem parâmetro, recortado quando pedido ---');
const rotaMeta = semComentarios(rotas.find((r) => /pathname === '\/api\/finance\/meta'/.test(r.cabeca)).corpo);
check('não lê os lançamentos (só as três tabelas de nomes)', /syncFinanceCadastroData\(data\)/.test(rotaMeta) && !/syncFinanceData\(/.test(rotaMeta));
check('sem parâmetro, os produtos levam os dez campos de sempre',
  /produtos: \(await db\.getProducts\(\)\)\.map\(\(p\) => \(\{\s*id: p\.id, name: p\.name, sku: p\.sku, salePrice: p\.salePrice,\s*ncm: p\.ncm, cest: p\.cest, ean: p\.ean, origem: p\.origem,\s*unidadeComercial: p\.unidadeComercial, unidadeTributavel: p\.unidadeTributavel/.test(rotaMeta));
const diretorioMeta = corpoDe('diretorioDoMetaFinanceiro');
check('sem parâmetro, o diretório inteiro', /return diretorio;\s*\}$/.test(diretorioMeta.trim()));
check('o recorte da NF-e leva documento, UF, município e IE',
  /pede === 'nfe'[\s\S]*document, city, state, stateRegistration/.test(diretorioMeta));
const TELAS_META = {
  'public/modules/finance/subs/lancamentos.js': ["/api/finance/meta?produtos=0&diretorio=0", "/api/finance/meta?produtos=0&diretorio=resumido"],
  'public/modules/finance/subs/novo_lancamento.js': ['/api/finance/meta?produtos=0&diretorio=resumido'],
  'public/modules/finance/subs/extrato_open_finance.js': ['/api/finance/meta?produtos=0&diretorio=0'],
  'public/modules/finance/subs/emitir_nfe_focus.js': ['/api/finance/meta?diretorio=nfe&produtos=nfe']
};
Object.entries(TELAS_META).forEach(([rel, urls]) => {
  const t = semComentarios(ler(rel));
  const todas = [...t.matchAll(/api\(['`]([^'`]*\/api\/finance\/meta[^'`]*)['`]/g)].map((m) => m[1]);
  check(`${rel.split('/').pop().padEnd(26)} pede só o recorte que lê`, urls.every((u) => todas.includes(u)) && todas.every((u) => urls.includes(u)), todas.join(' , '));
});
const emissaoSemComentario = semComentarios(ler('public/modules/finance/subs/emitir_nfe_focus.js'));
// A emissão LÊ documento/IE do destinatário: o recorte "resumido" a deixaria
// sem eles e a nota sairia com o destinatário em branco.
check('a emissão de NF-e nunca pede o diretório resumido', !/diretorio=resumido/.test(emissaoSemComentario));

console.log('\n--- 6. as telas ---');
const emissao = semComentarios(ler('public/modules/finance/subs/emitir_nfe_focus.js'));
check('a emissão não desenha <option> de pessoa nem de produto',
  !/meta\.(directory|produtos)[\s\S]{0,200}<option/.test(emissao) && !/<select data-field="produtoId"/.test(emissao));
check('o cliente é o campo de busca do sistema', /renderSearchableSelect\(\{\s*id: 'nfeFocusCliente'/.test(emissao)
  && /attachSearchableSelect\(\{ id: 'nfeFocusCliente'/.test(emissao));
check('o produto de cada linha também', /id: `nfeFocusProduto\$\{index\}`/.test(emissao)
  && /attachSearchableSelect\(\{\s*id: `nfeFocusProduto\$\{index\}`/.test(emissao));
check('os ouvintes dos itens não pegam os <input> do campo de busca', /#nfeFocusItemsBody input\[data-field\]/.test(emissao)
  && !/'#nfeFocusItemsBody input'\)/.test(emissao));
// O <select> de produto não enviava o formulário com Enter; o campo de texto
// envia — e enviar este formulário é transmitir a nota à SEFAZ.
check('Enter na busca de produto ou de cliente não emite a nota',
  /function segurarEnter\(campo\) \{\s*campo\?\.addEventListener\('keydown', \(evento\) => \{\s*if \(evento\.key === 'Enter'\) evento\.preventDefault\(\);/.test(emissao)
  && /segurarEnter\(campo\);/.test(emissao)
  && /getElementById\('nfeFocusClienteInput'\)\?\.addEventListener\('keydown', \(evento\) => \{\s*if \(evento\.key === 'Enter'\) evento\.preventDefault\(\);/.test(emissao));
check('as três cargas da emissão saem juntas', /Promise\.allSettled\(\[\s*api\('\/api\/fiscal\/estabelecimentos'\),\s*api\('\/api\/fiscal\/empresas'\),\s*api\('\/api\/finance\/meta/.test(emissao));
check('"Últimas NF-e" pede só dez', /\/api\/fiscal\/nfe\?estabelecimentoId=\$\{encodeURIComponent\(selectedEstabelecimentoId\)\}&limite=10/.test(emissao));
const rotaFiscalNfe = semComentarios(src.slice(src.indexOf("if (pathname === '/api/fiscal/nfe' && req.method === 'GET')"), src.indexOf("if (pathname === '/api/fiscal/nfe/problemas' && req.method === 'GET')")));
check('  e o servidor atende o limite sem os jsonb, e sem ele devolve o de sempre',
  /fiscalDb\.getNfeRecentes\(estabelecimentoId, Math\.min\(limite, 50\)\)/.test(rotaFiscalNfe) && /fiscalDb\.getNfeRecords\(estabelecimentoId\)/.test(rotaFiscalNfe));

const listaNfe = semComentarios(ler('public/modules/finance/subs/nfe_emitidas.js'));
check('NF-e Emitidas não espera o status da Focus para carregar a lista', !/await api\('\/api\/focusnfe\/status'\);\s*\n\s*apiFiscalConfigurada/.test(listaNfe)
  && /api\('\/api\/focusnfe\/status'\)\s*\.then/.test(listaNfe));

const lancamentos = semComentarios(ler('public/modules/finance/subs/lancamentos.js'));
const botao = lancamentos.slice(lancamentos.indexOf("getElementById('financeFilterToggleBtn')"), lancamentos.indexOf("getElementById('financeQuickSearchForm')"));
check('Lançamentos: abrir a busca avançada redesenha com a última resposta', /renderView\(ultimoResultado\)/.test(botao));
check('  e só volta ao servidor quando a consulta mudou', /buildQuery\(\) !== ultimaConsulta/.test(botao));
check('  o filtro de cliente é campo de busca, com o mesmo name', /renderSearchableSelect\(\{\s*id: 'financeFilterParty',\s*name: 'clientSupplierId'/.test(lancamentos));
check('  a lista não espera o meta', !/meta = await api\(/.test(lancamentos));

// O dashboard, de verdade: o arquivo roda num contexto falso com relógio
// simulado, e conta quantas vezes /api/finance/summary é pedido em 10 minutos.
function simularDashboard({ cliques, latenciaMs, minutos = 10 }) {
  const codigo = ler('public/modules/finance/subs/dashboard.js');
  let agora = 0;
  let proximoId = 1;
  const fila = new Map();
  const setTimeout = (fn, ms) => { const id = proximoId++; fila.set(id, { quando: agora + ms, fn }); return id; };
  const clearTimeout = (id) => { fila.delete(id); };
  const DateFalso = class extends Date { static now() { return agora; } };
  const ouvintes = [];
  const badge = { textContent: '' };
  const documentFalso = { getElementById: (id) => (id === 'financeLiveBadgeText' ? badge : null), body: { contains: () => true } };
  const botao = (dataset) => ({ dataset, addEventListener: (ev, fn) => ouvintes.push({ dataset, fn }) });
  const content = {
    set innerHTML(_) { ouvintes.length = 0; },
    querySelectorAll: (sel) => {
      if (sel === '[data-period]') return ['today', 'week', 'month', 'prev_month'].map((p) => botao({ period: p }));
      if (sel === '[data-granularity]') return ['day', 'week', 'month', 'year'].map((g) => botao({ granularity: g }));
      return [];
    }
  };
  let chamadas = 0;
  const api = () => { chamadas += 1; return new Promise((ok) => setTimeout(() => ok({ chartSeries: [], proximosVencimentos: {}, ultimosLancamentos: [], contasAPagar: {}, contasAReceber: {}, movimentacoesBancarias: {}, range: {} }), latenciaMs)); };
  const ctx = vm.createContext({ window: {}, document: documentFalso, setTimeout, clearTimeout, Date: DateFalso, URLSearchParams, Number, String, Math, Promise, console, Object, Array, JSON });
  vm.runInContext(codigo, ctx);
  ctx.financeBuildChartSvg = () => '';
  ctx.window.MavisPainel = { graficoLinha: () => '' };
  ctx.financeFormatBRL = (v) => String(v);
  ctx.financeFormatDate = (v) => String(v);
  ctx.financeStatusBadge = () => '';
  ctx.FINANCE_TYPE_LABEL = {};
  const render = ctx.window.MavisSubscreenRegistry.finance.dashboard;
  render({ content, api, showToast() {}, state: {}, loadModule() {}, escapeHtml: (s) => s });
  const pendentes = cliques.slice();
  const fim = minutos * 60000;
  const drenar = () => new Promise((r) => setImmediate(r));
  return (async () => {
    await drenar();
    while (agora <= fim) {
      const lista = [...fila.entries()].sort((a, b) => a[1].quando - b[1].quando);
      const proxClique = pendentes.length ? pendentes[0].em : Infinity;
      const prox = lista[0];
      if (!prox && proxClique === Infinity) break;
      if (proxClique <= (prox ? prox[1].quando : Infinity)) {
        agora = proxClique;
        const c = pendentes.shift();
        const alvo = ouvintes.find((o) => o.dataset[c.tipo] === c.valor);
        if (alvo) alvo.fn();
        await drenar(); await drenar();
        continue;
      }
      fila.delete(prox[0]);
      agora = prox[1].quando;
      if (agora > fim) break;
      prox[1].fn();
      await drenar(); await drenar();
    }
    return chamadas;
  })();
}

(async () => {
  // O byte NUL não pode chegar ao Postgres: ele recusa o parâmetro e a rota
  // responderia 500 onde antes respondia 404 (lançamento não achado) ou 200
  // (lista filtrada em JS). Nada aqui toca o banco: as leituras por id saem
  // vazias antes da consulta, e o filtro só é montado.
  console.log('\n--- 7. o byte NUL não vai ao banco ---');
  {
    const fin = require('../lib/db/financeiro');
    const vazios = await Promise.all([
      fin.getFinancialEntriesByIds(['a\u0000b']),
      fin.getFinancialPaymentsByEntries(['\u0000']),
      fin.getFinancialEntriesByNfe(['x\u0000'])
    ]);
    check('id com NUL é descartado antes da consulta', vazios.every((l) => Array.isArray(l) && l.length === 0));
    const filtro = fin.montarFiltroDaLista(new URLSearchParams({
      clientSupplierId: 'a\u0000b', category: '\u0000', dateFrom: '2026-03-01\u0000', dateTo: '\u0000x',
      dueFrom: 'abc\u0000', dueTo: '2026-10\u0000', amountMin: '1\u0000'
    }));
    check('nenhum parâmetro do filtro leva NUL', filtro.valores.every((v) => !String(v).includes('\u0000')),
      JSON.stringify(filtro.valores));
    // A tradução, termo a termo (a equivalência com a lista inteira está em
    // test-lista-de-lancamentos.js, com o banco): igualdade vira `false`;
    // `>= t` vira `> antes-do-NUL`; `<= t` vira `<= antes-do-NUL`.
    const esperado = ' where false and false'
      + ' and (date::text collate "C") > $1 and (date::text collate "C") <= $2'
      + ' and (coalesce(due_date, date)::text collate "C") > $3 and (coalesce(due_date, date)::text collate "C") <= $4'
      + ' and false';
    check('a tradução com NUL é a esperada', filtro.onde === esperado
      && JSON.stringify(filtro.valores) === JSON.stringify(['2026-03-01', '', 'abc', '2026-10']), filtro.onde);
  }

  try {
    const parado = await simularDashboard({ cliques: [], latenciaMs: 300 });
    const cliques = [{ em: 5300, tipo: 'period', valor: 'week' }, { em: 9710, tipo: 'period', valor: 'month' }, { em: 13420, tipo: 'granularity', valor: 'year' }];
    const comCliques = await simularDashboard({ cliques, latenciaMs: 700 });
    // 1 ao abrir + 1 por minuto (10) = ~11; com 3 cliques, +3. Antes da fase:
    // 39 chamadas (uma cadeia nova por carga, nenhuma cancelada).
    check('dashboard parado: uma chamada por minuto', parado >= 9 && parado <= 12, `${parado} chamadas em 10 min`);
    check('dashboard com 3 cliques: as cadeias não se somam', comCliques <= parado + 4, `${comCliques} chamadas em 10 min (antes: 39)`);
  } catch (erro) {
    check('a simulação do dashboard rodou', false, erro.message);
  }
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
