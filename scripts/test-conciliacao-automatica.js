// A CONCILIAÇÃO AUTOMÁTICA E UM PAGAMENTO PARA VÁRIOS TÍTULOS (28/10/2026).
//
// Pedido do usuário: "faça a conciliação automática de valores únicos" — "a
// conciliação deve ocorrer com os dados batendo, empresa, fornecedor, valores e
// datas, isso vai ocorrer automaticamente; se houver mais de um valor ela não é
// conciliada automaticamente e se tiver mais de um lançamento para isso também
// não" — "e coloque que um valor de pagamento através do arquivo OFX pode
// descontar de vários lançamentos diferentes".
const fs = require('fs');
const path = require('path');
const C = require('../lib/conciliacao-automatica');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// QUATRO COISAS DESDE 10/11/2026 (pedido do usuário: "o sistema está
// conciliando contas bancárias erradas, vamos refazer as validações pra
// conciliação automática: conta bancária, fornecedor, valor e data"). De 05/11
// a 10/11 era empresa, valor e data: uma empresa tem várias contas, e o título
// do Itaú se baixava pelo extrato do Sicoob.
console.log('--- 1. o fornecedor (ou cliente) ---');
check('as palavras do nome que contam', C.palavrasDoNome('Distribuidora de Bebidas Souza LTDA').join() === 'DISTRIBUIDORA,BEBIDAS,SOUZA'
  && C.palavrasDoNome('CLARO S.A.').join() === 'CLARO' && !C.palavrasDoNome('-').length);
check('o nome na descrição', C.fornecedorBate({ texto: 'PAGAMENTO CLARO 10/2026', nome: 'CLARO S.A.' }));
check('  as duas primeiras palavras, com corte do banco de 4 letras ou mais',
  C.fornecedorBate({ texto: 'PIX DISTRIB BEBIDAS', nome: 'Distribuidora de Bebidas Souza' })
  && !C.fornecedorBate({ texto: 'PIX DIS BEBIDAS', nome: 'Distribuidora de Bebidas Souza' }));
check('  uma palavra só não basta quando o nome tem duas', !C.fornecedorBate({ texto: 'PIX BEBIDAS', nome: 'Distribuidora de Bebidas Souza' }));
check('  sem acento e sem caixa', C.fornecedorBate({ texto: 'pix joao ferragens', nome: 'João Ferragens' }));
check('o CNPJ na descrição (com ou sem pontuação) ou no campo do banco',
  C.fornecedorBate({ texto: 'TED 12.345.678/0001-90', nome: 'X', documento: '12345678000190' })
  && C.fornecedorBate({ texto: 'TED', documentos: ['12.345.678/0001-90'], nome: 'X', documento: '12345678000190' }));
check('sem nome no título, nunca', !C.fornecedorBate({ texto: 'PAGAMENTO', nome: '-' }) && !C.fornecedorBate({ texto: 'PAGAMENTO', nome: '' }));

console.log('\n--- 2. a data ---');
check('no vencimento', C.dataBate('2026-10-20', '2026-10-20'));
check('  no dia útil seguinte (compensação)', C.dataBate('2026-10-21', '2026-10-20'));
check('  dois dias depois, não', !C.dataBate('2026-10-22', '2026-10-20'));
check('  antes do vencimento, não', !C.dataBate('2026-10-19', '2026-10-20'));
check('vencimento na sexta: até a segunda', C.dataBate('2026-10-26', '2026-10-23') && !C.dataBate('2026-10-27', '2026-10-23'));
check('vencimento no sábado: até a segunda', C.dataBate('2026-10-26', '2026-10-24'));

console.log('\n--- 3. os pares ---');
const ITAU = 'conta-itau';
const SICOOB = 'conta-sicoob';
const tit = (id, extra) => ({ id, tipo: 'despesa', esperado: 100, conta: ITAU, vencimento: '2026-10-20', nome: 'CLARO S.A.', documento: '', ...extra });
const mov = (id, extra) => ({ id, tipo: 'despesa', valor: 100, data: '2026-10-20', conta: ITAU, texto: 'PAGAMENTO CLARO', documentos: [], ...extra });
const pares = (args) => C.paresAutomaticos(args);
let r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('t2', { esperado: 50 })] });
check('conta, fornecedor, valor e data batendo: concilia', r.pares.length === 1 && r.pares[0].tituloId === 't1', JSON.stringify(r));

