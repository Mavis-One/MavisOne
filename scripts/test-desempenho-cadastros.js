#!/usr/bin/env node
// CADASTROS SEM CARREGAR O QUE NÃO USA (rodada de desempenho, out/2026).
//
// Perguntas de sim ou não que carregavam tabelas inteiras para responder:
//
//   1. EXCLUIR PESSOA/CNPJ perguntava "tem lançamento financeiro?" carregando
//      os 27.362 lançamentos e as 25.709 baixas (syncFinanceData, ~530 ms e
//      ~37 MB no processo único). Um `exists` responde em ~15 ms no pior caso.
//
//   2. EXCLUIR CONTA BANCÁRIA, a mesma coisa para três perguntas (lançamento,
//      baixa, transação importada). E a terceira nunca disparava:
//      `data.bankTransactions` não era sincronizado por ninguém, e quem
//      segurava a exclusão era a chave estrangeira, com erro genérico.
//
//   3. A LISTA DE CASHBACK lia os 5.561 produtos para dar nome às regras —
//      com zero regras, para devolver [].
//
// O guarda de cada um é o mesmo: a pergunta continua sendo feita, à fonte
// certa, e o carregamento inteiro não volta.
//
// SEM BANCO: lê o fonte (sem comentários, que explicam justamente o padrão que
// saiu).
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = semComentarios(ler('server.js'));
// Corpo de uma função de primeiro nível do server.js, até a próxima.
function corpoDe(nome) {
  const ini = servidor.search(new RegExp(`\\n(?:async )?function ${nome}\\(`));
  if (ini < 0) return '';
  const resto = servidor.slice(ini + 1);
  const fim = resto.search(/\n(?:async )?function |\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim);
}
// Trecho de uma rota: do `if`/`match` dela até a próxima marca dada.
const trecho = (de, ate) => servidor.slice(servidor.indexOf(de), servidor.indexOf(ate, servidor.indexOf(de) + 1));

console.log('--- 1. excluir pessoa/CNPJ: "tem lançamento?" é um exists ---');
const contrapartida = corpoDe('contrapartidaEmUso');
check('contrapartidaEmUso existe', contrapartida.length > 0);
check('  e não carrega mais o Financeiro', !/syncFinanceData\(/.test(contrapartida));
check('  pergunta pela função do exists', /lancamentoDaContrapartida\(id\)/.test(contrapartida));
const lancamento = corpoDe('lancamentoDaContrapartida');
check('o exists olha a coluna da contrapartida',
  /select exists\(select 1 from financial_entries where client_supplier_id = \$1\) as existe/.test(lancamento));
// A ordem das mensagens é a mesma: financeiro primeiro.
check('a mensagem do financeiro continua sendo a primeira',
  contrapartida.indexOf('if (comFinanceiro)') > -1
  && contrapartida.indexOf('if (comFinanceiro)') < contrapartida.indexOf('if (comEquipamento > 0)'));

console.log('\n--- 2. excluir conta bancária: três exists, e a regra continua no cadastros-core ---');
const usos = corpoDe('usosDaContaBancaria');
check('lançamento (conta de origem OU de destino)',
  /from financial_entries\s+where bank_account_id = \$1 or target_bank_account_id = \$1\) as lancamentos/.test(usos));
