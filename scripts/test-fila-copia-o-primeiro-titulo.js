// A 1ª PARCELA DÁ O PADRÃO DAS OUTRAS (20/10/2026, pedido do usuário, no print
// da NF-e 107999 com só a parcela 1/4 classificada: "quero que os títulos sejam
// copiados as informações de alteração padrão que a primeira parcela, porém se
// houver edição o usuário tem que alterar de forma manual antes da finalização
// de lançamentos").
//
// Na fila da Edição de Título de uma entrada de NF-e, salvar o 1º título grava
// a conta bancária, o plano de contas, o centro de custo e a forma de
// pagamento dele nos demais; a fila segue abrindo cada um, já com isso, e o que
// for diferente a pessoa troca à mão. Provado no navegador (porta 3099): NF-e
// de exemplo em 3 parcelas, título 1 com conta, plano, centro e forma; os
// títulos 2 e 3 abriram com os quatro e o aviso; o plano trocado no 2º ficou
// só nele, e o 3º saiu com o do 1º.
const fs = require('fs');
const path = require('path');

const titulo = fs.readFileSync(path.join(__dirname, '..', 'public/modules/finance/subs/novo_lancamento.js'), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

const copia = titulo.slice(titulo.indexOf('async function copiarPadraoParaAFila('), titulo.indexOf('async function copiarPadraoParaAFila(') + 900);
check('copia os quatro campos de classificação, e nada da nota',
  /bankAccountId: payload\.bankAccountId,\s*category: payload\.category,\s*costCenter: payload\.costCenter,\s*paymentMethodId: payload\.paymentMethodId\s*\};/.test(copia)
  && !/dueDate|amount|description|document|note/.test(copia.slice(0, copia.indexOf('const demais'))));
check('  para os demais títulos da fila, um a um, pela edição de sempre',
  /const demais = filaDaEntrada\.ids\.slice\(1\);/.test(copia)
  && /await api\(`\/api\/finance\/entries\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'PUT', body: JSON\.stringify\(padrao\) \}\);/.test(copia));
check('  um recusado (já baixado, por exemplo) não para os outros', /catch \(error\) \{\s*falhas \+= 1;\s*\}/.test(copia));

const salvar = titulo.slice(titulo.indexOf('if (filaDaEntrada && proximoDaFila) {'), titulo.indexOf('if (filaDaEntrada && proximoDaFila) {') + 1200);
check('só ao salvar o 1º título, e só na fila de uma entrada de NF-e',
  /if \(filaDaEntrada\.entradaId && posicaoNaFila === 0 && formType !== 'TRANSFERENCIA'\) \{\s*const \{ copiados, falhas \} = await copiarPadraoParaAFila\(payload\);/.test(salvar));
check('  o aviso diz o que foi copiado e pede a troca no que for diferente',
  salvar.includes('Conta, plano de contas, centro de custo e forma de pagamento ')
  && salvar.includes('troque no que for diferente.'));
check('  e depois abre o seguinte, como sempre', /abrirProximoDaFila\(\);\s*return;/.test(salvar));
const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
const filasDoPedido = app.split('state.financeFilaDaEntrada = {').slice(1).map((resto) => resto.slice(0, resto.indexOf('};')));
check('a fila da aprovação do pedido não copia (ela não tem entradaId)',
  filasDoPedido.length === 2 && filasDoPedido.every((fila) => fila.includes('volta:') && !fila.includes('entradaId')));
check('cada título seguinte avisa que veio do 1º',
  /filaDaEntrada\.copiadoDoPrimeiro && posicaoNaFila > 0\s*\? 'Conta, plano de contas, centro de custo e forma de pagamento vieram do título 1: troque aqui se este for diferente\.'/.test(titulo));
check('o título seguinte é lido do servidor ao abrir (já com a cópia)',
  /idEmEdicao \? api\(`\/api\/finance\/entries\/\$\{idEmEdicao\}`\) : Promise\.resolve\(null\)/.test(titulo));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
