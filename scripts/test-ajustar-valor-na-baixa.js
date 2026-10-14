#!/usr/bin/env node
/**
 * AJUSTAR O VALOR DO TÍTULO NA BAIXA (14/10/2026).
 *
 * Pedido do usuário: "fazemos previsões de pagamento de contas como água e
 * luz; preciso que o valor do título possa ser alterado para que uma previsão
 * de 120 vire o valor da conta, e que não fiquem valores a serem pagos".
 *
 * Provado pela API no banco local (títulos de teste apagados depois):
 *   previsão 120, paga 98  -> valor 98, pago, em aberto 0
 *   previsão 120, paga 135 -> valor 135, pago
 *   previsão 120, paga 120 -> nada muda, pago, sem anotação
 *   parcial antigo (98 de 120), valor 0 -> valor 98, pago, sem baixa nova
 *   título de pedido, acima do saldo -> recusado (o valor é o da venda)
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const servidor = ler('server.js');
const inicio = servidor.indexOf("if (/^\\/api\\/finance\\/entries\\/[^/]+\\/payments$/.test(pathname) && req.method === 'POST')");
const rota = servidor.slice(inicio, servidor.indexOf("return sendErro(res, error, 'Erro ao registrar pagamento', 400);", inicio));
check('a rota da baixa foi encontrada', inicio > 0 && rota.length > 1000, rota.length);
// SEM BOTÃO (14/10/2026, pedido do usuário): é a regra do campo Valor. O
// título lançado no Financeiro passa a valer o que a baixa fecha; o de pedido
// ou NF-e segue a baixa de sempre.
const tem = (trecho) => rota.includes(trecho);
check('a regra vale para o título que não é de pedido nem de NF-e', tem('const ajustarValor = !(entry.referenceId || entry.nfeId);'));
check('  e não depende de nada que a tela mande', !tem('body.ajustarValor'));
check('o valor novo é o que esta baixa fecha',
  tem('const novoValor = Math.round((paidBeforeThisPayment + amount - ajustesAnteriores - (interest + fine - discount)) * 100) / 100;'));
check('  gravado no título, com a troca na observação (só quando muda)',
  tem('if (Math.abs(novoValor - Number(entry.amount || 0)) > 0.005) {') && tem('Valor ajustado na baixa de'));
check('título de pedido ou NF-e: pagar acima do saldo continua recusado',
  tem('} else if (amount > maxAllowedAmount + 0.01) {') && tem('O valor deste título vem do pedido ou da NF-e.'));
check('valor zero fecha o parcial antigo sem baixa nova',
  tem('const soEncerrar = ajustarValor && amount === 0;') && tem('const payment = soEncerrar ? null : await db.createFinancialPayment('));
check('a troca de valor fica na auditoria', tem('valorAjustadoDe: valorAnterior, valorAjustadoPara: entry.amount'));

const tela = ler('public/modules/finance/subs/lancamentos.js');
check('sem botão nem caixa na tela', !tela.includes('ajustarValor') && !tela.includes('finance-ajustar-valor'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
