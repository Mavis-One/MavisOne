#!/usr/bin/env node
// A RESPOSTA DE API VAI COMPRIMIDA (fase CM).
//
// O QUE ESTAVA ERRADO, medido em 17/09/2026 neste banco (14.864 pedidos, 6.492
// pessoas, 5.475 produtos): o gzip existia e servia só arquivo estático. Toda
// resposta de API saía crua, e é nela que está o volume.
//
//   Cadastros — pessoas .... 7.424 KB  ->   695 KB  (10,7x)
//   TOTAL de onze telas ... 25.666 KB -> 3.694 KB  ( 6,9x)
//
// Num link de 25 Mbit/s, 8,4 s de transferência viram 1,2 s — e o escritório
// acessa por VPS, então é esse tempo que a pessoa sente.
//
// POR QUE ISTO É TESTE, E DE CÓDIGO-FONTE: compressão é do tipo de coisa que
// ninguém percebe voltando. Se alguém trocar o gzip assíncrono por gzipSync, ou
// tirar a guarda da resposta destruída, nada quebra na tela — quebra em produção,
// sob carga, e o sintoma não aponta para cá. As três propriedades abaixo não são
// estilo: cada uma tem um modo de falha que já foi pensado por escrito.
//
// A prova de ponta a ponta (gzip de verdade, conteúdo idêntico, cliente que
// aborta) foi rodada contra o servidor vivo; aqui ficam as invariantes.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
// O corpo do sendJson, para os checks não casarem com o gzip do serveStatic —
// que já existia e não é o que esta fase mudou.
const sendJson = (/function sendJson\(res, payload, statusCode = 200\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];

console.log('--- 1. o sendJson comprime ---');
check('o corpo do sendJson foi encontrado', sendJson.length > 0, `${sendJson.length} caracteres`);
check('ele chama o gzip', /zlib\.gzip\(/.test(sendJson));
// gzipSync travaria o event loop: comprimir 7,4 MB custa ~51 ms, e o servidor
// roda em UM processo (exec_mode fork). Seriam 51 ms de TODAS as outras
// requisições paradas para acelerar uma.
check('  e NÃO na versão síncrona', !/gzipSync/.test(sendJson));
check('declara o Content-Encoding', /'Content-Encoding': 'gzip'/.test(sendJson));
// Sem Vary, um proxy compartilhado entrega o corpo gzipado para quem não pediu.
check('e o Vary, para proxy não misturar', /Vary: 'Accept-Encoding'/.test(sendJson));

console.log('\n--- 2. só comprime quando vale e quando o cliente pede ---');
check('confere o Accept-Encoding', /accept-encoding/.test(sendJson));
check('  pelo res.req, sem mexer nas 60+ chamadas', /res\.req/.test(sendJson));
check('tem piso de tamanho', /PISO_PARA_COMPRIMIR/.test(src));
// Abaixo de um pacote, o cabeçalho do gzip e o custo de CPU não compram nada.
const piso = (/const PISO_PARA_COMPRIMIR = (\d+);/.exec(src) || [])[1];
check('  e o piso é da ordem de um pacote', Number(piso) >= 500 && Number(piso) <= 2000, piso);
// Quem não pede gzip tem que receber corpo cru — é o caso dos scripts de teste
// deste repositório, que falam com a API pelo módulo http do Node.
check('quem não pede recebe cru', /!\/\\bgzip\\b\/\.test\(aceita\)/.test(sendJson));

console.log('\n--- 3. as duas bordas que a assincronia abriu ---');
// ANTES o sendJson era síncrono. Agora existe uma janela entre pedir a
// compressão e escrever: nela o cliente pode ter fechado a aba.
//
// Escrever em resposta destruída LANÇA, dentro de um callback do zlib — fora de
// qualquer try/catch de rota. Isso viraria uncaughtException, que neste servidor
// encerra o processo de propósito. Ou seja: sem esta guarda, fechar a aba no
// meio de uma consulta grande derrubaria o servidor de todo mundo.
check('não escreve em resposta já morta', /res\.destroyed \|\| res\.writableEnded/.test(sendJson));
check('e a escrita está protegida', /try \{[\s\S]*?\} catch/.test(sendJson));
// Falhar em comprimir não é motivo para não responder.
check('erro de compressão cai para o corpo cru', /if \(erro\) \{[\s\S]{0,200}res\.end\(corpo\)/.test(sendJson));

console.log('\n--- 4. o que esta fase NÃO resolve ---');
// Honestidade sobre escopo, e não conversa fiada: mandar 6.492 pessoas para
// desenhar uma página de 15 continua errado, e o comentário tem que dizer isso,
// senão o número bonito da compressão faz o problema real parecer resolvido.
check('o comentário diz que o excesso continua lá',
  /não muda contrato|conserta o transporte|continua errado/i.test(src));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
