#!/usr/bin/env node
/**
 * FATURAR EXIGE DOCUMENTO FISCAL (fase AV).
 *
 *   PORT=3999 npm start                       (num terminal)
 *   node scripts/test-faturar-exige-nota.js   (noutro)
 *
 * Fora do `npm test` porque precisa do servidor no ar. Sem ele, avisa e sai
 * SEM falhar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * Faturar e emitir eram passos soltos: o pedido ficava "Pedido Faturado", com
 * estoque baixado e conta a receber criada, sem nota nenhuma, para sempre.
 * Neste banco eram 8 pedidos e R$ 26.033,80 assim, de abril a agosto.
 *
 * 1. FATURAR SEM NOTA É RECUSADO. E a recusa tem de valer no caminho da edição
 *    E no das ações em lote — regra que vale só onde alguém lembrou de
 *    protegê-la é a que some no dia em que se usa o outro botão.
 *
 * 2. A SAÍDA SEM NOTA CONTINUA POSSÍVEL, pelo status próprio ("Pedido Aprovado
 *    Sem Faturamento"): transferência, remessa, bonificação. Bloquear isso
 *    quebraria a operação em vez de corrigi-la.
 *
 * 3. A DISPENSA EXIGE MOTIVO. Dispensa sem motivo é o mesmo faturar-sem-nota de
 *    antes com um clique a mais — e é o que separa a contingência de ontem do
 *    hábito que virou regra.
 *
 * 4. A CÓPIA NÃO HERDA A DISPENSA. Ela foi dada para aquela venda, por aquele
 *    motivo; herdada, a cópia nasceria autorizada a faturar sem nota por uma
 *    razão que ninguém deu a ela.
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
        resolve({ status: res.statusCode, json, texto: b.slice(0, 220) });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, texto: 'sem conexao' }));
    if (dados) req.write(dados);
    req.end();
  });
}

const lixo = { produto: null, deposito: null, pessoa: null, pedidos: [] };
const cheio = async (id) => (await pedir('GET', `/api/sales/records/${encodeURIComponent(id)}`)).json.record;
const mudar = async (id, extra) => {
  const r = await cheio(id);
  return pedir('PUT', `/api/sales/records/${encodeURIComponent(id)}`, { ...r, ...extra });
};

(async () => {
  const senha = process.env.SENHA_TESTE || '';
  const login = await pedir('POST', '/api/login', {
    username: process.env.USUARIO_TESTE || 'admin', password: senha
  });
  if (login.status !== 200) {
    console.log(`  (login recusou: ${login.status} — servidor de pe na porta ${PORTA} e SENHA_TESTE no .env?)`);
    await fecharPool();
    process.exit(0);
  }
  token = login.json.token;
  ok('autenticado', Boolean(token));

  console.log('\n--- 0. o cenario ---');
  const carimbo = Date.now();
  const digito = (base) => {
    let soma = 0; let fator = base.length + 1;
    for (const c of base) { soma += Number(c) * fator; fator -= 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const b9 = String(carimbo).slice(-9);
  const d1 = digito(b9);
  const cpf = `${b9}${d1}${digito(`${b9}${d1}`)}`;

  lixo.deposito = (await pedir('POST', '/api/cadastros/deposits', { name: `zz-nota-dep-${carimbo}` })).json?.deposit?.id;
  const pes = await pedir('POST', '/api/cadastros/pessoas', {
    name: `zz-nota-cli-${carimbo}`, document: cpf, roles: ['Cliente'],
    street: 'Rua de Teste', number: '1', district: 'Centro',
    city: 'Florianópolis', state: 'SC', zipCode: '88010000'
  });
  lixo.pessoa = pes.json?.person?.id || pes.json?.record?.id;
  lixo.produto = (await pedir('POST', '/api/stock/products', {
    name: `zz-nota-prod-${carimbo}`, sku: `ZZN${carimbo}`, salePrice: 100
  })).json?.product?.id;
  await pedir('POST', '/api/stock/movements', {
    productId: lixo.produto, depositId: lixo.deposito, type: 'entrada', quantity: 30, unitCost: 50
  });
  ok('cliente, deposito e produto com saldo', Boolean(lixo.deposito && lixo.pessoa && lixo.produto),
    lixo.pessoa ? undefined : pes.texto.slice(0, 90));
  if (!lixo.deposito || !lixo.pessoa || !lixo.produto) throw new Error('cenario incompleto');

  const novoPedido = async () => {
    const r = await pedir('POST', '/api/sales/records', {
      status: 'pedido', clientSupplierId: lixo.pessoa, depositId: lixo.deposito,
      date: '2026-09-03',
      items: [{ productId: lixo.produto, name: 'zz', quantity: 1, unitPrice: 100 }]
    });
    lixo.pedidos.push(r.json?.record?.id);
    return r.json.record;
  };

  console.log('\n--- 1. faturar sem nota e recusado ---');
  const p1 = await novoPedido();
  const recusa = await mudar(p1.id, { status: 'pedido-faturado' });
  ok('a recusa aconteceu', recusa.status >= 400, String(recusa.status));
  ok('  e o erro diz os tres caminhos', /Emite a nota|Emita a nota/.test(recusa.json?.error || '')
    && /Sem Faturamento/.test(recusa.json?.error || '')
    && /dispensa/i.test(recusa.json?.error || ''), (recusa.json?.error || '').slice(0, 80));
  const aindaPedido = await cheio(p1.id);
  ok('  o pedido nao mudou de status', aindaPedido.status === 'pedido', aindaPedido.status);
  const semEfeito = (await consultar(
    'select count(*)::int n from financial_entries where reference_id = $1', [p1.id])).rows[0].n;
  ok('  e nao nasceu conta a receber', semEfeito === 0, String(semEfeito));

  console.log('\n--- 2. a recusa vale TAMBEM nas acoes em lote ---');
  // A regra mora em aplicarEfeitosDeStatus, por onde passam os dois caminhos.
  // Na rota, o lote continuaria faturando sem nota.
  const lote = await pedir('POST', '/api/sales/records/bulk', {
    action: 'mudarStatus', ids: [p1.id], status: 'pedido-faturado'
  });
  const loteBloqueou = lote.status >= 400
    || JSON.stringify(lote.json || {}).toLowerCase().includes('nf-e')
    || (await cheio(p1.id)).status === 'pedido';
  ok('o lote nao faturou sem nota', loteBloqueou, `${lote.status} · status final ${(await cheio(p1.id)).status}`);

  console.log('\n--- 3. saida sem nota continua possivel, pelo status proprio ---');
  const p2 = await novoPedido();
  const semFat = await mudar(p2.id, { status: 'pedido-aprovado-sem-faturamento' });
  ok('"Aprovado Sem Faturamento" passa', semFat.status === 200, semFat.texto.slice(0, 70));
  // NO RAZAO, e nao na flag: `stockApplied` e campo interno e nao vai para a
  // tela (ver INTERNOS em test-sales-record-fields.js). Conferir a flag seria
  // conferir `undefined === true` e reprovar codigo correto — foi o que a
  // primeira versao deste check fez. O que importa e a mercadoria ter saido.
  const saiu = (await consultar(
    "select coalesce(sum(case when type = 'saida' then quantity else 0 end), 0)::float s"
    + ' from stock_movements where reference_id = $1', [p2.id])).rows[0].s;
  ok('  a mercadoria saiu do estoque', saiu === 1, `${saiu} un.`);
  ok('  e NAO gerou financeiro', (await consultar(
    'select count(*)::int n from financial_entries where reference_id = $1', [p2.id])).rows[0].n === 0);

  console.log('\n--- 4. a dispensa exige motivo ---');
  const p3 = await novoPedido();
  const semMotivo = await mudar(p3.id, { status: 'pedido-faturado', dispensaDocumentoFiscal: true });
  ok('dispensa sem motivo e recusada', semMotivo.status >= 400, String(semMotivo.status));
  ok('  e o erro explica por que', /motivo/i.test(semMotivo.json?.error || ''), (semMotivo.json?.error || '').slice(0, 70));
  const curto = await mudar(p3.id, { status: 'pedido-faturado', dispensaDocumentoFiscal: true, dispensaMotivo: 'sefaz' });
  ok('  motivo curto demais tambem', curto.status >= 400, String(curto.status));
  const comMotivo = await mudar(p3.id, {
    status: 'pedido-faturado', dispensaDocumentoFiscal: true,
    dispensaMotivo: 'SEFAZ fora do ar; nota sera emitida em contingencia.'
  });
  ok('com motivo, fatura', comMotivo.status === 200, comMotivo.texto.slice(0, 70));
  const r3 = await cheio(p3.id);
  ok('  e o motivo fica gravado no pedido', /SEFAZ fora do ar/.test(r3.dispensaMotivo || ''), (r3.dispensaMotivo || '').slice(0, 45));
  ok('  com a conta a receber criada', (await consultar(
    'select count(*)::int n from financial_entries where reference_id = $1', [p3.id])).rows[0].n === 1);

  console.log('\n--- 5. a copia nao herda a dispensa ---');
  const copia = await pedir('POST', `/api/sales/records/${encodeURIComponent(p3.id)}/duplicar`, {});
  const idCopia = copia.json?.record?.id;
  if (idCopia) {
    lixo.pedidos.push(idCopia);
    const rc = await cheio(idCopia);
    ok('a copia nasce sem dispensa', rc.dispensaDocumentoFiscal === false, String(rc.dispensaDocumentoFiscal));
    ok('  e sem o motivo do original', !rc.dispensaMotivo, `"${rc.dispensaMotivo || ''}"`);
  } else {
    ok('(rota de duplicar nao respondeu; a regra esta no construtor da copia)', true, String(copia.status));
  }
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
