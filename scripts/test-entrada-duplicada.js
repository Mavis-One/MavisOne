// A ENTRADA DE NF-e E OS TÍTULOS EM DUPLICIDADE (19/10/2026).
//
// Pedido do usuário: "o sistema está passando a entrada de NF em duplicidade
// e criando títulos em duplicidade". O que se achou:
//   - a nota lançada no Viper tinha só os TÍTULOS no MavisONE (importações de
//     11/09 e 14/10), sem entrada: Notas contra CNPJ a mostrava pendente, e
//     dar entrada criava títulos e estoque de novo. No banco local, 277 das
//     540 notas recebidas estavam nesse caso;
//   - a mesma chave não entra duas vezes (índice único desde a fase AK), mas o
//     banco do VPS não tinha prova de ter o índice.
// Decisões do usuário: avisar e vir com financeiro e estoque desmarcados;
// listar as que já duplicaram para ele resolver.
//
// Provado no banco local (porta 3099) com o XML de exemplo e um título "do
// Viper" de teste: a conferência achou o título e avisou; a tela veio com
// "Gerar contas a pagar" e o estoque dos itens desmarcados, e a tabela "Já
// lançado no Viper"; lançada assim mesmo, a lista marcou "também no Viper";
// um título igual na entrada marcou "título repetido". Tudo apagado depois.
const fs = require('fs');
const path = require('path');
const V = require('../lib/titulos-do-viper');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- o número da nota no título do Viper ---');
check('importação de 11/09', V.numeroDaNotaNoTitulo('Valor de R$ 416,98 (Parcela 5 de 7). Referente a NF DE ENTRADA de codigo 1479 - Nº 2713, emitida em 30/01/2026', 'Importado do ViperERP em 11/09/2026') === '2713');
check('  sem o "Valor de" na frente', V.numeroDaNotaNoTitulo('Referente a NF DE ENTRADA de codigo 1218 - Nº 009262, emitida em 13/10/2025', '') === '9262');
check('importação de 14/10 (planilha)', V.numeroDaNotaNoTitulo('COMPRA DE MERCADORIA — NF 5808', 'Importado do Viper em 14/10/2026 — 5808/1 (SAL INFINITY PLUS)') === '5808');
check('o título do MavisONE não casa (ele já é a entrada)', V.numeroDaNotaNoTitulo('Despesa de compra · NF-e 12345 · Parcela 1/3', '') === null);
check('"NF" de outra importação não casa', V.numeroDaNotaNoTitulo('Parcela 1/3 - Venda 26003 — NF 3076', 'Importado do ViperERP em 11/09/2026') === null);

console.log('\n--- o casamento: número + fornecedor ---');
const indice = V.montarIndice([
  { id: 'a', code: 1, amount: 100, due_date: '2026-09-01', description: 'Referente a NF DE ENTRADA de codigo 1 - Nº 2713, emitida', note: '', client_supplier_name: 'Vittorello Auto Center', documento: '11.222.333/0001-81' },
  { id: 'b', code: 2, amount: 100, due_date: '2026-08-01', description: 'Referente a NF DE ENTRADA de codigo 1 - Nº 2713, emitida', note: '', client_supplier_name: 'VITTORELLO AUTO CENTER', documento: '' },
  { id: 'c', code: 3, amount: 100, due_date: '2026-08-01', description: 'Referente a NF DE ENTRADA de codigo 1 - Nº 2713, emitida', note: '', client_supplier_name: 'OUTRO FORNECEDOR', documento: '99888777000166' }
]);
const achados = V.titulosDaNota(indice, { numero: '000002713', emitenteDocumento: '11222333000181', emitenteNome: 'VITTORELLO AUTO CENTER LTDA' });
check('pelo CNPJ do cadastro', achados.some((t) => t.id === 'a'));
check('  e pelo nome (título sem cadastro), sem acento nem caixa', V.titulosDaNota(indice, { numero: '2713', emitenteDocumento: '', emitenteNome: 'vittorello auto center' }).length === 2);
check('  o mesmo número de outro fornecedor não entra', !achados.some((t) => t.id === 'c'));
check('  sem número, nada', V.titulosDaNota(indice, { numero: '', emitenteDocumento: '11222333000181' }).length === 0);

console.log('\n--- o servidor ---');
const servidor = ler('server.js');
check('a conferência pergunta pelos títulos do Viper', /const existentes = titulosDoViper\.titulosDaNota\(await indiceDosTitulosDoViper\(\), \{/.test(servidor)
  && /conferencia\.titulosDoViper = existentes\.map/.test(servidor) && /chave: 'viper',/.test(servidor));
check('  uma consulta para todos, guardada por um minuto', /if \(indiceDoViper && Date\.now\(\) - indiceDoViperEm < 60000\) return indiceDoViper;/.test(servidor));
check('  só despesa não cancelada, dos dois formatos', /where f\.type = 'DESPESA' and f\.status <> 'cancelado'\s*and \(f\.description ilike '%NF DE ENTRADA%' or f\.note like 'Importado do Viper em %'\)/.test(servidor));
check('a lista marca as três duplicidades', /entradas: await marcarDuplicidadesDasEntradas\(await entradaNfeDb\.listarEntradas\(\{\}\)\)/.test(servidor)
  && /titulosDoViper: doViper\.map/.test(servidor) && /repetidaCom: outrasDe\.get\(e\.id\) \|\| \[\]/.test(servidor) && /titulosRepetidos: repetidosDe\.get\(e\.id\) \|\| 0/.test(servidor));

console.log('\n--- a tela ---');
const tela = ler('public/modules/purchases/subs/entrada_nfe.js');
check('já no Viper: financeiro desmarcado', /tela\.jaNoViper = tela\.conferencia\.titulosDoViper\.length > 0;\s*if \(tela\.jaNoViper\) tela\.gerarFinanceiro = false;/.test(tela));
check('  e o estoque dos itens também', /movimentarEstoque: Boolean\(item\.vinculo\) && !tela\.jaNoViper/.test(tela));
check('  e mostra os títulos que já existem', /<th>Já lançado no Viper<\/th>/.test(tela));
check('a lista: as marcas e o filtro "Duplicadas"', /também no Viper/.test(tela) && /nota repetida/.test(tela) && /título repetido/.test(tela) && /`Duplicadas \(\$\{quantasDuplicadas\}\)`/.test(tela));

console.log('\n--- o banco ---');
const sql = ler('banco/migrations/fase-ew-chave-unica-da-entrada.sql');
check('confere o índice único da chave e cria se faltar', /i\.indisunique and a\.attname = 'chave'/.test(sql) && /create unique index nfe_entrada_chave_unica on nfe_entrada \(chave\);/.test(sql));
check('  com chave repetida não derruba o deploy (avisa)', /raise notice 'nfe_entrada tem chave repetida/.test(sql) && !/raise exception/.test(sql));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
