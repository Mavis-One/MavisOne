#!/usr/bin/env node
// A IMPORTACAO DE NF-e, PELO HTTP, contra o servidor de verdade (fase DK).
//
// NAO entra em `npm test`: sobe o server.js e escreve no banco. Roda a mao:
//
//   node scripts/prova-importacao-de-nfe.js
//
// POR QUE ELA EXISTE
// ------------------
// `scripts/test-documento-fiscal.js` confere que a rota DEVOLVE `recusadas`, e
// isso nao e a mesma pergunta que "a importacao funciona". Duas coisas so esta
// prova responde:
//
//   1. A LINHA RUIM NAO DERRUBA AS BOAS. A rota passou a recusar por linha, e
//      o jeito de saber e mandar uma planilha com as duas coisas e contar.
//
//   2. REIMPORTAR A MESMA PLANILHA E SEGURO. A trava de numeracao de
//      `fiscal_documentos` recusa a nota repetida, e a mensagem que a pessoa le
//      tem de dizer isso em portugues -- nao "duplicate key value violates
//      unique constraint idx_fiscal_documentos_numeracao".
//
// ESTA PROVA COMMITA: ela passa pelo HTTP, entao nao ha transacao para desfazer.
// Ela limpa antes e depois, pelo numero `HTTP-%`, e nunca encosta em documento
// que nao tenha criado.
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const { consultar } = require('../lib/db/conexao.js');

const RAIZ = path.join(__dirname, '..');

const PORTA = 3199;
const BASE = 'http://127.0.0.1:' + PORTA;

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function subirServidor() {
  const proc = spawn('node', [path.join(RAIZ, 'server.js')], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(PORTA) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    await esperar(250);
    try {
      const r = await fetch(BASE + '/login.html');
      if (r.status < 500) return { proc, log: () => log };
    } catch (_) { /* ainda subindo */ }
  }
  throw new Error('servidor nao subiu. log:\n' + log);
}

// A SESSAO VEM NO HEADER `x-auth-token`, E NAO EM COOKIE.
//
// A primeira versao desta prova guardava `set-cookie`: o login dava 200 e todas
// as chamadas seguintes davam 401. `sessaoDaRequisicao` le
// `req.headers['x-auth-token']`, e o token vem no CORPO da resposta do login.
let token = '';
async function chamar(caminho, opcoes = {}) {
  const r = await fetch(BASE + caminho, {
    ...opcoes,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-auth-token': token } : {}),
      ...(opcoes.headers || {})
    }
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = JSON.parse(texto); } catch (_) { corpo = texto.slice(0, 200); }
  return { status: r.status, corpo };
}

