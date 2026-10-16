#!/usr/bin/env node
/**
 * NF-e EMITIDAS COM DIA E HORA (16/10/2026). Pedido do usuário: "NF-e
 * emitidas: coloque ... data de emissão dessas", "coloque em datas e horas",
 * "quero ver dia/mês/ano e horário".
 *
 * A nota fiscal leva `emitidaEm` (o instante, em UTC) e a tela escreve o dia e
 * a hora de Brasília. A data civil (meia-noite UTC, a da tela de emissão) não
 * tem hora: vale a da autorização, ou a da criação, se forem do mesmo dia. A
 * importada do Viper só tem o dia e continua só com o dia.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const src = ler('server.js');

function corpoDe(texto, nome) {
  const marca = [`\nfunction ${nome}(`, `\nasync function ${nome}(`].find((m) => texto.includes(m));
  if (!marca) throw new Error(`não achei a função ${nome}`);
  const ini = texto.indexOf(marca);
  return texto.slice(ini, texto.indexOf('\n}', ini + 1) + 2);
}
const blocoStatus = src.slice(src.indexOf('const NFE_STATUS_FISCAL = {'), src.indexOf('};', src.indexOf('const NFE_STATUS_FISCAL = {')) + 2);
const { fiscalNfeParaLista } = new Function(`${blocoStatus}\n${corpoDe(src, 'normalizeNfeStatus')}\n${corpoDe(src, 'fiscalNfeParaLista')}\nreturn { fiscalNfeParaLista };`)();

console.log('--- 1. o instante da emissão ---');
const comHora = fiscalNfeParaLista({ id: 'a', dataEmissao: '2026-10-16T17:32:10.000Z', autorizadoEm: '2026-10-16T17:32:40.000Z' });
check('data_emissao com hora: ela mesma', comHora.date === '2026-10-16' && comHora.emitidaEm === '2026-10-16T17:32:10.000Z', JSON.stringify([comHora.date, comHora.emitidaEm]));
const civil = fiscalNfeParaLista({ id: 'b', dataEmissao: '2026-10-16T00:00:00.000Z', autorizadoEm: '2026-10-16T18:05:00.000Z', criadoEm: '2026-10-16T18:04:00.000Z' });
check('data civil: a hora da autorização', civil.date === '2026-10-16' && civil.emitidaEm === '2026-10-16T18:05:00.000Z', JSON.stringify([civil.date, civil.emitidaEm]));
const civilSemAutorizacao = fiscalNfeParaLista({ id: 'c', dataEmissao: '2026-10-16T00:00:00Z', criadoEm: '2026-10-16T12:00:00.000Z' });
check('  sem autorização: a da criação', civilSemAutorizacao.emitidaEm === '2026-10-16T12:00:00.000Z', civilSemAutorizacao.emitidaEm);
const outroDia = fiscalNfeParaLista({ id: 'd', dataEmissao: '2026-10-16T00:00:00.000Z', autorizadoEm: '2026-10-17T13:00:00.000Z' });
check('  autorizada em outro dia: só o dia, sem misturar', outroDia.date === '2026-10-16' && outroDia.emitidaEm === '', JSON.stringify([outroDia.date, outroDia.emitidaEm]));
const noite = fiscalNfeParaLista({ id: 'e', modelo: 65, dataEmissao: '2026-10-14T00:30:00.000Z' });
check('a NFC-e das 21h30 continua no dia dela', noite.date === '2026-10-13' && noite.emitidaEm === '2026-10-14T00:30:00.000Z', JSON.stringify([noite.date, noite.emitidaEm]));
const soCriacao = fiscalNfeParaLista({ id: 'f', criadoEm: '2026-10-16T19:10:00.000Z' });
check('sem data_emissao: a criação', soCriacao.date === '2026-10-16' && soCriacao.emitidaEm === '2026-10-16T19:10:00.000Z');
const invalida = fiscalNfeParaLista({ id: 'g', dataEmissao: 'lixo' });
check('data inválida não derruba a lista', invalida.emitidaEm === '');

console.log('\n--- 2. a ordem por data desempata pela hora ---');
const ordens = src.slice(src.indexOf('const ORDENS_DA_LISTA_DE_NFE = {'), src.indexOf('};', src.indexOf('const ORDENS_DA_LISTA_DE_NFE = {')) + 2);
const ORDENS = new Function(`${ordens}\nreturn ORDENS_DA_LISTA_DE_NFE;`)();
const mesmoDia = [comHora, civil, civilSemAutorizacao].sort((a, b) => ORDENS.data(a, b)).map((n) => n.id).join(',');
check('no mesmo dia, da mais cedo para a mais tarde', mesmoDia === 'c,a,b', mesmoDia);

console.log('\n--- 3. a tela ---');
const tela = ler('public/modules/finance/subs/nfe_emitidas.js');
const formatador = tela.slice(tela.indexOf('const NFE_DIA_E_HORA'), tela.indexOf('\n}', tela.indexOf('function nfeDiaEHora(')) + 2);
const nfeDiaEHora = new Function('financeFormatDate', `${formatador}\nreturn nfeDiaEHora;`)((d) => `dia:${d}`);
check('dia/mês/ano e hora de Brasília', nfeDiaEHora('2026-10-16T17:32:10.000Z', '2026-10-16') === '16/10/2026 14:32', nfeDiaEHora('2026-10-16T17:32:10.000Z', '2026-10-16'));
check('  21h30 não vira o dia seguinte', nfeDiaEHora('2026-10-14T00:30:00.000Z', '2026-10-13') === '13/10/2026 21:30', nfeDiaEHora('2026-10-14T00:30:00.000Z', '2026-10-13'));
check('  sem instante, só o dia', nfeDiaEHora('', '2026-10-16') === 'dia:2026-10-16');
check('a coluna Data usa dia e hora', /<td>\$\{escapeHtml\(nfe\.series\)\}<\/td>\s*<td>\$\{nfeDiaEHora\(nfe\.emitidaEm, nfe\.date\)\}<\/td>/.test(tela));
check('  a ficha da nota também', /Data de emissão<\/span><strong>\$\{nfeDiaEHora\(nfe\.emitidaEm, nfe\.date\)\}<\/strong>/.test(tela)
  && /date: daLista\.date,\s*emitidaEm: daLista\.emitidaEm \|\| '',/.test(tela));
check('  e a nota em edição, sem cortar o UTC', /<td>\$\{nfeDiaEHora\(r\.atualizadoEm, /.test(tela) && !/financeFormatDate\(String\(r\.atualizadoEm/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
