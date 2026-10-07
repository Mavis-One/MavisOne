#!/usr/bin/env node
// O PARSER DE timestamptz TEM DE DEVOLVER EXATAMENTE O QUE DEVOLVIA.
//
// O contrato (cabeçalho de lib/db/conexao.js) é: o texto do Postgres vira
// `new Date(texto).toISOString()`; se o Date for inválido (infinity, BC), volta
// o texto cru. É o `paraIsoPeloDate`. O `paraIso` registrado no driver ganhou
// um caminho rápido (07/10/2026) porque o toISOString custa ~700 ns e é chamado
// 100+ mil vezes por requisição pesada — 16% de toda a CPU das rotas
// perfiladas. O caminho rápido só pode existir se for INDISTINGUÍVEL do antigo:
// uma data que andasse uma hora ou um dia mudaria vencimento, filtro por
// período e a ordem das listas, sem erro nenhum na tela.
//
// SEM BANCO: os casos são gerados aqui, nos leiautes que o Postgres emite com
// DateStyle ISO (o domínio do caminho rápido) e nos que ele não emite (que têm
// de cair no código antigo). A prova contra as 128 colunas timestamptz do banco
// real, em 6 fusos de sessão e 3 DateStyle, foi rodada à parte (0 diferenças).
//
// O FUSO DO PROCESSO não deveria importar — todo texto do Postgres traz o
// offset —, mas o Date usa o fuso local quando falta offset, e é exatamente o
// tipo de suposição que se prova em vez de supor: o lote roda com o processo em
// UTC e em America/Sao_Paulo (o Node relê o TZ quando process.env.TZ muda).
'use strict';
const fs = require('fs');
const path = require('path');
const { paraIso, paraIsoPeloDate } = require('../lib/db/conexao');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// A referência é escrita AQUI, e não importada: se alguém mudar o
// paraIsoPeloDate, o teste continua comparando com o comportamento de antes.
function referencia(texto) {
  if (!texto) return texto;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? texto : d.toISOString();
}

const p2 = (x) => String(x).padStart(2, '0');
const OFFSETS = ['+00', '-03', '-02', '+03', '-12', '+14', '+05:30', '-09:30', '+05:45', '+13:45', '-03:06:28', '+00:19:32', '-15:59', '+15'];
const FRACOES = ['', '.5', '.05', '.123', '.1234', '.999999', '.000001', '.9', '.12'];
const ESPECIAIS = ['infinity', '-infinity', '0001-01-01 00:00:00+00 BC', '10000-01-01 00:00:00+00', '0099-06-01 12:00:00+00',
  '0999-12-31 23:00:00+00', '1000-01-01 00:00:00+14', '9999-12-31 23:00:00-12', '2026-02-29 12:00:00-03', '2026-02-30 12:00:00-03',
  '2024-02-29 23:30:00-03', '2026-13-01 12:00:00-03', '2026-00-10 12:00:00-03', '2026-08-00 12:00:00-03', '2026-08-31 24:00:00-03',
  '2026-08-31 12:60:00-03', '2026-08-31 12:00:60-03', '2026-08-31 12:00:00.-03', '2026-08-31 12:00:00.1234567-03',
  '2026-08-31 12:00:00-3', '2026-08-31T12:00:00Z', '2026-08-31 12:00:00+16', '2026-08-31 12:00:00+05:60', '2026-08-31 12:00:00+05-30',
  '2026-08-31 12:00:00', '2026-08-31', '2026/08/31 12:00:00-03', ' 2026-08-31 12:00:00-03', '2026-08-31 12:00:00-03 ',
  '２026-08-31 12:00:00-03', '2026-08-31 12:00:00.5a-03', 'Mon Aug 31 12:00:00 2026 -03', '31.08.2026 12:00:00 -03',
  '08/31/2026 12:00:00 -03', '', null, undefined, 'lixo'];

