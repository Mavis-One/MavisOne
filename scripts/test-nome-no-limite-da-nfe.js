// O NOME DO DESTINATÁRIO NO LIMITE DO LEIAUTE (29/10/2026).
//
// Print do usuário: "NF-e com erro — SAL INFINITY PLUS COMERCIO LTDA FILIAL 09
// (IRIRIU - JOINVILLE) · Erro na validação do Schema XML · Nome destinatario
// é muito longo (não mais do que 60 caracteres)". O nome cadastrado da filial
// tem 62. Os textos da nota passam a ser cortados no tamanho da tag (60; a
// descrição do item, 120), na última palavra inteira e sem parêntese aberto.
const fs = require('fs');
const path = require('path');
const builder = require('../lib/nfePayloadBuilder');

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${extra !== undefined ? ` -> ${extra}` : ''}`);
  if (!cond) falhas += 1;
};
const fonte = fs.readFileSync(path.join(__dirname, '..', 'lib/nfePayloadBuilder.js'), 'utf8');
const { noLimite } = builder;

console.log('--- o corte ---');
const filial = noLimite('SAL INFINITY PLUS COMERCIO LTDA FILIAL 09 (IRIRIU - JOINVILLE)');
check('o nome do print sai sem o parêntese aberto', filial === 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 09', JSON.stringify(filial));
const longo = noLimite('COOPERATIVA DE CREDITO DE LIVRE ADMISSAO DO VALE DO ITAJAI VIACREDI LTDA');
check('  na última palavra inteira, até 60', longo === 'COOPERATIVA DE CREDITO DE LIVRE ADMISSAO DO VALE DO ITAJAI', JSON.stringify(longo));
check('  palavra única maior que o limite: os 60 primeiros', noLimite('A'.repeat(70)) === 'A'.repeat(60));
check('  o que cabe não muda (fora espaços repetidos)', noLimite('  CLIENTE   CURTO ') === 'CLIENTE CURTO');
check('  vazio e ausente voltam como vieram', noLimite('') === '' && noLimite(undefined) === undefined && noLimite(null) === null);
check('  nenhum passa de 60', ['X '.repeat(40), 'NOME (' + 'Y'.repeat(70) + ')', 'A - B - C - '.repeat(8)].every((t) => noLimite(t).length <= 60));

console.log('\n--- na nota ---');
const item = builder.buildNfeItemPayload({
  descricao: 'PRODUTO '.repeat(20), codigoProduto: '1', ncm: '35061010', quantidade: 1, valorUnitario: 10, origem: 0,
  regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 0 }
}, 0);
check('a descrição do item até 120', item.descricao.length <= 120 && item.descricao.startsWith('PRODUTO PRODUTO'), item.descricao.length);
check('o destinatário da NF-e', /nome_destinatario: emHomologacao \? NOME_DESTINATARIO_HOMOLOGACAO : noLimite\(destinatario\.nome\),/.test(fonte));
check('  e o endereço dele', ['logradouro', 'bairro', 'municipio'].every((c) => fonte.includes(`${c}_destinatario: noLimite(destinatario.${c}),`))
  && fonte.includes("numero_destinatario: noLimite(destinatario.numero) || 'S/N',"));
check('o consumidor da NFC-e', fonte.includes('nome_destinatario: emHomologacao ? NOME_DESTINATARIO_HOMOLOGACAO : (noLimite(dest.nome) || undefined),'));
check('o emitente', fonte.includes('nome_emitente: noLimite(estabelecimento.razaoSocial),')
  && fonte.includes('nome_fantasia_emitente: noLimite(estabelecimento.nomeFantasia) || undefined,'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