check('baixa', /from financial_payments where bank_account_id = \$1\) as baixas/.test(usos));
check('transação importada (a que nunca disparava)', /from bank_transactions where bank_account_id = \$1\) as transacoes/.test(usos));
const exclusaoConta = trecho("const contaBancariaMatch = pathname.match(", "if (pathname === '/api/cadastros/deposits' && req.method === 'GET')");
check('a rota da conta não carrega mais o Financeiro', !/syncFinanceData\(/.test(exclusaoConta));
check('  e a regra (ordem e texto) continua sendo a do cadastros-core',
  /CADASTRO_COLLECTIONS\['bank-accounts'\]\.inUse\(id, dados\)/.test(exclusaoConta));
// Rodar a regra de verdade com as amostras que a rota monta: cada uso tem de
// virar a mensagem certa, na ordem certa.
{
  const regra = require(path.join(RAIZ, 'lib', 'cadastros-core')).CADASTRO_COLLECTIONS['bank-accounts'].inUse;
  const id = 'conta-1';
  const amostra = (ha) => (ha ? [{ bankAccountId: id }] : []);
  const com = (u, formas = []) => regra(id, {
    finance: amostra(u.lancamentos), financialPayments: amostra(u.baixas), bankTransactions: amostra(u.transacoes), paymentMethods: formas
  });
  check('lançamento → mensagem de lançamento', /lançamentos financeiros/.test(com({ lancamentos: true, baixas: true, transacoes: true }) || ''));
  check('só baixa → mensagem de baixa', /baixas registradas/.test(com({ baixas: true }) || ''));
  check('só transação → mensagem de transação importada', /transações importadas/.test(com({ transacoes: true }) || ''));
  check('nada no banco, forma de pagamento apontando → bloqueia pela forma',
    /formas de pagamento/.test(com({}, [{ bankAccountId: id }]) || ''));
  check('nada em lugar nenhum → livre', com({}) === null);
}

console.log('\n--- 3. cashback: sem regra, sem catálogo ---');
const cashback = trecho("if (pathname === '/api/cadastros/product-cashbacks' && req.method === 'GET')", 'const cadastroCollectionMatch = pathname.match(');
check('o catálogo só é lido quando há regra',
  /const regras = data\.productCashbacks \|\| \[\];[\s\S]{0,120}if \(regras\.length\) \{[\s\S]{0,200}db\.getProducts\(\{ incluirEscriturais: true \}\)/.test(cashback));
check('  e com regra continua o índice completo, com escriturais',
  /productsById = new Map\(\(await db\.getProducts\(\{ incluirEscriturais: true \}\)\)\.map\(\(p\) => \[p\.id, p\]\)\)/.test(cashback));

// ---------------------------------------------------------------------------
// 4-6. A TELA DE PESSOAS DEIXOU DE BAIXAR AS 6.492 A CADA CLIQUE.
//
// Ela pedia /pessoas + /cnpjs + /deposits inteiros para QUALQUER sub-tela, e
// de novo a cada um dos 31 redesenhos (virar página, ordenar, Buscar, abrir a
// edição, cada erro de validação): 7.425 KB cru, 695 KB gzip por clique. Agora
// a lista vem paginada do servidor (~6 KB gzip), a edição abre pelo id e a
// duplicidade é perguntada na hora de salvar.
// ---------------------------------------------------------------------------
const app = semComentarios(ler('public/app.js'));
const bloco = app.slice(app.indexOf("if (moduleName === 'cadastros') {"), app.indexOf("const renderPeopleRegister = (mode = 'register') => {"));

console.log('\n--- 4. cada sub-tela de Pessoas busca só o que usa ---');
check('nenhuma sub-tela baixa mais as listas inteiras de pessoas e CNPJs',
  !/api\('\/api\/cadastros\/pessoas'\)/.test(app) && !/api\('\/api\/cadastros\/cnpjs'\)/.test(app));
check('a lista pede SÓ a página, com os filtros e os limites de data do navegador',
  /if \(sub === 'list'\) \{[\s\S]{0,200}Lista\.limitesDeData\(listFilters\.dateStart, listFilters\.dateEnd\)[\s\S]{0,250}await api\(`\/api\/cadastros\/lista\?\$\{consulta\.toString\(\)\}`\)/.test(bloco));
check('Depósitos pede só os depósitos', /\} else if \(sub === 'deposits'\) \{\s*\n\s*const depositsResponse = await api\('\/api\/cadastros\/deposits'\);/.test(bloco));
check('  e nenhuma outra sub-tela pede nada (o rascunho vem do estado)',
  (bloco.match(/await api\(/g) || []).length === 2, String((bloco.match(/await api\(/g) || []).length));

console.log('\n--- 5. editar abre com o registro INTEIRO; salvar pergunta a duplicidade ---');
// A linha da lista traz só o que a tabela desenha. Abrir o formulário com ela
// e salvar gravaria vazio por cima de endereço, contatos e dados bancários.
const abrir = app.slice(app.indexOf('const openCadastroRowForEdit = async (kind, id) => {'));
check('a edição busca o cadastro pelo id', /\/api\/cadastros\/cnpjs\/\$\{encodeURIComponent\(id\)\}/.test(abrir.slice(0, 900))
  && /\/api\/cadastros\/pessoas\/\$\{encodeURIComponent\(id\)\}/.test(abrir.slice(0, 900)));
check('  e não abre se não conseguir', /if \(!registro\) return;/.test(abrir.slice(0, 1200)));
check('  em vez de abrir com a linha da lista', !/people\.find\(|cnpjs\.find\(/.test(app));
check('o servidor devolve o registro completo, pela mesma função da lista',
  /const registro = ehCnpj \? await db\.getCnpjById\(id\) : await db\.getPersonById\(id\);/.test(servidor));
check('a duplicidade é perguntada nos dois formulários antes de salvar',
  (app.match(/duplicidadeDoCadastro = await perguntarDuplicidadeDeCadastro\(payload, payload\.id\)/g) || []).length === 2);

console.log('\n--- 6. a página sai do servidor, pelas regras do módulo compartilhado ---');
const rotaLista = trecho("if (pathname === '/api/cadastros/lista' && req.method === 'GET')", 'const registro = ehCnpj');
check('a rota monta a página com o módulo da tela',
  /listaDeCadastros\.montarPagina\(people, cnpjs, filtros, limites, memoDaBuscaDeCadastros\)/.test(rotaLista));
check('  sobre o mesmo cache que /pessoas e /cnpjs devolvem',
  /const \[people, cnpjs\] = await Promise\.all\(\[db\.getPeople\(\), db\.getCnpjs\(\)\]\);/.test(rotaLista));
check('  e usa os limites de data que vieram do navegador quando vieram',
  /url\.searchParams\.has\('inicio'\) \|\| url\.searchParams\.has\('fim'\)/.test(rotaLista));
{
  // O texto de busca guardado é chaveado pelo CONTEÚDO da linha: editar uma
  // pessoa tem de fazer a busca enxergar o nome novo, e não o guardado.
  const Lista = require(path.join(RAIZ, 'public/modules/shared/lista_de_cadastros.js'));
  const memo = new Map();
  const filtros = Lista.normalizarFiltros({ query: 'beatriz' });
  const busca = (pessoas) => Lista.filtrar(Lista.projetar(pessoas, []), filtros, {}, memo).map((r) => r.id).join(',');
  const antes = [{ id: 'p1', code: '1', name: 'Ana' }, { id: 'p2', code: '2', name: 'Beatriz' }];
  check('com o texto guardado, a busca acha o mesmo que sem ele', busca(antes) === 'p2'
    && Lista.filtrar(Lista.projetar(antes, []), filtros, {}).map((r) => r.id).join(',') === 'p2');
  const depois = [{ id: 'p1', code: '1', name: 'Ana Beatriz' }, { id: 'p2', code: '2', name: 'Bia' }];
  check('  e linha editada é normalizada de novo (nada velho sai do guardado)', busca(depois) === 'p1', busca(depois));
  // O memo mora no processo do servidor e é chaveado pelo id: sem poda, o
  // cadastro excluído ficaria nele até o PM2 reiniciar (achado da revisão).
  const semP2 = [{ id: 'p1', code: '1', name: 'Ana Beatriz' }, { id: 'p3', code: '3', name: 'Caio' }];
  const achou = busca(semP2);
  check('  e cadastro excluído sai do guardado na busca seguinte',
    achou === 'p1' && !memo.has('p2') && memo.size <= semP2.length, `${achou} · ${[...memo.keys()].join(',')}`);
}

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
