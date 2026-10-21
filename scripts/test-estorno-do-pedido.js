// O TÍTULO SAIU, O PEDIDO É ESTORNADO (21/10/2026, pedido do usuário, no print
// do pedido 16570 em Pré-Faturado: "esse pedido precisa ser estornado, quero
// que essa função seja implementada a partir do momento que eu excluo ou
// estorno o título da mesma").
//
// Pedido Pré-Faturado que fica sem nenhum título valendo (excluídos ou
// cancelados) volta a "Pedido Não Faturado" — a porta de volta do cancelamento
// da NF-e — e pode ser corrigido e aprovado de novo. Ao subir, o mesmo para os
// que já tinham ficado assim (o 16570).
//
// Provado na 3099 com um pedido de teste de duas parcelas (apagado depois):
// excluir uma → seguiu Pré-Faturado; cancelar a outra pelo lote → "O pedido
// 16364 ficou sem títulos e voltou a "Pedido Não Faturado""; aprovado de novo,
// cancelar o único título → voltou; aprovado de novo, excluir os dois → voltou;
// aprovado de novo e os títulos apagados por fora com a trilha da exclusão →
// ao reiniciar: "Pedido 16364: sem títulos, voltou a "Pedido Não Faturado"".
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

const server = semComentarios(ler('server.js'));
const funcao = (server.match(/async function estornarPedidoSemTitulos\(pedidoId, user\) \{[\s\S]*?\n\}/) || [''])[0];

console.log('\n--- a regra ---');
check('só o pedido Pré-Faturado', /if \(!pedido \|\| salesStatus\.normalizar\(pedido\.status\) !== 'pedido-pre-faturado'\) return '';/.test(funcao));
check('  e só sem nenhum título valendo (excluído some; cancelado não vale)',
  /select count\(\*\)::int as valendo from financial_entries where reference_id = \$1 and coalesce\(status, ''\) <> 'cancelado'/.test(funcao)
  && /if \(Number\(rows\[0\] && rows\[0\]\.valendo\) > 0\) return '';/.test(funcao));
check('volta a "Pedido Não Faturado" pelas regras de status de sempre',
  /await mudarStatusSalesRecord\(\{ id: pedido\.id, code: pedido\.code \}, 'pedido-nao-faturado', dataVendas, user\);/.test(funcao));
check('  com o pedido e os lançamentos dele carregados',
  /syncSalesDataDosIds\(dataVendas, \[pedidoId\]\)/.test(funcao) && /syncFinanceDataDosPedidos\(dataVendas, \[pedidoId\]\)/.test(funcao));
check('  e fica na trilha', /action: 'pedidoEstornadoSemTitulos'/.test(funcao));
check('falha não derruba a exclusão do título', /catch \(erro\) \{\s*console\.error\('Título excluído ou cancelado, mas não consegui estornar o pedido'/.test(funcao));
const catalogo = require('../public/modules/shared/sales_status.js');
check('a volta é uma transição que o catálogo (e o banco) aceitam', catalogo.podeTransicionar('pedido-pre-faturado', 'pedido-nao-faturado')
  && catalogo.podeTransicionar('pedido-nao-faturado', 'pedido-pre-faturado'));

console.log('\n--- onde ela roda ---');
check('excluir títulos', /referenciasExcluidas\.add\(entry\.referenceId\)/.test(server)
  && /for \(const referencia of referenciasExcluidas\) \{\s*const codigoDoPedido = await estornarPedidoSemTitulos\(referencia, user\);/.test(server));
check('cancelar em lote', /referenciasCanceladas\.add\(entry\.referenceId\)/.test(server)
  && /for \(const referencia of referenciasCanceladas\) \{\s*const codigoDoPedido = await estornarPedidoSemTitulos\(referencia, user\);/.test(server));
check('cancelar um título', /const pedidoEstornado = await estornarPedidoSemTitulos\(entry\.referenceId, user\);/.test(server));
check('  e a resposta diz qual pedido voltou',
  (server.match(/resumo: \[listaDeLancamentos\.resumo\(processados\.length, ignorados\.length\), fraseDosPedidosEstornados\(pedidosEstornados\)\]\.filter\(Boolean\)\.join\(' '\)/g) || []).length === 2
  && /pedidoEstornado, aviso: fraseDosPedidosEstornados\(\[pedidoEstornado\]\)/.test(server));
check('ao subir, os que já ficaram sem título (o 16570)',
  /estornarPedidosQueFicaramSemTitulos\(\)\.catch/.test(server)
  && /a\.action = 'excluirLancamento'\s*and a\.details->'lancamento'->>'referenceId' = o\.id/.test(server)
  && /where o\.status = 'pedido-pre-faturado'\s*and not exists \(select 1 from financial_entries f where f\.reference_id = o\.id and coalesce\(f\.status, ''\) <> 'cancelado'\)/.test(server));

console.log('\n--- a tela ---');
const tela = ler('public/modules/finance/subs/lancamentos.js');
check('cancelar e excluir avisam o pedido que voltou',
  /if \(resposta && resposta\.aviso\) showToast\(resposta\.aviso, 'info', 8000\);/.test(tela)
  && /if \(\(resposta\.pedidosEstornados \|\| \[\]\)\.length\) showToast\(resposta\.resumo, 'info', 8000\);/.test(tela));
check('  e a pergunta da exclusão já diz', tela.includes('Pedido Pré-Faturado que ficar sem nenhum título volta a "Pedido Não Faturado".'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
