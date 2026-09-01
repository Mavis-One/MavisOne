#!/usr/bin/env node
/**
 * O RAZÃO DE ESTOQUE VIVE NO POSTGRES, E É TRANSACIONAL (fase AP).
 *
 *   PORT=3999 npm start   (num terminal)
 *   node scripts/test-razao-no-banco.js   (noutro)
 *
 * Fora do `npm test` pelo mesmo motivo dos outros e2e: precisa do servidor no
 * ar. Sem ele, avisa e sai SEM falhar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * A fase AP tirou o razão do data/db.json e o pôs em stock_movements. Três
 * coisas podem dar errado aí, e as três são silenciosas — o saldo fica errado
 * e nenhuma tela dá erro:
 *
 * 1. A LINHA NÃO CHEGA NO BANCO. Se algum caminho continuar gravando só em
 *    memória, o movimento aparece na resposta da requisição e some no próximo
 *    F5. Por isso todo check aqui confere no SQL, não na resposta HTTP.
 *
 * 2. O TOTAL DO PRODUTO E O RAZÃO DISCORDAM. Eram duas escritas em lugares
 *    diferentes; agora é uma transação. O teste soma o razão e compara com
 *    products.stock_quantity — que é a divergência que já existia em produção
 *    antes desta fase.
 *
 * 3. METADE DE UMA OPERAÇÃO. Uma transferência são dois movimentos e um
 *    registro. Se um item do lote for impossível, NADA pode ficar gravado —
 *    nem o item que cabia.
 *
 * O teste cria tudo o que usa (produto `zz-teste-...`, dois depósitos) e apaga
 * no fim, inclusive quando falha.
 */
require('dotenv').config();
const http = require('http');
const { consultar, fecharPool } = require('../lib/db/conexao');

const PORTA = Number(process.env.PORTA_TESTE) || 3999;
let token = '';
let falhas = 0;
const check = (n, c, d) => { console.log(`  ${c ? 'OK ' : 'XX '} ${n}${d !== undefined ? ' -> ' + d : ''}`); if (!c) falhas++; };

function pedir(metodo, caminho, corpo) {
  return new Promise((resolve) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      host: 'localhost', port: PORTA, path: caminho, method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-auth-token': token } : {}),
        ...(dados ? { 'Content-Length': Buffer.byteLength(dados) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch (_) { /* resposta não-JSON */ }
        resolve({ status: res.statusCode, json, texto: b.slice(0, 200) });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, texto: 'sem conexão' }));
    if (dados) req.write(dados);
    req.end();
  });
}

const lixo = { produto: null, depositos: [] };

/** O razão SOMADO, direto do SQL — a fonte que agora manda. */
async function saldoNoRazao(produtoId, depositoId) {
  const { rows } = await consultar(
    `select coalesce(sum(case when type = 'saida' then -quantity else quantity end), 0)::float as saldo
       from stock_movements where product_id = $1 and deposit_id = $2`,
    [produtoId, depositoId]
  );
  return rows[0].saldo;
}

async function contarMovimentos(produtoId) {
  const { rows } = await consultar('select count(*)::int as n from stock_movements where product_id = $1', [produtoId]);
  return rows[0].n;
}

async function totalDoProduto(produtoId) {
  const { rows } = await consultar('select coalesce(stock_quantity, 0)::float as q from products where id = $1', [produtoId]);
  return rows.length ? rows[0].q : null;
}

async function limpar() {
  if (lixo.produto) {
    await consultar('delete from stock_movements where product_id = $1', [lixo.produto]);
    await consultar('delete from stock_transfers where product_id = $1', [lixo.produto]);
    await consultar('delete from products where id = $1', [lixo.produto]);
  }
  for (const id of lixo.depositos) await consultar('delete from deposits where id = $1', [id]);
}

