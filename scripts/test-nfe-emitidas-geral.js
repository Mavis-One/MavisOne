#!/usr/bin/env node
/**
 * NF-e EMITIDAS, A GERAL DA TELA (fase EI, 13/10/2026).
 *
 * Pedido do usuário: "uma geral no módulo financeiro" — tabela que não estoure,
 * pesquisa por valores, ordenação, seleção. Os achados confirmados nesta tela:
 *
 *   1. a NF-e fiscal avulsa gera parcelas (nfeId = id da nota), e a lista
 *      mostrava "-" e o modal "À vista" / "Nenhum lançamento vinculado";
 *      parcela cancelada contava no "x/y parcelas pagas";
 *   2. o botão Cancelar da linha e do modal ignorava o prazo (24 h / 30 min) e
 *      só falhava depois de digitada a justificativa;
 *   3. a data da nota fiscal era o dia do ISO em UTC: a NFC-e das 21h30 caía
 *      no dia seguinte e escapava do filtro;
 *   4. não havia busca por valor nem por CPF/CNPJ;
 *   5. chave de 44 dígitos e nomes longos empurravam a tabela para o lado;
 *   6. valor à esquerda e sem total do filtro;
 *   7. "Página 3 de 2" vazia depois de cancelar; filtros sumiam ao sair.
 *
 * SEM BANCO E SEM SERVIDOR: as funções do server.js rodam isoladas, e a tela
 * roda de verdade num contexto com DOM falso (o HTML desenhado é inspecionado).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const server = ler('server.js');

function corpoDe(nome) {
  const marca = `\nfunction ${nome}(`;
  const ini = server.indexOf(marca);
  if (ini < 0) throw new Error(`server.js não tem mais a função ${nome}`);
  return server.slice(ini, server.indexOf('\n}', ini + 1) + 2);
}
const blocoStatus = server.slice(server.indexOf('const NFE_STATUS_FISCAL = {'), server.indexOf('};', server.indexOf('const NFE_STATUS_FISCAL = {')) + 2);
// eslint-disable-next-line no-new-func
const S = new Function(`${blocoStatus}\n${['normalizeNfeStatus', 'fiscalNfeParaLista', 'filterNfes'].map(corpoDe).join('\n')}
return { normalizeNfeStatus, fiscalNfeParaLista, filterNfes };`)();

console.log('--- 1. o dia da nota fiscal é o de Brasília ---');
const dia = (dataEmissao, criadoEm) => S.fiscalNfeParaLista({ id: 'x', dataEmissao, criadoEm, status: 'AUTORIZADO' }).date;
check('NFC-e das 21h30 de 13/10 (00:30Z do dia 14) fica no dia 13', dia('2026-10-14T00:30:00.000Z') === '2026-10-13', dia('2026-10-14T00:30:00.000Z'));
check('meia-noite UTC em ponto é data civil (tela de emissão): continua no dia', dia('2026-10-13T00:00:00.000Z') === '2026-10-13', dia('2026-10-13T00:00:00.000Z'));
check('com fuso explícito de Brasília', dia('2026-08-10T10:00:00-03:00') === '2026-08-10');
check('meio da tarde não muda', dia('2026-10-13T18:00:00.000Z') === '2026-10-13');
check('sem data de emissão, criado_em — que é sempre instante', dia('', '2026-10-14T00:00:00.000Z') === '2026-10-13', dia('', '2026-10-14T00:00:00.000Z'));
check('sem data nenhuma, vazio', dia('', '') === '');
check('o formatador é criado uma vez, não por nota', /fiscalNfeParaLista\.formatoBrasilia\s*\|\|/.test(corpoDe('fiscalNfeParaLista')));

console.log('\n--- 2. busca por CPF/CNPJ, referência e faixa de valor ---');
const notas = [
  { id: 'a', number: '124', customer: 'Maria', clientDocument: '04398884840', amount: 1250, referencia: 'nfe_abc', status: 'autorizada' },
  { id: 'b', number: '3001', customer: 'Posto Sul', clientDocument: '12345678000190', amount: 99.9, status: 'autorizada' },
  { id: 'c', number: '777', customer: 'Joao', clientDocument: '11124000000', amount: 1250.01, status: 'cancelada' }
];
const ids = (q) => S.filterNfes({}, new URLSearchParams(q), notas).map((n) => n.id).join(',');
check('CNPJ com máscara acha a nota', ids({ search: '12.345.678/0001-90' }) === 'b', ids({ search: '12.345.678/0001-90' }));
check('parte do CPF (6+ dígitos) acha', ids({ search: '043.988' }) === 'a', ids({ search: '043.988' }));
check('"124" é número de nota: não casa com CPF que tem 124 no meio', ids({ search: '124' }) === 'a', ids({ search: '124' }));
check('referência da Focus', ids({ search: 'nfe_abc' }) === 'a');
check('nome continua', ids({ search: 'posto' }) === 'b');
check('valor de', ids({ valorDe: '1250' }) === 'a,c', ids({ valorDe: '1250' }));
check('valor até (borda incluída)', ids({ valorAte: '1250' }) === 'a,b', ids({ valorAte: '1250' }));
check('faixa exata com vírgula', ids({ valorDe: '1250,01', valorAte: '1250,01' }) === 'c', ids({ valorDe: '1250,01', valorAte: '1250,01' }));
check('valor inválido não filtra', ids({ valorDe: 'abc' }) === 'a,b,c');
check('o filtro `documento` da ficha da pessoa continua exato', ids({ documento: '043.988.848-40' }) === 'a' && ids({ documento: '043988' }) === '');

console.log('\n--- 3. a rota ---');
const rota = server.slice(server.indexOf("if (pathname === '/api/finance/nfe' && req.method === 'GET')"), server.indexOf("if (pathname === '/api/finance/nfe' && req.method === 'POST')"));
check('carrega as parcelas das fiscais da página também', /nfe\.origem === 'financeiro' \|\| nfe\.origem === 'fiscal'/.test(rota));
check('devolve o total autorizado do filtro inteiro (não da página)',
  /filtered\.reduce\(\(soma, nfe\) => \(nfe\.status === 'autorizada'/.test(rota) && /valorAutorizado: centavosAutorizados \/ 100/.test(rota));

console.log('\n--- 4. a tela, rodando de verdade ---');
const AGORA = Date.now();
const horasAtras = (h) => new Date(AGORA - h * 3600000).toISOString();
const CHAVE = '42261043792899000569550010000051231719101868';
const LISTA = [
  { id: 'f-velha', origem: 'fiscal', modelo: 55, number: '5123', series: '1', date: '2026-10-11', status: 'autorizada', key: CHAVE,
    amount: 1500, customer: 'COMERCIO DE MOTOS ELETRICAS DO VALE DO ITAPOCU LTDA', clientDocument: '12345678000190', empresa: 'LOJA CENTRO',
    autorizadoEm: horasAtras(48), orderId: '',
    financialEntries: [{ id: 'p1', status: 'recebido' }, { id: 'p2', status: 'pendente' }, { id: 'p3', status: 'cancelado' }] },
  { id: 'f-nova', origem: 'fiscal', modelo: 55, number: '5124', series: '1', date: '2026-10-13', status: 'autorizada', key: CHAVE.replace('5123', '5124'),
    amount: 10, customer: 'Ana', clientDocument: '<b>x</b>', autorizadoEm: horasAtras(1), financialEntries: [] },
  { id: 'nfce-hora', origem: 'fiscal', modelo: 65, number: '90', series: '2', date: '2026-10-13', status: 'autorizada', key: '',
    amount: 5, customer: 'Consumidor', autorizadoEm: horasAtras(1), financialEntries: [] },
  { id: 'man-1', origem: 'financeiro', number: '10', series: '1', date: '2026-01-01', status: 'autorizada', key: '',
    amount: 7, customer: 'Manual', financialEntries: [{ id: 'q1', status: 'cancelado' }] },
  { id: 'imp-1', origem: 'importada', number: '20', series: '1', date: '2026-01-01', status: 'autorizada', key: '', amount: 3, customer: 'Viper', financialEntries: [] }
];

function montarTela(state, respostaDaLista) {
  const chamadas = [];
  const ouvintes = {};
  const elemento = (id) => ({
    id, hidden: false, innerHTML: '', dataset: {}, style: {},
    addEventListener: (ev, fn) => { ouvintes[`${id}:${ev}`] = fn; },
    remove() {}, setAttribute() {}, select() {}, querySelectorAll: () => [], focus() {}
  });
  const modais = [];
  const documentFalso = {
    getElementById: (id) => elemento(id),
    createElement: () => elemento('novo'),
    body: { appendChild: (el) => modais.push(el) }
  };
  const content = { innerHTML: '', querySelectorAll: (sel) => {
    if (sel !== '.finance-entry-row') return [];
    return [...content.innerHTML.matchAll(/class="cadastro-row-clickable[^"]*" data-id="([^"]+)"/g)].map((m) => {
      const linha = elemento(`linha-${m[1]}`);
      linha.dataset.id = m[1];
      return linha;
    });
  } };
  const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  class FormData { constructor(form) { this.form = form; } get(k) { return this.form.valores[k] ?? null; } }
  const api = async (url) => {
    chamadas.push(url);
    if (url.startsWith('/api/focusnfe/status')) return { configured: true, connected: true };
    if (url.startsWith('/api/finance/nfe?')) return respostaDaLista(new URLSearchParams(url.split('?')[1]));
    if (url.startsWith('/api/fiscal/nfe/')) {
      return { nfe: { id: 'f-velha', modelo: 55, autorizadoEm: horasAtras(48), numero: 5123, serie: 1, chaveAcesso: CHAVE,
        valorTotal: 1500, condicaoPagamento: { tipo: 'parcelado', parcelas: 3, intervaloDias: 30 }, payloadEnviado: { items: [] } } };
    }
    throw new Error(`rota inesperada ${url}`);
  };
  const ctx = vm.createContext({
    window: {}, document: documentFalso, navigator: {}, console, URLSearchParams, FormData, setTimeout,
    escapeHtml, financeFormatDate: (v) => String(v || ''), financeFormatBRL: (v) => `R$ ${Number(v || 0).toFixed(2)}`,
    financeStatusBadge: (s) => s, getSessionToken: () => '', promptModal: async () => null
  });
  vm.runInContext(ler('public/modules/shared/prazo_cancelamento.js'), ctx);
  vm.runInContext(ler('public/modules/finance/nfe_actions.js'), ctx);
  vm.runInContext(ler('public/modules/finance/subs/nfe_emitidas.js'), ctx);
  const toasts = [];
  const render = ctx.window.MavisSubscreenRegistry.finance.nfe_emitidas;
  const pronto = render({ content, api, showToast: (m, t) => toasts.push([t, m]), state, loadModule() {}, escapeHtml, confirmModal: async () => false });
  return { pronto, content, chamadas, ouvintes, modais, toasts };
}

const respostaPadrao = (q) => ({ nfes: LISTA, total: LISTA.length, page: Number(q.get('page')), limit: 30, valorAutorizado: 1525, empresas: [] });

(async () => {
  const t = montarTela({}, respostaPadrao);
  await t.pronto;
  const html = t.content.innerHTML;
  const linha = (id) => (html.split('<tr class="cadastro-row-clickable').find((l) => l.includes(`data-id="${id}"`)) || '');
  // 15/10/2026, pedido do usuário: sem as colunas "Lançamento financeiro" e
  // "Ações", e a chave inteira. Cancelar continua no painel de ações e na ficha,
  // com a mesma regra de prazo (motivoParaNaoCancelar).
  check('a linha não tem mais o botão Cancelar nem a contagem de parcelas',
    !/data-quick-cancel/.test(html) && !/parcelas? pagas?/.test(linha('f-velha')) && !/Lançamento financeiro<\/th>/.test(html) && !/<th>Ações<\/th>/.test(html));
  // Em blocos de 4, duas linhas (6 + 5 blocos), como na DANFE; a cópia leva sem espaços.
  const emBlocos = (t) => t.replace(/(\d{4})(?=\d)/g, '$1 ');
  check('a chave vai inteira (em blocos, duas linhas), com cópia sem espaços',
    linha('f-velha').includes(`data-copiar-chave="${CHAVE}"`)
    && linha('f-velha').includes(`>${emBlocos(CHAVE.slice(0, 24))}<br>${emBlocos(CHAVE.slice(24))}</button>`));
  check('cliente e empresa cortados, com o nome inteiro na dica',
    /<span class="texto-cortado is-medio" title="COMERCIO DE MOTOS ELETRICAS DO VALE DO ITAPOCU LTDA">/.test(linha('f-velha'))
    && /<span class="texto-cortado is-curto" title="LOJA CENTRO">/.test(linha('f-velha')));
  check('valor alinhado à direita (célula e cabeçalho)', /<td class="col-valor">R\$ 1500\.00<\/td>/.test(linha('f-velha')) && /<th class="col-valor" aria-sort/.test(html));
  check('documento fora do formato é escapado', linha('f-nova').includes('&lt;b&gt;x&lt;/b&gt;') && !linha('f-nova').includes('<b>x</b>'));
  check('o total autorizado do filtro aparece no cabeçalho', /Total autorizado: <strong[^>]*>R\$ 1525\.00<\/strong>/.test(html));
  check('busca anuncia CPF/CNPJ, e há Valor de / Valor até', html.includes('placeholder="Número, cliente, CPF/CNPJ ou chave"')
    && /name="valorDe" type="number" step="0\.01" min="0"/.test(html) && /name="valorAte" type="number" step="0\.01" min="0"/.test(html));
  check('as 11 colunas (colspan da linha vazia)', /colspan="11"/.test(ler('public/modules/finance/subs/nfe_emitidas.js')));

  // O modal da nota fiscal: condição de pagamento e parcelas da lista.
  const clique = t.ouvintes['linha-f-velha:click'];
  if (clique) clique({ target: { closest: () => null } });
  // O ouvinte da linha não devolve a promessa de openNfeModal: espera a fila.
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  const modal = (t.modais[0] || {}).innerHTML || '';
  check('modal: "Parcelado (3x)" pela condição gravada na nota', /Parcelado \(3x\)/.test(modal), modal ? 'modal aberto' : 'MODAL NÃO ABRIU');
  check('modal: as parcelas vinculadas aparecem', /data-view-entry="p1"/.test(modal) && !/Nenhum lançamento vinculado/.test(modal));
  check('modal: Cancelar NF-e desligado fora do prazo, e o motivo por extenso',
    /id="nfeModalCancel" disabled title="O prazo de 24 horas/.test(modal) && /<p class="muted">O prazo de 24 horas/.test(modal));

  console.log('\n--- 5. página além do fim e filtros que sobrevivem ---');
  // 100 notas = 4 páginas; vai para a 4; aí o filtro encolhe para 31 notas.
  let total = 100;
  const state = {};
  const t2 = montarTela(state, (q) => ({ nfes: LISTA.slice(0, 1), total, page: Number(q.get('page')), limit: 30, valorAutorizado: 0, empresas: [] }));
  await t2.pronto;
  await t2.ouvintes['nfeIrParaPagina:submit']({ preventDefault() {}, target: { querySelector: () => ({ value: '4' }) } });
  // 14/10/2026: a tela também pede as notas em edição; o que vale aqui é a
  // última chamada da LISTA de notas.
  const ultimaDaLista = () => [...t2.chamadas].reverse().find((c) => String(c).startsWith('/api/finance/nfe')) || '';
  check('"Ir para" busca a página pedida', /page=4/.test(ultimaDaLista()), ultimaDaLista());
  const antes = t2.chamadas.length;
  total = 31;
  t2.ouvintes['nfeIrParaPagina:submit']({ preventDefault() {}, target: { querySelector: () => ({ value: '4' }) } });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  const novas = t2.chamadas.slice(antes).filter((u) => u.startsWith('/api/finance/nfe?'));
  check('página 4 de 2: volta para a 2 com UMA recarga', novas.length === 2 && /page=4/.test(novas[0]) && /page=2/.test(novas[1]), novas.join(' | '));
  check('  e não fica "Página 4 de 2"', !/Página 4 de 2/.test(t2.content.innerHTML) && /Página 2 de 2/.test(t2.content.innerHTML));
  check('"Ir para" fora da faixa avisa em vez de buscar', (() => {
    const n = t2.chamadas.length;
    t2.ouvintes['nfeIrParaPagina:submit']({ preventDefault() {}, target: { querySelector: () => ({ value: '9' }) } });
    return t2.chamadas.length === n && t2.toasts.some(([tipo]) => tipo === 'warning');
  })());

  t2.ouvintes['nfeFilterForm:submit']({ preventDefault() {}, target: { valores: { search: '043.988', status: 'autorizada', valorDe: '100', valorAte: '2000' } } });
  await new Promise((r) => setImmediate(r));
  const ultima = ultimaDaLista();
  check('Filtrar manda valorDe/valorAte e volta à página 1', /valorDe=100/.test(ultima) && /valorAte=2000/.test(ultima) && /page=1/.test(ultima), ultima);
  check('os filtros ficam no state', state.nfeListaFiltros && state.nfeListaFiltros.valorDe === '100' && state.nfeListaFiltros.search === '043.988');
  const t3 = montarTela(state, respostaPadrao);
  await t3.pronto;
  const primeira = t3.chamadas.find((u) => u.startsWith('/api/finance/nfe?')) || '';
  check('sair e voltar: a tela reabre com os mesmos filtros', /valorDe=100/.test(primeira) && /status=autorizada/.test(primeira), primeira);
  check('  e os campos vêm preenchidos', /name="valorDe" type="number" step="0\.01" min="0" value="100"/.test(t3.content.innerHTML));
  t3.ouvintes['nfeFilterClear:click']();
  await new Promise((r) => setImmediate(r));
  const limpa = t3.chamadas[t3.chamadas.length - 1];
  check('Limpar filtros zera a busca e o state', !/valorDe|status=|search=/.test(limpa) && Object.values(state.nfeListaFiltros).every((v) => v === ''), limpa);

  const stateVelho = { nfeListaFiltros: { search: 'x', valorDe: 5, injetado: 'sim' } };
  const t4 = montarTela(stateVelho, respostaPadrao);
  await t4.pronto;
  const q4 = t4.chamadas.find((u) => u.startsWith('/api/finance/nfe?')) || '';
  check('state velho: só chave conhecida e só texto entram na busca', /search=x/.test(q4) && !/valorDe|injetado/.test(q4), q4);

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('XX o teste quebrou:', erro);
  process.exit(1);
});
