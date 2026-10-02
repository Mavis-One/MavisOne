#!/usr/bin/env node
/**
 * A CONFERÊNCIA DE UM SPED PRONTO (lib/sped-conferencia.js).
 *
 * Cada defeito é plantado num arquivo montado pelo gerador, e a conferência
 * tem de achá-lo E dizer se o corrigido o conserta. A fronteira é o que mais
 * importa: forma se corrige, valor não.
 *
 * A última parte usa o SPED de setembro/2026 do sistema antigo, se estiver em
 * ~/Downloads (ou SPED_ANTIGOS) — o arquivo onde o K990 errado foi achado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const g = require('../lib/sped-gerador');
const { conferirEfd } = require('../lib/sped-conferencia');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const codigos = (r) => r.problemas.map((p) => p.codigo);
const problema = (r, cod) => r.problemas.find((p) => p.codigo === cod);

// Um mês pequeno e CERTO: uma saída de R$ 1.000 a 17% (débito 170), uma
// entrada sem ICMS, E110 e E116 fechando.
function mes({ codVer = '020', nome = 'EMPRESA TESTE', e116 = 170, credito = 0, icmsEntrada = 0 } = {}) {
  return g.gerarEfd({
    registro0000: { REG: '0000', COD_VER: codVer, COD_FIN: '0', DT_INI: '01092026', DT_FIN: '30092026', NOME: nome, CNPJ: '43792899000135', UF: 'SC', IE: '261345958', COD_MUN: '4208906', IND_PERFIL: 'B', IND_ATIV: '1' },
    blocos: {
      C: [
        { REG: 'C100', IND_OPER: '1', IND_EMIT: '0', COD_PART: 'C1', COD_MOD: '55', COD_SIT: '00', SER: '1', NUM_DOC: '10', CHV_NFE: '4'.repeat(44), DT_DOC: '10092026', VL_DOC: 1000, VL_ICMS: 170 },
        { REG: 'C190', CST_ICMS: '000', CFOP: '5102', ALIQ_ICMS: 17, VL_OPR: 1000, VL_BC_ICMS: 1000, VL_ICMS: 170 },
        { REG: 'C100', IND_OPER: '0', IND_EMIT: '1', COD_PART: 'F1', COD_MOD: '55', COD_SIT: '00', SER: '1', NUM_DOC: '77', CHV_NFE: '5'.repeat(44), DT_DOC: '05092026', VL_DOC: 500, VL_ICMS: icmsEntrada },
        { REG: 'C190', CST_ICMS: '000', CFOP: '1102', ALIQ_ICMS: icmsEntrada ? 12 : 0, VL_OPR: 500, VL_BC_ICMS: icmsEntrada ? 500 : 0, VL_ICMS: icmsEntrada }
      ],
      E: [
        { REG: 'E100', DT_INI: '01092026', DT_FIN: '30092026' },
        { REG: 'E110', VL_TOT_DEBITOS: 170, VL_AJ_DEBITOS: 0, VL_TOT_AJ_DEBITOS: 0, VL_ESTORNOS_CRED: 0, VL_TOT_CREDITOS: credito, VL_AJ_CREDITOS: 0, VL_TOT_AJ_CREDITOS: 0, VL_ESTORNOS_DEB: 0, VL_SLD_CREDOR_ANT: 0, VL_SLD_APURADO: 170 - credito, VL_TOT_DED: 0, VL_ICMS_RECOLHER: 170 - credito, VL_SLD_CREDOR_TRANSPORTAR: 0, DEB_ESP: 0 },
        { REG: 'E116', COD_OR: '000', VL_OR: e116, DT_VCTO: '10102026', COD_REC: '144910014', MES_REF: '092026' }
      ],
      1: [{ REG: '1010', IND_EXP: 'N', IND_CCRF: 'N', IND_COMB: 'N', IND_USINA: 'N', IND_VA: 'N', IND_EE: 'N', IND_CART: 'N', IND_FORM: 'N', IND_AER: 'N', IND_GIAF1: 'N', IND_GIAF3: 'N', IND_GIAF4: 'N', IND_REST_RESSARC: 'N' }]
    }
  }).texto;
}
const latin = (t) => g.paraLatin1(t).buffer;
const utf8 = (t) => Buffer.from(t, 'utf8');

console.log('\n--- 1. o arquivo certo ---');
const certo = conferirEfd(latin(mes()), { nome: 'set.txt' });
check('nenhum problema', certo.problemas.length === 0, codigos(certo).join(' ') || 'nenhum');
check('ok', certo.ok === true);
check('e NÃO oferece "corrigido" — seria o mesmo arquivo com outro nome', certo.corrigido.base64 === null);
check('lê empresa, CNPJ e competência do 0000',
  certo.arquivo.competencia === '2026-09' && certo.arquivo.cnpj === '43792899000135' && certo.arquivo.empresa === 'EMPRESA TESTE');
check('conta as notas', certo.resumo.notas === 2 && certo.resumo.saidas === 1 && certo.resumo.entradas === 1);
check('a apuração refeita bate com a declarada', certo.apuracao.calculado.VL_TOT_DEBITOS === 170 && certo.apuracao.somaE116 === 170);

console.log('\n--- 2. o K990 de setembro: contagem errada se CORRIGE ---');
const comK = mes().replace('|K990|2|', '|K990|3|');
const k = conferirEfd(latin(comK), { nome: 'set.txt' });
const pk = problema(k, 'ESTRUTURA');
check('acha a contagem errada', pk && pk.gravidade === 'erro', pk && pk.itens.join(' '));
check('  e diz qual: "K990 declara 3 linhas; o bloco K tem 2"', pk && pk.itens[0] === 'K990 declara 3 linhas; o bloco K tem 2');
check('  marcada como corrigida, e o arquivo continua entregável (ok)', pk && pk.corrigido === true && k.ok === true);
const reconferido = conferirEfd(Buffer.from(k.corrigido.base64, 'base64'), { nome: 'set-corrigido.txt' });
check('o corrigido, conferido de novo, sai sem problema nenhum', reconferido.problemas.length === 0, codigos(reconferido).join(' ') || 'limpo');
check('  e se chama set-corrigido.txt', k.corrigido.nome === 'set-corrigido.txt');

console.log('\n--- 3. forma: decimais, espaço e codificação se corrigem ---');
const forma = mes({ nome: 'SÃO JOSÉ COMÉRCIO' })
  .replace('|C100|1|0|C1|55|00|1|10|', '|C100|1|0|C1|55|00|1|10|')
  .replace('|1000,00|', '|1000|')
  .replace('|0000|020|0|01092026|30092026|SÃO', '|0000|020|0|01092026|30092026| SÃO');
const f = conferirEfd(utf8(forma), { nome: 'f.txt' });
check('decimal sem casas é achado', Boolean(problema(f, 'DECIMAIS')), problema(f, 'DECIMAIS') && problema(f, 'DECIMAIS').itens.join(' '));
check('espaço no nome da empresa é achado', Boolean(problema(f, 'ESPACOS')));
check('UTF-8 é achado', Boolean(problema(f, 'CODIFICACAO')));
check('  os três corrigidos, e o arquivo segue ok', ['DECIMAIS', 'ESPACOS', 'CODIFICACAO'].every((c) => problema(f, c).corrigido) && f.ok);
const fBytes = Buffer.from(f.corrigido.base64, 'base64');
check('o corrigido sai em Latin-1: "Ã" é UM byte (0xC3), sem a sequência UTF-8', fBytes.includes(Buffer.from([0x53, 0xc3, 0x4f])), 'S Ã O');
check('  e o valor é o mesmo, com as casas', fBytes.toString('latin1').includes('|1000,00|'));

console.log('\n--- 4. conteúdo NÃO se corrige ---');
const v = conferirEfd(latin(mes({ codVer: '014' })), { nome: 'v.txt' });
check('versão do leiaute errada para o ano é erro', problema(v, 'COD_VER') && problema(v, 'COD_VER').gravidade === 'erro', problema(v, 'COD_VER') && problema(v, 'COD_VER').titulo);
check('  NÃO corrigida, e o arquivo deixa de estar ok', !problema(v, 'COD_VER').corrigido && v.ok === false);

const e = conferirEfd(latin(mes({ e116: 150 })), { nome: 'e.txt' });
check('E116 que não soma o ICMS a recolher é erro não corrigido',
  problema(e, 'E116') && !problema(e, 'E116').corrigido && e.ok === false, problema(e, 'E116') && problema(e, 'E116').titulo);

const cr = conferirEfd(latin(mes({ icmsEntrada: 60, credito: 0 })), { nome: 'c.txt' });
const pc = problema(cr, 'CREDITOS');
check('crédito declarado zero com ICMS na entrada é apontado', Boolean(pc), pc && pc.titulo);
check('  como atenção (decisão do contador), não como erro', pc && pc.gravidade === 'atencao' && !pc.corrigido);
check('  e o corrigido mantém o crédito declarado', !cr.corrigido.base64 || Buffer.from(cr.corrigido.base64, 'base64').toString('latin1').includes('|E110|170,00|0,00|0,00|0,00|0,00|'));
check('  com a lista por CFOP', pc && pc.itens[0].replace(/\s/g, ' ') === 'CFOP 1102: R$ 60,00', pc && pc.itens[0]);

console.log('\n--- 5. arquivo que não é SPED ---');
const lixo = conferirEfd(Buffer.from('isto não é um sped\n'), { nome: 'x.txt' });
check('é ilegível, sem conferência e sem corrigido', lixo.ok === false && problema(lixo, 'ILEGIVEL') && lixo.corrigido === null);
const meio = conferirEfd(latin(mes().replace('|C190|000|5102|', '|C190|000|')), { nome: 'm.txt' });
check('registro com campo a menos diz a linha', /linha \d+: C190/.test(problema(meio, 'ILEGIVEL').detalhe), problema(meio, 'ILEGIVEL').detalhe);

console.log('\n--- 6. o SPED de setembro/2026 do sistema antigo ---');
const pasta = process.env.SPED_ANTIGOS || path.join(os.homedir(), 'Downloads');
const setembro = path.join(pasta, 'sped01092026-30092026.txt');
if (!fs.existsSync(setembro)) {
  console.log(`  --  ${setembro} não existe; parte 6 PULADA`);
} else {
  const s = conferirEfd(fs.readFileSync(setembro), { nome: 'sped01092026-30092026.txt' });
  check('acha o K990', problema(s, 'ESTRUTURA') && problema(s, 'ESTRUTURA').itens.includes('K990 declara 68 linhas; o bloco K tem 67'));
  check('acha o crédito zerado', Boolean(problema(s, 'CREDITOS')));
  const s2 = conferirEfd(Buffer.from(s.corrigido.base64, 'base64'), { nome: 'x.txt' });
  check('o corrigido não tem mais erro de estrutura nem de forma',
    !s2.problemas.some((p) => p.corrigido), codigos(s2).join(' '));
  check('  e só sobra o que é do contador', codigos(s2).join(' ') === 'CREDITOS', codigos(s2).join(' '));
  check('  com os mesmos totais declarados',
    s2.apuracao.declarado.VL_TOT_DEBITOS === s.apuracao.declarado.VL_TOT_DEBITOS && s2.resumo.notas === s.resumo.notas);
}

console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
