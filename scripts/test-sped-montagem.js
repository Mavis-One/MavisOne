#!/usr/bin/env node
/**
 * A ESCRITURAÇÃO DO MÊS (lib/sped-montagem.js) — documentos -> registros.
 *
 * Os documentos são montados à mão (hoje há 0 notas no banco) e a nota de
 * entrada sai do XML de exemplo por lib/sped-documento.js, o mesmo caminho que
 * a entrada de verdade vai fazer. A última parte passa o arquivo gerado pela
 * conferência (lib/sped-conferencia.js): o que este sistema gera tem de sair
 * LIMPO na tela que confere o SPED dos outros.
 */

const fs = require('fs');
const path = require('path');
const { montarEscrituracao, cstIcms } = require('../lib/sped-montagem');
const { documentoDoXml, cfopDeEntrada } = require('../lib/sped-documento');
const g = require('../lib/sped-gerador');
const { conferirEfd } = require('../lib/sped-conferencia');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const cods = (lista) => lista.map((x) => x.codigo).join(' ');

const ESTAB = {
  cnpj: '52998224725000', razao_social: 'MINHA EMPRESA LTDA', nome_fantasia: 'MINHA', inscricao_estadual: '2551119999',
  codigo_municipio: '4216602', uf: 'SC', cep: '88103100', logradouro: 'AVENIDA CENTRAL', numero: '200', bairro: 'CENTRO',
  telefone: '4833334444', email: 'x@y.com', perfil_sped: 'B', indicador_atividade: 1
};
const EMPRESA = { regime_tributario: 'LUCRO_PRESUMIDO' };
const CONFIG = {
  contador_nome: 'FULANO CONTADOR', contador_cpf: '11144477735', contador_crc: 'SC-012345/O', contador_codigo_municipio: '4209102',
  credito_icms_entradas: 'DESTACADO', e116_codigo_receita: '144910014', e116_dia_vencimento: 10, indicadores_1010: {}
};

// A entrada: o XML de exemplo, como a entrada de NF-e o guardaria.
const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfe-entrada-exemplo.xml'), 'utf8');
const doXml = documentoDoXml(xml, { cnpjEstabelecimento: ESTAB.cnpj, dataEntrada: '2026-08-22', produtoPorItem: { 1: 'p1' } });

// O que o banco devolveria para ela: participante e tributos no formato da
// montagem (o banco é quem traduz; aqui a tradução é feita à mão).
function comoDoBanco(r, produtos = {}) {
  const p = r.payload.participante;
  return {
    ...r.payload,
    participante: p && {
      codigo: p.code, nome: p.name, documento: p.document, tipoDocumento: p.document.length === 14 ? 'CNPJ' : 'CPF',
      inscricaoEstadual: p.stateRegistration, codigoPais: p.countryCode, codigoMunicipio: p.ibgeCityCode,
      logradouro: p.street, numero: p.streetNumber, complemento: p.addressComplement, bairro: p.neighborhood
    },
    itens: r.itens.map((it) => ({
      ...it,
      produto: produtos[it.productId] || null,
      tributos: Object.fromEntries(it.tributos.map((t) => [t.tributo, {
        cst: t.cst, base: t.baseCalculo, aliquota: t.aliquota, valor: t.valor, reducao: t.reducaoBase
      }]))
    }))
  };
}
const entrada = comoDoBanco(doXml, { p1: { codigo: '1001', descricao: 'PARAFUSO 3/8 INOX', unidade: 'pc', ncm: '73181500', tipoItem: 'NORMAL' } });

