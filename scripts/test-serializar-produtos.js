#!/usr/bin/env node
/**
 * O SALDO DO CATÁLOGO COM O RAZÃO INDEXADO É O MESMO SALDO (fase de desempenho).
 *
 * O QUE MUDOU
 * -----------
 * A lista de Produtos, o Painel do Estoque e o Gestor de Preços serializavam o
 * catálogo com `products.map(serializeProduct)`: cada produto varria o razão
 * INTEIRO ~22 vezes (duas por depósito, mais a cor e o trânsito). O custo era
 * produtos × depósitos × movimentos — 162 ms com os 59 movimentos de hoje,
 * 1,2–2,0 s com 1.000, ~105 s com 20.000, tudo no event loop.
 *
 * `stockCore.serializarProdutos` agrupa o razão por produto numa passada e
 * entrega a cada produto só a fatia dele, na ordem original. E as rotas de UM
 * produto (Status, quebra por cor, escritas de Estoque) passaram a carregar só
 * o razão daquele produto (`listarMovimentosDosProdutos`).
 *
 * O QUE ESTE TESTE PRENDE
 * -----------------------
 * Que as duas coisas devolvem EXATAMENTE o que a forma antiga devolvia — saldo,
 * reserva, não alocado, trânsito, a ordem das cores —, com um razão sintético
 * que passa por cada ramo das funções de saldo: tipo 'SAIDA' maiúsculo,
 * quantidade em texto, depósito que não existe, movimento sem depósito, o balde
 * de trânsito, cores, produto sem movimento nenhum. Sem banco: é stock-core
 * puro, e a comparação é deepStrictEqual e JSON byte a byte.
 *
 * E prende, no fonte, que as três rotas usam a função nova — voltar para
 * `products.map(serializeProduct)` não quebra nada na hora, só fica lento de
 * novo em silêncio, e é para isso que existe um teste.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const RAIZ = path.join(__dirname, '..');
const stockCore = require(path.join(RAIZ, 'lib/stock-core.js'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const igual = (a, b) => {
  try { assert.deepStrictEqual(a, b); return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};

// ---------------------------------------------------------------------------
// Um razão sintético e determinístico (sem Math.random: o teste tem de falhar
// sempre do mesmo jeito, ou não falhar).
// ---------------------------------------------------------------------------
let semente = 7;
const sorteio = (n) => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n; };

const deposits = [
  { id: 'd1', name: 'CD' }, { id: 'd2', name: 'LOJA CENTRO' }, { id: 'd3', name: 'FILIAL 08' }, { id: 'd4', name: 'GALPÃO' }
];
// Depósitos de movimento: os quatro de verdade, um que saiu do cadastro, o
// trânsito e o "sem depósito".
const LUGARES = ['d1', 'd2', 'd3', 'd4', 'dx-removido', stockCore.DEPOSITO_EM_TRANSITO, ''];
const CORES = ['', '', 'cv-preto', 'cv-branco', 'cv-azul'];
const TIPOS = ['entrada', 'entrada', 'saida', 'SAIDA', 'Entrada'];

const products = [];
for (let i = 0; i < 80; i += 1) {
  products.push({
    id: `p${String(i).padStart(3, '0')}`,
    name: `Produto ${i % 13}`,
    sku: `SKU${i}`,
    stockQuantity: (i * 7) % 23 - 3,
    costPrice: i % 5 === 0 ? 0 : 10 + i,
    salePrice: 15 + i,
    unidadeComercial: i % 3 ? 'PC' : '',
    ncm: i % 4 ? '84719012' : ''
  });
}

function razao(qtd) {
  const lista = [];
  for (let i = 0; i < qtd; i += 1) {
    // Metade dos produtos nunca movimenta: é o atalho de productBalances.
    const produto = products[sorteio(40) * 2];
    lista.push({
      id: `m${i}`,
      code: `MOV-${String(i + 1).padStart(4, '0')}`,
      productId: produto.id,
      depositId: LUGARES[sorteio(LUGARES.length)],
      classValueId: CORES[sorteio(CORES.length)],
      type: TIPOS[sorteio(TIPOS.length)],
      // Texto de propósito em parte das linhas: movementSignedQuantity converte.
      quantity: i % 6 === 0 ? String(1 + sorteio(9)) : 0.5 * (1 + sorteio(19)),
      createdAt: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00.000Z`
    });
  }
  // Um movimento de produto que não está na lista: tem de ser ignorado igual.
  lista.push({ id: 'mfantasma', productId: 'p-fora', depositId: 'd1', type: 'entrada', quantity: 5 });
  return lista;
}

function base(movimentos) {
  return {
    deposits,
    stockMovements: movimentos,
    productCategories: [{ id: 'c1', name: 'Peças' }],
    productMeta: {
      p000: { categoryId: 'c1', minStock: 5, maxStock: 50, defaultDepositId: 'd2', unit: 'UN' },
      p002: { minStock: 100 },
      p004: { status: 'inativo', defaultDepositId: 'dx-removido' }
    }
  };
}

const reservas = {
  porChave: new Map([['p000|cv-preto', 2], ['p002|', 1]]),
  porProduto: new Map([['p000', 3], ['p002', 1], ['p010', 4]]),
  pedidos: []
};

console.log('\n--- serializarProdutos == products.map(serializeProduct) ---');
for (const qtd of [0, 59, 1000, 5000]) {
  const data = base(razao(qtd));
  const antes = products.map((p) => stockCore.serializeProduct(p, data, reservas));
  const depois = stockCore.serializarProdutos(products, data, reservas);
  check(`com ${qtd} movimentos, com reservas`, igual(depois, antes));
  const antesSem = products.map((p) => stockCore.serializeProduct(p, data));
  const depoisSem = stockCore.serializarProdutos(products, data);
  check(`com ${qtd} movimentos, sem reservas (reserved/available null)`,
    igual(depoisSem, antesSem) && depoisSem.every((p) => p.reserved === null && p.available === null));
}

// O ramo que mais importa provar não foi exercitado por acaso: cores em mais de
// um depósito, trânsito, depósito removido e saldo negativo.
{
  const data = base(razao(1000));
  const lista = stockCore.serializarProdutos(products, data, reservas);
  check('o razão de teste tem cor, trânsito e saldo negativo',
    lista.some((p) => p.classBalances.valores.length > 1)
    && lista.some((p) => p.inTransit !== 0)
    && lista.some((p) => p.balances.some((b) => b.quantity < 0)),
    'senão a igualdade acima não provaria esses ramos');
  check('e metade do catálogo cai no atalho (sem movimento)',
    lista.filter((p) => p.balances.every((b) => b.quantity === 0) && p.classBalances.valores.length === 0).length >= 40);
}

console.log('\n--- o atalho do produto sem movimento ---');
{
  const data = base([]);
  const p = products[1];
  const saldo = stockCore.productBalances(data, p);
  check('cada depósito com 0 e nenhuma cor',
    igual(saldo.balances, deposits.map((d) => ({ depositId: d.id, depositName: d.name, quantity: 0, classes: [] }))));
  check('não alocado = total, trânsito 0', saldo.unallocated === p.stockQuantity && saldo.inTransit === 0 && saldo.allocated === 0);
  // -0 seria um número diferente no JSON? Não, mas Object.is pegaria: o
  // atalho tem de dar o mesmo 0 que o reduce de lista vazia.
  check('o zero é +0, como o reduce', saldo.balances.every((b) => Object.is(b.quantity, 0)));
}

console.log('\n--- o razão SÓ do produto dá o mesmo saldo que o razão inteiro ---');
// É a premissa de listarMovimentosDosProdutos e do contexto das escritas de
// Estoque (loadStockContextDosProdutos): as rotas de UM produto carregam só o
// razão dele. Toda pergunta que elas fazem ao stock-core tem de dar igual.
{
  const movimentos = razao(2000);
  const inteiro = base(movimentos);
  let comparacoes = 0;
  let diferentes = 0;
  for (const p of products.slice(0, 30)) {
    const recorte = base(movimentos.filter((m) => m.productId === p.id));
    const perguntas = [
      [stockCore.serializeProduct(p, recorte, reservas), stockCore.serializeProduct(p, inteiro, reservas)],
      [stockCore.classBalances(recorte, p.id), stockCore.classBalances(inteiro, p.id)],
      [stockCore.transitBalance(recorte, p.id), stockCore.transitBalance(inteiro, p.id)]
    ];
    for (const lugar of LUGARES) {
      perguntas.push([stockCore.depositBalance(recorte, p.id, lugar), stockCore.depositBalance(inteiro, p.id, lugar)]);
      perguntas.push([stockCore.classBalances(recorte, p.id, lugar), stockCore.classBalances(inteiro, p.id, lugar)]);
      for (const cor of CORES.filter(Boolean)) {
        perguntas.push([stockCore.classValueBalance(recorte, p.id, cor, lugar), stockCore.classValueBalance(inteiro, p.id, cor, lugar)]);
      }
    }
    for (const [a, b] of perguntas) {
      comparacoes += 1;
      if (!igual(a, b)) diferentes += 1;
    }
  }
  check('depositBalance, classValueBalance, classBalances, transitBalance e serializeProduct',
    diferentes === 0, `${comparacoes} comparações, ${diferentes} diferente(s)`);
}

console.log('\n--- as rotas que serializam o catálogo usam a função nova ---');
const servidor = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
function pedacoDaRota(assinatura) {
  const inicio = servidor.indexOf(assinatura);
  if (inicio < 0) return '';
  const resto = servidor.slice(inicio + assinatura.length);
  // Até o próximo `if (` do nível das rotas (as vizinhas podem abrir com regex).
  const fim = resto.search(/\n {2}if \(/);
  return assinatura + (fim < 0 ? resto : resto.slice(0, fim));
}
const rotas = {
  'lista de Produtos': pedacoDaRota("pathname === '/api/stock/products' && req.method === 'GET'"),
  'Gestor de Preços': pedacoDaRota("pathname === '/api/stock/price-manager' && req.method === 'GET'"),
  'Painel do Estoque': (() => {
    const i = servidor.indexOf("if (modulo === 'stock') {");
    return i < 0 ? '' : servidor.slice(i, servidor.indexOf("if (modulo === 'fiscal')", i));
  })()
};
for (const [nome, trecho] of Object.entries(rotas)) {
  check(`${nome}: serializarProdutos`, /stockCore\.serializarProdutos\(products, data/.test(trecho)
    && !/products\.map\(\(\w+\) => stockCore\.serializeProduct/.test(trecho), `${trecho.length} chars`);
}
// E o Gestor manda só o que a tela lê (front-end:15): sem `balances`, sem a
// quebra por cor, sem os campos fiscais — 10 MB por carga caíam para ~0,9 MB.
const gestor = rotas['Gestor de Preços'];
check('o Gestor projeta os sete campos da tela',
  /products: list\.map\(\(p\) => \(\{\s*id: p\.id,\s*name: p\.name,\s*sku: p\.sku,\s*stockQuantity: p\.stockQuantity,\s*costPrice: p\.costPrice,\s*salePrice: p\.salePrice,\s*tablePrice: p\.tablePrice\s*\}\)\)/.test(gestor));
check('  depois de filtrar pela pendência sobre o produto inteiro',
  gestor.indexOf('temPendenciaDeCadastro(p, pendencia)') > -1
  && gestor.indexOf('temPendenciaDeCadastro(p, pendencia)') < gestor.indexOf('products: list.map'));
check('  e as tabelas com id, nome, tipo e markup',
  /priceTables: \(data\.priceTables \|\| \[\]\)\.map\(\(t\) => \(\{ id: t\.id, name: t\.name, type: t\.type, markupPercent: t\.markupPercent \}\)\)/.test(gestor));
// O que a tela lê tem de estar entre os sete — se price_manager.js passar a ler
// outro campo do produto, este check acusa antes de a coluna aparecer vazia.
const telaGestor = fs.readFileSync(path.join(RAIZ, 'public/modules/stock/subs/price_manager.js'), 'utf8');
const lidos = [...new Set([...telaGestor.matchAll(/\bproduct\.([a-zA-Z]+)/g)].map((m) => m[1]))];
const SETE = ['id', 'name', 'sku', 'stockQuantity', 'costPrice', 'salePrice', 'tablePrice'];
const foraDosSete = lidos.filter((c) => !SETE.includes(c));
check('  e a tela não lê campo que ficou de fora', foraDosSete.length === 0,
  foraDosSete.length ? `lê: ${foraDosSete.join(', ')}` : lidos.join(', '));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
