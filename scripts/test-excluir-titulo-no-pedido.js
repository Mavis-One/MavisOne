#!/usr/bin/env node
/**
 * EXCLUIR O TÍTULO PELA ABA "LANÇAMENTOS FINANCEIROS" DO PEDIDO (30/10/2026).
 *
 *   node scripts/test-excluir-titulo-no-pedido.js
 *
 * Pedido do usuário: "preciso de um botão pra excluir para lançamentos de
 * título por essa tela" (Pedido › Pagamentos › Lançamentos financeiros). O
 * mesmo caminho da lista de Lançamentos: a permissão Financeiro › excluir (ou
 * administrador), a prévia no servidor (baixas, extrato, o que impede), o
 * motivo de 10 caracteres na auditoria, e o pedido Pré-Faturado sem títulos
 * volta (estornarPedidoSemTitulos).
 *
 * Provado na 3099 com o pedido 15513: o "excluir" na linha, cancelar não apaga
 * nem abre a Edição de Título, excluir tira o título da aba. Título devolvido
 * ao banco depois.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const aba = app.slice(app.indexOf('const carregarTitulosDoPedido = async () => {'), app.indexOf("content.querySelectorAll('[data-subaba-botao]')"));

check('achei a aba dos títulos do pedido', aba.length > 1000);
check('o botão só para quem exclui no Financeiro (ou administrador)',
  /const excluiTitulo = abreTitulo && \(usuarioEhAdmin\(\)\s*\|\| \(Array\.isArray\(state\.user\?\.permissions\) && state\.user\.permissions\.includes\('finance\.excluir'\)\)\);/.test(aba));
check('  uma coluna a mais só com o botão', /\$\{excluiTitulo \? '<th><\/th>' : ''\}/.test(aba)
  && /\$\{excluiTitulo \? `<td><button type="button" class="entrada-link is-danger" data-excluir-titulo=/.test(aba));
check('o clique no botão não abre a Edição de Título da linha', /evento\.stopPropagation\(\);[^\n]*\n\s*excluirTituloDoPedido\(botao\);/.test(aba));
check('a prévia antes do motivo', /body: JSON\.stringify\(\{ ids: \[id\], previa: true \}\)/.test(aba));
check('  o que impede vira aviso, sem excluir', /if \(!item \|\| item\.motivo\) \{[\s\S]{0,200}não pode ser excluído agora/.test(aba));
check('  baixas e extrato avisados', /item\.baixas > 0/.test(aba) && /item\.conciliadas/.test(aba));
check('o motivo (10 a 300) vai junto', /minimo: 10,\s*maximo: 300,/.test(aba) && /body: JSON\.stringify\(\{ ids: \[id\], motivo \}\)/.test(aba));
check('pedido que voltou a Não Faturado reabre com o status novo',
  /if \(\(resposta\.pedidosEstornados \|\| \[\]\)\.length\) \{[\s\S]{0,300}state\.salesDraft\.editRecord = record \|\| null;\s*renderApp\(\);\s*loadModule\('sales'\);/.test(aba));
check('  senão, a lista de títulos é relida', /await carregarTitulosDoPedido\(\);/.test(aba));
check('o servidor cobra a permissão e o motivo na mesma rota',
  /pathname === '\/api\/finance\/entries' && req\.method === 'DELETE'/.test(servidor)
  && /Informe o motivo da exclusão \(pelo menos 10 caracteres\)\./.test(servidor));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
