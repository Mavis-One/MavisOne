#!/usr/bin/env node
/**
 * VENDA À VISTA NASCE QUITADA (fase AU).
 *
 *   PORT=3999 npm start                  (num terminal)
 *   node scripts/test-venda-a-vista.js   (noutro)
 *
 * Fora do `npm test` pelo mesmo motivo dos outros e2e: precisa do servidor no
 * ar. Sem ele, avisa e sai SEM falhar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * O defeito mais caro que a auditoria do ERP anterior encontrou, e que o
 * MavisONE tinha igual: `status: 'pending'` fixo no código, para toda venda.
 * A venda paga em dinheiro, no balcão, nascia como conta a receber em aberto.
 * No outro sistema isso deu R$ 140.375,77 "a receber" e R$ 0,00 "realizado" em
 * dois dias, com todo cliente que comprou listado como inadimplente.
 *
 * Nada disso dá erro em tela nenhuma — por isso o teste existe:
 *
 * 1. DINHEIRO/PIX/DÉBITO NASCEM QUITADOS, e com a BAIXA registrada. Só virar o
 *    status não bastaria: sem a linha em financial_payments o painel continua
 *    somando R$ 0,00 em "realizado", e o problema muda de lugar em vez de sair.
 *
 * 2. CARTÃO DE CRÉDITO NÃO NASCE VENCIDO. O cliente já pagou; quem deve é a
 *    credenciadora. O vencimento sai do `daysToReceive` da forma, não da data
 *    da venda — era isso que fazia a parcela nascer vencida no mesmo dia.
 *
 * 3. CANCELAR DESFAZ A BAIXA AUTOMÁTICA, E SÓ ELA. A baixa que uma pessoa
 *    registrou é fato humano e não some sozinha; a que o faturamento criou é
 *    parte do faturamento. Confundir as duas apaga dinheiro de verdade ou
 *    deixa dinheiro de pedido cancelado.
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
        resolve({ status: res.statusCode, json, texto: b.slice(0, 200) });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, texto: 'sem conexao' }));
    if (dados) req.write(dados);
    req.end();
  });
}

const lixo = { produto: null, deposito: null, pessoa: null, formas: [], pedidos: [] };

const lancamentosDo = async (pedidoId) => (await consultar(
  `select e.id, e.status, e.due_date, e.amount::float as amount,
          (select count(*)::int from financial_payments p where p.entry_id = e.id) as baixas,
          (select count(*)::int from financial_payments p where p.entry_id = e.id and p.origem = 'automatica') as automaticas
     from financial_entries e where e.reference_id = $1 order by e.created_at`, [pedidoId])).rows;

/**
 * Fatura o pedido COM DISPENSA REGISTRADA.
 *
 * Desde a fase AV, faturar exige documento fiscal — e esta e' a saida prevista
 * para a venda cuja nota sai depois. O que este teste mede e' o lado
 * FINANCEIRO (a venda a vista nascer quitada), nao o fiscal: emitir uma NF-e de
 * verdade aqui exigiria estabelecimento, certificado e SEFAZ, e faria um teste
 * de financeiro depender de tres coisas que nao sao dele.
 *
 * A dispensa nao enfraquece o que se mede: quitar ou nao quitar depende da
 * forma de pagamento, e nao de haver nota.
 */