console.log('\n--- 3a. a conta bancária (a queixa de 10/11/2026) ---');
r = pares({ movimentacoes: [mov('m1', { conta: SICOOB })], titulos: [tit('t1')] });
check('título do Itaú, extrato do Sicoob: não', !r.pares.length && /outra conta bancária/.test(r.motivos.m1) && !r.sugestoes.length, JSON.stringify(r));
r = pares({ movimentacoes: [mov('m1'), mov('m2', { conta: SICOOB })], titulos: [tit('t1'), tit('t2', { conta: SICOOB })] });
check('o mesmo fornecedor, valor e data nas duas contas: cada extrato com o título da sua conta',
  r.pares.length === 2 && r.pares.find((p) => p.movimentacaoId === 'm1').tituloId === 't1'
  && r.pares.find((p) => p.movimentacaoId === 'm2').tituloId === 't2', JSON.stringify(r.pares));
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1', { conta: '' })] });
check('título sem conta bancária: nunca sozinho', !r.pares.length && /não tem conta bancária/.test(r.motivos.m1) && !r.sugestoes.length);
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('t2', { conta: '' })] });
check('  e trava o da conta quando tem o mesmo fornecedor, valor e data (pode ser ele)',
  !r.pares.length && /sem conta bancária/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('t2', { conta: '', nome: 'VIVO S.A.' })] });
check('  de outro fornecedor, não trava', r.pares.length === 1 && r.pares[0].tituloId === 't1');
r = pares({ movimentacoes: [mov('m1', { conta: '' })], titulos: [tit('t1')] });
check('movimentação sem conta: não', !r.pares.length && /movimentação não tem conta/.test(r.motivos.m1));

console.log('\n--- 3b. fornecedor, valor e data ---');
r = pares({ movimentacoes: [mov('m1', { texto: 'DEB.TIT.COMPE EFETIVADO' })], titulos: [tit('t1')] });
check('sem o nome na descrição: não concilia, SUGERE (único da conta e do valor)',
  !r.pares.length && /fornecedor\/cliente/.test(r.motivos.m1) && r.sugestoes.length === 1 && r.sugestoes[0].tituloId === 't1', JSON.stringify(r));
r = pares({ movimentacoes: [mov('m1', { texto: 'TED 12.345.678/0001-90' })], titulos: [tit('t1', { nome: 'Fornecedor X', documento: '12345678000190' })] });
check('o CNPJ do fornecedor na descrição: concilia', r.pares.length === 1);
r = pares({ movimentacoes: [mov('m1', { data: '2026-10-17' })], titulos: [tit('t1')] });
check('pago antes do vencimento, no mês: não concilia, SUGERE', !r.pares.length && /data/.test(r.motivos.m1) && r.sugestoes.length === 1);
r = pares({ movimentacoes: [mov('m1', { data: '2026-11-25' })], titulos: [tit('t1')] });
check('  fora do mês do vencimento: nem sugere', !r.pares.length && !r.sugestoes.length);
r = pares({ movimentacoes: [mov('m1', { valor: 100.01 })], titulos: [tit('t1')] });
check('um centavo de diferença: não', !r.pares.length && /nenhum título/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1', { tipo: 'receita' })], titulos: [tit('t1')] });
check('entrada não casa com despesa', !r.pares.length);
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('t2')] });
check('dois títulos da conta, do fornecedor, do valor e da data: não', !r.pares.length && /mais de um título/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('v1', { nome: 'VIVO S.A.' })] });
check('outro fornecedor com o mesmo valor e data na conta: não atrapalha', r.pares.length === 1 && r.pares[0].tituloId === 't1');
r = pares({ movimentacoes: [mov('m1', { texto: 'PAGAMENTO' })], titulos: [tit('t1'), tit('v1', { nome: 'VIVO S.A.' })] });
check('  mas sem nome nenhum, com dois da conta no mês: nem sugere', !r.pares.length && !r.sugestoes.length);
r = pares({ movimentacoes: [mov('m1'), mov('m2', { texto: 'CLARO TELEFONE' })], titulos: [tit('t1')] });
check('duas movimentações para o mesmo título: nenhuma', !r.pares.length && /mais de uma movimentação/.test(r.motivos.m1) && /mais de uma movimentação/.test(r.motivos.m2));
r = pares({ movimentacoes: [mov('m1'), mov('m2')], alvos: ['m1'], titulos: [tit('t1')] });
check('  mesmo com a outra fora do arquivo importado', !r.pares.length && Object.keys(r.motivos).join() === 'm1');
r = pares({ movimentacoes: [mov('m1'), mov('m2', { valor: 50 })], alvos: ['m2'], titulos: [tit('t1'), tit('t2', { esperado: 50 })] });
check('só os alvos (o arquivo importado, o filtro)', r.pares.length === 1 && r.pares[0].movimentacaoId === 'm2');

