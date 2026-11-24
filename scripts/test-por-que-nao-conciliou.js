/**
 * O SCRIPT "POR QUE NÃO CONCILIOU" (24/11/2026) — só lê, e usa a MESMA regra
 * da conciliação automática do servidor (lib/conciliacao-automatica.js).
 * A prova de ponta a ponta foi no banco local com um título de R$ 1.281,00 de um
 * fornecedor sem conta bancária (motivo certo) e com a conta (conciliaria).
 *
 *   node scripts/test-por-que-nao-conciliou.js
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};
const fonte = fs.readFileSync(path.join(__dirname, 'por-que-nao-conciliou.js'), 'utf8');

check('não grava nada (sem insert/update/delete, sem writeFile)',
  !/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(fonte) && !/writeFile/.test(fonte));
check('a regra é a do servidor: fornecedorBate, dataBate, paresAutomaticos',
  /regra\.fornecedorBate\(\{ texto, documentos, nome: p\.nome, documento: p\.documento \}\)/.test(fonte)
  && /regra\.dataBate\(tx\.date, t\.due_date\)/.test(fonte)
  && /regra\.paresAutomaticos\(\{ movimentacoes, alvos: \[tx\.id\], titulos: titulosDaRegra \}\)/.test(fonte));
check('lê o extrato do db.json e os títulos pelo valor, líquido ou saldo',
  /path\.join\(__dirname, '\.\.', 'data', 'db\.json'\)/.test(fonte)
  && /round\(e\.amount \* 100\) = \$1\s*or round\(coalesce\(e\.net_amount, 0\) \* 100\) = \$1\s*or round\(\(e\.amount - coalesce\(p\.pago, 0\)\) \* 100\) = \$1/.test(fonte));
check('confere as seis regras: tipo, em aberto, valor, conta, fornecedor, data',
  ['tipo ${', 'em aberto (status', 'valor esperado no extrato', 'conta do título:', 'fornecedor/cliente:', 'vencimento ${'].every((t) => fonte.includes(t)));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
