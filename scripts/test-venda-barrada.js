#!/usr/bin/env node
/**
 * O 588 E A FORMA "OUTROS" NÃO APROVAM NEM FATURAM (09/11/2026). Pedido do
 * usuário: "estou conseguindo faturar com o produto 588 (NÃO PODE!) e outra
 * coisa, não deixe o pedido ser aprovado e muito menos faturado em OUTROS como
 * forma de pagamento!".
 *
 * Regra em public/modules/shared/venda_barrada.js; o servidor recusa na
 * aprovação (edição e lote), na criação já aprovada e na NF-e/NFC-e, antes da
 * SEFAZ.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const B = require('../public/modules/shared/venda_barrada');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const FORMAS = [
  { id: 'f-outros', name: 'Outros', type: 'outro' },
  { id: 'f-loja', name: 'Crédito Loja', type: 'outro' },
  { id: 'f-pix', name: 'PIX', type: 'pix' }
];
const SKU = { 'p-588': '588', 'p-moto': '10437' };
const skuDoItem = (item) => SKU[item.productId];
const pedido = (extra = {}) => ({
  items: [{ productId: 'p-moto', name: 'MOTO', quantity: 1 }],
  payments: [{ methodId: 'f-pix', amount: 100 }],
  ...extra
});
const comMaoDeObra = pedido({ items: [{ productId: 'p-moto', name: 'MOTO' }, { productId: 'p-588', name: 'MAO-DEOBRA (SOMENTE PARA SERVICO)' }] });
const emOutros = pedido({ payments: [{ methodId: 'f-pix', amount: 50 }, { methodId: 'f-outros', amount: 50 }] });
const barra = (r, statusNovo, extra = {}) => B.impedimento(r, { statusNovo, formas: FORMAS, skuDoItem, ...extra });

console.log('--- 1. o produto 588 ---');
check('pedido sem o 588 e sem "Outros" aprova', barra(pedido(), 'pedido-pre-faturado') === null);
for (const status of ['pedido-pre-faturado', 'pedido-faturado', 'pedido-parcialmente-faturado']) {
  const b = barra(comMaoDeObra, status);
  check(`${status}: barrado, no item 2`, b && b.regra === 'produto' && b.item === 1 && /588/.test(b.mensagem) && /item 2/.test(b.mensagem), b && b.mensagem);
}
check('"Aprovado Sem Faturamento" passa: não fatura nada', barra(comMaoDeObra, 'pedido-aprovado-sem-faturamento') === null);
check('rascunho e Não Faturado passam (salvar continua possível)',
  barra(comMaoDeObra, 'pedido') === null && barra(comMaoDeObra, 'pedido-nao-faturado') === null);
check('pelo código do CADASTRO (o item com outro nome continua barrado)',
  barra(pedido({ items: [{ productId: 'p-588', name: 'SERVICO DE MONTAGEM' }] }), 'pedido-pre-faturado')?.regra === 'produto');
check('  sem cadastro, vale o código gravado no item',
  B.impedimento({ items: [{ sku: ' 588 ' }] }, { statusNovo: 'pedido-faturado' })?.regra === 'produto');
check('  e "5880" não é "588"', B.produtoQueNaoFatura('5880') === null && B.produtoQueNaoFatura('588') !== null);

console.log('\n--- 2. a forma "Outros" ---');
for (const status of B.STATUS_APROVADOS) {
  const b = barra(emOutros, status);
  check(`${status}: barrado, na linha 2`, b && b.regra === 'pagamento' && b.linha === 1 && b.aba === 'pagamentos' && /linha 2/.test(b.mensagem), b && b.mensagem);
}
check('rascunho passa', barra(emOutros, 'pedido') === null);
check('"Crédito Loja" (também do tipo "outro") continua valendo',
  barra(pedido({ payments: [{ methodId: 'f-loja', amount: 100 }] }), 'pedido-pre-faturado') === null);
check('pelo nome, sem caixa nem acento, e pelo methodName sem cadastro',
  B.ehFormaBarrada(' outros ') && B.ehFormaBarrada('OUTROS') && !B.ehFormaBarrada('Outros 2')
  && barra(pedido({ payments: [{ methodName: 'OUTROS', amount: 10 }] }), 'pedido-faturado')?.regra === 'pagamento');
check('  a forma do cadastro manda sobre o nome gravado na linha',
  barra(pedido({ payments: [{ methodId: 'f-pix', methodName: 'Outros', amount: 10 }] }), 'pedido-faturado') === null);
check('linha de valor zero não conta', barra(pedido({ payments: [{ methodId: 'f-outros', amount: 0 }, { methodId: 'f-pix', amount: 100 }] }), 'pedido-faturado') === null);
check('categoria que não exige pagamento (transferência) não é barrada pela linha',
  barra(emOutros, 'pedido-aprovado-sem-faturamento', { exigePagamento: false }) === null);
check('o 588 vem antes da forma', barra({ ...comMaoDeObra, payments: emOutros.payments }, 'pedido-faturado')?.regra === 'produto');

console.log('\n--- 3. a nota ---');
check('o 588 não sai em nota', /588/.test(B.impedimentoDaNota({ itens: [{ sku: '10437' }, { sku: '588', name: 'MAO' }] }) || ''));
check('"Outros" não sai em nota de venda', /Outros/.test(B.impedimentoDaNota({ pagamentos: [{ methodId: 'f-outros', valor: 10 }], formas: FORMAS }) || ''));
check('  na transferência/remessa, sim', B.impedimentoDaNota({ pagamentos: [{ methodId: 'f-outros', valor: 10 }], formas: FORMAS, venda: false }) === null);
check('  nota sem forma do cadastro (avulsa, "99 Outros" da SEFAZ) não é barrada',
  B.impedimentoDaNota({ pagamentos: [{ forma: '99', valor: 10 }], formas: FORMAS }) === null);

console.log('\n--- 4. onde o servidor confere ---');
const s = ler('server.js');
const efeitos = s.slice(s.indexOf('async function aplicarEfeitosDeStatus('), s.indexOf('// FATURAR EXIGE DOCUMENTO FISCAL (fase AV).'));
check('na aprovação (edição e lote): só na entrada do status, e não quando a nota autorizada fatura',
  /statusNovo !== salesStatus\.normalizar\(current\.status, undefined\)/.test(efeitos)
  && /faturaPelaNota = statusNovo === 'pedido-faturado'\s*&& Boolean\(await notaQueSustentaOFaturamento/.test(efeitos)
  && /if \(!faturaPelaNota\) \{\s*await recusarVendaBarrada\(/.test(efeitos));
check('na criação do pedido que já nasce aprovado', /if \(type === 'order'\) await recusarVendaBarrada\(record, status\);/.test(s));
const recusa = s.slice(s.indexOf('async function recusarVendaBarrada('), s.indexOf('async function itensSemEstoqueParaFaturar('));
check('  o código vem do cadastro e a categoria diz se o pagamento conta',
  /skuDoItem: \(item\) => \(produtos\.get\(item\.productId\) \|\| \{\}\)\.sku/.test(recusa)
  && /exigePagamento: categoriaVenda\.exigePagamento\(pedido\.category/.test(recusa) && /erro\.status = 400/.test(recusa));
const nota = s.slice(s.indexOf('async function prepararNfeParaTransmitir('), s.indexOf('// VALORES FISCAIS EDITADOS NA EMISSÃO'));
check('na NF-e/NFC-e, antes de transmitir: a forma (só na venda) e o item pelo código que vai à nota',
  /!opcoes\.semConferirPagamentos && vendaBarrada\.impedimentoDaNota\(\{\s*pagamentos: body\.pagamentos, formas: loadData\(\)\.paymentMethods \|\| \[\], venda: tipoOperacao === 'VENDA'/.test(nota)
  && /vendaBarrada\.produtoQueNaoFatura\(item\.codigoProduto\)/.test(nota));
check('a NFC-e passa pela mesma preparação (emitirNfeFiscal com o modelo 65)',
  /emitirNfeFiscal\(montarNfeDoPedido\(pedido, estabelecimentoId, data\), user, \{ modelo: 65 \}\)/.test(s)
  && /await prepararNfeParaTransmitir\(body, \{ modelo: opcoes\.modelo, liberarSemPagamento \}\)/.test(s));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
