#!/usr/bin/env node
// IBS e CBS — Reforma Tributária (LC 214/2025).
//
// A armadilha desta tabela: cClassTrib e CST NÃO são códigos independentes.
// Os 3 primeiros dígitos do cClassTrib SÃO o CST. Uma linha cadastrada sob o
// CST errado passa no cadastro, vai para a nota e volta como rejeição da
// SEFAZ — ou pior, classifica a operação sob uma hipótese legal que não é a
// dela, e isso ninguém confere depois.
//
// A outra: a carga é PARCIAL de propósito (a tabela oficial tem centenas de
// códigos e aqui só entrou o que foi conferido um a um). Se a tela tratar a
// lista como exaustiva, o usuário fica impedido de cadastrar um código
// legítimo por uma limitação nossa.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const migracao = ler('supabase/migrations/fase-z-ibs-cbs.sql');
const dbSrc = ler('lib/db/fiscal.js');
const telaSrc = ler('public/modules/fiscal/subs/regras.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Extrai as linhas de INSERT para conferir os dados, não só o texto do SQL.
function linhasInsert(tabela, colunas) {
  const inicio = migracao.indexOf(`insert into ${tabela} (`);
  const fim = migracao.indexOf('on conflict', inicio);
  const trecho = migracao.slice(inicio, fim);
  return [...trecho.matchAll(/\(([^()]*)\)(?=,\s*$|\s*$)/gm)]
    .map((m) => m[1].split(/',\s*'/).map((s) => s.replace(/^'|'$/g, '').trim()))
    .filter((campos) => campos.length === colunas)
    .map((campos) => campos);
}

console.log('--- CST do IBS/CBS: a lista completa ---');
const csts = linhasInsert('cst_ibs_cbs', 2);
const codigosCst = csts.map((c) => c[0]);
// Conferido contra a listagem do ERP em uso (2026-08-10).
const ESPERADOS = ['000', '010', '011', '200', '210', '220', '221', '222', '400', '410',
  '510', '515', '550', '620', '800', '810', '811', '820', '830'];
check('19 códigos', codigosCst.length === 19, String(codigosCst.length));
ESPERADOS.forEach((c) => check(`CST ${c} presente`, codigosCst.includes(c)));
check('nenhum código a mais', codigosCst.every((c) => ESPERADOS.includes(c)), codigosCst.filter((c) => !ESPERADOS.includes(c)).join(',') || 'ok');
check('todos com 3 dígitos', codigosCst.every((c) => /^\d{3}$/.test(c)));
check('sem duplicata', new Set(codigosCst).size === codigosCst.length);

console.log('\n--- cClassTrib: o código carrega o CST dentro dele ---');
const classes = linhasInsert('classificacao_tributaria', 3);
check('carga tem códigos', classes.length > 0, `${classes.length} código(s)`);
check('todos com 6 dígitos', classes.every(([codigo]) => /^\d{6}$/.test(codigo)));
// A regra que o banco também impõe por CHECK — testada aqui para pegar o erro
// antes de tentar rodar a migração.
classes.forEach(([codigo, cst]) => {
  check(`${codigo} declara o CST do próprio prefixo`, codigo.slice(0, 3) === cst, `prefixo ${codigo.slice(0, 3)} x cst ${cst}`);
});
classes.forEach(([codigo, cst]) => {
  check(`  ${codigo}: o CST ${cst} existe na tabela`, codigosCst.includes(cst));
});
check('sem duplicata', new Set(classes.map((c) => c[0])).size === classes.length);
check('toda linha tem descrição', classes.every(([, , desc]) => desc && desc.length > 10));

console.log('\n--- o banco impede a incoerência sozinho ---');
// Se só o teste conferir, uma carga futura feita direto no SQL Editor entra errada.
check('CHECK amarra cst ao prefixo do código', /check \(cst = substring\(codigo from 1 for 3\)\)/.test(migracao));
check('FK garante que o CST existe', /references cst_ibs_cbs\(codigo\)/.test(migracao));
check('índice por CST', /idx_classificacao_tributaria_cst/.test(migracao));

console.log('\n--- a migração pode rodar duas vezes ---');
check('create table if not exists', (migracao.match(/create table if not exists/g) || []).length >= 2);
check('on conflict nos inserts', (migracao.match(/on conflict \(codigo\) do update/g) || []).length >= 2);
check('add column if not exists', (migracao.match(/add column if not exists/g) || []).length === 4);

console.log('\n--- a regra fiscal carrega os campos novos ---');
['cst_ibs_cbs', 'class_trib', 'aliquota_ibs', 'aliquota_cbs'].forEach((coluna) => {
  check(`coluna ${coluna} criada`, new RegExp(`add column if not exists ${coluna}`).test(migracao));
  check(`  ${coluna} lida no map`, new RegExp(`row\\.${coluna}`).test(dbSrc));
});
check('cstIbsCbs gravado', /cst_ibs_cbs: textoOuNulo\(payload\.cstIbsCbs\)/.test(dbSrc));
check('classTrib gravado', /class_trib: textoOuNulo\(payload\.classTrib\)/.test(dbSrc));
// Alíquota 0 é legítima (CST 400 isenção, 410 imunidade): `|| null` a
// transformaria em "não preenchido".
check('alíquota IBS aceita zero', /aliquota_ibs: numeroOuNulo\(payload\.aliquotaIbs\)/.test(dbSrc));
check('alíquota CBS aceita zero', /aliquota_cbs: numeroOuNulo\(payload\.aliquotaCbs\)/.test(dbSrc));

console.log('\n--- as tabelas chegam na tela ---');
check('cst_ibs_cbs consultada', /consultar\('cst_ibs_cbs', 'codigo'\)/.test(dbSrc));
check('classificacao_tributaria consultada', /consultar\('classificacao_tributaria', 'codigo'\)/.test(dbSrc));
// Sem a migração aplicada, as outras tabelas não podem parar de funcionar.
check('ausência das tabelas não derruba as outras', /if \(\/does not exist\|Could not find\|schema cache\/i\.test/.test(dbSrc));
check('a tela recebe cstIbsCbs', /cstIbsCbs: cstIbsCbs \|\| \[\]/.test(dbSrc));
check('a tela recebe a classificação', /classificacaoTributaria: classTrib \|\| \[\]/.test(dbSrc));

console.log('\n--- a lista parcial não vira camisa de força ---');
// Select fechado impediria cadastrar um código oficial que ainda não subiu.
check('cClassTrib aceita digitação', /<input name="classTrib" list="listaClassTrib"/.test(telaSrc));
check('com sugestão por datalist', /<datalist id="listaClassTrib">/.test(telaSrc));
check('e avisa que a lista não é exaustiva', /pode digitar um que não esteja na lista/.test(telaSrc));
check('o servidor marca a carga como parcial', /classificacaoTributariaParcial: true/.test(dbSrc));
check('a migração diz que está parcial', /PARCIAL de propósito/.test(migracao));

console.log('\n--- os campos são enviados e relidos ---');
// Se ficarem de fora de CAMPOS_TEXTO, o formulário desenha mas não grava — e
// editar uma regra apagaria o que já estava salvo.
['cstIbsCbs', 'classTrib', 'aliquotaIbsUf', 'aliquotaIbsMun', 'aliquotaCbs'].forEach((campo) => {
  check(`${campo} está em CAMPOS_TEXTO`, new RegExp(`'${campo}'`).test(telaSrc.slice(telaSrc.indexOf('const CAMPOS_TEXTO'), telaSrc.indexOf('function semAcento'))));
});
check('a seção de IBS/CBS existe no formulário', /IBS e CBS — Reforma Tributária/.test(telaSrc));

console.log('\n--- o payload REALMENTE leva IBS/CBS à SEFAZ ---');
// Este era o elo que faltava: tela e banco guardavam os quatro campos e o
// payload não mandava nenhum. Medido em homologação em 14/08/2026 — a SEFAZ
// recusa TODA nota com "1115 - Rejeicao: IBS/CBS não informado".
const { buildNfePayload } = require('../lib/nfePayloadBuilder');
const baseArgs = {
  estabelecimento: { cnpj: '11222333000181', razaoSocial: 'Emitente SC Ltda', logradouro: 'Rua B', numero: '1', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000', codigoMunicipio: '4209102', inscricaoEstadual: '123456789' },
  empresa: { crt: 3 },
  destinatario: { nome: 'Cliente', documento: '12345678000199', contribuinte: true, logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000' },
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-14T10:00:00-03:00',
  ambiente: 'homologacao'
};
const comIbs = (regraExtra) => buildNfePayload({
  ...baseArgs,
  itens: [{
    descricao: 'Produto', codigoProduto: 'P1', ncm: '73181500', quantidade: 2, valorUnitario: 100, unidadeComercial: 'UN',
    regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 17, cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3, ...regraExtra }
  }]
}).items[0];

// 2026: CBS 0,9%, IBS da UF exatamente 0,1% e IBS do município exatamente
// 0,0%. Os números vêm de rejeição da SEFAZ, não de suposição: 0,05/0,05
// (que um guia da Focus dava) foi recusado com "1036 — Alíquota do IBS do
// Município inválida", e a 1026 cobra 0,1% na UF.
const itemIbs = comIbs({ cstIbsCbs: '000', classTrib: '000001', aliquotaIbsUf: 0.1, aliquotaIbsMun: 0, aliquotaCbs: 0.9 });
check('manda a situação tributária do IBS/CBS', itemIbs.ibs_cbs_situacao_tributaria === '000', itemIbs.ibs_cbs_situacao_tributaria);
check('manda a classificação tributária', itemIbs.ibs_cbs_classificacao_tributaria === '000001', itemIbs.ibs_cbs_classificacao_tributaria);
check('manda a base de cálculo (2 x 100)', itemIbs.ibs_cbs_base_calculo === 200, String(itemIbs.ibs_cbs_base_calculo));
check('alíquota do IBS estadual (0,1% em 2026)', itemIbs.ibs_uf_aliquota === 0.1, String(itemIbs.ibs_uf_aliquota));
check('valor do IBS estadual (200 x 0,1%)', itemIbs.ibs_uf_valor === 0.2, String(itemIbs.ibs_uf_valor));
// O ZERO precisa VIAJAR. Omitir o campo é o que derruba a nota com 1036 —
// zero é informação, ausência é outra coisa.
check('alíquota do IBS municipal vai como zero explícito', itemIbs.ibs_mun_aliquota === 0, String(itemIbs.ibs_mun_aliquota));
check('e o campo existe mesmo valendo zero', 'ibs_mun_aliquota' in itemIbs);
check('valor do IBS municipal é zero', itemIbs.ibs_mun_valor === 0, String(itemIbs.ibs_mun_valor));
// vIBS é a SOMA das partes já arredondadas: recalcular do zero produz o
// centavo de diferença que a SEFAZ acusa ao conferir o total contra as partes.
check('o total do IBS é a soma das duas competências', itemIbs.ibs_valor_total === 0.2, String(itemIbs.ibs_valor_total));
check('alíquota da CBS', itemIbs.cbs_aliquota === 0.9, String(itemIbs.cbs_aliquota));
check('valor da CBS (200 x 0,9%)', itemIbs.cbs_valor === 1.8, String(itemIbs.cbs_valor));

console.log('\n--- os nomes são os da referência oficial da Focus ---');
// campos.focusnfe.com.br/nfe/ItemNotaFiscalXML.html — conferidos contra as
// tags do XML (pIBSUF, pIBSMun, pCBS, cClassTrib). A Focus IGNORA campo
// desconhecido em silêncio e responde sucesso: nome errado aqui não dá erro,
// produz nota AUTORIZADA e errada, que só aparece numa fiscalização.
const builderSrc = ler('lib/nfePayloadBuilder.js');
['ibs_cbs_situacao_tributaria', 'ibs_cbs_classificacao_tributaria', 'ibs_cbs_base_calculo',
  'ibs_uf_aliquota', 'ibs_uf_valor', 'ibs_mun_aliquota', 'ibs_mun_valor',
  'ibs_valor_total', 'cbs_aliquota', 'cbs_valor'].forEach((campo) => {
  check(`usa "${campo}"`, new RegExp(`base\\.${campo}\\s*=`).test(builderSrc));
});
check('a origem dos nomes está citada no código', /campos\.focusnfe\.com\.br/.test(builderSrc));

console.log('\n--- CST sem alíquota não leva percentual zerado ---');
// Operação não tributada (400 e afins) não tem percentual. Mandar zero
// explícito faz a SEFAZ cobrar coerência entre o CST e o valor.
// Aqui as alíquotas nem sequer são declaradas na regra — é diferente de
// declarar zero, e o payload precisa refletir essa diferença.
const isento = comIbs({ cstIbsCbs: '400', classTrib: '400001' });
check('não declarada, não manda ibs_uf_aliquota', !('ibs_uf_aliquota' in isento));
check('nem ibs_mun_aliquota', !('ibs_mun_aliquota' in isento));
check('nem cbs_aliquota', !('cbs_aliquota' in isento));
check('nem o total do IBS', !('ibs_valor_total' in isento));
check('mas ainda manda CST e classificação', isento.ibs_cbs_situacao_tributaria === '400' && isento.ibs_cbs_classificacao_tributaria === '400001');

console.log('\n--- regra sem IBS/CBS não inventa situação tributária ---');
// A nota continua sendo recusada — e é o certo: melhor a rejeição visível do
// que uma nota autorizada sob uma hipótese legal que não é a dela.
const semIbs = comIbs({});
check('não inventa CST de IBS/CBS', !('ibs_cbs_situacao_tributaria' in semIbs));
check('nem manda base de cálculo', !('ibs_cbs_base_calculo' in semIbs));

console.log('\n--- o IBS vai separado por competência, não dividido ao meio ---');
const migracaoAd = ler('supabase/migrations/fase-ad-ibs-cbs-uf-municipio.sql');
check('a migração cria a coluna do estado', /aliquota_ibs_uf/.test(migracaoAd));
check('e a do município', /aliquota_ibs_mun/.test(migracaoAd));
check('o banco lê as duas', /aliquotaIbsUf: row\.aliquota_ibs_uf/.test(dbSrc) && /aliquotaIbsMun: row\.aliquota_ibs_mun/.test(dbSrc));
check('e grava as duas', /aliquota_ibs_uf: numeroOuNulo/.test(dbSrc) && /aliquota_ibs_mun: numeroOuNulo/.test(dbSrc));
check('a migração explica por que não é um total dividido', /passaria a mentir/.test(migracaoAd));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
