#!/usr/bin/env node
/**
 * A CADEIA DE COMPRAS: COTACAO -> ORDEM -> RECEBIMENTO (fase AQ).
 *
 *   PORT=3999 npm start                      (num terminal)
 *   node scripts/test-compras-documento.js   (noutro)
 *
 * Fora do `npm test` pelo mesmo motivo dos outros e2e: precisa do servidor no
 * ar. Sem ele, avisa e sai SEM falhar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. O TIPO NAO VEM DA TELA. Cotacao e ordem sao o mesmo registro e quem decide
 *    e o status. Se a tela conseguir mandar `type` e ser obedecida, passam a
 *    existir dois campos dizendo coisas diferentes sobre o mesmo documento.
 *
 * 2. RECEBER LANCA UMA VEZ. Estoque, conta a pagar e a marca de recebido saem
 *    juntos; clicar duas vezes nao lanca duas vezes. As colunas stockApplied e
 *    financeApplied sao o que garante isso — sem elas, receber -> cancelar ->
 *    receber lancaria a mercadoria duas vezes e cada passo pareceria certo.
 *
 * 3. O ESTORNO LANCA O CONTRARIO, NAO APAGA. Duas linhas no razao depois de
 *    cancelar, nao zero: a prova de que a mercadoria chegou e voltou e o que a
 *    conferencia fisica procura quando o saldo nao bate.
 *
 * O teste cria tudo o que usa (produto e deposito `zz-...`) e apaga no fim,
 * inclusive quando falha.
 */
require('dotenv').config();
const http = require('http');
const { consultar, fecharPool } = require('../lib/db/conexao');

const PORTA = Number(process.env.PORTA_TESTE) || 3999;
let token = '';
let falhas = 0;
const ok = (n, c, d) => { console.log(`  ${c ? 'OK ' : 'XX '} ${n}${d !== undefined ? ' -> ' + d : ''}`); if (!c) falhas++; };

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
        try { json = JSON.parse(b); } catch (_) { /* nao-JSON */ }
        resolve({ status: res.statusCode, json, texto: b.slice(0, 160) });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, texto: 'sem conexao' }));
    if (dados) req.write(dados);
    req.end();
  });
}

const lixo = { produto: null, deposito: null, documentos: [] };

const saldo = async (pid, dep) => (await consultar(
  `select coalesce(sum(case when type = 'saida' then -quantity else quantity end), 0)::float s
     from stock_movements where product_id = $1 and deposit_id = $2`, [pid, dep])).rows[0].s;
const total = async (pid) => (await consultar(
  'select coalesce(stock_quantity,0)::float q from products where id = $1', [pid])).rows[0].q;