(async () => {
  // Limpa o que uma rodada anterior possa ter deixado: esta prova COMMITA (ela
  // passa pelo HTTP, entao nao ha transacao para desfazer).
  const limpar = async () => {
    await consultar("delete from fiscal_item_tributos where item_id in (select id from fiscal_documento_itens where documento_id in (select id from fiscal_documentos where numero like 'HTTP-%'))");
    await consultar("delete from fiscal_documento_itens where documento_id in (select id from fiscal_documentos where numero like 'HTTP-%')");
    await consultar("delete from fiscal_documentos where numero like 'HTTP-%'");
    await consultar("delete from fiscal_participantes where codigo like 'Cliente HTTP%'");
    await consultar("delete from import_logs where source = 'prova-http'").catch(() => {});
  };
  await limpar();

  const servidor = await subirServidor();
  try {
    console.log('--- login ---');
    let r = await chamar('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    check('entrou', r.status === 200, `${r.status}`);
    if (r.status !== 200) throw new Error('sem sessao: ' + JSON.stringify(r.corpo));
    token = (r.corpo && (r.corpo.token || r.corpo.authToken || (r.corpo.session && r.corpo.session.token))) || '';
    check('  e devolveu o token da sessao', !!token, token ? token.slice(0, 10) + '...' : JSON.stringify(r.corpo).slice(0, 120));

    console.log('\n--- importa 4 linhas: 2 boas, 1 sem numero, 1 com status invalido ---');
    const csv = [
      'number,customer,date,amount,status',
      'HTTP-1,Cliente HTTP A,2026-09-10,100.00,autorizada',
      'HTTP-2,Cliente HTTP B,2026-09-11,200.00,',
      ',Cliente HTTP C,2026-09-12,300.00,autorizada',
      'HTTP-4,Cliente HTTP D,2026-09-13,400.00,Em aberto'
    ].join('\n');
    r = await chamar('/api/sales/import', {
      method: 'POST',
      body: JSON.stringify({ type: 'nfe', source: 'prova-http', text: csv })
    });
    check('a rota respondeu 200 (nao abortou tudo)', r.status === 200, `${r.status}`);
    check('duas entraram', r.corpo && r.corpo.count === 2, r.corpo && String(r.corpo.count));
    check('duas foram recusadas', r.corpo && r.corpo.recusadasCount === 2, r.corpo && String(r.corpo.recusadasCount));
    const rec = (r.corpo && r.corpo.recusadas) || [];
    check('  a linha 3 e a sem numero', rec[0] && rec[0].linha === 3, rec[0] && String(rec[0].linha));
    check('  e o motivo fala de numero', rec[0] && /número de nota/.test(rec[0].motivo), rec[0] && rec[0].motivo.slice(0, 58));
    check('  a linha 4 e a do status invalido', rec[1] && rec[1].linha === 4, rec[1] && String(rec[1].linha));
    check('  e o motivo NOMEIA o catalogo aceito',
      rec[1] && /autorizada, cancelada, denegada, inutilizada/.test(rec[1].motivo),
      rec[1] && rec[1].motivo.slice(0, 74));

    console.log('\n--- e o banco guardou exatamente as duas ---');
    let q = await consultar("select numero, situacao, valor_total from fiscal_documentos where numero like 'HTTP-%' order by numero");
    check('duas linhas em fiscal_documentos', q.rows.length === 2, q.rows.map((x) => x.numero).join(', '));
    check('  HTTP-1 com situacao REGULAR', q.rows[0] && q.rows[0].situacao === 'REGULAR', q.rows[0] && q.rows[0].situacao);
    check('  e status vazio tambem virou REGULAR', q.rows[1] && q.rows[1].situacao === 'REGULAR', q.rows[1] && q.rows[1].situacao);
    check('  o valor veio da planilha', q.rows[0] && Number(q.rows[0].valor_total) === 100, q.rows[0] && String(q.rows[0].valor_total));
    q = await consultar("select count(*) n from fiscal_documentos where numero is null or btrim(numero) = ''");
    check('NENHUM documento com numero vazio ou inventado', Number(q.rows[0].n) === 0, String(q.rows[0].n));

    console.log('\n--- o historico de importacao conta o que ENTROU, e nao o tentado ---');
    r = await chamar('/api/sales/records?view=import_logs');
    const log = ((r.corpo && r.corpo.importLogs) || []).find((l) => l.source === 'prova-http');
    check('o log existe', !!log, log ? JSON.stringify(log) : 'nao achado');
    check('  e diz 2, nao 4', log && log.count === 2, log && String(log.count));

    console.log('\n--- reimportar a MESMA planilha e seguro ---');
    r = await chamar('/api/sales/import', {
      method: 'POST',
      body: JSON.stringify({ type: 'nfe', source: 'prova-http', text: csv })
    });
    check('nenhuma entrou de novo', r.corpo && r.corpo.count === 0, r.corpo && String(r.corpo.count));
    check('  as quatro foram recusadas', r.corpo && r.corpo.recusadasCount === 4, r.corpo && String(r.corpo.recusadasCount));
    const repetida = ((r.corpo && r.corpo.recusadas) || []).find((x) => /já está registrada/.test(x.motivo || ''));
    check('  e a repetida diz isso em portugues, nao em SQL',
      !!repetida && !/duplicate key|constraint/.test(repetida.motivo),
      repetida ? repetida.motivo.slice(0, 70) : 'nao achada');
    q = await consultar("select count(*) n from fiscal_documentos where numero like 'HTTP-%'");
    check('  e continuam sendo DUAS no banco', Number(q.rows[0].n) === 2, String(q.rows[0].n));

    console.log('\n--- a tela de NF-e Emitidas le as duas pelo contrato antigo ---');
    r = await chamar('/api/sales/records?view=nfes');
    const notas = ((r.corpo && r.corpo.nfes) || []).filter((n) => String(n.number).startsWith('HTTP-'));
    check('a rota devolve as duas', notas.length === 2, `${notas.length}`);
    check('  com `number`, `status`, `amount` e `customer`',
      notas[0] && notas[0].number && notas[0].status === 'autorizada'
      && typeof notas[0].amount === 'number' && notas[0].customer,
      notas[0] && `${notas[0].number} / ${notas[0].status} / ${notas[0].amount} / ${notas[0].customer}`);
    check('  e com `items` (vazio: planilha nao traz item)',
      notas[0] && Array.isArray(notas[0].items), notas[0] && JSON.stringify(notas[0].items));

    console.log('\n--- e a rota /api/sales/records tipo NF-e tambem exige o numero ---');
    r = await chamar('/api/sales/records', {
      method: 'POST',
      body: JSON.stringify({ type: 'nfe', customer: 'Cliente HTTP E', amount: 10 })
    });
    check('sem numero -> 400', r.status === 400, `${r.status}`);
    check('  com mensagem que diz o que fazer',
      r.corpo && /Informe o número da NF-e/.test(r.corpo.error || ''), r.corpo && (r.corpo.error || '').slice(0, 62));

    console.log('\n--- o log do servidor nao tem erro ---');
    const erros = (servidor.log().match(/^.*(Error|erro ao|ERRO).*$/gmi) || [])
      .filter((l) => !/Situacao fiscal desconhecida|numero de nota|número de nota/.test(l));
    check('nenhum erro inesperado no log', erros.length === 0, erros.slice(0, 2).join(' | ') || 'limpo');
  } catch (e) {
    console.error('\nERRO NA PROVA:', e.message);
    falhas++;
  } finally {
    servidor.proc.kill();
    await limpar();
    console.log('\n(os registros de prova foram removidos)');
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== A IMPORTACAO RECUSA O QUE NAO E NOTA =====');
  process.exit(falhas ? 1 : 0);
})();
