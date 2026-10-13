#!/usr/bin/env node
/**
 * CONCILIAÇÃO BANCÁRIA: A REVISÃO DA FASE EI (13/10/2026) — sem banco e sem
 * servidor.
 *
 * Pedido do usuário: "uma geral no módulo financeiro ... diminua o campo de
 * descrição ... pesquisa por valores, organização, ordenação, seleção". Na
 * Conciliação Bancária a revisão achou, além do que faltava, defeitos de
 * verdade. Cada bloco segura um deles:
 *
 *   1. a data da linha importada era gravada como viesse ("13/10/2026"), e a
 *      movimentação sumia do filtro por período (roda lib/extrato-bancario.js);
 *   2. ordem só por data, e os cartões contados depois do filtro de situação
 *      (filtrar "Conciliado" zerava "Não conciliadas");
 *   3. a busca só olhava a descrição: agora casa o valor ("1.250,00") e tem
 *      faixa de valor — roda a filterBankTransactions do PRÓPRIO server.js;
 *   4. clique duplo em "Conciliar com este" gravava duas baixas;
 *   5. estornar a baixa em Lançamentos deixava a movimentação "Conciliado"
 *      apontando para uma baixa apagada;
 *   6. a tela: descrição cortada, data escapada, página que deixou de existir,
 *      busca manual pelo tipo certo, ordenação, itens por página e lote.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { semComentarios } = require('./sem-comentarios');
const extrato = require('../lib/extrato-bancario');
const listaDeLancamentos = require('../public/modules/shared/lancamentos_lista');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
function corpoDe(nome) {
  const marca = [`\nfunction ${nome}(`, `\nasync function ${nome}(`].find((m) => src.includes(m));
  if (!marca) throw new Error(`server.js não tem mais a função ${nome}`);
  const ini = src.indexOf(marca);
  return src.slice(ini, src.indexOf('\n}', ini + 1) + 2);
}
// O corpo de uma rota: do `if (...)` de dois espaços que contém a marca até o
// próximo `if (` de dois espaços.
function rotaQueContem(marca) {
  const linhas = src.split('\n');
  const de = linhas.findIndex((l) => /^ {2}if \(/.test(l) && l.includes(marca));
  if (de < 0) throw new Error(`rota não encontrada: ${marca}`);
  let ate = de + 1;
  while (ate < linhas.length && !/^ {2}if \(/.test(linhas[ate])) ate += 1;
  return semComentarios(linhas.slice(de, ate).join('\n'));
}

console.log('--- 1. a data da linha do extrato ---');
check('AAAA-MM-DD entra como veio', extrato.dataDoExtrato('2026-10-13') === '2026-10-13');
check('dd/mm/aaaa (CSV de banco brasileiro) vira AAAA-MM-DD', extrato.dataDoExtrato('13/10/2026') === '2026-10-13');
check('hora junto é tolerada', extrato.dataDoExtrato('2026-10-13 00:00:00') === '2026-10-13'
  && extrato.dataDoExtrato('2026-10-13T12:00:00-03:00') === '2026-10-13'
  && extrato.dataDoExtrato('13/10/2026 08:30') === '2026-10-13');
check('data que não existe no calendário: null', extrato.dataDoExtrato('31/02/2026') === null && extrato.dataDoExtrato('2026-13-01') === null);
check('vazio: null (não vira "hoje")', extrato.dataDoExtrato('') === null && extrato.dataDoExtrato(undefined) === null);
check('marcação HTML no lugar da data: null', extrato.dataDoExtrato('<img src=x onerror=alert(1)>') === null);
check('ambíguo fica de fora (13-10-2026, 13/10/26)', extrato.dataDoExtrato('13-10-2026') === null && extrato.dataDoExtrato('13/10/26') === null);

const rotaImportar = rotaQueContem("'/api/finance/bank-transactions/import'");
check('a importação normaliza a data da linha',
  /const date = extratoBancario\.dataDoExtrato\(row\.date \|\| row\.data \|\| row\.Data\);\s*if \(!date\) \{\s*skipped \+= 1;\s*return;\s*\}/.test(rotaImportar));
check('  e não inventa "hoje" para a linha sem data', !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(rotaImportar));
const rotaNova = rotaQueContem("pathname === '/api/finance/bank-transactions' && req.method === 'POST'");
check('o lançamento manual confere a data (400 se inválida)',
  /const date = extratoBancario\.dataDoExtrato\(body\.date\);\s*if \(!date\) \{\s*return sendJson\(res, \{ error: '[^']+' \}, 400\);/.test(rotaNova)
  && /buildBankTransaction\(\{ \.\.\.body, amount, date \}/.test(rotaNova));

console.log('\n--- 2. ordem e cartões ---');
const q = (s) => new URLSearchParams(s);
check('sem ?sort=: data decrescente', JSON.stringify(extrato.ordemDoExtrato(q(''))) === JSON.stringify({ campo: 'data', direcao: 'desc' }));
check('valor começa do maior; texto, de A a Z',
  extrato.ordemDoExtrato(q('sort=valor')).direcao === 'desc' && extrato.ordemDoExtrato(q('sort=descricao')).direcao === 'asc');
check('chave desconhecida cai na data', extrato.ordemDoExtrato(q('sort=__proto__')).campo === 'data' && extrato.ordemDoExtrato(q('sort=xyz&dir=asc')).campo === 'data');
const amostra = () => [
  { id: 'a', date: '2026-10-01', amount: 10, type: 'entrada', status: 'conciliado', bankAccountId: 'c2', description: 'Ágata' },
  { id: 'b', date: '2026-10-02', amount: 50, type: 'saida', status: 'nao_conciliado', bankAccountId: 'c1', description: 'banco' },
  { id: 'c', date: '2026-10-02', amount: 0.1, type: 'entrada', status: 'nao_conciliado', bankAccountId: 'c1', description: 'Caixa' },
  { id: 'd', date: '2026-10-03', amount: 0.2, type: 'entrada', status: 'ignorado', bankAccountId: 'c2', description: 'agua' }
];
const ids = (l) => l.map((t) => t.id).join(',');
check('valor ordena COM sinal (saída é negativa, como a coluna mostra)',
  ids(extrato.ordenarExtrato(amostra(), { campo: 'valor', direcao: 'desc' })) === 'a,d,c,b');
check('situação: não conciliado primeiro, desempate pela data mais recente',
  ids(extrato.ordenarExtrato(amostra(), { campo: 'status', direcao: 'asc' })) === 'c,b,a,d');
check('descrição sem diferença de acento e maiúscula',
  ids(extrato.ordenarExtrato(amostra(), { campo: 'descricao', direcao: 'asc' })) === 'a,d,b,c');
const nomes = { c1: 'Sicoob', c2: 'Banco do Brasil' };
check('conta ordena pelo NOME, não pelo id',
  ids(extrato.ordenarExtrato(amostra(), { campo: 'conta', direcao: 'asc' }, (tx) => nomes[tx.bankAccountId])) === 'd,a,c,b');
check('desempate estável: data decrescente, depois id',
  ids(extrato.ordenarExtrato(amostra(), { campo: 'tipo', direcao: 'asc' })) === 'd,c,a,b');
const resumo = extrato.resumoDoExtrato(amostra().concat([{ id: 'e', amount: 0.2, type: 'entrada', status: 'nao_conciliado' }]));
check('cartões: contagem por situação', resumo.naoConciliado === 3 && resumo.conciliado === 1 && resumo.ignorado === 1);
check('cartões: soma em centavos (0,10 + 0,20 = 0,30 exato)', resumo.valores.naoConciliado.entrada === 0.3 && resumo.valores.naoConciliado.saida === 50);

const rotaLista = rotaQueContem("pathname === '/api/finance/bank-transactions' && req.method === 'GET'");
check('a lista ordena por ?sort=/?dir=', /extratoBancario\.ordemDoExtrato\(url\.searchParams\)/.test(rotaLista) && /extratoBancario\.ordenarExtrato\(/.test(rotaLista));
check('  e lê o cadastro de contas ANTES de ordenar por conta', /if \(ordenaPorConta\) await syncFinanceCadastroData\(data\);[\s\S]*ordenarExtrato\(/.test(rotaLista));
check('os cartões contam SEM o filtro de situação',
  /const semStatus = new URLSearchParams\(url\.searchParams\);\s*semStatus\.delete\('status'\);\s*const summary = extratoBancario\.resumoDoExtrato\(filterBankTransactions\(data, semStatus\)\);/.test(rotaLista));

console.log('\n--- 3. busca por valor e faixa de valor (a função do server.js) ---');
const caixa = { listaDeLancamentos, URLSearchParams };
vm.createContext(caixa);
vm.runInContext(`${corpoDe('normalizeText')}\n${corpoDe('filterBankTransactions')}\nthis.filterBankTransactions = filterBankTransactions;`, caixa);
const dados = {
  bankTransactions: [
    { id: '1', date: '2026-10-01', amount: 1250, type: 'entrada', status: 'nao_conciliado', description: 'PIX RECEBIDO JOÃO' },
    { id: '2', date: '2026-10-02', amount: 25.5, type: 'saida', status: 'nao_conciliado', description: 'Tarifa bancária' },
    { id: '3', date: '2026-10-03', amount: 1250.01, type: 'entrada', status: 'conciliado', description: 'TED 1250 recebida' },
    { id: '4', date: '2026-10-04', amount: 980, type: 'entrada', status: 'ignorado', description: 'Estorno' }
  ]
};
const filtrar = (s) => ids(caixa.filterBankTransactions(dados, q(s)));
check('"1.250,00" acha o valor exato (e não 1.250,01)', filtrar('search=1.250,00') === '1', filtrar('search=1.250,00'));
check('"R$ 25,50" acha a tarifa', filtrar('search=' + encodeURIComponent('R$ 25,50')) === '2');
check('"1250" acha pelo valor E pela descrição', filtrar('search=1250') === '1,3');
check('descrição sem acento e sem maiúscula ("joao", "BANCARIA")', filtrar('search=joao') === '1' && filtrar('search=BANCARIA') === '2');
check('faixa de valor', filtrar('amountMin=900&amountMax=1250') === '1,4', filtrar('amountMin=900&amountMax=1250'));
check('faixa com vírgula decimal', filtrar('amountMin=25,50&amountMax=25,50') === '2');
check('faixa que não é número não esvazia a lista', filtrar('amountMin=abc') === '1,2,3,4');
check('o filtro de situação continua', filtrar('status=nao_conciliado') === '1,2');

console.log('\n--- 4. clique duplo não concilia duas vezes ---');
check('o servidor tem a trava por movimentação', /\nconst conciliacoesEmAndamento = new Set\(\);/.test(src));
const rotaConciliar = rotaQueContem('\\/conciliar$/');
const posTrava = rotaConciliar.indexOf('conciliacoesEmAndamento.add(id);');
check('recusa com 409 quem chega com a mesma em andamento',
  /if \(conciliacoesEmAndamento\.has\(id\)\) \{\s*return sendJson\(res, \{ error: '[^']+' \}, 409\);/.test(rotaConciliar));
// Entre ler o db.json e travar não pode haver espera: o primeiro await da rota
// depois do loadData() tem de vir DEPOIS da trava.
const posLoad = rotaConciliar.indexOf('loadData()');
const primeiroAwaitDepoisDoLoad = rotaConciliar.indexOf('await ', posLoad);
check('  e trava antes do primeiro await depois de ler o db.json', posTrava > posLoad && posTrava < primeiroAwaitDepoisDoLoad,
  `trava ${posTrava}, load ${posLoad}, await ${primeiroAwaitDepoisDoLoad}`);
check('  e destrava no finally (sucesso, recusa ou erro)',
  /\} finally \{\s*if \(conciliacaoTravada\) conciliacoesEmAndamento\.delete\(conciliacaoTravada\);\s*\}/.test(rotaConciliar));
const tela = semComentarios(ler('public/modules/finance/subs/extrato_open_finance.js'));
check('a tela ignora o segundo clique e desliga os botões',
  /async function doConciliar\(entryId\) \{\s*if \(enviando\) return;\s*enviando = true;\s*botoesDeConciliar\(true\);/.test(tela));
check('  e religa se a conciliação falhar', /enviando = false;\s*botoesDeConciliar\(false\);/.test(tela));

console.log('\n--- 5. estornar a baixa conciliada desconcilia a movimentação ---');
const rotaEstorno = rotaQueContem('\\/estorno$/');
check('procura a movimentação pela BAIXA estornada',
  /const transacaoConciliada = \(data\.bankTransactions \|\| \[\]\)\.find\(\(tx\) => tx\.matchedPaymentId === last\.id\);/.test(rotaEstorno));
check('  e a devolve a Não conciliado, sem o vínculo',
  /transacaoConciliada\.status = 'nao_conciliado';\s*transacaoConciliada\.matchedEntryId = '';\s*transacaoConciliada\.matchedPaymentId = '';/.test(rotaEstorno));
check('  antes de gravar o db.json', rotaEstorno.indexOf("transacaoConciliada.status = 'nao_conciliado'") < rotaEstorno.indexOf('saveData(data)'));
check('  e a auditoria diz que desconciliou', /transacaoDesconciliada: transacaoConciliada\.id/.test(rotaEstorno));

console.log('\n--- 6. a tela ---');
check('data escapada na tabela e na janela', /<td>\$\{escapeHtml\(financeFormatDate\(tx\.date\)\)\}<\/td>/.test(tela)
  && !/[^(]financeFormatDate\([^)]*\)\}/.test(tela.replace(/escapeHtml\(financeFormatDate\([^)]*\)\)/g, '')));
check('descrição cortada, inteira no title', /<span class="texto-cortado"[^>]*title="\$\{escapeHtml\(tx\.description\)\}">\$\{escapeHtml\(tx\.description\)\}<\/span>/.test(tela));
check('coluna Conciliação cortada também', /class="finance-clickable-row texto-cortado is-curto" data-view-entry=/.test(tela));
check('valor à direita (col-valor) no th e no td', /cabecalhoOrdenavel\('valor', 'col-valor'\)/.test(tela) && /<td class="col-valor /.test(tela));
check('página que deixou de existir volta para a última',
  /const ultimaPagina = Math\.max\(1, Math\.ceil\(result\.total \/ limit\)\);\s*if \(page > ultimaPagina\) \{\s*page = ultimaPagina;\s*return load\(\);/.test(tela));
check('busca manual pede o tipo da movimentação, só os em aberto, e 50 por vez',
  /const tipoDoLancamento = tx\.type === 'entrada' \? 'receita' : 'despesa';/.test(tela)
  && /\/api\/finance\/entries\?search=\$\{encodeURIComponent\(term\)\}&type=\$\{tipoDoLancamento\}&status=pendente,vencido,parcial&limit=50/.test(tela));
check('  e a janela recebe a movimentação inteira', /openConciliarModal\(tx\)/.test(tela) && /async function openConciliarModal\(tx\)/.test(tela));
check('a lista manda ?sort= e ?dir=', /sort: ordem\.campo, dir: ordem\.direcao/.test(tela));
const colunasDaTela = /const COLUNAS_ORDENAVEIS = \{([^}]*)\}/.exec(tela);
const chavesDaTela = colunasDaTela ? [...colunasDaTela[1].matchAll(/(\w+):/g)].map((m) => m[1]) : [];
check('toda coluna com seta é ordenável no servidor',
  chavesDaTela.length > 0 && chavesDaTela.every((k) => Object.prototype.hasOwnProperty.call(extrato.ORDENS_DO_EXTRATO, k)), chavesDaTela.join(','));
check('itens por página: 15, 30, 50, 100 (o servidor aceita até 100)', /const POR_PAGINA = \[15, 30, 50, 100\];/.test(tela)
  && /function parsePageParams\(searchParams, defaultLimit = 20, maxLimit = 100\)/.test(src));
check('seleção por linha e da página', /data-selecionar="\$\{escapeHtml\(tx\.id\)\}"/.test(tela) && /id="extratoSelecionarTodas"/.test(tela));
check('lote: Ignorar só não conciliadas, Reativar só ignoradas',
  /ignorar: \{ rotulo: 'Ignorar', situacao: 'nao_conciliado'/.test(tela) && /reativar: \{ rotulo: 'Reativar', situacao: 'ignorado'/.test(tela));
check('  pelas mesmas rotas da linha, uma por vez',
  /for \(const tx of alvos\) \{\s*try \{\s*await api\(`\/api\/finance\/bank-transactions\/\$\{encodeURIComponent\(tx\.id\)\}\/\$\{acao\}`, \{ method: 'POST' \}\);/.test(tela));
check('busca e filtro de faixa de valor na tela', /name="amountMin"/.test(tela) && /name="amountMax"/.test(tela) && /Descrição ou valor/.test(tela));
// O cabeçalho escrevia "2 movimentaçãoões": o sufixo 'ões' ia colado em
// "movimentação" (fase EI). Agora a palavra inteira muda com o total.
check('cabeçalho no plural certo ("2 movimentações", não "movimentaçãoões")',
  /result\.total === 1 \? 'movimentação' : 'movimentações'/.test(tela) && !/movimentaçãoões|movimentação\$\{/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
