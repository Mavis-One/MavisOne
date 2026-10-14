#!/usr/bin/env node
// A VENDA É DO VENDEDOR QUE A FEZ + FILTROS DO PAINEL VENDEDOR + MARCA QUE
// LEVA AO DASHBOARD (12/10/2026).
//
// Pedido do usuário: vendedor automático na venda; vendedor não edita pedido
// de outro vendedor; "Pedido/Orçamento criado por" ao lado do "Alterado por";
// botão de filtros no Painel Vendedor; o raio e o "MO" levam ao Dashboard, e o
// ícone do Dashboard sai do menu.
//
// As regras rodam de verdade (funções puras); o encaixe nas rotas e na tela é
// conferido no fonte.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const escopoLib = require('../lib/relatorios-escopo');
const V = require('../lib/venda-do-vendedor');
const F = require('../lib/filtro-painel-vendedor');

const admin = escopoLib.escopoDeVendas({ id: 'a', sellerId: 'p-admin' }, { ehAdmin: true });
const vendedor = escopoLib.escopoDeVendas({ id: 'u', sellerId: 'p-joao' }, { ehAdmin: false });
const semVinculo = escopoLib.escopoDeVendas({ id: 'c', sellerId: '' }, { ehAdmin: false });

console.log('\n--- 1. quem é obrigado a ser quem ---');
check('vendedor fica travado no próprio vínculo', V.vendedorTravado(vendedor) === 'p-joao');
check('admin não é travado (mesmo com vínculo)', V.vendedorTravado(admin) === '');
check('sem vínculo não é travado (caixa, financeiro)', V.vendedorTravado(semVinculo) === '');
check('vendedor grava no próprio nome, venha o que vier', V.vendedorAoGravar(vendedor, 'p-maria') === 'p-joao');
check('  e também quando a tela manda vazio', V.vendedorAoGravar(vendedor, '') === 'p-joao');
check('admin grava o que escolheu', V.vendedorAoGravar(admin, 'p-maria') === 'p-maria');
check('sem escopo (chamada antiga) grava o que veio', V.vendedorAoGravar(null, 'p-maria') === 'p-maria');

console.log('\n--- 2. quem mexe em qual venda ---');
check('vendedor mexe na própria', V.podeMexerNaVenda(vendedor, 'p-joao'));
check('vendedor NÃO mexe na de outro', !V.podeMexerNaVenda(vendedor, 'p-maria'));
check('vendedor mexe em venda sem vendedor (antiga/importada)', V.podeMexerNaVenda(vendedor, ''));
check('admin mexe em qualquer uma', V.podeMexerNaVenda(admin, 'p-maria'));
check('sem vínculo mexe (não é vendedor)', V.podeMexerNaVenda(semVinculo, 'p-maria'));

console.log('\n--- 3. o servidor aplica em toda porta de escrita ---');
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
check('criar: vendedor sai da regra', /sellerId: vendaDoVendedor\.vendedorAoGravar\(escopoDoUsuario, body\.sellerId\),\s*depositId: body\.depositId \|\| '',\s*date: body\.date \|\| new Date/.test(server));
check('editar: recusa venda de outro (403) antes de ler o corpo',
  /if \(!vendaDoVendedor\.podeMexerNaVenda\(escopoDoUsuario, current\.sellerId\)\) \{\s*return sendJson\(res, \{ error: vendaDoVendedor\.MOTIVO_DE_OUTRO_VENDEDOR \}, 403\);\s*\}\s*const body = await readBody\(req\);/.test(server));
