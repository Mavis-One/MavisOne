#!/usr/bin/env node
// O NÚMERO DO PEDIDO, NOS QUATRO CAMINHOS QUE ELE PODE SAIR (fases BR, CG, CI).
//
// `getNextSalesCode` parece uma linha (`nextval`) e são quatro caminhos, três
// deles escritos depois de um estrago real:
//
//   1. o normal .......... nextval devolve, ninguém mais mexeu
//   2. o REPARO .......... a sequence ficou atrás dos dados (a importação do
//                          ViperERP gravou 1 a 15.525 direto na tabela)
//   3. a QUEDA ........... o banco não tem a sequence (fase BR não rodou)
//   4. o erro de verdade . banco fora do ar não pode virar "numera do zero"
//
// O QUE ESTE TESTE PROTEGE, e por que ele existe:
//
// O piso de 16.000 (fase CG) separa o que nasceu aqui do histórico importado.
// Ele estava na migração, estava na queda, e NÃO estava no reparo — que passava
// como piso o próprio código que tinha colidido. Esse valor nunca fez
// diferença (um código que colidiu já existe na tabela, logo é menor ou igual
// ao maior dela), e o efeito era mudo: num banco cujos dados param em 15.525, o
// reparo devolvia 15.526 — dentro da faixa do histórico.
//
// Nada estoura quando isso acontece. Não há unique em orders.code nem em
// quotes.code: o número sai, o pedido grava, e a faixa que alguém decidiu
// manter separada deixou de ser separada sem aviso. Por isso é teste, e não
// leitura de código.
//
// Não precisa de Postgres: o dublê abaixo implementa a semântica de
// setval/nextval que importa aqui — `is_called = true` faz o próximo nextval
// devolver o valor gravado + 1.
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

function dublar(caminho, exports) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, children: [], paths: [], exports };
}

// O estado do "banco": a sequence e o que já está gravado nas duas tabelas.
const bd = { seq: 0, orders: [], quotes: [], semSequence: false, erroDeRede: null };

function maiorDe(tabela) {
  const lista = bd[tabela] || [];
  return lista.length ? Math.max(...lista) : null;
}

