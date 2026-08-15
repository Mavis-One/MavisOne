#!/usr/bin/env node
// Montagem do payload de NF-e — lib/nfePayloadBuilder.js
//
// É conta de imposto: errado aqui não dá erro de tela, dá nota autorizada com
// valor errado, e o conserto é carta de correção ou cancelamento. Os casos
// abaixo são os que a regra fiscal permite descrever e que o builder precisa
// traduzir sem inventar nada.
const path = require('path');
const { buildNfePayload } = require(path.join(__dirname, '..', 'lib', 'nfePayloadBuilder'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const ESTAB = {
  cnpj: '11222333000181', razaoSocial: 'Empresa Teste', logradouro: 'Rua A', numero: '100',
  bairro: 'Centro', municipio: 'São Paulo', uf: 'SP', cep: '01001000',
  codigoMunicipio: '3550308', inscricaoEstadual: '111222333'
};
const EMPRESA = { crt: 3 };
const DEST = {
  nome: 'Cliente Teste', documento: '99888777000166', uf: 'MG', contribuinte: true,
  logradouro: 'Rua B', numero: '50', bairro: 'Centro', municipio: 'Belo Horizonte', cep: '30110000'
};

// Item de R$ 1.000,00 (10 x 100) em todos os casos — facilita conferir a conta.
const item = (regra, extra = {}) => ({
  descricao: 'Produto', codigoProduto: 'SKU1', ncm: '84713012',
  quantidade: 10, valorUnitario: 100, unidadeComercial: 'UN', origem: 0,
  regraFiscal: regra, ...extra
});

const montar = (itens) => buildNfePayload({
  estabelecimento: ESTAB, empresa: EMPRESA, destinatario: DEST, itens,
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-10T10:00:00'
});
const primeiroItem = (regra, extra) => montar([item(regra, extra)]).items[0];

console.log('--- ICMS no regime normal ---');
const normal = primeiroItem({ cfop: '6102', cstIcms: '00', aliquotaIcms: 18, modalidadeBcIcms: 3 });
check('CST vai no campo de situação tributária', normal.icms_situacao_tributaria === '00');
check('base = valor bruto', normal.icms_base_calculo === 1000, String(normal.icms_base_calculo));
check('valor = 18% de 1000', normal.icms_valor === 180, String(normal.icms_valor));
check('modalidade da BC respeitada', normal.icms_modalidade_base_calculo === 3);

console.log('\n--- redução de base de cálculo ---');
// Reduzir 33,33% de 1000 dá base 666,70 e ICMS 120,01. O percentual precisa ir
// DECLARADO junto: mandar só a base reduzida faz a SEFAZ recalcular e acusar
// divergência.
const reduzido = primeiroItem({ cfop: '5102', cstIcms: '20', aliquotaIcms: 18, reducaoBcIcms: 33.33 });
check('base reduzida', reduzido.icms_base_calculo === 666.7, String(reduzido.icms_base_calculo));
check('percentual de redução declarado', reduzido.icms_reducao_base_calculo === 33.33);
check('ICMS calculado sobre a base REDUZIDA', reduzido.icms_valor === 120.01, String(reduzido.icms_valor));
const semReducao = primeiroItem({ cfop: '5102', cstIcms: '00', aliquotaIcms: 18 });
check('sem redução, o campo não aparece', semReducao.icms_reducao_base_calculo === undefined);

console.log('\n--- Simples Nacional usa CSOSN e não manda base/alíquota ---');
const simples = primeiroItem({ cfop: '5102', csosn: '102' });
check('CSOSN no campo de situação tributária', simples.icms_situacao_tributaria === '102');
check('sem base de cálculo', simples.icms_base_calculo === undefined);
check('sem alíquota', simples.icms_aliquota === undefined);

console.log('\n--- ICMS-ST ---');
// MVA 40% sobre 1000 = base ST 1400. ST a 18% = 252, menos o ICMS próprio
// (180) = 72 de imposto retido. Declarar 252 cobraria duas vezes.
const st = primeiroItem({ cfop: '6102', cstIcms: '10', aliquotaIcms: 18, cstIcmsSt: '10', mvaSt: 40, aliquotaIcmsSt: 18 });
check('base ST = bruto + MVA', st.icms_base_calculo_st === 1400, String(st.icms_base_calculo_st));
check('MVA declarada', st.icms_margem_valor_adicionado_st === 40);
check('modalidade da BC ST = 4 (MVA)', st.icms_modalidade_base_calculo_st === 4);
check('ST retido abate o ICMS próprio', st.icms_valor_st === 72, String(st.icms_valor_st));
const semSt = primeiroItem({ cfop: '5102', cstIcms: '00', aliquotaIcms: 18 });
check('sem CST de ST, nenhum campo de ST aparece', semSt.icms_valor_st === undefined && semSt.icms_base_calculo_st === undefined);
// ST menor que o próprio não vira crédito negativo na nota.
const stNegativo = primeiroItem({ cfop: '5102', cstIcms: '10', aliquotaIcms: 18, cstIcmsSt: '10', mvaSt: 0, aliquotaIcmsSt: 4 });
check('ST nunca fica negativo', stNegativo.icms_valor_st === 0, String(stNegativo.icms_valor_st));

console.log('\n--- IPI ---');
const ipi = primeiroItem({ cfop: '5101', cstIcms: '00', aliquotaIcms: 18, cstIpi: '50', aliquotaIpi: 10, codigoEnquadramentoIpi: '999' });
check('CST IPI', ipi.ipi_situacao_tributaria === '50');
check('valor = 10% de 1000', ipi.ipi_valor === 100, String(ipi.ipi_valor));
check('código de enquadramento vai junto', ipi.ipi_codigo_enquadramento_legal === '999');
// O enquadramento é obrigatório sempre que o grupo do IPI aparece — sem
// padrão, a nota é rejeitada por falta de campo.
const ipiSemCodigo = primeiroItem({ cfop: '5101', cstIpi: '50', aliquotaIpi: 10 });
check('sem código cadastrado, cai no padrão 999', ipiSemCodigo.ipi_codigo_enquadramento_legal === '999');
const semIpi = primeiroItem({ cfop: '5102', cstIcms: '00' });
check('sem CST de IPI, nenhum campo de IPI aparece', semIpi.ipi_valor === undefined && semIpi.ipi_situacao_tributaria === undefined);

console.log('\n--- PIS e COFINS ---');
const pisCofins = primeiroItem({ cfop: '5102', cstPis: '01', aliquotaPis: 1.65, cstCofins: '01', aliquotaCofins: 7.6 });
check('PIS 1,65% de 1000', pisCofins.pis_valor === 16.5, String(pisCofins.pis_valor));
check('COFINS 7,6% de 1000', pisCofins.cofins_valor === 76, String(pisCofins.cofins_valor));

console.log('\n--- alíquota ZERO é declarada, não omitida ---');
// A regra geral continua valendo para os impostos cujo grupo TEM alíquota:
// 0 é informação, não campo vazio. PIS com CST 07 (isento) é o caso.
const isento = primeiroItem({ cfop: '5102', cstIcms: '40', aliquotaIcms: 0, cstPis: '07', aliquotaPis: 0 });
check('PIS isento sai declarado com valor zero', isento.pis_situacao_tributaria === '07' && isento.pis_valor === 0);

// O ICMS é a EXCEÇÃO, e este teste afirmava o contrário. A versão anterior
// exigia icms_aliquota === 0 e icms_valor === 0 no CST 40, argumentando que
// sem eles "a nota sairia sem o grupo e seria rejeitada". Era hipótese,
// escrita antes de qualquer emissão real ter acontecido neste sistema.
//
// MEDIDO em homologação em 15/08/2026, emitindo com CST 40 e SEM esses
// campos: a SEFAZ não reclamou deles. Reclamou de outra coisa — "930: CST com
// beneficio fiscal e nao informado o codigo de beneficio fiscal". O grupo N06
// do layout (CST 40/41/50) não tem vBC, pICMS nem vICMS: declarar alíquota
// numa isenta é declarar imposto onde não há. Ver test-cst-icms.js.
check('CST 40 não leva alíquota', !('icms_aliquota' in isento), String(isento.icms_aliquota));
check('nem valor de ICMS', !('icms_valor' in isento), String(isento.icms_valor));
check('mas leva a situação tributária', isento.icms_situacao_tributaria === '40');

console.log('\n--- dados que vêm do CADASTRO do produto, não da regra ---');
const comProduto = primeiroItem(
  { cfop: '5102', csosn: '102', observacaoFisco: 'Documento emitido por ME optante pelo Simples Nacional.' },
  { cest: '2104100', ean: '7891234567890', unidadeComercial: 'CX', unidadeTributavel: 'UN' }
);
check('CEST vai no item', comProduto.cest === '2104100');
check('EAN vai como código de barras', comProduto.codigo_barras_comercial === '7891234567890');
check('unidade tributável pode diferir da comercial', comProduto.unidade_comercial === 'CX' && comProduto.unidade_tributavel === 'UN');
const semUnidTrib = primeiroItem({ cfop: '5102', csosn: '102' }, { unidadeComercial: 'CX' });
check('sem tributável própria, cai na comercial', semUnidTrib.unidade_tributavel === 'CX');
check('observação do fisco vai no item (infAdProd)', /Simples Nacional/.test(comProduto.informacoes_adicionais_item || ''));

console.log('\n--- grupo de pagamento (obrigatório no layout 4.0) ---');
// Nota sem este grupo é rejeitada. É a rejeição mais provável numa primeira
// integração, porque nada na tela obriga a preencher forma de pagamento.
const semPagamento = montar([item({ cfop: '5102', csosn: '102' })]);
check('sai um pagamento mesmo sem nada informado', Array.isArray(semPagamento.formas_pagamento) && semPagamento.formas_pagamento.length === 1);
check('e ele cobre o total da nota', semPagamento.formas_pagamento[0].valor_pagamento === 1000, String(semPagamento.formas_pagamento[0].valor_pagamento));
check('forma padrão é 99 (Outros)', semPagamento.formas_pagamento[0].forma_pagamento === '99');
const comPagamento = buildNfePayload({
  estabelecimento: ESTAB, empresa: EMPRESA, destinatario: DEST, itens: [item({ cfop: '5102', csosn: '102' })],
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-10T10:00:00',
  pagamentos: [{ forma: '17', valor: 600 }, { forma: '15', valor: 400 }]
});
check('duas formas viram duas linhas', comPagamento.formas_pagamento.length === 2);
check('PIX (17) preservado', comPagamento.formas_pagamento[0].forma_pagamento === '17');
check('forma inválida cai em 99 em vez de derrubar a nota',
  buildNfePayload({
    estabelecimento: ESTAB, empresa: EMPRESA, destinatario: DEST, itens: [item({ cfop: '5102', csosn: '102' })],
    naturezaOperacao: 'V', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-10T10:00:00',
    pagamentos: [{ forma: 'XX', valor: 1000 }]
  }).formas_pagamento[0].forma_pagamento === '99');

console.log('\n--- totais da nota ---');
// A SEFAZ confere o total contra a soma dos itens; não fechando, rejeita.
const comTotais = buildNfePayload({
  estabelecimento: ESTAB, empresa: EMPRESA, destinatario: DEST,
  itens: [item({ cfop: '5102', cstIcms: '00', aliquotaIcms: 17 })],
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-10T10:00:00',
  frete: 50, seguro: 10, outrasDespesas: 5, desconto: 15
});
check('valor dos produtos', comTotais.valor_produtos === 1000, String(comTotais.valor_produtos));
check('total = produtos + frete + seguro + outras − desconto', comTotais.valor_total === 1050, String(comTotais.valor_total));
check('com frete, modalidade 0 (por conta do emitente)', comTotais.modalidade_frete === 0);
check('sem frete, modalidade 9 (sem frete)', semPagamento.modalidade_frete === 9);
// ST e IPI entram no total da nota, não só no item.
const totalComSt = buildNfePayload({
  estabelecimento: ESTAB, empresa: EMPRESA, destinatario: DEST,
  itens: [item({ cfop: '6102', cstIcms: '10', aliquotaIcms: 12, cstIcmsSt: '10', mvaSt: 40, aliquotaIcmsSt: 17 })],
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-10T10:00:00'
});
check('ST soma no total da nota', totalComSt.valor_total === 1000 + totalComSt.items[0].icms_valor_st, String(totalComSt.valor_total));

console.log('\n--- SANTA CATARINA: Simples Nacional ---');
// CSOSN 102 (sem permissão de crédito) — o caso mais comum de revenda.
const snSemCredito = primeiroItem({ cfop: '5102', csosn: '102', cstPis: '49', aliquotaPis: 0, cstCofins: '49', aliquotaCofins: 0 });
check('não declara crédito quando o CSOSN não permite', snSemCredito.icms_valor_credito_simples === undefined);
check('PIS/COFINS do SN saem zerados mas declarados', snSemCredito.pis_valor === 0 && snSemCredito.cofins_valor === 0);
// CSOSN 101 — com permissão de crédito. O percentual vem da faixa do SN da
// empresa; sem declarar, o cliente perde um crédito a que tem direito.
const snComCredito = primeiroItem({ cfop: '5101', csosn: '101' }, { aliquotaCreditoSn: 2.56 });
check('CSOSN 101 declara a alíquota de crédito', snComCredito.icms_aliquota_credito_simples === 2.56);
check('e o valor do crédito (2,56% de 1000)', snComCredito.icms_valor_credito_simples === 25.6, String(snComCredito.icms_valor_credito_simples));
const sn101SemFaixa = primeiroItem({ cfop: '5101', csosn: '101' });
check('sem faixa cadastrada, não inventa crédito', sn101SemFaixa.icms_valor_credito_simples === undefined);

console.log('\n--- SANTA CATARINA: DIFAL (EC 87/2015) ---');
// SC vendendo para consumidor final não contribuinte em SP: interestadual 12%,
// interna do destino 18% → 6% de diferencial, 100% para o destino desde 2019.
const difal = primeiroItem(
  { cfop: '6108', cstIcms: '00', aliquotaIcms: 12, aliquotaInternaUfDestino: 18 },
  { difal: true }
);
check('base do DIFAL', difal.icms_base_calculo_uf_destino === 1000, String(difal.icms_base_calculo_uf_destino));
check('diferencial de 6% = R$ 60', difal.icms_valor_uf_destino === 60, String(difal.icms_valor_uf_destino));
check('partilha 100% destino, 0% remetente', difal.icms_valor_uf_remetente === 0);
check('alíquota interestadual declarada', difal.icms_aliquota_interestadual === 12);
// FCP do destino, quando o estado cobra.
const difalFcp = primeiroItem(
  { cfop: '6108', cstIcms: '00', aliquotaIcms: 12, aliquotaInternaUfDestino: 18, aliquotaFcpUfDestino: 2 },
  { difal: true }
);
check('FCP do destino = 2% de 1000', difalFcp.icms_valor_fcp_uf_destino === 20, String(difalFcp.icms_valor_fcp_uf_destino));
// O Simples é DISPENSADO do DIFAL (ADI 5.464 do STF).
const difalSimples = primeiroItem(
  { cfop: '6108', csosn: '102', aliquotaInternaUfDestino: 18 },
  { difal: true }
);
check('Simples Nacional NÃO monta partilha', difalSimples.icms_valor_uf_destino === undefined);
// Operação interna e venda para contribuinte não têm DIFAL.
const semDifal = primeiroItem({ cfop: '5102', cstIcms: '00', aliquotaIcms: 17, aliquotaInternaUfDestino: 18 });
check('sem a marca difal, nenhum campo de partilha', semDifal.icms_valor_uf_destino === undefined);

console.log('\n--- SANTA CATARINA: Lucro Presumido ---');
// Presumido é regime CUMULATIVO: PIS 0,65% e COFINS 3%, CST 01.
// (1,65% / 7,6% é Lucro Real, não-cumulativo — trocar os dois é erro comum.)
const presumido = primeiroItem({
  cfop: '5102', cstIcms: '00', aliquotaIcms: 17,
  cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3
});
check('PIS cumulativo 0,65% = R$ 6,50', presumido.pis_valor === 6.5, String(presumido.pis_valor));
check('COFINS cumulativo 3% = R$ 30,00', presumido.cofins_valor === 30, String(presumido.cofins_valor));
check('usa CST de ICMS, não CSOSN', presumido.icms_situacao_tributaria === '00' && presumido.icms_aliquota === 17);

console.log('\n--- cabeçalho da nota ---');
const nota = montar([item({ cfop: '6102', cstIcms: '00', aliquotaIcms: 18 })]);
check('CNPJ do destinatário quando tem 14 dígitos', nota.cnpj_destinatario === '99888777000166' && nota.cpf_destinatario === undefined);
const notaCpf = buildNfePayload({
  estabelecimento: ESTAB, empresa: EMPRESA, itens: [item({ cfop: '6102', csosn: '102' })],
  destinatario: { ...DEST, documento: '12345678901', contribuinte: false },
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-10T10:00:00'
});
check('CPF quando tem 11 dígitos', notaCpf.cpf_destinatario === '12345678901' && notaCpf.cnpj_destinatario === undefined);
check('não contribuinte vira indicador de IE 9', notaCpf.indicador_ie_destinatario === 9);
check('contribuinte vira indicador de IE 1', nota.indicador_ie_destinatario === 1);
check('regime tributário do emitente vem da empresa', nota.regime_tributario_emitente === 3);
check('itens numerados a partir de 1', nota.items[0].numero_item === 1);
check('valor bruto do item', nota.items[0].valor_bruto === 1000, String(nota.items[0].valor_bruto));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
