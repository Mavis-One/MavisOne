#!/usr/bin/env node
/**
 * OS TÍTULOS NASCEM NA APROVAÇÃO, E O PEDIDO APROVADO NÃO SE ALTERA
 * (16/10/2026). Pedidos do usuário: "não está abrindo a tela editar título
 * quando estou aprovando pedidos ... para eu poder ajeitar caixa certinho"
 * (escolhido: gerar os títulos na aprovação) e "pedido aprovado, não pode ser
 * alterado!" (escolhido: para todos, administrador inclusive).
 *
 * Provado no servidor local com um pedido de teste (R$ 10 no boleto + R$ 5 em
 * dinheiro): Aprovar Pedido abriu "Pedido 16346 · título 1 de 2"; salvar abriu
 * o 2º (o do dinheiro, já recebido); "Voltar ao pedido" o reabriu Pré-Faturado,
 * com os campos desligados. Alterar como administrador: 409. Excluir: 409.
 * Cancelar mandando item e nota trocados: cancelou com o pedido como estava e
 * cancelou os 2 títulos (a baixa automática do dinheiro saiu junto). Tudo o
 * que o teste criou foi apagado.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const S = require('../public/modules/shared/sales_status');
const { parcelasDoPedido } = require('../lib/vendas-financeiro');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));

console.log('--- 1. o catálogo ---');
check('Pré-Faturado cria títulos, mas não é "faturado"', S.criaTitulos('pedido-pre-faturado') && !S.geraFinanceiro('pedido-pre-faturado'));
check('Faturado (e o legado "faturado") cria títulos', S.criaTitulos('pedido-faturado') && S.criaTitulos('faturado'));
check('rascunho, não faturado, sem faturamento e cancelado não criam',
  ['pedido', 'pedido-nao-faturado', 'pedido-aprovado-sem-faturamento', 'pedido-cancelado', 'orcamento-aprovado'].every((s) => !S.criaTitulos(s)));
check('travam: Pré-Faturado, Faturado, Sem Faturamento, Parcial',
  ['pedido-pre-faturado', 'pedido-faturado', 'pedido-aprovado-sem-faturamento', 'pedido-parcialmente-faturado'].every((s) => S.travaAlteracao(s)));
check('  não travam: Pedido, Não Faturado, Cancelado, orçamentos',
  ['pedido', 'pedido-nao-faturado', 'pedido-cancelado', 'orcamento', 'orcamento-aprovado'].every((s) => !S.travaAlteracao(s)));

console.log('\n--- 2. o servidor cria na aprovação e completa na nota ---');
const servidor = ler('server.js');
check('a transição cria os títulos por criaTitulos',
  /const vaiGerarFinanceiro = tipoNovo === 'order' && salesStatus\.criaTitulos\(statusNovo\)\s*&& \(eraFaturado \|\| regraCategoria\.geraFinanceiro\);/.test(servidor));
check('  a criação já aprovada também', /const geraFinanceiroAgora = type === 'order' && salesStatus\.criaTitulos\(status\) && regraCategoria\.geraFinanceiro;/.test(servidor));
check('  a autorização da nota não cria de novo (já aplicado = nada a fazer)',
  /async function transitionOrderFinanceEffect\(data, \{ record, wasApplied, willApply, user \}\) \{\s*if \(wasApplied === willApply\) return/.test(servidor));
check('  e põe o número da nota nos títulos da aprovação',
  /await mudarStatusSalesRecord\(\{ id: pedido\.id, code: pedido\.code \}, 'pedido-faturado', dataVendas, quemFatura\);\s*if \(pedido\.financeApplied\) await anotarNotaNoFinanceiroDoPedido\(dataVendas, pedido, nfe\.numero\);/.test(servidor));
const pedido = { id: 'o1', code: 16346, date: '2026-10-16', totalAmount: 15, amount: 15, payments: [{ methodId: 'b', amount: 10 }, { methodId: 'd', amount: 5 }] };
const semNota = parcelasDoPedido(pedido, new Map(), { nfeNumero: '' }).map((p) => p.description);
const comNota = parcelasDoPedido(pedido, new Map(), { nfeNumero: '5053' }).map((p) => p.description);
check('  (a descrição da aprovação vira a do faturamento)', semNota[0] === 'Receita de venda · Pedido 16346 · Parcela 1/2'
  && comNota[0] === 'Receita de venda · Pedido 16346 · NF-e 5053 · Parcela 1/2', JSON.stringify([semNota[0], comNota[0]]));

console.log('\n--- 3. o pedido aprovado não se altera ---');
check('gravar sem trocar o status: recusado',
  /const travadoPorAprovacao = isOrder && salesStatus\.travaAlteracao\(current\.status\);\s*if \(travadoPorAprovacao\s*&& salesStatus\.normalizar\(body\.status \|\| current\.status, undefined\) === salesStatus\.normalizar\(current\.status, undefined\)\) \{\s*return sendJson\(res, \{ error: salesStatus\.MOTIVO_PEDIDO_APROVADO \}, 409\);/.test(servidor));
check('  trocar o status segue com os itens gravados',
  /const itensBrutos = travadoPorAprovacao\s*\? \(current\.items \|\| \[\]\)/.test(servidor));
check('  e com o resto do pedido como estava',
  /if \(travadoPorAprovacao\) \{\s*updated = \{ \.\.\.current, type: tipoNovo, status: statusNovo, updatedByName: updated\.updatedByName, updatedAt: updated\.updatedAt \};/.test(servidor));
check('excluir: recusado (com título ou aprovado)',
  /if \(isOrder && \(salesStatus\.travaAlteracao\(record\.status\) \|\| record\.financeApplied\)\) \{\s*const erro = new Error\('Pedido aprovado não é excluído: cancele o pedido\.'\);/.test(servidor));
const lote = ler('public/modules/shared/sales_bulk_actions.js');
check('  e a exclusão em lote diz o porquê', /if \(\(ehPedido\(r\) && S\.travaAlteracao\(r\.status\)\) \|\| r\.financeApplied\) return 'Pedido aprovado não é excluído — cancele primeiro\.';/.test(lote));

console.log('\n--- 4. a tela ---');
const app = ler('public/app.js');
check('o pedido aprovado abre só para consulta, para todos',
  /const aprovadoTravado = Boolean\(isEditing && editRecord\.type === 'order' && SalesStatus\.travaAlteracao\(editRecord\.status\)\);/.test(app)
  && /const somenteConsulta = deOutroVendedor \|\| aprovadoParaOVendedor \|\| aprovadoTravado;/.test(app));
check('  sem a lixeira na lista', /\$\{vendedorSoCria \|\| \(record\.type === 'order' && SalesStatus\.travaAlteracao\(record\.status\)\) \|\| record\.financeApplied \? '' :/.test(app));
check('aprovar abre os títulos criados, um após o outro',
  /if \(SalesStatus\.criaTitulos\(novoStatus\) && Number\(resposta\?\.financeiro\?\.criadas \|\| 0\) > 0 && gerados\.length\s*&& \(state\.user\?\.allowedModules \|\| \[\]\)\.includes\('finance'\)\) \{/.test(app)
  && /state\.financeFilaDaEntrada = \{\s*ids: gerados,\s*titulo: `Pedido /.test(app)
  && /volta: \{ module: 'sales', sub: 'new_sale', rotulo: 'Voltar ao pedido', recordId: editRecord\.id \}/.test(app));
const titulo = ler('public/modules/finance/subs/novo_lancamento.js');
check('  a Edição de Título mostra o pedido e a posição', /\$\{escapeHtml\(\(filaDaEntrada\.tituloDe && filaDaEntrada\.tituloDe\[editEntry\.id\]\) \|\| filaDaEntrada\.titulo \|\| `Entrada da \$\{filaDaEntrada\.nota\}`\)\} · título/.test(titulo));
check('  e o último volta ao pedido aberto',
  /async function voltarDaFila\(\) \{[\s\S]{0,200}if \(volta\.recordId\) \{[\s\S]{0,200}state\.salesDraft = \{ \.\.\.\(state\.salesDraft \|\| \{\}\), editRecord: res\.record, novoStatus: '' \};/.test(titulo));

// Queixa do usuário (16/10/2026, depois do commit): a Edição de Título não
// abria. Aprovar pela LISTA (seleciona e "Aprovar") ia ao lote do servidor e
// voltava para a lista; só o Aprovar de dentro do pedido abria a fila.
console.log('\n--- 4b. aprovar pela lista também abre os títulos ---');
check('o lote devolve os títulos que cada troca criou',
  /const antes = new Set\(doPedido\(\)\);\s*await mudarStatusSalesRecord\(registro, acao\.destino\(registro\), data, user\);\s*resultados\.push\(\{ id: registro\.id, code: registro\.code, titulos: doPedido\(\)\.filter\(\(tituloId\) => !antes\.has\(tituloId\)\) \}\);/.test(servidor));
check('  e a lista abre a fila com eles, cada título com o seu pedido',
  /const comTitulos = \(resposta\.resultados \|\| \[\]\)\.filter\(\(r\) => \(r\.titulos \|\| \[\]\)\.length\);/.test(app)
  && /tituloDe: Object\.fromEntries\(comTitulos\.flatMap\(\(r\) => r\.titulos\.map\(\(id\) => \[id, `Pedido \$\{r\.code\}`\]\)\)\),/.test(app)
  && /volta: \{ module: 'sales', sub: 'orders_quotes', rotulo: 'Voltar aos Pedidos e Orçamentos' \}/.test(app));
check('as confirmações dizem que as contas a receber nascem na aprovação',
  /As contas a receber são geradas agora e a Edição de Título abre em seguida\./.test(ler('public/modules/shared/sales_record_actions.js'))
  && /com as contas a receber geradas agora\./.test(ler('public/modules/shared/sales_bulk_actions.js')));

console.log('\n--- 5. Pagamentos › Lançamentos financeiros ---');
// Pedido do usuário (16/10/2026): "dentro de pagamentos para pedidos já
// aprovados faça uma segunda aba para lançamentos financeiros que puxe os
// dados do título já corretamente". Provado com o pedido 16347 de teste: as
// duas abas, os 2 títulos (LF28350 boleto pendente, LF28351 dinheiro
// recebido), a linha abrindo a Edição de Título e a volta ao pedido.
const rotaDosTitulos = servidor.indexOf("const rotaTitulos = pathname.match(/^\\/api\\/sales\\/records\\/([^/]+)\\/titulos$/);");
check('a rota dos títulos vem antes do GET genérico do pedido',
  rotaDosTitulos > 0 && rotaDosTitulos < servidor.indexOf("if (pathname.startsWith('/api/sales/records/') && req.method === 'GET')"));
const corpoDaRota = servidor.slice(rotaDosTitulos, rotaDosTitulos + 2000);
check('  só quem vê a venda, só os títulos a receber dela, pelas contas da ficha do Financeiro',
  /vendaDoVendedor\.podeVerVenda\(escopoDeQuemAbre, registro\.sellerId, registro\.createdBy, user\.id\)/.test(corpoDaRota)
  && /\.filter\(\(entry\) => entry\.referenceId === id && entry\.type === 'RECEITA'\)/.test(corpoDaRota)
  && /amountRealizado: realizadoDoLancamento\(entry, baixas\),\s*emAberto: financeEntryEmAberto\(entry, baixas\),\s*status: financeEntryStatusLabel\(entry\),/.test(corpoDaRota)
  && /amountRealizado: realizadoDoLancamento\(entry, payments\),/.test(servidor));
check('a aba aparece no pedido com títulos',
  /const pedidoComTitulos = Boolean\(isEditing && editRecord\.type === 'order'\s*&& \(editRecord\.financeApplied \|\| SalesStatus\.criaTitulos\(editRecord\.status\)\)\);/.test(app)
  && /data-subaba-botao="titulos">Lançamentos financeiros<\/button>/.test(app));
check('  lida ao entrar na aba', /if \(qual === 'titulos'\) carregarTitulosDoPedido\(\);/.test(app)
  && /await api\(`\/api\/sales\/records\/\$\{encodeURIComponent\(editRecord\.id\)\}\/titulos`\)/.test(app));
check('  e a linha abre a Edição de Título com volta ao pedido',
  /state\.financeReturnTo = \{ module: 'sales', sub: 'new_sale', recordId: editRecord\.id \};\s*state\.financeEditEntryId = linha\.dataset\.titulo;/.test(app));
check('  e as abas continuam clicáveis no pedido travado', /if \(!campo\.closest\('\.sales-subabas'\)\) campo\.disabled = true;/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
