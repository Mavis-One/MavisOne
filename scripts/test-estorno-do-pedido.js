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
// DESDE 13/11/2026 também o Pedido Faturado sem NF-e/NFC-e valendo (pedido do
// usuário, sobre o 17175: "preciso que ele seja liberado pra alteração e
// faturamento novamente"). Com nota autorizada ou em processamento ele fica, e
// o aviso manda cancelar a nota (o cancelamento já o devolve).
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
const funcao = (server.match(/async function estornarPedidoSemTitulos\(pedidoId, user, avisos = null\) \{[\s\S]*?\n\}/) || [''])[0];

console.log('\n--- a regra ---');
check('o Pré-Faturado e o Faturado (13/11/2026)', /if \(!\['pedido-pre-faturado', 'pedido-faturado'\]\.includes\(situacao\)\) return '';/.test(funcao));
check('  e só sem nenhum título valendo (excluído some; cancelado não vale)',
  /select count\(\*\)::int as valendo from financial_entries where reference_id = \$1 and coalesce\(status, ''\) <> 'cancelado'/.test(funcao)
  && /if \(Number\(rows\[0\] && rows\[0\]\.valendo\) > 0\) return '';/.test(funcao));
check('o Faturado só sem nota valendo, faturado pelo MavisONE e fora dos importados do Viper',
  /const nota = await notaQueSustentaOFaturamento\(pedido\);/.test(funcao)
  && /if \(!pedido\.stockApplied \|\| \/\^Importado do ViperERP\/\.test\(String\(pedido\.note \|\| ''\)\)\) return '';/.test(funcao));
check('volta a "Pedido Não Faturado" pelas regras de status de sempre',
  /await mudarStatusSalesRecord\(\{ id: pedido\.id, code: pedido\.code \}, 'pedido-nao-faturado', dataVendas, user\);/.test(funcao));
check('  com o pedido e os lançamentos dele carregados',
  /syncSalesDataDosIds\(dataVendas, \[pedidoId\]\)/.test(funcao) && /syncFinanceDataDosPedidos\(dataVendas, \[pedidoId\]\)/.test(funcao));
