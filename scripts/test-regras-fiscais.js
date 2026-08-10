#!/usr/bin/env node
// Modelo de regras fiscais — scripts/seed-regras-fiscais.js
//
// Os CFOPs vieram do ERP que o usuário usa hoje: 5102, 5405, 6108 e 6403.
// Todos são "adquirida ou recebida de terceiros", ou seja, REVENDA.
//
// O que dá errado aqui não estoura na tela: gera uma nota AUTORIZADA com
// imposto errado, e isso só aparece na apuração — quando o prazo de
// cancelamento já passou. Os erros que este teste procura:
//
//   1. PIS/COFINS não-cumulativo (1,65%/7,6%) num regime cumulativo. É o
//      valor que aparece na maioria dos exemplos, e está errado para o
//      Lucro Presumido.
//   2. Alíquota de ICMS chutada em vez de deixada em branco para o contador.
//   3. CST 60 / CSOSN 500 saindo com alíquota nula em vez de ZERO — em ST já
//      retido, 0% é o valor correto, não "não preenchido".
//   4. DIFAL montado para o Simples, que é dispensado dele (ADI 5.464).
//   5. Regra de ST sem NCM, competindo de igual para igual com a venda comum.
//   6. IPI numa operação de revenda.
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, 'seed-regras-fiscais.js'), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Isola as funções de montagem: o script tem require de banco e um IIFE que
// roda na carga, e nada disso é necessário para conferir a matriz de regras.
function carregar(ncms) {
  const inicio = fonte.indexOf('const hoje =');
  const fim = fonte.indexOf('(async () => {');
  const corpo = `const ncmSt = NCMS;\n${fonte.slice(inicio, fim)}\nreturn { regrasRegimeNormal, regrasSimples };`;
  return new Function('NCMS', corpo)(ncms);
}

const semSt = carregar([]);
const comSt = carregar(['84713012']);
const acha = (regras, cfop) => regras.find((r) => r.cfop === cfop);

console.log('--- Lucro Presumido é CUMULATIVO ---');
const presumido = semSt.regrasRegimeNormal();
presumido.forEach((r) => {
  check(`CFOP ${r.cfop}: PIS 0,65% CST 01`, r.cstPis === '01' && r.aliquotaPis === 0.65, `${r.cstPis} / ${r.aliquotaPis}`);
  check(`CFOP ${r.cfop}: COFINS 3,00% CST 01`, r.cstCofins === '01' && r.aliquotaCofins === 3.0, `${r.cstCofins} / ${r.aliquotaCofins}`);
});
// O erro clássico: copiar as alíquotas do Lucro Real.
const temNaoCumulativo = presumido.some((r) => r.aliquotaPis === 1.65 || r.aliquotaCofins === 7.6);
check('não usa as alíquotas do Lucro Real', !temNaoCumulativo);

console.log('\n--- Simples recolhe PIS/COFINS no DAS ---');
const simples = semSt.regrasSimples();
simples.forEach((r) => {
  check(`CFOP ${r.cfop}: CST 49, alíquota zero`, r.cstPis === '49' && r.aliquotaPis === 0 && r.cstCofins === '49');
});

console.log('\n--- revenda não destaca IPI ---');
// Quem destaca IPI é indústria ou importador. Os quatro CFOPs em uso são de
// mercadoria adquirida de terceiros.
comSt.regrasRegimeNormal().concat(comSt.regrasSimples()).forEach((r) => {
  check(`CFOP ${r.cfop}: sem IPI`, !r.cstIpi && !r.aliquotaIpi, r.cstIpi || 'nenhum');
});

console.log('\n--- CST x CSOSN: o regime decide a linguagem da nota ---');
presumido.forEach((r) => check(`CFOP ${r.cfop} usa CST, não CSOSN`, Boolean(r.cstIcms) && !r.csosn, r.cstIcms));
simples.forEach((r) => check(`CFOP ${r.cfop} usa CSOSN, não CST`, Boolean(r.csosn) && !r.cstIcms, r.csosn));

console.log('\n--- cada CFOP no seu lugar ---');
check('5102 é dentro do estado', acha(presumido, '5102').dentroDoEstado === true);
check('5102 tributa integralmente (CST 00)', acha(presumido, '5102').cstIcms === '00');
check('6108 é fora do estado', acha(presumido, '6108').dentroDoEstado === false);
// O CFOP 6108 já diz "destinada a não contribuinte" no nome: travar o critério
// impede que uma venda a contribuinte caia nesta regra.
check('6108 exige destinatário NÃO contribuinte', acha(presumido, '6108').destinatarioContribuinte === false);
check('6108 no Simples também', acha(simples, '6108').destinatarioContribuinte === false);

