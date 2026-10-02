#!/usr/bin/env node
/**
 * O GERADOR DA EFD (lib/sped-gerador.js) — formatação, estrutura e a prova de
 * volta contra os arquivos que o sistema antigo gerou.
 *
 * Parte 1 a 3 rodam em qualquer máquina. A parte 4 precisa dos SPEDs do
 * sistema antigo (sped01MMAAAA-*.txt) — por padrão em ~/Downloads, ou na pasta
 * de SPED_ANTIGOS. Eles NÃO entram no repositório: são a escrituração fiscal
 * da empresa, com CPF de cliente. Sem eles a parte 4 é pulada e DITO.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const g = require('../lib/sped-gerador');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const lanca = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

const c = (reg, chave) => g.camposComChave(reg).find((x) => x.chave === chave);

console.log('\n--- 1. um campo ---');
check('decimal sai com vírgula e todas as casas', g.formatarCampo('C190', c('C190', 'ALIQ_ICMS'), 17) === '17,00');
check('  QTD do C170 tem cinco casas', g.formatarCampo('C170', c('C170', 'QTD'), 2) === '2,00000');
check('  sem separador de milhar', g.formatarCampo('C100', c('C100', 'VL_DOC'), 1234567.8) === '1234567,80');
check('  texto brasileiro "1.234,56" é lido certo', g.formatarCampo('C100', c('C100', 'VL_DOC'), '1.234,56') === '1234,56');
check('  e "17.5" com ponto decimal NÃO vira 175', g.formatarCampo('C100', c('C100', 'VL_DOC'), '17.5') === '17,50');
check('  -0,001 não vira "-0,00"', g.formatarCampo('C100', c('C100', 'VL_DOC'), -0.001) === '0,00');
check('zero declara valor, vazio declara ausência',
  g.formatarCampo('C100', c('C100', 'VL_DOC'), 0) === '0,00'
  && g.formatarCampo('C100', c('C100', 'VL_DOC'), null) === ''
  && g.formatarCampo('C100', c('C100', 'VL_DOC'), '') === '');
check('código vai como texto e guarda o zero à esquerda', g.formatarCampo('C190', c('C190', 'CST_ICMS'), '060') === '060');
check('Date vira ddmmaaaa', g.formatarCampo('C100', c('C100', 'DT_DOC'), new Date(Date.UTC(2026, 8, 1))) === '01092026');
check('letra em campo numérico é erro, não zero',
  /não é número/.test(lanca(() => g.formatarCampo('C100', c('C100', 'VL_DOC'), 'abc'))));
check('"|" dentro de texto é erro, não corte',
  /contém "\|"/.test(lanca(() => g.formatarCampo('0150', c('0150', 'NOME'), 'A|B'))));

console.log('\n--- 2. uma linha ---');
check('linha começa e termina em "|", com um campo por posição do leiaute',
  g.linhaDoRegistro({ REG: 'C190', CST_ICMS: '000', CFOP: '5102', ALIQ_ICMS: 17, VL_OPR: 100, VL_BC_ICMS: 100, VL_ICMS: 17 })
    === '|C190|000|5102|17,00|100,00|100,00|17,00||||||');
check('campo com nome errado é erro (senão sai vazio sem ninguém saber)',
  /campo desconhecido "VL_TOTAL"/.test(lanca(() => g.linhaDoRegistro({ REG: 'C100', VL_TOTAL: 1 }))));
check('registro que o Guia não tem é erro', /desconhecido/.test(lanca(() => g.linhaDoRegistro({ REG: 'Z999' }))));
check('o C170 aceita as duas alíquotas de PIS pelos dois nomes',
  (() => {
    const l = g.linhaDoRegistro({ REG: 'C170', NUM_ITEM: '1', ALIQ_PIS: 0.65, ALIQ_PIS_REAIS: 1.5 }).split('|');
    // campo 27 é ALIQ_PIS (%), 29 é ALIQ_PIS (R$); +1 pelo "|" inicial
    return l[27] === '0,6500' && l[29] === '1,5000';
  })());

console.log('\n--- 3. a estrutura, que é do gerador e de mais ninguém ---');
const R0000 = { REG: '0000', COD_VER: '020', COD_FIN: '0', DT_INI: '01092026', DT_FIN: '30092026', NOME: 'TESTE', CNPJ: '43792899000135', UF: 'SC', IE: '261345958', COD_MUN: '4208906', IND_PERFIL: 'B', IND_ATIV: '1' };
const minimo = g.gerarEfd({
  registro0000: R0000,
  blocos: {
    C: [{ REG: 'C100', IND_OPER: '1', IND_EMIT: '0', COD_MOD: '55', COD_SIT: '02', SER: '1', NUM_DOC: '10', CHV_NFE: '4'.repeat(44) }],
    E: [{ REG: 'E100', DT_INI: '01092026', DT_FIN: '30092026' }],
    1: [{ REG: '1010', IND_EXP: 'N' }]
  }
});
const L = minimo.linhas;
const linhaDe = (reg) => L.find((l) => l.startsWith(`|${reg}|`));
check('o arquivo começa no 0000 e termina no 9999', L[0].startsWith('|0000|') && L[L.length - 1].startsWith('|9999|'));
check('0990 conta o 0000, o 0001 e ele mesmo', linhaDe('0990') === '|0990|3|');
check('bloco sem dados abre com IND_MOV 1 e fecha com 2', linhaDe('D001') === '|D001|1|' && linhaDe('D990') === '|D990|2|');
check('  no B001 o campo se chama IND_DAD e funciona igual', linhaDe('B001') === '|B001|1|');
check('bloco com dados abre com 0', linhaDe('C001') === '|C001|0|' && linhaDe('C990') === '|C990|3|');
check('9999 é o total de linhas do arquivo', linhaDe('9999') === `|9999|${L.length}|`);
const qtd9900 = L.filter((l) => l.startsWith('|9900|')).length;
check('o 9900 do 9900 conta a si mesmo', linhaDe('9900|9900') === `|9900|9900|${qtd9900}|`);
check('9990 = 9001 + os 9900 + 9990 + 9999', linhaDe('9990') === `|9990|${qtd9900 + 3}|`);
check('cada registro usado tem o seu 9900, e só ele',
  new Set(L.map((l) => l.split('|')[1])).size === qtd9900);
check('o texto termina em LF, sem CR', minimo.texto.endsWith('\n') && !minimo.texto.includes('\r'));
check('mandar um C990 de fora é erro',
  /escrito pelo gerador/.test(lanca(() => g.gerarEfd({ registro0000: R0000, blocos: { C: [{ REG: 'C990', QTD_LIN_C: '9' }] } }))));
check('registro no bloco errado é erro',
  /não pertence ao bloco C/.test(lanca(() => g.gerarEfd({ registro0000: R0000, blocos: { C: [{ REG: 'E100' }] } }))));
check('sem 0000 não há arquivo', /0000/.test(lanca(() => g.gerarEfd({ blocos: {} }))));

const lat = g.paraLatin1('São José — “ok”');
check('Latin-1: "ã" e "é" passam em um byte cada', lat.buffer.length === 'São José ? ?ok?'.length && lat.buffer[1] === 0xe3);
check('  e o que não cabe vira "?" e é CONTADO', lat.trocados.length === 3, lat.trocados.join(''));
check('o leitor lê o próprio gerador de volta, em Latin-1',
  g.lerEfd(g.paraLatin1(minimo.texto).buffer).length === L.length);

console.log('\n--- 4. a prova de volta: os SPEDs do sistema antigo ---');
// Cada arquivo é LIDO, devolvido ao gerador, e o resultado comparado CAMPO A
// CAMPO. Linha estrutural (x001, x990, 9xxx) é comparada EXATA: é o que o
// gerador escreve sozinho. Linha de dado é comparada pelo VALOR: o sistema
// antigo escrevia "282" e "0" em campos de duas casas, e "1,0000" num QTD de
// cinco; o gerador escreve "282,00", "0,00" e "1,00000". Mesmo número.
const pasta = process.env.SPED_ANTIGOS || path.join(os.homedir(), 'Downloads');
const arquivos = fs.existsSync(pasta) ? fs.readdirSync(pasta).filter((f) => /^sped01\d{6}-\d{8}\.txt$/.test(f)).sort() : [];

// O QUE O SISTEMA ANTIGO ERROU, achado por esta prova. Cada entrada é um fato
// conferido no arquivo, não uma tolerância: o teste exige que a divergência
// continue sendo exatamente esta.
const ERROS_DO_SISTEMA_ANTIGO = {
  // Setembro/2026: o Bloco K tem 67 linhas (K001, K100, 64 K200, K990) — o
  // próprio Bloco 9 dele soma 67 — e o K990 declara 68. Conferido em
  // 01/10/2026. O validador da Receita confere essa contagem.
  'sped01092026-30092026.txt': { K990: { declarado: '68', certo: '67' } }
};

if (!arquivos.length) {
  console.log(`  --  nenhum SPED do sistema antigo em ${pasta}; parte 4 PULADA (defina SPED_ANTIGOS)`);
} else {
  const estrutural = (reg) => /^.(001|990)$/.test(reg) || /^9/.test(reg);
  for (const nome of arquivos) {
    const original = fs.readFileSync(path.join(pasta, nome), 'utf8');
    const lidos = g.lerEfd(original);
    const gerado = g.gerarEfd(g.separarEmBlocos(lidos));
    const a = original.split('\n').filter(Boolean);
    const b = gerado.linhas;
    const esperado = ERROS_DO_SISTEMA_ANTIGO[nome] || {};
    const problemas = [];
    const achados = {};
    if (a.length !== b.length) problemas.push(`linhas ${a.length} x ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      const pa = a[i].split('|');
      const pb = b[i].split('|');
      const reg = pa[1];
      if (estrutural(reg)) {
        if (esperado[reg] && pa[2] === esperado[reg].declarado && pb[2] === esperado[reg].certo) { achados[reg] = true; continue; }
        problemas.push(`linha ${i + 1} (${reg}): ${a[i]} x ${b[i]}`);
        continue;
      }
      const campos = g.camposComChave(reg);
      for (let j = 1; j < campos.length; j++) {
        const x = pa[j + 1];
        const y = pb[j + 1];
        if (x === y) continue;
        const cp = campos[j];
        const mesmoNumero = cp.tipo === 'N' && cp.dec !== null && x !== '' && y !== ''
          && Number(x.replace(',', '.')) === Number(y.replace(',', '.'));
        // Espaço nas pontas sai: " SAL INFINITY" no NOME do 0000, desde abril.
        const mesmoTexto = x.trim() === y;
        if (!mesmoNumero && !mesmoTexto) problemas.push(`linha ${i + 1} ${reg}.${cp.chave}: "${x}" x "${y}"`);
      }
    }
    for (const reg of Object.keys(esperado)) if (!achados[reg]) problemas.push(`o erro conhecido do ${reg} não apareceu`);
    const notas = Object.keys(esperado).length ? ` (e o erro conhecido do ${Object.keys(esperado).join(', ')} confirmado)` : '';
    check(`${nome}: ${a.length} linhas, mesmo conteúdo${notas}`, problemas.length === 0, problemas.slice(0, 3).join(' | ') || undefined);
  }
}

console.log('\n--- 5. a apuração (lib/sped-apuracao.js) contra o E110 declarado ---');
// Do C190 de cada nota sai o E110 — é o que a apuração calcula. O DÉBITO e o
// DÉBITO ESPECIAL têm de bater com o que o sistema antigo declarou, mês a mês.
//
// O CRÉDITO NÃO BATE, E NÃO É DEFEITO DAQUI. Em todos os dez meses o sistema
// antigo declara VL_TOT_CREDITOS = 0,00, embora as notas de ENTRADA tenham
// ICMS no C190: R$ 252.937,06 nos dez meses. NEM TUDO ISSO É CRÉDITO — por
// CFOP, 1949 (outras entradas) é R$ 168.343,33 e 1403/2403 (compra com ST) é
// R$ 39.666,22; o que tem cara de compra comum (1102, 2102, 1101, 2106, 1411…)
// passa de R$ 30 mil. Ou a empresa tem um regime que veda o crédito (TTD de
// importação em SC, por exemplo — e aí o Guia pede o crédito escriturado e
// anulado por ajuste no E111, não omitido), ou crédito está sendo perdido. É
// pergunta para o contador, levantada em 01/10/2026; até a resposta, o teste
// MOSTRA a diferença e não a esconde.
if (arquivos.length) {
  const doMes = (nome) => nome.slice(8, 12) + '-' + nome.slice(6, 8); // sped01MMAAAA-… -> AAAA-MM
  const ordem = [...arquivos].sort((x, y) => doMes(x).localeCompare(doMes(y)));
  const ap = require('../lib/sped-apuracao');
  const zeros = { debitosDoDocumento: 0, debitosDaApuracao: 0, estornosDeCredito: 0, creditosDoDocumento: 0, creditosDaApuracao: 0, estornosDeDebito: 0 };
  let saldoAnterior = 0;
  const creditosOmitidos = [];
  for (const nome of ordem) {
    const lidos = g.lerEfd(fs.readFileSync(path.join(pasta, nome), 'utf8'));
    const docs = [];
    for (const r of lidos) {
      if (r.REG === 'C100') docs.push({ sentido: r.IND_OPER === '0' ? 'ENTRADA' : 'SAIDA', situacao: r.COD_SIT, linhas: [] });
      else if (r.REG === 'C190') docs[docs.length - 1].linhas.push(r);
    }
    const calc = ap.apuracaoE110(docs, { saldoCredorAnterior: saldoAnterior, ajustes: zeros, deducoes: 0 }).campos;
    const decl = lidos.find((r) => r.REG === 'E110');
    const igual = (k) => Math.abs((calc[k] || 0) - (decl[k] || 0)) < 0.005;
    check(`${nome}: débito ${decl.VL_TOT_DEBITOS.toFixed(2)} e DEB_ESP ${(decl.DEB_ESP || 0).toFixed(2)} batem`,
      igual('VL_TOT_DEBITOS') && igual('DEB_ESP'), `calculado ${calc.VL_TOT_DEBITOS} / ${calc.DEB_ESP}`);
    if (!igual('VL_TOT_CREDITOS')) creditosOmitidos.push(`${doMes(nome)}: ${calc.VL_TOT_CREDITOS.toFixed(2)}`);
    saldoAnterior = decl.VL_SLD_CREDOR_TRANSPORTAR || 0;
  }
  console.log(`  !!  crédito de ICMS das entradas que o sistema antigo declarou como 0,00 (${creditosOmitidos.length} de ${ordem.length} meses):`);
  for (const l of creditosOmitidos) console.log(`        ${l}`);
}

console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
