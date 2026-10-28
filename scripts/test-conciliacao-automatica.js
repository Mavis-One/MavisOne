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

console.log('--- 1. o fornecedor na descrição ---');
check('as duas primeiras palavras do nome, fora LTDA/DE/COMERCIO',
  C.fornecedorBate({ texto: 'PAG BOLETO MAIS CLEAN DISTRIB', nome: 'MAIS CLEAN DISTRIBUIDORA LTDA' }));
check('  com acento e caixa diferentes', C.fornecedorBate({ texto: 'PIX RECEBIDO - Joao da Silva', nome: 'JOÃO DA SILVA' }));
check('  o MEI com o CNPJ na frente do nome', C.fornecedorBate({ texto: 'PIX ENVIADO DALVAN JOSE', nome: '68.501.208 DALVAN JOSE PEDRI' }));
check('  a palavra cortada pelo banco (4 letras ou mais)', C.fornecedorBate({ texto: 'TED JOAO SILV', nome: 'JOAO SILVA' }));
check('  outro nome não bate', !C.fornecedorBate({ texto: 'PIX RECEBIDO MARIA SOUZA', nome: 'JOAO SILVA' }));
check('  só uma das duas palavras não basta', !C.fornecedorBate({ texto: 'PIX RECEBIDO JOAO PEREIRA', nome: 'JOAO SILVA' }));
check('  nome vazio não bate', !C.fornecedorBate({ texto: 'PIX', nome: '' }));
check('pelo CNPJ na descrição, com pontuação', C.fornecedorBate({ texto: 'PIX 12.345.678/0001-90 PAGTO', nome: 'OUTRO NOME', documento: '12345678000190' }));
check('  pelo documento da contraparte (Open Finance)', C.fornecedorBate({ texto: 'PIX', documentos: ['123.456.789-01'], nome: 'X', documento: '12345678901' }));

console.log('\n--- 2. a data ---');
check('no vencimento', C.dataBate('2026-10-20', '2026-10-20'));
check('  no dia útil seguinte (compensação)', C.dataBate('2026-10-21', '2026-10-20'));
check('  dois dias depois, não', !C.dataBate('2026-10-22', '2026-10-20'));
check('  antes do vencimento, não', !C.dataBate('2026-10-19', '2026-10-20'));
check('vencimento na sexta: até a segunda', C.dataBate('2026-10-26', '2026-10-23') && !C.dataBate('2026-10-27', '2026-10-23'));
check('vencimento no sábado: até a segunda', C.dataBate('2026-10-26', '2026-10-24'));

console.log('\n--- 3. os pares ---');
const PLUS = '43792899';
const KACCAU = '51638084';
const tit = (id, extra) => ({ id, tipo: 'despesa', esperado: 100, raiz: PLUS, vencimento: '2026-10-20', nome: 'CLARO S.A.', documento: '', ...extra });
const mov = (id, extra) => ({ id, tipo: 'despesa', valor: 100, data: '2026-10-20', raiz: PLUS, texto: 'PAGAMENTO CLARO', documentos: [], ...extra });
const pares = (args) => C.paresAutomaticos(args);
let r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('t2', { esperado: 50 })] });
check('tudo batendo, valor único: concilia', r.pares.length === 1 && r.pares[0].tituloId === 't1', JSON.stringify(r));
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('t2')] });
check('dois títulos com o valor: não', !r.pares.length && /mais de um título/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1'), mov('m2', { texto: 'CLARO TELEFONE' })], titulos: [tit('t1')] });
check('duas movimentações com o valor: nenhuma', !r.pares.length && /mais de uma movimentação/.test(r.motivos.m1) && /mais de uma movimentação/.test(r.motivos.m2));
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1', { raiz: KACCAU })] });
check('empresa diferente: não', !r.pares.length && /nenhum título/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1')], titulos: [tit('t1'), tit('t2', { raiz: '' })] });
check('outro título com o valor e SEM empresa: não (pode ser o mesmo)', !r.pares.length && /mais de um título/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1', { raiz: '' })], titulos: [tit('t1')] });
check('conta sem empresa: não', !r.pares.length && /empresa/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1', { texto: 'PAGAMENTO VIVO' })], titulos: [tit('t1')] });
check('fornecedor diferente: não', !r.pares.length && /fornecedor/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1', { data: '2026-10-25' })], titulos: [tit('t1')] });
check('data fora: não', !r.pares.length && /data/.test(r.motivos.m1));
r = pares({ movimentacoes: [mov('m1', { valor: 100.01 })], titulos: [tit('t1')] });
check('um centavo de diferença: não', !r.pares.length);
r = pares({ movimentacoes: [mov('m1', { tipo: 'receita' })], titulos: [tit('t1')] });
check('entrada não casa com despesa', !r.pares.length);
r = pares({ movimentacoes: [mov('m1'), mov('m2', { raiz: KACCAU })], titulos: [tit('t1'), tit('t2', { raiz: KACCAU })] });
check('o mesmo valor em empresas diferentes: cada uma com o seu', r.pares.length === 2, JSON.stringify(r.pares));
r = pares({ movimentacoes: [mov('m1'), mov('m2', { valor: 50, texto: 'CLARO' })], alvos: ['m2'], titulos: [tit('t1'), tit('t2', { esperado: 50 })] });
check('só os alvos (o arquivo importado, o filtro)', r.pares.length === 1 && r.pares[0].movimentacaoId === 'm2');
r = pares({ movimentacoes: [mov('m1'), mov('m2')], alvos: ['m1'], titulos: [tit('t1')] });
check('  mas a unicidade olha todas as não conciliadas', !r.pares.length);

console.log('\n--- 4. o servidor ---');
const servidor = ler('server.js');
check('a importação concilia o que acabou de entrar', /automatica = await conciliarAutomaticamente\(user, \(tx\) => novas\.has\(tx\.id\)\);/.test(servidor)
  && /conciliadasAutomaticamente: automatica\.conciliadas,/.test(servidor));
check('  e o botão, as do filtro da tela', servidor.includes("pathname === '/api/finance/bank-transactions/conciliar-automatico' && req.method === 'POST'")
  && /const resultado = await conciliarAutomaticamente\(user, \(tx\) => doFiltro\.has\(tx\.id\)\);/.test(servidor));
const auto = servidor.slice(servidor.indexOf('async function conciliarAutomaticamente('));
check('  trava as movimentações tentadas e destrava no fim', /travadas\.forEach\(\(id\) => conciliacoesEmAndamento\.add\(id\)\);/.test(auto)
  && /\} finally \{\s*travadas\.forEach\(\(id\) => conciliacoesEmAndamento\.delete\(id\)\);/.test(auto));
check('  e relê o db.json antes de gravar', /const atual = loadData\(\);[\s\S]{0,200}marcarConciliada\(tx, feitas\.get\(tx\.id\), \{ automatico: true \}\);[\s\S]{0,40}saveData\(atual\);/.test(auto));
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
