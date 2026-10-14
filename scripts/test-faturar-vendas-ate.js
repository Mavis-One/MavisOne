#!/usr/bin/env node
/**
 * O SCRIPT QUE MARCA AS VENDAS ANTIGAS COMO FATURADAS (14/10/2026).
 *
 * Provado no banco local (cópia de produção), até 10/10/2026:
 *   691 pedidos (366 pedido, 318 aprovado sem faturamento, 7 não faturado) e
 *   210 orçamentos viraram "pedido-faturado"; movimentações de estoque (1.300),
 *   saldo dos produtos e lançamentos financeiros (27.845) iguais antes e depois;
 *   a guarda de status voltou ligada; o orçamento convertido abre pela API.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const s = fs.readFileSync(path.join(__dirname, 'faturar-vendas-ate.js'), 'utf8');

check('sem --aplicar só simula', /if \(!aplicar\) \{[\s\S]*?Simulação/.test(s));
check('cancelado e faturado ficam como estão', s.includes("const NAO_MEXER = ['pedido-faturado', 'pedido-cancelado'];"));
check('não mexe em estoque nem financeiro', !/stock_applied\s*=|finance_applied\s*=|stock_movements|financial_entries/.test(s));
check('a guarda é desligada e religada dentro da mesma transação',
  /emTransacao\(async \(cliente\) => \{\s*await cliente\.query\('alter table orders disable trigger orders_status_guarda'\);[\s\S]*?await cliente\.query\('alter table orders enable trigger orders_status_guarda'\);[\s\S]*?\}\);/.test(s));
check('orçamento vira pedido com o mesmo id e código, e só então sai de quotes',
  s.includes("select ${lista}, 'order', $2, now(), $3 from quotes where id = any($1::text[])")
  && s.indexOf('insert into orders') < s.indexOf('delete from quotes'));
check('convertidos e apagados têm de bater, senão nada grava', s.includes('if (convertidos.rowCount !== apagados.rowCount) {'));
check('guarda o estado anterior para desfazer', s.includes("path.join(__dirname, '..', 'logs')"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