// A saída: uma NF-e própria de R$ 1.000 a 17%, e uma cancelada.
const saida = {
  sentido: 'SAIDA', emissaoPropria: true, modelo: '55', serie: '1', numero: '3001', chaveAcesso: '4'.repeat(44),
  dataEmissao: '2026-08-10', dataMovimento: '2026-08-10', situacao: 'REGULAR', indicadorPagamento: 0, modalidadeFrete: 9,
  valorTotal: 1000, valorProdutos: 1000, valorDesconto: 0, valorFrete: 0, valorSeguro: 0, valorOutras: 0, valorPis: 6.5, valorCofins: 30,
  participante: { codigo: '12345678909', nome: 'CLIENTE FINAL', documento: '12345678909', tipoDocumento: 'CPF', codigoPais: '1058', codigoMunicipio: '4209102', logradouro: 'RUA A', numero: '1', bairro: 'B' },
  itens: [{ numero: 1, codigoItem: '1001', descricao: 'PARAFUSO', quantidade: 2, unidade: 'PC', valorTotal: 1000, valorDesconto: 0, cfop: '5102', origem: 0,
    tributos: { ICMS: { cst: '00', base: 1000, aliquota: 17, valor: 170 } } }]
};
const cancelada = { ...saida, numero: '3002', chaveAcesso: '5'.repeat(44), situacao: 'CANCELADO' };

const base = { competencia: '2026-08', estabelecimento: ESTAB, empresa: EMPRESA, configuracao: CONFIG, saldoCredorAnterior: 0 };

console.log('\n--- 1. o XML vira documento ---');
check('CFOP do fornecedor vira CFOP de entrada', cfopDeEntrada('5102').cfop === '1102' && cfopDeEntrada('6405').cfop === '2403' && cfopDeEntrada('5101').cfop === '1102');
check('  e CFOP que já é de entrada fica', cfopDeEntrada('1102').derivado === false);
check('a nota do fornecedor é ENTRADA de terceiro', doXml.payload.sentido === 'ENTRADA' && doXml.payload.emissaoPropria === false);
check('  com o fornecedor como participante, pelo CNPJ', doXml.payload.participante.code === '11222333000181');
check('  e o dia da entrada como DT_E_S', doXml.payload.dataMovimento === '2026-08-22');
check('  e o vínculo do item 1 ao produto', doXml.itens[0].productId === 'p1' && doXml.itens[1].productId === null);
check('a conversão de CFOP é avisada', doXml.avisos.some((a) => /5102->1102/.test(a)));
const propria = documentoDoXml(xml, { cnpjEstabelecimento: '11222333000181' });
check('o mesmo XML, visto pelo emitente, é SAÍDA própria com o CFOP original',
  propria.payload.emissaoPropria && propria.payload.sentido === 'SAIDA' && propria.itens[0].cfop === '5102' && propria.payload.participante.code === '52998224725000');
check('CSOSN vira CST 90 com a origem na frente', cstIcms(0, '102').cst === '090' && cstIcms(1, '00').cst === '100');

console.log('\n--- 2. o mês ---');
const m = montarEscrituracao({ ...base, documentos: [entrada, saida, cancelada] });
const C = m.blocos.C;
const c100 = C.filter((r) => r.REG === 'C100');
check('sem impedimento com o cadastro completo', m.impedimentos.length === 0, cods(m.impedimentos) || 'nenhum');
check('três C100, na ordem das datas', c100.map((r) => r.NUM_DOC).join(',') === '3001,3002,12345', c100.map((r) => r.NUM_DOC).join(','));
check('a cancelada sai só com a identificação, COD_SIT 02',
  c100[1].COD_SIT === '02' && c100[1].VL_DOC === undefined && c100[1].CHV_NFE === '5'.repeat(44));