console.log('\n--- 3c. parcelas do mesmo fornecedor ---');
const parcelas = ['2026-09-10', '2026-10-13', '2026-11-10', '2026-12-10'].map((v, i) => tit(`p${i + 1}`, { vencimento: v }));
r = pares({ movimentacoes: [mov('m1', { data: '2026-10-13' }), mov('m2', { data: '2026-11-10' }), mov('m3', { data: '2026-12-10' })], titulos: parcelas });
check('cada movimentação com a parcela que vence na data dela',
  r.pares.length === 3 && r.pares.map((p) => p.tituloId).join() === 'p2,p3,p4', JSON.stringify(r.pares));
r = pares({ movimentacoes: [mov('m1', { data: '2026-11-03' })], titulos: parcelas });
check('paga antes do vencimento: não é mais automática, a do mês fica SUGERIDA',
  !r.pares.length && r.sugestoes.length === 1 && r.sugestoes[0].tituloId === 'p3', JSON.stringify(r));
r = pares({ movimentacoes: [mov('m1', { data: '2026-11-03' }), mov('m2', { data: '2026-11-05' })], titulos: parcelas });
check('  duas movimentações querendo a mesma parcela: nem sugere', !r.sugestoes.length);
r = pares({ movimentacoes: [mov('m1', { data: '2026-11-10' }), mov('m2', { data: '2026-11-04' })], titulos: parcelas });
check('  a parcela que já casou com uma não é sugerida para outra', r.pares.length === 1 && !r.sugestoes.length);

console.log('\n--- 4. o servidor ---');
const servidor = ler('server.js');
check('a importação concilia o que acabou de entrar', /automatica = await conciliarAutomaticamente\(user, \(tx\) => novas\.has\(tx\.id\)\);/.test(servidor)
  && /conciliadasAutomaticamente: automatica\.conciliadas,/.test(servidor));
check('  e o botão, as do filtro da tela', servidor.includes("pathname === '/api/finance/bank-transactions/conciliar-automatico' && req.method === 'POST'")
  && /const resultado = await conciliarAutomaticamente\(user, \(tx\) => doFiltro\.has\(tx\.id\)\);/.test(servidor));
const auto = servidor.slice(servidor.indexOf('async function conciliarAutomaticamente('));
check('a conta do título é a dele, e a da movimentação a do extrato (10/11/2026)',
  /conta: String\(entry\.bankAccountId \|\| ''\),/.test(auto) && /conta: String\(tx\.bankAccountId \|\| ''\),/.test(auto)
  && /documento: resolveFinanceCounterpartyDocument\(entry, data\)/.test(auto)
  && /texto: \[tx\.description, tx\.counterpartyName, tx\.merchantName\]/.test(auto));
