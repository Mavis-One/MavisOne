#!/usr/bin/env node
/**
 * O SALDO POR COR E O DEPÓSITO DO MOVIMENTO (fase BD).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. O RAZÃO PRECISA ESTAR EM MEMÓRIA ANTES DE PROJETAR SALDO.
 *
 *    `data.stockMovements` está em NAO_PERSISTIR desde a fase AP — o razão mora
 *    no Postgres. Quem chamava só `loadData()` recebia a lista VAZIA, e
 *    classValueBalance somava zero linhas: TODO item com cor era recusado com
 *    "disponível: 0", mesmo com saldo. Item sem cor escapava porque projeta
 *    contra products.stock_quantity, que vem do banco de verdade — foi por isso
 *    que ninguém viu, e por isso o teste precisa olhar o caminho da COR.
 *
 *    Reproduzido num banco de prova antes da correção: 10 unidades Brancas no
 *    razão, pedido de 1 Branca recusado com "disponível: 0", o mesmo pedido sem
 *    cor aceito, e a mesma baixa aceita pela tela Estoque > Movimentações.
 *
 * 2. O MOVIMENTO NASCE NO DEPÓSITO DE QUEM O ORIGINOU.
 *
 *    registrarMovimentoEstoque só conhecia o depósito PADRÃO DO PRODUTO. O
 *    depósito escolhido no pedido nunca chegava ao razão: o pedido dizia
 *    "Central", o movimento nascia com depósito vazio, e a mercadoria saía de
 *    lugar nenhum enquanto o Central seguia com o saldo cheio.
 *
 * 3. O ESTORNO VOLTA PARA ONDE A BAIXA SAIU — que não é necessariamente o
 *    depósito atual do documento. Quem editou um pedido faturado pode ter
 *    trocado o campo depois da baixa; devolver ao novo encheria um depósito que
 *    nunca entregou a mercadoria enquanto o outro ficaria devendo para sempre.
 *    Por isso a origem vem do RAZÃO, não do registro.
 *
 * POR QUE LEITURA DE FONTE, E NÃO E2E
 * -----------------------------------
 * O comportamento inteiro depende de banco no ar e de um produto com classe
 * atribuída. O que dá para garantir em todo `npm test` é que as chamadas não
 * sumam numa refatoração — que é exatamente como elas nunca existiram. A
 * cobertura de rota-a-rota é do test-sync-obrigatorio.js, que varre o servidor
 * inteiro; aqui ficam as invariantes desta correção.
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
const corpoDe = (nome) => {
  const m = new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n\\}`).exec(src);
  return m ? m[0] : '';
};

console.log('--- 1. o razão entra em memória antes de projetar saldo ---');

const sincronizar = corpoDe('sincronizarRazao');
check('sincronizarRazao existe', sincronizar.length > 0);
check('  carrega os movimentos do Postgres', /razaoEstoque\.listarMovimentos\(\)/.test(sincronizar));
check('  e as transferências', /razaoEstoque\.listarTransferencias\(\)/.test(sincronizar));
// A bandeira não é detalhe: chamar duas vezes na mesma requisição trocaria
// data.stockMovements por uma releitura e levaria junto os movimentos que
// registrarMovimentoEstoque já empilhou em memória e ainda não descarregou.
check('  sai calada na segunda chamada da mesma requisição',
  /if \(data\.__razaoCarregado\) return data;/.test(sincronizar)
  && /data\.__razaoCarregado = true;/.test(sincronizar));
check('  e não zera a fila de movimentos pendentes já empilhados',
  /if \(!Array\.isArray\(data\.__movimentosPendentes\)\) data\.__movimentosPendentes = \[\];/.test(sincronizar));
// A bandeira é marca da requisição, não dado: gravá-la no db.json a deixaria
// verdadeira para sempre e o razão nunca mais seria carregado.
check('a bandeira não vai para o db.json', /'__razaoCarregado'/.test(
  (/const NAO_PERSISTIR = new Set\(\[[\s\S]*?\]\)/.exec(src) || [''])[0]));

const transicao = corpoDe('transitionOrderStockEffect');
check('transitionOrderStockEffect existe', transicao.length > 0);
// AQUI, e não em cada rota: são nove caminhos (Vendas POST/PUT/DELETE/lote,
// Fiscal, PCP) e o próximo que nascer também esqueceria.
check('  carrega o razão antes de projetar', /await sincronizarRazao\(data\);/.test(transicao));
const posSync = transicao.indexOf('await sincronizarRazao(data)');
// A CHAMADA, e não a menção: o comentário da própria correção cita
// classValueBalance algumas linhas acima, e casar com ele faria o teste medir
// a ordem do texto em vez da ordem do código.
const posProjecao = transicao.indexOf('stockCore.classValueBalance(');
check('  e carrega ANTES da projeção, não depois',
  posSync >= 0 && posProjecao >= 0 && posSync < posProjecao);
// loadStockContext continua sendo a porta do módulo Estoque; o que mudou é que
// ela passa pela mesma função, para não haver duas verdades sobre o razão.
check('loadStockContext usa a mesma função', /await sincronizarRazao\(data\);/.test(corpoDe('loadStockContext')));

console.log('--- 2. o movimento nasce no depósito de quem o originou ---');

const registrar = corpoDe('registrarMovimentoEstoque');
check('registrarMovimentoEstoque aceita depositId', /classValueId, depositId \}\)/.test(registrar));
// A ordem é a regra: o depósito do documento é uma ESCOLHA de quem vendeu ou
// comprou; o padrão do produto é só um palpite de cadastro.
check('  o depósito informado vem ANTES do padrão do produto',
  /const defaultDepositId = String\(depositId \|\| ''\)\.trim\(\)\s*\n\s*\|\| stockCore\.productMeta\(data, productId\)\.defaultDepositId \|\| '';/.test(registrar));
check('  a baixa da venda leva o depósito do pedido',
  /type: 'venda',[\s\S]{0,400}?depositId: record\.depositId,/.test(transicao));

console.log('--- 3. o estorno volta para onde a baixa saiu ---');

const origem = corpoDe('depositoDoMovimentoDeOrigem');
check('depositoDoMovimentoDeOrigem existe', origem.length > 0);
check('  pergunta ao razão, casando documento, produto, cor e motivo',
  /m\.referenceType === referenceType/.test(origem)
  && /m\.referenceId === referenceId/.test(origem)
  && /m\.productId === productId/.test(origem)
  && /String\(m\.classValueId \|\| ''\) === String\(classValueId \|\| ''\)/.test(origem)
  && /m\.motivo === motivo/.test(origem));
// Documento movimentado antes desta fase não tem depósito em movimento nenhum;
// devolver '' deixa quem chama decidir, em vez de inventar um depósito.
check('  devolve vazio quando não acha, em vez de chutar', /return movimento \? movimento\.depositId \|\| '' : '';/.test(origem));
check('o estorno do pedido usa a origem do razão, e o pedido só como reserva',
  /type: 'estorno',[\s\S]{0,1000}?depositoDoMovimentoDeOrigem\(data, \{[\s\S]{0,200}?motivo: 'venda',[\s\S]{0,200}?\}\) \|\| record\.depositId,/.test(transicao));
// A compra não tem para onde cair: a tabela `purchases` não tem coluna de
// depósito (quem tem é purchase_orders, outra tabela). Quem guarda a resposta
// é o razão, e é dele que o estorno a lê.
check('o estorno da compra tira do depósito em que a compra entrou',
  /motivo: 'compra',[\s\S]{0,200}?productId: purchase\.productId/.test(src));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
