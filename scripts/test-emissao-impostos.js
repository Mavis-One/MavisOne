#!/usr/bin/env node
/**
 * EMISSÃO DE NF-e: ABAS IMPOSTOS E TOTAIS, COM EDIÇÃO LIVRE (13/10/2026).
 *
 * Pedido do usuário: "a emissão de NF está simples demais" e "mesmo contando
 * com as novas regras fiscais eu quero ter 100% de liberação para poder editar
 * valores, principalmente os fiscais". A regra fiscal preenche; o que vem em
 * `item.fiscal` vence. Provado no navegador (banco local, regras da Marcolla):
 * ICMS do item 2 editado para 12% -> R$ 1.677,60; CFOP do item 1 -> 5405;
 * total do ICMS na aba Totais R$ 3.375,90. Nada transmitido.
 */
const fs = require('fs');
const path = require('path');
const B = require('../lib/nfePayloadBuilder');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const REGRA = { cfop: '5102', cstIcms: '00', aliquotaIcms: 17, cstPis: '01', aliquotaPis: 1.65, cstCofins: '01', aliquotaCofins: 7.6, cstIpi: '50', aliquotaIpi: 10 };
const montar = (fiscal, regra = REGRA) => B.buildNfePayload({
  estabelecimento: { cnpj: '43792899000135' }, empresa: {},
  destinatario: { nome: 'A', documento: '12935855990', uf: 'SC' },
  itens: [{ descricao: 'X', ncm: '87116000', quantidade: 1, valorUnitario: 1000, regraFiscal: regra, fiscal }],
  naturezaOperacao: 'Venda', pagamentos: []
});
const item = (fiscal, regra) => montar(fiscal, regra).items[0];

console.log('--- 1. sem edição, vale a regra ---');
const daRegra = item(undefined);
check('CFOP, CST e ICMS da regra', daRegra.cfop === '5102' && daRegra.icms_situacao_tributaria === '00' && daRegra.icms_valor === 170);
check('PIS e COFINS da regra', daRegra.pis_valor === 16.5 && daRegra.cofins_valor === 76);

console.log('\n--- 2. o editado vence ---');
const ed = item({ cfop: '5405', aliquotaIcms: 12, ncm: '87119000', origem: 2 });
check('CFOP editado', ed.cfop === '5405');
check('alíquota editada refaz o valor (1000 x 12%)', ed.icms_aliquota === 12 && ed.icms_valor === 120);
check('NCM e origem editados', ed.codigo_ncm === '87119000' && ed.icms_origem === 2);
const isenta = item({ cstIcms: '40' });
check('CST 40 monta o grupo de isenta: sem base, alíquota nem valor', isenta.icms_situacao_tributaria === '40' && !('icms_base_calculo' in isenta) && !('icms_valor' in isenta));
const sn = item({ csosn: '102' });
check('CSOSN apaga o CST (Simples)', sn.icms_situacao_tributaria === '102' && !('icms_aliquota' in sn));
const pis = item({ basePis: 500 });
check('base do PIS editada refaz o valor (500 x 1,65%)', pis.pis_base_calculo === 500 && pis.pis_valor === 8.25);
const pisValor = item({ basePis: 500, valorPis: 9.99 });
check('valor do PIS digitado vence a conta', pisValor.pis_valor === 9.99);
const cofins = item({ aliquotaCofins: 3 });
check('alíquota do COFINS editada', cofins.cofins_aliquota_porcentual === 3 && cofins.cofins_valor === 30);
const ipi = item({ aliquotaIpi: 5 });
check('alíquota do IPI editada (leva o CST que já valia)', ipi.ipi_situacao_tributaria === '50' && ipi.ipi_valor === 50);
const comSt = item({ cstIcms: '10', aliquotaIcmsSt: 17, mvaSt: 40, baseIcmsSt: 2000 }, { ...REGRA, cstIcmsSt: '10' });
check('ST: base editada refaz o valor menos o ICMS próprio', comSt.icms_base_calculo_st === 2000 && comSt.icms_valor_st === 170, `${comSt.icms_base_calculo_st} / ${comSt.icms_valor_st}`);
check('o total da nota soma o ST e o IPI editados', montar({ aliquotaIpi: 5 }).valor_total === 1050);

console.log('\n--- 3. só campos conhecidos chegam ao montador ---');
const limpo = B.limparEdicaoFiscal({ cfop: '5405', aliquotaIcms: '', inventado: 'x', valorPis: 0 });
check('vazio não vai (vazio = usar o da regra)', !('aliquotaIcms' in limpo));
check('campo desconhecido é descartado', !('inventado' in limpo));
check('zero é valor de verdade', limpo.valorPis === 0);
check('lista de campos sem nome novo da Focus (todos já usados pelo montador)', B.CAMPOS_FISCAIS_EDITAVEIS.length > 20);

console.log('\n--- 4. o resumo da prévia ---');
const r = B.resumoFiscalDaPrevia(montar({ aliquotaIcms: 12 }));
check('um resumo por item, com os valores montados', r.itens.length === 1 && r.itens[0].valorIcms === 120 && r.itens[0].cfop === '5102');
check('totais: ICMS, PIS e total da nota', r.totais.icms === 120 && r.totais.pis === 16.5 && r.totais.total === 1100, JSON.stringify(r.totais));

console.log('\n--- 5. servidor e tela ---');
const servidor = ler('server.js');
check('a rota da prévia monta pela MESMA preparação da emissão',
  /pathname === '\/api\/fiscal\/nfe\/previa' && req\.method === 'POST'[\s\S]{0,200}await prepararNfeParaTransmitir\(body\);[\s\S]{0,80}resumoFiscalDaPrevia\(payload\)/.test(servidor));
check('  e exige a permissão de emitir', /pathname === '\/api\/fiscal\/nfe\/previa'\) return 'emitir';/.test(servidor));
check('NCM e origem editados escolhem a regra', /item\.fiscal = limparEdicaoFiscal\(bruto\.fiscal\);\s*if \(item\.fiscal\.ncm\) item\.ncm/.test(servidor));
check('sem regra, CFOP e CST digitados bastam', /const digitouOEssencial = item\.fiscal\.cfop && \(item\.fiscal\.cstIcms \|\| item\.fiscal\.csosn\);/.test(servidor));
check('a edição fica na auditoria', /action: 'nfe\.valoresFiscaisEditados'/.test(servidor));
const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('abas Impostos e Totais', /data-tab="impostos"/.test(tela) && /data-tab="totais"/.test(tela));
check('a prévia e o envio usam o MESMO corpo', /montarCorpoDaNota\(formData, referencias\)/.test(tela) && /const body = montarCorpoDaNota\(formData, referenciasDevolucao\);/.test(tela));
check('o item leva o que foi editado', /fiscal: \{ \.\.\.item\.fiscal \}/.test(tela));
check('frete, seguro, desconto e outras editáveis na aba Totais', ['frete', 'seguro', 'desconto', 'outrasDespesas'].every((c) => tela.includes(`data-total-campo="${c}"`)));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
