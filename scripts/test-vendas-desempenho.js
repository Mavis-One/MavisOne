#!/usr/bin/env node
/**
 * VENDAS MAIS LEVE, COM A MESMA RESPOSTA (fase DS).
 *
 * A fase DS trocou cargas inteiras por recortes nas rotas de Vendas (o pedido
 * pelo id, o financeiro do pedido, só os pedidos que reservam, só o vendedor do
 * Meu Painel, os números do painel sem a lista de todo mundo) e tirou trabalho
 * repetido da Nova Venda. Cada troca foi provada contra a versão anterior com
 * os dados reais; este teste guarda, SEM BANCO, o que faz cada uma ser a mesma
 * resposta — para a próxima mudança não desfazer a equivalência calada:
 *
 *   1. o resumo do painel (resumoDoPainelDeVendas) dá os MESMOS números que
 *      buildSalesDashboardSummary, rodando as duas funções DE VERDADE (recortadas
 *      do server.js, com o serializer de verdade) sobre o mesmo conjunto, em
 *      todos os escopos;
 *   2. o recorte da reserva só tira o que `reservaEstoque` já descartaria;
 *   3. o índice das notas responde o que o `.find` respondia, inclusive com id
 *      repetido e nota acrescentada no meio da requisição;
 *   4. o rótulo do produto na Nova Venda é o mesmo da conta antiga;
 *   5. as rotas não voltaram a carregar a tabela inteira para achar um registro.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = ler('server.js');
const app = ler('public/app.js');

// Recorta uma declaração de nível superior do server.js: da linha que a abre
// até a primeira linha "}" (ou "};") na coluna zero.
function recortar(nome) {
  const abre = new RegExp(`^(?:async )?function ${nome}\\(|^const ${nome} = `, 'm');
  const m = abre.exec(servidor);
  if (!m) throw new Error(`não achei ${nome} no server.js`);
  const resto = servidor.slice(m.index);
  const primeiraLinha = resto.slice(0, resto.indexOf('\n') + 1);
  if (/^const /.test(primeiraLinha) && /;\s*$/.test(primeiraLinha)) return primeiraLinha;
  const fim = resto.search(/\n\};?\n/);
  return resto.slice(0, fim + 3);
}

// ---------------------------------------------------------------------------
console.log('--- 1. o resumo do painel dá os mesmos números do painel completo ---');
const NOMES = [
  'CACHE_DIRETORIO', 'indiceDoCadastro', 'acharNoCadastro', 'getCadastroDirectory', 'getSellersDirectory',
  'resolveById', 'CACHE_NOTAS', 'indiceDasNotas', 'codigoDoRegistro',
  'texto200', 'salesPaymentInfo', 'salesPaymentLines', 'salesDelivery', 'serializeSalesRecord',
  'buildSalesDashboardSummary', 'valorDoRegistro', 'resumoDoPainelDeVendas', 'pedidosDoVendedorNoPainel'
];
const contexto = {
  escopoLib: require(path.join(RAIZ, 'lib/relatorios-escopo')),
  salesStatus: require(path.join(RAIZ, 'public/modules/shared/sales_status')),
  bandeiraCartao: require(path.join(RAIZ, 'public/modules/shared/bandeira_cartao')),
  console
};
let fontes = '';
const faltando = [];
for (const nome of NOMES) {
  try { fontes += recortar(nome) + '\n'; } catch (e) { faltando.push(nome); }
}
check('recortei as funções do server.js', faltando.length === 0, faltando.join(', ') || `${NOMES.length}`);
vm.createContext(contexto);
let carregou = true;
try {
  vm.runInContext(`${fontes}\nthis.__f = { buildSalesDashboardSummary, resumoDoPainelDeVendas, pedidosDoVendedorNoPainel, serializeSalesRecord, indiceDasNotas };`, contexto);
} catch (erro) {
  carregou = false;
  check('as funções recortadas rodam sozinhas', false, erro.message);
}

if (carregou) {
  const f = contexto.__f;
  const pessoa = (id, name, roles = ['Vendedor']) => ({ id, name, roles, status: 'ativo' });
  // Valores que o double não soma exato (0,1 + 0,2), status legado e em caixa
  // alta, vendedor com espaço em volta, sem vendedor, orçamento, cancelado.
  const pedidos = [
    { id: 'o1', type: 'order', code: 9, sellerId: 'v1', status: 'pedido', totalAmount: 0.1, date: '2026-08-01' },
    { id: 'o2', type: 'order', code: 8, sellerId: 'v1', status: 'pedido-faturado', totalAmount: 0.2, date: '2026-08-03' },
    { id: 'o3', type: 'order', code: 7, sellerId: ' v2 ', status: 'faturado', totalAmount: 1234.56, date: '2026-07-01' },
    { id: 'o4', type: 'order', code: 6, sellerId: 'v2', status: 'PEDIDO-CANCELADO', totalAmount: 99.99, date: '2026-07-02' },
    { id: 'o5', type: 'order', code: 5, sellerId: '', status: 'pedido-aprovado-sem-faturamento', totalAmount: 10, date: '2026-06-01' },
    { id: 'o6', type: 'order', code: 4, sellerId: 'v3', status: 'lixo', totalAmount: 33.33, date: '2026-06-02' },
    { id: 'o7', type: 'order', code: 3, sellerId: 'v1', status: 'pedido-nao-faturado', totalAmount: 0.3, date: '2026-08-01' }
  ];
  const orcamentos = [
    { id: 'q1', type: 'quote', code: 2, sellerId: 'v1', status: 'orcamento', totalAmount: 400.1, date: '2026-08-02' },
    { id: 'q2', type: 'quote', code: 1, sellerId: 'v2', status: 'orcamento-aprovado', totalAmount: 0.7, date: '2026-08-02' }
  ];
  const dados = () => ({
    orders: pedidos.map((p) => ({ ...p })),
    quotes: orcamentos.map((q) => ({ ...q })),
    people: [pessoa('v1', 'Ana'), pessoa('v2', 'Bruno'), pessoa('v3', 'Carla'), pessoa('c1', 'Cliente', ['Cliente'])],
    cnpjs: [], companies: [], deposits: [], nfe: [], nfes: []
  });
  const escopos = {
    todos: { tipo: 'todos', sellerIds: null },
    'só v1': { tipo: 'proprio', sellerIds: ['v1'] },
    'só v2 (com espaço no pedido)': { tipo: 'proprio', sellerIds: ['v2'] },
    nenhum: { tipo: 'nenhum', sellerIds: [] }
  };
  for (const [rotulo, escopo] of Object.entries(escopos)) {
    const completo = f.buildSalesDashboardSummary(dados(), escopo);
    const dadosResumo = dados();
    const resumo = f.resumoDoPainelDeVendas(dadosResumo, escopo);
    check(`escopo ${rotulo}: overview idêntico`,
      JSON.stringify(resumo.overview) === JSON.stringify(completo.overview), JSON.stringify(resumo.overview));
    const totais = resumo.totaisPorVendedor();
    const semLista = completo.bySeller.map(({ orders, ...resto }) => resto);
    check(`escopo ${rotulo}: totais por vendedor idênticos`,
      JSON.stringify(totais) === JSON.stringify(semLista), `${totais.length} vendedor(es)`);
    // A lista do vendedor, carregada só para ele, sai igual à que ia em bySeller.
    for (const vendedor of completo.bySeller) {
      const soDele = dadosResumo.orders.filter((o) => (o.sellerId || '') === vendedor.sellerId);
      const lista = f.pedidosDoVendedorNoPainel(soDele, dadosResumo);
      check(`  ${rotulo}: pedidos de ${vendedor.sellerName} idênticos`,
        JSON.stringify(lista) === JSON.stringify(vendedor.orders), `${lista.length}`);
    }
  }
  let recusou = false;
  try { f.resumoDoPainelDeVendas(dados(), null); } catch (e) { recusou = true; }
  check('sem escopo, o resumo recusa (como o painel completo)', recusou);

  // -------------------------------------------------------------------------
  console.log('\n--- 3. o índice das notas responde o que o .find respondia ---');
  const d = dados();
  d.nfe = [{ id: 'n1', numero: 1042 }, { id: 'n1', numero: 9999 }, { id: 'n2', numero: 0 }];
  d.nfes = [{ id: 'm1', number: '77' }, { id: 'n2', number: '55' }];
  const numero = (nfeId) => f.serializeSalesRecord({ id: 'x', type: 'order', status: 'pedido', nfeId }, d).nfeNumero;
  check('fiscal pelo id', numero('n1') === '1042', numero('n1'));
  check('  id repetido: a PRIMEIRA, como o .find', numero('n1') === '1042');
  check('fiscal antes da manual (n2 é fiscal com número 0 -> vazio, como antes)', numero('n2') === '', JSON.stringify(numero('n2')));
  check('manual quando não há fiscal', numero('m1') === '77', numero('m1'));
  check('sem nota, vazio', numero('') === '' && numero('nada') === '');
  d.nfes.push({ id: 'm2', number: '88' });
  check('nota acrescentada na mesma lista (push) é achada', numero('m2') === '88', numero('m2'));
  d.nfe = [{ id: 'm2', numero: 5 }];
  check('lista trocada por um sync novo: índice remontado', numero('m2') === '5', numero('m2'));
}

// ---------------------------------------------------------------------------
console.log('\n--- 2. o recorte da reserva só tira quem já não reservava ---');
const salesStatus = require(path.join(RAIZ, 'public/modules/shared/sales_status'));
const reservasLib = require(path.join(RAIZ, 'lib/reservas'));
const fonteVendas = ler('lib/db/vendas-compras.js');
const lista = (() => {
  // A mesma expressão do arquivo, avaliada aqui — sem precisar do banco.
  const m = /const STATUS_QUE_NAO_RESERVAM = (\[[\s\S]*?\]\.filter\([^;]*\));/.exec(fonteVendas);
  // eslint-disable-next-line no-new-func
  return m ? new Function('salesStatus', `return ${m[1]};`)(salesStatus) : null;
})();
check('a lista sai do catálogo (CATALOGO + LEGADOS filtrados por reservaEstoque)', Array.isArray(lista) && lista.length > 0,
  lista ? lista.join(', ') : 'não achei');
check('nenhum status da lista reserva', (lista || []).every((s) => !salesStatus.reservaEstoque(s)));
check('quem reserva NÃO está na lista (pedido, pedido-nao-faturado)',
  !(lista || []).includes('pedido') && !(lista || []).includes('pedido-nao-faturado'));
check('a consulta compara o valor CRU com a lista',
  /select\(COLUNAS_DE_RESERVA\)\s*\n\s*\.not\('status', 'in', STATUS_QUE_NAO_RESERVAM\)/.test(fonteVendas));
// Grafias que o JS normaliza continuam vindo do banco, e calcularReservas decide.
const pedidosReserva = [
  { id: 'a', code: 1, status: 'pedido', items: [{ productId: 'p1', quantity: 2 }] },
  { id: 'b', code: 2, status: 'pedido-faturado', items: [{ productId: 'p1', quantity: 5 }] },
  { id: 'c', code: 3, status: ' PEDIDO ', items: [{ productId: 'p1', classValueId: 'cor', quantity: 1.5 }] },
  { id: 'd', code: 4, status: 'PEDIDO-FATURADO', items: [{ productId: 'p2', quantity: 7 }] },
  { id: 'e', code: 5, status: 'cancelado', items: [{ productId: 'p2', quantity: 3 }] },
  { id: 'f', code: 6, status: 'lixo-que-vira-pedido', items: [{ productId: 'p2', quantity: 4 }] }
];
const tudo = reservasLib.calcularReservas(pedidosReserva);
const recorte = reservasLib.calcularReservas(pedidosReserva.filter((p) => !(lista || []).includes(p.status)));
const comoTexto = (r) => JSON.stringify([[...r.porChave], [...r.porProduto], [...r.pedidos]]);
check('reservas idênticas com e sem o recorte', comoTexto(tudo) === comoTexto(recorte), comoTexto(recorte).slice(0, 120));

// ---------------------------------------------------------------------------
console.log('\n--- 4. o rótulo do produto na Nova Venda ---');
const ini = app.indexOf('const produtoDoItem');
const fim = app.indexOf('// O servidor recusa faturar sem saldo', ini);
const iniFmt = app.indexOf('const salesFormatDate');
const fimFmt = app.indexOf("if (sub === 'orders_quotes')", iniFmt);
check('achei o bloco do rótulo e os formatadores', ini > 0 && fim > ini && iniFmt > 0 && fimFmt > iniFmt);
// eslint-disable-next-line no-new-func
const fabrica = new Function('meta', 'formState',
  `${app.slice(iniFmt, fimFmt)}\n${app.slice(ini, fim)}\nreturn { rotuloProduto, opcoesDeProduto, opcoesDeCliente, salesFormatBRL };`);
const meta = {
  products: [
    { id: 'p1', name: 'Parafuso', sku: '10087', salePrice: 1234.5, stockQuantity: 10 },
    { id: 'p10', name: 'Porca', sku: '', salePrice: 0.1, stockQuantity: 2.5 },
    { id: 'p2', name: 'Arruela', sku: 'A', salePrice: 0, stockQuantity: 0 }
  ],
  // `p1|` e `p10|...` não podem se misturar; quantidade fracionária na cor.
  reservas: { 'p1|': 1, 'p1|azul': 0.1, 'p10|': 0.2, 'p1|preto': 0.2, 'p10|verde': 1 },
  saldosPorDeposito: { 'p1|dep1|': 4, 'p10|dep1|': 2.5 },
  deposits: [{ id: 'dep1', name: 'Barra' }],
  directory: [{ id: 'c1', name: 'Cliente A' }]
};
// A conta ANTIGA, escrita aqui como referência (era a do app.js até a fase DS).
const formatoAntigo = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (value) => { const n = Number(value || 0); return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ''); };
const rotuloAntigo = (p, deposito) => {
  const reservado = Number((meta.reservas || {})[`${p.id}|`] || 0)
    + Object.entries(meta.reservas || {})
      .filter(([chave]) => chave.startsWith(`${p.id}|`) && chave !== `${p.id}|`)
      .reduce((soma, [, q]) => soma + Number(q || 0), 0);
  const livre = Number(p.stockQuantity || 0) - reservado;
  const cabecalho = `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${formatoAntigo(p.salePrice)} · `;
  if (deposito) {
    const noDeposito = Number(meta.saldosPorDeposito[`${p.id}|${deposito}|`] || 0);
    const nome = (meta.deposits.find((d) => d.id === deposito) || {}).name || '';
    return cabecalho + `${qtd(noDeposito)} em ${nome}`
      + (Number(p.stockQuantity || 0) !== Number(noDeposito) ? ` (${qtd(p.stockQuantity)} no total)` : '');
  }
  return cabecalho + (reservado > 0 ? `disponível ${qtd(livre)} de ${qtd(p.stockQuantity)}` : `saldo ${qtd(p.stockQuantity)}`);
};
for (const deposito of ['', 'dep1']) {
  const formState = { depositId: deposito };
  const nova = fabrica(meta, formState);
  const iguais = meta.products.every((p) => nova.rotuloProduto(p) === rotuloAntigo(p, deposito));
  check(`depósito ${JSON.stringify(deposito)}: rótulos iguais à conta antiga`, iguais,
    meta.products.map((p) => nova.rotuloProduto(p)).join(' | '));
  const primeira = nova.opcoesDeProduto();
  check('  a lista é guardada: o segundo pedido devolve o MESMO array', nova.opcoesDeProduto() === primeira);
  formState.depositId = deposito ? '' : 'dep1';
  check('  trocar o depósito remonta a lista', nova.opcoesDeProduto() !== primeira);
  check('  o cliente também é guardado', nova.opcoesDeCliente() === nova.opcoesDeCliente());
}
const valores = [0, 0.1, 1234.5, -7.25, 1e6, '12.3', null];
check('o formatador reaproveitado escreve o mesmo texto do toLocaleString',
  valores.every((v) => fabrica(meta, {}).salesFormatBRL(v) === formatoAntigo(v)));
check('rotuloProduto não varre as reservas por produto', !/Object\.entries\(meta\.reservas/.test(app.slice(app.indexOf('const rotuloProduto = (p)'), fim)));

// ---------------------------------------------------------------------------
console.log('\n--- 5. as rotas não carregam a tabela inteira para achar um registro ---');
const corpoDe = (inicio) => {
  const de = servidor.indexOf(inicio);
  const resto = servidor.slice(de + inicio.length);
  return servidor.slice(de, de + inicio.length + resto.indexOf('\n  if (pathname'));
};
const getUm = corpoDe("if (pathname.startsWith('/api/sales/records/') && req.method === 'GET')");
check('GET de um pedido: pelo id', /syncSalesDataDosIds\(data, \[idPedido\]\)/.test(getUm) && !/syncSalesData\(data\)/.test(getUm));
const put = corpoDe("if (pathname.startsWith('/api/sales/records/') && req.method === 'PUT')");
check('PUT: o pedido e o financeiro DELE',
  /syncSalesDataDosIds\(data, \[idDaRota\]\)/.test(put) && /syncFinanceDataDosPedidos\(data, \[idDaRota\]\)/.test(put)
  && !/syncSalesData\(data\)|syncFinanceData\(data\)/.test(put));
check('  e as notas continuam inteiras (a rota grava e `nfe` vai para o db.json)', /syncNfeData\(data\)/.test(put));
const post = corpoDe("if (pathname === '/api/sales/records' && req.method === 'POST')");
check('POST: financeiro sem lançamento nenhum', /syncFinanceDataDosPedidos\(data, \[\]\)/.test(post) && !/syncFinanceData\(data\)/.test(post));
const lote = corpoDe("if (pathname === '/api/sales/records/lote' && req.method === 'POST')");
check('lote: os ids ANTES da onda, e só eles',
  lote.indexOf('const ids =') > -1 && lote.indexOf('const ids =') < lote.indexOf('syncSalesDataDosIds(data, ids)')
  && /syncFinanceDataDosPedidos\(data, ids\)/.test(lote) && !/syncSalesData\(data\)|syncFinanceData\(data\)/.test(lote));
const anexos = servidor.slice(servidor.indexOf('const rotaAnexo ='), servidor.indexOf("if (pathname === '/api/sales/categories' && req.method === 'GET')"));
check('anexos: só o registro', /syncSalesDataDosIds\(data, \[registroId\]\)/.test(anexos) && !/syncSalesData\(data\)/.test(anexos));
const painel = corpoDe("if (pathname === '/api/sales/meu-painel' && req.method === 'GET')");
check('Meu Painel: o escopo vem ANTES da carga, e a carga é do vendedor',
  painel.indexOf('escopoLib.escopoPessoal(user)') < painel.indexOf('db.getVendasDoVendedor(vinculo)')
  && !/syncSalesData\(data\)/.test(painel));
const meta2 = servidor.slice(servidor.indexOf("pathname === '/api/sales/meta'"), servidor.indexOf('// Tributos de um pedido'));
check('meta: sem notas, produtos enxutos', !/syncNfeData(?:ParaVendas)?\(/.test(meta2) && /db\.getProdutosParaVenda\(\)/.test(meta2));
const registros = corpoDe("if (pathname === '/api/sales/records' && req.method === 'GET')");
check('histórico de importações responde antes da onda',
  registros.indexOf("if (view === 'import_logs')") > -1
  && registros.indexOf("if (view === 'import_logs')") < registros.indexOf('await Promise.all('));
check('a busca com filtro carrega as colunas da busca, e relê só a página',
  /syncSalesDataParaBusca\(data\)/.test(registros) && /db\.getVendasPorIds\(/.test(registros));
const estoque = servidor.slice(servidor.indexOf('async function transitionOrderStockEffect'), servidor.indexOf('async function numeroDaNotaDoPedido'));
check('faturar/cancelar: produtos numa ida, não um por item',
  !/getProductById\(/.test(estoque) && (estoque.match(/db\.getProdutosPorIds\(/g) || []).length === 2);
check('  e o produto apagado continua no Map (null), como antes',
  /produtos\.set\(id, achados\.get\(id\) \|\| null\)/.test(estoque));

// ---------------------------------------------------------------------------
// 6. A página relida não muda sem gravação, e não mente com gravação no meio.
// relerPaginaDeVendas roda DE VERDADE (recortada do server.js) com um banco
// falso que conta as consultas.
(async () => {
  console.log('\n--- 6. a releitura da página da lista com filtro ---');
  const relerPaginaDeVendas = new Function(`${recortar('relerPaginaDeVendas')}\nreturn relerPaginaDeVendas;`)();
  const banco = (orders, quotes) => {
    const b = { consultas: 0 };
    b.buscar = async (ids) => {
      b.consultas += 1;
      return {
        orders: orders.filter((r) => ids.orders.includes(r.id)),
        quotes: quotes.filter((r) => ids.quotes.includes(r.id))
      };
    };
    return b;
  };
  // A página como sai do primeiro passo: objetos do recorte, numa ordem que não
  // é a do banco, e de qual tabela cada um veio.
  const pagina = [{ id: 'q1' }, { id: 'o2' }, { id: 'o1' }];
  const tabelaDe = new Map([[pagina[0], 'quotes'], [pagina[1], 'orders'], [pagina[2], 'orders']]);

  const quieto = banco([{ id: 'o1', v: 'o1' }, { id: 'o2', v: 'o2' }], [{ id: 'q1', v: 'q1' }]);
  const r1 = await relerPaginaDeVendas(pagina, tabelaDe, quieto.buscar);
  check('sem gravação: os completos, na ordem da página', r1.map((r) => r.v).join(',') === 'q1,o2,o1', r1.map((r) => r.v).join(','));
  check('  numa consulta só', quieto.consultas === 1, `${quieto.consultas}`);

  // q1 virou pedido (mesmo id, outra tabela) e o2 foi apagado entre os passos.
  const gravou = banco([{ id: 'o1', v: 'o1' }, { id: 'q1', v: 'q1-agora-pedido' }], []);
  const r2 = await relerPaginaDeVendas(pagina, tabelaDe, gravou.buscar);
  check('orçamento convertido em pedido é achado na outra tabela', r2[0] && r2[0].v === 'q1-agora-pedido', r2.map((r) => r.v).join(','));
  check('  o apagado não volta, e a ordem se mantém', r2.map((r) => r.v).join(',') === 'q1-agora-pedido,o1');
  check('  e a segunda consulta só aconteceu porque faltou alguém', gravou.consultas === 2, `${gravou.consultas}`);

  const lista = corpoDe("if (pathname === '/api/sales/records' && req.method === 'GET')");
  check('a página relida passa de novo pelo filtro da busca',
    /records: filterSalesRecords\(\s*registrosDaPagina\.map\(\(record\) => serializeSalesRecord\(record, data\)\),\s*url\.searchParams\s*\)/.test(lista));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
