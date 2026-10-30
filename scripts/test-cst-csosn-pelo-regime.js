#!/usr/bin/env node
/**
 * CST OU CSOSN PELO REGIME DO EMITENTE (30/10/2026).
 *
 *   node scripts/test-cst-csosn-pelo-regime.js
 *
 * Uma NF-e da Electric (Simples Nacional, CRT 1) voltou recusada: "590 -
 * Informado CST para emissor do Simples Nacional (CRT=1 ou 4)". As regras da
 * Electric são CSOSN 102; o CST veio da aba Impostos (escolhido com outro
 * emitente, ou preso na lista, que só oferecia CST quando o código era CST).
 *
 * 1. O servidor barra antes de enviar (conferirRegimeDoIcms), menos na prévia.
 * 2. Regra com CST e CSOSN (a TRANSFERENCIA 5409 da Plus) usa o do regime.
 * 3. A tela: lista pelo regime do emitente; o código do outro regime sai.
 */
const fs = require('fs');
const path = require('path');
const {
  conferirRegimeDoIcms, buildNfeItemPayload
} = require('../lib/nfePayloadBuilder');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- 1. a conferência antes de enviar ---');
const nota = (crt, codigos) => ({
  regime_tributario_emitente: crt,
  items: codigos.map((c, i) => ({ numero_item: i + 1, descricao: `ITEM ${i + 1}`, icms_situacao_tributaria: c }))
});
const simplesComCst = conferirRegimeDoIcms(nota(1, ['102', '00']));
check('Simples com CST: barrada, dizendo o item e o código', /Simples Nacional/.test(simplesComCst) && /item 2 \(ITEM 2\) com CST 00/.test(simplesComCst));
check('  e dizendo o CSOSN de venda (102) e do ST retido (500)', /102/.test(simplesComCst) && /500/.test(simplesComCst));
check('  o item com CSOSN não entra na lista', !/item 1/.test(simplesComCst));
check('Simples só com CSOSN passa', conferirRegimeDoIcms(nota(1, ['102', '500', '900'])) === '');
check('MEI (CRT 4) segue o Simples', Boolean(conferirRegimeDoIcms(nota(4, ['40']))) && conferirRegimeDoIcms(nota(4, ['102'])) === '');
check('Lucro Presumido com CSOSN: barrada', /não é do Simples/.test(conferirRegimeDoIcms(nota(3, ['00', '102']))));
check('Lucro Presumido só com CST passa', conferirRegimeDoIcms(nota(3, ['00', '60', '41'])) === '');
check('CRT desconhecido não barra', conferirRegimeDoIcms(nota(undefined, ['00'])) === '');

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('a emissão confere antes de transmitir',
  /const regimeTrocado = opcoes\.semConferirRegime \? '' : conferirRegimeDoIcms\(payload\);\s*if \(regimeTrocado\) \{\s*const err = new Error\(regimeTrocado\);\s*err\.status = 400;/.test(srv));
check('  menos na prévia da aba Impostos (é nela que se corrige)',
  /'\/api\/fiscal\/nfe\/previa'[\s\S]{0,400}semConferirRegime: true/.test(srv));

console.log('\n--- 2. regra com CST e CSOSN ---');
const regraDupla = { cfop: '5409', cstIcms: '60', csosn: '500' };
const item = (simplesNacional, fiscal = {}) => buildNfeItemPayload({
  descricao: 'X', ncm: '87149990', quantidade: 1, valorUnitario: 10, regraFiscal: regraDupla, fiscal,
  ...(simplesNacional === undefined ? {} : { simplesNacional })
}, 0);
check('emitente fora do Simples usa o CST', item(false).icms_situacao_tributaria === '60', item(false).icms_situacao_tributaria);
check('emitente do Simples usa o CSOSN', item(true).icms_situacao_tributaria === '500', item(true).icms_situacao_tributaria);
check('sem saber o regime, como antes (CSOSN)', item(undefined).icms_situacao_tributaria === '500');
check('o digitado na aba Impostos continua valendo', item(false, { cstIcms: '10' }).icms_situacao_tributaria === '10');
check('a emissão diz o regime de cada item', /simplesNacional: \[1, 4\]\.includes\(Number\(empresa\.crt\)\)/.test(srv));

console.log('\n--- 3. a tela de emissão ---');
const tela = fs.readFileSync(path.join(__dirname, '..', 'public/modules/finance/subs/emitir_nfe_focus.js'), 'utf8');
check('guarda o CRT de cada empresa', /crtPorEmpresa = resEmpresas\.status === 'fulfilled'\s*\? new Map\(\(resEmpresas\.value\.empresas \|\| \[\]\)\.map\(\(emp\) => \[emp\.id, emp\.crt\]\)\)/.test(tela));
check('a lista do ICMS segue o regime do emitente',
  /grupos = regime === 'simples' \? csosn\s*: regime === 'normal' \? cst/.test(tela));
check('  o código do outro regime aparece marcado como inválido', /CST não vale no Simples: escolha um CSOSN/.test(tela));
check('o código digitado do outro regime sai antes da prévia', /previaAguardando = '';\s*desfazerCodigoDoOutroRegime\(\);/.test(tela)
  && /const campo = regime === 'simples' \? 'cstIcms' : 'csosn';/.test(tela));
// O regime pela empresa do emitente, rodando a função de verdade.
const fonte = /function regimeDoEmitente\([\s\S]*?\n  \}/.exec(tela);
check('achei regimeDoEmitente', Boolean(fonte));
if (fonte) {
  // eslint-disable-next-line no-new-func
  const regime = new Function('estabelecimentos', 'crtPorEmpresa', 'selectedEstabelecimentoId', `${fonte[0]}\nreturn regimeDoEmitente;`)(
    [{ id: 'e1', empresaId: 'electric' }, { id: 'e2', empresaId: 'plus' }, { id: 'e3', empresaId: 'sem-crt' }],
    new Map([['electric', 1], ['plus', 3]]), 'e1');
  check('  Electric (CRT 1) é simples, Plus (CRT 3) é normal, sem CRT não se sabe',
    regime('e1') === 'simples' && regime('e2') === 'normal' && regime('e3') === '' && regime() === 'simples');
}

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