(async () => {
  const senha = process.env.SENHA_TESTE || '';
  if (!senha) {
    console.log('  (defina SENHA_TESTE no .env para rodar este teste — saindo sem falhar)');
    await fecharPool();
    process.exit(0);
  }

  console.log('--- 0. login ---');
  const login = await pedir('POST', '/api/login', { username: process.env.USUARIO_TESTE || 'admin', password: senha });
  if (login.status !== 200) {
    console.log(`  (login recusou: ${login.status} — o servidor está de pé na porta ${PORTA}?)`);
    await fecharPool();
    process.exit(0);
  }
  token = login.json.token;
  check('autenticado', Boolean(token));

  console.log('\n--- 1. o cenário, montado por este teste ---');
  const carimbo = Date.now();
  const depA = await pedir('POST', '/api/cadastros/deposits', { name: `zz-razao-origem-${carimbo}` });
  const depB = await pedir('POST', '/api/cadastros/deposits', { name: `zz-razao-destino-${carimbo}` });
  const origemId = depA.json?.deposit?.id || depA.json?.record?.id || depA.json?.id;
  const destinoId = depB.json?.deposit?.id || depB.json?.record?.id || depB.json?.id;
  check('dois depósitos criados', Boolean(origemId && destinoId));
  if (!origemId || !destinoId) { await limpar(); await fecharPool(); process.exit(1); }
  lixo.depositos.push(origemId, destinoId);

  const novoProduto = await pedir('POST', '/api/stock/products', { name: `zz-razao-produto-${carimbo}`, sku: `ZZ${carimbo}` });
  const produtoId = novoProduto.json?.product?.id || novoProduto.json?.id;
  check('produto criado', Boolean(produtoId), novoProduto.texto.slice(0, 80));
  if (!produtoId) { await limpar(); await fecharPool(); process.exit(1); }
  lixo.produto = produtoId;

  console.log('\n--- 2. a movimentação chega no BANCO, não só na resposta ---');
  const entrada = await pedir('POST', '/api/stock/movements', {
    productId: produtoId, depositId: origemId, type: 'entrada', quantity: 10, unitCost: 5
  });
  check('a entrada foi aceita', entrada.status === 200, entrada.texto.slice(0, 80));
  check('  e existe uma linha em stock_movements', (await contarMovimentos(produtoId)) === 1);
  check('  com o saldo no depósito de origem', (await saldoNoRazao(produtoId, origemId)) === 10);
  // O código não vem mais de max+1 no Node: vem da sequence.
  const { rows: cod } = await consultar('select code from stock_movements where product_id = $1', [produtoId]);
  check('  e o código veio da sequence do banco', /^MOV-\d{4}$/.test(cod[0].code), cod[0].code);

  console.log('\n--- 3. o total do produto e o razão contam a MESMA coisa ---');
  check('products.stock_quantity acompanhou o razão', (await totalDoProduto(produtoId)) === 10,
    String(await totalDoProduto(produtoId)));

  console.log('\n--- 4. a transferência: dois movimentos e um registro, de uma vez ---');
  const transf = await pedir('POST', '/api/stock/transfers', {
    originDepositId: origemId, destinationDepositId: destinoId,
    items: [{ productId: produtoId, quantity: 4 }]
  });
  check('a transferência foi aceita', transf.status === 200, transf.texto.slice(0, 80));
  check('  gerou os dois movimentos (saída e entrada)', (await contarMovimentos(produtoId)) === 3);
  const { rows: t } = await consultar('select code from stock_transfers where product_id = $1', [produtoId]);
  check('  e o registro da transferência, numerado pela sequence', t.length === 1 && /^TRA-\d{4}$/.test(t[0].code), t[0]?.code);
  check('  a origem ficou com 6', (await saldoNoRazao(produtoId, origemId)) === 6);
  check('  e o destino com 4', (await saldoNoRazao(produtoId, destinoId)) === 4);
  // Transferência não cria nem consome: o total do produto não muda.
  check('  o total do produto NÃO mudou (só mudou de depósito)', (await totalDoProduto(produtoId)) === 10);

  console.log('\n--- 5. um item impossível não deixa passar o que cabia ---');
  const antesLinhas = await contarMovimentos(produtoId);
  const antesTotal = await totalDoProduto(produtoId);
  const parcial = await pedir('POST', '/api/stock/transfers', {
    originDepositId: origemId, destinationDepositId: destinoId,
    items: [{ productId: produtoId, quantity: 1 }, { productId: produtoId, quantity: 999999 }]
  });
  check('a movimentação foi recusada', parcial.status >= 400, String(parcial.status));
  check('  e NADA foi gravado', (await contarMovimentos(produtoId)) === antesLinhas,
    `${antesLinhas} -> ${await contarMovimentos(produtoId)}`);
  check('  nem o total mexeu', (await totalDoProduto(produtoId)) === antesTotal);

  console.log('\n--- 6. o estorno da transferência tira os dois lados ---');
  const { rows: paraEstornar } = await consultar('select id from stock_transfers where product_id = $1', [produtoId]);
  const estorno = await pedir('DELETE', `/api/stock/transfers/${encodeURIComponent(paraEstornar[0].id)}`);
  check('o estorno foi aceito', estorno.status === 200, estorno.texto.slice(0, 80));
  check('  os dois movimentos sumiram', (await contarMovimentos(produtoId)) === 1);
  check('  o registro da transferência sumiu', (await consultar('select count(*)::int n from stock_transfers where product_id = $1', [produtoId])).rows[0].n === 0);
  check('  e a origem voltou para 10', (await saldoNoRazao(produtoId, origemId)) === 10);

  console.log('\n--- 7. estornar a entrada corrige o total na mesma transação ---');
  const { rows: mov } = await consultar('select id from stock_movements where product_id = $1', [produtoId]);
  const del = await pedir('DELETE', `/api/stock/movements/${encodeURIComponent(mov[0].id)}`);
  check('a exclusão foi aceita', del.status === 200, del.texto.slice(0, 80));
  check('  o razão ficou vazio', (await contarMovimentos(produtoId)) === 0);
  check('  e o total do produto voltou a zero', (await totalDoProduto(produtoId)) === 0,
    String(await totalDoProduto(produtoId)));
})()
  .catch((erro) => { console.error(erro); falhas++; })
  .finally(async () => {
    console.log('\n--- limpeza ---');
    await limpar();
    check('o cenário de teste foi removido', (await contarMovimentos(lixo.produto || 'x')) === 0);
    console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
    await fecharPool();
    process.exit(falhas ? 1 : 0);
  });
