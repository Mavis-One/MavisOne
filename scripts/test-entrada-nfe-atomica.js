#!/usr/bin/env node
/**
 * A ENTRADA DE NF-e É INTEIRA OU NÃO É (fase BH).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * A ordem de compra vinculada era conferida DEPOIS de o estoque já estar
 * commitado, e as duas recusas devolviam 400 sem desfazer nada.
 *
 * Provado num banco de prova, com um `purchaseOrderId` que não existe:
 *
 *   ANTES  -> HTTP 400 "A ordem de compra escolhida nao existe mais."
 *             estoque   20 -> 120   (+100 unidades)
 *             custo     50 -> 2.5   (sobrescrito pelo vUnCom da nota)
 *             nfe_entrada gravada, movimentou_estoque=t, gerou_financeiro=t
 *             contas a pagar: NENHUMA
 *
 *   DEPOIS -> HTTP 400, mesma mensagem
 *             estoque 20, custo 50, 0 movimentos, 0 notas, 0 contas a pagar
 *
 * O `gerou_financeiro=t` era o pior detalhe: o próprio registro afirmava que o
 * financeiro tinha sido gerado, então nenhuma conferência apontava a falta. E o
 * operador não conseguia refazer — reenviar o mesmo XML bate no bloqueio de
 * duplicidade por chave, e a chave já estava queimada.
 *
 * TRÊS CAMADAS, E CADA UMA COBRE O QUE A OUTRA NÃO ALCANÇA
 * -------------------------------------------------------
 * 1. A conferência da ordem subiu para antes de qualquer gravação. Resolve o
 *    caso comum, com o banco ainda intacto.
 * 2. A marca na ordem entra pelo gancho `tambemNaTransacao`, na MESMA transação
 *    do razão — como a rota irmã já fazia. Fecha a janela entre a validação e o
 *    commit: `for update` na linha da ordem e reconferência lá dentro.
 * 3. Se a transação falhar mesmo assim, a nota é desfeita, para a chave não
 *    ficar queimada. É o mesmo desfazer que criarEntrada já faz quando os itens
 *    falham — e pelo mesmo motivo escrito lá.
 *
 * E O FINANCEIRO QUE FALHA NÃO DEIXA A NOTA MENTINDO. A mercadoria chegou, então
 * o estoque não se desfaz; mas a nota deixa de dizer `gerouFinanceiro` e vai
 * para REVISAR, com o motivo na auditoria.
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

const src = ler('server.js');
const rota = src.slice(
  src.indexOf("if (pathname === '/api/purchases/entrada-nfe' && req.method === 'POST')"),
  src.indexOf("if (pathname === '/api/purchases/documentos'")
);
check('achei a rota de entrada de NF-e', rota.length > 500, `${rota.length} caracteres`);

console.log('--- 1. a ordem é conferida antes de gravar ---');

const posValidacao = rota.indexOf('ordemDaNota = await comprasDb.obterDocumento');
const posCriarEntrada = rota.indexOf('await entradaNfeDb.criarEntrada(');
const posCommit = rota.indexOf('await commitStockMovements(');
check('a ordem é lida antes de criar a nota', posValidacao >= 0 && posValidacao < posCriarEntrada);
check('  e antes de commitar o estoque', posValidacao >= 0 && posValidacao < posCommit);
check('as duas recusas continuam existindo',
  /não existe mais/.test(rota) && /já deu entrada no estoque por conta própria/.test(rota));

console.log('--- 2. a marca na ordem entra na transação do razão ---');

check('o commit usa o gancho tambemNaTransacao', /commitStockMovements\(data, movimentosDaNota, produtosPorId, \{\s*\n\s*tambemNaTransacao:/.test(rota));
// `for update` na linha: duas notas para a mesma ordem esperam uma pela outra.
check('  travando a linha da ordem', /comprasDb\.travarDocumento\(cliente, body\.purchaseOrderId\)/.test(rota));
// Reconferir aqui dentro é o que fecha a janela entre a validação e o commit.
check('  e reconferindo stockApplied lá dentro', /select stock_applied from purchase_orders where id = \$1/.test(rota));
check('  a marca vai pelo MESMO cliente da transação', /entradaNfeId: entrada\.id\s*\n\s*\}, cliente\);/.test(rota));
// Sem isto, uma nota em que nenhum item movimenta estoque sairia na primeira
// linha de commitStockMovements e a ordem ficaria por marcar, em silêncio.
const commit = src.slice(src.indexOf('async function commitStockMovements'));
check('o gancho sozinho já abre a transação',
  /if \(!movements\.length && !\(opcoes\.transferencias \|\| \[\]\)\.length\s*\n\s*&& typeof opcoes\.tambemNaTransacao !== 'function'\) return;/.test(commit));

console.log('--- 3. se o razão não vinga, a nota é desfeita ---');

check('a nota é desfeita quando o commit falha', /await entradaNfeDb\.desfazerEntrada\(entrada\.id\);/.test(rota));
const fonteDb = ler('lib/db/entrada-nfe.js');
check('desfazerEntrada existe na camada de dados', /async function desfazerEntrada\(id\)/.test(fonteDb));
// A regra "documento fiscal não se apaga" é sobre a NF-e que NÓS emitimos.
// Aqui o que se apaga é um lançamento nosso que não chegou a valer.
check('  e explica por que isso não fere a regra do documento fiscal',
  /NÃO contradiz a regra de nunca excluir documento fiscal/.test(fonteDb));
// A INTENÇÃO CONTINUA A MESMA, o formato é que mudou (fase CC).
//
// Era `erroDoRazao.message || 'Erro ao lançar o estoque da nota.'`: a mensagem
// ia inteira, fosse de quem fosse. Agora passa pelo sendErro, que separa duas
// coisas que estavam juntas:
//
//   · o razão RECUSANDO — saldo insuficiente, produto controlado por cor sem a
//     cor informada — é `stockCore.stockError`, tem status, e chega inteiro na
//     tela. É este o caso que o teste sempre quis proteger: a entrada foi
//     desfeita, e quem lançou precisa saber o que consertar para relançar.
//
//   · o razão QUEBRANDO — transação que não fechou, coluna que não existe —
//     não tem status, e aí a pessoa vê o texto de reserva com um código, e o
//     erro de verdade vai para o log. Essa mensagem nunca ajudou ninguém na
//     tela; ajudava quem estivesse sondando o banco.
check('  a resposta passa o erro do razão adiante',
  /sendErro\(res, erroDoRazao, 'Erro ao lançar o estoque da nota\.', 400\)/.test(rota));
// E a separação, provada na própria função que decide:
const { respostaDeErro } = require('../lib/erro-para-o-usuario');
const recusa = Object.assign(new Error('Saldo insuficiente no depósito.'), { status: 400 });
check('    recusa do razão chega inteira na tela',
  respostaDeErro(recusa, 'Erro ao lançar o estoque da nota.').mensagem === 'Saldo insuficiente no depósito.');
check('    e falha de banco vira reserva com código',
  /\(código [0-9a-f]{6}\)$/.test(respostaDeErro(new Error('relation "x" does not exist'), 'Erro ao lançar o estoque da nota.').mensagem));

console.log('--- 4. o financeiro que falha não deixa a nota mentindo ---');

check('a nota para de afirmar que gerou financeiro',
  /atualizarSinalizadores\(entrada\.id, \{ gerouFinanceiro: false, status: 'REVISAR' \}\)/.test(rota));
check('  e a falha vira auditoria', /action: 'falhaAoGerarFinanceiroDaEntrada'/.test(rota));
// A mercadoria chegou de verdade: desfazer o estoque aqui seria mentir na
// direção oposta. É o mesmo raciocínio da rota irmã de recebimento de ordem.
check('  mas o estoque NÃO se desfaz por causa do financeiro',
  !/desfazerEntrada/.test(rota.slice(rota.indexOf('falhaAoGerarFinanceiroDaEntrada'))));
check('atualizarSinalizadores existe na camada de dados', /async function atualizarSinalizadores\(id, \{/.test(fonteDb));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
