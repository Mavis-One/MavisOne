#!/usr/bin/env node
// RESPOSTA GRANDE QUE NÃO MUDOU NÃO VIAJA DE NOVO — e nunca sai velha.
//
// O sendJson (server.js) passou a mandar ETag (sha1 do JSON) e
// `Cache-Control: private, no-cache` nos GET 200 a partir de 16 KB, e a
// responder 304 sem corpo quando o If-None-Match do navegador bate. Onze telas
// devolvem os mesmos bytes de uma abertura para a outra (Gestor de Preços 10 MB,
// Pessoas 7,4 MB, metas de Vendas e Financeiro...), e eram retransmitidas e
// recomprimidas inteiras a cada vez. (O parse no navegador continua: no 304 o
// fetch entrega o corpo guardado e o response.json() o lê de novo.)
//
// Cada check abaixo guarda um modo de falha que não aparece na tela:
//   - 304 para corpo DIFERENTE seria dado velho (o navegador mostraria o
//     guardado) — o ETag tem de ser do corpo calculado agora;
//   - ETag em POST ou em erro faria o navegador guardar o que não é recurso;
//   - `public` ou sem `no-cache` deixaria proxy ou navegador usarem a cópia sem
//     perguntar;
//   - o 304 tem de sair ANTES do gzip (não há corpo para comprimir) e sem
//     Content-Encoding.
//
// SEM BANCO: o trecho do sendJson é extraído do server.js e posto atrás de um
// servidor http mínimo — é o código de verdade, não uma cópia dele.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const inicio = src.indexOf('const PISO_PARA_COMPRIMIR = ');
const corpoSendJson = (/function sendJson\(res, payload, statusCode = 200\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];
const fim = src.indexOf(corpoSendJson) + corpoSendJson.length;
check('o trecho do sendJson foi encontrado no server.js', inicio > 0 && corpoSendJson.length > 0 && fim > inicio);
// eslint-disable-next-line no-new-func
const { sendJson, etagConfere } = new Function('zlib', 'crypto', `${src.slice(inicio, fim)}\nreturn { sendJson, etagConfere };`)(zlib, crypto);

// O "banco" do teste: o que cada rota devolve AGORA. Mudar daqui é a tela
// mudando de verdade.
const GRANDE = { linhas: Array.from({ length: 600 }, (_, i) => ({ id: `p-${i}`, nome: `Produto ${i}`, preco: i * 1.5 })) };
let atual = GRANDE;
const servidor = http.createServer((req, res) => {
  if (req.url === '/grande') return sendJson(res, atual);
  if (req.url === '/pequeno') return sendJson(res, { ok: true });
  if (req.url === '/erro') return sendJson(res, { ...GRANDE, error: 'x' }, 404);
  if (req.url === '/sem-guardar') { res.setHeader('Cache-Control', 'private, no-store'); return sendJson(res, GRANDE); }
  return sendJson(res, { error: 'rota' }, 404);
});

function pedir(url, { metodo = 'GET', cabecalhos = {} } = {}) {
  return new Promise((ok, falha) => {
    const req = http.request({ host: '127.0.0.1', port: servidor.address().port, path: url, method: metodo, headers: cabecalhos }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => ok({ status: res.statusCode, h: res.headers, corpo: Buffer.concat(partes) }));
    });
    req.on('error', falha);
    req.end();
  });
}