async function faturar(pedidoId) {
  const cheio = (await pedir('GET', `/api/sales/records/${encodeURIComponent(pedidoId)}`)).json.record;
  return pedir('PUT', `/api/sales/records/${encodeURIComponent(pedidoId)}`, {
    ...cheio,
    status: 'pedido-faturado',
    dispensaDocumentoFiscal: true,
    dispensaMotivo: 'Cenario de teste do financeiro; nao emite documento fiscal.'
  });
}

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

  console.log('\n--- 0. o cenario ---');
  const carimbo = Date.now();
  const dinheiro = await pedir('POST', '/api/cadastros/payment-methods', {
    name: `zz Dinheiro ${carimbo}`, type: 'dinheiro', daysToReceive: 0
  });
  const cartao = await pedir('POST', '/api/cadastros/payment-methods', {
    name: `zz Cartao ${carimbo}`, type: 'cartao-credito', daysToReceive: 30
  });
  const idDinheiro = dinheiro.json?.paymentMethod?.id;
  const idCartao = cartao.json?.paymentMethod?.id;
  lixo.formas.push(idDinheiro, idCartao);
  ok('duas formas de pagamento criadas', Boolean(idDinheiro && idCartao), dinheiro.texto.slice(0, 60));
  if (!idDinheiro || !idCartao) throw new Error('sem formas de pagamento nao da para testar');

  const dep = await pedir('POST', '/api/cadastros/deposits', { name: `zz-vista-dep-${carimbo}` });
  lixo.deposito = dep.json?.deposit?.id;
  // CPF DERIVADO DO CARIMBO, e nao fixo: o cadastro recusa CPF repetido (e faz
  // bem), entao um numero fixo funciona na primeira execucao e falha em todas as
  // seguintes — o tipo de teste que so passa uma vez.
  const digitoCpf = (base) => {
    let soma = 0;
    let fator = base.length + 1;
    for (const c of base) { soma += Number(c) * fator; fator -= 1; }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const base9 = String(carimbo).slice(-9);
  const d1 = digitoCpf(base9);
  const cpfTeste = `${base9}${d1}${digitoCpf(`${base9}${d1}`)}`;
  const pes = await pedir('POST', '/api/cadastros/pessoas', {
    name: `zz-vista-cliente-${carimbo}`, document: cpfTeste, roles: ['Cliente'],
    // Endereco e obrigatorio no cadastro de pessoas (e faz sentido: sem ele nao
    // se emite nota). O teste preenche o minimo que a validacao pede.
    street: 'Rua de Teste', number: '1', district: 'Centro',
    city: 'Florianópolis', state: 'SC', zipCode: '88010000'
  });
  lixo.pessoa = pes.json?.person?.id || pes.json?.record?.id;
  const prod = await pedir('POST', '/api/stock/products', {
    name: `zz-vista-prod-${carimbo}`, sku: `ZZV${carimbo}`, salePrice: 100
  });
  lixo.produto = prod.json?.product?.id;
  await pedir('POST', '/api/stock/movements', {
    productId: lixo.produto, depositId: lixo.deposito, type: 'entrada', quantity: 50, unitCost: 50
  });
  ok('cliente, deposito e produto com saldo', Boolean(lixo.deposito && lixo.pessoa && lixo.produto),
    lixo.pessoa ? undefined : `pessoa: ${pes.texto.slice(0, 90)}`);
  if (!lixo.pessoa || !lixo.deposito || !lixo.produto) throw new Error('cenario incompleto');

  const novoPedido = async (formaId, formaNome) => {
    const r = await pedir('POST', '/api/sales/records', {
      status: 'pedido', clientSupplierId: lixo.pessoa, depositId: lixo.deposito,
      date: '2026-09-03',
      items: [{ productId: lixo.produto, name: 'zz', quantity: 1, unitPrice: 100 }],
      payments: [{ methodId: formaId, methodName: formaNome, amount: 100 }]
    });
    lixo.pedidos.push(r.json?.record?.id);
    return r.json.record;
  };

  console.log('\n--- 1. venda em DINHEIRO nasce quitada, com a baixa ---');
  const pedidoVista = await novoPedido(idDinheiro, 'Dinheiro');
  await faturar(pedidoVista.id);
  const [vista] = await lancamentosDo(pedidoVista.id);
  ok('o lancamento nasceu quitado', vista?.status === 'paid', vista?.status);
  ok('  e a BAIXA foi registrada', vista?.baixas === 1, `${vista?.baixas} baixa(s)`);
  ok('  marcada como automatica', vista?.automaticas === 1);
  // Sem a baixa o painel continua somando zero em "realizado" — era metade do defeito.
  const realizado = (await consultar(
    'select coalesce(sum(amount),0)::float s from financial_payments where entry_id = $1', [vista.id])).rows[0].s;
  ok('  o realizado deixou de ser zero', realizado === 100, `R$ ${realizado}`);

  console.log('\n--- 2. CARTAO nao nasce vencido: o prazo vem do cadastro ---');
  const pedidoCartao = await novoPedido(idCartao, 'Cartao');
  await faturar(pedidoCartao.id);
  const [nocartao] = await lancamentosDo(pedidoCartao.id);
  ok('continua em aberto (quem deve e a credenciadora)', nocartao?.status === 'pending', nocartao?.status);
  ok('  e vence 30 dias depois da venda, nao no dia',
    String(nocartao?.due_date).slice(0, 10) === '2026-10-03', String(nocartao?.due_date).slice(0, 10));
  ok('  sem baixa', nocartao?.baixas === 0);

  console.log('\n--- 3. cancelar desfaz a baixa AUTOMATICA ---');
  const cheio = (await pedir('GET', `/api/sales/records/${encodeURIComponent(pedidoVista.id)}`)).json.record;
  await pedir('PUT', `/api/sales/records/${encodeURIComponent(pedidoVista.id)}`, { ...cheio, status: 'pedido-cancelado' });
  const [depois] = await lancamentosDo(pedidoVista.id);
  ok('o lancamento foi cancelado', depois?.status === 'cancelado', depois?.status);
  ok('  e a baixa automatica sumiu junto', depois?.baixas === 0, `${depois?.baixas} baixa(s)`);

  console.log('\n--- 4. baixa de GENTE nao some sozinha ---');
  const pedidoManual = await novoPedido(idCartao, 'Cartao');
  await faturar(pedidoManual.id);
  const [aberto] = await lancamentosDo(pedidoManual.id);
  const baixa = await pedir('POST', `/api/finance/entries/${encodeURIComponent(aberto.id)}/payments`, {
    amount: 100, date: '2026-09-03'
  });
  ok('uma pessoa deu baixa', baixa.status === 200, baixa.texto.slice(0, 60));
  const cheio2 = (await pedir('GET', `/api/sales/records/${encodeURIComponent(pedidoManual.id)}`)).json.record;
  await pedir('PUT', `/api/sales/records/${encodeURIComponent(pedidoManual.id)}`, { ...cheio2, status: 'pedido-cancelado' });
  const [preservado] = await lancamentosDo(pedidoManual.id);
  ok('cancelar o pedido NAO apagou a baixa dela', preservado?.baixas === 1, `${preservado?.baixas} baixa(s)`);
  ok('  e o lancamento nao foi cancelado em silencio', preservado?.status !== 'cancelado', preservado?.status);
})()
  .catch((e) => { console.error(e); falhas++; })
  .finally(async () => {
    console.log('\n--- limpeza ---');
    for (const id of lixo.pedidos.filter(Boolean)) {
      await consultar('delete from financial_payments where entry_id in (select id from financial_entries where reference_id = $1)', [id]);
      await consultar('delete from financial_entries where reference_id = $1', [id]);
      await consultar('delete from orders where id = $1', [id]);
    }
    if (lixo.produto) {
      await consultar('delete from stock_movements where product_id = $1', [lixo.produto]);
      await consultar('delete from products where id = $1', [lixo.produto]);
    }
    if (lixo.deposito) await consultar('delete from deposits where id = $1', [lixo.deposito]);
    if (lixo.pessoa) await consultar('delete from people where id = $1', [lixo.pessoa]);
    ok('cenario removido', true);
    console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
    await fecharPool();
    process.exit(falhas ? 1 : 0);
  });