console.log('\n--- ST já retido: alíquota é ZERO, não "em branco" ---');
const st5405 = acha(comSt.regrasRegimeNormal(), '5405');
check('5405 usa CST 60', st5405.cstIcms === '60');
check('5405 tem alíquota 0 explícita', st5405.aliquotaIcms === 0, String(st5405.aliquotaIcms));
check('5405 no Simples usa CSOSN 500', acha(comSt.regrasSimples(), '5405').csosn === '500');

console.log('\n--- 6403: aqui ele é o substituto, quem retém ---');
const st6403 = acha(comSt.regrasRegimeNormal(), '6403');
check('6403 usa CST 10 (tributada com ST)', st6403.cstIcms === '10');
check('6403 declara os campos de ST', 'mvaSt' in st6403 && 'aliquotaIcmsSt' in st6403);
check('6403 vai para contribuinte', st6403.destinatarioContribuinte === true);
check('6403 no Simples usa CSOSN 202', acha(comSt.regrasSimples(), '6403').csosn === '202');

console.log('\n--- regra de ST sem NCM não é criada ---');
// Uma regra de ST com NCM nulo teria a MESMA especificidade da venda comum, e
// qual das duas venceria passaria a depender de desempate.
check('sem --ncm-st, não existe 5405', !acha(presumido, '5405'));
check('sem --ncm-st, não existe 6403', !acha(presumido, '6403'));
check('com NCM, as duas aparecem', Boolean(st5405) && Boolean(st6403));
check('e carregam o NCM', st5405.ncm === '84713012' && st6403.ncm === '84713012');
// Especificidade maior tem que vir acompanhada de prioridade maior, senão a
// regra genérica pode ganhar por empate.
check('ST tem prioridade acima da venda comum', st5405.prioridade > acha(presumido, '5102').prioridade, `${st5405.prioridade} > ${acha(presumido, '5102').prioridade}`);

console.log('\n--- DIFAL: existe no regime normal, não no Simples ---');
// ADI 5.464 do STF: o Simples é dispensado do DIFAL.
const difalSimples = acha(simples, '6108');
check('Simples não declara alíquota interna de destino', !('aliquotaInternaUfDestino' in difalSimples));
check('Simples não declara FCP', !('aliquotaFcpUfDestino' in difalSimples));
const difalNormal = acha(presumido, '6108');
check('regime normal declara os campos de DIFAL', 'aliquotaInternaUfDestino' in difalNormal && 'aliquotaFcpUfDestino' in difalNormal);

console.log('\n--- nenhuma alíquota de ICMS é chutada ---');
// Alíquota interna de SC varia por NCM (17%, 12%, 25%) e a interestadual
// depende da UF de destino. Inventar um número gera imposto errado numa nota
// que já foi autorizada.
[...presumido, ...simples, ...comSt.regrasRegimeNormal()].forEach((r) => {
  const precisaContador = ['5102', '6108', '6403'].includes(r.cfop) && !r.csosn;
  if (!precisaContador) return;
  check(`CFOP ${r.cfop}: alíquota de ICMS em branco`, r.aliquotaIcms === null, String(r.aliquotaIcms));
});
const pendentes = [...presumido, ...comSt.regrasRegimeNormal()].flatMap((r) => r._pendencias || []);
check('as pendências são declaradas, não silenciosas', pendentes.length > 0, `${pendentes.length} campo(s)`);
check('a pendência de DIFAL está nomeada', pendentes.some((p) => /DIFAL|UF de destino/i.test(p)));
check('a pendência de MVA está nomeada', pendentes.some((p) => /MVA/i.test(p)));

console.log('\n--- vigência e tipo de operação ---');
[...presumido, ...simples].forEach((r) => {
  check(`CFOP ${r.cfop}: tipo VENDA`, r.tipoOperacao === 'VENDA');
  check(`CFOP ${r.cfop}: tem vigência`, /^\d{4}-\d{2}-\d{2}$/.test(r.vigenciaInicio || ''), r.vigenciaInicio);
});

console.log('\n--- o script não grava sem ser mandado ---');
check('exige --aplicar para escrever', /if \(aplicar\) \{/.test(fonte));
check('avisa quando não gravou', /Nada foi gravado/.test(fonte));
check('não duplica regra existente', /já existe uma regra com este CFOP\/NCM/.test(fonte));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