check('  e sem C190 depois dela', C[C.indexOf(c100[1]) + 1].REG === 'C100');
const iSaida = C.indexOf(c100[0]);
check('a saída própria NÃO tem C170, só C190', C[iSaida + 1].REG === 'C190');
const iEntrada = C.indexOf(c100[2]);
check('a entrada de terceiro tem C170 por item', C[iEntrada + 1].REG === 'C170' && C[iEntrada + 2].REG === 'C170');
const c170 = C.filter((r) => r.REG === 'C170');
check('  o item vinculado usa o código do cadastro', c170[0].COD_ITEM === '1001', c170[0].COD_ITEM);
check('  o sem vínculo usa fornecedor-código', c170[1].COD_ITEM === '11222333000181-FORN-9902', c170[1].COD_ITEM);
check('  com CFOP de entrada e CST de 3 posições', c170[0].CFOP === '1102' && c170[0].CST_ICMS === '000' && c170[1].CST_ICMS === '090');
check('  PIS/COFINS de quem compra no presumido: CST 70', c170[0].CST_PIS === '70' && c170[0].CST_COFINS === '70');
check('  IPI fora do VL_IPI (não contribuinte) e dentro do VL_OPR do C190',
  c170[0].VL_IPI === '' && C.find((r) => r.REG === 'C190' && r.CFOP === '1102' && r.CST_ICMS === '000').VL_OPR === 262.5);
check('C100 da entrada: ICMS é a soma do C190', c100[2].VL_ICMS === 42.5 && c100[2].VL_BC_ICMS === 250);
const p0150 = m.blocos[0].filter((r) => r.REG === '0150');
check('0150 tem os dois participantes, e o da cancelada não conta duas vezes', p0150.length === 2, p0150.map((r) => r.COD_PART).join(','));
check('  CPF no campo de CPF e CNPJ no de CNPJ', p0150.some((r) => r.CPF === '12345678909' && r.CNPJ === '') && p0150.some((r) => r.CNPJ === '11222333000181'));
const r0200 = m.blocos[0].filter((r) => r.REG === '0200');
check('0200 só com os itens citados em C170', r0200.map((r) => r.COD_ITEM).join(',') === '1001,11222333000181-FORN-9902');
check('0190 com as unidades usadas, em maiúscula', m.blocos[0].filter((r) => r.REG === '0190').map((r) => r.UNID).join(',') === 'PC,UN');

console.log('\n--- 3. a apuração ---');
const e110 = m.blocos.E.find((r) => r.REG === 'E110');
check('débito 170 (a saída), crédito 42,50 (a entrada)', e110.VL_TOT_DEBITOS === 170 && e110.VL_TOT_CREDITOS === 42.5);
check('a recolher 127,50', e110.VL_ICMS_RECOLHER === 127.5);
const e116 = m.blocos.E.find((r) => r.REG === 'E116');
check('E116 com o total, a receita e o vencimento no dia 10 do mês seguinte',
  e116 && e116.VL_OR === 127.5 && e116.COD_REC === '144910014' && e116.DT_VCTO === '10092026' && e116.MES_REF === '082026');

const sem = montarEscrituracao({ ...base, configuracao: { ...CONFIG, credito_icms_entradas: 'NENHUM' }, documentos: [entrada, saida] });
const e110sem = sem.blocos.E.find((r) => r.REG === 'E110');
check('com "NENHUM", a entrada não dá crédito e o imposto sobe para 170', e110sem.VL_TOT_CREDITOS === 0 && e110sem.VL_ICMS_RECOLHER === 170);
check('  e a base e o ICMS da entrada saem zerados no C170 e no C100',
  sem.blocos.C.filter((r) => r.REG === 'C170').every((r) => r.VL_ICMS === 0 && r.VL_BC_ICMS === 0)
  && sem.blocos.C.filter((r) => r.REG === 'C100' && r.IND_OPER === '0').every((r) => r.VL_ICMS === 0));

const credor = montarEscrituracao({ ...base, saldoCredorAnterior: 500, documentos: [entrada, saida] });
const e110c = credor.blocos.E.find((r) => r.REG === 'E110');
check('saldo credor anterior de 500 vira saldo a transportar, e não há E116',
  e110c.VL_SLD_CREDOR_ANT === 500 && e110c.VL_ICMS_RECOLHER === 0 && e110c.VL_SLD_CREDOR_TRANSPORTAR === 372.5
  && !credor.blocos.E.some((r) => r.REG === 'E116'));

