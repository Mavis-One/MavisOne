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

console.log('\n--- 6. aba Transporte ---');
// Nomes conferidos em campos.focusnfe.com.br/nfe/NotaFiscalXML.html (13/10/2026).
const comTransporte = (transporte, extra = {}) => B.buildNfePayload({
  estabelecimento: { cnpj: '43792899000135' }, empresa: {},
  destinatario: { nome: 'A', documento: '12935855990', uf: 'SC' },
  itens: [{ descricao: 'X', ncm: '87116000', quantidade: 1, valorUnitario: 1000, regraFiscal: REGRA }],
  naturezaOperacao: 'Venda', pagamentos: [], transporte, ...extra
});
const tp = comTransporte({
  transportador: { documento: '11.222.333/0001-81', nome: '  Transportes   X ', inscricaoEstadual: '251.234.567', endereco: 'Rua A, 10', municipio: 'Joinville', uf: 'sc' },
  veiculo: { placa: 'abc-1d23', uf: 'sc', rntc: '12345678' },
  volumes: [{ quantidade: '2', especie: 'CAIXA', pesoBruto: '35.5' }, { especie: '' }]
}, { modalidadeFrete: 0 });
check('transportador com CNPJ só dígitos', tp.cnpj_transportador === '11222333000181' && !('cpf_transportador' in tp));
check('  nome, IE, endereço, município e UF', tp.nome_transportador === 'Transportes X' && tp.inscricao_estadual_transportador === '251234567'
  && tp.endereco_transportador === 'Rua A, 10' && tp.municipio_transportador === 'Joinville' && tp.uf_transportador === 'SC');
check('CPF vai no campo de CPF', comTransporte({ transportador: { documento: '129.358.559-90' } }).cpf_transportador === '12935855990');
check('veículo: placa sem traço, UF e RNTC', tp.veiculo_placa === 'ABC1D23' && tp.veiculo_uf === 'SC' && tp.veiculo_rntc === '12345678');
check('volumes: linha vazia descartada, números convertidos', tp.volumes.length === 1 && tp.volumes[0].quantidade === 2 && tp.volumes[0].peso_bruto === 35.5);
check('a modalidade escolhida vai junto', String(tp.modalidade_frete) === '0');
let placaRuim = null;
try { comTransporte({ veiculo: { placa: 'AB12' } }); } catch (erro) { placaRuim = erro; }
check('placa com tamanho errado é recusada antes da SEFAZ', placaRuim && placaRuim.status === 400);
const semNada = comTransporte(undefined);
check('sem transporte, nenhum campo do grupo', !Object.keys(semNada).some((k) => /transportador|veiculo_|^volumes$/.test(k)));
check('o servidor repassa o transporte ao montador', /transporte: body\.transporte,/.test(servidor));
check('o meta da NF-e traz as transportadoras', /pedeDiretorio === 'nfe' \? \{ transportadoras: transportadorasParaNfe\(data\) \}/.test(servidor));
check('a tela tem a aba e manda o grupo', /data-tab="transporte"/.test(tela) && /transporteDaNota\(\) \? \{ transporte: transporteDaNota\(\) \}/.test(tela));
check('a transportadora do pedido abre preenchida', /carrierId: formState\.carrierId \|\| '',/.test(ler('public/app.js'))
  && /if \(doPedido\.carrierId\) escolherTransportadora\(doPedido\.carrierId\);/.test(tela));

console.log('\n--- 6b. IBS/CBS editáveis na tela ---');
const ibs = B.resumoFiscalDaPrevia(montar({ cstIbsCbs: '000', classTrib: '000001', aliquotaIbsUf: 0.1, aliquotaIbsMun: 0, aliquotaCbs: 0.9 }));
check('CST e cClassTrib digitados chegam à nota mesmo sem a regra declarar',
  ibs.itens[0].cstIbsCbs === '000' && ibs.itens[0].classTrib === '000001');