check('editar: vendedor sai da regra', /sellerId: vendaDoVendedor\.vendedorAoGravar\(escopoDoUsuario, body\.sellerId\),\s*depositId: body\.depositId \|\| '',\s*date: body\.date \|\| current\.date/.test(server));
check('excluir: a função que exclui confere', /async function excluirSalesRecord\(id, data, user, escopo = null\)[\s\S]{0,400}if \(escopo && !vendaDoVendedor\.podeMexerNaVenda\(escopo, record\.sellerId\)\)/.test(server));
check('  e a rota passa o escopo', /await excluirSalesRecord\(id, data, user, escopoLib\.escopoDeVendas\(user/.test(server));
check('lote: venda de outro vira "não feito" com o motivo', /else if \(!vendaDoVendedor\.podeMexerNaVenda\(escopoDoUsuario, registro\.sellerId\)\) \{\s*falhas\.push\(\{ code: registro\.code, motivo: vendaDoVendedor\.MOTIVO_DE_OUTRO_VENDEDOR \}\);/.test(server));
check('  duplicar continua livre, e a cópia é de quem duplicou', /sellerId: vendaDoVendedor\.vendedorAoGravar\(escopo, serializado\.sellerId\)/.test(server));
check('lote cobra a permissão da AÇÃO (excluir pelo lote pedia só "criar")',
  /const permissaoDaAcao = acaoId === 'excluir' \? 'sales\.excluir' : \(acaoId === 'duplicar' \? '' : 'sales\.editar'\);[\s\S]{0,400}if \(!pode\) return sendJson\(res, \{ error: `Sem permissão para/.test(server));
check('anexos: anexar/excluir recusa venda de outro', /if \(req\.method !== 'GET'\) \{[\s\S]{0,200}podeMexerNaVenda\(escopoDoUsuario, registro\.sellerId\)[\s\S]{0,120}403\);/.test(server));
check('a tela recebe o vendedor do usuário', /meuVendedor: \{\s*sellerId: String\(user\.sellerId \|\| ''\)\.trim\(\),\s*travado: Boolean\(vendaDoVendedor\.vendedorTravado\(escopoDoUsuario\)\)/.test(server));

console.log('\n--- 4. a tela ---');
const app = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8'));
check('venda nova nasce com o vendedor do usuário', /sellerId: vendedorInicial,/.test(app) && /: \(origem \? \(origem\.sellerId \|\| ''\) : meuVendedor\.sellerId\)\);/.test(app));
check('vendedor travado vê o campo fixo (sem seletor)', /\$\{meuVendedor\.travado \|\| deOutroVendedor \? `[\s\S]{0,120}campo-somente-leitura">Vendedor/.test(app));
check('pedido de colega: sem Salvar e campos desligados', /if \(deOutroVendedor\) \{\s*document\.querySelectorAll\('#salesRecordForm input/.test(app) && /salvar\.disabled = true;/.test(app));
check('  e o Enter também não grava', /event\.preventDefault\(\);\s*if \(deOutroVendedor\) \{/.test(app));
check('  e as ações que mudam o pedido ficam bloqueadas', /somenteLeitura: deOutroVendedor,/.test(app));
const acoes = fs.readFileSync(path.join(RAIZ, 'public/modules/shared/sales_record_actions.js'), 'utf8');
check('  (cancelar, aprovar, aprovar sem faturamento, NF-e, NFC-e)', (acoes.match(/if \(ctx\.somenteLeitura\) return DE_OUTRO_VENDEDOR;/g) || []).length === 5);
check('"Pedido/Orçamento criado por" ao lado do "Alterado por"', /\$\{title\} criado por\s*<input value="\$\{escapeHtml\(criadoPor\)\}" disabled \/>\s*<\/label>\s*<label class="sales-total-field is-readonly">Alterado por/.test(app));
check('  criado por não muda ao editar', /const criadoPor = isEditing \? \(editRecord\.createdByName \|\| ''\) : \(state\.user\?\.name \|\| ''\);/.test(app));

console.log('\n--- 5. filtros do Painel Vendedor ---');
const p = (q) => new URLSearchParams(q);
check('lê período, situação e filial', JSON.stringify(F.lerFiltro(p('de=2026-10-01&ate=2026-10-31&status=pedido-faturado&filial=Timbo'))) === JSON.stringify({ de: '2026-10-01', ate: '2026-10-31', status: 'pedido-faturado', filial: 'Timbo' }));
check('data e situação inválidas ficam de fora', JSON.stringify(F.lerFiltro(p('de=ontem&status=xyz'))) === JSON.stringify({ de: '', ate: '', status: '', filial: '' }));
const pedido = { date: '2026-10-05', status: 'pedido-faturado', type: 'order', category: 'Venda / Timbó' };
check('sem filtro: tudo passa', F.passa(pedido, F.lerFiltro(p(''))) && F.passa(pedido, null));
check('dentro do período passa', F.passa(pedido, { de: '2026-10-01', ate: '2026-10-05', status: '', filial: '' }));
check('fora do período não', !F.passa(pedido, { de: '2026-10-06', ate: '', status: '', filial: '' }));
check('situação diferente não', !F.passa(pedido, { de: '', ate: '', status: 'pedido', filial: '' }));
check('filial sem acento e maiúscula casa', F.passa(pedido, { de: '', ate: '', status: '', filial: 'TIMBO' }));
check('outra filial não', !F.passa(pedido, { de: '', ate: '', status: '', filial: 'Araquari' }));
check('servidor recorta antes das contas', /escopoLib\.vendaVisivel\(escopo, record\.sellerId\) && filtroPainelVendedor\.passa\(record, filtro\)/.test(server));
check('  e a lista de pedidos do escolhido', /\.filter\(\(registro\) => filtroPainelVendedor\.passa\(registro, filtro\)\)/.test(server));
check('  o Painel Vendas segue com a conta inteira', /const filtro = querVendedor \? filtroPainelVendedor\.lerFiltro\(url\.searchParams\) : null;/.test(server));
check('tela: botão Filtros com a contagem dos ativos', /id="painelVendedorFiltrosBtn">Filtros\$\{filtrosAtivos/.test(app));

console.log('\n--- 6. a marca leva ao Dashboard ---');
// Só o raio desde 13/10/2026: o "MO" saiu a pedido do usuário.
// Desde 14/10/2026 é link (<a>), para abrir o Dashboard em nova guia.
check('o raio é o botão do Dashboard, sem o "MO"', /<a class="sidebar-header sidebar-marca" id="marcaDashboardBtn" \$\{linkDaTela\('dashboard'\)\}[^>]*>\s*<span class="logo-marca logo-sidebar" aria-hidden="true"><\/span>\s*<\/a>/.test(app));
check('  que abre o Dashboard', /marcaDashboard\.onclick = \(\) => \{[\s\S]{0,200}state\.activeModule = 'dashboard';[\s\S]{0,200}loadModule\('dashboard'\);/.test(app));
check('ícone do Dashboard fora do menu', /\$\{MENU_MODULOS\s*\.filter\(\(module\) => module !== 'dashboard'\)/.test(app));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
