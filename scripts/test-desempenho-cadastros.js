#!/usr/bin/env node
// CADASTROS SEM CARREGAR O QUE NÃO USA (rodada de desempenho, out/2026).
//
// Perguntas de sim ou não que carregavam tabelas inteiras para responder:
//
//   1. EXCLUIR PESSOA/CNPJ perguntava "tem lançamento financeiro?" carregando
//      os 27.362 lançamentos e as 25.709 baixas (syncFinanceData, ~530 ms e
//      ~37 MB no processo único). Um `exists` responde em ~15 ms no pior caso.
//
//   2. EXCLUIR CONTA BANCÁRIA, a mesma coisa para três perguntas (lançamento,
//      baixa, transação importada). E a terceira nunca disparava:
//      `data.bankTransactions` não era sincronizado por ninguém, e quem
//      segurava a exclusão era a chave estrangeira, com erro genérico.
//
//   3. A LISTA DE CASHBACK lia os 5.561 produtos para dar nome às regras —
//      com zero regras, para devolver [].
//
// O guarda de cada um é o mesmo: a pergunta continua sendo feita, à fonte
// certa, e o carregamento inteiro não volta.
//
// SEM BANCO: lê o fonte (sem comentários, que explicam justamente o padrão que
// saiu).
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = semComentarios(ler('server.js'));
// Corpo de uma função de primeiro nível do server.js, até a próxima.
function corpoDe(nome) {
  const ini = servidor.search(new RegExp(`\\n(?:async )?function ${nome}\\(`));
  if (ini < 0) return '';
  const resto = servidor.slice(ini + 1);
  const fim = resto.search(/\n(?:async )?function |\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim);
}
// Trecho de uma rota: do `if`/`match` dela até a próxima marca dada.
const trecho = (de, ate) => servidor.slice(servidor.indexOf(de), servidor.indexOf(ate, servidor.indexOf(de) + 1));

console.log('--- 1. excluir pessoa/CNPJ: "tem lançamento?" é um exists ---');
const contrapartida = corpoDe('contrapartidaEmUso');
check('contrapartidaEmUso existe', contrapartida.length > 0);
check('  e não carrega mais o Financeiro', !/syncFinanceData\(/.test(contrapartida));
check('  pergunta pela função do exists', /lancamentoDaContrapartida\(id\)/.test(contrapartida));
const lancamento = corpoDe('lancamentoDaContrapartida');
check('o exists olha a coluna da contrapartida',
  /select exists\(select 1 from financial_entries where client_supplier_id = \$1\) as existe/.test(lancamento));
// A ordem das mensagens é a mesma: financeiro primeiro.
check('a mensagem do financeiro continua sendo a primeira',
  contrapartida.indexOf('if (comFinanceiro)') > -1
  && contrapartida.indexOf('if (comFinanceiro)') < contrapartida.indexOf('if (comEquipamento > 0)'));

console.log('\n--- 2. excluir conta bancária: três exists, e a regra continua no cadastros-core ---');
const usos = corpoDe('usosDaContaBancaria');
check('lançamento (conta de origem OU de destino)',
  /from financial_entries\s+where bank_account_id = \$1 or target_bank_account_id = \$1\) as lancamentos/.test(usos));
check('baixa', /from financial_payments where bank_account_id = \$1\) as baixas/.test(usos));
check('transação importada (a que nunca disparava)', /from bank_transactions where bank_account_id = \$1\) as transacoes/.test(usos));
const exclusaoConta = trecho("const contaBancariaMatch = pathname.match(", "if (pathname === '/api/cadastros/deposits' && req.method === 'GET')");
check('a rota da conta não carrega mais o Financeiro', !/syncFinanceData\(/.test(exclusaoConta));
check('  e a regra (ordem e texto) continua sendo a do cadastros-core',
  /CADASTRO_COLLECTIONS\['bank-accounts'\]\.inUse\(id, dados\)/.test(exclusaoConta));
// Rodar a regra de verdade com as amostras que a rota monta: cada uso tem de
// virar a mensagem certa, na ordem certa.
{
  const regra = require(path.join(RAIZ, 'lib', 'cadastros-core')).CADASTRO_COLLECTIONS['bank-accounts'].inUse;
  const id = 'conta-1';
  const amostra = (ha) => (ha ? [{ bankAccountId: id }] : []);
  const com = (u, formas = []) => regra(id, {
    finance: amostra(u.lancamentos), financialPayments: amostra(u.baixas), bankTransactions: amostra(u.transacoes), paymentMethods: formas
  });
  check('lançamento → mensagem de lançamento', /lançamentos financeiros/.test(com({ lancamentos: true, baixas: true, transacoes: true }) || ''));
  check('só baixa → mensagem de baixa', /baixas registradas/.test(com({ baixas: true }) || ''));
  check('só transação → mensagem de transação importada', /transações importadas/.test(com({ transacoes: true }) || ''));
  check('nada no banco, forma de pagamento apontando → bloqueia pela forma',
    /formas de pagamento/.test(com({}, [{ bankAccountId: id }]) || ''));
  check('nada em lugar nenhum → livre', com({}) === null);
}

console.log('\n--- 3. cashback: sem regra, sem catálogo ---');
const cashback = trecho("if (pathname === '/api/cadastros/product-cashbacks' && req.method === 'GET')", 'const cadastroCollectionMatch = pathname.match(');
check('o catálogo só é lido quando há regra',
  /const regras = data\.productCashbacks \|\| \[\];[\s\S]{0,120}if \(regras\.length\) \{[\s\S]{0,200}db\.getProducts\(\{ incluirEscriturais: true \}\)/.test(cashback));
check('  e com regra continua o índice completo, com escriturais',
  /productsById = new Map\(\(await db\.getProducts\(\{ incluirEscriturais: true \}\)\)\.map\(\(p\) => \[p\.id, p\]\)\)/.test(cashback));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