(async () => {
  const senha = process.env.SENHA_TESTE || '';
  const login = await pedir('POST', '/api/login', {
    username: process.env.USUARIO_TESTE || 'admin', password: senha
  });
  if (login.status !== 200) {
    console.log(`  (login recusou: ${login.status} — o servidor esta de pe na porta ${PORTA} e SENHA_TESTE esta no .env?)`);
    await fecharPool();
    process.exit(0);
  }
  token = login.json.token;
  ok('autenticado', Boolean(token));

  const carimbo = Date.now();
  const dep = await pedir('POST', '/api/cadastros/deposits', { name: `zz-compra-dep-${carimbo}` });
  const depId = dep.json?.deposit?.id || dep.json?.record?.id || dep.json?.id;
  lixo.deposito = depId;
  const prod = await pedir('POST', '/api/stock/products', { name: `zz-compra-prod-${carimbo}`, sku: `ZZC${carimbo}` });
  const prodId = prod.json?.product?.id;
  lixo.produto = prodId;
  ok('cenario montado (deposito + produto)', Boolean(depId && prodId));

  console.log('\n--- 1. nasce COTACAO, e o tipo vem do status ---');
  const criado = await pedir('POST', '/api/purchases/documentos', {
    status: 'cotacao', supplierName: 'zz-fornecedor', depositId: depId,
    date: '2026-09-02', deliveryDate: '2026-09-20',
    items: [{ productId: prodId, name: 'zz', quantity: 10, unitCost: 7 }],
    freight: 30, otherExpenses: 0, discountAmount: 10
  });
  const doc = criado.json?.documento;
  lixo.documentos.push(doc?.id);
  ok('a cotacao foi aceita', criado.status === 200, criado.texto.slice(0, 70));
  ok('  o servidor derivou type=quote do status', doc?.type === 'quote', doc?.type);
  ok('  numerada pela sequence', Number.isInteger(doc?.code), String(doc?.code));
  ok('  total = 70 + 30 - 10', doc?.totalAmount === 90, String(doc?.totalAmount));

  console.log('\n--- 2. a tela NAO decide o tipo ---');
  const mentira = await pedir('POST', '/api/purchases/documentos', {
    status: 'cotacao', type: 'order', supplierName: 'zz-fornecedor',
    items: [{ productId: prodId, quantity: 1, unitCost: 1 }]
  });
  lixo.documentos.push(mentira.json?.documento?.id);
  ok('mandar type=order com status=cotacao nao vira ordem', mentira.json?.documento?.type === 'quote',
    mentira.json?.documento?.type);

  console.log('\n--- 3. aprovar e mudar o status do MESMO registro ---');
  const virou = await pedir('POST', `/api/purchases/documentos/${encodeURIComponent(doc.id)}/status`, { status: 'ordem' });
  ok('a cotacao virou ordem', virou.json?.documento?.status === 'ordem', virou.texto.slice(0, 60));
  ok('  no mesmo id (nao houve copia)', virou.json?.documento?.id === doc.id);
  ok('  e o type acompanhou', virou.json?.documento?.type === 'order');
  ok('  cotacao nao movimenta estoque', (await total(prodId)) === 0, String(await total(prodId)));

  console.log('\n--- 4. receber: estoque, financeiro e status, de uma vez ---');
  const receb = await pedir('POST', `/api/purchases/documentos/${encodeURIComponent(doc.id)}/status`, { status: 'ordem-recebida' });
  ok('o recebimento foi aceito', receb.status === 200, receb.texto.slice(0, 70));
  ok('  entraram 10 no deposito da ordem', (await saldo(prodId, depId)) === 10, String(await saldo(prodId, depId)));
  ok('  e o total do produto acompanhou', (await total(prodId)) === 10, String(await total(prodId)));
  ok('  o documento ficou marcado como recebido', receb.json?.documento?.stockApplied === true);
  const { rows: mov } = await consultar(
    'select reference_type, reference_id from stock_movements where product_id = $1', [prodId]);
  ok('  o razao aponta de volta para a ordem', mov[0]?.reference_type === 'purchase-order' && mov[0]?.reference_id === doc.id,
    `${mov[0]?.reference_type}/${String(mov[0]?.reference_id).slice(0, 12)}`);
  const { rows: fin } = await consultar(
    "select amount::float a from financial_entries where reference_id = $1", [doc.id]);
  ok('  nasceu conta a pagar de 90', fin.length === 1 && fin[0].a === 90, String(fin[0]?.a));

  console.log('\n--- 5. receber duas vezes nao lanca duas vezes ---');
  await pedir('POST', `/api/purchases/documentos/${encodeURIComponent(doc.id)}/status`, { status: 'ordem-recebida' });
  ok('o estoque continua 10', (await total(prodId)) === 10, String(await total(prodId)));
  const { rows: fin2 } = await consultar("select count(*)::int n from financial_entries where reference_id = $1", [doc.id]);
  ok('  e a conta a pagar continua uma so', fin2[0].n === 1, String(fin2[0].n));

  console.log('\n--- 6. ordem recebida nao se edita nem se apaga ---');
  const edicao = await pedir('PUT', `/api/purchases/documentos/${encodeURIComponent(doc.id)}`, {
    status: 'ordem', supplierName: 'zz-fornecedor', items: [{ productId: prodId, quantity: 99, unitCost: 1 }]
  });
  ok('a edicao foi recusada', edicao.status >= 400, String(edicao.status));
  const exclusao = await pedir('DELETE', `/api/purchases/documentos/${encodeURIComponent(doc.id)}`);
  ok('  e a exclusao tambem', exclusao.status >= 400, String(exclusao.status));

  console.log('\n--- 7. cancelar estorna o que entrou ---');
  const cancel = await pedir('POST', `/api/purchases/documentos/${encodeURIComponent(doc.id)}/status`, { status: 'ordem-cancelada' });
  ok('o cancelamento foi aceito', cancel.status === 200, cancel.texto.slice(0, 60));
  ok('  o saldo voltou a zero', (await total(prodId)) === 0, String(await total(prodId)));
  ok('  o documento deixou de estar recebido', cancel.json?.documento?.stockApplied === false);
  const { rows: linhas } = await consultar('select count(*)::int n from stock_movements where product_id = $1', [prodId]);
  ok('  o estorno LANCOU o contrario (2 linhas), nao apagou', linhas[0].n === 2, String(linhas[0].n));

  console.log('\n--- 8. ordem ligada a uma Nota de Entrada NAO recebe sozinha ---');
  // A entrada em dobro e o risco do modulo: a mercadoria pode chegar pela ordem
  // OU pela nota, nunca pelas duas. Aqui a ligacao e feita direto no banco (o
  // caminho normal e a tela de Notas de Entrada, que precisa de um XML valido) e
  // o que se testa e a porta: com nota ligada, receber a ordem tem de recusar.
  const ligada = await pedir('POST', '/api/purchases/documentos', {
    status: 'ordem', supplierName: 'zz-fornecedor', depositId: depId,
    items: [{ productId: prodId, quantity: 5, unitCost: 2 }]
  });
  lixo.documentos.push(ligada.json?.documento?.id);
  await consultar('update purchase_orders set entrada_nfe_id = $1 where id = $2',
    ['ent-fingida', ligada.json.documento.id]);
  const antesDaTentativa = await total(prodId);
  const recusa = await pedir('POST', `/api/purchases/documentos/${encodeURIComponent(ligada.json.documento.id)}/status`, { status: 'ordem-recebida' });
  ok('receber foi recusado', recusa.status >= 400, String(recusa.status));
  ok('  e o erro diz por que', /Nota de Entrada/i.test(recusa.json?.error || ''), (recusa.json?.error || '').slice(0, 55));
  ok('  nada entrou no estoque', (await total(prodId)) === antesDaTentativa, String(await total(prodId)));

  console.log('\n--- 9. status inventado e recusado ---');
  const inventado = await pedir('POST', `/api/purchases/documentos/${encodeURIComponent(doc.id)}/status`, { status: 'ordem-teletransportada' });
  ok('recusado', inventado.status >= 400, String(inventado.status));
})()
  .catch((e) => { console.error(e); falhas++; })
  .finally(async () => {
    console.log('\n--- limpeza ---');
    for (const id of lixo.documentos.filter(Boolean)) {
      await consultar('delete from financial_entries where reference_id = $1', [id]);
      await consultar('delete from purchase_orders where id = $1', [id]);
    }
    if (lixo.produto) {
      await consultar('delete from stock_movements where product_id = $1', [lixo.produto]);
      await consultar('delete from products where id = $1', [lixo.produto]);
    }
    if (lixo.deposito) await consultar('delete from deposits where id = $1', [lixo.deposito]);
    console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
    await fecharPool();
    process.exit(falhas ? 1 : 0);
  });
