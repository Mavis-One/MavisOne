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
check('  que abre a janela compartilhada com a entrada daquela nota', /await window\.MavisResumoEntrada\.abrir\(\{ api, showToast, entradaId: doc\.entradaId \}\);/.test(tela));
check('  sem o módulo Compras, avisa em vez de falhar', /O resumo da entrada é do módulo Compras/.test(tela));

// 15/10/2026, segundo pedido: o resumo também em Notas de Entrada e abrindo
// sozinho no fim do lançamento. A janela virou shared/resumo_entrada.js.
console.log('\n--- a janela (shared/resumo_entrada.js) ---');
const R = require('../public/modules/shared/resumo_entrada.js');
const base = {
  entrada: { numero: '42292', serie: '1', chave: '4'.repeat(44), dataEmissao: '2026-10-14', naturezaOperacao: 'Venda', emitenteNome: 'POSTO', emitenteDocumento: '07063295000941',
    destinatarioNome: 'MATRIZ', destinatarioDocumento: '43792899000135', valorProdutos: 251.5, valorTotal: 251.5, status: 'LANCADA', gerouFinanceiro: true, criadoPorNome: 'Ana', criadoEm: '2026-10-15T15:00:00Z' },
  itens: [{ numero: 1, descricao: 'Diesel', unidade: 'L', quantidade: 32.705, valorUnitario: 7.69, valorTotal: 251.5, produto: { nome: 'DIESEL', codigo: '100635' }, movimentouEstoque: true }],
  depositos: [{ nome: 'Depósito Matriz', quantidade: 32.705 }],
  titulos: [{ codigo: 'LF1', vencimento: '2026-11-14', valor: 251.5, status: 'pending' }],
  recebida: { manifestacaoCodigo: '210200', situacao: 'cancelada' },
  comValores: true
};
const comValores = R.desenhar(base);
const semValores = R.desenhar({ ...base, comValores: false, entrada: { ...base.entrada, valorProdutos: null, valorTotal: null } });
check('mostra manifestação e situação na SEFAZ (confirmação ou cancelamento)', /210200 - /.test(comValores) && /Cancelada pelo emitente/.test(comValores));
check('depósito, itens, totais e contas a pagar', /Depósito Matriz \(32\.705\)/.test(comValores) && /DIESEL \(100635\)/.test(comValores)
  && /Total da nota/.test(comValores) && /LF1/.test(comValores));
check('sem valores (quem não é administrador): sem Unitário, Total e Valor', !/Unitário|Total da nota|<th class="col-valor">Valor<\/th>|R\$/.test(semValores) && /LF1/.test(semValores));
check('o servidor manda os valores só a administrador', /resumoDaEntrada\(id, \{ comValores: await ehAdmin\(user\) \}\)/.test(server)
  && /valorTotal: comValores \? entrada\.valorTotal : null,/.test(server) && /valor: comValores \? Number\(t\.amount \|\| 0\) : null,/.test(server));
check('  e a manifestação e a situação da nota recebida', /from nfe_distribuicao\s*where entrada_id = \$1 or chave = \$2/.test(server));
check('a janela é carregada na página', fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8').includes('/modules/shared/resumo_entrada.js'));

console.log('\n--- onde mais ela abre ---');
const entradaTela = ler('public/modules/purchases/subs/entrada_nfe.js');
check('Notas de Entrada: "ver resumo" em cada linha de Últimas entradas', /data-resumo-entrada="\$\{escapeHtml\(e\.id\)\}">ver resumo<\/button>/.test(entradaTela)
  && /window\.MavisResumoEntrada\.abrir\(\{ api, showToast, entradaId: botao\.dataset\.resumoEntrada \}\)/.test(entradaTela));
check('fim do lançamento sem contas a pagar: abre logo depois de lançar', /desenhar\(\);\s*if \(window\.MavisResumoEntrada && idDaEntrada\) window\.MavisResumoEntrada\.abrir\(\{ api, showToast, entradaId: idDaEntrada \}\);/.test(entradaTela));
check('  com contas a pagar: a fila leva a entrada', /entradaId: idDaEntrada,/.test(entradaTela));
const titulo = ler('public/modules/finance/subs/novo_lancamento.js');
check('  e o último título salvo abre o resumo', /renderSuccess\(result\.entry, result\.entries\);\s*if \(filaDaEntrada && filaDaEntrada\.entradaId && window\.MavisResumoEntrada\) \{\s*window\.MavisResumoEntrada\.abrir\(\{ api, showToast, entradaId: filaDaEntrada\.entradaId \}\);/.test(titulo));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
