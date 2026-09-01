#!/usr/bin/env node
/**
 * TRANSFERÊNCIA COM VÁRIOS ITENS — contra o servidor de verdade.
 *
 *   npm start  (num terminal, na porta 3999)     npm run transferencia  (noutro)
 *
 * Fora do `npm test` pelo mesmo motivo dos outros e2e: precisa do servidor no ar
 * e de SENHA_TESTE no .env. Sem isso ele avisa e sai SEM falhar, em vez de
 * adivinhar credencial.
 *
 * O QUE ESTE TESTE PROTEGE, E POR QUE PRECISA SER CONTRA O SERVIDOR
 * ----------------------------------------------------------------
 * A tela passou a mandar uma LISTA de produtos numa requisição só. Duas coisas
 * podem dar errado aí, e as duas corrompem estoque em silêncio:
 *
 * 1. O MESMO PRODUTO EM DUAS LINHAS. Se cada linha for conferida contra o saldo
 *    inteiro da origem, duas linhas de 3 passam com 5 em estoque e o depósito
 *    termina com -1. Nenhuma tela mostra erro: o número simplesmente fica
 *    errado, e só aparece na contagem física, meses depois.
 *
 * 2. METADE DA MOVIMENTAÇÃO. Gravar item a item deixaria os quatro primeiros
 *    produtos fora da origem quando o quinto não tivesse saldo — com uma
 *    mensagem de erro que não diz o que ficou feito.
 *
 * Nada disto aparece em teste de fonte: é o comportamento do conjunto
 * validação + gravação, com o saldo real do banco no meio.
 *
 * O teste cria um depósito `zz-teste-...`, transfere para ele e DESFAZ tudo no
 * fim — inclusive quando falha.
 */
require('dotenv').config();
const http = require('http');

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
        // O servidor lê a sessão de x-auth-token, não de Authorization: Bearer.
        ...(token ? { 'x-auth-token': token } : {}),
        ...(dados ? { 'Content-Length': Buffer.byteLength(dados) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch (_) { /* resposta não-JSON */ }
        resolve({ status: res.statusCode, json, texto: b.slice(0, 160) });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, texto: 'sem conexão' }));
    if (dados) req.write(dados);
    req.end();
  });
}

const paraLimpar = { transferencias: [], movimentos: [], depositos: [] };

// A ordem importa: transferência estornada devolve o saldo ao depósito de
// origem, o movimento de entrada só sai depois disso, e depósito com saldo não
// pode ser apagado. Limpar na ordem errada deixa lixo e faz o teste seguinte
// começar sujo.
async function limpar() {
  for (const id of paraLimpar.transferencias) {
    await pedir('DELETE', `/api/stock/transfers/${encodeURIComponent(id)}`);
  }
  for (const id of paraLimpar.movimentos) {
    await pedir('DELETE', `/api/stock/movements/${encodeURIComponent(id)}`);
  }
  for (const id of paraLimpar.depositos) {
    await pedir('DELETE', `/api/cadastros/deposits/${encodeURIComponent(id)}`);
  }
}

