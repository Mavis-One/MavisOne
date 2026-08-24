// Transições de status e ações em lote.
//
// Passo 8 do módulo Vendas. O que este teste guarda:
//
//   1. a lista de transições do MÓDULO e a do BANCO são a mesma. Elas não são
//      redigitadas: o SQL é gerado do módulo por scripts/gerar-transicoes-sql.js,
//      e aqui os dois lados são comparados par a par. Divergência aqui é a tela
//      permitindo o que o banco recusa — ou, pior, o contrário;
//   2. o que é porta de saída continua sendo. Faturado só vira cancelado;
//      cancelado e reprovado não voltam;
//   3. ação em lote sobre 15 registros quase nunca se aplica aos 15, e nenhuma
//      delas processa em silêncio o que dá e cala sobre o resto;
//   4. as três operações do lote usam as MESMAS funções da rota individual —
//      aprovar em lote sem gerar as contas a receber seria "aprovado" na tela
//      e nada no Financeiro.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const S = require('../public/modules/shared/sales_status');
const B = require('../public/modules/shared/sales_bulk_actions');

console.log('--- as transições, em português ---');
check('orçamento vira pedido', S.podeTransicionar('orcamento', 'pedido'));
// Faturar orçamento sem virar pedido pularia a conferência.
check('mas NÃO vira faturado direto', !S.podeTransicionar('orcamento', 'pedido-faturado'));
check('pedido vira faturado', S.podeTransicionar('pedido', 'pedido-faturado'));
// Sai mercadoria e nasce dinheiro a receber: qualquer outro destino teria de
// estornar os dois, e estorno é operação própria, não troca de campo.
check('FATURADO só sai para cancelado', S.podeTransicionar('pedido-faturado', 'pedido-cancelado')
  && !S.podeTransicionar('pedido-faturado', 'pedido')
  && !S.podeTransicionar('pedido-faturado', 'orcamento'));
// Reabrir um cancelado é criar outro documento — é isso que mantém o histórico.
check('cancelado não volta', S.destinosDe('pedido-cancelado').length === 0);
check('reprovado não volta', S.destinosDe('orcamento-reprovado').length === 0);
// Salvar um pedido sem mexer no status é a operação mais comum da tela.
check('ficar no mesmo status é sempre permitido', S.podeTransicionar('pedido-faturado', 'pedido-faturado'));
// O status gravado pode ser legado: comparar o texto cru recusaria uma
// transição que é válida.
check('status legado é normalizado antes de comparar', S.podeTransicionar('faturado', 'pedido-cancelado'));
check('a recusa diz para onde DÁ', /Daqui só dá para: Pedido Cancelado/.test(S.motivoDaRecusa('pedido-faturado', 'orcamento')));
check('e situação final se identifica como final', /é situação final/.test(S.motivoDaRecusa('pedido-cancelado', 'pedido')));

