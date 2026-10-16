#!/usr/bin/env node
/**
 * O VENDEDOR SÓ VÊ AS VENDAS DELE E SÓ CRIA (16/10/2026). Pedido do usuário:
 * "quero que os vendedores tenham acesso somente aos pedidos criados por eles,
 * e que eles não consigam aprovar nem faturar ou até mesmo excluir, somente
 * criar pedidos/orçamentos".
 *
 * Vendedor = usuário NÃO administrador com vendedor vinculado em Configurações
 * › Usuários (o mesmo de lib/venda-do-vendedor.js). A regra mora em
 * lib/venda-do-vendedor.js (soCria, soVeAsDele, podeVerVenda) e é cobrada no
 * servidor em cada porta: lista, abrir, gravar, anexos, lote, excluir, emitir
 * NF-e/NFC-e do pedido e a nota manual ligada a pedido. A tela só desliga, com
 * o motivo, o que o servidor recusaria.
 *
 * Provado contra o servidor com um vendedor de teste (papel "usuario", só
 * Vendas, ligado a Eduardo Haas; apagado no fim): lista com 102 vendas, todas
 * dele (o administrador vê 15.193); pedir outro vendedor no filtro não muda
 * nada; pedido de colega → 404; aprovar pelo lote → recusado com o motivo e o
 * pedido continuou "Pedido"; excluir e emitir NFC-e → 403. Na tela: sem
 * lixeira, Mais Ações e ações do pedido desligadas com o motivo, Duplicar
 * ligado, pedido aprovado aberto só para consulta.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const V = require(path.join(RAIZ, 'lib/venda-do-vendedor'));
const escopoLib = require(path.join(RAIZ, 'lib/relatorios-escopo'));
const S = require(path.join(RAIZ, 'public/modules/shared/sales_status'));

console.log('\n--- a regra ---');
const vendedor = escopoLib.escopoDeVendas({ sellerId: 'v1' }, { ehAdmin: false });
const vendedorEq = escopoLib.escopoDeVendas({ sellerId: 'v1', podeAlterarVendasDeOutros: true }, { ehAdmin: false });
const admin = escopoLib.escopoDeVendas({ sellerId: 'v1' }, { ehAdmin: true });
const semVinculo = escopoLib.escopoDeVendas({}, { ehAdmin: false });
check('vendedor só cria', V.soCria(vendedor) && V.soCria(vendedorEq));
check('  administrador e quem não é vendedor, não', !V.soCria(admin) && !V.soCria(semVinculo));
check('vendedor só vê as dele', V.soVeAsDele(vendedor) === 'v1' && V.podeVerVenda(vendedor, 'v1') && !V.podeVerVenda(vendedor, 'v2'));
check('  nem venda sem vendedor', !V.podeVerVenda(vendedor, ''));
check('  com a chave da fase EQ, vê as dos colegas', V.soVeAsDele(vendedorEq) === '' && V.podeVerVenda(vendedorEq, 'v2'));
check('  administrador vê tudo', V.podeVerVenda(admin, 'v2') && V.podeVerVenda(admin, ''));
const n = (s) => S.normalizar(s, undefined);
check('rascunho: só orçamento e pedido', V.ehRascunho('orcamento', n) && V.ehRascunho('pedido', n)
  && !['pedido-pre-faturado', 'pedido-faturado', 'pedido-cancelado', 'orcamento-aprovado', 'pedido-aprovado-sem-faturamento'].some((s) => V.ehRascunho(s, n)));

console.log('\n--- o servidor cobra em cada porta ---');
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
const efeitos = (server.match(/async function aplicarEfeitosDeStatus\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
check('gravar e lote (aplicarEfeitosDeStatus): só rascunho, antes de tudo',
  /if \(vendaDoVendedor\.soCria\(escopo\)\) \{[\s\S]{0,200}if \(!rascunho\(current\.status\)\)[\s\S]{0,200}MOTIVO_APROVADA[\s\S]{0,200}if \(!rascunho\(statusNovo\)\)[\s\S]{0,200}MOTIVO_SO_CRIA/.test(efeitos)
  && efeitos.indexOf('vendaDoVendedor.soCria(escopo)') < efeitos.indexOf('const eraFaturado'));
check('criar: só rascunho', /if \(vendaDoVendedor\.soCria\(escopoDoUsuario\)\s*&& \(type === 'nfe' \|\| !vendaDoVendedor\.ehRascunho\(status,/.test(server));
check('excluir (rota e lote): recusado', /if \(escopoDaExclusao && vendaDoVendedor\.soCria\(escopoDaExclusao\)\) \{/.test(server));
check('lista: o vendedor dele entra no filtro antes de escolher o caminho',
  /if \(soDoVendedor\) url\.searchParams\.set\('sellerId', soDoVendedor\);[\s\S]{0,300}const \{ page, limit \} = parsePageParams[\s\S]{0,200}const listaSemFiltro = /.test(server));
check('  e os cartões contam só as dele', /contagens: soDoVendedor \? \(\(\) => \{/.test(server));
check('  e as outras visões também', /return sendJson\(res, \{ orders: doVendedor\(data\.orders\), quotes: doVendedor\(data\.quotes\), nfes: notasVisiveis/.test(server));
check('abrir: venda de outro = não encontrada', /if \(!vendaDoVendedor\.podeVerVenda\(escopoDeQuemAbre, registro\.sellerId\)\) \{\s*return sendJson\(res, \{ error: 'Pedido\/orçamento não encontrado' \}, 404\);/.test(server));
check('gravar: idem, antes da regra do colega', /if \(!vendaDoVendedor\.podeVerVenda\(escopoDoUsuario, current\.sellerId\)\) \{\s*return sendJson\(res, \{ error: 'Pedido\/orçamento não encontrado' \}, 404\);\s*\}\s*if \(!vendaDoVendedor\.podeMexerNaVenda/.test(server));
check('anexos: idem', /if \(!vendaDoVendedor\.podeVerVenda\(escopoLib\.escopoDeVendas\(user, \{ ehAdmin: await ehAdmin\(user\) \}\), registro\.sellerId\)\)/.test(server));
check('lote: venda invisível nem entra', /\.filter\(\(r\) => r && vendaDoVendedor\.podeVerVenda\(escopoDoUsuario, r\.sellerId\)\)/.test(server));
check('NF-e, NFC-e do pedido e nota manual ligada a pedido: recusadas',
  /async function emitirNfeFiscal\(body, user, opcoes = \{\}\) \{\s*await recusarVendedorNaNotaDoPedido\(user, Boolean\(body\.orderId \|\| body\.saleId\)\);/.test(server)
  && /async function emitirNfceDoPedido\([^)]*\) \{\s*await recusarVendedorNaNotaDoPedido\(user, true\);/.test(server)
  && /await recusarVendedorNaNotaDoPedido\(user, Boolean\(body\.orderId\)\);/.test(server));

console.log('\n--- a tela desliga, com o motivo ---');
// Como em test-sales-actions.js: o catálogo é script de navegador.
global.window = {};
(0, eval)(fs.readFileSync(path.join(RAIZ, 'public/modules/shared/actions_menu.js'), 'utf8'));
global.window.MavisSalesStatus = S;
(0, eval)(fs.readFileSync(path.join(RAIZ, 'public/modules/shared/sales_record_actions.js'), 'utf8'));
const acoes = global.window.MavisSalesRecordActions;
const porId = (id) => acoes.CATALOG.find((a) => a.id === id);
const ctx = { soCria: true, isEditing: true, status: 'pedido', recordType: 'order' };
check('ações do pedido que aprovam, faturam ou cancelam: desligadas para o vendedor',
  acoes.SO_QUEM_NAO_E_VENDEDOR.every((id) => porId(id) && porId(id).enabled(ctx) === acoes.VENDEDOR_SO_CRIA), acoes.SO_QUEM_NAO_E_VENDEDOR.join(','));
check('  e para os outros continuam com a regra de antes', porId('aprovar').enabled({ ...ctx, soCria: false }) === true);
check('  duplicar continua ligado', porId('duplicar').enabled(ctx) === true);
const app = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8'));
check('Mais Ações: as do vendedor desligadas', /const SALES_LOTE_SO_QUEM_NAO_E_VENDEDOR = \['aprovar', 'aprovar_sem_faturamento', 'cancelar', 'excluir', 'nfe', 'nfce'\];/.test(app)
  && /const doVendedor = vendedorSoCria && SALES_LOTE_SO_QUEM_NAO_E_VENDEDOR\.includes\(acao\.id\);/.test(app));
check('lista sem lixeira para o vendedor', /\$\{vendedorSoCria \? '' : `<button class="icon-button sales-delete-record"/.test(app));
check('pedido aprovado abre só para consulta', /const aprovadoParaOVendedor = Boolean\(isEditing && meuVendedor\.soCria\s*&& !\['orcamento', 'pedido'\]\.includes\(SalesStatus\.normalizar\(editRecord\.status\)\)\);/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