(async () => {
  const usuario = process.env.USUARIO_TESTE || 'admin';
  const senha = process.env.SENHA_TESTE || '';
  if (!senha) {
    console.log('  (defina SENHA_TESTE no .env para rodar este teste — saindo sem falhar)');
    process.exit(0);
  }

  console.log('--- 0. login ---');
  const login = await pedir('POST', '/api/login', { username: usuario, password: senha });
  if (login.status !== 200) {
    console.log(`  (login recusou: ${login.status} — o servidor está de pé na porta ${PORTA}?)`);
    process.exit(0);
  }
  token = login.json.token;
  check('autenticado', Boolean(token));

  console.log('\n--- 1. o cenário, montado por este teste ---');
  const meta = await pedir('GET', '/api/stock/meta');
  const produto = (meta.json?.products || [])[0];
  if (!produto) {
    console.log('  (nenhum produto cadastrado para exercitar — saindo sem falhar)');
    process.exit(0);
  }

  // Depósitos próprios em vez dos que existirem: assim o teste não depende de
  // haver dois cadastrados, e o saldo que ele confere é só o que ele mesmo pôs.
  const carimbo = Date.now();
  const depA = await pedir('POST', '/api/cadastros/deposits', { name: `zz-teste-origem-${carimbo}` });
  const depB = await pedir('POST', '/api/cadastros/deposits', { name: `zz-teste-destino-${carimbo}` });
  const origemId = depA.json?.deposit?.id || depA.json?.record?.id || depA.json?.id;
  const destinoId = depB.json?.deposit?.id || depB.json?.record?.id || depB.json?.id;
  check('depósitos de teste criados', Boolean(origemId && destinoId), `${origemId} -> ${destinoId}`);
  if (!origemId || !destinoId) {
    console.log('  resposta da criação:', depA.texto);
    await limpar();
    process.exit(1);
  }
  paraLimpar.depositos.push(origemId, destinoId);

  const entrada = await pedir('POST', '/api/stock/movements', {
    productId: produto.id, depositId: origemId, type: 'entrada', quantity: 10, note: 'zz-teste-transferencia'
  });
  const movimentoId = entrada.json?.movement?.id || entrada.json?.record?.id || entrada.json?.id;
  check('entrada de 10 unidades na origem', entrada.status === 200 && Boolean(movimentoId), entrada.texto);
  if (movimentoId) paraLimpar.movimentos.push(movimentoId);

  const origem = { id: origemId };
  const antes = await pedir('GET', `/api/stock/products/${produto.id}`);
  const saldoAntes = (antes.json?.product?.balances || []).find((b) => b.depositId === origem.id)?.quantity ?? 0;
  check('a origem começa com 10', Number(saldoAntes) === 10, String(saldoAntes));

  console.log('\n--- 2. o mesmo produto em duas linhas SOMA ---');
  const soma = await pedir('POST', '/api/stock/transfers', {
    originDepositId: origem.id, destinationDepositId: destinoId,
    items: [{ productId: produto.id, quantity: 2 }, { productId: produto.id, quantity: 3 }]
  });
  check('a movimentação foi aceita', soma.status === 200, soma.texto);
  (soma.json?.transfers || []).forEach((t) => paraLimpar.transferencias.push(t.id));
  check('  virou UM registro, não dois', (soma.json?.transfers || []).length === 1);
  check('  com a quantidade somada (2 + 3 = 5)', Number(soma.json?.transfers?.[0]?.quantity) === 5,
    String(soma.json?.transfers?.[0]?.quantity));

  const depois = await pedir('GET', `/api/stock/products/${produto.id}`);
  const saldoDestino = (depois.json?.product?.balances || []).find((b) => b.depositId === destinoId)?.quantity ?? 0;
  const saldoOrigem = (depois.json?.product?.balances || []).find((b) => b.depositId === origem.id)?.quantity ?? 0;
  check('o destino recebeu 5', Number(saldoDestino) === 5, String(saldoDestino));
  check('a origem perdeu 5', Number(saldoOrigem) === Number(saldoAntes) - 5, `${saldoAntes} -> ${saldoOrigem}`);

  console.log('\n--- 3. um item impossível não deixa passar os outros ---');
  const quantasAntes = (await pedir('GET', '/api/stock/transfers')).json?.transfers?.length ?? 0;
  const parcial = await pedir('POST', '/api/stock/transfers', {
    originDepositId: origem.id, destinationDepositId: destinoId,
    items: [
      { productId: produto.id, quantity: 1 },
      // Quantidade que não existe em depósito nenhum: é o item que tem de
      // derrubar a movimentação INTEIRA.
      { productId: produto.id, quantity: 999999999 }
    ]
  });
  check('a movimentação foi recusada', parcial.status >= 400, `${parcial.status} ${parcial.texto}`);
  const quantasDepois = (await pedir('GET', '/api/stock/transfers')).json?.transfers?.length ?? 0;
  check('  e NADA foi gravado — nem o item que cabia', quantasDepois === quantasAntes,
    `${quantasAntes} -> ${quantasDepois}`);
  const conferindo = await pedir('GET', `/api/stock/products/${produto.id}`);
  const saldoFinal = (conferindo.json?.product?.balances || []).find((b) => b.depositId === origem.id)?.quantity ?? 0;
  check('  e o saldo da origem não se mexeu', Number(saldoFinal) === Number(saldoOrigem),
    `${saldoOrigem} -> ${saldoFinal}`);

  console.log('\n--- 4. o formato antigo (um produto solto) continua valendo ---');
  const antigo = await pedir('POST', '/api/stock/transfers', {
    originDepositId: origem.id, destinationDepositId: destinoId,
    productId: produto.id, quantity: 1
  });
  check('aceito', antigo.status === 200, antigo.texto);
  if (antigo.json?.transfer?.id) paraLimpar.transferencias.push(antigo.json.transfer.id);
  check('  e devolve `transfer` no singular, como antes', Boolean(antigo.json?.transfer?.id));
})()
  .catch((erro) => { console.error(erro); falhas++; })
  .finally(async () => {
    console.log('\n--- limpeza ---');
    await limpar();
    const sobrou = (await pedir('GET', '/api/stock/transfers')).json?.transfers || [];
    check('as transferências de teste foram estornadas',
      !sobrou.some((t) => paraLimpar.transferencias.includes(t.id)));
    console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
    process.exit(falhas ? 1 : 0);
  });