console.log('\n--- toda ação que muda status usa uma transição que existe ---');
// Ação do menu do formulário apontando para um destino que a tabela não
// permite seria um botão que sempre falha.
const recordActions = ler('public/modules/shared/sales_record_actions.js');
const destinos = [...recordActions.matchAll(/ctx\.mudarStatus\(\s*'([a-z-]+)'/g)].map((m) => m[1]);
check('as ações do formulário miram status do catálogo', destinos.length > 0, destinos.join(', '));
destinos.forEach((d) => {
  const origens = Object.keys(S.TRANSICOES).filter((o) => S.TRANSICOES[o].includes(d));
  check(`  ${d} é alcançável`, origens.length > 0, `de: ${origens.join(', ')}`);
});

console.log('\n--- o BANCO tem exatamente a mesma lista ---');
const sql = ler('supabase/migrations/fase-aj-transicoes-de-status.sql');
const doSql = new Set([...sql.matchAll(/^\s*\('([a-z-]+)', '([a-z-]+)'\)/gm)].map((m) => `${m[1]}>${m[2]}`));
const doModulo = new Set();
Object.entries(S.TRANSICOES).forEach(([de, lista]) => lista.forEach((para) => doModulo.add(`${de}>${para}`)));
console.log(`    pares no módulo: ${doModulo.size} | no SQL: ${doSql.size}`);
const soNoModulo = [...doModulo].filter((p) => !doSql.has(p));
const soNoSql = [...doSql].filter((p) => !doModulo.has(p));
// Se isto falhar: rode `node scripts/gerar-transicoes-sql.js`.
check('nenhum par existe só no módulo', soNoModulo.length === 0,
  soNoModulo.length ? 'FALTA NO SQL (rode scripts/gerar-transicoes-sql.js): ' + soNoModulo.join(', ') : 'ok');
check('nenhum par existe só no SQL', soNoSql.length === 0,
  soNoSql.length ? 'SOBRANDO NO SQL: ' + soNoSql.join(', ') : 'ok');
// O mapa de legados também tem de estar nos dois lados, senão o pedido antigo
// passa no servidor e é recusado pelo gatilho.
Object.keys(S.LEGADOS).forEach((legado) => {
  check(`  legado "${legado}" também é traduzido no banco`, sql.includes(`when '${legado}' then`));
});

console.log('\n--- os parâmetros não colidem com as colunas ---');
// Esta seção nasceu de um defeito medido contra o banco em 24/08/2026.
//
// A primeira versão nomeou os parâmetros `de`/`para` — os MESMOS nomes das
// colunas da tabela. Dentro do subselect, o Postgres resolve um nome solto como
// COLUNA, não como parâmetro: `sales_status_normalizar(de)` virou
// `sales_status_normalizar(t.de)`, a comparação ficou `t.de = t.de` e o
// `exists()` deu verdadeiro para QUALQUER par. Até "xxx -> yyy" respondia true.
//
// A guarda existia e não guardava nada — pior do que não existir, porque
// parecia estar lá, com teste verde e migração aplicada.
const colunas = ['de', 'para'];
const assinaturas = [...sql.matchAll(/create or replace function\s+\w+\s*\(([^)]*)\)/gi)].map((m) => m[1]);
check('há assinaturas para conferir', assinaturas.length >= 3, `${assinaturas.length} funções`);
assinaturas.forEach((assinatura) => {
  const nomes = assinatura.split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
  const colidem = nomes.filter((n) => colunas.includes(n.toLowerCase()));
  check(`  (${nomes.join(', ')}) não usa nome de coluna`, colidem.length === 0,
    colidem.length ? 'COLIDE: ' + colidem.join(', ') : 'ok');
});
// Trocar nome de parâmetro exige DROP: `create or replace` recusa com
// "cannot change name of input parameter", e quem já rodou a versão anterior
// não conseguiria aplicar a correção.
check('as funções são derrubadas antes de recriadas',
  (sql.match(/drop function if exists/g) || []).length >= 2);

console.log('\n--- o gatilho fecha a porta que sobra ---');
check('há gatilho em orders e em quotes',
  /create trigger orders_status_guarda/.test(sql) && /create trigger quotes_status_guarda/.test(sql));
// Linha nova não vem de lugar nenhum: barrar o INSERT impediria criar pedido.
check('INSERT não passa pela regra', /if tg_op = 'INSERT' then\s*\n\s*return new;/.test(sql));
// Sem esta saída, TODO update de qualquer campo pagaria a consulta.
check('update que não mexe no status sai cedo', /new\.status is not distinct from old\.status/.test(sql));
// RLS ligada e sem política: a função precisa ler as regras como dona, senão
// um usuário `authenticated` teria toda transição recusada.
check('a tabela de regras tem RLS', /alter table sales_status_transicao enable row level security/.test(sql));
check('e as funções leem como donas', (sql.match(/security definer/g) || []).length >= 3);
// SECURITY DEFINER sem search_path fixo é o caminho clássico de sequestro.
check('com search_path fixo', (sql.match(/set search_path = public/g) || []).length >= 3);

console.log('\n--- o servidor recusa antes do banco ---');
const serverSrc = semComentarios(ler('server.js'));
check('o PUT valida a transição', /if \(!salesStatus\.podeTransicionar\(current\.status, statusNovo\)\)/.test(serverSrc));
check('e responde 409 com o motivo',
  /error: salesStatus\.motivoDaRecusa\(current\.status, statusNovo\) \}, 409\)/.test(serverSrc));