check('  e a baixa confere a conta de novo', /if \(!tx\.bankAccountId \|\| String\(entry\.bankAccountId \|\| ''\) !== String\(tx\.bankAccountId\)\) continue;/.test(auto));
check('  a sugestão de antes, de outra conta, é recusada ao confirmar',
  /if \(!tx\.bankAccountId \|\| String\(entry\.bankAccountId \|\| ''\) !== String\(tx\.bankAccountId\)\) \{ recusar\('o título sugerido é de outra conta bancária'\); continue; \}/.test(servidor));
check('  a empresa da conta não decide mais', !/raizDaContaDe/.test(auto.slice(0, auto.indexOf('async function aplicarRegrasDoExtrato('))));
check('  trava as movimentações tentadas e destrava no fim', /travadas\.forEach\(\(id\) => conciliacoesEmAndamento\.add\(id\)\);/.test(auto)
  && /\} finally \{\s*travadas\.forEach\(\(id\) => conciliacoesEmAndamento\.delete\(id\)\);/.test(auto));
check('  e relê o db.json antes de gravar (a baixa, a regra e a sugestão)', /const atual = loadData\(\);[\s\S]{0,400}marcarConciliada\(tx, feitas\.get\(tx\.id\), \{ automatico: true \}\);[\s\S]{0,900}if \(mudou\) saveData\(atual\);/.test(auto));
check('  a sugestão fica guardada na movimentação, e sai quando ela é conciliada ou ignorada',
  /tx\.sugestao = sugestaoDe\.get\(tx\.id\);/.test(auto) && /delete tx\.sugestao;\s*tx\.updatedAt/.test(servidor));
const rota = servidor.slice(servidor.indexOf("bank-transactions\\/[^/]+\\/conciliar$/"));
check('vários títulos: a soma tem de ser o valor da movimentação', /if \(somaDosItens !== daMovimentacao\) \{/.test(rota));
check('  cada um até o seu saldo em aberto', /if \(pedido\.valor > maxAllowed \+ 0\.01\) \{/.test(rota));
check('  o mesmo título duas vezes, não', /O mesmo título foi escolhido duas vezes\./.test(rota));
check('  e entryId sozinho continua sendo um título pelo valor inteiro',
  /: \[\{ entryId: String\(body\.entryId \|\| ''\), valor: Number\(tx\.amount \|\| 0\) \}\];/.test(rota));
check('baixa falhando no meio: as já gravadas saem', /\} catch \(erro\) \{\s*for \(const \{ payment \} of criadas\) \{\s*await db\.deleteFinancialPayment\(payment\.id\)/.test(servidor));
check('desconciliar tira as baixas de todos', /const conciliacoes = conciliacoesDaTransacao\(tx\);[\s\S]{0,400}for \(const conciliacao of conciliacoes\) \{/.test(servidor));
check('excluir um título de uma conciliação com vários: recusa', /if \(conciliadaComOutros\(id\)\) \{ ignorados\.push/.test(servidor));
check('estornar a baixa de uma conciliação com vários: recusa', /if \(conciliadaComVarios\) \{\s*return sendJson\(res, \{ error: `Esta baixa veio da conciliação/.test(servidor));

console.log('\n--- 5. a tela ---');
const tela = ler('public/modules/finance/subs/extrato_open_finance.js');
check('botão Conciliar automático, com os filtros da tela', /id="extratoAutoBtn"/.test(tela) && /body: JSON\.stringify\(\{ filtros: filters \}\)/.test(tela));
check('a importação diz quantas conciliou sozinha', /result\.conciliadasAutomaticamente \?/.test(tela));
check('selo Auto na conciliada automaticamente', /tx\.conciliadoAutomaticamente\s*\?/.test(tela));
check('Juntar em cada título, e o quadro dos marcados', /data-juntar="\$\{escapeHtml\(m\.id\)\}"/.test(tela) && /id="extratoJuntos"/.test(tela));
check('  o botão só liga com a soma igual à movimentação', /botao\.disabled = enviando \|\| Boolean\(diferenca\) \|\| !juntos\.size;/.test(tela));
check('  e manda os itens com o valor de cada um', /body: JSON\.stringify\(\{ itens \}\)/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