check('  e fica na trilha', /action: 'pedidoEstornadoSemTitulos'/.test(funcao));
check('falha não derruba a exclusão do título', /catch \(erro\) \{\s*console\.error\('Título excluído ou cancelado, mas não consegui estornar o pedido'/.test(funcao));
const catalogo = require('../public/modules/shared/sales_status.js');
check('a volta é uma transição que o catálogo (e o banco) aceitam', catalogo.podeTransicionar('pedido-pre-faturado', 'pedido-nao-faturado')
  && catalogo.podeTransicionar('pedido-nao-faturado', 'pedido-pre-faturado')
  && catalogo.podeTransicionar('pedido-faturado', 'pedido-nao-faturado'));

console.log('\n--- a regra rodando (banco simulado) ---');
const vm = require('vm');
const rodar = async ({ pedido, valendo = 0, nota = null }) => {
  const feito = { mudou: false, avisos: [] };
  const ctx = {
    salesStatus: catalogo, console: { error() {} }, String, Number, Array, Promise,
    db: { getOrderById: async () => pedido },
    consultarBanco: async () => ({ rows: [{ valendo }] }),
    notaQueSustentaOFaturamento: async () => nota,
    loadData: () => ({}), syncSalesDataDosIds: async () => {}, syncCadastroData: async () => {}, syncFinanceDataDosPedidos: async () => {},
    mudarStatusSalesRecord: async () => { feito.mudou = true; }, registrarAuditoria: async () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(`${funcao}; this.f = estornarPedidoSemTitulos;`, ctx);
  feito.codigo = await ctx.f('p1', { id: 'u', name: 'U' }, feito.avisos);
  return feito;
};
const pedidoDe = (status, extra) => ({ id: 'p1', code: 17175, status, stockApplied: true, note: '', ...extra });
(async () => {
  let r = await rodar({ pedido: pedidoDe('pedido-pre-faturado', { stockApplied: false }) });
  check('Pré-Faturado sem título: volta', r.mudou && r.codigo === '17175');
  r = await rodar({ pedido: pedidoDe('pedido-faturado') });
  check('Faturado sem título e sem nota valendo (o 17175): volta', r.mudou && r.codigo === '17175' && !r.avisos.length);
  r = await rodar({ pedido: pedidoDe('pedido-faturado'), nota: { numero: 1249, status: 'AUTORIZADO', modelo: 55 } });
  check('Faturado com NF-e autorizada: fica, e o aviso manda cancelar a nota',
    !r.mudou && r.codigo === '' && /NF-e 1249 dele continua autorizada: para alterar e faturar de novo, cancele a nota/.test(r.avisos[0] || ''));
  r = await rodar({ pedido: pedidoDe('pedido-faturado'), nota: { numero: 88, status: 'PROCESSANDO', modelo: 65 } });
  check('  NFC-e em processamento também segura', !r.mudou && /NFC-e 88 dele continua em processamento/.test(r.avisos[0] || ''));
  r = await rodar({ pedido: pedidoDe('pedido-faturado', { stockApplied: false }) });
  check('faturado só no status (vendas até 10/10): fica', !r.mudou && r.codigo === '');
  r = await rodar({ pedido: pedidoDe('pedido-faturado', { note: 'Importado do ViperERP em 12/10/2026 — pedido nº 15000' }) });
  check('importado do Viper: fica', !r.mudou);
  r = await rodar({ pedido: pedidoDe('pedido-faturado'), valendo: 1 });
  check('com um título ainda valendo: fica', !r.mudou);
  r = await rodar({ pedido: pedidoDe('pedido-nao-faturado') });
  check('Não Faturado: nada a fazer', !r.mudou);

  console.log('\n--- onde ela roda ---');
  check('excluir títulos', /referenciasExcluidas\.add\(entry\.referenceId\)/.test(server)
    && /for \(const referencia of referenciasExcluidas\) \{\s*const codigoDoPedido = await estornarPedidoSemTitulos\(referencia, user, avisosDosPedidos\);/.test(server));
  check('cancelar em lote', /referenciasCanceladas\.add\(entry\.referenceId\)/.test(server)
    && /for \(const referencia of referenciasCanceladas\) \{\s*const codigoDoPedido = await estornarPedidoSemTitulos\(referencia, user, avisosDosPedidos\);/.test(server));
  check('cancelar um título', /const pedidoEstornado = await estornarPedidoSemTitulos\(entry\.referenceId, user, avisosDoPedido\);/.test(server));
  check('  e a resposta diz qual pedido voltou, ou por que ficou',
    (server.match(/resumo: \[listaDeLancamentos\.resumo\(processados\.length, ignorados\.length\), fraseDosPedidosEstornados\(pedidosEstornados\), \.\.\.avisosDosPedidos\]\.filter\(Boolean\)\.join\(' '\)/g) || []).length === 2
    && (server.match(/avisosDosPedidos,\n/g) || []).length === 2
    && /\.\.\.\(avisoDoPedido \? \{ aviso: avisoDoPedido \} : \{\}\)/.test(server));
  check('ao subir, os que já ficaram sem título (o 16570; e o Faturado sem nota, como o 17175)',
    /estornarPedidosQueFicaramSemTitulos\(\)\.catch/.test(server)
    && /a\.action = 'excluirLancamento'\s*and a\.details->'lancamento'->>'referenceId' = o\.id/.test(server)
    && /where \(o\.status = 'pedido-pre-faturado'\s*or \(o\.status = 'pedido-faturado' and o\.stock_applied and coalesce\(o\.note, ''\) not like 'Importado do ViperERP%'\)\)\s*and not exists \(select 1 from financial_entries f where f\.reference_id = o\.id and coalesce\(f\.status, ''\) <> 'cancelado'\)/.test(server));

  console.log('\n--- a tela ---');
  const tela = ler('public/modules/finance/subs/lancamentos.js');
  const app = ler('public/app.js');
  check('cancelar e excluir avisam o pedido que voltou, ou o caminho da nota',
    /if \(resposta && resposta\.aviso\) showToast\(resposta\.aviso, 'info', 8000\);/.test(tela)
    && /if \(\(resposta\.pedidosEstornados \|\| \[\]\)\.length\) showToast\(resposta\.resumo, 'info', 8000\);\s*else if \(\(resposta\.avisosDosPedidos \|\| \[\]\)\.length\) showToast\(resposta\.avisosDosPedidos\.join\(' '\), 'warning', 12000\);/.test(tela)
    && /\(resposta\.avisosDosPedidos \|\| \[\]\)\.length\) \{\s*showToast\(resposta\.avisosDosPedidos\.join\(' '\), 'warning', 12000\);/.test(app));
  check('  e a pergunta da exclusão já diz', tela.includes('Pedido Pré-Faturado que ficar sem nenhum título volta a "Pedido Não Faturado"; o Faturado também, se não tiver NF-e/NFC-e valendo'));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
