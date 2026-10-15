#!/usr/bin/env node
/**
 * O RESUMO DA ENTRADA LANÇADA (15/10/2026). Pedido do usuário: "adicione um
 * botão após dar entrada nas NF como forma de visualizar um resumo do que foi
 * realizado na entrada (itens, valores, depósito, confirmação ou
 * cancelamento)".
 *
 * Provado no navegador (servidor local, nota recebida da Matriz com 3
 * duplicatas injetadas só para o teste): depois de lançada, a linha da nota em
 * Notas contra CNPJ ganhou "Ver entrada"; a janela mostrou emitente, quem
 * recebeu, manifestação 210200, "Autorizada", quando e por quem foi lançada,
 * "Completa", "Depósito Matriz (2)", o item com o produto vinculado e
 * "Entrou", produtos e total R$ 38,00 e as 3 contas a pagar (com o vencimento
 * alterado na Edição de Título). Sem a referência no movimento (entrada
 * antiga), o depósito veio pelo documento "NF-e n/s". Tudo o que o teste criou
 * foi apagado.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const server = ler('server.js');
const tela = ler('public/modules/fiscal/subs/notas_contra_cnpj.js');

console.log('\n--- o servidor ---');
check('a rota do resumo vem antes da rota genérica da entrada',
  server.indexOf("pathname.endsWith('/resumo') && req.method === 'GET'") > 0
  && server.indexOf("pathname.endsWith('/resumo') && req.method === 'GET'") < server.indexOf("if (pathname.startsWith('/api/purchases/entrada-nfe/') && req.method === 'GET')"));
check('  e cobra o módulo Compras', /endsWith\('\/resumo'\) && req\.method === 'GET'\) \{\s*try \{\s*const user = await getCurrentUser\(req\);\s*if \(!user \|\| !user\.allowedModules\.includes\('purchases'\)\)/.test(server));
const fn = server.slice(server.indexOf('async function resumoDaEntrada'), server.indexOf('async function xmlDaNotaRecebida'));
check('o depósito sai dos movimentos da entrada (pela referência, ou pelo documento nas antigas)',
  /m\.reference_id = \$1\s*or \(m\.reference_id = '' and m\.origin = 'entrada-nfe' and m\.document = \$2\s*and m\.product_id = any\(\$3::text\[\]\) and m\.date = \$4::date\)/.test(fn));
check('as contas a pagar são as que a entrada gerou', /from financial_entries where reference_id = \$1/.test(fn));
check('o item leva o produto vinculado e se entrou no estoque', /produto: produto \? \{ id: produto\.id, nome: produto\.name, codigo: produto\.sku \|\| '' \} : null,/.test(fn) && /movimentouEstoque: item\.movimentouEstoque/.test(fn));
check('o movimento da entrada passa a guardar o id dela',
  /origin: 'entrada-nfe',\s*referenceType: 'entrada-nfe',\s*referenceId: entrada\.id/.test(server));

console.log('\n--- a tela ---');
check('nota lançada ganha "Ver entrada"', /if \(doc\.entradaId\) \{\s*botoes\.push\(`<button type="button" class="secondary" data-ver-entrada=/.test(tela));
check('  que pede o resumo da entrada daquela nota', /api\(`\/api\/purchases\/entrada-nfe\/\$\{encodeURIComponent\(doc\.entradaId\)\}\/resumo`\)/.test(tela));
check('  mostra manifestação e situação na SEFAZ (confirmação ou cancelamento)',
  /linha\('Manifestação',/.test(tela) && /Cancelada pelo emitente/.test(tela));
check('  depósito, itens, totais e contas a pagar',
  /linha\('Depósito',/.test(tela) && /<h4>Itens<\/h4>/.test(tela) && /Total da nota/.test(tela) && /<h4>Contas a pagar<\/h4>/.test(tela));
check('  sem o módulo Compras, avisa em vez de falhar', /O resumo da entrada é do módulo Compras/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