check('  alíquotas refazem os valores (1000 x 0,1% e 0,9%)', ibs.itens[0].valorIbs === 1 && ibs.itens[0].valorCbs === 9);
check('  IBS do município zero vai como zero', ibs.itens[0].aliquotaIbsMun === 0);
check('  e os totais trazem IBS e CBS', ibs.totais.ibs === 1 && ibs.totais.cbs === 9);
check('a tela tem o grupo IBS/CBS com CST e cClassTrib',
  /titulo: 'IBS\/CBS', campos: \[\['cstIbsCbs', 'CST'\], \['classTrib', 'cClassTrib'\]/.test(tela));
// 14/10/2026: base e valor de todos os grupos travaram (test-impostos-cst-em-lista).
check('  e os valores são só leitura', /const CAMPOS_SO_LEITURA = \[[\s\S]*?'valorIbs', 'valorCbs'\s*\];/.test(tela));

console.log('\n--- 7. cobrança: fatura e duplicatas ---');
// Nomes conferidos em campos.focusnfe.com.br/nfe/NotaFiscalXML.html (13/10/2026).
const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const depois = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const cb = comTransporte(undefined, {
  dataEmissao: new Date().toISOString(),
  cobranca: { numeroFatura: '16333', valorDesconto: 10, duplicatas: [{ vencimento: amanha, valor: 400 }, { vencimento: depois, valor: '590' }, { vencimento: '', valor: 0 }] }
});
check('duplicatas numeradas 001, 002 (linha vazia fora)', cb.duplicatas.length === 2 && cb.duplicatas[0].numero === '001' && cb.duplicatas[1].numero === '002');
check('  com data_vencimento e valor', cb.duplicatas[1].data_vencimento === depois && cb.duplicatas[1].valor === 590);
check('fatura: líquido = soma, original = soma + desconto',
  cb.numero_fatura === '16333' && cb.valor_liquido_fatura === 990 && cb.valor_original_fatura === 1000 && cb.valor_desconto_fatura === 10);
check('sem duplicata, nenhum campo de fatura', !Object.keys(comTransporte(undefined, { cobranca: { numeroFatura: '1' } })).some((k) => /fatura|duplicatas/.test(k)));
let vencida = null;
try { B.grupoCobranca({ duplicatas: [{ vencimento: '2026-10-01', valor: 5 }] }, '2026-10-13T12:00:00Z'); } catch (erro) { vencida = erro; }
check('vencimento antes da emissão é recusado antes da SEFAZ', vencida && vencida.status === 400);
// 22h30 em Brasília já é amanhã em UTC: vencer "hoje" não pode ser recusado.
check('  a data da emissão é a de Brasília, não a UTC',
  B.grupoCobranca({ duplicatas: [{ vencimento: '2026-10-13', valor: 5 }] }, '2026-10-14T01:30:00Z').duplicatas.length === 1);
check('duplicatas acima do total da nota são recusadas', /excedem/.test(B.conferirCobrancaDaNota({ valor_total: 100, duplicatas: [{ valor: 150 }] })));
check('  abaixo (entrada à vista) passam', B.conferirCobrancaDaNota({ valor_total: 100, duplicatas: [{ valor: 60 }] }) === '');
check('o servidor repassa e confere a cobrança', /cobranca: body\.cobranca,/.test(servidor) && /const cobrancaExcede = conferirCobrancaDaNota\(payload\);/.test(servidor));

// Na nota avulsa, as duplicatas viram o contas a receber.
const corpo = (nome) => (new RegExp(`function ${nome}\\([\\s\\S]*?\\n\\}`).exec(servidor) || [''])[0];
const parcelasDaNfeAvulsa = new Function('buildNfeInstallments', `${corpo('parcelasDaNfeAvulsa')}; return parcelasDaNfeAvulsa;`)(() => [{ number: 1, dueDate: 'x', amount: 0 }]);
const avulsa = parcelasDaNfeAvulsa({ duplicatas: [{ vencimento: '2026-11-13', valor: 300 }, { vencimento: '2026-12-13', valor: 300 }] }, 1000, '2026-10-13');
check('avulsa: entrada na emissão + as duas duplicatas', avulsa.length === 3 && avulsa[0].amount === 400 && avulsa[0].dueDate === '2026-10-13' && avulsa[2].dueDate === '2026-12-13', JSON.stringify(avulsa));
check('  sem duplicatas, o parcelamento de sempre', parcelasDaNfeAvulsa({ tipo: 'avista' }, 1000, '2026-10-13')[0].dueDate === 'x');
check('  e a condição guarda as duplicatas', /\.\.\.\(duplicatas\.length \? \{ duplicatas \} : \{\}\)/.test(corpo('condicaoPagamentoDoBody')));
check('a tela manda a cobrança e o pedido leva o vencimento',
  /cobrancaDaNota\(\) \? \{ cobranca: cobrancaDaNota\(\) \}/.test(tela) && /vencimento: linha\.dueDate \|\| '',/.test(ler('public/app.js')));
check('  cartão não vira duplicata', /!FORMAS_DE_CARTAO\.includes\(linha\.forma\)/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