console.log('\n--- ações em lote ---');
check('o catálogo existe', B.CATALOGO.length >= 20, `${B.CATALOGO.length} ações`);
// Os seis grupos do briefing.
const grupos = [...new Set(B.CATALOGO.map((a) => a.grupo))];
['Fiscal', 'Documentos', 'Registro', 'Fluxo de venda', 'Expedição', 'Produção'].forEach((g) => {
  check(`  grupo ${g}`, grupos.includes(g));
});
// Toda ação declara elegibilidade: sem isso a rota não sabe o que fazer com ela.
check('toda ação diz quem é elegível', B.CATALOGO.every((a) => typeof a.elegivel === 'function'));
// Ação sem backend não vira botão que não faz nada — fica desabilitada COM o
// motivo. Um `false` seco deixaria a tela sem o que dizer.
const semBackend = B.CATALOGO.filter((a) => a.elegivel({ type: 'order', status: 'pedido' }) !== true);
check('e as indisponíveis explicam por quê',
  semBackend.every((a) => typeof a.elegivel({ type: 'order', status: 'pedido' }) === 'string'
    && a.elegivel({ type: 'order', status: 'pedido' }).length > 15),
  `${semBackend.length} indisponíveis`);

console.log('\n--- elegibilidade: os casos que doem ---');
const faturado = { id: '1', type: 'order', status: 'pedido-faturado', code: 1 };
const pedido = { id: '2', type: 'order', status: 'pedido', code: 2 };
const orcamento = { id: '3', type: 'quote', status: 'orcamento', code: 3 };
const comNota = { id: '4', type: 'order', status: 'pedido', nfeId: 'nfe-1', code: 4 };

const aprovar = B.avaliar('aprovar', [faturado, pedido, orcamento]);
check('aprovar: já faturado é ignorado', aprovar.elegiveis.length === 2 && /Já está nesse estado/.test(aprovar.ignorados[0].motivo));
const excluir = B.avaliar('excluir', [faturado, pedido, comNota]);
// Faturado tem estoque baixado e financeiro gerado; sumir com o registro
// deixaria os dois sem origem.
check('excluir: faturado é ignorado', excluir.ignorados.some((i) => /cancele primeiro/.test(i.motivo)));
// Documento fiscal não se apaga — só se cancela.
check('excluir: com NF-e é ignorado', excluir.ignorados.some((i) => /documento fiscal não se apaga/.test(i.motivo)));
const cancelar = B.avaliar('cancelar', [faturado, pedido]);
check('cancelar: faturado manda cancelar a NF-e antes', cancelar.ignorados.some((i) => /NF-e primeiro/.test(i.motivo)));
// "12 processados" sozinho não diz se sobrou alguém.
check('o resumo diz processados E ignorados', B.resumo(12, 3) === '12 processados, 3 ignorados.');
check('e acerta o singular', B.resumo(1, 1) === '1 processado, 1 ignorado.');

