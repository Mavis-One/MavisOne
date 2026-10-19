// A NF-E CANCELADA QUE NÃO DESFATUROU O PEDIDO (19/10/2026).
//
// Log do VPS de 17/10: "NF-e cancelada, mas nao consegui desfaturar o pedido
// ord-1791913849932-..." — o gatilho do banco recusou "pedido-faturado nao vira
// pedido-nao-faturado". O par existia no sistema desde 04/09 (fase BF), mas
// entrou EDITANDO a fase-aj, que já tinha rodado; o banco local também não o
// tinha. E o estoque é gravado ANTES do pedido: voltou, e o pedido ficou
// faturado com as contas a receber em aberto.
//
// Três partes:
//   1. fase-eu: a lista do banco regravada (o par está lá);
//   2. o banco é perguntado ANTES de qualquer efeito (estoque, títulos);
//   3. ao subir, o servidor refaz o desfaturamento que ficou na trilha, e o
//      RAZÃO decide se o estoque volta — no caso de 17/10 ele já tinha voltado.
//
// Provado no banco local, com a Focus substituída (nada saiu para a rede):
// pedido de teste aprovado -> nota "autorizada" -> faturado (2 un. baixadas)
// -> nota "cancelada" com a lista velha: o pedido ficou faturado e o estoque
// NÃO voltou (a recusa veio antes). Migração + subida: desfaturado, estoque de
// volta uma vez, título cancelado. Estado do VPS (faturado com o estoque já
// devolvido): na subida, desfaturado sem devolver de novo (razão igual, saldo
// igual). Terceira subida: nada. Dados de teste apagados.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = ler('server.js');
const migracao = ler('banco/migrations/fase-eu-transicoes-de-status-em-dia.sql');

console.log('--- 1. a lista do banco ---');
check('a fase-eu regrava a lista inteira', /delete from sales_status_transicao;\s*insert into sales_status_transicao \(de, para\) values/.test(migracao));
check('  com a volta faturado -> não faturado', migracao.includes("('pedido-faturado', 'pedido-nao-faturado')"));
check('  sem begin/commit próprios (o aplicador já abre a transação)', !/^\s*(begin|commit);/im.test(migracao));

console.log('\n--- 2. o banco é perguntado antes dos efeitos ---');
const ini = servidor.indexOf('async function aplicarEfeitosDeStatus(');
const corpo = servidor.slice(ini, servidor.indexOf('\n}\n', ini));
const pergunta = corpo.indexOf('await transicaoValidaNoBanco(current.status, statusNovo) === false');
check('a pergunta existe', pergunta > 0);
check('  e vem antes do estoque e dos títulos', pergunta > 0 && pergunta < corpo.indexOf('await transitionOrderStockEffect(') && pergunta < corpo.indexOf('await transitionOrderFinanceEffect('));
check('  só quando o status muda, na mesma tabela', /if \(isOrder === \(tipoNovo === 'order'\)\s*&& salesStatus\.normalizar\(current\.status\) !== salesStatus\.normalizar\(statusNovo\)/.test(corpo));
check('  pela mesma função do gatilho', /select sales_status_transicao_valida\(\$1, \$2\) as ok/.test(servidor));
check('  sem conseguir perguntar, decide a gravação (null)', /async function transicaoValidaNoBanco[\s\S]{0,400}catch \(erro\) \{\s*return null;/.test(servidor));

console.log('\n--- 3. refeito ao subir ---');
const r0 = servidor.indexOf('async function refazerDesfaturamentosQueFalharam()');
const refazer = servidor.slice(r0, servidor.indexOf('\n}\n', r0));
check('lê as falhas da trilha', /action = 'falhaAoDesfaturarPedidoDaNota'/.test(refazer));
check('só nota cancelada, pedido faturado, sem outra nota viva',
  /!== 'CANCELADO'\) continue;/.test(refazer) && /!== 'pedido-faturado'\) continue;/.test(refazer) && /if \(await notaQueSustentaOFaturamento\(pedido\)\) continue;/.test(refazer));
check('o razão decide: o que saiu já voltou -> não devolve de novo',
  /sum\(case when type = 'saida' then quantity else 0 end\)[\s\S]{0,120}sum\(case when type = 'entrada' then quantity else 0 end\)[\s\S]{0,200}reference_type = 'order' and reference_id = \$1/.test(refazer)
  && /<= 0\) \{\s*estoqueJaTinhaVoltado = true;\s*await consultarBanco\('update orders set stock_applied = false where id = \$1'/.test(refazer));
check('  e desfaz a marca se o desfaturamento não vingar', /else if \(estoqueJaTinhaVoltado\) \{[\s\S]{0,300}update orders set stock_applied = true where id = \$1/.test(refazer));
check('pelo mesmo desfaturarPedidoDaNota, sem empilhar falha na trilha',
  /await desfaturarPedidoDaNota\(\{ \.\.\.nfe, orderId: pedidoId \}, null, \{ refazendo: true \}\)/.test(refazer)
  && /if \(!refazendo\) \{\s*await registrarAuditoria\(\{\s*action: 'falhaAoDesfaturarPedidoDaNota'/.test(servidor));
check('o que foi refeito fica na trilha', /action: 'desfaturamentoRefeito'/.test(refazer));
check('roda ao subir', /server\.listen\([\s\S]{0,1500}refazerDesfaturamentosQueFalharam\(\)\.catch/.test(servidor));
check('a trilha mostra o nome da ação', /desfaturamentoRefeito: 'Desfaturamento refeito'/.test(ler('public/modules/settings/subs/access_logs.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