function lote() {
  let casos = 0; let diferentes = 0; const exemplos = [];
  const conferir = (t) => {
    casos += 1;
    const a = referencia(t); const b = paraIso(t);
    if (a !== b) { diferentes += 1; if (exemplos.length < 10) exemplos.push({ t, esperado: a, veio: b }); }
  };
  // 1. Viradas de dia/mês/ano e bissextos (1900 não, 2000 sim, 2100 não), mais
  //    1582 e 1752 (as reformas de calendário que o Date ignora, como o Postgres).
  for (const ano of [1000, 1582, 1752, 1900, 1970, 2000, 2024, 2026, 2100, 9999]) {
    for (let t = Date.UTC(ano - 1, 11, 25); t <= Date.UTC(ano, 2, 5); t += 86400000) {
      const d = new Date(t);
      if (d.getUTCFullYear() < 1000) continue;
      const dia = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
      for (const h of [0, 1, 2, 3, 11, 12, 13, 20, 21, 22, 23]) {
        for (const off of OFFSETS) for (const f of FRACOES) conferir(`${dia} ${p2(h)}:59:59${f}${off}`);
      }
    }
  }
  // 2. Varredura de 1890 a 2100 em passos irregulares (hora, minuto, segundo e
  //    milissegundo andam todos), nos dois offsets que São Paulo já usou.
  for (let t = Date.UTC(1890, 0, 1); t < Date.UTC(2100, 0, 1); t += 7 * 3600 * 1000 + 13 * 60 * 1000 + 17 * 1000 + 123) {
    const d = new Date(t);
    const base = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
    conferir(`${base}.${String(d.getUTCMilliseconds()).padStart(3, '0')}-03`);
    conferir(`${base}-02`);
  }
  // 3. O que o Postgres emite e não é instante comum, os outros DateStyle, e lixo.
  for (const t of ESPECIAIS) conferir(t);
  return { casos, diferentes, exemplos };
}

const fusoOriginal = process.env.TZ;
for (const fuso of ['UTC', 'America/Sao_Paulo']) {
  process.env.TZ = fuso;
  console.log(`--- processo em ${fuso} ---`);
  // Sem isto, um Node que ignorasse a troca rodaria o mesmo fuso duas vezes e
  // o teste diria que provou os dois.
  const esperado = fuso === 'UTC' ? 0 : 180;
  check(`o fuso do processo mudou mesmo`, new Date(2026, 0, 1).getTimezoneOffset() === esperado, new Date(2026, 0, 1).getTimezoneOffset());
  const { casos, diferentes, exemplos } = lote();
  check(`${casos} casos, o caminho rápido devolve o mesmo que new Date().toISOString()`, diferentes === 0, `${diferentes} diferença(s)`);
  for (const e of exemplos) console.log('     ', JSON.stringify(e));
}
if (fusoOriginal === undefined) delete process.env.TZ; else process.env.TZ = fusoOriginal;

console.log('\n--- a forma de saída ---');
const amostra = paraIso('2026-09-01 08:37:14.534-03');
check('o caso comum sai AAAA-MM-DDTHH:MM:SS.mmmZ', amostra === '2026-09-01T11:37:14.534Z', amostra);
check('cruzando a meia-noite troca o dia', paraIso('2026-12-31 22:00:00-03') === '2027-01-01T01:00:00.000Z', paraIso('2026-12-31 22:00:00-03'));
check('infinity volta cru', paraIso('infinity') === 'infinity');
check('null continua null', paraIso(null) === null);
check('o paraIsoPeloDate é o contrato de antes', paraIsoPeloDate('2026-08-31 15:00:00+00') === '2026-08-31T15:00:00.000Z');

console.log('\n--- e o código antigo continua sendo a rede ---');
// O caminho rápido só pode existir COM o fallback: tirar o new Date daqui
// faria todo texto fora do leiaute exato (infinity, LMT, DateStyle trocado)
// virar outra coisa — ou exceção no meio do parse de uma tabela inteira.
const fonte = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'conexao.js'), 'utf8'));
const corpoPeloDate = (/function paraIsoPeloDate\(texto\) \{[\s\S]*?\n\}/.exec(fonte) || [''])[0];
check('paraIsoPeloDate ainda usa new Date(texto) e toISOString()', /new Date\(texto\)/.test(corpoPeloDate) && /toISOString\(\)/.test(corpoPeloDate));
const corpoRapido = (/function paraIso\(texto\) \{[\s\S]*?\n\}/.exec(fonte) || [''])[0];
const saidas = (corpoRapido.match(/return paraIsoPeloDate\(texto\)/g) || []).length;
check('paraIso cai no paraIsoPeloDate fora do leiaute exato', saidas >= 6, `${saidas} saída(s)`);
check('o driver usa o paraIso para timestamptz', /types\.setTypeParser\(OID\.TIMESTAMPTZ, paraIso\)/.test(fonte));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