console.log('\n--- a rota de lote ---');
check('existe', /pathname === '\/api\/sales\/records\/lote' && req\.method === 'POST'/.test(serverSrc));
// O path genérico /api/sales/records/:id casaria com "lote" achando que é id.
const posLote = serverSrc.indexOf("pathname === '/api/sales/records/lote'");
const posGenerico = serverSrc.indexOf("if (pathname.startsWith('/api/sales/records/') && req.method === 'GET')");
check('e vem antes da rota genérica', posLote > -1 && posLote < posGenerico);
// A tela avalia para não oferecer o que não dá; o servidor avalia porque a tela
// pode estar com dado velho — outra pessoa faturou enquanto este usuário olhava.
check('o servidor reavalia a elegibilidade', /salesBulk\.avaliar\(acaoId, selecionados\)/.test(serverSrc));
// Uma seleção de milhares viraria milhares de idas ao banco numa requisição só.
check('há teto de seleção', /ids\.length > 200/.test(serverSrc));
// Abortar tudo no primeiro erro deixaria a pessoa sem saber o que foi feito.
check('falha de um não derruba a leva', /falhas\.push\(\{ code: registro\.code/.test(serverSrc));
check('e devolve o motivo de cada ignorado', /ignorados: naoFeitos/.test(serverSrc));

console.log('\n--- um caminho só para os efeitos ---');
// Duas cópias divergiriam no lugar mais caro possível: aprovar em lote sem
// gerar as contas a receber fica "aprovado" na tela e nada no Financeiro.
check('a orquestração de efeitos virou função', /async function aplicarEfeitosDeStatus\(/.test(serverSrc));
check('o PUT a usa', /const efeitos = await aplicarEfeitosDeStatus\(\{/.test(serverSrc));
check('e o lote também', /await aplicarEfeitosDeStatus\(\{[\s\S]{0,400}items: current\.items \|\| \[\]/.test(serverSrc));
check('a exclusão virou função', /async function excluirSalesRecord\(/.test(serverSrc));
// O DELETE tinha a própria cópia: devolução de estoque e remoção de anexos
// estavam só lá.
check('e a rota DELETE passou a usá-la', /await excluirSalesRecord\(id, data, user\)/.test(serverSrc));
// Duplicar um pedido faturado e a cópia nascer faturada baixaria estoque e
// criaria contas a receber de uma venda que ninguém fez.
check('a cópia nasce como rascunho', /status = salesStatus\.padraoDoTipo\(tipo\)/.test(serverSrc));
check('sem NF-e e sem anexos', /nfeId: '',[\s\S]{0,200}attachments: \[\]/.test(serverSrc));
// O chassi identifica UMA unidade física.
check('e sem o chassi do original', /\.\.\.item, chassi: ''/.test(serverSrc));

console.log('\n--- a tela ---');
const appSrc = ler('public/app.js');
check('há checkbox por linha', /class="sales-selecionar" data-id=/.test(appSrc));
check('e o "selecionar todos"', /id="salesSelecionarTodos"/.test(appSrc));
// Marcar o que não se vê e depois excluir é como se perde dado sem perceber.
check('que marca só a PÁGINA', /const idsDaPagina = records\.map/.test(appSrc));
// Quem marcou na página 1 e passou para a 2 não pode perder as primeiras.
check('e não apaga a seleção das outras páginas', /\[\.\.\.new Set\(\[\.\.\.draft\.selecionados, \.\.\.idsDaPagina\]\)\]/.test(appSrc));
check('a barra aparece com seleção', /sales-lote-barra/.test(appSrc));
check('o menu é em grade e agrupado', /sales-lote-grade/.test(appSrc) && /Object\.entries\(grupos\)\.map/.test(appSrc));
// Habilitar com zero elegíveis levaria a "0 processados, 15 ignorados".
check('ação sem elegível fica desabilitada com o motivo', /const motivo = elegiveis\.length \? '' : /.test(appSrc));
// Entre desenhar a lista e clicar, outra pessoa pode ter faturado um deles.
check('o resumo mostrado vem do SERVIDOR', /showToast\(resposta\.resumo/.test(appSrc));
check('e o detalhe de cada ignorado é mostrado', /naoFeitos\.map\(\(i\) => /.test(appSrc));
check('o módulo é carregado no navegador', /sales_bulk_actions\.js/.test(ler('public/index.html')));
// A linha marcada precisa se distinguir sem depender só da caixinha.
const cssApp = ler('public/app.css');
check('linha selecionada se destaca', /tr\.is-selecionada > td/.test(cssApp));
// A caixa de seleção é CHECKBOX, não a chave que o resto do sistema usa. A
// diferença não é só visual: chave promete efeito imediato, e marcar linha não
// faz nada até escolher a ação. A regra global transforma TODO
// input[type=checkbox] em chave, então esta sobrescrita precisa continuar
// existindo — some ela e a coluna volta a ter 8 chaves ligadas na tela.
// A Entrada de NF-e (fase AK) marca item para uma ação posterior pelo mesmo
// motivo, então divide esta regra: o seletor virou lista. O teste procura o
// BLOCO que cobre a seleção da lista, não um seletor exato — senão qualquer
// tela nova que reaproveite a regra derrubaria este check sem nada ter
// quebrado na tela.
const regraSelecao = (cssApp.match(/[^{}]*\.sales-col-selecao input\[type="?checkbox"?\]\s*\{[^}]*\}/) || [''])[0];
check('a seleção usa checkbox, não chave', /border-radius:\s*4px/.test(regraSelecao), regraSelecao ? 'regra existe' : 'REGRA SUMIU');
// Sem `padding: 0`, a regra global de campos (padding: 10px 12px) empurra a
// caixa para 26x22 com box-sizing: border-box — o quadrado vira retângulo.
check('  com padding zerado, senão vira retângulo', /padding:\s*0/.test(regraSelecao));
// A regra global desloca o círculo da chave no :checked (translateX); sem
// redeclarar o transform aqui, o tique sairia do lugar.
check('  e o tique fica girado, não deslocado',
  /\.sales-col-selecao input\[type="?checkbox"?\]:checked::before[^{}]*\{[^}]*rotate\(45deg\)/.test(cssApp));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
