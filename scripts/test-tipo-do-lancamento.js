// O TIPO DO LANÇAMENTO NUM VOCABULÁRIO SÓ (fase EZ, 21/10/2026). Queixa do
// usuário com dois prints: Contas a Pagar mostrava 4 títulos vencendo em 21/10
// e o relatório Contas a Pagar, 3 — faltava o da entrada de NF-e ("Despesa de
// compra · NF-e 1636"); "no módulo do contas a receber consigo puxar mais
// títulos do que nos relatórios".
//
// A entrada de NF-e e as compras gravavam type 'purchase', a venda rápida
// 'sale'. As telas os aceitavam (classifyFinanceEntry); os relatórios em SQL
// só 'RECEITA'/'DESPESA'. Agora grava-se sempre o nome novo, e a migração
// fase-ez troca os antigos.
//
// Provado na 3099: o título da entrada nasceu DESPESA e saiu no relatório;
// regravado como 'purchase' (como em produção), o relatório trouxe 0 linhas;
// depois da troca da fase EZ, 1. Dados de teste apagados.
const fs = require('fs');
const path = require('path');
const { tipoDoLancamento } = require('../lib/db/financeiro');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

check('purchase e despesa gravam DESPESA', tipoDoLancamento('purchase') === 'DESPESA' && tipoDoLancamento('Despesa') === 'DESPESA');
check('sale e receita gravam RECEITA', tipoDoLancamento('sale') === 'RECEITA' && tipoDoLancamento('RECEITA') === 'RECEITA');
check('transfer e transferencia gravam TRANSFERENCIA', tipoDoLancamento('transfer') === 'TRANSFERENCIA' && tipoDoLancamento('TRANSFERENCIA') === 'TRANSFERENCIA');
check('o que não é desses passa como veio', tipoDoLancamento('OUTRO') === 'OUTRO');

const banco = ler('lib/db/financeiro.js');
check('a gravação do lançamento usa o vocabulário único', /type: tipoDoLancamento\(payload\.type\),/.test(banco));

const migracao = ler('banco/migrations/fase-ez-tipo-do-lancamento.sql');
check('a fase EZ troca os já gravados (e pode rodar de novo)',
  /update financial_entries set type = 'DESPESA'\s*where lower\(type\) in \('purchase', 'despesa'\) and type <> 'DESPESA';/.test(migracao)
  && /update financial_entries set type = 'RECEITA'\s*where lower\(type\) in \('sale', 'receita'\) and type <> 'RECEITA';/.test(migracao)
  && /update financial_entries set type = 'TRANSFERENCIA'/.test(migracao));
check('  e entrou no RECRIAR-DO-ZERO', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-ez-tipo-do-lancamento'));

const servidor = ler('server.js');
check('o nome do cliente/fornecedor de título antigo sai pela classe, não pelo texto',
  /const classe = classifyFinanceEntry\(entry\);\s*if \(classe === 'receita' && entry\.referenceId\)/.test(servidor)
  && !/if \(entry\.type === 'purchase'\) \{/.test(servidor));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