console.log('\n--- 4. o que impede ---');
const vazio = montarEscrituracao({ ...base, configuracao: {}, estabelecimento: { ...ESTAB, perfil_sped: null, indicador_atividade: null }, saldoCredorAnterior: null, documentos: [entrada, saida] });
check('sem configuração: perfil, atividade, contador, crédito, saldo e E116 impedem',
  ['PERFIL', 'IND_ATIV', 'CONTADOR', 'CREDITO', 'SALDO_ANTERIOR'].every((c) => vazio.impedimentos.some((i) => i.codigo === c)), cods(vazio.impedimentos));
const comSt = { ...saida, numero: '3003', chaveAcesso: '6'.repeat(44), itens: [{ ...saida.itens[0], tributos: { ICMS: { cst: '10', base: 1000, aliquota: 17, valor: 170 }, ICMS_ST: { base: 1400, aliquota: 17, valor: 68 } } }] };
check('ICMS-ST retido na saída impede (E200 ainda não é gerado)', montarEscrituracao({ ...base, documentos: [comSt] }).impedimentos.some((i) => i.codigo === 'ST'));
const comDifal = { ...saida, numero: '3004', chaveAcesso: '7'.repeat(44), itens: [{ ...saida.itens[0], tributos: { ...saida.itens[0].tributos, ICMS_DIFAL: { valor: 30 } } }] };
check('DIFAL impede (E300 ainda não é gerado)', montarEscrituracao({ ...base, documentos: [comDifal] }).impedimentos.some((i) => i.codigo === 'DIFAL'));
check('Bloco K obrigatório impede', montarEscrituracao({ ...base, configuracao: { ...CONFIG, bloco_k_obrigatorio: true }, documentos: [] }).impedimentos.some((i) => i.codigo === 'BLOCO_K'));
check('CSOSN convertido e informação complementar são AVISOS, não impedimentos',
  m.avisos.some((a) => a.codigo === 'CSOSN') && m.avisos.some((a) => a.codigo === 'C110'));
const divergente = comoDoBanco(doXml, { p1: { codigo: '1001', descricao: 'PARAFUSO', unidade: 'CX', ncm: '73181500' } });
const mDiv = montarEscrituracao({ ...base, documentos: [divergente] });
check('unidade da nota diferente da do cadastro: escritura o item do fornecedor e avisa',
  mDiv.blocos.C.find((r) => r.REG === 'C170').COD_ITEM === '11222333000181-FORN-4471' && mDiv.avisos.some((a) => a.codigo === 'UNIDADE'));

console.log('\n--- 5. o arquivo, conferido pela tela que confere o SPED dos outros ---');
const arquivo = g.gerarEfd({ registro0000: m.registro0000, blocos: m.blocos });
const latin = g.paraLatin1(arquivo.texto).buffer;
const conf = conferirEfd(latin, { nome: 'gerado.txt' });
check('a conferência não acha NADA', conf.problemas.length === 0, conf.problemas.map((p) => p.codigo + ': ' + p.titulo).join(' | ') || 'limpo');
check('  e lê o que foi escrito: 3 notas, competência 2026-08', conf.resumo.notas === 3 && conf.arquivo.competencia === '2026-08');
check('o arquivo gerado é relido campo a campo pelo leitor', g.lerEfd(latin).length === arquivo.linhas.length);
const vazioMes = montarEscrituracao({ ...base, documentos: [] });
const confVazio = conferirEfd(g.paraLatin1(g.gerarEfd(vazioMes).texto).buffer, { nome: 'v.txt' });
check('mês sem movimento também sai limpo', confVazio.problemas.length === 0 && vazioMes.blocos.C.length === 0, confVazio.problemas.map((p) => p.codigo).join(' ') || 'limpo');

console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
