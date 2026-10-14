#!/usr/bin/env node
/**
 * CST 60 / CSOSN 500 — ICMS COBRADO ANTERIORMENTE POR ST (14/10/2026).
 *
 * Era recusado ("falta o grupo de ST retido"). O usuário pediu para emitir.
 * Campos conferidos em campos.focusnfe.com.br (NotaFiscalXML): vBCSTRet ->
 * icms_base_calculo_retido_st, pST -> icms_aliquota_final, vICMSSubstituto ->
 * icms_valor_substituto, vICMSSTRet -> icms_valor_retido_st; nenhum marcado
 * obrigatório lá.
 *
 * Provado pela prévia (sem emitir), com uma nota de entrada de teste do
 * ABACOOK (2 un., CST 10 do fornecedor: vBCST 10.400, pICMSST 17, vICMS 960,
 * vICMSST 808 — apagada depois): trocar o CST do item para 60 mostrou o grupo
 * "ICMS-ST retido" com base 5.200, pST 17, substituto 480 e retido 404 por
 * unidade vendida, sem ICMS próprio; digitar 400 no retido venceu.
 */
const fs = require('fs');
const path = require('path');
const B = require('../lib/nfePayloadBuilder');
const CST = require('../public/modules/shared/cst_icms');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const base = { descricao: 'X', ncm: '87116000', quantidade: 2, valorUnitario: 100, origem: 0 };
const regra60 = { cfop: '5405', cstIcms: '60', cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 };
const compra = { baseUnitaria: 61.1, valorUnitario: 4.155, aliquota: 17, substitutoUnitario: 6.8 };
const item = (extra) => B.buildNfeItemPayload({ ...base, regraFiscal: regra60, fiscal: {}, ...extra }, 0);

console.log('--- 1. o montador ---');
check('CST 60 deixou de ser recusado', CST.ehSuportado('60'));
const semCompra = item({});
check('sem compra com ST: só o CST (o grupo é omitível)',
  semCompra.icms_situacao_tributaria === '60' && !('icms_base_calculo_retido_st' in semCompra) && !('icms_base_calculo' in semCompra));
const comCompra = item({ stRetido: compra });
check('com a última compra: valores por unidade × quantidade',
  comCompra.icms_base_calculo_retido_st === 122.2 && comCompra.icms_valor_retido_st === 8.31
  && comCompra.icms_aliquota_final === 17 && comCompra.icms_valor_substituto === 13.6,
  JSON.stringify(comCompra));
check('  e sem ICMS próprio', !('icms_base_calculo' in comCompra) && !('icms_valor' in comCompra));
const digitado = item({ stRetido: compra, fiscal: { baseIcmsStRetido: 150, valorIcmsStRetido: 10 } });
check('digitado na aba Impostos vence a compra', digitado.icms_base_calculo_retido_st === 150 && digitado.icms_valor_retido_st === 10);
const soDigitado = item({ fiscal: { baseIcmsStRetido: 150, valorIcmsStRetido: 10 } });
check('  sem pST, vale a efetiva (retido ÷ base)', soDigitado.icms_aliquota_final === 6.67);
const csosn = B.buildNfeItemPayload({ ...base, regraFiscal: { ...regra60, cstIcms: '', csosn: '500' }, fiscal: {}, stRetido: compra }, 0);
check('CSOSN 500 leva o mesmo grupo', csosn.icms_situacao_tributaria === '500' && csosn.icms_valor_retido_st === 8.31);
const cst00 = B.buildNfeItemPayload({ ...base, regraFiscal: { ...regra60, cstIcms: '00', aliquotaIcms: 17 }, fiscal: {}, stRetido: compra }, 0);
check('outro CST ignora a compra', !('icms_base_calculo_retido_st' in cst00) && cst00.icms_valor === 34);
const previa = B.resumoFiscalDaPrevia({ items: [comCompra] }).itens[0];
check('a prévia mostra o grupo', previa.baseIcmsStRetido === 122.2 && previa.valorIcmsStRetido === 8.31 && previa.valorIcmsSubstituto === 13.6);
check('os quatro campos podem vir da aba Impostos',
  ['baseIcmsStRetido', 'aliquotaIcmsStRetido', 'valorIcmsSubstituto', 'valorIcmsStRetido'].every((c) => B.CAMPOS_FISCAIS_EDITAVEIS.includes(c)));

console.log('\n--- 2. de onde vêm os valores ---');
const servidor = ler('server.js');
const entradaDb = ler('lib/db/entrada-nfe.js');
const leitor = ler('lib/entradaNfe.js');
check('o servidor busca a última compra só para CST 60 / CSOSN 500',
  servidor.includes("if (produto && (cstDaNota === '500' || cstIcms.normalizar(cstDaNota) === '60')) {")
  && servidor.includes('item.stRetido = await entradaNfeDb.stRetidoDaUltimaEntrada(produto.id).catch(() => null);'));
check('a última entrada com ST, dividida pela quantidade comprada',
  entradaDb.includes('async function stRetidoDaUltimaEntrada(productId) {') && entradaDb.includes('order by e.data_emissao desc nulls last'));
check('a nota de entrada passa a guardar o ST retido do fornecedor',
  leitor.includes("baseStRetido: num(icmsNo, 'vBCSTRet'),") && leitor.includes("valorStRetido: num(icmsNo, 'vICMSSTRet')"));

console.log('\n--- 3. a tela ---');
const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('grupo "ICMS-ST retido" só com CST 60 / CSOSN 500',
  tela.includes("{ titulo: 'ICMS-ST retido', soComStRetido: true,")
  && tela.includes("!grupo.soComStRetido || ['60', '500'].includes(String(valorFiscal(item, linha, 'cstIcms')).trim())"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
