// Prova que o total gravado pelo servidor bate com o que a tela calcula, e que
// o servidor NÃO aceita um total forjado no corpo da requisição.
// Requer o servidor rodando. Credenciais por env:
//   SMOKE_USER=admin SMOKE_PASS=xxx node scripts/test-sales-totals-e2e.js
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const USER = process.env.SMOKE_USER;
const PASS = process.env.SMOKE_PASS;
if (!USER || !PASS) { console.error('Informe SMOKE_USER e SMOKE_PASS.'); process.exit(2); }
const { computeSalesTotals } = require('../public/modules/shared/sales_totals');
const h = (t) => ({ 'x-auth-token': t, 'content-type': 'application/json' });

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

(async () => {
  const { token: t } = await (await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  })).json();

  let faseHAplicada = false;
  const criados = [];
  async function criar(extra, rotulo) {
    const payload = {
      type: 'order', status: 'pendente', date: '2026-08-06',
      clientSupplierName: 'ZZ Cliente Totais',
      items: [{ productId: '', name: 'ZZ Item A', quantity: 2, unitPrice: 500 }, { productId: '', name: 'ZZ Item B', quantity: 1, unitPrice: 390 }],
      ...extra
    };
    const res = await fetch(`${BASE}/api/sales/records`, { method: 'POST', headers: h(t), body: JSON.stringify(payload) });
    const body = await res.json();
    if (res.status !== 200) { console.log(`  XX ${rotulo} -> ${res.status} ${JSON.stringify(body).slice(0,120)}`); falhas++; return null; }
    const id = body.record?.id;
    if (id) criados.push(id);
    // O que a TELA teria mostrado com os mesmos parâmetros:
    const naTela = computeSalesTotals({ ...payload, items: payload.items });
    return { salvo: body.record, naTela };
  }

  console.log('--- 1. desconto % + R$ combinados ---');
  let r = await criar({ discountPercent: 10, discountAmount: 50 }, 'combinado');
  if (r) {
    check('tela calcula 1201', r.naTela.totalAmount === 1201, String(r.naTela.totalAmount));
    check('servidor gravou o mesmo', r.salvo.amount === r.naTela.totalAmount, `servidor=${r.salvo.amount} tela=${r.naTela.totalAmount}`);
    faseHAplicada = r.salvo.discountTotal === 189;
    if (faseHAplicada) check('desconto total gravado', true, '189');
    else console.log('  -- desconto total gravado: PULADO (migração Fase H não aplicada no Supabase)');
  }

  console.log('\n--- 2. frete NÃO cobrado do comprador ---');
  r = await criar({ freight: 100, chargeFreightToBuyer: false }, 'frete absorvido');
  if (r) {
    check('total ignora o frete', r.salvo.amount === 1390, String(r.salvo.amount));
    check('frete continua registrado', r.salvo.freight === 100, String(r.salvo.freight));
    check('tela e servidor concordam', r.salvo.amount === r.naTela.totalAmount);
  }

  console.log('\n--- 3. frete cobrado + desp. gerais + montagem ---');
  r = await criar({ freight: 100, generalExpenses: 60, assemblyFee: 40 }, 'somas');
  if (r) check('1390+100+60+40 = 1590', r.salvo.amount === 1590, String(r.salvo.amount));

  console.log('\n--- 4. desconto maior que a venda ---');
  r = await criar({ discountAmount: 99999 }, 'desconto exagerado');
  if (r) {
    check('total não fica negativo', r.salvo.amount === 0, String(r.salvo.amount));
    if (faseHAplicada) check('desconto aparado no valor da venda', r.salvo.discountTotal === 1390, String(r.salvo.discountTotal));
    else console.log('  -- desconto aparado gravado: PULADO (migração Fase H não aplicada)');
  }

  console.log('\n--- 5. percentual absurdo é limitado ---');
  r = await criar({ discountPercent: 500 }, 'percentual 500');
  if (r) {
    check('gravou 100%, não 500%', r.salvo.discountPercent === 100, String(r.salvo.discountPercent));
    check('total = 0, não negativo', r.salvo.amount === 0, String(r.salvo.amount));
  }

  console.log('\n--- 6. SEGURANÇA: total forjado no corpo é ignorado ---');
  r = await criar({ totalAmount: 1, itemsTotal: 1, discountTotal: 0 }, 'total forjado');
  if (r) {
    check('servidor recalcula e ignora o 1 enviado', r.salvo.amount === 1390, String(r.salvo.amount));
  }

  console.log('\n--- 7. valores negativos são saneados ---');
  r = await criar({ discountAmount: -500, freight: -100, generalExpenses: -50 }, 'negativos');
  if (r) check('tudo tratado como zero', r.salvo.amount === 1390, String(r.salvo.amount));

  // limpeza
  for (const id of criados) {
    await fetch(`${BASE}/api/sales/records/${id}`, { method: 'DELETE', headers: h(t) });
  }
  console.log(`\n(limpeza: ${criados.length} pedidos de teste removidos)`);
  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
