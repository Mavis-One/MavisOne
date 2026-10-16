#!/usr/bin/env node
/**
 * EMISSÃO DE NF-e: BASE E VALOR DOS IMPOSTOS VOLTAM A SE DIGITAR (16/10/2026).
 * Pedido do usuário: "permita edição no campo de valor das NF em emissão ou em
 * edição" — escolhido "Valores dos impostos" (base e valor de ICMS, ICMS-ST,
 * IPI, PIS, COFINS e IBS/CBS), que estavam só leitura desde 14/10.
 *
 * Os campos vêm calculados pela prévia e aceitam o digitado, que vale na nota
 * (aplicarValoresEditados). Trocar a alíquota ou a base devolve o valor ao
 * cálculo; esvaziar o campo também. O IBS/CBS ganhou o mesmo tratamento no
 * servidor (antes o digitado era descartado e o valor era sempre calculado).
 * A alteração em massa continua sem base e valor (poria o mesmo em todos).
 *
 * Provado: na prévia do servidor, o mesmo item deu ICMS 17,00 / PIS 0,65 / CBS
 * 0,90 calculados e 9,99 / 0,50 / 1,23 digitados, com os totais acompanhando;
 * na tela, PIS calculado 1,95 → digitado 12,34 (marcado como editado, e ficou
 * depois da prévia refeita) → alíquota trocada para 1% → 3,00 de novo.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const { buildNfePayload } = require(path.join(RAIZ, 'lib/nfePayloadBuilder'));

const montar = (fiscal) => buildNfePayload({
  estabelecimento: { cnpj: '43792899000135', razaoSocial: 'X', uf: 'SC', municipio: 'J', codigoMunicipio: '4208906', logradouro: 'R', numero: '1', bairro: 'C', cep: '89251000', inscricaoEstadual: '123' },
  empresa: { crt: 3, regimeTributario: 'LUCRO_PRESUMIDO' },
  destinatario: { nome: 'C', documento: '11144477735', uf: 'SC', contribuinte: false },
  itens: [{
    codigoProduto: 'P1', descricao: 'Produto', ncm: '87116000', quantidade: 1, valorUnitario: 1000, unidadeComercial: 'UN', origem: 0,
    regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 17, cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3, cstIbsCbs: '000', classTrib: '000001', aliquotaIbsUf: 0.1, aliquotaIbsMun: 0, aliquotaCbs: 0.9 },
    fiscal
  }],
  naturezaOperacao: 'Venda', dataEmissao: '2026-10-16T10:00:00-03:00', ambiente: 'producao'
}).items[0];

console.log('\n--- o servidor usa o digitado ---');
const calculado = montar(undefined);
const digitado = montar({ valorIcms: 150, baseIcms: 900, valorPis: 5, valorIbs: 2.5, valorCbs: 12 });
check('sem digitar, o calculado', calculado.icms_valor === 170 && calculado.pis_valor === 6.5 && calculado.ibs_valor_total === 1 && calculado.cbs_valor === 9,
  JSON.stringify({ icms: calculado.icms_valor, pis: calculado.pis_valor, ibs: calculado.ibs_valor_total, cbs: calculado.cbs_valor }));
check('base e valor do ICMS digitados', digitado.icms_base_calculo === 900 && digitado.icms_valor === 150);
check('valor do PIS digitado', digitado.pis_valor === 5);
check('IBS digitado: total = UF + município (a diferença fica na UF)', digitado.ibs_valor_total === 2.5 && digitado.ibs_uf_valor === 2.5 && digitado.ibs_mun_valor === 0);
check('CBS digitada', digitado.cbs_valor === 12);
const soBase = montar({ basePis: 500 });
check('só a base digitada: o valor sai da base × alíquota', soBase.pis_base_calculo === 500 && soBase.pis_valor === 3.25, `${soBase.pis_base_calculo} / ${soBase.pis_valor}`);
const builder = fs.readFileSync(path.join(RAIZ, 'lib/nfePayloadBuilder.js'), 'utf8');
check('valorIbs e valorCbs entram na lista do que a tela pode mandar', /'valorIbs', 'valorCbs',/.test(builder));

console.log('\n--- a tela ---');
const tela = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/modules/finance/subs/emitir_nfe_focus.js'), 'utf8'));
const campoFiscal = tela.slice(tela.indexOf('function campoFiscal('), tela.indexOf('function valorFiscal('));
check('nenhum campo de imposto só leitura', campoFiscal.length > 100 && !/readonly/.test(campoFiscal));
check('trocar alíquota ou base apaga o valor digitado daquele imposto', /\(RECALCULA\[campo\] \|\| \[\]\)\.forEach/.test(tela)
  && /aliquotaPis: \['basePis', 'valorPis'\]/.test(tela) && /aliquotaIbsUf: \['valorIbs'\]/.test(tela));
check('esvaziar o campo devolve ao cálculo', /\} else if \(valor === ''\) \{\s*delete item\.fiscal\[campo\];/.test(tela));
check('a alteração em massa continua sem base e valor', /\.filter\(\(\[campo\]\) => !CAMPOS_CALCULADOS\.includes\(campo\)\)/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
