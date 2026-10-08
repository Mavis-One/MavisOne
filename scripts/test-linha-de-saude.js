#!/usr/bin/env node
// A LINHA DE SAÚDE NO LOG — e o teto de memória do PM2 que ela vigia.
//
// Queixa de lentidão só se mede no VPS, e o pico de memória que faz o PM2
// reiniciar o processo some em dez segundos. O server.js passou a escrever
// `[saude] ...` no minuto ruim (atraso do event loop > 200 ms ou RSS > 700 MB),
// e só nele. Os dois modos de falha que este teste guarda:
//   - a linha nunca sair (um timer que ninguém liga, um limiar trocado) — e a
//     única medida de produção some sem ninguém notar;
//   - a linha sair TODO minuto, ou segurar o processo de pé (timer sem unref):
//     log que enche à toa deixa de ser lido, e um teste que carrega o
//     server.js nunca terminaria.
//
// SEM BANCO: o trecho é extraído do server.js e rodado com o minuto encurtado.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ocupar = (ms) => { const fim = Date.now() + ms; while (Date.now() < fim) { /* trava o event loop */ } };

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const inicio = src.indexOf('const SAUDE_INTERVALO_MS = ');
const corpo = (/function ligarLinhaDeSaude\(\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];
const fim = src.indexOf(corpo) + corpo.length;

/**
 * O trecho de verdade do server.js, com o "minuto" de 400 ms, a amostra de RSS
 * de 50 ms e os limiares que o caso pedir. Devolve a lista de linhas escritas.
 */
function ligarComMinutoCurto({ atrasoRuimMs = 200, rssRuimMb = 700 } = {}) {
  const trecho = src.slice(inicio, fim)
    .replace('const SAUDE_INTERVALO_MS = 60 * 1000;', 'const SAUDE_INTERVALO_MS = 400;')
    .replace('const SAUDE_AMOSTRA_RSS_MS = 5 * 1000;', 'const SAUDE_AMOSTRA_RSS_MS = 50;')
    .replace('const SAUDE_ATRASO_RUIM_MS = 200;', `const SAUDE_ATRASO_RUIM_MS = ${atrasoRuimMs};`)
    .replace('const SAUDE_RSS_RUIM_MB = 700;', `const SAUDE_RSS_RUIM_MB = ${rssRuimMb};`);
  const linhas = [];
  // eslint-disable-next-line no-new-func
  const ligar = new Function('require', 'console', `${trecho}\nreturn ligarLinhaDeSaude;`)(require, { log: (l) => linhas.push(l) });
  ligar();
  ligar(); // a segunda chamada não pode ligar outro par de timers
  return linhas;
}

(async () => {
  check('o trecho da linha de saúde foi encontrado', inicio > 0 && corpo.length > 0 && fim > inicio);

  console.log('\n--- 1. por fonte ---');
  const semCom = semComentarios(src);
  check('ligada quando o servidor abre a porta', /server\.listen\(port, HOST, \(\) => \{[\s\S]*?ligarLinhaDeSaude\(\);[\s\S]*?\n {2}\}\);/.test(semCom));
  check('os dois timers são unref()', (corpo.match(/\}, SAUDE_\w+\)\.unref\(\);/g) || []).length === 2);
  check('atraso ruim acima de 200 ms', /const SAUDE_ATRASO_RUIM_MS = 200;/.test(src));
  // O limiar de memória tem de ficar ACIMA do pico normal medido (1ª abertura
  // 492-524 MB, três aberturas juntas 584-638 MB): abaixo dele a linha sai em
  // toda abertura e perde o valor de alerta. E abaixo do teto do PM2 (conferido
  // na seção 2), senão o processo é reiniciado antes de a linha avisar.
  const rssRuim = Number((/const SAUDE_RSS_RUIM_MB = (\d+);/.exec(src) || [])[1]);
  check('limiar de RSS acima do pico normal da abertura (638 MB)', rssRuim > 638, rssRuim);
  check('um minuto entre linhas', /const SAUDE_INTERVALO_MS = 60 \* 1000;/.test(src));

  console.log('\n--- 2. o teto do PM2 ---');
  const eco = fs.readFileSync(path.join(RAIZ, 'ecosystem.config.js'), 'utf8');
  // 500M ficava ABAIXO do pico normal da abertura (492-524 MB num processo
  // novo; 746-850 MB com três pessoas juntas): o PM2 matava o processo no meio
  // de requisições. O teto tem de ficar acima do pico medido, e ainda pegar
  // vazamento (o ocioso normal é 40-115 MB).
  //
  // Em produção (log do PM2, 08/10/2026) o maior pico foi 907 MB, e o VPS tem
  // 16 GB: o teto passou a 2048M, mais que o dobro. O limite de cima continua
  // existindo para o teto não virar "infinito" e parar de pegar vazamento.
  const padrao = (/max_memory_restart: process\.env\.PM2_MAX_MEMORY \|\| '(\d+)M'/.exec(eco) || [])[1];
  check('o PM2_MAX_MEMORY do deploy troca o número sem mexer no arquivo', padrao !== undefined);
  check('o teto padrão fica acima do maior pico de produção (907 MB) com folga, e abaixo de 4 GB',
    Number(padrao) >= 907 * 1.5 && Number(padrao) < 4096, `${padrao}M`);
  check('o limiar de RSS da linha de saúde fica abaixo do teto do PM2', rssRuim < Number(padrao), `${rssRuim} < ${padrao}`);
  check('continua uma instância em fork', /instances: 1,/.test(eco) && /exec_mode: 'fork'/.test(eco));

  // Os timers da saúde são unref: este segura o processo durante o teste.
  const segurar = setInterval(() => {}, 1000);

  console.log('\n--- 3. o minuto ruim escreve ---');
  const linhas = ligarComMinutoCurto();
  // O travamento termina BEM antes da virada do "minuto" (400 ms): se ele
  // atravessasse a virada, o timer da linha e o do histograma venceriam juntos
  // ao destravar, e quem rodasse primeiro decidiria se o atraso entra neste
  // minuto ou no seguinte — teste instável, não defeito da linha.
  await esperar(30);
  ocupar(300);
  await esperar(300);
  check('um travamento de 300 ms escreve UMA linha', linhas.length === 1, linhas.length);
  check('  no formato [saude] ... event loop p99/max ... rss max ... heap',
    /^\[saude\] event loop p99 \d+ ms, max \d+ ms; rss max \d+ MB \(agora \d+ MB\), heap \d+ MB$/.test(linhas[0] || ''), linhas[0]);
  const maximo = Number((/max (\d+) ms;/.exec(linhas[0] || '') || [])[1]);
  check('  com o atraso medido (>= 250 ms)', maximo >= 250, maximo);

  console.log('\n--- 4. o limiar de memória ---');
  const linhasMem = ligarComMinutoCurto({ atrasoRuimMs: 100000, rssRuimMb: 1 });
  await esperar(500);
  check('RSS acima do limiar escreve mesmo sem travamento', linhasMem.length >= 1, linhasMem.length);

  console.log('\n--- 5. abaixo dos dois limiares, nada ---');
  // Limiares altos para o teste não depender de a máquina estar ociosa.
  const linhasCalmas = ligarComMinutoCurto({ atrasoRuimMs: 100000, rssRuimMb: 100000 });
  await esperar(900);
  check('dois minutos sem passar de nenhum limiar: zero linhas', linhasCalmas.length === 0, linhasCalmas.length);

  clearInterval(segurar);
  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
