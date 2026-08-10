#!/usr/bin/env node
// Expiração das sessões na virada do dia — lib/sessao.js
//
// A conta de "quando esta sessão morre" é fácil de escrever errado de um jeito
// que só aparece em produção: somar 24h (a sessão nunca morreria no mesmo dia),
// usar UTC (o corte cairia às 21h no horário de Brasília), ou esquecer que
// 31/12 vira ano. Este teste fixa os três.
const path = require('path');
const S = require(path.join(__dirname, '..', 'lib', 'sessao'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Datas locais (sem Z): o corte é no relógio da máquina, não em UTC.
const em = (texto) => new Date(texto);
const legivel = (ms) => new Date(ms).toLocaleString('pt-BR');

console.log('--- a virada é sempre a PRÓXIMA meia-noite local ---');
[
  ['2026-08-10T08:00:00', '2026-08-11T00:00:00', 'manhã'],
  ['2026-08-10T23:50:00', '2026-08-11T00:00:00', 'dez minutos antes do corte'],
  ['2026-08-10T00:00:01', '2026-08-11T00:00:00', 'um segundo DEPOIS da virada — vale o dia inteiro'],
  ['2026-08-10T12:00:00', '2026-08-11T00:00:00', 'meio-dia']
].forEach(([entrada, esperado, rotulo]) => {
  const obtido = S.proximaViradaDeDia(em(entrada));
  check(rotulo, obtido === em(esperado).getTime(), legivel(obtido));
});

console.log('\n--- a virada é 00:00 cravado, não 23:59 nem 00:01 ---');
const virada = new Date(S.proximaViradaDeDia(em('2026-08-10T15:30:00')));
check('hora 0', virada.getHours() === 0, String(virada.getHours()));
check('minuto 0', virada.getMinutes() === 0, String(virada.getMinutes()));
check('segundo 0', virada.getSeconds() === 0, String(virada.getSeconds()));
check('milissegundo 0', virada.getMilliseconds() === 0, String(virada.getMilliseconds()));

console.log('\n--- vira mês e ano sozinho ---');
check('31/01 -> 01/02', S.proximaViradaDeDia(em('2026-01-31T22:00:00')) === em('2026-02-01T00:00:00').getTime());
check('28/02 de ano bissexto -> 29/02', S.proximaViradaDeDia(em('2028-02-28T10:00:00')) === em('2028-02-29T00:00:00').getTime());
check('31/12 -> 01/01 do ano seguinte', S.proximaViradaDeDia(em('2026-12-31T23:59:00')) === em('2027-01-01T00:00:00').getTime());

console.log('\n--- NÃO é "24 horas depois" ---');
// O erro clássico: quem entra às 8h teria até as 8h do dia seguinte, e a
// sessão atravessaria a madrugada inteira — justamente o que a regra evita.
const entrada = em('2026-08-10T08:00:00');
const vinteQuatroHoras = entrada.getTime() + 24 * 60 * 60 * 1000;
check('a sessão das 8h morre à meia-noite, não às 8h do dia seguinte',
  S.proximaViradaDeDia(entrada) < vinteQuatroHoras,
  `${legivel(S.proximaViradaDeDia(entrada))} < ${legivel(vinteQuatroHoras)}`);
check('quem entra 23h50 tem só 10 minutos',
  S.msAteAVirada(em('2026-08-10T23:50:00')) === 10 * 60 * 1000,
  `${S.msAteAVirada(em('2026-08-10T23:50:00')) / 60000} min`);

console.log('\n--- sessaoExpirou ---');
const sessao = { userId: 'u1', criadaEm: em('2026-08-10T22:00:00').getTime(), expiraEm: em('2026-08-11T00:00:00').getTime() };
check('antes da virada, vale', S.sessaoExpirou(sessao, em('2026-08-10T23:59:59').getTime()) === false);
check('no instante da virada, cai', S.sessaoExpirou(sessao, em('2026-08-11T00:00:00').getTime()) === true);
check('depois da virada, cai', S.sessaoExpirou(sessao, em('2026-08-11T09:00:00').getTime()) === true);
check('sessão sem expiraEm não é derrubada por engano', S.sessaoExpirou({ userId: 'u1' }, Date.now()) === false);
check('sessão inexistente não quebra', S.sessaoExpirou(null, Date.now()) === false);

console.log('\n--- msAteAVirada nunca é negativo ---');
// Quem agenda um setTimeout com valor negativo dispara na hora; se isso
// acontecesse por engano, todo login cairia imediatamente.
check('valor sempre >= 0', S.msAteAVirada(em('2026-08-10T23:59:59.999')) >= 0);

console.log('\n--- todo motivo de encerramento tem explicação em português ---');
// Cair sem saber por quê é o que faz o usuário achar que o sistema quebrou.
Object.entries(S.MOTIVOS).forEach(([motivo, mensagem]) => {
  check(`${motivo} explica`, typeof mensagem === 'string' && mensagem.length > 20, mensagem);
});
check('fim-do-dia fala de meia-noite', /meia-noite/i.test(S.MOTIVOS['fim-do-dia']));
check('motivo desconhecido tem frase padrão', S.mensagemDoMotivo('inventado') === S.MENSAGEM_PADRAO, S.mensagemDoMotivo('inventado'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