// Implementa só as três consultas que getNextSalesCode faz. Qualquer outra
// estoura de propósito: um dublê que responde a tudo esconde a mudança que
// deveria ter quebrado o teste.
async function consultar(sql, params = []) {
  if (bd.erroDeRede) throw new Error(bd.erroDeRede);
  if (bd.semSequence) throw new Error('relation "sales_code_seq" does not exist');
  const texto = String(sql).replace(/\s+/g, ' ').trim();

  if (/^select nextval\('sales_code_seq'\)::int as code$/.test(texto)) {
    bd.seq += 1;
    return { rows: [{ code: bd.seq }] };
  }
  if (/from orders where code = \$1/.test(texto)) {
    const code = params[0];
    const existe = bd.orders.includes(code) || bd.quotes.includes(code);
    return { rows: existe ? [{ existe: 1 }] : [] };
  }
  if (/setval\('sales_code_seq'/.test(texto)) {
    // greatest(max(orders), max(quotes), $1) — e depois nextval.
    const piso = Number(params[0] || 0);
    const ajustada = Math.max(0, ...bd.orders, ...bd.quotes, piso);
    bd.seq = ajustada + 1;
    return { rows: [{ ajustada, code: bd.seq }] };
  }
  throw new Error(`consulta não prevista no dublê: ${texto}`);
}

// A queda usa o construtor de consultas, não SQL cru.
const encadeado = (tabela) => ({
  select: () => ({
    order: () => ({
      limit: () => ({ maybeSingle: async () => ({ data: maiorDe(tabela) === null ? null : { code: maiorDe(tabela) } }) })
    })
  })
});

dublar('../lib/db/conexao', { consultar });
dublar('../lib/db/client', {
  banco: { from: encadeado },
  createId: () => 'id-de-teste',
  assertNoError: () => {}
});

const { getNextSalesCode } = require('../lib/db/vendas-compras');

// O reparo e a queda avisam por console.error, e o aviso é parte do contrato:
// um número que saltou sem deixar rastro é um número que ninguém explica depois.
let avisos = [];
const errOriginal = console.error;
console.error = (...args) => { avisos.push(args.join(' ')); };

function cenario({ seq = 0, orders = [], quotes = [], semSequence = false, erroDeRede = null }) {
  bd.seq = seq;
  bd.orders = orders;
  bd.quotes = quotes;
  bd.semSequence = semSequence;
  bd.erroDeRede = erroDeRede;
  avisos = [];
}

(async () => {
  console.log('--- 1. o caminho normal: a sequence está em dia ---');
  // Depois da migração da fase CG, num banco com o histórico importado.
  cenario({ seq: 15999, orders: [1, 15525], quotes: [15517] });
  check('o primeiro número próprio é 16000', (await getNextSalesCode()) === 16000);
  check('o seguinte é 16001', (await getNextSalesCode()) === 16001);
  check('sem aviso nenhum (nada foi reparado)', avisos.length === 0, String(avisos.length));

  console.log('\n--- 2. o reparo: a sequence ficou atrás dos dados ---');
  // Exatamente o que foi medido depois da importação do ViperERP: sequence em
  // 1, e o pedido 1 já existe.
  cenario({ seq: 0, orders: [1, 15525], quotes: [15517] });
  const reparado = await getNextSalesCode();
  check('NÃO devolve 15526 (dentro da faixa do histórico)', reparado !== 15526, String(reparado));
  check('devolve 16000 — o piso da fase CG vale também aqui', reparado === 16000, String(reparado));
  check('e avisou que reparou', avisos.some((a) => /estava atras dos dados/.test(a)));
  check('o aviso diz o número que colidiu e o que saiu no lugar',
    avisos.some((a) => /devolveu 1,/.test(a) && /16000/.test(a)), avisos[0]);
  check('o próximo continua de onde parou', (await getNextSalesCode()) === 16001);

  console.log('\n--- 3. o reparo NUNCA rebaixa: dados já acima do piso ---');
  // O perigo do espelho: um piso aplicado sem greatest reemitiria números já
  // gravados, e não há unique em orders.code para barrar.
  cenario({ seq: 5, orders: [6, 16010], quotes: [] });
  const acima = await getNextSalesCode();
  check('salta para depois do maior gravado, não para o piso', acima === 16011, String(acima));

  console.log('\n--- 4. a queda: o banco não tem a sequence ---');
  cenario({ seq: 0, orders: [1, 15525], quotes: [15517], semSequence: true });
  const daQueda = await getNextSalesCode();
  check('a queda concorda com a sequence: 16000', daQueda === 16000, String(daQueda));
  check('e diz qual migração falta', avisos.some((a) => /fase-br-sequence-do-codigo-de-venda/.test(a)));

  console.log('\n--- 4b. a queda num banco vazio, sem histórico nenhum ---');
  cenario({ seq: 0, orders: [], quotes: [], semSequence: true });
  check('ainda começa em 16000, não em 1', (await getNextSalesCode()) === 16000);

  console.log('\n--- 5. erro que NÃO é da sequence sobe ---');
  // Tratar banco fora do ar como "sem sequence" faria a queda numerar por cima
  // de dados que ela não conseguiu ler.
  cenario({ seq: 15999, erroDeRede: 'connection refused' });
  let subiu = null;
  try {
    await getNextSalesCode();
  } catch (erro) {
    subiu = erro;
  }
  check('estoura em vez de numerar às cegas', Boolean(subiu));
  check('e é o erro original, não um remendo', subiu && /connection refused/.test(subiu.message));

  console.log('\n--- 6. o piso mora num lugar só ---');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'vendas-compras.js'), 'utf8');
  check('a constante existe', /const PRIMEIRO_NUMERO_DE_VENDA = 16000;/.test(src));
  check('o reparo usa a constante, e não o código que colidiu',
    /\), true\) as ajustada, nextval\('sales_code_seq'\)::int as code`, \[PRIMEIRO_NUMERO_DE_VENDA - 1\]\)/.test(src));
  // Sem os comentários: eles citam o 16000 para explicar a faixa, e isso é
  // prosa, não um segundo lugar onde o número é decidido.
  const { semComentarios } = require('./sem-comentarios');
  const codigo = semComentarios(src);
  check('nenhum 16000 solto no código, fora da constante',
    (codigo.match(/16000/g) || []).length === 1, String((codigo.match(/16000/g) || []).length));
  check('e nenhum 15999 escrito à mão (ele sai da constante)',
    !/15999/.test(codigo));

  console.error = errOriginal;
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error = errOriginal;
  console.error('O teste quebrou:', erro);
  process.exit(1);
});
