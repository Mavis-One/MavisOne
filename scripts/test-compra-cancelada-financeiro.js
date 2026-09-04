#!/usr/bin/env node
/**
 * CANCELAR A COMPRA MATA A CONTA A PAGAR QUE ELA CRIOU (fase BI).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * O espelho de transitionOrderFinanceEffect no lado das compras faltava
 * inteiro. Os DOIS caminhos deixavam o pagável vivo, por motivos diferentes:
 *
 *   - purchase_orders (documentos de compra): transicionarDocumentoDeCompra
 *     estornava o estoque e dava `return` ANTES do bloco de financeiro. A conta
 *     a pagar do recebimento ficava 'pending' e financeApplied continuava true.
 *
 *   - purchases (compra rápida): o código PARECIA tratar — havia um
 *     `financeEntry.status = 'cancelado'` — mas só mudava o objeto em memória.
 *     Faltava o db.updateFinancialEntry, e `financial_entries` mora no Postgres:
 *     a mutação nunca chegava lá, e o syncFinanceData da requisição seguinte
 *     trazia o 'pending' de volta.
 *
 * Provado num banco de prova, cancelando os dois:
 *
 *   ANTES   ordem   -> status ordem-cancelada, finance_applied = TRUE
 *           pagável -> "Despesa de compra · Ordem 2"  R$ 200  pending
 *           pagável -> "Compra purchase-…"            R$ 120  pending
 *           estoque -> voltou certo nos dois casos
 *
 *   DEPOIS  ordem   -> ordem-cancelada, finance_applied = FALSE
 *           pagáveis-> cancelado nos dois
 *
 * O estoque sempre voltou — o que sobrevivia era só o dinheiro. Mercadoria de
 * volta na prateleira e o fornecedor seguindo cobrado por um documento que não
 * existe mais.
 *
 * CANCELAR É O ÚNICO GATILHO, DE PROPÓSITO. Cobrar `!alvo.geraFinanceiro`
 * cancelaria o pagável também ao ir de "Ordem Recebida" para "Recebida
 * Parcialmente", que não é o mesmo assunto: lá a dívida continua existindo, só
 * o recebimento é que foi parcial.
 *
 * BAIXA REGISTRADA NÃO SOME. Se alguém já pagou, o dinheiro saiu de verdade, e
 * cancelar o lançamento apagaria o rastro do pagamento. Mesma regra do lado das
 * vendas.
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

console.log('--- 1. a função que cancela o pagável ---');

const cancelar = corpoDe('cancelarFinanceiroDaCompra');
check('cancelarFinanceiroDaCompra existe', cancelar.length > 0);
// A mutação em memória era justamente o bug do outro caminho: sem esta linha o
// 'cancelado' nunca chega ao Postgres.
check('  grava no banco, e não só em memória',
  /await db\.updateFinancialEntry\(entry\.id, \{ status: 'cancelado' \}\);/.test(cancelar));
check('  e também atualiza a lista em memória da requisição', /entry\.status = 'cancelado';/.test(cancelar));
check('  respeita baixa já registrada',
  /if \(getFinanceEntryPayments\(data, entry\.id\)\.length\) \{\s*\n\s*mantidas\.push\(entry\);\s*\n\s*continue;/.test(cancelar));
check('  devolve o que ficou, para quem chama poder avisar', /return \{ canceladas, mantidas \};/.test(cancelar));
check('  e deixa trilha de auditoria', /action: 'cancelarContaAPagarDaCompra'/.test(cancelar));
// Já cancelado não é recancelado — senão um segundo POST de status duplicaria
// a linha de auditoria sem mudar nada.
check('  não recancela o que já estava cancelado', /entry\.status !== 'cancelado'/.test(cancelar));

console.log('--- 2. documentos de compra (purchase_orders) ---');

const transicao = corpoDe('transicionarDocumentoDeCompra');
check('transicionarDocumentoDeCompra existe', transicao.length > 0);
check('o gatilho é o cancelamento, não a ausência de financeiro',
  /const deveCancelarFinanceiro = Boolean\(alvo\.cancelado\) && documento\.financeApplied;/.test(transicao));
// O `return` do ramo de estorno era o atalho que pulava o bloco de financeiro.
const posEstorno = transicao.indexOf('await estornarRecebimentoDeCompra(');
const posCancelaNoEstorno = transicao.indexOf('cancelarFinanceiroDaCompra', posEstorno);
const posReturnDoEstorno = transicao.indexOf('return comprasDb.obterDocumento(id);', posEstorno);
check('cancela ANTES do return do ramo de estorno',
  posCancelaNoEstorno > posEstorno && posCancelaNoEstorno < posReturnDoEstorno);
// Uma ordem com financeApplied e stockApplied=false (recebida por Nota de
// Entrada, ou "Recebida Sem Financeiro") não passa pelo ramo de estorno e mesmo
// assim tem conta a pagar para matar.
check('  e também fora dele, para a ordem que não estornou estoque',
  (transicao.match(/cancelarFinanceiroDaCompra/g) || []).length >= 2);
check('a ordem deixa de dizer que tem financeiro aplicado',
  /financeApplied: false/.test(transicao));

console.log('--- 3. compra rápida (purchases) ---');

const putCompra = src.slice(src.indexOf("if (pathname.startsWith('/api/purchases/') && req.method === 'PUT')"));
const rotaPut = putCompra.slice(0, putCompra.indexOf('// ---------'));
check('o PUT de compra chama a mesma função',
  /await cancelarFinanceiroDaCompra\(data, \{ documentoId: purchase\.id, user \}\);/.test(rotaPut));
// A mutação solta era o bug: parecia tratar e não tratava.
check('  e a mutação solta em memória sumiu',
  !/financeEntry\.status = 'cancelado';/.test(rotaPut));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