servidor.listen(0, '127.0.0.1', async () => {
  try {
    console.log('--- 1. GET 200 grande leva ETag fraco e no-cache ---');
    const r1 = await pedir('/grande');
    check('status 200 com o corpo inteiro', r1.status === 200 && r1.corpo.equals(Buffer.from(JSON.stringify(GRANDE))));
    check('ETag fraco', /^W\/"[A-Za-z0-9_-]+"$/.test(r1.h.etag || ''), r1.h.etag);
    check('  e é o sha1 do JSON', r1.h.etag === `W/"${crypto.createHash('sha1').update(JSON.stringify(GRANDE)).digest('base64url')}"`);
    check('Cache-Control: private, no-cache (navegador sempre pergunta; proxy não guarda)', r1.h['cache-control'] === 'private, no-cache', r1.h['cache-control']);

    console.log('\n--- 2. o mesmo corpo: 304 sem corpo ---');
    const r2 = await pedir('/grande', { cabecalhos: { 'if-none-match': r1.h.etag } });
    check('304', r2.status === 304, r2.status);
    check('  sem corpo', r2.corpo.length === 0, r2.corpo.length);
    check('  com o mesmo ETag e o Cache-Control', r2.h.etag === r1.h.etag && r2.h['cache-control'] === 'private, no-cache');
    check('  e o Vary', /Accept-Encoding/.test(r2.h.vary || ''));
    const r2b = await pedir('/grande', { cabecalhos: { 'if-none-match': `"outro", ${r1.h.etag.slice(2)}` } });
    check('comparação fraca e em lista também bate', r2b.status === 304, r2b.status);
    const r2c = await pedir('/grande', { cabecalhos: { 'if-none-match': r1.h.etag, 'accept-encoding': 'gzip' } });
    check('pedindo gzip: 304 sem Content-Encoding (não há o que comprimir)', r2c.status === 304 && !r2c.h['content-encoding'] && r2c.corpo.length === 0);

    console.log('\n--- 3. o corpo mudou: 200 com o novo, nunca o velho ---');
    atual = { ...GRANDE, linhas: GRANDE.linhas.map((l, i) => (i === 7 ? { ...l, preco: 99 } : l)) };
    const r3 = await pedir('/grande', { cabecalhos: { 'if-none-match': r1.h.etag } });
    check('200', r3.status === 200, r3.status);
    check('  com o corpo NOVO', r3.corpo.equals(Buffer.from(JSON.stringify(atual))));
    check('  e um ETag novo', r3.h.etag && r3.h.etag !== r1.h.etag);
    const r3g = await pedir('/grande', { cabecalhos: { 'if-none-match': r1.h.etag, 'accept-encoding': 'gzip' } });
    check('com gzip: 200 comprimido, mesmo ETag do cru', r3g.status === 200 && r3g.h['content-encoding'] === 'gzip' && r3g.h.etag === r3.h.etag
      && zlib.gunzipSync(r3g.corpo).equals(Buffer.from(JSON.stringify(atual))));
    atual = GRANDE;

    console.log('\n--- 4. o que NÃO leva ETag ---');
    const r4 = await pedir('/grande', { metodo: 'POST', cabecalhos: { 'if-none-match': r1.h.etag } });
    check('POST: sem ETag, sem 304', r4.status === 200 && !r4.h.etag && !r4.h['cache-control'] && r4.corpo.length > 0);
    const r5 = await pedir('/erro', { cabecalhos: { 'if-none-match': 'W/"x"' } });
    check('erro (404): sem ETag', r5.status === 404 && !r5.h.etag);
    const r6 = await pedir('/pequeno');
    check('abaixo do piso: sem ETag (como antes)', r6.status === 200 && !r6.h.etag && !r6.h['cache-control']);
    const r7 = await pedir('/sem-guardar', { cabecalhos: { 'if-none-match': r1.h.etag } });
    check('rota que decidiu o próprio Cache-Control: respeitada, sem ETag', r7.status === 200 && r7.h['cache-control'] === 'private, no-store' && !r7.h.etag);
    const r8 = await pedir('/grande', { cabecalhos: { 'if-none-match': '*' } });
    check('"*" não vira 304 (ninguém manda; na dúvida, o corpo)', r8.status === 200);

    console.log('\n--- 5. etagConfere ---');
    check('vazio não confere', !etagConfere(undefined, 'W/"a"') && !etagConfere('', 'W/"a"'));
    check('forte contra fraco confere (comparação fraca)', etagConfere('"a"', 'W/"a"'));
    check('prefixo não confere', !etagConfere('W/"ab"', 'W/"a"'));

    console.log('\n--- 6. por fonte ---');
    check('a revalidação vem antes do gzip no sendJson', corpoSendJson.indexOf('etagConfere(') > 0
      && corpoSendJson.indexOf('etagConfere(') < corpoSendJson.indexOf('zlib.gzip('));
    check('só GET com status 200', /statusCode === 200 && pedido && pedido\.method === 'GET'/.test(corpoSendJson));
    check('o ETag é do corpo montado agora (sha1 do corpo)', /createHash\('sha1'\)\.update\(corpo\)/.test(corpoSendJson));
  } catch (erro) {
    console.error(erro);
    falhas += 1;
  } finally {
    servidor.close();
    console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
    process.exit(falhas ? 1 : 0);
  }
});
