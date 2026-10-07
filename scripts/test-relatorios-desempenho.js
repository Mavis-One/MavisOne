#!/usr/bin/env node
/**
 * RELATÓRIOS MAIS LEVES, COM O MESMO RESULTADO (06/10/2026) — sem banco e sem
 * servidor.
 *
 * Cada correção desta rodada troca COMO um número é calculado ou lido, nunca
 * O QUÊ. A prova de que o resultado não mudou foi feita contra o servidor de
 * antes, com os dados reais (diag/impl-relatorios/comparar.js); aqui ficam as
 * invariantes que fariam aquela prova falhar se alguém desfizesse uma peça sem
 * perceber — e que, sem este arquivo, só apareceriam como "o relatório ficou
 * lento de novo" ou, pior, como um número diferente que ninguém compara.
 *
 *  1. A tabela do catálogo formata com formatadores GUARDADOS — e o texto de
 *     cada célula é o mesmo do `toLocaleString` de antes.
 *  2. O Relatório de Vendas ordena com um Intl.Collator guardado e compara
 *     data pelo código — e a ordem é a mesma do `localeCompare` de antes.
 *  3. As consultas do catálogo usam faixa de datas no lugar de
 *     `extract(year ...)`, o DRE Anual pede a ordem por escrito, e o Limite de
 *     Crédito soma o em aberto uma vez só.
 *  4. As cargas enxutas (lib/relatorios-cargas.js) devolvem os campos com os
 *     MESMOS nomes e a MESMA conversão do mapeador completo de cada tabela.
 *  5. A Síntese Financeira e o Valor em Estoque não leem o sistema inteiro, e
 *     as contas a pagar/receber seguem a regra do painel do Financeiro.
 *  6. Os CSV dos relatórios saem comprimidos, com as guardas do sendJson.
 *  7. A tela não refaz a consulta para trocar de visão, e só recebe as listas
 *     dos filtros quando elas mudam.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK  ' : 'XX  '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Recorta uma função de um arquivo-fonte (do `function nome(` até a chave que
// fecha na coluna 0) — para testar a função de verdade, e não uma cópia.
const recortar = (fonte, nome) => {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) return '';
  const fim = fonte.indexOf('\n}\n', inicio);
  return fonte.slice(inicio, fim + 3);
};

(async () => {
  // -------------------------------------------------------------------------
  console.log('--- 1. os formatadores da tabela do catálogo ---');
  const telaCatalogo = ler('public/modules/reports/subs/catalogo.js');
  const janela = {};
  vm.runInNewContext(telaCatalogo, { window: janela, Intl, Number, String, Math, URLSearchParams, Object });
  const formatar = janela.MavisRelatoriosCatalogo && janela.MavisRelatoriosCatalogo.formatar;
  check('a tela do catálogo carrega fora do navegador', typeof formatar === 'function');
  // A REFERÊNCIA é o código de antes, escrito aqui: é contra ele que a saída
  // tem de ser idêntica.
  const antes = (tipo, valor) => {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    switch (tipo) {
      case 'moeda': return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      case 'percentual': return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
      case 'inteiro': return Math.round(n).toLocaleString('pt-BR');
      case 'quantidade':
      case 'numero': return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
      default: return null;
    }
  };
  const valores = [0, -0, 1, -1, 0.005, 0.015, 1.005, 2.675, 1234.5, -1234.567, 999999.995, 1e9 + 0.01, 0.1 + 0.2,
    '12.30', '7', 'abc', true, null, undefined, '', 3.14159, -0.004, 12345678.9];
  let diferentes = 0;
  for (const tipo of ['moeda', 'percentual', 'inteiro', 'quantidade', 'numero']) {
    for (const v of valores) {
      if (formatar({ tipo }, v) !== antes(tipo, v)) diferentes += 1;
    }
    for (let i = 0; i < 2000; i += 1) {
      const v = Math.round((Math.random() - 0.5) * 1e8) / 1000;
      if (formatar({ tipo }, v) !== antes(tipo, v)) diferentes += 1;
    }
  }
  check('  o texto de cada célula é o mesmo do toLocaleString de antes', diferentes === 0, `${diferentes} diferente(s) em ${5 * (valores.length + 2000)}`);
  check('  e os formatadores são criados uma vez, fora da função',
    !/toLocaleString\(/.test(recortar(telaCatalogo.replace(/^ {2}/gm, ''), 'formatar'))
    && (semComentarios(telaCatalogo).match(/new Intl\.NumberFormat\(/g) || []).length === 4);

  // -------------------------------------------------------------------------
  console.log('\n--- 2. a ordenação do Relatório de Vendas ---');
  const rv = require(path.join(RAIZ, 'lib/relatorios-vendas'));
  const texto = (v) => String(v === null || v === undefined ? '' : v).trim();
  const REFERENCIA = {
    data: (a, b) => texto(a.data).localeCompare(texto(b.data)),
    vendedor: (a, b) => texto(a.vendedorNome).localeCompare(texto(b.vendedorNome), 'pt-BR'),
    cliente: (a, b) => texto(a.clienteNome).localeCompare(texto(b.clienteNome), 'pt-BR'),
    produto: (a, b) => texto(a.produtoNome).localeCompare(texto(b.produtoNome), 'pt-BR'),
    status: (a, b) => texto(a.statusRotulo).localeCompare(texto(b.statusRotulo), 'pt-BR')
  };
  const nomes = ['Ávila', 'avila', 'Avila', 'Éder', 'eder', 'Zé', 'ze', 'ZÉ', '', ' ', 'Çarlos', 'Carlos', 'carlos',
    'BIKE ARO 29', 'Bike aro 29', 'bike-aro', 'bike aro', '10 peças', '9 peças', 'Ñandu', 'nandu', 'Óleo', 'óleo 2T',
    'Sem vendedor', 'Sem cliente', "D'Ávila", 'd avila', 'Ação', 'Acao', 'ação'];
  const datas = ['', '2026-01-01', '2025-12-31', '2026-01-10', '2026-10-01', '2026-09-30', '2020-02-29', null, undefined];
  const linhas = [];
  for (const nome of nomes) for (const data of datas) linhas.push({ data, vendedorNome: nome, clienteNome: nome, produtoNome: nome, statusRotulo: nome });
  let discordam = 0;
  for (const coluna of Object.keys(REFERENCIA)) {
    for (const a of linhas) {
      for (const b of linhas) {
        if (Math.sign(rv.ORDENACOES[coluna](a, b)) !== Math.sign(REFERENCIA[coluna](a, b))) discordam += 1;
      }
    }
  }
  check('  cada comparação dá o mesmo sinal do localeCompare de antes', discordam === 0,
    `${discordam} discordância(s) em ${5 * linhas.length * linhas.length} pares`);
  const fonteRv = semComentarios(ler('lib/relatorios-vendas.js'));
  check('  e nenhum localeCompare voltou ao arquivo', !/localeCompare\(/.test(fonteRv));
  check('  o comparador é criado uma vez', (fonteRv.match(/new Intl\.Collator\(/g) || []).length === 1);
  // A série mensal e as opções dos filtros também ordenavam por localeCompare.
  const serie = rv.serieMensal([{ data: '2026-10-05', valorTotal: 1 }, { data: '2025-12-01', valorTotal: 2 }, { data: '2026-01-31', valorTotal: 3 }]);
  check('  a série mensal continua em ordem de mês', serie.map((p) => p.label).join(',') === '12/2025,01/2026,10/2026', serie.map((p) => p.label).join(','));

  // -------------------------------------------------------------------------
  console.log('\n--- 3. as consultas do catálogo ---');
  const finSrc = semComentarios(ler('lib/relatorios/financeiro.js'));
  const venSrc = semComentarios(ler('lib/relatorios/vendas.js'));
  // `extract(year ...)` na SELEÇÃO continua (o DRE Anual devolve o ano); o que
  // não pode voltar é no FILTRO, onde ele cega o planejador.
  check('nenhum filtro por `extract(year ...)`', !/where[^;`]*?extract\(year from/.test(finSrc + venSrc)
    && !/(?:and|or) extract\(year from/.test(finSrc + venSrc));
  check('  o Fluxo Mensal filtra por faixa de datas (previsto e realizado)',
    (finSrc.match(/>= make_date\(\$1::int, 1, 1\) and [\w.]+ < make_date\(\$1::int \+ 1, 1, 1\)/g) || []).length === 2);
  check('  o Condensado por Mês também', /o\.date >= make_date\(\$1::int, 1, 1\) and o\.date < make_date\(\$1::int \+ 1, 1, 1\)/.test(venSrc));
  const dre = finSrc.slice(finSrc.indexOf("key: 'dre-anual'"));
  check('  o DRE Anual pega os dois anos por faixa', /p\.date >= make_date\(\$1::int - 1, 1, 1\) and p\.date < make_date\(\$1::int \+ 1, 1, 1\)/.test(dre));
  // A ordem das linhas é a ordem das categorias no Map, e ela desempata o
  // `sort` estável do fim: sem o `order by`, o hash join a deixaria solta.
  check('  e pede a ordem por escrito', /group by 1, 2, 3, 4\s*\n\s*order by 1, 2, 3, 4/.test(dre));
  const limite = finSrc.slice(finSrc.indexOf("key: 'limite-de-credito'"), finSrc.indexOf("key: 'valores-credenciadoras'"));
  check('o Limite de Crédito soma o em aberto uma vez por cliente',
    /with aberto as \(/.test(limite) && /group by 1\)/.test(limite) && !/where e\.client_supplier_id = p\.id/.test(limite));
  check('  e desempata nomes iguais pelo id', /order by p\.name, p\.id/.test(limite));
  // O escopo de vendedor do catálogo: a regra conta exatamente duas
  // ocorrências (ver test-relatorios-catalogo.js); a faixa de datas não pode
  // ter mexido nos parâmetros do filtro de vendas.
  check('  o Condensado por Mês continua passando o escopo como $3', /filtroDeVendas\(ctx, 2, \{ comPeriodo: false \}\)/.test(venSrc));

  // -------------------------------------------------------------------------
  console.log('\n--- 4. as cargas enxutas devolvem o que o mapeador completo devolveria ---');
  const conexao = require(path.join(RAIZ, 'lib/db/conexao'));
  const consultas = [];
  let linhasFalsas = {};
  // Troca a consulta ANTES de carregar as cargas (elas guardam a função no
  // require): nenhuma ida ao banco neste teste.
  conexao.consultar = async (sql) => {
    consultas.push(sql);
    const tabela = /from (\w+)/.exec(sql)[1];
    return { rows: linhasFalsas[tabela] || [] };
  };
  delete require.cache[require.resolve(path.join(RAIZ, 'lib/relatorios-cargas'))];
  const cargas = require(path.join(RAIZ, 'lib/relatorios-cargas'));
  const mapLancamento = new Function(`${recortar(ler('lib/db/financeiro.js'), 'mapFinancialEntryRow')}; return mapFinancialEntryRow;`)();
  const mapProduto = new Function(`${recortar(ler('lib/db/estoque.js'), 'mapProductRow')}; return mapProductRow;`)();

  const LANCAMENTOS = [
    { type: 'RECEITA', status: 'paid', amount: 150.1, date: '2026-09-01', due_date: '2026-09-10' },
    { type: 'DESPESA', status: 'pending', amount: null, date: '2026-09-02', due_date: '2026-08-01' },
    { type: 'transfer', status: 'CANCELADO', amount: '12.5', date: '2026-09-03', due_date: null }
  ];
  linhasFalsas = { financial_entries: LANCAMENTOS };
  const enxutos = await cargas.lancamentosDaSintese();
  const campos = ['type', 'status', 'amount', 'date', 'dueDate'];
  check('lançamentos: os cinco campos que a Síntese lê, com a conversão de mapFinancialEntryRow',
    enxutos.every((e, i) => campos.every((c) => Object.is(e[c], mapLancamento(LANCAMENTOS[i])[c])))
    && enxutos.every((e) => Object.keys(e).sort().join() === campos.slice().sort().join()));
  check('  ordem estável: data decrescente e id', /order by date desc, id$/.test(consultas[0]), consultas[0]);

  const PRODUTOS = [
    { id: 'p1', name: 'Bike', sku: null, stock_quantity: '3', cost_price: 10.5, tipo_produto_fiscal: 'NORMAL' },
    { id: 'p2', name: 'Complemento ICMS', sku: 'X', stock_quantity: 0, cost_price: 0, tipo_produto_fiscal: 'ESCRITURAL' },
    { id: 'p3', name: 'Sem tipo', sku: 'S', stock_quantity: null, cost_price: null, tipo_produto_fiscal: null }
  ];
  linhasFalsas = { products: PRODUTOS };
  const produtos = await cargas.produtosDoValorEmEstoque();
  // O MESMO filtro de getProducts(): `!p.escritural`, e NULL não é escritural.
  const esperados = PRODUTOS.map(mapProduto).filter((p) => !p.escritural);
  check('produtos: o escritural fica de fora, o de tipo nulo fica', produtos.map((p) => p.id).join() === esperados.map((p) => p.id).join(),
    produtos.map((p) => p.id).join());
  check('  com id, name, sku, stockQuantity e costPrice convertidos como mapProductRow',
    produtos.every((p, i) => ['id', 'name', 'sku', 'stockQuantity', 'costPrice'].every((c) => Object.is(p[c], esperados[i][c]))));
  check('  ordem por nome, a mesma cláusula de getProducts()', /order by name asc$/.test(consultas[1]), consultas[1]);

  linhasFalsas = {
    orders: [{ id: 'o1', code: 7, type: 'order', items: [{ name: 'A', quantity: 1, unitPrice: 2 }], client_supplier_name: '', customer: 'Fulano', total_amount: null, amount: '9.9', discount_amount: '1', status: 'pedido-faturado', seller_id: 's1', date: '2026-09-01' }],
    quotes: []
  };
  const vendas = await cargas.vendasDoRelatorio();
  const { mapOrderQuoteRow } = require(path.join(RAIZ, 'lib/db/vendas-compras'));
  const completo = mapOrderQuoteRow(linhasFalsas.orders[0]);
  const lidosPeloRelatorio = ['id', 'code', 'type', 'date', 'status', 'sellerId', 'clientSupplierId', 'clientSupplierName',
    'items', 'discountAmount', 'discountPercent', 'totalAmount'];
  check('vendas: passam pelo mapOrderQuoteRow, com os campos que o relatório lê',
    lidosPeloRelatorio.every((c) => JSON.stringify(vendas.orders[0][c]) === JSON.stringify(completo[c])));
  const colunas = cargas.COLUNAS_DO_RELATORIO_DE_VENDAS.split(', ');
  // A coluna de cada campo que serializeSalesRecord + lib/relatorios-vendas.js
  // leem. Campo novo lido pelo relatório sem coluna aqui sairia vazio em
  // silêncio — é para isso que esta lista existe.
  for (const c of ['id', 'code', 'type', 'date', 'status', 'seller_id', 'client_supplier_id', 'client_supplier_name', 'customer',
    'discount_amount', 'discount_percent', 'items']) {
    check(`  a coluna ${c} vem`, colunas.includes(c));
  }
  check('  pedidos e orçamentos em código decrescente, empates pela posição física (a ordem do índice de hoje)',
    consultas.slice(2).every((s) => /order by code desc, ctid$/.test(s)) && consultas.length === 4);
  // O que o relatório lê do registro serializado tem de estar coberto acima.
  const lidos = new Set([...ler('lib/relatorios-vendas.js').matchAll(/registro\.(\w+)/g)].map((m) => m[1]));
  const cobertos = new Set(['id', 'code', 'type', 'date', 'status', 'sellerId', 'sellerName', 'clientSupplierId', 'customer',
    'clientSupplierName', 'discountAmount', 'discountPercent', 'items']);
  const descobertos = [...lidos].filter((c) => !cobertos.has(c));
  check('  e lib/relatorios-vendas.js não lê do registro nada além disso', descobertos.length === 0, descobertos.join(', ') || [...lidos].join(', '));

  // -------------------------------------------------------------------------
  console.log('\n--- 5. Síntese Financeira e Valor em Estoque ---');
  const servidor = ler('server.js');
  const servidorSemComent = semComentarios(servidor);
  // As contas: a MESMA regra das linhas do painel do Financeiro. O teste roda
  // a função de verdade (recortada do server.js) sobre casos de borda.
  const contasSrc = (() => {
    const i = servidor.indexOf('  function contasDoFinanceiro(');
    const f = servidor.indexOf('\n  }\n', i);
    return servidor.slice(i, f + 5);
  })();
  const ajudantes = ['classifyFinanceEntry', 'isFinanceEntryRealized', 'isFinanceEntryCancelled', 'financeEntryDueDate', 'sumFinanceAmount']
    .map((nome) => recortar(servidor, nome)).join('\n');
  const contasDoFinanceiro = new Function(`${ajudantes}\n${contasSrc}\nreturn contasDoFinanceiro;`)();
  const HOJE = '2026-10-06';
  const casos = [
    { type: 'RECEITA', status: 'pending', amount: 100, date: '2026-09-01', dueDate: '2026-10-05' }, // receber vencida
    { type: 'receita', status: 'PENDING', amount: 50, date: '2026-09-01', dueDate: '2026-10-06' }, // vence hoje: a vencer
    { type: 'sale', status: 'parcial', amount: 25, date: '2026-10-07', dueDate: '' }, // sem vencimento: vale a data
    { type: 'RECEITA', status: 'paid', amount: 10, date: '2026-01-01', dueDate: '2026-01-01' },
    { type: 'RECEITA', status: 'cancelled', amount: 999, date: '2026-01-01', dueDate: '2026-01-01' },
    { type: 'DESPESA', status: 'pendente', amount: 7, date: '2026-01-01', dueDate: '2026-01-01' }, // 'pendente' não é pending
    { type: 'purchase', status: 'pending', amount: 40, date: '2026-01-01', dueDate: '2026-11-01' },
    { type: 'DESPESA', status: 'Paid', amount: 3, date: '2026-01-01', dueDate: '2026-01-01' },
    { type: 'TRANSFERENCIA', status: 'pending', amount: 500, date: '2026-01-01', dueDate: '2026-01-01' }
  ];
  const contas = contasDoFinanceiro(casos, HOJE);
  check('a receber: total, vencidas, a vencer e recebidas',
    JSON.stringify(contas.contasAReceber) === JSON.stringify({ total: 175, vencidas: 100, aReceber: 75, recebidas: 10 }),
    JSON.stringify(contas.contasAReceber));
  check('a pagar: cancelado, transferência e status desconhecido fora',
    JSON.stringify(contas.contasAPagar) === JSON.stringify({ total: 40, vencidas: 0, aVencer: 40, pagas: 3 }),
    JSON.stringify(contas.contasAPagar));
  // E as linhas do painel são as mesmas, palavra por palavra: quem mudar a
  // regra lá precisa mudar aqui (ou passar a chamar esta).
  const painel = recortar(servidor, 'buildFinanceDashboardSummary');
  const normalizar = (s) => s.replace(/\s+/g, ' ');
  const regra = ['const pendingOrPartial = (entry) => { const s = String(entry.status || \'\').toLowerCase(); return s === \'pending\' || s === \'parcial\'; };',
    'total: sumFinanceAmount(despesaEntries.filter(pendingOrPartial))', 'vencidas: sumFinanceAmount(despesaEntries.filter(isOverdue))',
    'aVencer: sumFinanceAmount(despesaEntries.filter(isUpcoming))', 'pagas: sumFinanceAmount(despesaEntries.filter(isFinanceEntryRealized))',
    'total: sumFinanceAmount(receitaEntries.filter(pendingOrPartial))', 'vencidas: sumFinanceAmount(receitaEntries.filter(isOverdue))',
    'aReceber: sumFinanceAmount(receitaEntries.filter(isUpcoming))', 'recebidas: sumFinanceAmount(receitaEntries.filter(isFinanceEntryRealized))'];
  // O PAINEL TEM DE SER ACHADO. A primeira versão deste check passava quando
  // `buildFinanceDashboardSummary` sumia do server.js (`!painel || ...`): se
  // alguém a movesse para lib/ e mudasse a regra lá, a Síntese passaria a
  // divergir do painel em silêncio. Sumiu, falha — e quem mover a função
  // aponta este teste para o lugar novo.
  check('  o painel do Financeiro foi achado no server.js', painel.length > 0, painel.length > 0 ? '' :
    'o painel saiu do server.js: conferir contasDoFinanceiro e apontar este teste para o lugar novo');
  const naRegraDoPainel = painel.length > 0 && regra.every((trecho) => normalizar(painel).includes(normalizar(trecho)));
  check('  a regra é a das linhas de contas do painel do Financeiro', regra.every((trecho) => normalizar(contasSrc).includes(normalizar(trecho)))
    && naRegraDoPainel, naRegraDoPainel ? '' : 'o painel mudou a regra: conferir contasDoFinanceiro');
  // E NÃO SÓ O TEXTO: os NÚMEROS. O painel roda de verdade sobre os mesmos
  // casos de borda e as contas têm de sair iguais às de contasDoFinanceiro.
  // Tudo o que o painel usa além da regra (período, série, contraparte, rótulo
  // de status) não entra nas contas — por isso qualquer nome que o teste não
  // fornece vira um esboço que devolve `{}`, pelo `with` com Proxy. Assim uma
  // dependência nova do painel (o bloco Financeiro mexe nele) não quebra este
  // teste à toa; mudar a regra das contas, sim.
  const painelRodando = (() => {
    if (!painel) return null;
    const fornecidos = { getTodayLocal: () => new Date(2026, 9, 6) };
    const esboco = () => ({});
    const escopo = new Proxy(fornecidos, {
      has: (alvo, nome) => typeof nome === 'string' && (nome in alvo || !(nome in globalThis)),
      get: (alvo, nome) => (typeof nome === 'symbol' ? undefined : (nome in alvo ? alvo[nome] : esboco))
    });
    const fonte = ['pad2', 'toDateStr'].map((nome) => recortar(servidor, nome)).join('\n');
    try {
      // eslint-disable-next-line no-new-func
      return new Function('escopo', `with (escopo) { return (function () {\n${ajudantes}\n${fonte}\n${painel}\nreturn buildFinanceDashboardSummary;\n})(); }`)(escopo);
    } catch (erro) {
      return null;
    }
  })();
  let doPainel = null;
  try {
    doPainel = painelRodando && painelRodando({ finance: casos }, new URLSearchParams());
  } catch (erro) {
    doPainel = { erro: erro.message };
  }
  check('  e o painel, rodando sobre os mesmos casos, dá as mesmas contas',
    !!doPainel && JSON.stringify({ contasAPagar: doPainel.contasAPagar, contasAReceber: doPainel.contasAReceber }) === JSON.stringify(contas),
    doPainel ? JSON.stringify({ erro: doPainel.erro, contasAPagar: doPainel.contasAPagar, contasAReceber: doPainel.contasAReceber })
      : 'o painel não rodou fora do servidor');
  check('a Síntese e o Estoque leem pelas cargas enxutas',
    /cargasDosRelatorios\.lancamentosDaSintese\(\)/.test(servidorSemComent) && /cargasDosRelatorios\.produtosDoValorEmEstoque\(\)/.test(servidorSemComent));
  check('  e a função que lia o sistema inteiro não voltou', !/baseDosRelatoriosGerais\(/.test(servidorSemComent));
  const overview = servidorSemComent.slice(servidorSemComent.indexOf("pathname === '/api/reports/overview'"));
  check('o overview responde por parte', /url\.searchParams\.get\('parte'\)/.test(overview.slice(0, 1500)));

  // -------------------------------------------------------------------------
  console.log('\n--- 6. os CSV saem comprimidos ---');
  const enviar = (() => {
    const i = servidor.indexOf('  function enviarCsv(');
    return servidor.slice(i, servidor.indexOf('\n  }\n', i) + 5);
  })();
  check('enviarCsv existe', enviar.length > 50);
  check('  gzip ASSÍNCRONO, nunca gzipSync', /zlib\.gzip\(/.test(enviar) && !/gzipSync/.test(enviar));
  check('  pelo Accept-Encoding, com o piso do sendJson', /accept-encoding/.test(enviar) && /PISO_PARA_COMPRIMIR/.test(enviar));
  check('  com Vary e Content-Encoding', /Vary: 'Accept-Encoding'/.test(enviar) && /'Content-Encoding': 'gzip'/.test(enviar));
  check('  sem escrever em resposta já fechada', /res\.destroyed \|\| res\.writableEnded/.test(enviar) && /try \{[\s\S]*?\} catch/.test(enviar));
  check('  e erro de compressão entrega o arquivo cru', /if \(erro\) \{[\s\S]{0,200}res\.end\(corpo\)/.test(enviar));
  // NENHUM export de relatório escreve o CSV cru: os cinco arquivos (catálogo,
  // Personalizado, Vendas, Financeiro e Estoque — os dois últimos numa rota
  // só) passam por ela.
  const rotasDeRelatorio = servidorSemComent.slice(servidorSemComent.indexOf("pathname === '/api/reports/catalogo'"),
    servidorSemComent.indexOf("pathname.match(/^\\/api\\/metas"));
  // Conta TODA chamada, com ou sem `return` antes: exigir o `return` deixava
  // de fora uma chamada escrita como `enviarCsv(res, ...); return;`.
  const chamadasDeEnviar = (rotasDeRelatorio.match(/\benviarCsv\(res,/g) || []).length;
  check('  os exports de relatório passam por ela', chamadasDeEnviar === 4
    && /return enviarCsv\(res, conteudo/.test(rotasDeRelatorio), `${chamadasDeEnviar} chamadas`);
  check('  e nenhum escreve text/csv por conta própria', !/text\/csv/.test(rotasDeRelatorio));

  // -------------------------------------------------------------------------
  console.log('\n--- 7. a tela do Relatório de Vendas ---');
  const indice = ler('public/modules/reports/index.js');
  const telaRel = ler('public/modules/reports/subs/relatorios.js');
  check('trocar de visão só redesenha', /state\.reportsVendasSoRedesenhar = true;\s*\n\s*loadModule\('reports'\)/.test(telaRel));
  check('  e só a resposta da MESMA consulta, uma vez', /naTela\.consulta === consulta/.test(indice)
    && /state\.reportsVendasSoRedesenhar = false;/.test(indice));
  check('a tela manda o hash das listas que tem', /comHash\.set\('opcoesHash', guardadas\.hash\)/.test(indice));
  check('  e só usa as guardadas quando o hash bate', /guardadas\.hash === relatorioVendas\.opcoesHash/.test(indice));
  check('  e o hash não vai para a exportação', !/opcoesHash/.test(telaRel.replace(/\/\/.*$/gm, '')));
  const rotaVendas = servidorSemComent.slice(servidorSemComent.indexOf("pathname === '/api/reports/vendas' && req.method === 'GET'"));
  check('o servidor recalcula as listas e só as omite com o hash igual',
    /createHash\('sha1'\)\.update\(JSON\.stringify\(relatorio\.opcoes\)\)/.test(rotaVendas.slice(0, 1200))
    && /url\.searchParams\.get\('opcoesHash'\) === opcoesHash/.test(rotaVendas.slice(0, 1200)));
  check('a Síntese e o Estoque pedem só a sua parte', /&parte=\$\{encodeURIComponent\(aberto\.especial\)\}/.test(indice));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
