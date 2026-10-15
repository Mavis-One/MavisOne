#!/usr/bin/env node
/**
 * CEST NA ABA IMPOSTOS E IMPRESSO NA NOTA (15/10/2026). Pedido do usuário:
 * "na 4 aba de impostos preciso que apareça o campo de CEST e que isso esteja
 * destacado na NF".
 *
 * Provado no banco local e na prévia da Focus (DANFE sem valor fiscal, nada à
 * SEFAZ): produto 1406 (CEST 2804300 no cadastro) — o campo CEST aparece em
 * Impostos › Classificação, ao lado do NCM, com 2804300; a DANFE da Focus não
 * tinha coluna de CEST (só NCM) e passou a imprimir "CEST: 2804300" embaixo da
 * descrição; CEST digitado "12345" é recusado; "01.001.00" vira 0100100.
 */
const fs = require('fs');
const path = require('path');
const builder = require('../lib/nfePayloadBuilder');

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${!cond && extra ? ` -> ${extra}` : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

check('CEST é campo editável da aba Impostos', builder.CAMPOS_FISCAIS_EDITAVEIS.includes('cest')
  && builder.limparEdicaoFiscal({ cest: '2804300', inventado: 'x' }).cest === '2804300');

const item = (extra) => ({
  descricao: 'ADESIVO', codigoProduto: '1406', ncm: '35061010', quantidade: 1, valorUnitario: 10, origem: 0,
  regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 0 }, ...extra
});
const comCest = builder.buildNfeItemPayload(item({ cest: '2804300' }), 0);
check('vai no XML (cest)', comCest.cest === '2804300', JSON.stringify(comCest.cest));
check('  e impresso no item (infAdProd), que a DANFE da Focus mostra', comCest.informacoes_adicionais_item === 'CEST: 2804300', comCest.informacoes_adicionais_item);
const comObs = builder.buildNfeItemPayload(item({ cest: '2804300', regraFiscal: { cfop: '5102', cstIcms: '00', observacaoFisco: 'EMPRESA OPTANTE PELO SIMPLES' } }), 0);
check('  junto da observação do fisco da regra, sem apagá-la', comObs.informacoes_adicionais_item === 'EMPRESA OPTANTE PELO SIMPLES - CEST: 2804300', comObs.informacoes_adicionais_item);
const semCest = builder.buildNfeItemPayload(item({}), 0);
check('  sem CEST, o item não ganha texto', semCest.informacoes_adicionais_item === undefined && semCest.cest === undefined);
check('a prévia devolve o CEST de cada item', builder.resumoFiscalDaPrevia({ items: [comCest], }).itens[0].cest === '2804300');

const servidor = ler('server.js');
check('o CEST digitado vale como o NCM digitado (sobre o cadastro)',
  /if \(item\.fiscal\.ncm\) item\.ncm = [^\n]*\n[^\n]*\n\s*if \(item\.fiscal\.cest\) item\.cest = String\(item\.fiscal\.cest\)\.replace\(\/\\D\/g, ''\);/.test(servidor));
check('  e CEST que não tem 7 dígitos é recusado antes de transmitir', servidor.includes('o CEST tem 7 dígitos (informado: ${item.cest}).'));

const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('aba Impostos › Classificação: CEST ao lado do NCM, digitável como texto',
  tela.includes("{ titulo: 'Classificação', campos: [['cfop', 'CFOP'], ['ncm', 'NCM'], ['cest', 'CEST'],")
  && /const CAMPOS_DE_TEXTO = \['cfop', 'ncm', 'cest',/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
